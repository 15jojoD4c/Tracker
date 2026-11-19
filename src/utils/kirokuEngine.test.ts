import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const KirokuEngine = require('../../kiroku_engine.js');

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

