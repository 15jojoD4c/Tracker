import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const _loadedEngine = require('../../kiroku_engine.js');
const KirokuEngine = (_loadedEngine && typeof _loadedEngine.packCollectionChunks === 'function')
  ? _loadedEngine
  : (globalThis as Record<string, any>).KirokuEngine;

test('packCollectionChunks packs 500 typical items into 1-2 chunks under 680KB each and unpacks losslessly', () => {
  const items = Array.from({ length: 500 }, (_, idx) => ({
    id: 10000 + idx,
    title: `Тайтл номер ${idx + 1}`,
    titleEn: `Title Number ${idx + 1}`,
    category: idx % 3 === 0 ? 'Манга' : idx % 3 === 1 ? 'Аниме' : 'Фильм',
    status: idx % 2 === 0 ? 'Просмотрено/Прочитано' : 'В планах',
    rating: idx % 5 === 0 ? '9' : '',
    tags: ['Экшен', 'Фэнтези', 'Приключения'],
    poster: `https://example.com/posters/${idx}.jpg`,
    description: 'Короткое описание произведения для проверки упаковки в чанки.',
    dirty: true,
    _docId: `uid_${10000 + idx}`,
    userId: 'uid_test',
    kind: 'title',
    _normCache: { primary: ['test'] }
  }));

  const chunks = KirokuEngine.packCollectionChunks(items);
  assert.ok(chunks.length >= 1 && chunks.length <= 2, `Expected 1-2 chunks for 500 items, got ${chunks.length}`);
  for (const ch of chunks) {
    assert.ok(
      KirokuEngine.utf8ByteLength(ch.payloadJson) <= KirokuEngine.DEFAULT_CHUNK_MAX_BYTES,
      'Chunk exceeded safe byte cap'
    );
    assert.equal(ch.chunkTotal, chunks.length);
  }

  const unpacked = KirokuEngine.unpackCollectionChunks(chunks);
  assert.equal(unpacked.length, 500);
  assert.equal(unpacked[0].title, 'Тайтл номер 1');
  assert.equal(unpacked[499].id, 10499);
  assert.equal(unpacked[0].dirty, undefined);
  assert.equal(unpacked[0]._normCache, undefined);
});

test('packCollectionChunks respects custom small byte limit and splits cleanly', () => {
  const items = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1,
    title: 'Длинное название тайтла ' + 'А'.repeat(80) + i,
    status: 'В планах'
  }));
  const chunks = KirokuEngine.packCollectionChunks(items, 800);
  assert.ok(chunks.length > 3);
  for (const ch of chunks) {
    assert.ok(KirokuEngine.utf8ByteLength(ch.payloadJson) <= 800);
  }
  const unpacked = KirokuEngine.unpackCollectionChunks(chunks);
  assert.equal(unpacked.length, 20);
});

test('shouldPullCollectionFromCloud blocks self-echo and pending writes, pulls on empty or newer remote rev', () => {
  assert.equal(
    KirokuEngine.shouldPullCollectionFromCloud({
      hasPendingWrites: true,
      remoteColRev: 200,
      localRev: 100,
      itemsCount: 500
    }),
    false
  );
  assert.equal(
    KirokuEngine.shouldPullCollectionFromCloud({
      remoteWriter: 'tab_A',
      sessionWriter: 'tab_A',
      remoteColRev: 200,
      localRev: 100,
      itemsCount: 500
    }),
    false
  );
  assert.equal(
    KirokuEngine.shouldPullCollectionFromCloud({
      remoteWriter: 'tab_B',
      sessionWriter: 'tab_A',
      remoteColRev: 200,
      localRev: 100,
      itemsCount: 500
    }),
    true
  );
  assert.equal(
    KirokuEngine.shouldPullCollectionFromCloud({
      remoteWriter: 'tab_A',
      sessionWriter: 'tab_A',
      remoteColRev: 100,
      localRev: 100,
      itemsCount: 0,
      remoteColCount: 500
    }),
    true
  );
});

test('runPrimaryFirstWaterfall stops immediately after primary when enough items returned', async () => {
  const called: string[] = [];
  const res = await KirokuEngine.runPrimaryFirstWaterfall(
    [
      {
        name: 'AniList',
        timeoutMs: 1000,
        run: async () => {
          called.push('AniList');
          return Array.from({ length: 15 }, (_, i) => ({ id: i + 1, title: `A${i}` }));
        }
      },
      {
        name: 'Shikimori',
        timeoutMs: 1000,
        run: async () => {
          called.push('Shikimori');
          return [{ id: 99, title: 'Shiki' }];
        }
      },
      {
        name: 'MangaDex',
        timeoutMs: 1000,
        run: async () => {
          called.push('MangaDex');
          return [{ id: 100, title: 'MD' }];
        }
      }
    ],
    { minEnough: 12 }
  );

  assert.deepEqual(called, ['AniList']);
  assert.equal(res.items.length, 15);
  assert.deepEqual(res.usedSources, ['AniList']);
});

test('runPrimaryFirstWaterfall falls back to secondary sources only when primary is sparse or fails', async () => {
  const called: string[] = [];
  const res = await KirokuEngine.runPrimaryFirstWaterfall(
    [
      {
        name: 'AniList',
        timeoutMs: 500,
        run: async () => {
          called.push('AniList');
          return [{ id: 1, title: 'OnlyOne' }];
        }
      },
      {
        name: 'Shikimori',
        timeoutMs: 500,
        run: async () => {
          called.push('Shikimori');
          return Array.from({ length: 14 }, (_, i) => ({ id: 10 + i, title: `S${i}` }));
        }
      },
      {
        name: 'Jikan',
        timeoutMs: 500,
        run: async () => {
          called.push('Jikan');
          return [{ id: 999, title: 'ShouldNotRun' }];
        }
      }
    ],
    { minEnough: 12 }
  );

  assert.deepEqual(called, ['AniList', 'Shikimori']);
  assert.equal(res.items.length, 15);
  assert.deepEqual(res.usedSources, ['AniList', 'Shikimori']);
});

test('runPrimaryFirstWaterfall respects AbortController cancellation', async () => {
  const ctrl = new AbortController();
  const called: string[] = [];
  const res = await KirokuEngine.runPrimaryFirstWaterfall(
    [
      {
        name: 'Primary',
        timeoutMs: 500,
        run: async () => {
          called.push('Primary');
          ctrl.abort();
          return [{ id: 1 }];
        }
      },
      {
        name: 'Secondary',
        timeoutMs: 500,
        run: async () => {
          called.push('Secondary');
          return [{ id: 2 }];
        }
      }
    ],
    { minEnough: 12, signal: ctrl.signal }
  );

  assert.deepEqual(called, ['Primary']);
  assert.equal(res.aborted, true);
});

test('catalog cache stores, clones, expires by TTL, and mobile grid size cycles sm/md/lg', () => {
  const cache = KirokuEngine.createCatalogCache(1000, 2);
  const k1 = KirokuEngine.buildCatalogCacheKey({ g: 'Манга', mode: 'actual', page: 1, tags: ['t:Yuri'] });
  cache.set(k1, [{ title: 'Bloom Into You' }], 100);
  const hit = cache.get(k1, 500);
  assert.equal(hit?.length, 1);
  assert.equal(hit?.[0].title, 'Bloom Into You');
  assert.equal(cache.get(k1, 1200), null);

  assert.equal(KirokuEngine.getNextMobileGridSize(190), 150);
  assert.equal(KirokuEngine.getNextMobileGridSize(150), 240);
  assert.equal(KirokuEngine.getNextMobileGridSize(240), 190);
  assert.equal(KirokuEngine.getGridSizeMobileMeta(150).cols, 3);
});

test('isManualTitleItem returns true only for manually added titles without external catalog links', () => {
  assert.equal(KirokuEngine.isManualTitleItem({ id: 1, title: 'Мой фильм', category: 'Фильм' }), true);
  assert.equal(KirokuEngine.isManualTitleItem({ id: 2, title: 'Из импорта без ID', extSrc: 'Anixart' }), true);
  assert.equal(KirokuEngine.isManualTitleItem({ id: 3, title: 'AniList anime', aniId: 12345 }), false);
  assert.equal(KirokuEngine.isManualTitleItem({ id: 4, title: 'MAL manga', mal: 54321 }), false);
  assert.equal(KirokuEngine.isManualTitleItem({ id: 5, title: 'TMDB movie', tmdb: 'movie/550' }), false);
  assert.equal(KirokuEngine.isManualTitleItem({ id: 6, title: 'Shikimori', shikiId: 999 }), false);
  assert.equal(KirokuEngine.isManualTitleItem({ id: 7, title: 'MangaDex', mdId: 'abc-123' }), false);
  assert.equal(KirokuEngine.isManualTitleItem({ id: 8, title: 'Catalog preview', src: 'AniList' }), false);
  assert.equal(KirokuEngine.isManualTitleItem({ id: 9, title: 'External URL', url: 'https://anilist.co/anime/1' }), false);
});

test('resolveBestTitleDescription merges collection, mini-card fallback, and Russian cache cleanly', () => {
  assert.equal(
    KirokuEngine.resolveBestTitleDescription(
      { id: 1, description: '' },
      { desc: 'Описание из мини-карточки каталога' },
      ''
    ),
    'Описание из мини-карточки каталога'
  );
  assert.equal(
    KirokuEngine.resolveBestTitleDescription(
      { id: 1, description: 'English synopsis' },
      { desc: '' },
      'Русский синопсис из кэша'
    ),
    'Русский синопсис из кэша'
  );
  assert.equal(
    KirokuEngine.resolveBestTitleDescription({ id: 1 }, { id: 1 }, ''),
    ''
  );
});

test('filterAndListCollections shows all existing collections, filters live, and detects new names', () => {
  const resAll = KirokuEngine.filterAndListCollections(
    ['Любимое аниме', 'На вечер', 'любимое аниме'],
    ['На вечер'],
    '',
    { 'любимое аниме': 5, 'на вечер': 2 }
  );
  assert.equal(resAll.totalCount, 2);
  assert.equal(resAll.items.length, 2);
  assert.equal(resAll.canCreateNew, false);
  assert.deepEqual(resAll.items.map((x: { name: string }) => x.name), ['Любимое аниме', 'На вечер']);
  assert.equal(resAll.items[1].inList, true);
  assert.equal(resAll.items[0].count, 5);

  const resSearch = KirokuEngine.filterAndListCollections(
    ['Любимое аниме', 'На вечер'],
    ['На вечер'],
    'веч'
  );
  assert.equal(resSearch.items.length, 1);
  assert.equal(resSearch.items[0].name, 'На вечер');
  assert.equal(resSearch.canCreateNew, true);

  const resExact = KirokuEngine.filterAndListCollections(
    ['На вечер'],
    [],
    'на вечер'
  );
  assert.equal(resExact.items.length, 1);
  assert.equal(resExact.canCreateNew, false);
});

test('packCollectionChunks preserves new Отложено status cleanly', () => {
  const chunks = KirokuEngine.packCollectionChunks([
    { id: 777, title: 'Отложенное аниме', status: 'Отложено', category: 'Аниме' }
  ]);
  const unpacked = KirokuEngine.unpackCollectionChunks(chunks);
  assert.equal(unpacked.length, 1);
  assert.equal(unpacked[0].status, 'Отложено');
});

test('canWriteCollectionChunksToCloud blocks overwrite before initial cloud sync or when initial sync is blocked', () => {
  // New device / cleared browser: local user adds 1 item before initial cloud sync finishes -> MUST BLOCK
  assert.deepEqual(
    KirokuEngine.canWriteCollectionChunksToCloud({
      initialCloudSyncDone: false,
      initialCloudSyncBlocked: false,
      localCount: 1,
      knownCloudCount: 500
    }),
    { allowed: false, reason: 'initial_sync_pending' }
  );

  // Unknown cloud count before initial sync -> MUST BLOCK
  assert.deepEqual(
    KirokuEngine.canWriteCollectionChunksToCloud({
      initialCloudSyncDone: false,
      initialCloudSyncBlocked: false,
      localCount: 3,
      knownCloudCount: null
    }),
    { allowed: false, reason: 'initial_sync_pending' }
  );

  // Initial sync failed / blocked -> MUST BLOCK
  assert.deepEqual(
    KirokuEngine.canWriteCollectionChunksToCloud({
      initialCloudSyncDone: true,
      initialCloudSyncBlocked: true,
      localCount: 2,
      knownCloudCount: 500
    }),
    { allowed: false, reason: 'initial_sync_blocked' }
  );

  // Accidental empty overwrite when cloud has items and explicitEmptyAllowed is false -> MUST BLOCK
  assert.deepEqual(
    KirokuEngine.canWriteCollectionChunksToCloud({
      initialCloudSyncDone: true,
      initialCloudSyncBlocked: false,
      localCount: 0,
      knownCloudCount: 120,
      explicitEmptyAllowed: false
    }),
    { allowed: false, reason: 'empty_overwrite_blocked' }
  );

  // Explicit delete to 0 after initial sync -> ALLOWED
  assert.deepEqual(
    KirokuEngine.canWriteCollectionChunksToCloud({
      initialCloudSyncDone: true,
      initialCloudSyncBlocked: false,
      localCount: 0,
      knownCloudCount: 120,
      explicitEmptyAllowed: true
    }),
    { allowed: true, reason: 'ok' }
  );

  // Normal write after initial sync -> ALLOWED
  assert.deepEqual(
    KirokuEngine.canWriteCollectionChunksToCloud({
      initialCloudSyncDone: true,
      initialCloudSyncBlocked: false,
      localCount: 501,
      knownCloudCount: 500
    }),
    { allowed: true, reason: 'ok' }
  );

  // Explicit replaceAll force overwrite -> ALLOWED
  assert.deepEqual(
    KirokuEngine.canWriteCollectionChunksToCloud({
      initialCloudSyncDone: false,
      initialCloudSyncBlocked: true,
      localCount: 10,
      knownCloudCount: 500,
      forceAllowOverwrite: true
    }),
    { allowed: true, reason: 'force_overwrite' }
  );
});

test('splitChunksIntoBatches keeps every Firestore writeBatch within max chunk count and byte cap', () => {
  // 20 chunks of ~650KB each (~13MB total) must be split into batches <= 8 chunks and <= 5.5MB
  const bigPayload = 'x'.repeat(650000);
  const chunks = Array.from({ length: 20 }, (_, idx) => ({
    chunkIdx: idx,
    chunkTotal: 20,
    count: 250,
    payloadJson: bigPayload
  }));

  const batches = KirokuEngine.splitChunksIntoBatches(chunks, 8, 5500000);
  assert.ok(batches.length >= 3, `Expected at least 3 batches, got ${batches.length}`);
  let flattenedCount = 0;
  for (const batch of batches) {
    assert.ok(batch.length <= 8);
    const totalBytes = batch.reduce(
      (sum: number, c: { payloadJson: string }) => sum + KirokuEngine.utf8ByteLength(c.payloadJson) + 512,
      0
    );
    assert.ok(totalBytes <= 5500000, `Batch exceeded 5.5MB cap: ${totalBytes}`);
    flattenedCount += batch.length;
  }
  assert.equal(flattenedCount, 20);
});

test('pickFresherLocalItems chooses fresher timestamp over larger stale IndexedDB array', () => {
  // User deleted 2 items and closed tab before IDB finished writing: LS has 1 item (newer), IDB has 3 items (older)
  const resDeleteRace = KirokuEngine.pickFresherLocalItems({
    idbItems: [{ id: 1 }, { id: 2 }, { id: 3 }],
    idbUpdatedAt: 1000,
    lsItems: [{ id: 1 }],
    lsUpdatedAt: 2000,
    lsMetaCount: 1
  });
  assert.equal(resDeleteRace.source, 'ls');
  assert.equal(resDeleteRace.items.length, 1);

  // User deleted down to 0 items synchronously in LS before IDB finished
  const resDeleteAllRace = KirokuEngine.pickFresherLocalItems({
    idbItems: [{ id: 1 }],
    idbUpdatedAt: 1000,
    lsItems: [],
    lsUpdatedAt: 2500,
    lsMetaCount: 0
  });
  assert.equal(resDeleteAllRace.source, 'ls');
  assert.equal(resDeleteAllRace.items.length, 0);

  // Huge collection where LS quota failed and stayed stale while IDB wrote newer snapshot
  const resIdbFresher = KirokuEngine.pickFresherLocalItems({
    idbItems: [{ id: 1, title: 'Updated' }, { id: 2 }],
    idbUpdatedAt: 3000,
    lsItems: [{ id: 1, title: 'Old' }],
    lsUpdatedAt: 1500,
    lsMetaCount: 1
  });
  assert.equal(resIdbFresher.source, 'idb');
  assert.equal(resIdbFresher.items.length, 2);

  // Same timestamp -> prefer IDB (untruncated copy)
  const resEqualTs = KirokuEngine.pickFresherLocalItems({
    idbItems: [{ id: 1, description: 'Full description' }],
    idbUpdatedAt: 4000,
    lsItems: [{ id: 1, description: 'Truncated' }],
    lsUpdatedAt: 4000,
    lsMetaCount: 1
  });
  assert.equal(resEqualTs.source, 'idb');
  assert.equal(resEqualTs.items[0].description, 'Full description');

  // Corrupted/evicted LS (empty array when meta expected >0) -> fallback to IDB
  const resEvictedLs = KirokuEngine.pickFresherLocalItems({
    idbItems: [{ id: 1 }, { id: 2 }],
    idbUpdatedAt: 1000,
    lsItems: [],
    lsUpdatedAt: 2000,
    lsMetaCount: 2
  });
  assert.equal(resEvictedLs.source, 'idb');
  assert.equal(resEvictedLs.items.length, 2);
});

test('filterUnpackedItemsByDeletes removes offline-deleted and recently-deleted items by id, _docId, or uid_id', () => {
  const unpacked = [
    { id: 101, title: 'Keep Me' },
    { id: 102, title: 'Deleted By Prefixed DocId' },
    { id: 103, title: 'Deleted By Raw Id' },
    { id: 104, _docId: 'legacy_104', title: 'Deleted By Legacy DocId' },
    { id: 105, title: 'Recently Deleted' }
  ];
  const filtered = KirokuEngine.filterUnpackedItemsByDeletes(
    unpacked,
    ['uid1_102', '103', 'legacy_104'],
    new Set(['105']),
    'uid1'
  );
  assert.deepEqual(
    filtered.map((x: { id: number }) => x.id),
    [101]
  );
});

test('splitOperationsIntoBatches splits large flush queues into batches of max 350', () => {
  const ops = Array.from({ length: 800 }, (_, i) => i + 1);
  const batches = KirokuEngine.splitOperationsIntoBatches(ops, 350);
  assert.equal(batches.length, 3);
  assert.equal(batches[0].length, 350);
  assert.equal(batches[1].length, 350);
  assert.equal(batches[2].length, 100);
});

test('shouldClearDirtyAfterCommit clears dirty only if updatedAt was not bumped during in-flight commit', () => {
  assert.equal(KirokuEngine.shouldClearDirtyAfterCommit(1700000001000, 1700000001000), true);
  assert.equal(KirokuEngine.shouldClearDirtyAfterCommit(1700000002500, 1700000001000), false);
  assert.equal(KirokuEngine.shouldClearDirtyAfterCommit(0, 0), true);
});

test('shouldBlockLegacyEmptyInitialSync blocks initial sync completion on empty legacy cache/offline snapshot', () => {
  // New device on legacy schema, 0 items returned from Firestore cache -> MUST BLOCK
  assert.equal(
    KirokuEngine.shouldBlockLegacyEmptyInitialSync({
      colStorageV2: false,
      loadedCount: 0,
      fromCache: true,
      isOnline: true
    }),
    true
  );
  // Offline with 0 items on legacy schema -> MUST BLOCK
  assert.equal(
    KirokuEngine.shouldBlockLegacyEmptyInitialSync({
      colStorageV2: false,
      loadedCount: 0,
      fromCache: false,
      isOnline: false
    }),
    true
  );
  // Online server response with 0 items -> genuinely new empty account, DO NOT BLOCK
  assert.equal(
    KirokuEngine.shouldBlockLegacyEmptyInitialSync({
      colStorageV2: false,
      loadedCount: 0,
      fromCache: false,
      isOnline: true
    }),
    false
  );
  // Legacy schema with >0 loaded items -> DO NOT BLOCK
  assert.equal(
    KirokuEngine.shouldBlockLegacyEmptyInitialSync({
      colStorageV2: false,
      loadedCount: 42,
      fromCache: true,
      isOnline: true
    }),
    false
  );
  // Already migrated V2 chunk storage -> DO NOT BLOCK
  assert.equal(
    KirokuEngine.shouldBlockLegacyEmptyInitialSync({
      colStorageV2: true,
      loadedCount: 0,
      fromCache: true,
      isOnline: true
    }),
    false
  );
});

test('areCategoriesCompatibleForExternalId allows Manga/Ranobe cross-matching while separating Anime from Manga', () => {
  assert.equal(KirokuEngine.areCategoriesCompatibleForExternalId('Манга', 'Ранобэ'), true);
  assert.equal(KirokuEngine.areCategoriesCompatibleForExternalId('Ранобэ', 'Манга'), true);
  assert.equal(KirokuEngine.areCategoriesCompatibleForExternalId('Аниме', 'Манга'), false);
  assert.equal(KirokuEngine.areCategoriesCompatibleForExternalId('Аниме', 'Ранобэ'), false);
  assert.equal(KirokuEngine.areCategoriesCompatibleForExternalId('Мультфильм', 'Фильм'), true);
  assert.equal(KirokuEngine.areCategoriesCompatibleForExternalId('Аниме', 'Аниме'), true);
});

test('areSeasonMarkersCompatible protects distinct seasons while allowing empty marker without season conflict', () => {
  assert.equal(KirokuEngine.areSeasonMarkersCompatible('', ''), true);
  assert.equal(KirokuEngine.areSeasonMarkersCompatible('s2', 's2'), true);
  assert.equal(KirokuEngine.areSeasonMarkersCompatible('', 's2'), false);
  assert.equal(KirokuEngine.areSeasonMarkersCompatible('s2', 's3'), false);
  assert.equal(KirokuEngine.areSeasonMarkersCompatible('', 'ova'), true);
  assert.equal(KirokuEngine.areSeasonMarkersCompatible('', 'фильм'), true);
  assert.equal(KirokuEngine.areSeasonMarkersCompatible('ova', 'фильм'), false);
  assert.equal(KirokuEngine.areSeasonMarkersCompatible('s2_p2', 's2_p3'), false);
  assert.equal(KirokuEngine.areSeasonMarkersCompatible('s2', 's2_p2'), true);
});
