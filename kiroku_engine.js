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
    getGridSizeMobileMeta
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.KirokuEngine = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
