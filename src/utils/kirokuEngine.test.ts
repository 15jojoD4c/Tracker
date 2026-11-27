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

test('formatOngoingDurationSummary formats aired and planned watch/read times for ongoing anime, series, manga, and ranobe', () => {
  assert.equal(KirokuEngine.formatDurationMinsRu(45), '45 мин');
  assert.equal(KirokuEngine.formatDurationMinsRu(120), '2 ч');
  assert.equal(KirokuEngine.formatDurationMinsRu(288), '4 ч 48 мин');
  assert.equal(KirokuEngine.formatDurationMinsRu(24 * 60 * 3 + 5 * 60), '3 дн 5 ч');

  // 1. Ongoing anime with BOTH aired episodes and known planned total (5 of 12 eps, 24 min/ep)
  const seasonalOngoing = KirokuEngine.formatOngoingDurationSummary(
    { category: 'Аниме', ongoing: true, dur: 24, eps: 12, status: 'Смотрю/Читаю', watchedEps: 3 },
    { status: 'RELEASING', episodes: 12, duration: 24, nextAiringEpisode: { episode: 6 } }
  );
  assert.equal(seasonalOngoing.isOngoing, true);
  assert.equal(seasonalOngoing.airedCount, 5);
  assert.equal(seasonalOngoing.plannedCount, 12);
  assert.equal(seasonalOngoing.airedMinutes, 120);
  assert.equal(seasonalOngoing.plannedMinutes, 288);
  assert.match(seasonalOngoing.episodesLabel, /вышло 5 из 12 эп\./);
  assert.match(seasonalOngoing.durationLabel, /вышло 5 эп\. \(2 ч\)/);
  assert.match(seasonalOngoing.durationLabel, /всего запланировано 12 эп\. \(4 ч 48 мин\)/);
  assert.match(seasonalOngoing.durationLabel, /просмотрено 1 ч 12 мин/);

  // 2. Long ongoing anime with unknown total (e.g. One Piece: 1120 aired, planned=0)
  const longOngoing = KirokuEngine.formatOngoingDurationSummary(
    { category: 'Аниме', ongoing: true, dur: 24, eps: 1120, airedEps: 1120 },
    { status: 'RELEASING', episodes: 0, episodesAired: 1120, duration: 24 }
  );
  assert.equal(longOngoing.airedCount, 1120);
  assert.equal(longOngoing.plannedCount, 0);
  assert.match(longOngoing.episodesLabel, /вышло 1120 эп\./);
  assert.match(longOngoing.durationLabel, /вышло 1120 эп\./);
  assert.doesNotMatch(longOngoing.durationLabel, /запланировано/);

  // 3. Ongoing anime where only planned total is known (0 aired yet, 13 planned)
  const plannedOnly = KirokuEngine.formatOngoingDurationSummary(
    { category: 'Аниме', ongoing: true, dur: 24, eps: 13 },
    { status: 'RELEASING', episodes: 13, duration: 24 }
  );
  assert.equal(plannedOnly.airedCount, 0);
  assert.equal(plannedOnly.plannedCount, 13);
  assert.match(plannedOnly.durationLabel, /всего запланировано 13 эп\. \(5 ч 12 мин\)/);

  // 4. Manga & Ranobe do NOT estimate reading time (keeps chapter/volume counts only)
  const ongoingManga = KirokuEngine.formatOngoingDurationSummary(
    { category: 'Манга', ongoing: true, eps: 85, vols: 9, status: 'Смотрю/Читаю', watchedEps: 20 }
  );
  assert.equal(ongoingManga.isRead, true);
  assert.equal(ongoingManga.airedCount, 85);
  assert.equal(ongoingManga.airedMinutes, 0);
  assert.equal(ongoingManga.durationLabel, '');
  assert.equal(ongoingManga.shortBadge, '');
  assert.equal(ongoingManga.episodesLabel, '85 гл. · 9 т.');

  const ongoingRanobeWithPlan = KirokuEngine.formatOngoingDurationSummary(
    { category: 'Ранобэ', ongoing: true, airedEps: 18, eps: 30, vols: 3 }
  );
  assert.equal(ongoingRanobeWithPlan.airedMinutes, 0);
  assert.equal(ongoingRanobeWithPlan.plannedMinutes, 0);
  assert.equal(ongoingRanobeWithPlan.durationLabel, '');
  assert.equal(ongoingRanobeWithPlan.episodesLabel, 'вышло 18 из 30 гл. · 3 т.');
});

test('extractMissingSequels keeps only unowned sequels, filters out prequels/music/owned, deduplicates, and sorts released before announced', () => {
  const parents = [
    { id: 1, aniId: 20, mal: 20, title: 'Наруто', category: 'Аниме', status: 'Просмотрено/Прочитано' },
    { id: 2, aniId: 16498, mal: 16498, title: 'Атака титанов', category: 'Аниме', status: 'Просмотрено/Прочитано' }
  ];
  const ownedMals = new Set([20, 16498, 25777]); // AoT S2 (25777) already in collection

  const records = [
    // Owned sequel -> must be filtered out
    {
      parentItem: parents[1],
      relationType: 'SEQUEL',
      node: { aniId: 20958, mal: 25777, title: 'Атака титанов 2', category: 'Аниме', format: 'TV', status: 'FINISHED', year: 2017, extRating: '8.4' }
    },
    // Non-sequel (SIDE_STORY) -> must be filtered out
    {
      parentItem: parents[0],
      relationType: 'SIDE_STORY',
      node: { aniId: 9991, mal: 9991, title: 'Naruto OVA', category: 'Аниме', format: 'OVA', status: 'FINISHED', year: 2005 }
    },
    // Music format sequel -> must be filtered out
    {
      parentItem: parents[0],
      relationType: 'SEQUEL',
      node: { aniId: 9992, mal: 9992, title: 'Naruto MV', category: 'Аниме', format: 'MUSIC', status: 'FINISHED', year: 2020 }
    },
    // Announced sequel -> should sort AFTER released/ongoing
    {
      parentItem: parents[0],
      relationType: 'SEQUEL',
      node: { aniId: 173500, mal: 55555, title: 'Боруто: Два синих вихря', category: 'Аниме', format: 'TV', status: 'NOT_YET_RELEASED', year: 2027, extRating: '' }
    },
    // Ongoing sequel -> middle priority
    {
      parentItem: parents[0],
      relationType: 'SEQUEL',
      node: { aniId: 173501, mal: 55556, title: 'Наруто: Новый сезон', category: 'Аниме', format: 'TV', status: 'RELEASING', year: 2026, extRating: '8.1' }
    },
    // Released sequel (duplicate entry from two records) -> first priority, merged once
    {
      parentItem: parents[0],
      relationType: 'SEQUEL',
      node: { aniId: 1735, mal: 1735, title: 'Наруто: Ураганные хроники', category: 'Аниме', format: 'TV', status: 'FINISHED', year: 2007, extRating: '8.3' }
    },
    {
      parentItem: { id: 3, title: 'Наруто (пересмотр)' },
      relationType: 'sequel',
      node: { aniId: 1735, mal: 1735, title: 'Наруто: Ураганные хроники', category: 'Аниме', format: 'TV', status: 'FINISHED', year: 2007, poster: 'https://example.com/shippuden.jpg' }
    }
  ];

  const missing = KirokuEngine.extractMissingSequels(parents, records, (n: any) => ownedMals.has(Number(n.mal)), 2026);
  assert.equal(missing.length, 3);
  assert.equal(missing[0].aniId, 1735);
  assert.equal(missing[0].statusBucket, 'released');
  assert.deepEqual(missing[0].parentTitles, ['Наруто', 'Наруто (пересмотр)']);
  assert.equal(missing[0].poster, 'https://example.com/shippuden.jpg');
  assert.equal(missing[1].aniId, 173501);
  assert.equal(missing[1].statusBucket, 'ongoing');
  assert.equal(missing[2].aniId, 173500);
  assert.equal(missing[2].statusBucket, 'announced');
});

test('serializeTitlePageSnapshot and parseTitlePageSnapshot preserve core fields and reject invalid payloads', () => {
  const raw = KirokuEngine.serializeTitlePageSnapshot({
    id: 'local_42',
    aniId: 21,
    mal: 21,
    title: 'Ван-Пис',
    titleEn: 'One Piece',
    category: 'Аниме',
    format: 'TV',
    year: '1999',
    eps: 1122,
    ongoing: true,
    poster: 'https://example.com/op.jpg',
    banner: 'data:image/png;base64,HUGE_BASE64_SHOULD_BE_SKIPPED',
    tags: ['Приключения', 'Экшен'],
    desc: 'История о пиратах'
  });
  assert.ok(raw.length > 0 && raw.length < 2000);
  const parsed = KirokuEngine.parseTitlePageSnapshot(raw);
  assert.ok(parsed);
  assert.equal(parsed.id, 'local_42');
  assert.equal(parsed.aniId, 21);
  assert.equal(parsed.title, 'Ван-Пис');
  assert.equal(parsed.ongoing, true);
  assert.equal(parsed.poster, 'https://example.com/op.jpg');
  assert.equal(parsed.banner, undefined);
  assert.deepEqual(parsed.tags, ['Приключения', 'Экшен']);

  assert.equal(KirokuEngine.serializeTitlePageSnapshot(null), '');
  assert.equal(KirokuEngine.serializeTitlePageSnapshot({ title: '   ' }), '');
  assert.equal(KirokuEngine.parseTitlePageSnapshot(''), null);
  assert.equal(KirokuEngine.parseTitlePageSnapshot('{broken'), null);
  assert.equal(KirokuEngine.parseTitlePageSnapshot(JSON.stringify({ category: 'Аниме' })), null);
  assert.equal(KirokuEngine.parseTitlePageSnapshot('x'.repeat(20000)), null);
});

test('parseCatalogYearInput and buildFuzzyDateBounds ignore partial digits and produce valid YYYYMMDD bounds', () => {
  assert.equal(KirokuEngine.parseCatalogYearInput(''), 0);
  assert.equal(KirokuEngine.parseCatalogYearInput('2'), 0);
  assert.equal(KirokuEngine.parseCatalogYearInput('200'), 0);
  assert.equal(KirokuEngine.parseCatalogYearInput('1899'), 0);
  assert.equal(KirokuEngine.parseCatalogYearInput('2004'), 2004);

  const openEnd = KirokuEngine.buildFuzzyDateBounds('2004', '');
  assert.deepEqual(openEnd, { yrFrom: 2004, yrTo: 0, sg: 20031231, sl: undefined });

  const openStart = KirokuEngine.buildFuzzyDateBounds('', '2004');
  assert.deepEqual(openStart, { yrFrom: 0, yrTo: 2004, sg: undefined, sl: 20050101 });

  const reversed = KirokuEngine.buildFuzzyDateBounds('2020', '2004');
  assert.deepEqual(reversed, { yrFrom: 2004, yrTo: 2020, sg: 20031231, sl: 20210101 });
});

test('parseDirectIdQuery, collectExternalIdBadges, and itemMatchesIdQuery handle numeric and prefixed IDs cleanly', () => {
  assert.deepEqual(KirokuEngine.parseDirectIdQuery('154587'), { source: 'any', numericId: 154587, raw: '154587' });
  assert.deepEqual(KirokuEngine.parseDirectIdQuery('al:21'), { source: 'anilist', numericId: 21, raw: 'al:21' });
  assert.deepEqual(KirokuEngine.parseDirectIdQuery('mal:21'), { source: 'mal', numericId: 21, raw: 'mal:21' });
  assert.deepEqual(KirokuEngine.parseDirectIdQuery('tmdb:tv/1396'), { source: 'tmdb', tmdbType: 'tv', tmdbPath: 'tv/1396', numericId: 1396, raw: 'tmdb:tv/1396' });
  assert.deepEqual(KirokuEngine.parseDirectIdQuery('tt0903747'), { source: 'imdb', imdbId: 'tt0903747', numericId: 0, raw: 'tt0903747' });
  assert.deepEqual(
    KirokuEngine.parseDirectIdQuery('a96676e5-8ae2-425e-b549-7f15dd34a6d8'),
    { source: 'mangadex', mdId: 'a96676e5-8ae2-425e-b549-7f15dd34a6d8', numericId: 0, raw: 'a96676e5-8ae2-425e-b549-7f15dd34a6d8' }
  );
  assert.equal(KirokuEngine.parseDirectIdQuery('One Piece'), null);
  assert.equal(KirokuEngine.parseDirectIdQuery('100 дней юри'), null);

  const badges = KirokuEngine.collectExternalIdBadges({ aniId: 21, mal: 21, shikiId: 21, tmdb: 'tv/37854' });
  assert.equal(badges.length, 3);
  assert.equal(badges[0].label, 'AniList');
  assert.equal(badges[1].label, 'MAL / Shiki');
  assert.equal(badges[2].label, 'TMDB');

  const sampleItem = { id: 999, aniId: 154587, mal: 52991, tmdb: 'tv/1396', imdbId: 'tt0903747' };
  assert.equal(KirokuEngine.itemMatchesIdQuery(sampleItem, '154587'), true);
  assert.equal(KirokuEngine.itemMatchesIdQuery(sampleItem, 'mal:52991'), true);
  assert.equal(KirokuEngine.itemMatchesIdQuery(sampleItem, 'tmdb:1396'), true);
  assert.equal(KirokuEngine.itemMatchesIdQuery(sampleItem, 'tt0903747'), true);
  assert.equal(KirokuEngine.itemMatchesIdQuery(sampleItem, 'al:999999'), false);
});

test('toggleTagInCommaList adds and removes tags case-insensitively without duplicates', () => {
  const r1 = KirokuEngine.toggleTagInCommaList('Экшен, Драма', 'Фэнтези');
  assert.deepEqual(r1, { value: 'Экшен, Драма, Фэнтези', active: true });
  const r2 = KirokuEngine.toggleTagInCommaList(r1.value, 'драма');
  assert.deepEqual(r2, { value: 'Экшен, Фэнтези', active: false });
  const r3 = KirokuEngine.toggleTagInCommaList('', 'Юри');
  assert.deepEqual(r3, { value: 'Юри', active: true });
});

test('shouldFallbackAfterCloudReadError stops cascading timeout/quota queries while allowing schema fallbacks', () => {
  assert.equal(KirokuEngine.shouldFallbackAfterCloudReadError({ code: 'deadline-exceeded' }), false);
  assert.equal(KirokuEngine.shouldFallbackAfterCloudReadError({ code: 'resource-exhausted' }), false);
  assert.equal(KirokuEngine.shouldFallbackAfterCloudReadError({ code: 'unavailable' }), false);
  assert.equal(KirokuEngine.shouldFallbackAfterCloudReadError(new Error('Превышено время ожидания ответа Firestore')), false);
  assert.equal(KirokuEngine.shouldFallbackAfterCloudReadError({ code: 'permission-denied' }), true);
  assert.equal(KirokuEngine.shouldFallbackAfterCloudReadError({ code: 'failed-precondition' }), true);
  assert.equal(KirokuEngine.shouldFallbackAfterCloudReadError({ code: 'not-found' }), true);
});

test('canCombineChunksAndProfileInSingleBatch combines normal saves into 1 atomic batch and respects Firestore limits', () => {
  const smallChunk = { chunkIdx: 0, chunkTotal: 1, count: 120, payloadJson: JSON.stringify([{ id: 1, title: 'A' }]) };
  assert.equal(KirokuEngine.canCombineChunksAndProfileInSingleBatch([[smallChunk]], 0, 4096), true);
  assert.equal(KirokuEngine.canCombineChunksAndProfileInSingleBatch([], 2, 4096), true);
  assert.equal(KirokuEngine.canCombineChunksAndProfileInSingleBatch([[smallChunk], [smallChunk]], 0, 4096), false);
  assert.equal(KirokuEngine.canCombineChunksAndProfileInSingleBatch([[smallChunk]], 301, 4096), false);
  assert.equal(KirokuEngine.canCombineChunksAndProfileInSingleBatch([[smallChunk]], 0, 7000000), false);
});

test('decodeFirestoreRestDocument decodes nested Firestore REST fields cleanly', () => {
  const decoded = KirokuEngine.decodeFirestoreRestDocument({
    name: 'projects/test/databases/(default)/documents/items/prof_u1',
    fields: {
      name: { stringValue: 'Aki' },
      colStorageV2: { booleanValue: true },
      colChunkCount: { integerValue: '2' },
      rating: { doubleValue: 9.5 },
      emptyVal: { nullValue: null },
      customLists: { arrayValue: { values: [{ stringValue: 'Топ' }, { stringValue: 'Осень' }] } },
      emptyArr: { arrayValue: {} },
      listMeta: {
        mapValue: {
          fields: {
            Топ: { mapValue: { fields: { color: { stringValue: 'green' }, pin: { booleanValue: true } } } }
          }
        }
      },
      emptyMap: { mapValue: {} }
    }
  });
  assert.deepEqual(decoded, {
    name: 'Aki',
    colStorageV2: true,
    colChunkCount: 2,
    rating: 9.5,
    emptyVal: null,
    customLists: ['Топ', 'Осень'],
    emptyArr: [],
    listMeta: { Топ: { color: 'green', pin: true } },
    emptyMap: {}
  });
});

test('isReadCategory and getStatusLabelForCategory consistently use reading labels for manga/ranobe/manhwa and watching labels for video', () => {
  assert.equal(KirokuEngine.isReadCategory('Манга'), true);
  assert.equal(KirokuEngine.isReadCategory('Ранобэ'), true);
  assert.equal(KirokuEngine.isReadCategory('Манхва'), true);
  assert.equal(KirokuEngine.isReadCategory('Маньхуа'), true);
  assert.equal(KirokuEngine.isReadCategory('Комикс'), true);
  assert.equal(KirokuEngine.isReadCategory('Аниме'), false);
  assert.equal(KirokuEngine.isReadCategory('Фильм'), false);

  assert.equal(KirokuEngine.getStatusLabelForCategory('Просмотрено/Прочитано', 'Манга'), 'Прочитано');
  assert.equal(KirokuEngine.getStatusLabelForCategory('Смотрю/Читаю', 'Манга'), 'Читаю');
  assert.equal(KirokuEngine.getStatusLabelForCategory('Пересматриваю', 'Манга'), 'Перечитываю');
  assert.equal(KirokuEngine.getStatusLabelForCategory('Просмотрено/Прочитано', 'Ранобэ'), 'Прочитано');
  assert.equal(KirokuEngine.getStatusLabelForCategory('Просмотрено/Прочитано', 'Манхва'), 'Прочитано');

  assert.equal(KirokuEngine.getStatusLabelForCategory('Просмотрено/Прочитано', 'Аниме'), 'Просмотрено');
  assert.equal(KirokuEngine.getStatusLabelForCategory('Смотрю/Читаю', 'Аниме'), 'Смотрю');
  assert.equal(KirokuEngine.getStatusLabelForCategory('Пересматриваю', 'Сериал'), 'Пересматриваю');

  assert.equal(KirokuEngine.getStatusLabelForCategory('Просмотрено/Прочитано', 'Всё'), 'Просмотрено / Прочитано');
  assert.equal(KirokuEngine.getStatusLabelForCategory('Смотрю/Читаю', ''), 'Смотрю / Читаю');
  assert.equal(KirokuEngine.getStatusLabelForCategory('В планах', 'Манга'), 'В планах');
});

test('normalizeExternalRatingInput validates 0-10 bounds, handles commas, and strips sentinel custom source', () => {
  assert.deepEqual(KirokuEngine.normalizeExternalRatingInput('8,65', 'MangaUpdates'), { valid: true, rating: '8.65', source: 'MangaUpdates' });
  assert.deepEqual(KirokuEngine.normalizeExternalRatingInput('8.50', '  AniList  '), { valid: true, rating: '8.5', source: 'AniList' });
  assert.deepEqual(KirokuEngine.normalizeExternalRatingInput('', '__custom__'), { valid: true, rating: '', source: '' });
  assert.deepEqual(KirokuEngine.normalizeExternalRatingInput('7.9', '__custom__'), { valid: true, rating: '7.9', source: '' });
  assert.equal(KirokuEngine.normalizeExternalRatingInput('10.5', 'AniList').valid, false);
  assert.equal(KirokuEngine.normalizeExternalRatingInput('-1', 'Shikimori').valid, false);
  assert.equal(KirokuEngine.normalizeExternalRatingInput('abc', 'IMDb').valid, false);
});

test('pickFresherLocalItems + hydrateStrippedBase64FromIdb restores uploaded posters when localStorage is newer than IDB, without resurrecting cleared posters', () => {
  const uploadedDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAA==';
  const badgeDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
  const idbItems = [
    { id: 1, title: 'Манга с обложкой', poster: uploadedDataUrl, badgeCharImg: badgeDataUrl, updatedAt: 1000 },
    { id: 2, title: 'Удалили обложку вручную', poster: uploadedDataUrl, updatedAt: 1000 },
    { id: 3, title: 'Старая запись без маркера', poster: uploadedDataUrl, updatedAt: 1000 }
  ];
  const lsItems = [
    { id: 1, title: 'Манга с обложкой (обновлён прогресс)', poster: '', _posterInIdb: 1, badgeCharImg: '', _badgeInIdb: 1, updatedAt: 2000 },
    { id: 2, title: 'Удалили обложку вручную', poster: '', updatedAt: 2000 },
    { id: 3, title: 'Старая запись без маркера', poster: '', updatedAt: 1000 }
  ];

  const picked = KirokuEngine.pickFresherLocalItems({
    idbItems,
    idbUpdatedAt: 1000,
    lsItems,
    lsUpdatedAt: 2000,
    lsMetaCount: 3
  });
  assert.equal(picked.source, 'ls');
  assert.equal(picked.items[0].poster, uploadedDataUrl);
  assert.equal(picked.items[0].badgeCharImg, badgeDataUrl);
  assert.equal('_posterInIdb' in picked.items[0], false);
  assert.equal('_badgeInIdb' in picked.items[0], false);
  assert.equal(picked.items[1].poster, '');
  assert.equal(picked.items[2].poster, uploadedDataUrl);

  const sanitized = KirokuEngine.sanitizeItemForChunk({ id: 1, title: 'Test', _posterInIdb: 1, _badgeInIdb: 1 });
  assert.equal('_posterInIdb' in sanitized, false);
  assert.equal('_badgeInIdb' in sanitized, false);
});

test('preserveLocalUploadedPostersOnCloudMerge keeps local base64 cover when cloud lacks poster at same/older updatedAt, but respects newer remote clear', () => {
  const uploadedDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAA==';
  const localItems = [
    { id: 10, title: 'Локальная обложка', poster: uploadedDataUrl, updatedAt: 5000 },
    { id: 11, title: 'Очищена на другом устройстве', poster: uploadedDataUrl, updatedAt: 5000 },
    { id: 12, title: 'Обложка по ссылке из облака', poster: uploadedDataUrl, updatedAt: 5000 }
  ];
  const cloudItems = [
    { id: 10, title: 'Локальная обложка', poster: '', updatedAt: 5000 },
    { id: 11, title: 'Очищена на другом устройстве', poster: '', updatedAt: 9000 },
    { id: 12, title: 'Обложка по ссылке из облака', poster: 'https://example.com/cover.jpg', updatedAt: 5000 }
  ];

  const merged = KirokuEngine.preserveLocalUploadedPostersOnCloudMerge(cloudItems, localItems);
  assert.equal(merged[0].poster, uploadedDataUrl);
  assert.equal(merged[1].poster, '');
  assert.equal(merged[2].poster, 'https://example.com/cover.jpg');
});

test('Додзинси subKind/format displays as Додзинси, uses reading status labels, and filters cleanly in Манга category', () => {
  const fmtRu = { MANGA: 'Манга', DOUJIN: 'Додзинси', ONE_SHOT: 'Ваншот' };
  assert.equal(KirokuEngine.resolveDisplayFormatLabel({ category: 'Манга', subKind: 'Додзинси', format: 'MANGA' }, fmtRu), 'Додзинси');
  assert.equal(KirokuEngine.resolveDisplayFormatLabel({ category: 'Манга', format: 'DOUJIN' }, fmtRu), 'Додзинси');
  assert.equal(KirokuEngine.isReadCategory('Додзинси'), true);
  assert.equal(KirokuEngine.getStatusLabelForCategory('Просмотрено/Прочитано', 'Додзинси'), 'Прочитано');
  assert.equal(KirokuEngine.getStatusLabelForCategory('Смотрю/Читаю', 'Додзинси'), 'Читаю');

  const itemDj = { category: 'Манга', subKind: 'Додзинси' };
  const itemJp = { category: 'Манга', subKind: 'Манга' };
  const getSub = (x: { subKind?: string }) => x.subKind || 'Манга';
  assert.equal(KirokuEngine.matchesCategoryFilter(itemDj, { cat: 'Манга', kind: 'Додзинси', getMangaSubKind: getSub }), true);
  assert.equal(KirokuEngine.matchesCategoryFilter(itemJp, { cat: 'Манга', kind: 'Додзинси', getMangaSubKind: getSub }), false);
  assert.equal(KirokuEngine.matchesCategoryFilter(itemDj, { cat: 'Манга', kind: 'Все', getMangaSubKind: getSub }), true);
});

test('Protected system manual collection auto-matches manual/unlinked titles, supports renaming, and locks picker mutations', () => {
  const sysKey = KirokuEngine.SYSTEM_MANUAL_LIST_KEY;
  assert.equal(sysKey, '__sys_manual__');
  assert.equal(KirokuEngine.resolveManualListName({}), 'Добавлено вручную');
  assert.equal(KirokuEngine.resolveManualListName({ manualFolderName: '  Мои ручные  ' }), 'Мои ручные');

  const profCustom = { manualFolderName: 'Ручные тайтлы' };
  assert.equal(KirokuEngine.isSystemManualListRef(sysKey, profCustom), true);
  assert.equal(KirokuEngine.isSystemManualListRef('ручные тайтлы', profCustom), true);
  assert.equal(KirokuEngine.isSystemManualListRef('Избранное', profCustom), false);

  // Manual items (new with isManual: true and external rating source, plus legacy unlinked)
  const manualWithExtRating = { id: 1, title: 'Додзинси ручное', isManual: true, extRating: '8.4', extSrc: 'Shikimori' };
  const legacyUnlinked = { id: 2, title: 'Старый ручной тайтл', extSrc: 'AniList' };
  const catalogAni = { id: 3, title: 'Наруто', aniId: 20, lists: ['Ручные тайтлы', 'Избранное'] };
  const catalogShiki = { id: 4, title: 'Берсерк', shikiId: 2, lists: ['Избранное'] };
  const googleBooksItem = { id: 5, title: 'Batman', extSrc: 'Google Books' };

  assert.equal(KirokuEngine.isManualTitleItem(manualWithExtRating), true);
  assert.equal(KirokuEngine.isManualTitleItem(legacyUnlinked), true);
  assert.equal(KirokuEngine.isManualTitleItem(catalogAni), false);
  assert.equal(KirokuEngine.isManualTitleItem(catalogShiki), false);
  assert.equal(KirokuEngine.isManualTitleItem(googleBooksItem), false);

  // System filter matches ONLY manual/unlinked items (even if catalogAni had stale folder name in lists)
  assert.equal(KirokuEngine.itemMatchesListFilter(manualWithExtRating, sysKey, profCustom), true);
  assert.equal(KirokuEngine.itemMatchesListFilter(legacyUnlinked, sysKey, profCustom), true);
  assert.equal(KirokuEngine.itemMatchesListFilter(catalogAni, sysKey, profCustom), false);
  assert.equal(KirokuEngine.itemMatchesListFilter(catalogShiki, sysKey, profCustom), false);

  // Regular user filter still matches item.lists
  assert.equal(KirokuEngine.itemMatchesListFilter(catalogAni, 'избранное', profCustom), true);
  assert.equal(KirokuEngine.itemMatchesListFilter(manualWithExtRating, 'избранное', profCustom), false);

  // Stripping accidental system folder names from user lists
  assert.deepEqual(
    KirokuEngine.stripSystemManualListFromUserLists(['Ручные тайтлы', sysKey, 'Фэнтези', 'Драма'], profCustom),
    ['Фэнтези', 'Драма']
  );

  // Picker lists locked system folder first, blocks duplicate creation, reflects manual vs catalog membership
  const pickerForManual = KirokuEngine.filterAndListCollections(
    ['Фэнтези', 'Ручные тайтлы'],
    ['Фэнтези'],
    '',
    { 'фэнтези': 3 },
    { systemManualName: 'Ручные тайтлы', systemManualCount: 2, isManualItem: true }
  );
  assert.equal(pickerForManual.items.length, 2);
  assert.equal(pickerForManual.items[0].isSystem, true);
  assert.equal(pickerForManual.items[0].locked, true);
  assert.equal(pickerForManual.items[0].inList, true);
  assert.equal(pickerForManual.items[0].count, 2);
  assert.equal(pickerForManual.items[1].name, 'Фэнтези');
  assert.equal(pickerForManual.items[1].locked, false);

  const pickerForCatalog = KirokuEngine.filterAndListCollections(
    ['Фэнтези'],
    [],
    'ручные тайтлы',
    { 'фэнтези': 3 },
    { systemManualName: 'Ручные тайтлы', systemManualCount: 2, isManualItem: false }
  );
  assert.equal(pickerForCatalog.canCreateNew, false);
  assert.equal(pickerForCatalog.items.length, 1);
  assert.equal(pickerForCatalog.items[0].isSystem, true);
  assert.equal(pickerForCatalog.items[0].locked, true);
  assert.equal(pickerForCatalog.items[0].inList, false);
});

test('Clickable metadata transitions resolve catalog sections/tags cleanly, serialize history snapshots, and always clear stale search query', () => {
  // Section mapping
  assert.equal(KirokuEngine.mapItemCategoryToCatalogSection('Манга'), 'Манга');
  assert.equal(KirokuEngine.mapItemCategoryToCatalogSection('Додзинси'), 'Манга');
  assert.equal(KirokuEngine.mapItemCategoryToCatalogSection('Манхва'), 'Манга');
  assert.equal(KirokuEngine.mapItemCategoryToCatalogSection('Ранобэ'), 'Ранобэ');
  assert.equal(KirokuEngine.mapItemCategoryToCatalogSection('Фильм'), 'Кино и сериалы');
  assert.equal(KirokuEngine.mapItemCategoryToCatalogSection('Сериал'), 'Кино и сериалы');
  assert.equal(KirokuEngine.mapItemCategoryToCatalogSection('Аниме'), 'Аниме');

  // Tag resolution for AniList genres/tags and TMDB video genres
  const aniPairs = [
    ['g:Fantasy', 'Фэнтези'],
    ['t:Shounen', 'Сёнэн (для юношей)'],
    ['t:Dark Fantasy', 'Тёмное фэнтези / Дарк']
  ];
  const videoGenres = { '28': 'Боевик', '14': 'Фэнтези', '18': 'Драма', '878': 'Фантастика' };

  assert.equal(KirokuEngine.resolveCatalogTagKey('Фэнтези', false, aniPairs, videoGenres), 'g:Fantasy');
  assert.equal(KirokuEngine.resolveCatalogTagKey('Fantasy', false, aniPairs, videoGenres), 'g:Fantasy');
  assert.equal(KirokuEngine.resolveCatalogTagKey('g:Fantasy', false, aniPairs, videoGenres), 'g:Fantasy');
  assert.equal(KirokuEngine.resolveCatalogTagKey('Сёнэн', false, aniPairs, videoGenres), 't:Shounen');
  assert.equal(KirokuEngine.resolveCatalogTagKey('Дарк', false, aniPairs, videoGenres), 't:Dark Fantasy');
  assert.equal(KirokuEngine.resolveCatalogTagKey('Экшен', true, aniPairs, videoGenres), '28');
  assert.equal(KirokuEngine.resolveCatalogTagKey('Фэнтези', true, aniPairs, videoGenres), '14');
  assert.equal(KirokuEngine.resolveCatalogTagKey('Мой личный тег 123', false, aniPairs, videoGenres), '');

  // Catalog history snapshot preserves search, tags, and creator cleanly
  const catSnap = KirokuEngine.buildCatalogHistorySnapshot({
    g: 'Манга',
    q: '  Берсерк  ',
    tags: [['g:Fantasy', 1], ['g:Horror', -1], ['g:Ignored', 0]],
    creator: { kindType: 'author', nameStr: ' Кэнтаро Миура ', itemCat: 'Манга' },
    mode: 'top',
    ongOnly: true
  });
  assert.equal(catSnap.g, 'Манга');
  assert.equal(catSnap.q, 'Берсерк');
  assert.deepEqual(catSnap.tags, [['g:Fantasy', 1], ['g:Horror', -1]]);
  assert.deepEqual(catSnap.creator, { kindType: 'author', nameStr: 'Кэнтаро Миура', itemCat: 'Манга' });
  assert.equal(catSnap.mode, 'top');
  assert.equal(catSnap.ongOnly, true);

  // Collection history snapshot preserves search & xf metadata filter
  const colSnap = KirokuEngine.buildCollectionHistorySnapshot({
    q: '  Берсерк ',
    xf: { k: 'author', v: 'Кэнтаро Миура' },
    tag: 'Фэнтези',
    list: 'Все'
  });
  assert.equal(colSnap.q, 'Берсерк');
  assert.deepEqual(colSnap.xf, { k: 'author', v: 'Кэнтаро Миура' });
  assert.equal(colSnap.tag, 'Фэнтези');

  // Metadata transition clears stale search query while keeping the old snapshot untouched for Back navigation
  const nextColSnap = KirokuEngine.clearSearchForMetadataTransition(colSnap, {
    xf: { k: 'studio', v: 'OLM' }
  });
  assert.equal(colSnap.q, 'Берсерк');
  assert.equal(nextColSnap.q, '');
  assert.deepEqual(nextColSnap.xf, { k: 'studio', v: 'OLM' });
});

test('normalizeSearchText and tokenizeSearchText unify ё/е, hyphens, and punctuation', () => {
  assert.equal(KirokuEngine.normalizeSearchText('Звёздное дитя'), 'звездное дитя');
  assert.equal(KirokuEngine.normalizeSearchText('Ван-Пис!'), 'ван пис');
  assert.equal(KirokuEngine.normalizeSearchText('[Oshi no Ko] — Vol. 1'), 'oshi no ko vol 1');
  assert.deepEqual(KirokuEngine.tokenizeSearchText('  Синяя   тюрьма:   Блю-Лок '), ['синяя', 'тюрьма', 'блю', 'лок']);
  assert.equal(KirokuEngine.normalizeSearchText(''), '');
  assert.deepEqual(KirokuEngine.tokenizeSearchText('   '), []);
});

test('extractRuCacheMatches reverse-matches RUC Russian manga/anime keys and skips descriptions', () => {
  const ruc = {
    mangas121496: 'Поднятие уровня в одиночку',
    t_mangas_656: 'Бродяга',
    d_mangas_656: 'Описание манги Бродяга про Миямото Мусаси',
    animes16498: 'Атака титанов',
    mangas13: 'Ван-Пис',
    ranobe70261: 'Реинкарнация безработного'
  };

  const mangaHit = KirokuEngine.extractRuCacheMatches('поднятие уровня в одиночку', ruc, 'MANGA');
  assert.equal(mangaHit.length, 1);
  assert.equal(mangaHit[0].malId, 121496);
  assert.equal(mangaHit[0].exact, true);

  // Hyphenated Russian title matches space-separated query
  const onePiece = KirokuEngine.extractRuCacheMatches('Ван Пис', ruc, 'MANGA');
  assert.equal(onePiece.length, 1);
  assert.equal(onePiece[0].malId, 13);

  // Manga lookup ignores anime keys and description keys
  const animeSkipped = KirokuEngine.extractRuCacheMatches('Атака титанов', ruc, 'MANGA');
  assert.equal(animeSkipped.length, 0);
  const descSkipped = KirokuEngine.extractRuCacheMatches('Миямото Мусаси', ruc, 'MANGA');
  assert.equal(descSkipped.length, 0);

  // Anime lookup finds anime key
  const animeHit = KirokuEngine.extractRuCacheMatches('Атака титанов', ruc, 'ANIME');
  assert.equal(animeHit.length, 1);
  assert.equal(animeHit[0].malId, 16498);

  // Novel lookup finds ranobe key
  const novelHit = KirokuEngine.extractRuCacheMatches('Реинкарнация безработного', ruc, 'NOVEL');
  assert.equal(novelHit.length, 1);
  assert.equal(novelHit[0].malId, 70261);
});

test('rankShikimoriRuCandidates ranks main manga above homonyms/spin-offs/novels and detects weak matches', () => {
  // 1. Homonym tiebreak: "Бродяга" -> Vagabond (9.27) must beat Haikaisha (0)
  const vagabondRes = KirokuEngine.rankShikimoriRuCandidates(
    [
      { id: '99999', malId: 99999, name: 'Haikaisha', english: 'Haikaisha', russian: 'Бродяга', kind: 'manga', score: 0 },
      { id: '656', malId: 656, name: 'Vagabond', english: 'Vagabond', russian: 'Бродяга', kind: 'manga', score: 9.27 }
    ],
    'Бродяга',
    { isAnime: false, isNovel: false }
  );
  assert.equal(vagabondRes.hasStrongRuMatch, true);
  assert.equal(vagabondRes.malIds[0], 656);
  assert.equal(vagabondRes.enQueries[0], 'Vagabond');

  // 2. Main manga vs spin-off / one-shot / light_novel filtering
  const spinoffRes = KirokuEngine.rankShikimoriRuCandidates(
    [
      { id: '1', malId: 1, name: 'Oyakusoku no Neverland', english: 'Oyakusoku no Neverland', russian: 'Обещанный Неверленд: Спецвыпуск', kind: 'one_shot', score: 6.69 },
      { id: '2', malId: 2, name: 'Yakusoku no Neverland LN', english: 'The Promised Neverland', russian: 'Обещанный Неверленд', kind: 'light_novel', score: 8.5 },
      { id: '100128', malId: 100128, name: 'Yakusoku no Neverland', english: 'The Promised Neverland', russian: 'Обещанный Неверленд', kind: 'manga', score: 8.14 }
    ],
    'Обещанный Неверленд',
    { isAnime: false, isNovel: false }
  );
  assert.equal(spinoffRes.hasStrongRuMatch, true);
  assert.equal(spinoffRes.malIds.includes(2), false); // light_novel filtered out for Manga search
  assert.equal(spinoffRes.malIds[0], 100128);

  // 3. Weak Shikimori partial matches must set hasStrongRuMatch = false so translation fallback runs
  const tbateRes = KirokuEngine.rankShikimoriRuCandidates(
    [
      { id: '111', malId: 111, name: 'Start Over', english: 'Start Over', russian: 'Начало конца', kind: 'manga', score: 0 }
    ],
    'Начало после конца',
    { isAnime: false, isNovel: false }
  );
  assert.equal(tbateRes.hasStrongRuMatch, false);

  const sweetHomeRes = KirokuEngine.rankShikimoriRuCandidates(
    [
      { id: '222', malId: 222, name: 'Bitter Sweet Home', english: 'Bitter Sweet Home', russian: 'Горько-сладкий дом', kind: 'manga', score: 0 }
    ],
    'Сладкий дом',
    { isAnime: false, isNovel: false }
  );
  assert.equal(sweetHomeRes.hasStrongRuMatch, false);

  const madeInAbyssRes = KirokuEngine.rankShikimoriRuCandidates(
    [
      { id: '333', malId: 333, name: 'Naraku no Futari', english: 'Naraku no Futari', russian: 'Влюблённые в бездне', kind: 'manga', score: 6.8 }
    ],
    'Сделано в Бездне',
    { isAnime: false, isNovel: false }
  );
  assert.equal(madeInAbyssRes.hasStrongRuMatch, false);
});

test('rankCatalogSearchResults promotes exact Russian, translated English, and top MAL matches', () => {
  // Translated English fallback match (webtoon / unofficial Russian title)
  const rankedWebtoon = KirokuEngine.rankCatalogSearchResults(
    [
      { id: '1', mal: 111, title: 'Начало конца', en: 'Start Over', romaji: 'Start Over', ext: '6.0', poster: 'p1' },
      { id: '2', mal: 0, title: 'The Beginning After the End', en: 'The Beginning After the End', romaji: 'The Beginning After the End', ext: '8.7', poster: 'p2' }
    ],
    'Начало после конца',
    {
      malIds: [111],
      hasStrongRuMatch: false,
      translatedEn: 'The Beginning After the End',
      enQueries: ['The Beginning After the End', 'Start Over']
    }
  );
  assert.equal(rankedWebtoon[0].id, '2');

  // Strong Russian + MAL ID match beats spin-off anthology
  const rankedMain = KirokuEngine.rankCatalogSearchResults(
    [
      { id: 's1', mal: 500, title: 'Синяя тюрьма: Антология', en: 'Blue Lock Anthology', romaji: 'Blue Lock Anthology', ext: '7.0', poster: 'p1', format: 'ONE_SHOT' },
      { id: 'm1', mal: 114745, title: 'Синяя тюрьма: Блю Лок', en: 'Blue Lock', romaji: 'Blue Lock', ext: '8.4', poster: 'p2', format: 'MANGA' }
    ],
    'Синяя тюрьма',
    {
      malIds: [114745, 500],
      hasStrongRuMatch: true,
      translatedEn: 'Blue Lock',
      enQueries: ['Blue Lock']
    }
  );
  assert.equal(rankedMain[0].id, 'm1');
});

test('itemMatchesSearchText matches Russian/English titles, ё/е, hyphens, multi-word order, and IDs', () => {
  const onePiece = {
    id: 'local_1',
    title: 'Ван-Пис',
    titleEn: 'One Piece',
    romaji: 'One Piece',
    author: 'Эйитиро Ода',
    mal: 13,
    tags: ['Приключения', 'Сёнэн']
  };
  const oshi = {
    id: 'local_2',
    title: 'Звёздное дитя',
    titleEn: 'Oshi no Ko',
    romaji: '[Oshi no Ko]',
    mal: 126146
  };

  assert.equal(KirokuEngine.itemMatchesSearchText(onePiece, 'ван пис'), true);
  assert.equal(KirokuEngine.itemMatchesSearchText(onePiece, 'One Piece'), true);
  assert.equal(KirokuEngine.itemMatchesSearchText(onePiece, 'ода эйитиро'), true);
  assert.equal(KirokuEngine.itemMatchesSearchText(onePiece, 'mal:13'), true);
  assert.equal(KirokuEngine.itemMatchesSearchText(onePiece, 'Берсерк'), false);

  assert.equal(KirokuEngine.itemMatchesSearchText(oshi, 'звездное дитя'), true);
  assert.equal(KirokuEngine.itemMatchesSearchText(oshi, 'Звёздное дитя'), true);
  assert.equal(KirokuEngine.itemMatchesSearchText(oshi, 'oshi no ko'), true);
});

test('createCatalogCache.allValues returns non-expired cached arrays and omits expired entries', () => {
  const cache = KirokuEngine.createCatalogCache(1000, 10);
  cache.set('p1', [{ id: 'a' }], 100);
  cache.set('p2', [{ id: 'b' }], 500);

  assert.deepEqual(cache.allValues(600), [[{ id: 'a' }], [{ id: 'b' }]]);
  // At t=1200, p1 (set at 100, ttl 1000) is expired, p2 (set at 500) is still valid
  assert.deepEqual(cache.allValues(1200), [[{ id: 'b' }]]);
});

test('AniList tag rank thresholds and filterAniListTags exclude meme-tagged Yuri (Bocchi the Rock) and spoiler tags while keeping genuine Yuri and demographics', () => {
  assert.equal(KirokuEngine.getMinAniListTagRank('Yuri'), 75);
  assert.equal(KirokuEngine.getMinAniListTagRank("Boys' Love"), 75);
  assert.equal(KirokuEngine.getMinAniListTagRank('Shounen'), 60);
  assert.equal(KirokuEngine.getMinAniListTagRank('Seinen'), 60);
  assert.equal(KirokuEngine.getMinAniListTagRank('Isekai'), 65);

  assert.equal(KirokuEngine.mapAniListTagAlias('Yuri'), 'Yuri');
  assert.equal(KirokuEngine.mapAniListTagAlias('Yaoi'), "Boys' Love");
  assert.equal(KirokuEngine.mapAniListTagAlias('Harem'), 'Female Harem');
  assert.equal(KirokuEngine.mapAniListTagAlias('Reverse Harem'), 'Male Harem');
  assert.equal(KirokuEngine.mapAniListTagAlias('Time Travel'), 'Time Manipulation');

  // Query minTagRank: single Yuri -> 75; mixed Yuri + Shounen -> 60 (so API doesn't drop Shounen, client filters Yuri >= 75); empty -> undefined
  assert.equal(KirokuEngine.computeAniListQueryMinTagRank(['Yuri'], undefined), 75);
  assert.equal(KirokuEngine.computeAniListQueryMinTagRank(undefined, ['Yuri']), 75);
  assert.equal(KirokuEngine.computeAniListQueryMinTagRank(['Yuri', 'Shounen'], undefined), 60);
  assert.equal(KirokuEngine.computeAniListQueryMinTagRank(['Isekai'], undefined), 65);
  assert.equal(KirokuEngine.computeAniListQueryMinTagRank([], []), undefined);

  // Bocchi the Rock tags: Yuri rank 61 must be filtered out; CGDCT 86 & Band 94 stay
  const bocchiTags = [
    { name: 'Yuri', rank: 61, isMediaSpoiler: false },
    { name: 'Cute Girls Doing Cute Things', rank: 86, isMediaSpoiler: false },
    { name: 'Band', rank: 94, isMediaSpoiler: false },
    { name: 'Tragedy', rank: 82, isMediaSpoiler: true }
  ];
  const cleanBocchi = KirokuEngine.filterAniListTags(bocchiTags);
  assert.deepEqual(cleanBocchi.map((t: { name: string }) => t.name), ['Band', 'Cute Girls Doing Cute Things']);

  // Bloom Into You tags: Yuri rank 98 stays at #1
  const bloomTags = [
    { name: 'School', rank: 74, isMediaSpoiler: false },
    { name: 'Yuri', rank: 98, isMediaSpoiler: false }
  ];
  const cleanBloom = KirokuEngine.filterAniListTags(bloomTags);
  assert.deepEqual(cleanBloom.map((t: { name: string }) => t.name), ['Yuri', 'School']);

  // Attack on Titan: Shounen rank 63 stays (demographic threshold is 60), Bleach Isekai 50 is excluded
  const mixed = [
    { name: 'Shounen', rank: 63, isMediaSpoiler: false },
    { name: 'Isekai', rank: 50, isMediaSpoiler: false }
  ];
  assert.deepEqual(KirokuEngine.filterAniListTags(mixed).map((t: { name: string }) => t.name), ['Shounen']);
});

test('classifyAniListYuriSubtype and matchesAniListYuriFilter cleanly separate light Shoujo Ai from explicit/ecchi Yuri', () => {
  // 1. Light romance (Bloom Into You): Yuri rank 98, non-adult, no Ecchi/Hentai -> Shoujo Ai
  const bloomIntoYou = {
    isAdult: false,
    genres: ['Drama', 'Romance', 'Slice of Life'],
    tags: [
      { name: 'Yuri', rank: 98, isMediaSpoiler: false },
      { name: 'School', rank: 75, isMediaSpoiler: false }
    ]
  };
  assert.equal(KirokuEngine.classifyAniListYuriSubtype(bloomIntoYou), 'Shoujo Ai');

  // 2. Ecchi Yuri (Gushing Over Magical Girls): Yuri rank 90 + Ecchi genre -> Yuri
  const gushingOver = {
    isAdult: false,
    genres: ['Comedy', 'Ecchi', 'Mahou Shoujo'],
    tags: [
      { name: 'Yuri', rank: 90, isMediaSpoiler: false },
      { name: 'BDSM', rank: 88, isMediaSpoiler: false }
    ]
  };
  assert.equal(KirokuEngine.classifyAniListYuriSubtype(gushingOver), 'Yuri');

  // 3. Adult 18+ Yuri -> Yuri
  const adultYuri = {
    isAdult: true,
    genres: ['Hentai', 'Romance'],
    tags: [{ name: 'Yuri', rank: 95, isMediaSpoiler: false }]
  };
  assert.equal(KirokuEngine.classifyAniListYuriSubtype(adultYuri), 'Yuri');

  // 4. Non-Yuri meme-tagged show (Bocchi the Rock, Yuri rank 61) -> null (neither Shoujo Ai nor Yuri!)
  const bocchi = {
    isAdult: false,
    genres: ['Comedy', 'Music', 'Slice of Life'],
    tags: [
      { name: 'Yuri', rank: 61, isMediaSpoiler: false },
      { name: 'Band', rank: 94, isMediaSpoiler: false }
    ]
  };
  assert.equal(KirokuEngine.classifyAniListYuriSubtype(bocchi), null);

  // Filter mode: wantShoujoAi matches ONLY Bloom Into You; wantExplicitYuri matches ONLY Gushing Over & Adult Yuri
  const shoujoMode = KirokuEngine.getAniListYuriFilterMode(['Shoujo Ai'], []);
  assert.equal(shoujoMode.wantShoujoAi, true);
  assert.equal(shoujoMode.wantExplicitYuri, false);
  assert.equal(KirokuEngine.matchesAniListYuriFilter(bloomIntoYou, shoujoMode), true);
  assert.equal(KirokuEngine.matchesAniListYuriFilter(gushingOver, shoujoMode), false);
  assert.equal(KirokuEngine.matchesAniListYuriFilter(adultYuri, shoujoMode), false);
  assert.equal(KirokuEngine.matchesAniListYuriFilter(bocchi, shoujoMode), false);

  const yuriMode = KirokuEngine.getAniListYuriFilterMode(['Yuri'], []);
  assert.equal(yuriMode.wantShoujoAi, false);
  assert.equal(yuriMode.wantExplicitYuri, true);
  assert.equal(KirokuEngine.matchesAniListYuriFilter(bloomIntoYou, yuriMode), false);
  assert.equal(KirokuEngine.matchesAniListYuriFilter(gushingOver, yuriMode), true);
  assert.equal(KirokuEngine.matchesAniListYuriFilter(adultYuri, yuriMode), true);
  assert.equal(KirokuEngine.matchesAniListYuriFilter(bocchi, yuriMode), false);

  // Exclude only explicit Yuri keeps light Shoujo Ai!
  const exclExplicit = KirokuEngine.getAniListYuriFilterMode([], ['Yuri']);
  assert.equal(KirokuEngine.matchesAniListYuriFilter(bloomIntoYou, exclExplicit), true);
  assert.equal(KirokuEngine.matchesAniListYuriFilter(gushingOver, exclExplicit), false);

  // Shikimori classifier: PG-13 Yuri (Bloom Into You / Citrus) -> Shoujo Ai; r_plus / Ecchi / rx / Hentai -> Yuri
  assert.equal(
    KirokuEngine.classifyShikimoriYuriSubtype({
      rating: 'pg_13',
      genres: [{ name: 'Drama' }, { name: 'Yuri' }, { name: 'School' }]
    }),
    'Shoujo Ai'
  );
  assert.equal(
    KirokuEngine.classifyShikimoriYuriSubtype({
      rating: 'r_plus',
      genres: [{ name: 'Comedy' }, { name: 'Ecchi' }, { name: 'Yuri' }]
    }),
    'Yuri'
  );
  assert.equal(
    KirokuEngine.classifyShikimoriYuriSubtype({
      rating: 'rx',
      genres: [{ name: 'Hentai' }, { name: 'Yuri' }]
    }),
    'Yuri'
  );
});

test('getStatusLabelForCategory and getCollectionStatusLabels distinguish Manga/Ranobe reading vs Watch vs mixed All (both Все and Всё)', () => {
  // Read categories
  for (const cat of ['Манга', 'Ранобэ', 'Манхва', 'Маньхуа', 'Додзинси', 'Комикс']) {
    assert.equal(KirokuEngine.getStatusLabelForCategory('Смотрю/Читаю', cat), 'Читаю');
    assert.equal(KirokuEngine.getStatusLabelForCategory('Просмотрено/Прочитано', cat), 'Прочитано');
    assert.equal(KirokuEngine.getStatusLabelForCategory('Пересматриваю', cat), 'Перечитываю');
  }
  // Watch categories
  for (const cat of ['Аниме', 'Фильм', 'Сериал', 'Мультфильм', 'Кино и сериалы']) {
    assert.equal(KirokuEngine.getStatusLabelForCategory('Смотрю/Читаю', cat), 'Смотрю');
    assert.equal(KirokuEngine.getStatusLabelForCategory('Просмотрено/Прочитано', cat), 'Просмотрено');
    assert.equal(KirokuEngine.getStatusLabelForCategory('Пересматриваю', cat), 'Пересматриваю');
  }
  // Both 'Все' (with е) and 'Всё' (with ё) and empty string return combined labels!
  for (const allCat of ['Все', 'Всё', 'All', '']) {
    assert.equal(KirokuEngine.getStatusLabelForCategory('Смотрю/Читаю', allCat), 'Смотрю / Читаю');
    assert.equal(KirokuEngine.getStatusLabelForCategory('Просмотрено/Прочитано', allCat), 'Просмотрено / Прочитано');
    assert.equal(KirokuEngine.getStatusLabelForCategory('Пересматриваю', allCat), 'Пересматриваю / Перечитываю');
  }

  // getCollectionStatusLabels adapts to actual items when activeCategory is 'Все'/'Всё'
  const onlyManga = [{ category: 'Манга' }, { category: 'Ранобэ' }];
  assert.deepEqual(KirokuEngine.getCollectionStatusLabels(onlyManga, 'Все'), {
    watching: 'Читаю',
    completed: 'Прочитано',
    rewatching: 'Перечитываю'
  });
  const onlyAnime = [{ category: 'Аниме' }, { category: 'Фильм' }];
  assert.deepEqual(KirokuEngine.getCollectionStatusLabels(onlyAnime, 'Всё'), {
    watching: 'Смотрю',
    completed: 'Просмотрено',
    rewatching: 'Пересматриваю'
  });
  const mixedItems = [{ category: 'Аниме' }, { category: 'Манга' }];
  assert.deepEqual(KirokuEngine.getCollectionStatusLabels(mixedItems, 'Все'), {
    watching: 'Смотрю / Читаю',
    completed: 'Просмотрено / Прочитано',
    rewatching: 'Пересматриваю / Перечитываю'
  });
  // Explicit category overrides items list
  assert.deepEqual(KirokuEngine.getCollectionStatusLabels(mixedItems, 'Манга'), {
    watching: 'Читаю',
    completed: 'Прочитано',
    rewatching: 'Перечитываю'
  });
});

test('computeCardProgressAction handles +1, -1, bounds, rapid-tap cooldown, locked items, and reachedTotal', () => {
  const manga = { category: 'Манга', status: 'Смотрю/Читаю', eps: 26, watchedEps: 10 };

  // Normal +1 step
  const stepUp = KirokuEngine.computeCardProgressAction(manga, 1, 5000, 0, 320);
  assert.equal(stepUp.allowed, true);
  assert.equal(stepUp.throttled, false);
  assert.equal(stepUp.prev, 10);
  assert.equal(stepUp.next, 11);
  assert.equal(stepUp.pct, 42);
  assert.equal(stepUp.reachedTotal, false);
  assert.equal(stepUp.canComplete, false);
  // Pure function: must not mutate input item
  assert.equal(manga.watchedEps, 10);

  // Rapid accidental double-tap within 320ms is throttled
  const throttled = KirokuEngine.computeCardProgressAction(manga, 1, 5150, 5000, 320);
  assert.equal(throttled.allowed, false);
  assert.equal(throttled.throttled, true);
  assert.equal(throttled.next, 10);

  // Tap after cooldown (>= 320ms) is allowed
  const afterCooldown = KirokuEngine.computeCardProgressAction(manga, -1, 5350, 5000, 320);
  assert.equal(afterCooldown.allowed, true);
  assert.equal(afterCooldown.throttled, false);
  assert.equal(afterCooldown.next, 9);

  // Lower bound at 0 prevents negative progress
  const zeroItem = { category: 'Аниме', status: 'Смотрю/Читаю', eps: 12, watchedEps: 0 };
  const underflow = KirokuEngine.computeCardProgressAction(zeroItem, -1, 6000, 0, 320);
  assert.equal(underflow.allowed, false);
  assert.equal(underflow.changed, false);
  assert.equal(underflow.next, 0);

  // Reaching final episode sets reachedTotal and canComplete
  const almostDone = { category: 'Аниме', status: 'Смотрю/Читаю', eps: 12, watchedEps: 11 };
  const finishStep = KirokuEngine.computeCardProgressAction(almostDone, 1, 7000, 0, 320);
  assert.equal(finishStep.allowed, true);
  assert.equal(finishStep.next, 12);
  assert.equal(finishStep.pct, 100);
  assert.equal(finishStep.reachedTotal, true);
  assert.equal(finishStep.canComplete, true);

  // Locked (already completed) item rejects steps
  const lockedItem = { category: 'Аниме', status: 'Просмотрено/Прочитано', eps: 12, watchedEps: 12 };
  const lockedRes = KirokuEngine.computeCardProgressAction(lockedItem, -1, 8000, 0, 320);
  assert.equal(lockedRes.allowed, false);
  assert.equal(lockedRes.locked, true);
});

test('completeItemFromProgress transitions to completed and restoreItemProgressSnapshot reverts losslessly', () => {
  const anime: Record<string, any> = {
    id: 42,
    category: 'Аниме',
    status: 'Смотрю/Читаю',
    eps: 12,
    watchedEps: 12
  };
  const ts = 1760000000000;
  const res = KirokuEngine.completeItemFromProgress(anime, ts);
  assert.equal(res.changed, true);
  assert.equal(anime.status, 'Просмотрено/Прочитано');
  assert.equal(anime.completedAt, ts);
  assert.equal(anime.watchedEps, 12);

  // Calling complete again is a safe no-op
  const repeat = KirokuEngine.completeItemFromProgress(anime, ts + 1000);
  assert.equal(repeat.changed, false);

  // Undo restores exact prior state (including removing completedAt when previously unset)
  const restored = KirokuEngine.restoreItemProgressSnapshot(anime, res.snapshot);
  assert.equal(restored, true);
  assert.equal(anime.status, 'Смотрю/Читаю');
  assert.equal(anime.completedAt, undefined);
  assert.equal(anime.watchedEps, 12);
});

test('collectCollectionActiveFilters collects all active filters with category-aware labels, moreCount, and showResetAll threshold', () => {
  // Default empty state
  const empty = KirokuEngine.collectCollectionActiveFilters({
    searchQuery: '   ',
    cat: 'Всё',
    status: 'Все',
    tagValue: 'Все',
    listValue: 'Все'
  });
  assert.equal(empty.totalCount, 0);
  assert.equal(empty.moreCount, 0);
  assert.equal(empty.hasAny, false);
  assert.equal(empty.showResetAll, false);

  // Single filter -> hasAny true, showResetAll false
  const single = KirokuEngine.collectCollectionActiveFilters({
    cat: 'Аниме',
    status: 'Все',
    tagValue: 'Все',
    listValue: 'Все'
  });
  assert.equal(single.totalCount, 1);
  assert.equal(single.hasAny, true);
  assert.equal(single.showResetAll, false);
  assert.equal(single.filters[0].key, 'cat');
  assert.equal(single.filters[0].label, 'Категория: Аниме');

  // Multiple filters with Manga category -> status chip uses reading label («Прочитано»), moreCount counts ongOnly+tag+list
  const multi = KirokuEngine.collectCollectionActiveFilters({
    searchQuery: 'берсерк',
    cat: 'Манга',
    kind: 'Манхва',
    status: 'Просмотрено/Прочитано',
    ongOnly: true,
    tagValue: 'экшен',
    tagLabel: 'Экшен',
    listValue: 'list_1',
    listLabel: '📁 Любимая манга',
    xf: { k: 'author', v: 'Кэнтаро Миура' }
  });
  assert.equal(multi.totalCount, 8);
  assert.equal(multi.moreCount, 3);
  assert.equal(multi.showResetAll, true);
  const byKey = Object.fromEntries(multi.filters.map((f: { key: string; label: string }) => [f.key, f.label]));
  assert.equal(byKey.search, '🔍 «берсерк»');
  assert.equal(byKey.cat, 'Категория: Манга');
  assert.equal(byKey.kind, 'Вид: Манхва');
  assert.equal(byKey.status, 'Прочитано');
  assert.equal(byKey.ongOnly, 'Онгоинг');
  assert.equal(byKey.tag, 'Жанр: Экшен');
  assert.equal(byKey.list, '📁 Любимая манга');
  assert.equal(byKey.xf, 'Автор: Кэнтаро Миура');
});

test('computeCardStaggerDelayMs computes smooth bounded cascade delays and clamps extremes', () => {
  assert.equal(KirokuEngine.computeCardStaggerDelayMs(0), 0);
  assert.equal(KirokuEngine.computeCardStaggerDelayMs(-5), 0);
  assert.equal(KirokuEngine.computeCardStaggerDelayMs(Number.NaN), 0);
  assert.equal(KirokuEngine.computeCardStaggerDelayMs(1), 18);
  assert.equal(KirokuEngine.computeCardStaggerDelayMs(5), 90);
  assert.equal(KirokuEngine.computeCardStaggerDelayMs(12), 216);
  // Caps at maxIndex so card #500 never waits 9 seconds
  assert.equal(KirokuEngine.computeCardStaggerDelayMs(500), 216);
  assert.equal(KirokuEngine.computeCardStaggerDelayMs(10, 20, 6), 120);
});


