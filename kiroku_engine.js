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
      'kind',
      'archived',
      '_posterInIdb',
      '_badgeInIdb'
    ]);
    for (const [k, v] of Object.entries(raw)) {
      if (skipKeys.has(k) || v === undefined) continue;
      if (v === '' || v === null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      if (v === false && (k === 'fav' || k === 'pin' || k === 'ongoing' || k === 'needsReview' || k === 'isAdult' || k === 'isManual')) continue;
      if (v === 0 && (k === 'rewatchCount' || k === 'watchedEps' || k === 'completedAt' || k === 'aniId' || k === 'mal' || k === 'eps' || k === 'vols' || k === 'dur')) continue;
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
        if (it.archived) it.archived = false;
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
      Boolean(p.finOnly),
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
      },
      allValues(now = Date.now()) {
        const out = [];
        for (const [k, hit] of store.entries()) {
          if (now - hit.t > ttlMs) {
            store.delete(k);
            continue;
          }
          if (Array.isArray(hit.v)) out.push(hit.v);
        }
        return out;
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

  const SYSTEM_MANUAL_LIST_KEY = '__sys_manual__';
  const DEFAULT_MANUAL_LIST_NAME = 'Добавлено вручную';

  const EXTERNAL_CATALOG_SOURCES = new Set([
    'anilist', 'shikimori', 'jikan', 'mangadex', 'tmdb', 'google books', 'комиксы'
  ]);
  const CATALOG_ONLY_EXT_SOURCES = new Set([
    'google books', 'комиксы'
  ]);

  function isManualTitleItem(item) {
    if (!item || typeof item !== 'object') return false;
    if (Number(item.aniId) > 0) return false;
    if (Number(item.mal) > 0) return false;
    if (Number(item.shikiId) > 0) return false;
    if (item.mdId && String(item.mdId).trim()) return false;
    if (item.tmdb && String(item.tmdb).includes('/')) return false;
    if (item.imdbId && String(item.imdbId).trim()) return false;
    if (item.isManual === true) return true;
    const rawSrcLower = String(item.src || '').trim().toLowerCase();
    if (rawSrcLower && EXTERNAL_CATALOG_SOURCES.has(rawSrcLower)) return false;
    const extSrcLower = String(item.extSrc || '').trim().toLowerCase();
    if (extSrcLower && CATALOG_ONLY_EXT_SOURCES.has(extSrcLower)) return false;
    const urlStr = String(item.url || '').trim().toLowerCase();
    if (urlStr && /(anilist\.co|shikimori\.(io|one)|myanimelist\.net|themoviedb\.org|mangadex\.org)/.test(urlStr)) {
      return false;
    }
    return true;
  }

  function resolveManualListName(profObj) {
    const raw = profObj && typeof profObj === 'object' ? profObj.manualFolderName : '';
    const clean = String(raw || '').trim();
    return clean || DEFAULT_MANUAL_LIST_NAME;
  }

  function isSystemManualListRef(val, profObj) {
    const clean = String(val || '').trim();
    if (!clean) return false;
    const low = clean.toLowerCase();
    if (low === SYSTEM_MANUAL_LIST_KEY) return true;
    return low === resolveManualListName(profObj).toLowerCase();
  }

  function stripSystemManualListFromUserLists(lists, profObj) {
    if (!Array.isArray(lists)) return [];
    const sysLow = resolveManualListName(profObj).toLowerCase();
    return lists.filter(v => {
      const low = String(v || '').trim().toLowerCase();
      return Boolean(low && low !== SYSTEM_MANUAL_LIST_KEY && low !== sysLow);
    });
  }

  function itemMatchesListFilter(item, filterVal, profObj) {
    const lf = String(filterVal || 'Все').trim();
    if (!lf || lf === 'Все' || lf.toLowerCase() === 'все') return true;
    const low = lf.toLowerCase();
    if (low === SYSTEM_MANUAL_LIST_KEY) {
      return isManualTitleItem(item);
    }
    return Array.isArray(item && item.lists)
      && item.lists.some(t => String(t || '').trim().toLowerCase() === low);
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

  function filterAndListCollections(allFolders, itemLists, query, countsMap, opts) {
    const cfg = opts && typeof opts === 'object' ? opts : null;
    const sysName = cfg && cfg.systemManualName ? String(cfg.systemManualName).trim() : '';
    const sysLow = sysName ? sysName.toLowerCase() : '';
    const sysCount = cfg ? Math.max(0, Number(cfg.systemManualCount) || 0) : 0;
    const isManualItem = Boolean(cfg && cfg.isManualItem);

    const seen = new Map();
    const addFolder = raw => {
      const name = String(raw || '').trim();
      if (!name) return;
      const key = name.toLowerCase();
      if (key === SYSTEM_MANUAL_LIST_KEY || (sysLow && key === sysLow)) return;
      if (!seen.has(key)) seen.set(key, name);
    };
    (Array.isArray(allFolders) ? allFolders : []).forEach(addFolder);
    (Array.isArray(itemLists) ? itemLists : []).forEach(addFolder);

    const itemSet = new Set(
      (Array.isArray(itemLists) ? itemLists : [])
        .map(v => String(v || '').trim().toLowerCase())
        .filter(k => k && k !== SYSTEM_MANUAL_LIST_KEY && (!sysLow || k !== sysLow))
    );

    const sorted = [...seen.values()].sort((a, b) => a.localeCompare(b, 'ru'));
    const qRaw = String(query || '').trim();
    const qLower = qRaw.toLowerCase();

    const filtered = [];
    if (sysName && (!qLower || sysLow.includes(qLower))) {
      filtered.push({
        name: sysName,
        key: SYSTEM_MANUAL_LIST_KEY,
        inList: isManualItem,
        count: sysCount,
        isSystem: true,
        locked: true
      });
    }

    sorted
      .filter(name => !qLower || name.toLowerCase().includes(qLower))
      .forEach(name => {
        const key = name.toLowerCase();
        const count = countsMap && typeof countsMap === 'object'
          ? (Number(countsMap[key]) || 0)
          : 0;
        filtered.push({
          name,
          key,
          inList: itemSet.has(key),
          count,
          isSystem: false,
          locked: false
        });
      });

    const exactExists = Boolean(qLower && (seen.has(qLower) || (sysLow && qLower === sysLow) || qLower === SYSTEM_MANUAL_LIST_KEY));
    return {
      totalCount: sorted.length + (sysName ? 1 : 0),
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

  // Восстановление вырезанных ради экономии localStorage base64-постеров и мини-значков из IndexedDB
  function hydrateStrippedBase64FromIdb(primaryItems, idbItems) {
    const src = Array.isArray(primaryItems) ? primaryItems : [];
    const idbById = new Map();
    if (Array.isArray(idbItems)) {
      for (const it of idbItems) {
        if (it && it.id !== undefined && it.id !== null) {
          idbById.set(String(it.id), it);
        }
      }
    }
    return src.map(item => {
      if (!item || typeof item !== 'object') return item;
      const needsCleanFlag = Object.prototype.hasOwnProperty.call(item, '_posterInIdb')
        || Object.prototype.hasOwnProperty.call(item, '_badgeInIdb');
      const idbMatch = (item.id !== undefined && item.id !== null) ? idbById.get(String(item.id)) : null;
      const itemTs = Number(item.updatedAt || 0);
      const idbTs = idbMatch ? Number(idbMatch.updatedAt || 0) : 0;

      const canRestorePoster = !item.poster
        && idbMatch
        && typeof idbMatch.poster === 'string'
        && idbMatch.poster.startsWith('data:')
        && (Boolean(item._posterInIdb) || itemTs <= idbTs);

      const canRestoreBadge = !item.badgeCharImg
        && idbMatch
        && typeof idbMatch.badgeCharImg === 'string'
        && idbMatch.badgeCharImg.startsWith('data:')
        && (Boolean(item._badgeInIdb) || itemTs <= idbTs);

      if (!needsCleanFlag && !canRestorePoster && !canRestoreBadge) return item;
      const copy = { ...item };
      delete copy._posterInIdb;
      delete copy._badgeInIdb;
      if (canRestorePoster) copy.poster = idbMatch.poster;
      if (canRestoreBadge) copy.badgeCharImg = idbMatch.badgeCharImg;
      return copy;
    });
  }

  // Защита загруженных с устройства base64-постеров при слиянии с облаком (не затирает свежий локальный постер пустым значением)
  function preserveLocalUploadedPostersOnCloudMerge(cloudItems, localItems) {
    const cloud = Array.isArray(cloudItems) ? cloudItems : [];
    if (!Array.isArray(localItems) || !localItems.length) return cloud;
    const localById = new Map();
    for (const it of localItems) {
      if (it && it.id !== undefined && it.id !== null) {
        localById.set(String(it.id), it);
      }
    }
    return cloud.map(cItem => {
      if (!cItem || typeof cItem !== 'object' || cItem.id === undefined || cItem.id === null) return cItem;
      const lItem = localById.get(String(cItem.id));
      if (!lItem) return cItem;
      const localTs = Number(lItem.updatedAt || 0);
      const cloudTs = Number(cItem.updatedAt || 0);
      if (localTs < cloudTs) return cItem;

      const restorePoster = !cItem.poster && typeof lItem.poster === 'string' && lItem.poster.startsWith('data:image/');
      const restoreBadge = !cItem.badgeCharImg && typeof lItem.badgeCharImg === 'string' && lItem.badgeCharImg.startsWith('data:image/');
      if (!restorePoster && !restoreBadge) return cItem;
      const merged = { ...cItem };
      if (restorePoster) merged.poster = lItem.poster;
      if (restoreBadge) merged.badgeCharImg = lItem.badgeCharImg;
      return merged;
    });
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
    if (!hasIdb && hasLs) return { items: hydrateStrippedBase64FromIdb(lsItems, []), source: 'ls', updatedAt: Number(lsUpdatedAt) || 0 };

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
      return { items: hydrateStrippedBase64FromIdb(lsItems, idbItems), source: 'ls', updatedAt: lsTs };
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
    return { items: hydrateStrippedBase64FromIdb(lsItems, idbItems), source: 'ls', updatedAt: 0 };
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
  // строго различаем разные сезоны (s2 != '' и s2 != s3) и запрещаем смешивать ТВ-сериал с фильмом/ova/спешлом
  // (маркер ona совместим с пустым ТВ-маркером, так как AniList и Shikimori часто по-разному помечают веб-сериалы)
  function areSeasonMarkersCompatible(markerA, markerB) {
    const mA = String(markerA || '');
    const mB = String(markerB || '');
    if (mA === mB) return true;
    const a = _parseSeasonMarker(mA);
    const b = _parseSeasonMarker(mB);
    if (a.season !== b.season) return false;
    const normFmt = f => (f === 'ona' ? '' : f);
    if (normFmt(a.fmt) !== normFmt(b.fmt)) return false;
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

  // Проверка, можно ли считать форматы совместимыми для склейки дублей (в т.ч. TV vs ONA и ошибочно помеченная OVA с >= 6 сериями)
  function areFormatsCompatibleForAlts(fa, fb, epsA = 0, epsB = 0, isReading = false) {
    const a = String(fa || '').toUpperCase();
    const b = String(fb || '').toUpperCase();
    if (!a || !b) return true;
    if (a === b) return true;
    const isSeriesFmt = f => f === 'TV' || f === 'TV_SHORT' || f === 'ONA';
    if (isSeriesFmt(a) && isSeriesFmt(b)) return true;
    if (!isReading) {
      const eA = parseInt(epsA, 10) || 0;
      const eB = parseInt(epsB, 10) || 0;
      const ovaVsSeries = (a === 'OVA' && isSeriesFmt(b)) || (b === 'OVA' && isSeriesFmt(a));
      if (ovaVsSeries && eA >= 6 && eB >= 6 && Math.abs(eA - eB) <= 2) return true;
    }
    return false;
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
    const epsA = parseInt(a.eps, 10) || 0;
    const epsB = parseInt(b.eps, 10) || 0;
    const mislabeledMultiEpOva = !isReading
      && ((fa === 'OVA' && isSeriesFmt(fb)) || (fb === 'OVA' && isSeriesFmt(fa)))
      && epsA >= 6 && epsB >= 6 && Math.abs(epsA - epsB) <= 2;

    if (fa && fb) {
      if (!mislabeledMultiEpOva && ((isNonTvFmt(fa) && isSeriesFmt(fb)) || (isNonTvFmt(fb) && isSeriesFmt(fa)))) return false;
      if (isNonTvFmt(fa) && isNonTvFmt(fb) && fa !== fb) return false;
    }

    if (!isReading) {
      if (epsA > 0 && epsB > 0) {
        if ((epsA <= 2 && epsB >= 6) || (epsB <= 2 && epsA >= 6)) return false;
      }
      // Если у одной стороны формат — фильм/OVA/спешл, а у другой формат не указан, но серий >= 6 (явно сериал) — запрещаем склейку
      // Исключение: если у самой OVA тоже >= 6 совпадающих серий (ошибочно помеченный сериал)
      const ovaWithSameMultiEps = ((fa === 'OVA' && !fb) || (fb === 'OVA' && !fa))
        && epsA >= 6 && epsB >= 6 && Math.abs(epsA - epsB) <= 2;
      if (!ovaWithSameMultiEps && ((isNonTvFmt(fa) && !fb && epsB >= 6) || (isNonTvFmt(fb) && !fa && epsA >= 6))) {
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
      .filter(i => i && matchesCategoryFilter(i, opts));

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

  // --- Умный трекер прогресса серий / глав ---
  function isTrackableProgressItem(item) {
    if (!item || typeof item !== 'object') return false;
    const catName = String(item.category || '').trim();
    if (catName === 'Фильм') return false;
    if (catName === 'Манга' || catName === 'Ранобэ' || catName === 'Сериал') return true;
    if (catName === 'Аниме') {
      const fmt = String(item.format || '').trim().toUpperCase();
      if (fmt === 'MOVIE') return false;
      const epsVal = Number(item.eps) || 0;
      const durVal = Number(item.dur) || 0;
      if (epsVal === 1 && durVal >= 50 && fmt !== 'TV' && !item.ongoing) return false;
      return true;
    }
    return false;
  }

  function getProgressUnit(item) {
    const catName = String(item?.category || '').trim();
    return (catName === 'Манга' || catName === 'Ранобэ') ? 'гл.' : 'эп.';
  }

  function isProgressLocked(item) {
    if (!item || typeof item !== 'object') return false;
    return item.status === 'Просмотрено/Прочитано';
  }

  function clampWatchedEps(val, totalEps) {
    const clean = Math.max(0, Math.floor(Number(val) || 0));
    const maxTotal = Math.max(0, Math.floor(Number(totalEps) || 0));
    if (maxTotal > 0) return Math.min(clean, maxTotal);
    return Math.min(clean, 99999);
  }

  function normalizeItemProgress(item) {
    if (!item || typeof item !== 'object') return 0;
    const total = Math.max(0, Math.floor(Number(item.eps) || 0));
    let cur = clampWatchedEps(item.watchedEps, total);
    if (item.status === 'Просмотрено/Прочитано' && total > 0 && cur < total) {
      cur = total;
    }
    item.watchedEps = cur;
    return cur;
  }

  function applyStatusProgressTransition(item, newStatus) {
    if (!item || typeof item !== 'object') return 0;
    const total = Math.max(0, Math.floor(Number(item.eps) || 0));
    let next = clampWatchedEps(item.watchedEps, total);
    if (newStatus === 'Просмотрено/Прочитано' && total > 0) {
      next = total;
    }
    item.watchedEps = next;
    return next;
  }

  function setWatchedEps(item, nextValue) {
    if (!item || typeof item !== 'object') return { changed: false, locked: false, value: 0, reachedTotal: false };
    if (isProgressLocked(item)) {
      const cur = normalizeItemProgress(item);
      return { changed: false, locked: true, value: cur, reachedTotal: false };
    }
    const total = Math.max(0, Math.floor(Number(item.eps) || 0));
    const prev = clampWatchedEps(item.watchedEps, total);
    const next = clampWatchedEps(nextValue, total);
    item.watchedEps = next;
    return {
      changed: next !== prev,
      locked: false,
      value: next,
      reachedTotal: total > 0 && next >= total && prev < total
    };
  }

  function stepWatchedEps(item, delta) {
    if (!item || typeof item !== 'object') return { changed: false, locked: false, value: 0, reachedTotal: false };
    const prev = Math.max(0, Math.floor(Number(item.watchedEps) || 0));
    return setWatchedEps(item, prev + (Number(delta) || 0));
  }

  // Безопасный расчёт быстрого шага прогресса прямо с карточки (защита от случайного двойного тапа и выход за границы)
  function computeCardProgressAction(item, delta, nowMs = Date.now(), lastTapMs = 0, cooldownMs = 320) {
    const step = Math.trunc(Number(delta) || 0);
    if (!item || typeof item !== 'object' || step === 0) {
      return {
        allowed: false,
        throttled: false,
        locked: false,
        changed: false,
        prev: 0,
        next: 0,
        total: 0,
        pct: 0,
        reachedTotal: false,
        canComplete: false
      };
    }
    const locked = isProgressLocked(item);
    const total = Math.max(0, Math.floor(Number(item.eps) || 0));
    const prev = clampWatchedEps(item.watchedEps, total);
    const pctPrev = total > 0 ? Math.min(100, Math.max(0, Math.round((Math.min(prev, total) / total) * 100))) : 0;

    if (locked) {
      return {
        allowed: false,
        throttled: false,
        locked: true,
        changed: false,
        prev,
        next: prev,
        total,
        pct: pctPrev,
        reachedTotal: false,
        canComplete: false
      };
    }

    const cd = Math.max(0, Number(cooldownMs) || 0);
    const now = Number(nowMs) || 0;
    const prevTap = Number(lastTapMs) || 0;
    if (cd > 0 && prevTap > 0 && now >= prevTap && (now - prevTap) < cd) {
      return {
        allowed: false,
        throttled: true,
        locked: false,
        changed: false,
        prev,
        next: prev,
        total,
        pct: pctPrev,
        reachedTotal: false,
        canComplete: total > 0 && prev >= total
      };
    }

    const next = clampWatchedEps(prev + step, total);
    const changed = next !== prev;
    const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((Math.min(next, total) / total) * 100))) : 0;
    const reachedTotal = total > 0 && next >= total && prev < total;
    const canComplete = total > 0 && next >= total;

    return {
      allowed: changed,
      throttled: false,
      locked: false,
      changed,
      prev,
      next,
      total,
      pct,
      reachedTotal,
      canComplete
    };
  }

  // Перевод тайтла в «Просмотрено/Прочитано» с сохранением снимка для мгновенной отмены (Undo)
  function completeItemFromProgress(item, nowMs = Date.now()) {
    if (!item || typeof item !== 'object') {
      return { changed: false, snapshot: null };
    }
    const total = Math.max(0, Math.floor(Number(item.eps) || 0));
    const prevStatus = item.status || 'В планах';
    const prevCompletedAt = item.completedAt || null;
    const prevWatchedEps = Math.max(0, Math.floor(Number(item.watchedEps) || 0));
    if (prevStatus === 'Просмотрено/Прочитано') {
      return {
        changed: false,
        snapshot: { prevStatus, prevCompletedAt, prevWatchedEps }
      };
    }
    const ts = Number(nowMs) || Date.now();
    item.status = 'Просмотрено/Прочитано';
    if (!item.completedAt) item.completedAt = ts;
    if (total > 0) item.watchedEps = total;
    return {
      changed: true,
      snapshot: { prevStatus, prevCompletedAt, prevWatchedEps }
    };
  }

  function restoreItemProgressSnapshot(item, snapshot) {
    if (!item || typeof item !== 'object' || !snapshot || typeof snapshot !== 'object') return false;
    if (typeof snapshot.prevStatus === 'string') item.status = snapshot.prevStatus;
    if ('prevCompletedAt' in snapshot) {
      if (snapshot.prevCompletedAt) item.completedAt = snapshot.prevCompletedAt;
      else delete item.completedAt;
    }
    if (typeof snapshot.prevWatchedEps === 'number') {
      item.watchedEps = Math.max(0, Math.floor(snapshot.prevWatchedEps));
    }
    return true;
  }

  // Сбор активных фильтров «Моей коллекции» для чипов, счётчика на «Дополнительно» и быстрого сброса (Идея №4)
  function collectCollectionActiveFilters(state) {
    const s = state && typeof state === 'object' ? state : {};
    const filters = [];
    const q = String(s.searchQuery || '').trim();
    const cat = String(s.cat || 'Всё').trim() || 'Всё';
    const kind = String(s.kind || 'Все').trim() || 'Все';
    const animeSubKind = String(s.animeSubKind || 'Все').trim() || 'Все';
    const videoSubKind = String(s.videoSubKind || 'Все').trim() || 'Все';
    const status = String(s.status || 'Все').trim() || 'Все';
    const tagValue = String(s.tagValue || 'Все').trim() || 'Все';
    const tagLabel = String(s.tagLabel || tagValue).trim();
    const listValue = String(s.listValue || 'Все').trim() || 'Все';
    const listLabel = String(s.listLabel || listValue).trim();
    const ongOnly = Boolean(s.ongOnly);
    const finOnly = Boolean(s.finOnly);
    const xf = s.xf && typeof s.xf === 'object' && s.xf.v ? s.xf : null;

    if (q) filters.push({ key: 'search', label: `🔍 «${q}»` });
    if (cat !== 'Всё' && cat !== 'Все') {
      const catDisplay = cat === 'Кино и сериалы' ? 'Фильмы и сериалы' : cat;
      filters.push({ key: 'cat', label: `Категория: ${catDisplay}` });
    }
    if (cat === 'Манга' && kind !== 'Все') {
      filters.push({ key: 'kind', label: `Вид: ${kind}` });
    }
    if (cat === 'Аниме' && animeSubKind !== 'Все') {
      filters.push({ key: 'animeSubKind', label: `Вид: ${animeSubKind === 'Сериал' ? 'Аниме-сериалы' : animeSubKind === 'Фильм' ? 'Аниме-фильмы' : animeSubKind}` });
    }
    if (cat === 'Кино и сериалы' && videoSubKind !== 'Все') {
      filters.push({ key: 'videoSubKind', label: `Вид: ${videoSubKind === 'Фильм' ? 'Фильмы' : videoSubKind === 'Сериал' ? 'Сериалы' : videoSubKind}` });
    }
    if (status !== 'Все') {
      const stLabel = getStatusLabelForCategory(status, cat);
      filters.push({ key: 'status', label: stLabel });
    }
    if (ongOnly) filters.push({ key: 'ongOnly', label: 'Онгоинг' });
    if (finOnly) filters.push({ key: 'finOnly', label: 'Завершено' });
    if (tagValue !== 'Все') {
      filters.push({ key: 'tag', label: `Жанр: ${tagLabel}` });
    }
    if (listValue !== 'Все') {
      filters.push({ key: 'list', label: listLabel });
    }
    if (xf) {
      const prefix = { author: 'Автор', studio: 'Студия', source: 'Источник' }[xf.k] || 'Фильтр';
      filters.push({ key: 'xf', label: `${prefix}: ${xf.v}` });
    }

    let moreCount = 0;
    if (ongOnly || finOnly) moreCount++;
    if (tagValue !== 'Все') moreCount++;
    if (listValue !== 'Все') moreCount++;

    return {
      filters,
      moreCount,
      totalCount: filters.length,
      hasAny: filters.length > 0,
      showResetAll: filters.length >= 2
    };
  }

  // Ограниченная ступенчатая задержка появления карточек (плавная волна без тормозов на больших списках)
  function computeCardStaggerDelayMs(index, stepMs = 18, maxIndex = 12) {
    const rawIdx = Math.floor(Number(index));
    if (!Number.isFinite(rawIdx) || rawIdx <= 0) return 0;
    const step = Math.max(0, Number(stepMs) || 0);
    const cap = Math.max(0, Math.floor(Number(maxIndex) || 0));
    return Math.min(rawIdx, cap) * step;
  }


  // --- Защита от серверного бага Shikimori GraphQL (манга с Сёдзё-ай/Юри приходит с единственным жанром Yaoi id=65) ---
  function isShikimoriSuspiciousYaoiOnlyGenres(genres, isAnime = false) {
    if (isAnime || !Array.isArray(genres) || genres.length !== 1) return false;
    const g = genres[0];
    if (!g || typeof g !== 'object') return false;
    const idStr = String(g.id ?? '').trim();
    const nameLower = String(g.name || '').trim().toLowerCase();
    const ruLower = String(g.russian || '').trim().toLowerCase();
    return idStr === '65' || nameLower === 'yaoi' || ruLower === 'яой';
  }

  function sanitizeSuspiciousShikiTags(existingTags, trustedTags) {
    const trusted = (Array.isArray(trustedTags) ? trustedTags : [])
      .map(s => String(s || '').trim())
      .filter(Boolean);
    if (!trusted.length) return Array.isArray(existingTags) ? existingTags.slice() : [];
    const seen = new Set();
    const out = [];
    for (const t of trusted) {
      const k = t.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(t);
      }
    }
    return out;
  }

  // --- Кросс-матчинг японского аниме из TMDB (Фильмы/Сериалы) с категорией «Аниме» для исключения дубликатов ---
  function extractCjkCore(str) {
    if (!str) return '';
    const matches = String(str).match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g);
    return matches ? matches.join('') : '';
  }

  function isTmdbJapaneseAnime(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.isTmdbAnime === true) return true;
    const cat = String(item.category || '');
    if (cat !== 'Фильм' && cat !== 'Сериал' && cat !== 'Мультфильм') return false;
    const genreIds = Array.isArray(item.tmdbGenreIds) ? item.tmdbGenreIds.map(Number) : [];
    const tagsLower = (Array.isArray(item.tags) ? item.tags : []).map(t => String(t || '').toLowerCase());
    const hasAnim = genreIds.includes(16) || tagsLower.includes('мультфильм') || tagsLower.includes('animation') || tagsLower.includes('аниме');
    if (!hasAnim) return false;
    const lang = String(item.origLang || item.originalLanguage || '').toLowerCase().trim();
    const countries = Array.isArray(item.originCountry) ? item.originCountry.map(c => String(c || '').toUpperCase()).filter(Boolean) : [];
    const countriesStr = String(item.countries || '');
    if (lang === 'ja' || countries.includes('JP') || /япони|japan/i.test(countriesStr)) return true;
    // Если язык или страна явно указаны и это НЕ Япония (например, Китай/Корея/США) — не путаем с японским аниме
    if (lang && lang !== 'ja') return false;
    if (countries.length > 0 && !countries.includes('JP')) return false;
    if (countriesStr && /китай|china|коре|korea|сша|usa|росси|франц|великобрит/i.test(countriesStr)) return false;
    const origTitle = String(item.orig || item.titleOrig || '');
    // Хирагана/катакана — гарантированно японский; чистые иероглифы (напр. 呪術廻戦, 銀魂) при наличии жанра «Мультфильм» и без чужой страны — тоже аниме
    if (/[\u3040-\u30ff]/.test(origTitle)) return true;
    if (!/[\uac00-\ud7af]/.test(origTitle) && /[\u4e00-\u9fff]{2,}/.test(origTitle)) return true;
    return false;
  }

  function areCategoriesCrossCompatibleForTmdbAnime(a, b) {
    if (!a || !b) return false;
    const catA = String(a.category || '');
    const catB = String(b.category || '');
    const pairCheck = (animeItem, kinoItem) => {
      if (String(animeItem.category || '') !== 'Аниме') return false;
      const kCat = String(kinoItem.category || '');
      if (kCat !== 'Фильм' && kCat !== 'Сериал' && kCat !== 'Мультфильм') return false;
      if (!isTmdbJapaneseAnime(kinoItem)) return false;
      const aFmt = inferNormalizedFormat(animeItem);
      const isAnimeMovie = aFmt === 'MOVIE';
      if (kCat === 'Фильм' && aFmt && !isAnimeMovie && (Number(animeItem.eps) || 0) > 2) return false;
      if (kCat === 'Сериал' && isAnimeMovie) return false;
      return true;
    };
    return pairCheck(a, b) || pairCheck(b, a);
  }

  // --- Компактный трекер сезонов и серий (статистика хранит и считает только суммарные watchedEps) ---
  function normalizeSeasonsMeta(seasonsMeta, totalEps = 0, seasonsCount = 0) {
    if (Array.isArray(seasonsMeta) && seasonsMeta.length) {
      const byNum = new Map();
      for (const s of seasonsMeta) {
        if (!s || typeof s !== 'object') continue;
        const n = Math.floor(Number(s.n ?? s.season_number ?? s.season) || 0);
        const eps = Math.floor(Number(s.eps ?? s.episode_count ?? s.episodes) || 0);
        if (n > 0 && eps > 0) {
          byNum.set(n, { n, eps });
        }
      }
      const list = [...byNum.values()].sort((a, b) => a.n - b.n);
      if (list.length) return list;
    }
    const sc = Math.floor(Number(seasonsCount) || 0);
    const tot = Math.floor(Number(totalEps) || 0);
    if (sc > 1 && tot >= sc) {
      const base = Math.floor(tot / sc);
      let rem = tot - base * sc;
      const out = [];
      for (let idx = 1; idx <= sc; idx++) {
        const extra = rem > 0 ? 1 : 0;
        if (rem > 0) rem--;
        out.push({ n: idx, eps: base + extra });
      }
      return out;
    }
    return [];
  }

  function watchedEpsToSeasonEp(watchedEps, seasonsMeta) {
    const list = normalizeSeasonsMeta(seasonsMeta);
    const total = list.reduce((sum, s) => sum + s.eps, 0);
    const w = Math.max(0, Math.floor(Number(watchedEps) || 0));
    if (!list.length) {
      return { season: 1, ep: w, seasonTotal: 0, totalEps: 0, watchedEps: w };
    }
    if (w <= 0) {
      return { season: list[0].n, ep: 0, seasonTotal: list[0].eps, totalEps: total, watchedEps: 0 };
    }
    const clamped = Math.min(w, total);
    let acc = 0;
    for (const s of list) {
      if (clamped <= acc + s.eps) {
        return {
          season: s.n,
          ep: clamped - acc,
          seasonTotal: s.eps,
          totalEps: total,
          watchedEps: clamped
        };
      }
      acc += s.eps;
    }
    const last = list[list.length - 1];
    return { season: last.n, ep: last.eps, seasonTotal: last.eps, totalEps: total, watchedEps: total };
  }

  function seasonEpToWatchedEps(seasonNum, epInSeason, seasonsMeta) {
    const list = normalizeSeasonsMeta(seasonsMeta);
    if (!list.length) return Math.max(0, Math.floor(Number(epInSeason) || 0));
    const targetN = Math.floor(Number(seasonNum) || list[0].n);
    let offset = 0;
    let targetSeason = list[0];
    for (const s of list) {
      if (s.n === targetN) {
        targetSeason = s;
        break;
      }
      if (s.n < targetN) offset += s.eps;
    }
    const cleanEp = Math.max(0, Math.min(targetSeason.eps, Math.floor(Number(epInSeason) || 0)));
    return offset + cleanEp;
  }

  // --- Точная фильтрация авторов/режиссёров и их работ (исключаем второстепенные титры и неверные совпадения) ---
  function _normPersonNameTokens(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[.,/\\()[\]"'`«»\-–—:]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);
  }

  function isCreatorNameMatch(queryName, candidateNames) {
    const qToks = _normPersonNameTokens(queryName);
    if (!qToks.length) return false;
    const qFlat = qToks.join(' ');
    const qSorted = [...qToks].sort().join(' ');
    const cands = (Array.isArray(candidateNames) ? candidateNames : [candidateNames]).filter(Boolean);
    for (const cand of cands) {
      const cToks = _normPersonNameTokens(cand);
      if (!cToks.length) continue;
      const cFlat = cToks.join(' ');
      if (cFlat === qFlat) return true;
      if (cToks.length === qToks.length && [...cToks].sort().join(' ') === qSorted) return true;
      if (qToks.length >= 2 && cToks.length >= 2) {
        const shorter = qToks.length <= cToks.length ? qToks : cToks;
        const longerSet = new Set(qToks.length <= cToks.length ? cToks : qToks);
        if (shorter.every(t => longerSet.has(t))) return true;
      }
    }
    return false;
  }

  // Уровень значимости роли создателя:
  // 3 — автор оригинала / сюжет (высший приоритет), 2 — главный режиссёр / художник манги / сценарист,
  // 1 — прочая неуточнённая роль, 0 — техническая/эпизодическая роль (раскадровка, реж. эпизодов, звукорежиссёр, озвучка и т.д.)
  function getCreatorRoleTier(roleStr, isAnime = false) {
    const raw = String(roleStr || '').trim();
    if (!raw) return 1;
    // Убираем пояснения в скобках вроде "(eps 1-12)" или "(chs 52-81)" для проверки основной роли
    const r = raw.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().replace(/ё/g, 'е');
    if (!r) return 1;

    // 1. Сначала проверяем явные авторские/создательские роли (высший приоритет — Tier 3)
    if (/(?:^|[^a-zа-я])(original creator|original story|original work|original concept|original manga|original novel|story\s*&\s*art|story and art|author|creator|автор оригинала|сюжет и иллюстрац[а-я]*|автор идеи|автор манги|автор ранобэ|создатель)(?=$|[^a-zа-я])/i.test(r)) {
      return 3;
    }
    if (r === 'story' || r === 'сюжет' || r === 'автор' || r === 'mangaka' || r === 'мангака') {
      return 3;
    }

    // 2. Явно отсекаем технические, эпизодические и актёрские/озвучивающие роли (Tier 0)
    if (/(?:episode director|assistant director|art director|sound director|audio director|animation director|chief animation director|cg director|3d director|cgi director|photography director|director of photography|unit director|action director|mechanical director|color director|casting director|voice director|music director|technical director|storyboard|key animation|in-between|2nd key|character design|prop design|mecha design|color design|background art|theme song|insert song|opening|ending|special thanks|guest|planning|producer|executive producer|voice|actor|actress|cast|seiyuu|music|composer|editing|editor|раскадровк|режиссер эпизод|помощник режиссер|ассистент режиссер|звукорежиссер|художник-постановщик|режиссер анимац|главный режиссер анимац|оператор|дизайн персонаж|ключевая анимац|промежуточная анимац|продюсер|композитор|музык|монтаж|исполнен|песн|озвуч|сэйю|актер|актрис|благодарност|планирован|супервайзер|supervisor)/i.test(r)) {
      return 0;
    }

    // 3. Главный режиссёр, художник манги, сценарист, шоураннер (Tier 2)
    if (/(?:^|[^a-zа-я])(chief director|series director|supervising director|general director|director|showrunner|series composition|screenplay|writer|art|illustration|illustrator|режиссер|главный режиссер|постановщик|шоураннер|компоновка серий|сценарий|сценарист|рисовка|иллюстрац[а-я]*|художник)(?=$|[^a-zа-я])/i.test(r)) {
      // В аниме слово "art" без "story & art" чаще относится к фоновой графике, а не автору
      if (isAnime && /^(art|художник|рисовка|иллюстрац[а-я]*)$/i.test(r)) return 0;
      return 2;
    }

    return 1;
  }

  function pickPrimaryAuthorsFromStaff(staffList, isAnime = false, maxCount = 2) {
    const list = Array.isArray(staffList) ? staffList : [];
    const byName = new Map();
    for (let idx = 0; idx < list.length; idx++) {
      const entry = list[idx];
      if (!entry) continue;
      const name = String(entry.name || '').trim();
      if (!name) continue;
      const tier = getCreatorRoleTier(entry.role, isAnime);
      const prev = byName.get(name);
      if (!prev || tier > prev.tier) {
        byName.set(name, { name, tier, idx: prev ? prev.idx : idx });
      }
    }
    const all = [...byName.values()];
    if (!all.length) return [];
    const primary = all.filter(x => x.tier >= 2);
    const pool = primary.length ? primary : all.filter(x => x.tier >= 1);
    const finalPool = pool.length ? pool : all;
    finalPool.sort((a, b) => (b.tier - a.tier) || (a.idx - b.idx));
    return finalPool.slice(0, Math.max(1, Number(maxCount) || 2)).map(x => x.name);
  }

  function filterAndDedupCreatorWorks(entries, opts = {}) {
    const list = Array.isArray(entries) ? entries : [];
    const limit = Math.max(1, Number(opts.limit) || 24);
    const byKey = new Map();

    for (let idx = 0; idx < list.length; idx++) {
      const e = list[idx];
      if (!e || !e.item) continue;
      const idKey = String(e.idKey || idx);
      const isAnimeItem = typeof e.isAnime === 'boolean' ? e.isAnime : (e.item.category === 'Аниме');
      const tier = typeof e.tier === 'number' ? e.tier : getCreatorRoleTier(e.role, isAnimeItem);
      const pop = Number(e.popularity) || Number(e.score) || 0;
      const prev = byKey.get(idKey);
      if (!prev) {
        byKey.set(idKey, { idKey, item: e.item, tier, pop, idx });
      } else {
        if (tier > prev.tier) prev.tier = tier;
        if (pop > prev.pop) prev.pop = pop;
      }
    }

    const deduped = [...byKey.values()];
    if (!deduped.length) return [];

    // Предпочитаем только работы, где человек — реальный автор/режиссёр/сценарист (tier >= 2).
    // Если таких работ нет вообще (например, кликнули по актёру/композитору), мягко показываем остальные.
    const primary = deduped.filter(x => x.tier >= 2);
    const pool = primary.length ? primary : deduped;
    pool.sort((a, b) => (b.tier - a.tier) || (b.pop - a.pop) || (a.idx - b.idx));
    return pool.slice(0, limit).map(x => x.item);
  }

  const MANGA_SUBKIND_SET = new Set(['Манга', 'Манхва', 'Маньхуа', 'Комикс', 'Додзинси']);

  // Корректная подпись формата/типа для карточек каталога, коллекции и страницы тайтла:
  // Манхва, Маньхуа, Комикс и Додзинси имеют приоритет над общим FORMAT_RU['MANGA'] («Манга»).
  function resolveDisplayFormatLabel(item, formatRuMap = null) {
    if (!item || typeof item !== 'object') return '';
    const sub = (item.subKind && MANGA_SUBKIND_SET.has(item.subKind))
      ? item.subKind
      : ((item.kind && MANGA_SUBKIND_SET.has(item.kind)) ? item.kind : '');
    if (item.category === 'Манга' && sub && sub !== 'Манга') {
      return sub;
    }
    const fmt = String(item.format || '').trim();
    if (fmt === 'DOUJIN') return 'Додзинси';
    if (fmt && formatRuMap && formatRuMap[fmt]) {
      return formatRuMap[fmt];
    }
    if (item.category === 'Манга') return sub || 'Манга';
    return item.category || '';
  }

  // Режим возрастного фильтра: '' (по умолчанию) = показывать всё (вкл. 18+), 'no' = без 18+, 'only' = только 18+.
  function resolveAdultFilterFlag(ageMode) {
    const v = String(ageMode || '').trim().toLowerCase();
    if (v === 'only') return true;
    if (v === 'no') return false;
    return undefined;
  }

  function matchesAdultFilter(item, ageMode) {
    const v = String(ageMode || '').trim().toLowerCase();
    if (!v || v === 'all') return true;
    if (!item || typeof item !== 'object') return false;
    const rawGenres = Array.isArray(item.rawGenres) ? item.rawGenres : [];
    const tags = Array.isArray(item.tags) ? item.tags : [];
    const isAdultOrHentai = Boolean(
      item.isAdult ||
      rawGenres.includes('Hentai') ||
      tags.some(t => /хентай|hentai/i.test(String(t || '')))
    );
    if (v === 'no') return !isAdultOrHentai;
    if (v === 'only') return isAdultOrHentai;
    return true;
  }

  // --- Расчёт времени просмотра/чтения (включая онгоинги: на момент последней вышедшей серии/главы + запланированный итог) ---
  function formatDurationMinsRu(totalMins) {
    const mins = Math.max(0, Math.round(Number(totalMins) || 0));
    if (mins <= 0) return '0 мин';
    if (mins < 60) return `${mins} мин`;
    const totalHours = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (totalHours < 48) {
      return remMins > 0 ? `${totalHours} ч ${remMins} мин` : `${totalHours} ч`;
    }
    const days = Math.floor(totalHours / 24);
    const remHours = totalHours % 24;
    return remHours > 0 ? `${days} дн ${remHours} ч` : `${days} дн`;
  }

  function formatOngoingDurationSummary(item, mediaMeta = null) {
    const it = item || {};
    const meta = mediaMeta || {};
    const cat = String(it.category || '');
    const fmt = String(it.format || meta.format || '').toUpperCase();
    const isRead = cat === 'Манга' || cat === 'Ранобэ' || fmt === 'MANGA' || fmt === 'NOVEL' || fmt === 'ONE_SHOT';
    const relStr = String(meta.status || it.releaseStatus || '').toLowerCase();
    const isOngoing = Boolean(
      it.ongoing ||
      relStr === 'releasing' ||
      relStr === 'ongoing' ||
      relStr === 'returning series' ||
      relStr === 'in production'
    );
    const watched = Math.max(0, Math.floor(Number(it.watchedEps) || 0));
    const showWatchedProgress = watched > 0 && it.status && it.status !== 'Просмотрено/Прочитано' && cat !== 'Фильм' && fmt !== 'MOVIE';

    if (isRead) {
      const airedCh = Math.max(0, Math.floor(Number(meta.releasedChapters || meta.chaptersAired || it.airedEps) || 0));
      const rawTotalCh = Math.max(0, Math.floor(Number(meta.chapters || it.eps) || 0));
      const vols = Math.max(0, Math.floor(Number(meta.volumes || it.vols) || 0));
      const plannedCh = rawTotalCh > 0 ? rawTotalCh : 0;

      let airedCount = airedCh;
      let knownPlanned = 0;
      if (isOngoing) {
        if (airedCh > 0 && plannedCh > airedCh) {
          knownPlanned = plannedCh;
        } else if (airedCh === 0 && plannedCh > 0) {
          airedCount = plannedCh;
        }
      } else {
        airedCount = plannedCh || airedCh;
        knownPlanned = plannedCh;
      }

      const episodesLabel = isOngoing && airedCh > 0 && knownPlanned > airedCh
        ? `вышло ${airedCh} из ${knownPlanned} гл. · ${vols || '?'} т.`
        : `${airedCount || plannedCh || '?'} гл. · ${vols || '?'} т.`;

      return {
        isOngoing,
        isRead: true,
        airedCount,
        plannedCount: knownPlanned,
        airedMinutes: 0,
        plannedMinutes: 0,
        perUnitMin: 0,
        episodesLabel,
        durationLabel: '',
        shortBadge: ''
      };
    }

    // Фильмы / Сериалы / Аниме
    const rawDur = Math.max(0, Math.round(Number(meta.duration || it.dur) || 0));
    const perUnitMin = rawDur || (cat === 'Аниме' ? 24 : cat === 'Сериал' ? 45 : cat === 'Фильм' ? 110 : 0);
    const nextEpNum = Number(meta.nextAiringEpisode?.episode) || 0;
    const airedFromMeta = Math.max(0, Math.floor(Number(meta.episodesAired) || (nextEpNum > 1 ? nextEpNum - 1 : 0)));
    const airedCount = airedFromMeta || Math.max(0, Math.floor(Number(it.airedEps) || 0));
    const metaTotalEps = Math.max(0, Math.floor(Number(meta.episodes) || 0));
    const itemTotalEps = Math.max(0, Math.floor(Number(it.eps) || 0));
    const seasons = Math.max(0, Math.floor(Number(meta.seasons || it.seasons) || 0));

    // Если Shikimori/TMDB прислал только вышедшие серии без общего плана (meta.episodes === 0), не принимаем airedCount за финал
    let plannedCount = metaTotalEps > 0
      ? metaTotalEps
      : (airedCount > 0 && itemTotalEps === airedCount && isOngoing ? 0 : itemTotalEps);
    if (plannedCount > 0 && airedCount > plannedCount) {
      plannedCount = 0;
    }

    if (!isOngoing) {
      const totalEps = plannedCount || airedCount;
      const totalMins = cat === 'Фильм' || fmt === 'MOVIE'
        ? perUnitMin
        : (totalEps > 0 ? totalEps * perUnitMin : perUnitMin);
      const base = rawDur > 0 && cat !== 'Фильм' && fmt !== 'MOVIE' && totalEps > 1
        ? `${rawDur} мин. (${formatDurationMinsRu(totalMins)} всего)`
        : (totalMins > 0 ? formatDurationMinsRu(totalMins) : 'Не указано');
      const durationLabel = (showWatchedProgress && perUnitMin > 0)
        ? `${base} · просмотрено ${formatDurationMinsRu(watched * perUnitMin)}`
        : base;
      let episodesLabel = 'Не указано';
      if (cat === 'Фильм' || fmt === 'MOVIE') episodesLabel = 'Полнометражный фильм';
      else if (totalEps > 0 && seasons > 1) episodesLabel = `${totalEps} эп. (${seasons} сез.)`;
      else if (totalEps > 0) episodesLabel = `${totalEps} эп.`;
      else if (seasons > 1) episodesLabel = `${seasons} сез.`;
      return {
        isOngoing: false,
        isRead: false,
        airedCount: totalEps,
        plannedCount: totalEps,
        airedMinutes: totalMins,
        plannedMinutes: totalMins,
        perUnitMin,
        episodesLabel,
        durationLabel,
        shortBadge: ''
      };
    }

    // Онгоинг (Аниме / Сериал)
    const effectiveAired = airedCount > 0 ? airedCount : (cat === 'Сериал' && plannedCount > 0 ? plannedCount : 0);
    const hasDistinctPlanned = plannedCount > 0 && (effectiveAired === 0 || plannedCount > effectiveAired);
    const airedMinutes = effectiveAired > 0 && perUnitMin > 0 ? effectiveAired * perUnitMin : 0;
    const plannedMinutes = plannedCount > 0 && perUnitMin > 0 ? plannedCount * perUnitMin : 0;

    let episodesLabel = 'Онгоинг';
    if (effectiveAired > 0 && hasDistinctPlanned) {
      episodesLabel = `вышло ${effectiveAired} из ${plannedCount} эп.${seasons > 1 ? ` (${seasons} сез.)` : ''}`;
    } else if (effectiveAired > 0) {
      episodesLabel = `вышло ${effectiveAired} эп.${seasons > 1 ? ` (${seasons} сез.)` : ''} (онгоинг)`;
    } else if (plannedCount > 0) {
      episodesLabel = `запланировано ${plannedCount} эп.${seasons > 1 ? ` (${seasons} сез.)` : ''} (онгоинг)`;
    } else if (seasons > 1) {
      episodesLabel = `${seasons} сез. (онгоинг)`;
    }

    const parts = [];
    if (rawDur > 0) parts.push(`${rawDur} мин./эп.`);
    let shortBadge = '';
    if (effectiveAired > 0 && hasDistinctPlanned) {
      parts.push(`вышло ${effectiveAired} эп. (${formatDurationMinsRu(airedMinutes)})`);
      parts.push(`всего запланировано ${plannedCount} эп. (${formatDurationMinsRu(plannedMinutes)})`);
      shortBadge = `вышло ${effectiveAired}/${plannedCount} эп. (${formatDurationMinsRu(airedMinutes)} из ${formatDurationMinsRu(plannedMinutes)})`;
    } else if (effectiveAired > 0) {
      parts.push(`вышло ${effectiveAired} эп. (${formatDurationMinsRu(airedMinutes)})`);
      shortBadge = `вышло ${effectiveAired} эп. (${formatDurationMinsRu(airedMinutes)})`;
    } else if (plannedCount > 0) {
      parts.push(`всего запланировано ${plannedCount} эп. (${formatDurationMinsRu(plannedMinutes)})`);
      shortBadge = `план ${plannedCount} эп. (${formatDurationMinsRu(plannedMinutes)})`;
    } else {
      parts.push('онгоинг (серии уточняются)');
    }

    if (showWatchedProgress && perUnitMin > 0) {
      parts.push(`просмотрено ${formatDurationMinsRu(watched * perUnitMin)}`);
    }

    return {
      isOngoing: true,
      isRead: false,
      airedCount: effectiveAired,
      plannedCount: hasDistinctPlanned ? plannedCount : 0,
      airedMinutes,
      plannedMinutes,
      perUnitMin,
      episodesLabel,
      durationLabel: parts.join(' · '),
      shortBadge
    };
  }

  // --- Отбор недостающих сиквелов/продолжений по дереву франшизы ---
  function extractMissingSequels(parentItems, relationRecords, isInCollectionFn = null, currentYear = new Date().getFullYear()) {
    const parents = Array.isArray(parentItems) ? parentItems : [];
    const records = Array.isArray(relationRecords) ? relationRecords : [];
    const checkOwned = typeof isInCollectionFn === 'function' ? isInCollectionFn : (() => false);

    const normSimple = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-z0-9а-я]+/g, '');
    const parentAniIds = new Set();
    const parentMalIds = new Set();
    const parentTmdbIds = new Set();
    const parentTitles = new Set();
    for (const p of parents) {
      if (!p) continue;
      if (Number(p.aniId) > 0) parentAniIds.add(Number(p.aniId));
      if (Number(p.mal) > 0) parentMalIds.add(Number(p.mal));
      if (Number(p.shikiId) > 0) parentMalIds.add(Number(p.shikiId));
      if (p.tmdb) parentTmdbIds.add(String(p.tmdb));
      [p.title, p.titleEn, p.en, p.titleOrig, p.orig].forEach(t => {
        const nt = normSimple(t);
        if (nt.length >= 3) parentTitles.add(nt);
      });
    }

    const EXCLUDED_FORMATS = new Set(['MUSIC', 'PV', 'CM']);
    const isSequelType = rel => {
      const r = String(rel || '').trim().toLowerCase();
      return r === 'sequel' || r === 'продолжение' || r === 'tmdb_collection_sequel';
    };

    const byKey = new Map();
    for (const rec of records) {
      if (!rec || !rec.node) continue;
      if (!isSequelType(rec.relationType)) continue;
      const n = rec.node;
      const fmt = String(n.format || '').toUpperCase();
      if (EXCLUDED_FORMATS.has(fmt)) continue;

      const aniId = Number(n.aniId) || 0;
      const mal = Number(n.mal || n.shikiId) || 0;
      const tmdb = n.tmdb ? String(n.tmdb) : '';
      const cat = String(n.category || 'Аниме');
      const titleMain = String(n.title || n.titleEn || n.en || n.titleOrig || '').trim();
      const nt = normSimple(titleMain);
      if (!titleMain) continue;

      // Пропускаем, если совпадает с исходным тайтлом или уже есть в коллекции
      if (aniId > 0 && parentAniIds.has(aniId)) continue;
      if (mal > 0 && parentMalIds.has(mal)) continue;
      if (tmdb && parentTmdbIds.has(tmdb)) continue;
      if (checkOwned(n)) continue;

      const dedupKey = aniId > 0
        ? `ani:${aniId}`
        : mal > 0
          ? `mal:${cat}:${mal}`
          : tmdb
            ? `tmdb:${cat}:${tmdb}`
            : `t:${cat}:${nt}`;

      const rawSt = String(n.status || n.releaseStatus || '').toUpperCase();
      const yr = Number(n.year) || 0;
      let statusBucket = 'released';
      if (rawSt === 'RELEASING' || rawSt === 'ONGOING' || rawSt === 'RETURNING SERIES') {
        statusBucket = 'ongoing';
      } else if (rawSt === 'NOT_YET_RELEASED' || rawSt === 'ANONS' || rawSt === 'PLANNED' || rawSt === 'IN PRODUCTION' || (!rawSt && yr > currentYear)) {
        statusBucket = 'announced';
      }

      const parentTitle = String(rec.parentItem?.title || '').trim();
      const existing = byKey.get(dedupKey);
      if (existing) {
        if (parentTitle && !existing.parentTitles.includes(parentTitle)) {
          existing.parentTitles.push(parentTitle);
        }
        if (!existing.poster && n.poster) existing.poster = n.poster;
        if (!existing.extRating && (n.extRating || n.ext)) existing.extRating = String(n.extRating || n.ext);
        continue;
      }

      byKey.set(dedupKey, {
        ...n,
        aniId,
        mal,
        tmdb,
        category: cat,
        title: titleMain,
        year: yr ? String(yr) : '',
        statusBucket,
        parentTitles: parentTitle ? [parentTitle] : []
      });
    }

    const bucketOrder = { released: 0, ongoing: 1, announced: 2 };
    return [...byKey.values()].sort((a, b) => {
      const bo = (bucketOrder[a.statusBucket] ?? 3) - (bucketOrder[b.statusBucket] ?? 3);
      if (bo !== 0) return bo;
      const yrDiff = (Number(b.year) || 0) - (Number(a.year) || 0);
      if (yrDiff !== 0) return yrDiff;
      return (Number(b.extRating || b.ext) || 0) - (Number(a.extRating || a.ext) || 0);
    });
  }

  // Компактная сериализация открытой полной страницы тайтла для восстановления после обновления страницы (F5) через sessionStorage
  function serializeTitlePageSnapshot(item) {
    if (!item || typeof item !== 'object') return '';
    const title = String(item.title || '').trim();
    if (!title) return '';
    const pickStr = (v, maxLen = 400) => {
      const s = typeof v === 'string' ? v.trim() : (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
      return s ? (s.length > maxLen ? s.slice(0, maxLen) : s) : '';
    };
    const pickNum = v => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const snap = {
      v: 1,
      title: pickStr(title, 260),
      category: pickStr(item.category, 40)
    };
    if (item.id != null && String(item.id).trim()) snap.id = String(item.id).trim().slice(0, 80);
    if (pickNum(item.aniId)) snap.aniId = pickNum(item.aniId);
    if (pickNum(item.mal)) snap.mal = pickNum(item.mal);
    if (pickNum(item.shikiId)) snap.shikiId = pickNum(item.shikiId);
    if (pickNum(item.tmdb)) snap.tmdb = pickNum(item.tmdb);
    if (pickStr(item.mdId, 80)) snap.mdId = pickStr(item.mdId, 80);
    const en = pickStr(item.titleEn || item.en, 260);
    if (en) { snap.titleEn = en; snap.en = en; }
    const romaji = pickStr(item.romaji, 260);
    if (romaji) snap.romaji = romaji;
    const orig = pickStr(item.titleOrig || item.orig, 260);
    if (orig) { snap.titleOrig = orig; snap.orig = orig; }
    const fmt = pickStr(item.format, 40);
    if (fmt) snap.format = fmt;
    const subKind = pickStr(item.subKind || item.kind, 40);
    if (subKind) snap.subKind = subKind;
    const yr = pickStr(item.year, 20);
    if (yr) snap.year = yr;
    if (pickNum(item.eps)) snap.eps = pickNum(item.eps);
    if (pickNum(item.airedEps)) snap.airedEps = pickNum(item.airedEps);
    if (pickNum(item.vols)) snap.vols = pickNum(item.vols);
    if (pickNum(item.dur)) snap.dur = pickNum(item.dur);
    if (pickNum(item.seasons)) snap.seasons = pickNum(item.seasons);
    const poster = pickStr(item.poster, 600);
    if (poster && !poster.startsWith('data:')) snap.poster = poster;
    const banner = pickStr(item.banner, 600);
    if (banner && !banner.startsWith('data:')) snap.banner = banner;
    const ext = pickStr(item.extRating || item.ext, 20);
    if (ext) { snap.extRating = ext; snap.ext = ext; }
    if (item.ongoing) snap.ongoing = true;
    if (item.upcoming) snap.upcoming = true;
    const relSt = pickStr(item.releaseStatus, 40);
    if (relSt) snap.releaseStatus = relSt;
    const url = pickStr(item.url, 400);
    if (url) snap.url = url;
    const src = pickStr(item.src || item.extSrc, 40);
    if (src) snap.src = src;
    if (Array.isArray(item.tags) && item.tags.length) {
      snap.tags = item.tags.map(t => pickStr(t, 40)).filter(Boolean).slice(0, 12);
    }
    const desc = pickStr(item.description || item.desc, 1200);
    if (desc) { snap.description = desc; snap.desc = desc; }
    const author = pickStr(item.author, 160);
    if (author) snap.author = author;
    const studio = pickStr(item.studio, 160);
    if (studio) snap.studio = studio;
    if (item.isAdult) snap.isAdult = true;
    try {
      return JSON.stringify(snap);
    } catch (e) {
      return '';
    }
  }

  function parseTitlePageSnapshot(raw) {
    if (!raw || typeof raw !== 'string' || raw.length > 16000) return null;
    try {
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
      const title = typeof obj.title === 'string' ? obj.title.trim() : '';
      if (!title) return null;
      return obj;
    } catch (e) {
      return null;
    }
  }

  function parseCatalogYearInput(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!/^\d{4}$/.test(s)) return 0;
    const n = parseInt(s, 10);
    return (n >= 1900 && n <= 2100) ? n : 0;
  }

  function buildFuzzyDateBounds(yrFromRaw, yrToRaw) {
    let yrFrom = parseCatalogYearInput(yrFromRaw);
    let yrTo = parseCatalogYearInput(yrToRaw);
    if (yrFrom && yrTo && yrFrom > yrTo) {
      const tmp = yrFrom;
      yrFrom = yrTo;
      yrTo = tmp;
    }
    return {
      yrFrom,
      yrTo,
      sg: yrFrom ? ((yrFrom - 1) * 10000 + 1231) : undefined,
      sl: yrTo ? ((yrTo + 1) * 10000 + 101) : undefined
    };
  }

  function parseDirectIdQuery(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s || s.length > 80) return null;
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRe.test(s)) {
      return { source: 'mangadex', mdId: s.toLowerCase(), numericId: 0, raw: s };
    }
    const mdPref = s.match(/^(?:md|mangadex)\s*[:#/-]\s*([0-9a-f-]{36})$/i);
    if (mdPref && uuidRe.test(mdPref[1])) {
      return { source: 'mangadex', mdId: mdPref[1].toLowerCase(), numericId: 0, raw: s };
    }
    const imdbMatch = s.match(/^(?:imdb\s*[:#/-]\s*)?(tt\d{6,10})$/i);
    if (imdbMatch) {
      return { source: 'imdb', imdbId: imdbMatch[1].toLowerCase(), numericId: 0, raw: s };
    }
    const tmdbPathMatch = s.match(/^(?:tmdb\s*[:#/-]\s*)?(movie|tv)\/(\d{1,9})$/i);
    if (tmdbPathMatch) {
      const mediaType = tmdbPathMatch[1].toLowerCase();
      const numId = parseInt(tmdbPathMatch[2], 10);
      return { source: 'tmdb', tmdbType: mediaType, tmdbPath: `${mediaType}/${numId}`, numericId: numId, raw: s };
    }
    const prefNum = s.match(/^(al|anilist|mal|shiki|shikimori|tmdb|id|#)\s*[:#/-]?\s*(\d{1,9})$/i);
    if (prefNum) {
      const p = prefNum[1].toLowerCase();
      const numId = parseInt(prefNum[2], 10);
      if (!numId || numId <= 0) return null;
      const srcMap = {
        al: 'anilist',
        anilist: 'anilist',
        mal: 'mal',
        shiki: 'shiki',
        shikimori: 'shiki',
        tmdb: 'tmdb',
        id: 'any',
        '#': 'any'
      };
      return { source: srcMap[p] || 'any', numericId: numId, raw: s };
    }
    if (/^\d{1,9}$/.test(s)) {
      const numId = parseInt(s, 10);
      if (numId > 0) return { source: 'any', numericId: numId, raw: s };
    }
    return null;
  }

  function collectExternalIdBadges(item) {
    if (!item || typeof item !== 'object') return [];
    const badges = [];
    const aniId = Number(item.aniId) || 0;
    const mal = Number(item.mal) || 0;
    const shikiId = Number(item.shikiId) || 0;
    const tmdb = String(item.tmdb || '').trim();
    const imdbId = String(item.imdbId || '').trim();
    const mdId = String(item.mdId || '').trim();
    if (aniId > 0) badges.push({ key: 'aniId', label: 'AniList', value: String(aniId), query: `al:${aniId}` });
    if (mal > 0) badges.push({ key: 'mal', label: 'MAL / Shiki', value: String(mal), query: `mal:${mal}` });
    else if (shikiId > 0) badges.push({ key: 'shikiId', label: 'Shikimori', value: String(shikiId), query: `shiki:${shikiId}` });
    if (shikiId > 0 && mal > 0 && shikiId !== mal) {
      badges.push({ key: 'shikiId', label: 'Shikimori', value: String(shikiId), query: `shiki:${shikiId}` });
    }
    if (tmdb) badges.push({ key: 'tmdb', label: 'TMDB', value: tmdb, query: `tmdb:${tmdb}` });
    if (imdbId) badges.push({ key: 'imdbId', label: 'IMDb', value: imdbId, query: imdbId });
    if (mdId) badges.push({ key: 'mdId', label: 'MangaDex', value: mdId.slice(0, 8) + '…', fullValue: mdId, query: `md:${mdId}` });
    return badges;
  }

  function itemMatchesIdQuery(item, rawQuery) {
    if (!item || typeof item !== 'object') return false;
    const parsed = parseDirectIdQuery(rawQuery);
    if (!parsed) return false;
    if (parsed.source === 'mangadex') {
      return String(item.mdId || '').toLowerCase() === parsed.mdId;
    }
    if (parsed.source === 'imdb') {
      return String(item.imdbId || '').toLowerCase() === parsed.imdbId;
    }
    if (parsed.source === 'tmdb') {
      const t = String(item.tmdb || '').toLowerCase();
      if (parsed.tmdbPath) return t === parsed.tmdbPath;
      return t === `movie/${parsed.numericId}` || t === `tv/${parsed.numericId}` || t === String(parsed.numericId);
    }
    if (parsed.source === 'anilist') {
      return Number(item.aniId) === parsed.numericId;
    }
    if (parsed.source === 'mal' || parsed.source === 'shiki') {
      return Number(item.mal) === parsed.numericId || Number(item.shikiId) === parsed.numericId;
    }
    // source === 'any'
    const n = parsed.numericId;
    const t = String(item.tmdb || '').toLowerCase();
    return Number(item.aniId) === n
      || Number(item.mal) === n
      || Number(item.shikiId) === n
      || String(item.id || '') === String(n)
      || t === `movie/${n}`
      || t === `tv/${n}`
      || t === String(n);
  }

  function toggleTagInCommaList(csvStr, tagName) {
    const cleanTag = String(tagName || '').trim();
    const list = String(csvStr || '')
      .split(',')
      .map(x => x.trim())
      .filter(Boolean);
    if (!cleanTag) return { value: list.join(', '), active: false };
    const low = cleanTag.toLowerCase();
    const exists = list.some(x => x.toLowerCase() === low);
    let next;
    if (exists) {
      next = list.filter(x => x.toLowerCase() !== low);
    } else {
      next = [...list, cleanTag];
    }
    return { value: next.join(', '), active: !exists };
  }

  function shouldFallbackAfterCloudReadError(err) {
    if (!err) return true;
    const code = String(err.code || '').toLowerCase();
    const msg = String(err.message || err || '').toLowerCase();
    if (
      code.includes('deadline-exceeded')
      || code.includes('resource-exhausted')
      || code.includes('unavailable')
      || code.includes('cancelled')
      || /quota exceeded|daily usage limit|превышено время ожидания|offline/i.test(msg)
    ) {
      return false;
    }
    return true;
  }

  function canCombineChunksAndProfileInSingleBatch(chunkBatches, excessCount, profMetaBytes = 0) {
    const batches = Array.isArray(chunkBatches) ? chunkBatches : [];
    if (batches.length > 1) return false;
    const excess = Math.max(0, Number(excessCount || 0));
    if (excess > 300) return false;
    const firstBatch = batches[0] || [];
    if (firstBatch.length + excess + 1 > 450) return false;
    let chunksBytes = 0;
    for (const ch of firstBatch) {
      chunksBytes += utf8ByteLength(ch && ch.payloadJson ? ch.payloadJson : '') + 512;
    }
    const totalBytes = chunksBytes + Math.max(0, Number(profMetaBytes || 0));
    return totalBytes < 6500000;
  }

  function decodeFirestoreRestValue(v) {
    if (!v || typeof v !== 'object') return undefined;
    if ('nullValue' in v) return null;
    if ('booleanValue' in v) return Boolean(v.booleanValue);
    if ('integerValue' in v) {
      const n = Number(v.integerValue);
      return Number.isFinite(n) ? n : String(v.integerValue);
    }
    if ('doubleValue' in v) return Number(v.doubleValue);
    if ('stringValue' in v) return String(v.stringValue);
    if ('timestampValue' in v) {
      const ms = Date.parse(String(v.timestampValue));
      return Number.isFinite(ms) ? ms : String(v.timestampValue);
    }
    if ('arrayValue' in v) {
      const vals = v.arrayValue && Array.isArray(v.arrayValue.values) ? v.arrayValue.values : [];
      return vals.map(decodeFirestoreRestValue);
    }
    if ('mapValue' in v) {
      const out = {};
      const fields = (v.mapValue && v.mapValue.fields && typeof v.mapValue.fields === 'object') ? v.mapValue.fields : {};
      for (const [k, fv] of Object.entries(fields)) {
        out[k] = decodeFirestoreRestValue(fv);
      }
      return out;
    }
    return undefined;
  }

  function decodeFirestoreRestDocument(rawDoc) {
    if (!rawDoc || typeof rawDoc !== 'object' || !rawDoc.fields || typeof rawDoc.fields !== 'object') {
      return {};
    }
    const out = {};
    for (const [k, fv] of Object.entries(rawDoc.fields)) {
      const decoded = decodeFirestoreRestValue(fv);
      if (decoded !== undefined) out[k] = decoded;
    }
    return out;
  }

  const READ_CATEGORIES_SET = new Set(['манга', 'ранобэ', 'манхва', 'маньхуа', 'комикс', 'комиксы', 'додзинси', 'doujinshi', 'doujin', 'новелла', 'ваншот']);

  function isReadCategory(category) {
    const key = String(category || '').trim().toLowerCase();
    return Boolean(key && READ_CATEGORIES_SET.has(key));
  }

  function getStatusLabelForCategory(status, category) {
    if (!status) return '';
    const catNorm = String(category || '').trim().toLowerCase();
    const isAll = !catNorm || catNorm === 'всё' || catNorm === 'все' || catNorm === 'all';
    if (status === 'Смотрю/Читаю') {
      if (isReadCategory(category)) return 'Читаю';
      if (isAll) return 'Смотрю / Читаю';
      return 'Смотрю';
    }
    if (status === 'Просмотрено/Прочитано') {
      if (isReadCategory(category)) return 'Прочитано';
      if (isAll) return 'Просмотрено / Прочитано';
      return 'Просмотрено';
    }
    if (status === 'Пересматриваю') {
      if (isReadCategory(category)) return 'Перечитываю';
      if (isAll) return 'Пересматриваю / Перечитываю';
      return 'Пересматриваю';
    }
    return status;
  }

  function getCollectionStatusLabels(itemsList, activeCategory) {
    const catNorm = String(activeCategory || '').trim().toLowerCase();
    const isAll = !catNorm || catNorm === 'всё' || catNorm === 'все' || catNorm === 'all';
    if (!isAll) {
      return {
        watching: getStatusLabelForCategory('Смотрю/Читаю', activeCategory),
        completed: getStatusLabelForCategory('Просмотрено/Прочитано', activeCategory),
        rewatching: getStatusLabelForCategory('Пересматриваю', activeCategory)
      };
    }
    const list = Array.isArray(itemsList) ? itemsList.filter(Boolean) : [];
    if (list.length) {
      let hasRead = false;
      let hasWatch = false;
      for (let i = 0; i < list.length; i++) {
        if (isReadCategory(list[i].category)) hasRead = true;
        else hasWatch = true;
        if (hasRead && hasWatch) break;
      }
      if (hasRead && !hasWatch) {
        return { watching: 'Читаю', completed: 'Прочитано', rewatching: 'Перечитываю' };
      }
      if (hasWatch && !hasRead) {
        return { watching: 'Смотрю', completed: 'Просмотрено', rewatching: 'Пересматриваю' };
      }
    }
    return {
      watching: 'Смотрю / Читаю',
      completed: 'Просмотрено / Прочитано',
      rewatching: 'Пересматриваю / Перечитываю'
    };
  }

  function normalizeExternalRatingInput(rawRating, rawSource) {
    const srcRaw = String(rawSource || '').trim();
    const cleanSrc = srcRaw === '__custom__' ? '' : srcRaw;
    const str = String(rawRating == null ? '' : rawRating).trim().replace(',', '.');
    if (!str) {
      return { valid: true, rating: '', source: cleanSrc };
    }
    const n = Number(str);
    if (!Number.isFinite(n) || n < 0 || n > 10) {
      return { valid: false, rating: '', source: cleanSrc };
    }
    const rounded = Math.round(n * 100) / 100;
    const formatted = rounded === 0 ? '' : String(rounded);
    return { valid: true, rating: formatted, source: cleanSrc };
  }

  function mapItemCategoryToCatalogSection(category) {
    const raw = String(category || '').trim();
    const low = raw.toLowerCase();
    if (low === 'аниме') return 'Аниме';
    if (low === 'ранобэ' || low === 'новелла') return 'Ранобэ';
    if (low === 'манга' || low === 'манхва' || low === 'маньхуа' || low === 'додзинси' || low === 'комикс') return 'Манга';
    if (low === 'фильм' || low === 'сериал' || low === 'кино и сериалы' || low === 'фильмы и сериалы') return 'Кино и сериалы';
    return 'Аниме';
  }

  function normalizeTagLookupStr(raw) {
    return String(raw || '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .toLowerCase();
  }

  function resolveCatalogTagKey(rawLabel, isVideo, aniTagPairs, videoGenresMap) {
    const clean = String(rawLabel || '').trim();
    if (!clean) return '';
    const normTarget = normalizeTagLookupStr(clean);
    const lowRaw = clean.toLowerCase();
    if (!normTarget) return '';

    if (isVideo) {
      const entries = videoGenresMap && typeof videoGenresMap === 'object'
        ? Object.entries(videoGenresMap)
        : [];
      for (const [id, label] of entries) {
        if (String(id) === clean) return String(id);
        const lLow = String(label || '').trim().toLowerCase();
        if (lLow === lowRaw || normalizeTagLookupStr(label) === normTarget) return String(id);
      }
      // Распространённые синонимы жанров кино/сериалов
      const videoAlias = {
        'экшен': '28',
        'экшн': '28',
        'action': '28',
        'приключение': '12',
        'adventure': '12',
        'анимация': '16',
        'комедия': '35',
        'comedy': '35',
        'криминал': '80',
        'crime': '80',
        'драма': '18',
        'drama': '18',
        'фэнтези': '14',
        'fantasy': '14',
        'ужасы': '27',
        'хоррор': '27',
        'horror': '27',
        'детектив': '9648',
        'мистика': '9648',
        'mystery': '9648',
        'романтика': '10749',
        'мелодрама': '10749',
        'romance': '10749',
        'фантастика': '878',
        'научная фантастика': '878',
        'sci fi': '878',
        'триллер': '53',
        'thriller': '53'
      };
      if (videoAlias[normTarget]) return videoAlias[normTarget];
      return '';
    }

    const pairs = Array.isArray(aniTagPairs) ? aniTagPairs : [];
    // 1) Точное совпадение ключа (g:Fantasy / t:Dark Fantasy) или подписи
    for (const pair of pairs) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const [key, label] = pair;
      const keyStr = String(key || '').trim();
      const labelStr = String(label || '').trim();
      const bareEng = keyStr.replace(/^[gt]:/i, '').trim().toLowerCase();
      if (keyStr.toLowerCase() === lowRaw || bareEng === lowRaw || labelStr.toLowerCase() === lowRaw) {
        return keyStr;
      }
      if (normalizeTagLookupStr(labelStr) === normTarget || normalizeTagLookupStr(bareEng) === normTarget) {
        return keyStr;
      }
    }
    // 2) Частичное совпадение для составных подписей (например "Сёнэн" vs "Сёнэн (для юношей)")
    for (const pair of pairs) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const [key, label] = pair;
      const parts = String(label || '').split(/[/,·]/).map(normalizeTagLookupStr).filter(Boolean);
      if (parts.includes(normTarget)) return String(key);
    }
    return '';
  }

  function buildCatalogHistorySnapshot(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const tags = Array.isArray(src.tags)
      ? src.tags
          .filter(p => Array.isArray(p) && p.length >= 2 && String(p[0] || '').trim() && Number(p[1]) !== 0)
          .map(p => [String(p[0]).trim(), Number(p[1]) > 0 ? 1 : -1])
      : [];
    const creator = src.creator && typeof src.creator === 'object' && String(src.creator.nameStr || '').trim()
      ? {
          kindType: String(src.creator.kindType || 'author'),
          nameStr: String(src.creator.nameStr).trim(),
          itemCat: String(src.creator.itemCat || '')
        }
      : null;
    return {
      g: String(src.g || 'Аниме'),
      q: String(src.q || '').trim(),
      tags,
      creator,
      mode: String(src.mode || 'actual'),
      kind: String(src.kind || ''),
      animeKind: String(src.animeKind || ''),
      videoKind: String(src.videoKind || 'all'),
      year: String(src.year || ''),
      year2: String(src.year2 || ''),
      len: String(src.len || ''),
      country: String(src.country || ''),
      age: String(src.age || ''),
      min: Number(src.min) || 0,
      ongOnly: Boolean(src.ongOnly),
      finOnly: Boolean(src.finOnly),
      hide: Boolean(src.hide)
    };
  }

  function buildCollectionHistorySnapshot(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const xf = src.xf && typeof src.xf === 'object' && String(src.xf.k || '').trim() && String(src.xf.v || '').trim()
      ? { k: String(src.xf.k).trim(), v: String(src.xf.v).trim() }
      : null;
    return {
      q: String(src.q || '').trim(),
      xf,
      tag: String(src.tag || 'Все'),
      list: String(src.list || 'Все'),
      status: String(src.status || 'Все'),
      cat: String(src.cat || 'Всё'),
      kind: String(src.kind || 'Все'),
      ongOnly: Boolean(src.ongOnly),
      finOnly: Boolean(src.finOnly)
    };
  }

  function clearSearchForMetadataTransition(snapshot, patch) {
    const base = snapshot && typeof snapshot === 'object' ? { ...snapshot } : {};
    return {
      ...base,
      ...(patch && typeof patch === 'object' ? patch : {}),
      q: ''
    };
  }

  function normalizeSearchText(str) {
    if (str == null) return '';
    return String(str)
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenizeSearchText(str) {
    const n = normalizeSearchText(str);
    return n ? n.split(' ').filter(Boolean) : [];
  }

  const SPINOFF_MARKER_RE = /(?:^|\s)(антологи[яи]|гайдэн|дополнительн\w*|бонус\w*|спецвыпуск\w*|эпизод\s+с|история\s+[а-яё]+|ёнкома|4\s*koma|anthology|gaiden|side\s*story|bonus|special|one\s*shot|ваншот|альтернатив\w*|иная\s+|another\s+|spin\s*off)(?=$|\s)/i;

  function scoreTitleAgainstQuery(rawTitle, normQ, qTokens) {
    const nt = normalizeSearchText(rawTitle);
    if (!nt || !normQ) return { score: 0, exact: false, prefix: false, allWords: false };
    if (nt === normQ) return { score: 1000, exact: true, prefix: true, allWords: true };
    if (nt.startsWith(normQ + ' ')) {
      const extraPenalty = Math.min(180, (nt.length - normQ.length) * 3);
      return { score: 820 - extraPenalty, exact: false, prefix: true, allWords: true };
    }
    if (nt.startsWith(normQ)) {
      const extraPenalty = Math.min(160, (nt.length - normQ.length) * 3);
      return { score: 740 - extraPenalty, exact: false, prefix: true, allWords: qTokens.length <= 1 };
    }
    const tTokens = nt.split(' ').filter(Boolean);
    const tSet = new Set(tTokens);
    const allWholeWords = qTokens.length > 0 && qTokens.every(tok => tSet.has(tok));
    if (allWholeWords) {
      const extraTokens = Math.max(0, tTokens.length - qTokens.length);
      const containsPhrase = nt.includes(normQ);
      return {
        score: (containsPhrase ? 620 : 540) - Math.min(160, extraTokens * 32),
        exact: false,
        prefix: false,
        allWords: true
      };
    }
    if (nt.includes(normQ)) {
      const ratio = normQ.length / Math.max(1, nt.length);
      return {
        score: Math.round(320 + ratio * 160),
        exact: false,
        prefix: false,
        allWords: false
      };
    }
    if (qTokens.length >= 2) {
      let matched = 0;
      for (const tok of qTokens) {
        if (tok.length <= 1) continue;
        if (tSet.has(tok) || (tok.length >= 4 && tTokens.some(w => w.startsWith(tok)))) matched++;
      }
      const significant = qTokens.filter(t => t.length > 1).length || qTokens.length;
      if (matched > 0 && matched >= Math.ceil(significant * 0.6)) {
        return {
          score: Math.round(140 + (matched / significant) * 180),
          exact: false,
          prefix: false,
          allWords: matched === significant
        };
      }
    }
    return { score: 0, exact: false, prefix: false, allWords: false };
  }

  function extractRuCacheMatches(query, rucMap, type) {
    const normQ = normalizeSearchText(query);
    if (!normQ || normQ.length < 2 || !rucMap || typeof rucMap !== 'object') return [];
    const qTokens = tokenizeSearchText(normQ);
    const isAnime = type === 'ANIME' || type === 'Аниме';
    const isNovel = type === 'NOVEL' || type === 'Ранобэ';
    const allowedPrefixes = isAnime
      ? ['animes', 't_animes_']
      : isNovel
        ? ['ranobe', 't_ranobe_', 'mangas', 't_mangas_']
        : ['mangas', 't_mangas_'];

    const byMal = new Map();
    for (const [k, v] of Object.entries(rucMap)) {
      if (typeof v !== 'string' || !v.trim()) continue;
      if (k.startsWith('d_')) continue;
      let malId = 0;
      for (const pref of allowedPrefixes) {
        if (k.startsWith(pref)) {
          const rest = k.slice(pref.length);
          if (/^\d+$/.test(rest)) {
            malId = Number(rest);
            break;
          }
        }
      }
      if (!malId) continue;
      const m = scoreTitleAgainstQuery(v, normQ, qTokens);
      if (m.score < 320) continue;
      const prev = byMal.get(malId);
      if (!prev || m.score > prev.score) {
        byMal.set(malId, { malId, ruTitle: v.trim(), score: m.score, exact: m.exact, prefix: m.prefix });
      }
    }
    return [...byMal.values()]
      .sort((a, b) => b.score - a.score || a.malId - b.malId)
      .slice(0, 12);
  }

  function rankShikimoriRuCandidates(candidates, query, opts) {
    const list = Array.isArray(candidates) ? candidates : [];
    const o = opts && typeof opts === 'object' ? opts : {};
    const normQ = normalizeSearchText(query);
    const qTokens = tokenizeSearchText(normQ);
    const qHasSpinoff = SPINOFF_MARKER_RE.test(normQ);
    const isAnime = Boolean(o.isAnime);
    const isNovel = Boolean(o.isNovel);

    const scored = list.map((cand, idx) => {
      if (!cand || typeof cand !== 'object') return null;
      const kind = String(cand.kind || '').toLowerCase();
      const candIsNovel = kind === 'light_novel' || kind === 'novel';
      if (!isAnime) {
        if (isNovel && kind && !candIsNovel) return null;
        if (!isNovel && candIsNovel) return null;
      }

      const ruMatch = scoreTitleAgainstQuery(cand.russian || '', normQ, qTokens);
      const enMatch = scoreTitleAgainstQuery(cand.english || '', normQ, qTokens);
      const romajiMatch = scoreTitleAgainstQuery(cand.name || '', normQ, qTokens);
      let synBest = { score: 0, exact: false, prefix: false, allWords: false };
      if (Array.isArray(cand.synonyms)) {
        for (const syn of cand.synonyms) {
          const sm = scoreTitleAgainstQuery(syn, normQ, qTokens);
          if (sm.score > synBest.score) synBest = sm;
        }
      }

      const bestTitleScore = Math.max(
        ruMatch.score,
        Math.round(synBest.score * 0.9),
        Math.round(enMatch.score * 0.85),
        Math.round(romajiMatch.score * 0.85)
      );
      const numScore = Number(cand.score) || 0;
      const ratingBonus = numScore > 0 ? numScore * 18 : 0;
      let total = bestTitleScore + ratingBonus;

      if (!isAnime && kind === 'one_shot' && !qHasSpinoff) total -= 48;
      if (o.country === 'KR' && kind === 'manhwa') total += 35;
      else if (o.country === 'CN' && kind === 'manhua') total += 35;
      else if (o.doujin && kind === 'doujin') total += 35;

      const combinedTitleNorm = normalizeSearchText([cand.russian, cand.english, cand.name].filter(Boolean).join(' '));
      if (!qHasSpinoff && SPINOFF_MARKER_RE.test(combinedTitleNorm)) {
        total -= 42;
      }
      // Бонус для высокого рейтинга, если Shikimori сам выдал запись в топе по скрытому русскому синониму (напр. «Звёздное дитя» -> «Ребёнок идола»)
      if (bestTitleScore === 0 && idx < 3 && numScore >= 7.0) {
        total += 160 - idx * 30;
      }

      const isStrongMatch = Boolean(
        (ruMatch.exact && (numScore >= 5.5 || ruMatch.score >= 1000)) ||
        (ruMatch.prefix && numScore >= 5.5) ||
        (synBest.exact && numScore >= 6.0)
      );

      return {
        cand,
        malId: Number(cand.malId || cand.id) || 0,
        enQuery: String(cand.english || cand.name || '').trim(),
        romajiQuery: String(cand.name || '').trim(),
        ruTitle: String(cand.russian || '').trim(),
        totalScore: total,
        bestTitleScore,
        numScore,
        isStrongMatch,
        idx
      };
    }).filter(Boolean);

    scored.sort((a, b) => b.totalScore - a.totalScore || b.numScore - a.numScore || a.idx - b.idx);

    const malIds = [];
    const seenMal = new Set();
    const enQueries = [];
    const seenEn = new Set();
    for (const row of scored) {
      if (row.malId > 0 && !seenMal.has(row.malId)) {
        seenMal.add(row.malId);
        malIds.push(row.malId);
      }
      for (const qCandidate of [row.romajiQuery, row.enQuery]) {
        const clean = String(qCandidate || '').trim();
        const key = normalizeSearchText(clean);
        if (clean && key && !seenEn.has(key)) {
          seenEn.add(key);
          enQueries.push(clean);
        }
      }
    }

    const hasStrongRuMatch = scored.some(r => r.isStrongMatch);
    return {
      ranked: scored.map(r => r.cand),
      malIds: malIds.slice(0, 12),
      enQueries: enQueries.slice(0, 5),
      hasStrongRuMatch
    };
  }

  function rankCatalogSearchResults(itemsList, rawQuery, resolvedMeta) {
    const list = Array.isArray(itemsList) ? itemsList : [];
    const normQ = normalizeSearchText(rawQuery);
    if (!normQ || list.length <= 1) return list.slice();

    const qTokens = tokenizeSearchText(normQ);
    const qHasSpinoff = SPINOFF_MARKER_RE.test(normQ);
    const meta = resolvedMeta && typeof resolvedMeta === 'object' ? resolvedMeta : {};
    const malRankMap = new Map();
    (Array.isArray(meta.malIds) ? meta.malIds : []).forEach((id, i) => {
      const n = Number(id) || 0;
      if (n > 0 && !malRankMap.has(n)) malRankMap.set(n, i);
    });
    const translatedNorm = normalizeSearchText(meta.translatedEn || '');
    const translatedTokens = tokenizeSearchText(translatedNorm);
    const enAltNorms = (Array.isArray(meta.enQueries) ? meta.enQueries : [])
      .map(s => normalizeSearchText(s))
      .filter(Boolean);

    const scored = list.map((item, idx) => {
      if (!item || typeof item !== 'object') return { item, score: -1e9, idx };
      const titleM = scoreTitleAgainstQuery(item.title || '', normQ, qTokens);
      const enM = scoreTitleAgainstQuery(item.en || '', normQ, qTokens);
      const romM = scoreTitleAgainstQuery(item.romaji || '', normQ, qTokens);
      const origM = scoreTitleAgainstQuery(item.orig || '', normQ, qTokens);
      let altBest = 0;
      if (item.alt) {
        String(item.alt).split(',').forEach(part => {
          const pm = scoreTitleAgainstQuery(part, normQ, qTokens);
          if (pm.score > altBest) altBest = pm.score;
        });
      }

      let directScore = Math.max(
        titleM.score,
        enM.score,
        romM.score,
        Math.round(origM.score * 0.9),
        Math.round(altBest * 0.85)
      );

      // Совпадение по переведённому на английский запросу (для вебтунов / неофициальных русских названий)
      let transScore = 0;
      if (translatedNorm && translatedNorm !== normQ) {
        const t1 = scoreTitleAgainstQuery(item.en || '', translatedNorm, translatedTokens);
        const t2 = scoreTitleAgainstQuery(item.romaji || '', translatedNorm, translatedTokens);
        const t3 = scoreTitleAgainstQuery(item.title || '', translatedNorm, translatedTokens);
        let tAlt = 0;
        if (item.alt) {
          String(item.alt).split(',').forEach(part => {
            const pm = scoreTitleAgainstQuery(part, translatedNorm, translatedTokens);
            if (pm.score > tAlt) tAlt = pm.score;
          });
        }
        transScore = Math.round(Math.max(t1.score, t2.score, t3.score, tAlt * 0.9) * 0.94);
      }

      let enHintScore = 0;
      if (meta.hasStrongRuMatch && enAltNorms.length) {
        const topHint = enAltNorms[0];
        const topHintTokens = tokenizeSearchText(topHint);
        const h1 = scoreTitleAgainstQuery(item.en || '', topHint, topHintTokens);
        const h2 = scoreTitleAgainstQuery(item.romaji || '', topHint, topHintTokens);
        enHintScore = Math.round(Math.max(h1.score, h2.score) * 0.82);
      }

      let malBonus = 0;
      const itemMal = Number(item.mal) || 0;
      if (itemMal > 0 && malRankMap.has(itemMal)) {
        const pos = malRankMap.get(itemMal);
        const baseMal = meta.hasStrongRuMatch ? 780 : 420;
        malBonus = Math.max(120, baseMal - pos * 55);
      }

      // Совпадение по автору / студии
      let creditScore = 0;
      if (directScore === 0 && transScore === 0) {
        const authNorm = normalizeSearchText(item.author || '');
        const studNorm = normalizeSearchText(item.studio || '');
        if ((authNorm && authNorm.includes(normQ)) || (studNorm && studNorm.includes(normQ))) {
          creditScore = 260;
        }
      }

      const extRating = parseFloat(item.ext) || 0;
      const qualityBonus = extRating > 0 ? extRating * 16 : 0;
      const posterBonus = item.poster ? 18 : 0;
      const hasRuBonus = /[а-яё]/i.test(String(item.title || '')) ? 8 : 0;

      let penalty = 0;
      if (String(item.format || '').toUpperCase() === 'ONE_SHOT' && !qHasSpinoff) penalty += 40;
      const titleBag = normalizeSearchText([item.title, item.en, item.romaji].filter(Boolean).join(' '));
      if (!qHasSpinoff && SPINOFF_MARKER_RE.test(titleBag)) penalty += 38;

      const baseMatch = Math.max(directScore, transScore, enHintScore, malBonus, creditScore);
      const total = baseMatch + (malBonus > 0 && directScore > 0 ? 110 : 0) + qualityBonus + posterBonus + hasRuBonus - penalty;
      return { item, score: total, idx };
    });

    scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
    return scored.map(x => x.item);
  }

  function itemMatchesSearchText(item, rawQuery) {
    const qRaw = String(rawQuery || '').trim();
    if (!qRaw) return true;
    if (!item || typeof item !== 'object') return false;
    if (itemMatchesIdQuery(item, qRaw)) return true;

    const rawLow = qRaw.toLowerCase();
    const rawHay = [
      item.title,
      item.titleEn,
      item.romaji,
      item.titleOrig,
      item.alt,
      item.author,
      item.studio,
      item.source,
      item.year,
      Array.isArray(item.tags) ? item.tags.join(' ') : ''
    ].filter(Boolean).join(' ').toLowerCase();
    if (rawHay.includes(rawLow)) return true;

    const normQ = normalizeSearchText(qRaw);
    if (!normQ) return false;
    const normHay = normalizeSearchText(rawHay);
    if (normHay.includes(normQ)) return true;

    const qTokens = tokenizeSearchText(normQ);
    if (qTokens.length >= 2) {
      return qTokens.every(tok => normHay.includes(tok));
    }
    return false;
  }

  const STRICT_ANILIST_TAG_KEYS = new Set([
    'yuri', "girls' love", 'girls love', 'shoujo ai',
    "boys' love", 'boys love', 'yaoi', 'shounen ai'
  ]);
  const DEMOGRAPHIC_ANILIST_TAG_KEYS = new Set([
    'shounen', 'seinen', 'shoujo', 'josei', 'kids'
  ]);

  function getMinAniListTagRank(tagName) {
    const key = String(tagName || '').trim().toLowerCase();
    if (!key) return 65;
    if (STRICT_ANILIST_TAG_KEYS.has(key)) return 75;
    if (DEMOGRAPHIC_ANILIST_TAG_KEYS.has(key)) return 60;
    return 65;
  }

  function mapAniListTagAlias(tagName) {
    const raw = String(tagName || '').trim();
    const low = raw.toLowerCase();
    if (low === 'yuri' || low === "girls' love" || low === 'girls love' || low === 'shoujo ai') return 'Yuri';
    if (low === 'yaoi' || low === "boys' love" || low === 'boys love' || low === 'shounen ai') return "Boys' Love";
    if (low === 'harem') return 'Female Harem';
    if (low === 'reverse harem') return 'Male Harem';
    if (low === 'time travel') return 'Time Manipulation';
    return raw;
  }

  function computeAniListQueryMinTagRank(includeTags, excludeTags) {
    const all = [
      ...(Array.isArray(includeTags) ? includeTags : []),
      ...(Array.isArray(excludeTags) ? excludeTags : [])
    ].filter(Boolean);
    if (!all.length) return undefined;
    let minRank = 100;
    for (const tag of all) {
      const r = getMinAniListTagRank(tag);
      if (r < minRank) minRank = r;
    }
    return minRank;
  }

  function filterAniListTags(tagsArray, limit) {
    if (!Array.isArray(tagsArray) || !tagsArray.length) return [];
    const filtered = tagsArray
      .filter(t => t && typeof t === 'object' && t.name && !t.isMediaSpoiler && (Number(t.rank) || 0) >= getMinAniListTagRank(t.name))
      .sort((a, b) => (Number(b.rank) || 0) - (Number(a.rank) || 0));
    const maxN = Number(limit);
    return maxN > 0 ? filtered.slice(0, maxN) : filtered;
  }

  const EXPLICIT_YURI_TAG_KEYS = new Set([
    'erotica', 'nudity', 'bondage', 'bdsm', 'femdom', 'scissoring', 'tribadism',
    'cunnilingus', 'masturbation', 'exhibitionism', 'voyeur', 'netorare',
    'human pet', 'prostitution', 'rape', 'ahegao', 'public sex', 'defloration'
  ]);

  function isShoujoAiKey(tagName) {
    const low = String(tagName || '').trim().toLowerCase();
    return low === 'shoujo ai' || low === "girls' love" || low === 'girls love' || low === 'сёдзё-ай' || low === 'сёдзе-ай';
  }

  function isExplicitYuriKey(tagName) {
    const low = String(tagName || '').trim().toLowerCase();
    return low === 'yuri' || low === 'юри';
  }

  // Разделение тайтлов с женской романтикой AniList на лёгкий «Сёдзё-ай» ('Shoujo Ai') и откровенный/этти/18+ «Юри» ('Yuri')
  function classifyAniListYuriSubtype(mediaNode) {
    if (!mediaNode || typeof mediaNode !== 'object') return null;
    const genres = Array.isArray(mediaNode.genres)
      ? mediaNode.genres.map(g => String(g || '').trim().toLowerCase())
      : [];
    const rawTags = Array.isArray(mediaNode.tags) ? mediaNode.tags : [];
    const cleanTags = filterAniListTags(rawTags);
    const hasYuriTag = cleanTags.some(t => {
      const low = String(t.name || '').trim().toLowerCase();
      return low === 'yuri' || low === "girls' love" || low === 'girls love' || low === 'shoujo ai';
    });
    const hasGirlsLoveGenre = genres.includes("girls' love") || genres.includes('girls love') || genres.includes('yuri') || genres.includes('shoujo ai');
    if (!hasYuriTag && !hasGirlsLoveGenre) return null;

    if (Boolean(mediaNode.isAdult) || genres.includes('hentai') || genres.includes('ecchi')) {
      return 'Yuri';
    }
    const hasExplicitTag = rawTags.some(t => {
      if (!t || typeof t !== 'object' || t.isMediaSpoiler) return false;
      const low = String(t.name || '').trim().toLowerCase();
      const rank = Number(t.rank) || 0;
      return EXPLICIT_YURI_TAG_KEYS.has(low) && rank >= 60;
    });
    return hasExplicitTag ? 'Yuri' : 'Shoujo Ai';
  }

  // На Shikimori жанр «Yuri» (id 34/75) часто навешивается и на лёгкий сёдзё-ай (PG-13 вроде Bloom Into You / Citrus / YuruYuri).
  // Отделяем откровенное/этти/18+ Юри (rx / r_plus / Hentai / Ecchi / Erotica) от лёгкого Сёдзё-ай.
  function classifyShikimoriYuriSubtype(shikiNode) {
    if (!shikiNode || typeof shikiNode !== 'object') return null;
    const rawGenres = Array.isArray(shikiNode.genres)
      ? shikiNode.genres.map(g => String((g && g.name) || g || '').trim().toLowerCase())
      : (Array.isArray(shikiNode.rawGenres) ? shikiNode.rawGenres.map(g => String(g || '').trim().toLowerCase()) : []);
    const hasGirlsLove = rawGenres.some(g => g === 'yuri' || g === "girls' love" || g === 'girls love' || g === 'shoujo ai');
    if (!hasGirlsLove) return null;
    const rating = String(shikiNode.rating || '').trim().toLowerCase();
    const isExplicit = rating === 'rx' || rating === 'r_plus'
      || rawGenres.includes('hentai')
      || rawGenres.includes('ecchi')
      || rawGenres.includes('erotica');
    return isExplicit ? 'Yuri' : 'Shoujo Ai';
  }

  function getAniListYuriFilterMode(includeTags, excludeTags) {
    const inc = Array.isArray(includeTags) ? includeTags : [];
    const exc = Array.isArray(excludeTags) ? excludeTags : [];
    return {
      wantShoujoAi: inc.some(isShoujoAiKey),
      wantExplicitYuri: inc.some(isExplicitYuriKey),
      excludeShoujoAi: exc.some(isShoujoAiKey),
      excludeExplicitYuri: exc.some(isExplicitYuriKey)
    };
  }

  function matchesAniListYuriFilter(mediaNode, filterMode) {
    if (!filterMode || typeof filterMode !== 'object') return true;
    const { wantShoujoAi, wantExplicitYuri, excludeShoujoAi, excludeExplicitYuri } = filterMode;
    if (!wantShoujoAi && !wantExplicitYuri && !excludeShoujoAi && !excludeExplicitYuri) return true;
    const subtype = classifyAniListYuriSubtype(mediaNode);
    if (wantShoujoAi && !wantExplicitYuri && subtype !== 'Shoujo Ai') return false;
    if (wantExplicitYuri && !wantShoujoAi && subtype !== 'Yuri') return false;
    if (wantShoujoAi && wantExplicitYuri && !subtype) return false;
    if (excludeShoujoAi && subtype === 'Shoujo Ai') return false;
    if (excludeExplicitYuri && subtype === 'Yuri') return false;
    return true;
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
    SYSTEM_MANUAL_LIST_KEY,
    DEFAULT_MANUAL_LIST_NAME,
    isManualTitleItem,
    resolveManualListName,
    isSystemManualListRef,
    stripSystemManualListFromUserLists,
    itemMatchesListFilter,
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
    areFormatsCompatibleForAlts,
    areFormatsAndEpisodesCompatible,
    matchesCategoryFilter,
    computeCategoryStatusCounts,
    validateLoadedChunks,
    isTrackableProgressItem,
    getProgressUnit,
    isProgressLocked,
    clampWatchedEps,
    normalizeItemProgress,
    applyStatusProgressTransition,
    setWatchedEps,
    stepWatchedEps,
    computeCardProgressAction,
    completeItemFromProgress,
    restoreItemProgressSnapshot,
    collectCollectionActiveFilters,
    computeCardStaggerDelayMs,
    isShikimoriSuspiciousYaoiOnlyGenres,
    sanitizeSuspiciousShikiTags,
    extractCjkCore,
    isTmdbJapaneseAnime,
    areCategoriesCrossCompatibleForTmdbAnime,
    normalizeSeasonsMeta,
    watchedEpsToSeasonEp,
    seasonEpToWatchedEps,
    isCreatorNameMatch,
    getCreatorRoleTier,
    pickPrimaryAuthorsFromStaff,
    filterAndDedupCreatorWorks,
    resolveDisplayFormatLabel,
    resolveAdultFilterFlag,
    matchesAdultFilter,
    formatDurationMinsRu,
    formatOngoingDurationSummary,
    extractMissingSequels,
    serializeTitlePageSnapshot,
    parseTitlePageSnapshot,
    parseCatalogYearInput,
    buildFuzzyDateBounds,
    parseDirectIdQuery,
    collectExternalIdBadges,
    itemMatchesIdQuery,
    toggleTagInCommaList,
    shouldFallbackAfterCloudReadError,
    canCombineChunksAndProfileInSingleBatch,
    decodeFirestoreRestValue,
    decodeFirestoreRestDocument,
    isReadCategory,
    getStatusLabelForCategory,
    getCollectionStatusLabels,
    normalizeExternalRatingInput,
    hydrateStrippedBase64FromIdb,
    preserveLocalUploadedPostersOnCloudMerge,
    mapItemCategoryToCatalogSection,
    resolveCatalogTagKey,
    buildCatalogHistorySnapshot,
    buildCollectionHistorySnapshot,
    clearSearchForMetadataTransition,
    normalizeSearchText,
    tokenizeSearchText,
    extractRuCacheMatches,
    rankShikimoriRuCandidates,
    rankCatalogSearchResults,
    itemMatchesSearchText,
    getMinAniListTagRank,
    mapAniListTagAlias,
    computeAniListQueryMinTagRank,
    filterAniListTags,
    classifyAniListYuriSubtype,
    classifyShikimoriYuriSubtype,
    getAniListYuriFilterMode,
    matchesAniListYuriFilter
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.KirokuEngine = api;
  }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
