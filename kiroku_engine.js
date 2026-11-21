// === Kiroku Pure Logic Engine (chunked cloud packing, primary-first catalog waterfall, cache, grid sizes) ===
(function initKirokuEngine(root) {
  'use strict';

  const DEFAULT_CHUNK_MAX_BYTES = 680000; // Безопасный запас ниже лимита 1 МБ на документ Firestore
  const DEFAULT_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;
  const DEFAULT_CATALOG_CACHE_MAX = 60;

  function utf8ByteLength(str) {
    const s = String(str || '');
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(s).length;
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.byteLength(s, 'utf8');
    }
    return s.length * 2;
  }

  function sanitizeItemForChunk(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    const skipKeys = new Set([
      '_normCache',
      '_knownStatusFromImport',
      'lastLinkAttempt',
      'dirty',
      'userId',
      '_docId',
      'kind'
    ]);
    for (const [k, v] of Object.entries(raw)) {
      if (skipKeys.has(k) || v === undefined) continue;
      if (v === '' || v === null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      if (v === false && (k === 'archived' || k === 'fav' || k === 'pin' || k === 'ongoing' || k === 'needsReview' || k === 'isAdult')) continue;
      if (v === 0 && (k === 'rewatchCount' || k === 'completedAt' || k === 'aniId' || k === 'mal' || k === 'eps' || k === 'vols' || k === 'dur')) continue;
      out[k] = v;
    }
    // Если постер — огромный base64 (>120 КБ), не раздуваем облачный чанк
    if (typeof out.poster === 'string' && out.poster.startsWith('data:') && out.poster.length > 120000) {
      delete out.poster;
    }
    if (out.id === undefined || out.id === null) return null;
    return out;
  }

  function packCollectionChunks(itemsList, maxBytes = DEFAULT_CHUNK_MAX_BYTES) {
    const cleanItems = (Array.isArray(itemsList) ? itemsList : [])
      .map(sanitizeItemForChunk)
      .filter(Boolean);
    if (!cleanItems.length) return [];

    const chunks = [];
    let currentBatch = [];
    let currentBytes = 2; // "[]"

    for (const item of cleanItems) {
      const itemJson = JSON.stringify(item);
      const itemBytes = utf8ByteLength(itemJson) + (currentBatch.length ? 1 : 0);
      if (currentBatch.length > 0 && currentBytes + itemBytes > maxBytes) {
        chunks.push({
          chunkIdx: chunks.length,
          count: currentBatch.length,
          payloadJson: JSON.stringify(currentBatch)
        });
        currentBatch = [item];
        currentBytes = 2 + utf8ByteLength(itemJson);
      } else {
        currentBatch.push(item);
        currentBytes += itemBytes;
      }
    }
    if (currentBatch.length > 0) {
      chunks.push({
        chunkIdx: chunks.length,
        count: currentBatch.length,
        payloadJson: JSON.stringify(currentBatch)
      });
    }
    const total = chunks.length;
    return chunks.map(c => ({ ...c, chunkTotal: total }));
  }

  function unpackCollectionChunks(chunkDocs) {
    const byId = new Map();
    const sorted = (Array.isArray(chunkDocs) ? chunkDocs : [])
      .filter(Boolean)
      .sort((a, b) => (Number(a.chunkIdx) || 0) - (Number(b.chunkIdx) || 0));

    for (const ch of sorted) {
      let arr = null;
      if (typeof ch.payloadJson === 'string') {
        try {
          arr = JSON.parse(ch.payloadJson);
        } catch (e) {
          arr = null;
        }
      } else if (Array.isArray(ch.items)) {
        arr = ch.items;
      }
      if (!Array.isArray(arr)) continue;
      for (const it of arr) {
        if (!it || it.id === undefined || it.id === null) continue;
        byId.set(String(it.id), it);
      }
    }
    return [...byId.values()];
  }

  function shouldPullCollectionFromCloud(opts) {
    const {
      hasPendingWrites = false,
      remoteWriter = '',
      sessionWriter = '',
      remoteColRev = 0,
      localRev = 0,
      itemsCount = 0,
      remoteColCount = null,
      lastFullSyncAt = 0,
      initialProfileHandled = false,
      now = Date.now(),
      reconcileMs = 7 * 24 * 3600 * 1000
    } = opts || {};

    // Никогда не запускаем перечитку из-за собственного локального эха записи
    if (hasPendingWrites) return false;
    if (remoteWriter && sessionWriter && remoteWriter === sessionWriter && itemsCount > 0) {
      return false;
    }

    const revChanged = Boolean(remoteColRev && Number(remoteColRev) > Number(localRev || 0));
    const emptyNeedPull = itemsCount === 0 && (remoteColCount === null || Number(remoteColCount) > 0 || !lastFullSyncAt);

    if (emptyNeedPull) return true;
    if (revChanged) return true;
    if (!initialProfileHandled) {
      const cacheStale = !lastFullSyncAt || (now - Number(lastFullSyncAt)) > reconcileMs;
      return cacheStale;
    }
    return false;
  }

  function raceWithTimeout(promise, timeoutMs, fallbackVal = []) {
    if (!timeoutMs || timeoutMs <= 0) return Promise.resolve(promise).catch(() => fallbackVal);
    return new Promise(resolve => {
      let settled = false;
      const t = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(fallbackVal);
        }
      }, timeoutMs);
      Promise.resolve(promise)
        .then(v => {
          if (!settled) {
            settled = true;
            clearTimeout(t);
            resolve(Array.isArray(v) ? v : fallbackVal);
          }
        })
        .catch(() => {
          if (!settled) {
            settled = true;
            clearTimeout(t);
            resolve(fallbackVal);
          }
        });
    });
  }

  // Водопад «сначала главный источник; дополнительные только если данных не хватило»
  async function runPrimaryFirstWaterfall(sources, opts = {}) {
    const {
      minEnough = 12,
      filterFn = null,
      dedupFn = null,
      signal = null
    } = opts;

    const list = (Array.isArray(sources) ? sources : []).filter(Boolean);
    const applyFilter = arr => (typeof filterFn === 'function' ? arr.filter(filterFn) : arr);
    const applyDedup = arrays => {
      if (typeof dedupFn === 'function') return dedupFn(arrays);
      return arrays.flat();
    };

    let merged = [];
    const usedSources = [];

    for (const src of list) {
      if (signal && signal.aborted) {
        return { items: merged, usedSources, aborted: true };
      }
      let raw = [];
      try {
        raw = await raceWithTimeout(src.run(signal), src.timeoutMs || 3200, []);
      } catch (e) {
        raw = [];
      }
      if (signal && signal.aborted) {
        return { items: merged, usedSources, aborted: true };
      }
      const filtered = applyFilter(Array.isArray(raw) ? raw : []);
      if (filtered.length > 0) {
        usedSources.push(src.name || 'source');
        merged = merged.length ? applyDedup([merged, filtered]) : applyDedup([filtered]);
      }
      if (merged.length >= minEnough) {
        break;
      }
    }

    return { items: merged, usedSources, aborted: Boolean(signal && signal.aborted) };
  }

  function buildCatalogCacheKey(params) {
    const p = params || {};
    const sortedTags = Array.isArray(p.tags) ? [...p.tags].sort() : [];
    return JSON.stringify([
      p.g || '',
      p.sub || '',
      p.mode || '',
      String(p.q || '').trim().toLowerCase(),
      Number(p.page) || 1,
      p.age || '',
      p.len || '',
      p.country || '',
      Number(p.yrFrom) || 0,
      Number(p.yrTo) || 0,
      Boolean(p.ongOnly),
      sortedTags
    ]);
  }

  function createCatalogCache(ttlMs = DEFAULT_CATALOG_CACHE_TTL_MS, maxEntries = DEFAULT_CATALOG_CACHE_MAX) {
    const store = new Map();
    return {
      get(key, now = Date.now()) {
        const hit = store.get(key);
        if (!hit) return null;
        if (now - hit.t > ttlMs) {
          store.delete(key);
          return null;
        }
        // Обновляем LRU порядок
        store.delete(key);
        store.set(key, hit);
        return hit.v.map(r => ({ ...r }));
      },
      set(key, val, now = Date.now()) {
        if (!Array.isArray(val) || !val.length) return;
        if (store.has(key)) store.delete(key);
        store.set(key, { t: now, v: val.map(r => ({ ...r })) });
        while (store.size > maxEntries) {
          store.delete(store.keys().next().value);
        }
      },
      clear() {
        store.clear();
      },
      size() {
        return store.size;
      }
    };
  }

  function normalizeGridSize(val) {
    const n = Number(val);
    if (n <= 150) return 150;
    if (n >= 240) return 240;
    return 190;
  }

  function getGridSizeKey(val) {
    const n = normalizeGridSize(val);
    return n <= 150 ? 'sm' : n >= 240 ? 'lg' : 'md';
  }

  function getNextMobileGridSize(currentVal) {
    const cur = normalizeGridSize(currentVal);
    if (cur === 190) return 150; // 2 колонки -> 3 колонки
    if (cur === 150) return 240; // 3 колонки -> 1 колонка
    return 190;                  // 1 колонка -> 2 колонки
  }

  function getGridSizeMobileMeta(val) {
    const n = normalizeGridSize(val);
    if (n === 150) return { key: 'sm', cols: 3, shortLabel: '⊞ 3', fullLabel: 'Мелкие (3 в ряд)' };
    if (n === 240) return { key: 'lg', cols: 1, shortLabel: '⊞ 1', fullLabel: 'Крупные (1 в ряд)' };
    return { key: 'md', cols: 2, shortLabel: '⊞ 2', fullLabel: 'Средние (2 в ряд)' };
  }

  const EXTERNAL_CATALOG_SOURCES = new Set([
    'anilist', 'shikimori', 'jikan', 'mangadex', 'tmdb', 'google books', 'комиксы'
  ]);

  function isManualTitleItem(item) {
    if (!item || typeof item !== 'object') return false;
    if (Number(item.aniId) > 0) return false;
    if (Number(item.mal) > 0) return false;
    if (Number(item.shikiId) > 0) return false;
    if (item.mdId && String(item.mdId).trim()) return false;
    if (item.tmdb && String(item.tmdb).includes('/')) return false;
    if (item.imdbId && String(item.imdbId).trim()) return false;
    const srcLower = String(item.src || item.extSrc || '').trim().toLowerCase();
    if (srcLower && EXTERNAL_CATALOG_SOURCES.has(srcLower)) return false;
    const urlStr = String(item.url || '').trim().toLowerCase();
    if (urlStr && /(anilist\.co|shikimori\.(io|one)|myanimelist\.net|themoviedb\.org|mangadex\.org)/.test(urlStr)) {
      return false;
    }
    return true;
  }

  function resolveBestTitleDescription(activeItem, fallbackItem, cachedRuDesc) {
    const candidates = [
      activeItem && activeItem.description,
      activeItem && activeItem.desc,
      fallbackItem && fallbackItem.description,
      fallbackItem && fallbackItem.desc,
      cachedRuDesc
    ];
    const cleaned = candidates
      .map(v => String(v || '').trim())
      .filter(Boolean);
    if (!cleaned.length) return '';
    // Предпочитаем русское описание, если среди кандидатов есть кириллица
    const ruHit = cleaned.find(txt => /[а-яё]/i.test(txt));
    return ruHit || cleaned[0];
  }

  function filterAndListCollections(allFolders, itemLists, query, countsMap) {
    const seen = new Map();
    const addFolder = raw => {
      const name = String(raw || '').trim();
      if (!name) return;
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    };
    (Array.isArray(allFolders) ? allFolders : []).forEach(addFolder);
    (Array.isArray(itemLists) ? itemLists : []).forEach(addFolder);

    const itemSet = new Set(
      (Array.isArray(itemLists) ? itemLists : [])
        .map(v => String(v || '').trim().toLowerCase())
        .filter(Boolean)
    );

    const sorted = [...seen.values()].sort((a, b) => a.localeCompare(b, 'ru'));
    const qRaw = String(query || '').trim();
    const qLower = qRaw.toLowerCase();

    const filtered = sorted
      .filter(name => !qLower || name.toLowerCase().includes(qLower))
      .map(name => {
        const key = name.toLowerCase();
        const count = countsMap && typeof countsMap === 'object'
          ? (Number(countsMap[key]) || 0)
          : 0;
        return {
          name,
          inList: itemSet.has(key),
          count
        };
      });

    const exactExists = Boolean(qLower && seen.has(qLower));
    return {
      totalCount: sorted.length,
      items: filtered,
      query: qRaw,
      canCreateNew: Boolean(qRaw && !exactExists)
    };
  }

  // Защита облачных чанков от перезаписи до завершения первичной синхронизации или при ошибке/блокировке загрузки
  function canWriteCollectionChunksToCloud(opts) {
    const {
      initialCloudSyncDone = false,
      initialCloudSyncBlocked = false,
      localCount = 0,
      knownCloudCount = null,
      explicitEmptyAllowed = false,
      forceAllowOverwrite = false
    } = opts || {};

    if (forceAllowOverwrite) {
      return { allowed: true, reason: 'force_overwrite' };
    }
    if (!initialCloudSyncDone) {
      return { allowed: false, reason: 'initial_sync_pending' };
    }
    if (initialCloudSyncBlocked) {
      return { allowed: false, reason: 'initial_sync_blocked' };
    }
    const cnt = Math.max(0, Number(localCount) || 0);
    const cloudCnt = knownCloudCount === null || knownCloudCount === undefined ? null : Number(knownCloudCount);
    if (cnt === 0 && !explicitEmptyAllowed && (cloudCnt === null || cloudCnt > 0)) {
      return { allowed: false, reason: 'empty_overwrite_blocked' };
    }
    return { allowed: true, reason: 'ok' };
  }

  // Разбиение чанков на несколько writeBatch-пакетов с безопасным запасом ниже 10 МиБ лимита Firestore
  function splitChunksIntoBatches(chunks, maxChunksPerBatch = 8, maxBytesPerBatch = 5500000) {
    const list = Array.isArray(chunks) ? chunks.filter(Boolean) : [];
    if (!list.length) return [];
    const maxCnt = Math.max(1, Number(maxChunksPerBatch) || 8);
    const maxBytes = Math.max(1000, Number(maxBytesPerBatch) || 5500000);

    const batches = [];
    let current = [];
    let currentBytes = 0;

    for (const ch of list) {
      const chBytes = utf8ByteLength(ch.payloadJson || '') + 512;
      if (current.length > 0 && (current.length >= maxCnt || currentBytes + chBytes > maxBytes)) {
        batches.push(current);
        current = [ch];
        currentBytes = chBytes;
      } else {
        current.push(ch);
        currentBytes += chBytes;
      }
    }
    if (current.length > 0) {
      batches.push(current);
    }
    return batches;
  }

  // Разбиение произвольного списка операций на безопасные пакеты (<= 350 операций на writeBatch)
  function splitOperationsIntoBatches(ops, maxOpsPerBatch = 350) {
    const list = Array.isArray(ops) ? ops : [];
    if (!list.length) return [];
    const size = Math.max(1, Number(maxOpsPerBatch) || 350);
    const out = [];
    for (let i = 0; i < list.length; i += size) {
      out.push(list.slice(i, i + size));
    }
    return out;
  }

  // Выбор самой свежей локальной копии (IndexedDB vs localStorage) по timestamp обновления, а не по длине массива
  function pickFresherLocalItems(opts) {
    const {
      idbItems = null,
      idbUpdatedAt = 0,
      lsItems = null,
      lsUpdatedAt = 0,
      lsMetaCount = null
    } = opts || {};

    const hasIdb = Array.isArray(idbItems);
    const hasLs = Array.isArray(lsItems);

    if (!hasIdb && !hasLs) return { items: [], source: 'empty', updatedAt: 0 };
    if (hasIdb && !hasLs) return { items: idbItems, source: 'idb', updatedAt: Number(idbUpdatedAt) || 0 };
    if (!hasIdb && hasLs) return { items: lsItems, source: 'ls', updatedAt: Number(lsUpdatedAt) || 0 };

    const idbTs = Math.max(0, Number(idbUpdatedAt) || 0);
    const lsTs = Math.max(0, Number(lsUpdatedAt) || 0);
    const expectedLsCnt = (lsMetaCount === null || lsMetaCount === undefined) ? null : Number(lsMetaCount);

    // Если данные localStorage повреждены/очищены, а метаданные ожидали >0 записей — доверяем IndexedDB
    if (lsItems.length === 0 && expectedLsCnt !== null && expectedLsCnt > 0 && idbItems.length > 0) {
      return { items: idbItems, source: 'idb', updatedAt: idbTs };
    }

    if (lsTs > idbTs) {
      // При первом апгрейде со старой версии (idbTs === 0) для огромной коллекции >1500 записей
      // с одинаковой длиной предпочитаем полную копию из IndexedDB (в LS описания обрезаются)
      if (idbTs === 0 && idbItems.length > 1500 && idbItems.length === lsItems.length) {
        return { items: idbItems, source: 'idb', updatedAt: lsTs };
      }
      return { items: lsItems, source: 'ls', updatedAt: lsTs };
    }

    if (idbTs > lsTs) {
      return { items: idbItems, source: 'idb', updatedAt: idbTs };
    }

    // Одинаковые timestamps (или оба 0 — миграция со старых данных без метаданных)
    if (idbTs > 0) {
      return { items: idbItems, source: 'idb', updatedAt: idbTs };
    }
    if (idbItems.length >= lsItems.length) {
      return { items: idbItems, source: 'idb', updatedAt: 0 };
    }
    return { items: lsItems, source: 'ls', updatedAt: 0 };
  }

  // Фильтрация распакованных из облачных чанков тайтлов по pendingDeletes и recentlyDeletedIds
  function filterUnpackedItemsByDeletes(itemsList, pendingDeleteIds, recentlyDeletedIds, uid) {
    const list = Array.isArray(itemsList) ? itemsList : [];
    const pendingSet = new Set(Array.isArray(pendingDeleteIds) ? pendingDeleteIds.map(String) : [...(pendingDeleteIds || [])].map(String));
    const recentSet = new Set(Array.isArray(recentlyDeletedIds) ? recentlyDeletedIds.map(String) : [...(recentlyDeletedIds || [])].map(String));
    if (!pendingSet.size && !recentSet.size) return list.slice();

    const prefix = uid ? String(uid) + '_' : '';
    return list.filter(it => {
      if (!it || it.id === undefined || it.id === null) return false;
      const idStr = String(it.id);
      const docIdStr = it._docId ? String(it._docId) : '';
      const prefixedId = prefix ? prefix + idStr : '';
      if (pendingSet.has(idStr) || (docIdStr && pendingSet.has(docIdStr)) || (prefixedId && pendingSet.has(prefixedId))) {
        return false;
      }
      if (recentSet.has(idStr) || (docIdStr && recentSet.has(docIdStr)) || (prefixedId && recentSet.has(prefixedId))) {
        return false;
      }
      return true;
    });
  }

  // Очищаем item.dirty только если тайтл не был изменён пользователем пока запрос шёл в Firestore
  function shouldClearDirtyAfterCommit(currentUpdatedAt, committedUpdatedAt) {
    const cur = Number(currentUpdatedAt || 0);
    const committed = Number(committedUpdatedAt || 0);
    return cur === committed;
  }

  // Защита legacy-коллекции на новом устройстве: если профиль не на V2-чанках, локально/серверно 0 записей,
  // но ответ пришёл из офлайн-кэша или нет сети — блокируем запись, чтобы 1 новый тайтл не перезатёр старую коллекцию
  function shouldBlockLegacyEmptyInitialSync(opts) {
    const {
      colStorageV2 = false,
      loadedCount = 0,
      fromCache = false,
      isOnline = true
    } = opts || {};
    if (colStorageV2) return false;
    if (Number(loadedCount || 0) > 0) return false;
    return Boolean(fromCache || !isOnline);
  }

  // Совместимость категорий при совпадении внешнего ID (aniId/mal/shikiId/mdId): допускаем пару Манга <-> Ранобэ
  function areCategoriesCompatibleForExternalId(catA, catB) {
    if (!catA || !catB) return false;
    if (catA === catB) return true;
    const kino = ['Фильм', 'Сериал', 'Мультфильм'];
    if ((catA === 'Мультфильм' || catB === 'Мультфильм') && kino.includes(catA) && kino.includes(catB)) {
      return true;
    }
    const readPair = ['Манга', 'Ранобэ'];
    if (readPair.includes(catA) && readPair.includes(catB)) {
      return true;
    }
    return false;
  }

  function _parseSeasonMarker(marker) {
    const parts = String(marker || '').split('_').filter(Boolean);
    let season = '';
    let part = '';
    let fmt = '';
    for (const tok of parts) {
      if (/^s\d+$/.test(tok)) season = tok;
      else if (/^p\d+$/.test(tok)) part = tok;
      else fmt = fmt ? (fmt + '_' + tok) : tok;
    }
    return { season, part, fmt };
  }

  // Проверка совместимости маркеров сезона/части/формата:
  // строго различаем разные сезоны (s2 != '' и s2 != s3) и запрещаем смешивать пустой fmt (ТВ-сериал) с непустым fmt (фильм/ova/ona/спешл)
  function areSeasonMarkersCompatible(markerA, markerB) {
    const mA = String(markerA || '');
    const mB = String(markerB || '');
    if (mA === mB) return true;
    const a = _parseSeasonMarker(mA);
    const b = _parseSeasonMarker(mB);
    if (a.season !== b.season) return false;
    if (a.fmt !== b.fmt) return false;
    if (a.part && b.part && a.part !== b.part) return false;
    return true;
  }

  // Нормализация формата (TV, TV_SHORT, MOVIE, OVA, ONA, SPECIAL) из явных полей format/type и маркеров названия
  function inferNormalizedFormat(itemOrFields) {
    if (!itemOrFields || typeof itemOrFields !== 'object') return '';
    const explicitRaw = String(itemOrFields.format || itemOrFields.type || '').trim().toUpperCase();
    const mapExplicit = s => {
      if (!s) return '';
      if (s === 'MOVIE' || s === 'FILM' || /(?:^|[^A-ZА-Я0-9])(MOVIE|FILM|THEATRICAL|GEKIJOUBAN|ФИЛЬМ|ПОЛНОМЕТРАЖ[А-Я]*)(?=$|[^A-ZА-Я0-9])/i.test(s)) return 'MOVIE';
      if (s === 'OVA' || s === 'OAD' || /(?:^|[^A-ZА-Я0-9])(OVA|OAD)(?=$|[^A-ZА-Я0-9])/i.test(s)) return 'OVA';
      if (s === 'SPECIAL' || s === 'TV_SPECIAL' || /(?:^|[^A-ZА-Я0-9])(TV\s*SPECIAL|SPECIAL|RECAP|СПЕШЛ|СПЕЦВЫПУСК[А-Я]*|РЕКАП)(?=$|[^A-ZА-Я0-9])/i.test(s)) return 'SPECIAL';
      if (s === 'ONA' || /(?:^|[^A-ZА-Я0-9])ONA(?=$|[^A-ZА-Я0-9])/i.test(s)) return 'ONA';
      if (s === 'TV_SHORT') return 'TV_SHORT';
      if (s === 'TV' || s === 'SERIES' || /(?:^|[^A-ZА-Я0-9])(TV|TV[\s_-]*SERIES|ТВ|ТВ[\s_-]*СЕРИАЛ|СЕРИАЛ)(?=$|[^A-ZА-Я0-9])/i.test(s)) return 'TV';
      return '';
    };
    const fromExplicit = mapExplicit(explicitRaw);
    if (fromExplicit) return fromExplicit;

    // Если явного format/type нет — пробуем извлечь из маркера или основных названий
    const titleBag = [
      itemOrFields.marker,
      itemOrFields.title,
      itemOrFields.titleRu,
      itemOrFields.titleEn,
      itemOrFields.en,
      itemOrFields.romaji,
      itemOrFields.titleOrig,
      itemOrFields.orig
    ].filter(Boolean).join(' ').toLowerCase().replace(/ё/g, 'е');

    if (!titleBag) return '';
    if (/(?:^|[^a-zа-я0-9])(gekijouban|theatrical|полнометраж[а-я]*|movie|фильм)(?:\s*\d{1,2})?(?=$|[^a-zа-я0-9])/i.test(titleBag)) return 'MOVIE';
    if (/(?:^|[^a-zа-я0-9])(tv\s*special|спецвыпуск[а-я]*|recap|рекап|special|спешл)(?:\s*\d{1,2})?(?=$|[^a-zа-я0-9])/i.test(titleBag)) return 'SPECIAL';
    if (/(?:^|[^a-zа-я0-9])(ova|oad)(?:\s*\d{1,2})?(?=$|[^a-zа-я0-9])/i.test(titleBag)) return 'OVA';
    if (/(?:^|[^a-zа-я0-9])ona(?:\s*\d{1,2})?(?=$|[^a-zа-я0-9])/i.test(titleBag)) return 'ONA';
    return '';
  }

  // Проверка совместимости формата (TV/TV_SHORT/ONA против MOVIE/OVA/SPECIAL) и числа серий eps
  function areFormatsAndEpisodesCompatible(a, b) {
    if (!a || !b) return false;
    const catA = String(a.category || '');
    const catB = String(b.category || '');
    const isReading = ['Манга', 'Ранобэ'].includes(catA) || ['Манга', 'Ранобэ'].includes(catB);

    const fa = inferNormalizedFormat(a);
    const fb = inferNormalizedFormat(b);
    const isSeriesFmt = f => f === 'TV' || f === 'TV_SHORT' || f === 'ONA';
    const isNonTvFmt = f => f === 'MOVIE' || f === 'OVA' || f === 'SPECIAL';

    if (fa && fb) {
      if ((isNonTvFmt(fa) && isSeriesFmt(fb)) || (isNonTvFmt(fb) && isSeriesFmt(fa))) return false;
      if (isNonTvFmt(fa) && isNonTvFmt(fb) && fa !== fb) return false;
    }

    if (!isReading) {
      const epsA = parseInt(a.eps, 10) || 0;
      const epsB = parseInt(b.eps, 10) || 0;
      if (epsA > 0 && epsB > 0) {
        if ((epsA <= 2 && epsB >= 6) || (epsB <= 2 && epsA >= 6)) return false;
      }
      // Если у одной стороны формат — фильм/OVA/спешл, а у другой формат не указан, но серий >= 6 (явно сериал) — запрещаем склейку
      if ((isNonTvFmt(fa) && !fb && epsB >= 6) || (isNonTvFmt(fb) && !fa && epsA >= 6)) {
        return false;
      }
    }
    return true;
  }

  // Единая фильтрация тайтла по выбранной категории и подкатегориям («Моя коллекция» и счётчики статусов)
  function matchesCategoryFilter(item, opts) {
    if (!item || typeof item !== 'object') return false;
    const {
      cat = 'Всё',
      kind = 'Все',
      animeSubKind = 'Все',
      videoSubKind = 'Все',
      kinoCategories = ['Фильм', 'Сериал', 'Мультфильм'],
      getMangaSubKind = null,
      getAnimeSubKind = null
    } = opts || {};

    const catMatch = cat === 'Всё'
      ? true
      : cat === 'Кино и сериалы'
        ? (kinoCategories.includes(item.category) && (videoSubKind === 'Все' || item.category === videoSubKind))
        : item.category === cat;

    if (!catMatch) return false;

    if (cat === 'Манга' && kind !== 'Все') {
      const mKind = typeof getMangaSubKind === 'function' ? getMangaSubKind(item) : (item.mangaSubKind || 'Манга');
      if (mKind !== kind) return false;
    }
    if (cat === 'Аниме' && animeSubKind !== 'Все') {
      const aKind = typeof getAnimeSubKind === 'function' ? getAnimeSubKind(item) : (item.animeSubKind || 'Сериал');
      if (aKind !== animeSubKind) return false;
    }
    return true;
  }

  // Подсчёт статусных вкладок («Все», «Смотрю/Читаю», «В планах», «Просмотрено/Прочитано», «Отложено», «Брошено», «Любимое», «Разобрать»)
  // строго в рамках выбранной категории/подкатегории
  function computeCategoryStatusCounts(itemsList, opts) {
    const list = (Array.isArray(itemsList) ? itemsList : [])
      .filter(i => i && !i.archived && matchesCategoryFilter(i, opts));

    const counts = {
      'Все': list.length,
      'Смотрю/Читаю': 0,
      'В планах': 0,
      'Просмотрено/Прочитано': 0,
      'Отложено': 0,
      'Брошено': 0,
      'Любимое': 0
    };
    let reviewCount = 0;

    for (const i of list) {
      if (i.status === 'Смотрю/Читаю' || i.status === 'Пересматриваю') counts['Смотрю/Читаю']++;
      else if (i.status === 'В планах') counts['В планах']++;
      else if (i.status === 'Просмотрено/Прочитано') counts['Просмотрено/Прочитано']++;
      else if (i.status === 'Отложено') counts['Отложено']++;
      else if (i.status === 'Брошено') counts['Брошено']++;
      if (i.fav) counts['Любимое']++;
      if (i.needsReview) reviewCount++;
    }

    return { counts, reviewCount, total: list.length };
  }

  // Проверка целостности загруженных облачных чанков (не допускаем тихую потерю части коллекции при неполном чтении)
  function validateLoadedChunks(chunkDocs, expectedCount) {
    const expected = Math.max(0, Number(expectedCount || 0));
    const list = (Array.isArray(chunkDocs) ? chunkDocs : []).filter(Boolean);
    if (expected === 0) {
      return { valid: true, missingIndices: [], expectedCount: 0, loadedCount: list.length };
    }
    const present = new Set();
    let inferredTotal = expected;
    for (const ch of list) {
      const idx = Number(ch.chunkIdx);
      const hasPayload = typeof ch.payloadJson === 'string' || Array.isArray(ch.items);
      if (Number.isInteger(idx) && idx >= 0 && hasPayload) {
        present.add(idx);
      }
      const chTotal = Number(ch.chunkTotal || 0);
      if (chTotal > inferredTotal) inferredTotal = chTotal;
    }
    const missingIndices = [];
    for (let idx = 0; idx < inferredTotal; idx++) {
      if (!present.has(idx)) missingIndices.push(idx);
    }
    return {
      valid: missingIndices.length === 0 && present.size >= inferredTotal,
      missingIndices,
      expectedCount: inferredTotal,
      loadedCount: present.size
    };
  }

  const api = {
    DEFAULT_CHUNK_MAX_BYTES,
    utf8ByteLength,
    sanitizeItemForChunk,
    packCollectionChunks,
    unpackCollectionChunks,
    shouldPullCollectionFromCloud,
    runPrimaryFirstWaterfall,
    buildCatalogCacheKey,
    createCatalogCache,
    normalizeGridSize,
    getGridSizeKey,
    getNextMobileGridSize,
    getGridSizeMobileMeta,
    isManualTitleItem,
    resolveBestTitleDescription,
    filterAndListCollections,
    canWriteCollectionChunksToCloud,
    splitChunksIntoBatches,
    splitOperationsIntoBatches,
    pickFresherLocalItems,
    filterUnpackedItemsByDeletes,
    shouldClearDirtyAfterCommit,
    shouldBlockLegacyEmptyInitialSync,
    areCategoriesCompatibleForExternalId,
    areSeasonMarkersCompatible,
    inferNormalizedFormat,
    areFormatsAndEpisodesCompatible,
    matchesCategoryFilter,
    computeCategoryStatusCounts,
    validateLoadedChunks
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.KirokuEngine = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
