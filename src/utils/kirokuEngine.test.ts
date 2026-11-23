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
  const kFin = KirokuEngine.buildCatalogCacheKey({ g: 'Манга', mode: 'actual', page: 1, finOnly: true, tags: ['t:Yuri'] });
  const kOng = KirokuEngine.buildCatalogCacheKey({ g: 'Манга', mode: 'actual', page: 1, ongOnly: true, tags: ['t:Yuri'] });
  assert.notEqual(k1, kFin);
  assert.notEqual(kFin, kOng);
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

test('areSeasonMarkersCompatible strictly separates distinct seasons and empty fmt (TV) vs movie/ova/special while treating ona as TV-compatible', () => {
  assert.equal(KirokuEngine.areSeasonMarkersCompatible('', ''), true);
  assert.equal(KirokuEngine.areSeasonMarkersCompatible('s2', 's2'), true);
  assert.equal(KirokuEngine.areSeasonMarkersCompatible('', 's2'), false);
  assert.equal(KirokuEngine.areSeasonMarkersCompatible('s2', 's3'), false);
  assert.equal(KirokuEngine.areSeasonMarkersCompatible('', 'ova'), false);
  assert.equal(KirokuEngine.areSeasonMarkersCompatible('', 'фильм'), false);
  assert.equal(KirokuEngine.areSeasonMarkersCompatible('', 'ona'), true);
  assert.equal(KirokuEngine.areSeasonMarkersCompatible('', 'спешл'), false);
  assert.equal(KirokuEngine.areSeasonMarkersCompatible('фильм', 'фильм'), true);
  assert.equal(KirokuEngine.areSeasonMarkersCompatible('ova', 'ova'), true);
  assert.equal(KirokuEngine.areSeasonMarkersCompatible('ova', 'фильм'), false);
  assert.equal(KirokuEngine.areSeasonMarkersCompatible('s2_p2', 's2_p3'), false);
  assert.equal(KirokuEngine.areSeasonMarkersCompatible('s2', 's2_p2'), true);
});

test('inferNormalizedFormat and areFormatsAndEpisodesCompatible prevent TV series from merging with Movies/OVA/Specials', () => {
  assert.equal(KirokuEngine.inferNormalizedFormat({ title: 'Kimetsu no Yaiba Gekijouban: Mugen Ressha-hen' }), 'MOVIE');
  assert.equal(KirokuEngine.inferNormalizedFormat({ title: 'Атака титанов: Полнометражный фильм' }), 'MOVIE');
  assert.equal(KirokuEngine.inferNormalizedFormat({ title: 'Re:Zero Theatrical Edition' }), 'MOVIE');
  assert.equal(KirokuEngine.inferNormalizedFormat({ title: 'Блич: Спецвыпуск' }), 'SPECIAL');
  assert.equal(KirokuEngine.inferNormalizedFormat({ title: 'One Piece TV Special' }), 'SPECIAL');
  assert.equal(KirokuEngine.inferNormalizedFormat({ title: 'Naruto Recap' }), 'SPECIAL');
  assert.equal(KirokuEngine.inferNormalizedFormat({ type: 'OVA' }), 'OVA');
  assert.equal(KirokuEngine.inferNormalizedFormat({ format: 'TV' }), 'TV');

  // MOVIE/OVA/SPECIAL vs TV/TV_SHORT/ONA -> incompatible
  assert.equal(KirokuEngine.areFormatsAndEpisodesCompatible({ category: 'Аниме', format: 'MOVIE' }, { category: 'Аниме', format: 'TV' }), false);
  assert.equal(KirokuEngine.areFormatsAndEpisodesCompatible({ category: 'Аниме', format: 'OVA' }, { category: 'Аниме', format: 'TV' }), false);
  assert.equal(KirokuEngine.areFormatsAndEpisodesCompatible({ category: 'Аниме', format: 'SPECIAL' }, { category: 'Аниме', format: 'ONA' }), false);
  assert.equal(KirokuEngine.areFormatsAndEpisodesCompatible({ category: 'Аниме', title: 'Берсерк Gekijouban' }, { category: 'Аниме', format: 'TV', eps: 25 }), false);
  assert.equal(KirokuEngine.areFormatsAndEpisodesCompatible({ category: 'Аниме', format: 'MOVIE' }, { category: 'Аниме', format: 'OVA' }), false);

  // Critical episode count mismatch: 1-2 eps vs >= 6 eps -> incompatible
  assert.equal(KirokuEngine.areFormatsAndEpisodesCompatible({ category: 'Аниме', eps: 1 }, { category: 'Аниме', eps: 12 }), false);
  assert.equal(KirokuEngine.areFormatsAndEpisodesCompatible({ category: 'Аниме', eps: 2 }, { category: 'Аниме', eps: 24 }), false);
  assert.equal(KirokuEngine.areFormatsAndEpisodesCompatible({ category: 'Аниме', format: 'MOVIE', eps: 1 }, { category: 'Аниме', eps: 12 }), false);

  // Compatible cases
  assert.equal(KirokuEngine.areFormatsAndEpisodesCompatible({ category: 'Аниме', format: 'TV', eps: 12 }, { category: 'Аниме', format: 'TV', eps: 12 }), true);
  assert.equal(KirokuEngine.areFormatsAndEpisodesCompatible({ category: 'Аниме', format: 'MOVIE', eps: 1 }, { category: 'Аниме', format: 'MOVIE', eps: 1 }), true);
  assert.equal(KirokuEngine.areFormatsAndEpisodesCompatible({ category: 'Манга', eps: 1 }, { category: 'Манга', eps: 120 }), true);
});

test('computeCategoryStatusCounts filters status tab counts strictly by selected category and subkind', () => {
  const sample = [
    { id: 1, title: 'Anime 1', category: 'Аниме', status: 'Смотрю/Читаю', fav: true, format: 'TV' },
    { id: 2, title: 'Anime 2', category: 'Аниме', status: 'Пересматриваю', format: 'MOVIE' },
    { id: 3, title: 'Anime 3', category: 'Аниме', status: 'В планах', needsReview: true, format: 'TV' },
    { id: 4, title: 'Manga 1', category: 'Манга', status: 'Просмотрено/Прочитано', country: 'JP' },
    { id: 5, title: 'Manhwa 1', category: 'Манга', status: 'Отложено', country: 'KR', fav: true },
    { id: 6, title: 'Movie 1', category: 'Фильм', status: 'Просмотрено/Прочитано' },
    { id: 7, title: 'Series 1', category: 'Сериал', status: 'Брошено' },
    { id: 8, title: 'Archived Movie', category: 'Фильм', status: 'В планах', archived: true }
  ];
  const getMangaSubKind = (it: { country?: string }) => (it.country === 'KR' ? 'Манхва' : 'Манга');
  const getAnimeSubKind = (it: { format?: string }) => (it.format === 'MOVIE' ? 'Фильм' : 'Сериал');

  // Категория «Всё» считает всю коллекцию (включая старые записи с archived:true, т.к. Архив удалён — 8 записей)
  const allRes = KirokuEngine.computeCategoryStatusCounts(sample, {
    cat: 'Всё',
    getMangaSubKind,
    getAnimeSubKind
  });
  assert.equal(allRes.counts['Все'], 8);
  assert.equal(allRes.counts['Смотрю/Читаю'], 2);
  assert.equal(allRes.counts['В планах'], 2);
  assert.equal(allRes.counts['Просмотрено/Прочитано'], 2);
  assert.equal(allRes.counts['Отложено'], 1);
  assert.equal(allRes.counts['Брошено'], 1);
  assert.equal(allRes.counts['Любимое'], 2);
  assert.equal(allRes.reviewCount, 1);

  // Категория «Ранобэ» (0 тайтлов) -> все счётчики должны быть 0!
  const ranobeRes = KirokuEngine.computeCategoryStatusCounts(sample, {
    cat: 'Ранобэ',
    getMangaSubKind,
    getAnimeSubKind
  });
  assert.deepEqual(ranobeRes.counts, {
    'Все': 0,
    'Смотрю/Читаю': 0,
    'В планах': 0,
    'Просмотрено/Прочитано': 0,
    'Отложено': 0,
    'Брошено': 0,
    'Любимое': 0
  });
  assert.equal(ranobeRes.reviewCount, 0);

  // Категория «Кино и сериалы» + подтип «Фильм» (2 фильма, включая бывший архивный)
  const kinoAll = KirokuEngine.computeCategoryStatusCounts(sample, {
    cat: 'Кино и сериалы',
    videoSubKind: 'Все',
    getMangaSubKind,
    getAnimeSubKind
  });
  assert.equal(kinoAll.counts['Все'], 3);
  assert.equal(kinoAll.counts['Просмотрено/Прочитано'], 1);
  assert.equal(kinoAll.counts['В планах'], 1);
  assert.equal(kinoAll.counts['Брошено'], 1);

  const kinoMoviesOnly = KirokuEngine.computeCategoryStatusCounts(sample, {
    cat: 'Кино и сериалы',
    videoSubKind: 'Фильм',
    getMangaSubKind,
    getAnimeSubKind
  });
  assert.equal(kinoMoviesOnly.counts['Все'], 2);
  assert.equal(kinoMoviesOnly.counts['Просмотрено/Прочитано'], 1);
  assert.equal(kinoMoviesOnly.counts['В планах'], 1);
  assert.equal(kinoMoviesOnly.counts['Брошено'], 0);

  // Подтип Манги: только «Манхва»
  const manhwaOnly = KirokuEngine.computeCategoryStatusCounts(sample, {
    cat: 'Манга',
    kind: 'Манхва',
    getMangaSubKind,
    getAnimeSubKind
  });
  assert.equal(manhwaOnly.counts['Все'], 1);
  assert.equal(manhwaOnly.counts['Отложено'], 1);
  assert.equal(manhwaOnly.counts['Любимое'], 1);
  assert.equal(manhwaOnly.counts['Просмотрено/Прочитано'], 0);

  // Подтип Аниме: только «Фильм»
  const animeMovieOnly = KirokuEngine.computeCategoryStatusCounts(sample, {
    cat: 'Аниме',
    animeSubKind: 'Фильм',
    getMangaSubKind,
    getAnimeSubKind
  });
  assert.equal(animeMovieOnly.counts['Все'], 1);
  assert.equal(animeMovieOnly.counts['Смотрю/Читаю'], 1);
  assert.equal(animeMovieOnly.reviewCount, 0);
});

test('validateLoadedChunks detects incomplete or missing cloud chunks so partial reads never truncate collection', () => {
  const fullChunks = [
    { chunkIdx: 0, chunkTotal: 3, payloadJson: '[{"id":1}]' },
    { chunkIdx: 1, chunkTotal: 3, payloadJson: '[{"id":2}]' },
    { chunkIdx: 2, chunkTotal: 3, payloadJson: '[{"id":3}]' }
  ];
  assert.deepEqual(KirokuEngine.validateLoadedChunks(fullChunks, 3), {
    valid: true,
    missingIndices: [],
    expectedCount: 3,
    loadedCount: 3
  });

  // Missing chunk #1 -> invalid
  const missingMiddle = [fullChunks[0], fullChunks[2]];
  const resMissing = KirokuEngine.validateLoadedChunks(missingMiddle, 3);
  assert.equal(resMissing.valid, false);
  assert.deepEqual(resMissing.missingIndices, [1]);

  // Expected 0 chunks -> valid empty
  assert.equal(KirokuEngine.validateLoadedChunks([], 0).valid, true);

  // Declared chunkTotal higher than expectedCount -> still detects missing tail chunk
  const resMismatchTotal = KirokuEngine.validateLoadedChunks([fullChunks[0], fullChunks[1]], 2);
  assert.equal(resMismatchTotal.valid, false);
  assert.deepEqual(resMismatchTotal.missingIndices, [2]);

  // Corrupted chunk without payloadJson/items -> invalid
  const corrupted = [
    { chunkIdx: 0, chunkTotal: 2, payloadJson: '[{"id":1}]' },
    { chunkIdx: 1, chunkTotal: 2 }
  ];
  assert.equal(KirokuEngine.validateLoadedChunks(corrupted, 2).valid, false);
});

test('unpackCollectionChunks migrates legacy archived:true items to archived:false and omits archived on pack', () => {
  const legacyChunk = [{
    chunkIdx: 0,
    chunkTotal: 1,
    payloadJson: JSON.stringify([{ id: 501, title: 'Old Archived Anime', archived: true, watchedEps: 7 }])
  }];
  const unpacked = KirokuEngine.unpackCollectionChunks(legacyChunk);
  assert.equal(unpacked.length, 1);
  assert.equal(unpacked[0].archived, false);
  assert.equal(unpacked[0].watchedEps, 7);

  const repacked = KirokuEngine.packCollectionChunks([
    { id: 501, title: 'A', archived: true, watchedEps: 7 },
    { id: 502, title: 'B', watchedEps: 0 }
  ]);
  const reUnpacked = KirokuEngine.unpackCollectionChunks(repacked);
  assert.equal(reUnpacked[0].archived, undefined);
  assert.equal(reUnpacked[0].watchedEps, 7);
  assert.equal(reUnpacked[1].watchedEps, undefined);
});

test('smart episode/chapter progress tracker locks completed titles, allows dropped/paused/watching edits, and excludes movies', () => {
  assert.equal(KirokuEngine.isTrackableProgressItem({ category: 'Аниме', format: 'TV', eps: 12 }), true);
  assert.equal(KirokuEngine.isTrackableProgressItem({ category: 'Сериал', eps: 10 }), true);
  assert.equal(KirokuEngine.isTrackableProgressItem({ category: 'Манга', eps: 150 }), true);
  assert.equal(KirokuEngine.isTrackableProgressItem({ category: 'Ранобэ', eps: 40 }), true);
  assert.equal(KirokuEngine.isTrackableProgressItem({ category: 'Фильм', dur: 120 }), false);
  assert.equal(KirokuEngine.isTrackableProgressItem({ category: 'Аниме', format: 'MOVIE', eps: 1, dur: 110 }), false);

  assert.equal(KirokuEngine.getProgressUnit({ category: 'Манга' }), 'гл.');
  assert.equal(KirokuEngine.getProgressUnit({ category: 'Ранобэ' }), 'гл.');
  assert.equal(KirokuEngine.getProgressUnit({ category: 'Аниме' }), 'эп.');

  // Watching -> step +1 up to total
  const anime: Record<string, any> = { id: 1, category: 'Аниме', format: 'TV', status: 'Смотрю/Читаю', eps: 12, watchedEps: 5, rewatchCount: 1 };
  assert.equal(KirokuEngine.isProgressLocked(anime), false);
  const s1 = KirokuEngine.stepWatchedEps(anime, 1);
  assert.equal(s1.changed, true);
  assert.equal(s1.locked, false);
  assert.equal(anime.watchedEps, 6);

  // Dropped -> keeps 6 and remains editable
  anime.status = 'Брошено';
  KirokuEngine.applyStatusProgressTransition(anime, 'Брошено');
  assert.equal(anime.watchedEps, 6);
  assert.equal(KirokuEngine.isProgressLocked(anime), false);
  KirokuEngine.stepWatchedEps(anime, 1);
  assert.equal(anime.watchedEps, 7);

  // Completed -> auto-fills to 12, preserves rewatchCount, and LOCKS editing
  anime.status = 'Просмотрено/Прочитано';
  KirokuEngine.applyStatusProgressTransition(anime, 'Просмотрено/Прочитано');
  assert.equal(anime.watchedEps, 12);
  assert.equal(anime.rewatchCount, 1);
  assert.equal(KirokuEngine.isProgressLocked(anime), true);

  const lockedStep = KirokuEngine.stepWatchedEps(anime, -1);
  assert.equal(lockedStep.locked, true);
  assert.equal(lockedStep.changed, false);
  assert.equal(anime.watchedEps, 12);

  // Switch back to Отложено -> unlocks editing
  anime.status = 'Отложено';
  assert.equal(KirokuEngine.isProgressLocked(anime), false);
  const unlockedSet = KirokuEngine.setWatchedEps(anime, 8);
  assert.equal(unlockedSet.locked, false);
  assert.equal(unlockedSet.changed, true);
  assert.equal(anime.watchedEps, 8);

  // Reaches total flag when stepping from 11 to 12
  KirokuEngine.setWatchedEps(anime, 11);
  const reachRes = KirokuEngine.stepWatchedEps(anime, 1);
  assert.equal(reachRes.reachedTotal, true);
  assert.equal(anime.watchedEps, 12);
  // Clamping above total does not exceed eps
  const capRes = KirokuEngine.stepWatchedEps(anime, 5);
  assert.equal(capRes.changed, false);
  assert.equal(anime.watchedEps, 12);
});

test('isShikimoriSuspiciousYaoiOnlyGenres and sanitizeSuspiciousShikiTags catch and replace Shikimori GraphQL manga Yaoi bug', () => {
  // Manga with single Yaoi (id=65) -> suspicious (Shikimori GraphQL overwrites Shoujo Ai/Shounen Ai with Yaoi)
  assert.equal(KirokuEngine.isShikimoriSuspiciousYaoiOnlyGenres([{ id: '65', name: 'Yaoi', russian: 'Яой' }], false), true);
  assert.equal(KirokuEngine.isShikimoriSuspiciousYaoiOnlyGenres([{ id: 65, name: 'Yaoi', russian: 'Яой' }], false), true);
  // Anime is NOT affected
  assert.equal(KirokuEngine.isShikimoriSuspiciousYaoiOnlyGenres([{ id: '65', name: 'Yaoi', russian: 'Яой' }], true), false);
  // Multi-genre manga is NOT suspicious
  assert.equal(KirokuEngine.isShikimoriSuspiciousYaoiOnlyGenres([
    { id: '65', name: 'Yaoi', russian: 'Яой' },
    { id: '62', name: 'Romance', russian: 'Романтика' }
  ], false), false);
  // Non-Yaoi single genre is NOT suspicious
  assert.equal(KirokuEngine.isShikimoriSuspiciousYaoiOnlyGenres([{ id: '73', name: 'Shoujo Ai', russian: 'Сёдзе-ай' }], false), false);

  // Sanitize replaces bogus Yaoi with trusted REST/AniList Yuri genres
  assert.deepEqual(
    KirokuEngine.sanitizeSuspiciousShikiTags(['Яой'], ['Сёдзе-ай', 'Романтика', 'Школа', 'романтика']),
    ['Сёдзе-ай', 'Романтика', 'Школа']
  );
  // Empty trusted tags falls back safely without losing existing tags
  assert.deepEqual(KirokuEngine.sanitizeSuspiciousShikiTags(['Яой'], []), ['Яой']);
});

test('TMDB Japanese anime detection and cross-catalog compatibility match Naruto without false-matching live-action', () => {
  assert.equal(KirokuEngine.extractCjkCore('NARUTO -ナルト-'), 'ナルト');
  assert.equal(KirokuEngine.extractCjkCore('ナルト'), 'ナルト');
  assert.equal(KirokuEngine.extractCjkCore('NARUTO -ナルト- 疾風伝'), 'ナルト疾風伝');

  const tmdbNaruto = {
    category: 'Сериал',
    title: 'Наруто',
    orig: 'ナルト',
    tmdbGenreIds: [16, 10759, 10765],
    origLang: 'ja',
    originCountry: ['JP']
  };
  const aniNaruto = {
    category: 'Аниме',
    title: 'Naruto',
    titleOrig: 'NARUTO -ナルト-',
    format: 'TV',
    eps: 220
  };
  const aniNarutoMovie = {
    category: 'Аниме',
    title: 'Naruto Movie',
    format: 'MOVIE',
    eps: 1
  };
  const liveActionSeries = {
    category: 'Сериал',
    title: 'Клан Сопрано',
    orig: 'The Sopranos',
    tmdbGenreIds: [18, 80],
    origLang: 'en',
    originCountry: ['US']
  };
  const jpLiveAction = {
    category: 'Сериал',
    title: 'Alice in Borderland',
    orig: '今際の国のアリス',
    tmdbGenreIds: [18, 9648],
    origLang: 'ja',
    originCountry: ['JP']
  };

  assert.equal(KirokuEngine.isTmdbJapaneseAnime(tmdbNaruto), true);
  assert.equal(KirokuEngine.isTmdbJapaneseAnime(liveActionSeries), false);
  assert.equal(KirokuEngine.isTmdbJapaneseAnime(jpLiveAction), false);

  assert.equal(KirokuEngine.areCategoriesCrossCompatibleForTmdbAnime(aniNaruto, tmdbNaruto), true);
  assert.equal(KirokuEngine.areCategoriesCrossCompatibleForTmdbAnime(tmdbNaruto, aniNaruto), true);
  // TV TMDB anime should not cross-match an anime Movie
  assert.equal(KirokuEngine.areCategoriesCrossCompatibleForTmdbAnime(aniNarutoMovie, tmdbNaruto), false);
  // Live-action Japanese drama should not cross-match Anime
  assert.equal(KirokuEngine.areCategoriesCrossCompatibleForTmdbAnime(aniNaruto, jpLiveAction), false);
});

test('Season + Episode helpers map Sopranos S4 E9 <-> 48/86 watchedEps accurately across season boundaries', () => {
  // The Sopranos real season breakdown: 13 + 13 + 13 + 13 + 13 + 21 = 86
  const sopranosMeta = [
    { n: 1, eps: 13 },
    { n: 2, eps: 13 },
    { n: 3, eps: 13 },
    { n: 4, eps: 13 },
    { n: 5, eps: 13 },
    { n: 6, eps: 21 }
  ];
  assert.equal(KirokuEngine.seasonEpToWatchedEps(4, 9, sopranosMeta), 48);
  assert.deepEqual(KirokuEngine.watchedEpsToSeasonEp(48, sopranosMeta), {
    season: 4,
    ep: 9,
    seasonTotal: 13,
    totalEps: 86,
    watchedEps: 48
  });

  // Boundary transitions: S1 E13 -> 13, S2 E1 -> 14, S6 E21 -> 86
  assert.equal(KirokuEngine.seasonEpToWatchedEps(1, 13, sopranosMeta), 13);
  assert.deepEqual(KirokuEngine.watchedEpsToSeasonEp(13, sopranosMeta), {
    season: 1,
    ep: 13,
    seasonTotal: 13,
    totalEps: 86,
    watchedEps: 13
  });
  assert.deepEqual(KirokuEngine.watchedEpsToSeasonEp(14, sopranosMeta), {
    season: 2,
    ep: 1,
    seasonTotal: 13,
    totalEps: 86,
    watchedEps: 14
  });
  assert.equal(KirokuEngine.seasonEpToWatchedEps(6, 21, sopranosMeta), 86);
  assert.deepEqual(KirokuEngine.watchedEpsToSeasonEp(86, sopranosMeta), {
    season: 6,
    ep: 21,
    seasonTotal: 21,
    totalEps: 86,
    watchedEps: 86
  });

  // 0 watched -> S1 E0
  assert.deepEqual(KirokuEngine.watchedEpsToSeasonEp(0, sopranosMeta), {
    season: 1,
    ep: 0,
    seasonTotal: 13,
    totalEps: 86,
    watchedEps: 0
  });

  // Fallback even-split when only seasonsCount and totalEps are known
  const fallbackMeta = KirokuEngine.normalizeSeasonsMeta(null, 25, 2);
  assert.deepEqual(fallbackMeta, [{ n: 1, eps: 13 }, { n: 2, eps: 12 }]);
});

test('Witch Hat Atelier TV vs ONA and mislabeled 13-ep OVA merge cleanly while genuine 1-2 ep OVAs stay separate', () => {
  // TV (Shikimori) vs ONA (AniList) -> both series formats, compatible for both alts and eps
  assert.equal(KirokuEngine.areFormatsCompatibleForAlts('TV', 'ONA', 13, 13, false), true);
  assert.equal(KirokuEngine.areFormatsCompatibleForAlts('', 'ONA', 13, 13, false), true);
  assert.equal(
    KirokuEngine.areFormatsAndEpisodesCompatible(
      { category: 'Аниме', format: 'TV', eps: 13 },
      { category: 'Аниме', format: 'ONA', eps: 13 }
    ),
    true
  );

  // Mislabeled OVA with 13 eps vs TV with 13 eps -> compatible so duplicates can merge
  assert.equal(KirokuEngine.areFormatsCompatibleForAlts('OVA', 'TV', 13, 13, false), true);
  assert.equal(
    KirokuEngine.areFormatsAndEpisodesCompatible(
      { category: 'Аниме', format: 'OVA', eps: 13 },
      { category: 'Аниме', format: 'TV', eps: 13 }
    ),
    true
  );
  assert.equal(
    KirokuEngine.areFormatsAndEpisodesCompatible(
      { category: 'Аниме', format: 'OVA', eps: 13 },
      { category: 'Аниме', format: '', eps: 13 }
    ),
    true
  );

  // Real 1-2 ep OVA or Movie vs 13-ep TV -> MUST remain strictly incompatible
  assert.equal(KirokuEngine.areFormatsCompatibleForAlts('OVA', 'TV', 1, 13, false), false);
  assert.equal(KirokuEngine.areFormatsCompatibleForAlts('MOVIE', 'TV', 1, 13, false), false);
  assert.equal(
    KirokuEngine.areFormatsAndEpisodesCompatible(
      { category: 'Аниме', format: 'OVA', eps: 2 },
      { category: 'Аниме', format: 'TV', eps: 13 }
    ),
    false
  );
  assert.equal(
    KirokuEngine.areFormatsAndEpisodesCompatible(
      { category: 'Аниме', format: 'MOVIE', eps: 13 },
      { category: 'Аниме', format: 'TV', eps: 13 }
    ),
    false
  );

  // Older TMDB anime saved with Russian countries string ('Япония') is still recognized
  assert.equal(
    KirokuEngine.isTmdbJapaneseAnime({
      category: 'Сериал',
      tags: ['Мультфильм', 'Фэнтези'],
      countries: 'Япония'
    }),
    true
  );
});

test('isCreatorNameMatch, getCreatorRoleTier, pickPrimaryAuthorsFromStaff and filterAndDedupCreatorWorks exclude unrelated minor credits and duplicates', () => {
  // Name matching (exact, reversed order, rejects unrelated person)
  assert.equal(KirokuEngine.isCreatorNameMatch('Masashi Kishimoto', ['Masashi Kishimoto']), true);
  assert.equal(KirokuEngine.isCreatorNameMatch('Kishimoto Masashi', ['Masashi Kishimoto']), true);
  assert.equal(KirokuEngine.isCreatorNameMatch('Масаси Кисимото', ['Masashi Kishimoto', 'Масаси Кисимото']), true);
  assert.equal(KirokuEngine.isCreatorNameMatch('Масаси Кисимото', ['Сэйси Кисимото', 'Seishi Kishimoto']), false);

  // Role tiers: Original Creator > Director; Art Director / Sound Director / Episode Director / Storyboard -> 0
  assert.equal(KirokuEngine.getCreatorRoleTier('Original Creator', true), 3);
  assert.equal(KirokuEngine.getCreatorRoleTier('Автор оригинала', true), 3);
  assert.equal(KirokuEngine.getCreatorRoleTier('Director', true), 2);
  assert.equal(KirokuEngine.getCreatorRoleTier('Режиссёр', true), 2);
  assert.equal(KirokuEngine.getCreatorRoleTier('Art Director', true), 0);
  assert.equal(KirokuEngine.getCreatorRoleTier('Sound Director', true), 0);
  assert.equal(KirokuEngine.getCreatorRoleTier('Episode Director (ep 14)', true), 0);
  assert.equal(KirokuEngine.getCreatorRoleTier('Раскадровка', true), 0);
  assert.equal(KirokuEngine.getCreatorRoleTier('Режиссёр эпизодов', true), 0);
  assert.equal(KirokuEngine.getCreatorRoleTier('Помощник режиссёра', true), 0);

  // pickPrimaryAuthorsFromStaff puts Original Creator first and ignores Art/Sound/Episode Director
  const picked = KirokuEngine.pickPrimaryAuthorsFromStaff([
    { name: 'Shigenori Takada', role: 'Art Director' },
    { name: 'Yasunori Ebina', role: 'Sound Director' },
    { name: 'Hayato Date', role: 'Director' },
    { name: 'Masashi Kishimoto', role: 'Original Creator' },
    { name: 'Someone Else', role: 'Episode Director' }
  ], true, 2);
  assert.deepEqual(picked, ['Masashi Kishimoto', 'Hayato Date']);

  // filterAndDedupCreatorWorks: Hayato Date keeps ONLY Director credits and excludes 49 Storyboard/Episode Director anime
  const dateWorks = KirokuEngine.filterAndDedupCreatorWorks([
    { idKey: 'A:20', role: 'Режиссёр', popularity: 900, item: { title: 'Наруто', category: 'Аниме' } },
    { idKey: 'A:1735', role: 'Режиссёр', popularity: 850, item: { title: 'Наруто: Ураганные хроники', category: 'Аниме' } },
    { idKey: 'A:999', role: 'Раскадровка', popularity: 9999, item: { title: 'Чужое популярное аниме 1', category: 'Аниме' } },
    { idKey: 'A:998', role: 'Режиссёр эпизодов', popularity: 9998, item: { title: 'Чужое популярное аниме 2', category: 'Аниме' } },
    { idKey: 'A:997', role: 'Помощник режиссёра', popularity: 9997, item: { title: 'Чужое популярное аниме 3', category: 'Аниме' } }
  ]);
  assert.deepEqual(
    dateWorks.map((x: { title: string }) => x.title),
    ['Наруто', 'Наруто: Ураганные хроники']
  );

  // filterAndDedupCreatorWorks: deduplicates repeated AniList edges (e.g. Road to Ninja x3)
  const kishiWorks = KirokuEngine.filterAndDedupCreatorWorks([
    { idKey: 'ani:13667', role: 'Original Creator', popularity: 500, item: { title: 'Road to Ninja', category: 'Аниме' } },
    { idKey: 'ani:13667', role: 'Planning', popularity: 500, item: { title: 'Road to Ninja', category: 'Аниме' } },
    { idKey: 'ani:13667', role: 'Character Design', popularity: 500, item: { title: 'Road to Ninja', category: 'Аниме' } },
    { idKey: 'ani:20', role: 'Original Creator', popularity: 1000, item: { title: 'Naruto', category: 'Аниме' } }
  ]);
  assert.deepEqual(
    kishiWorks.map((x: { title: string }) => x.title),
    ['Naruto', 'Road to Ninja']
  );

  // TMDB Director: keeps directed films and excludes acting cameos
  const nolanWorks = KirokuEngine.filterAndDedupCreatorWorks([
    { idKey: 'movie/27205', role: 'Director', popularity: 800, item: { title: 'Начало', category: 'Фильм' } },
    { idKey: 'movie/27205', role: 'Writer', popularity: 800, item: { title: 'Начало', category: 'Фильм' } },
    { idKey: 'movie/157336', role: 'Director', popularity: 900, item: { title: 'Интерстеллар', category: 'Фильм' } },
    { idKey: 'movie/99999', role: 'Cast', popularity: 1200, item: { title: 'Документалка про кино (камео)', category: 'Фильм' } }
  ]);
  assert.deepEqual(
    nolanWorks.map((x: { title: string }) => x.title),
    ['Интерстеллар', 'Начало']
  );
});

test('isTmdbJapaneseAnime detects pure-Kanji anime like 呪術廻戦 when tmdbInfo fails, while rejecting live-action and Chinese animation', () => {
  // 1. Pure-Kanji anime card from TMDB where tmdbInfo failed (no origLang/originCountry, only Мультфильм tag + titleOrig)
  const jjkTmdb = {
    category: 'Сериал',
    title: 'Магическая битва',
    titleOrig: '呪術廻戦',
    tags: ['Мультфильм', 'Боевик и Приключения'],
    year: '2020'
  };
  const jjkAnime = {
    category: 'Аниме',
    title: 'Магическая битва',
    titleOrig: '呪術廻戦',
    format: 'TV',
    eps: 24,
    year: '2020'
  };
  assert.equal(KirokuEngine.isTmdbJapaneseAnime(jjkTmdb), true);
  assert.equal(KirokuEngine.areCategoriesCrossCompatibleForTmdbAnime(jjkAnime, jjkTmdb), true);

  // 2. Live-action series with the exact same Kanji title (NO Мультфильм/Animation tag, no genreId 16) -> MUST NOT merge
  const jjkLiveAction = {
    category: 'Сериал',
    title: 'Магическая битва',
    titleOrig: '呪術廻戦',
    tags: ['Боевик', 'Фэнтези'],
    origLang: 'ja',
    originCountry: ['JP'],
    year: '2020'
  };
  assert.equal(KirokuEngine.isTmdbJapaneseAnime(jjkLiveAction), false);
  assert.equal(KirokuEngine.areCategoriesCrossCompatibleForTmdbAnime(jjkAnime, jjkLiveAction), false);

  // 3. Chinese donghua with Kanji title and explicit zh/CN -> MUST NOT be treated as Japanese anime
  const cnDonghua = {
    category: 'Сериал',
    title: 'Магистр дьявольского культа',
    titleOrig: '魔道祖师',
    tags: ['Мультфильм', 'Фэнтези'],
    origLang: 'zh',
    originCountry: ['CN'],
    year: '2018'
  };
  assert.equal(KirokuEngine.isTmdbJapaneseAnime(cnDonghua), false);
});

test('resolveDisplayFormatLabel shows Манхва, Маньхуа and Комикс instead of generic Манга even when format is MANGA', () => {
  const FORMAT_RU = {
    TV: 'TV-сериал',
    MOVIE: 'Полнометражный фильм',
    MANGA: 'Манга',
    NOVEL: 'Ранобэ / Новелла',
    ONE_SHOT: 'Ваншот'
  };

  assert.equal(
    KirokuEngine.resolveDisplayFormatLabel({ category: 'Манга', format: 'MANGA', subKind: 'Манхва', kind: 'Манхва' }, FORMAT_RU),
    'Манхва'
  );
  assert.equal(
    KirokuEngine.resolveDisplayFormatLabel({ category: 'Манга', format: 'MANGA', subKind: 'Маньхуа', kind: 'Маньхуа' }, FORMAT_RU),
    'Маньхуа'
  );
  assert.equal(
    KirokuEngine.resolveDisplayFormatLabel({ category: 'Манга', format: 'MANGA', subKind: 'Комикс', kind: 'Комикс' }, FORMAT_RU),
    'Комикс'
  );
  assert.equal(
    KirokuEngine.resolveDisplayFormatLabel({ category: 'Манга', format: 'MANGA', subKind: 'Манга', kind: 'Манга' }, FORMAT_RU),
    'Манга'
  );
  assert.equal(
    KirokuEngine.resolveDisplayFormatLabel({ category: 'Манга', format: 'ONE_SHOT', subKind: 'Манга' }, FORMAT_RU),
    'Ваншот'
  );
  assert.equal(
    KirokuEngine.resolveDisplayFormatLabel({ category: 'Ранобэ', format: 'NOVEL', subKind: '' }, FORMAT_RU),
    'Ранобэ / Новелла'
  );
  assert.equal(
    KirokuEngine.resolveDisplayFormatLabel({ category: 'Аниме', format: 'TV' }, FORMAT_RU),
    'TV-сериал'
  );
});

test('resolveAdultFilterFlag and matchesAdultFilter include 18+ by default, hide on no, and isolate on only', () => {
  assert.equal(KirokuEngine.resolveAdultFilterFlag(''), undefined);
  assert.equal(KirokuEngine.resolveAdultFilterFlag('all'), undefined);
  assert.equal(KirokuEngine.resolveAdultFilterFlag('no'), false);
  assert.equal(KirokuEngine.resolveAdultFilterFlag('only'), true);

  const adultYuriManga = { title: '100 дней юри', isAdult: true, rawGenres: ['Romance', 'Hentai'], tags: ['Юри', 'Хентай (18+)'] };
  const normalManga = { title: 'Берсерк', isAdult: false, rawGenres: ['Action'], tags: ['Экшен'] };

  // Default ('') shows both normal and 18+ titles
  assert.equal(KirokuEngine.matchesAdultFilter(adultYuriManga, ''), true);
  assert.equal(KirokuEngine.matchesAdultFilter(normalManga, ''), true);

  // Explicit 'no' (Без 18+) hides 18+ titles
  assert.equal(KirokuEngine.matchesAdultFilter(adultYuriManga, 'no'), false);
  assert.equal(KirokuEngine.matchesAdultFilter(normalManga, 'no'), true);

  // Explicit 'only' (Только 18+) shows only 18+ titles
  assert.equal(KirokuEngine.matchesAdultFilter(adultYuriManga, 'only'), true);
  assert.equal(KirokuEngine.matchesAdultFilter(normalManga, 'only'), false);
});



