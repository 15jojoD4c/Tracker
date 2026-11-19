// === ЧАСТЬ 1: Ядро, облако Firebase, авторизация, темы, профиль и карточки коллекции (app_core.js) ===
// Ключ TMDB по умолчанию
const DEFAULT_TMDB_KEY = "ff768a3ef9a051ab90138e3a560e43e8";

// Защита от XSS (экранирование пользовательских строк при вставке)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

// ИСПРАВЛЕНИЕ БАГА №1: Функция хэширования sha256Hex для отпечатков импортируемых файлов (с фоллбэком для file://)
async function sha256Hex(str) {
  const s = String(str ?? '');
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) {}
  let h1 = 0xdeadbeef ^ s.length, h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0') + '_' + s.length;
}
const _jikanPosterCache = new Map();
function isValidPosterUrl(u) {
  if (!u || typeof u !== 'string') return false;
  const s = u.trim();
  if (!s) return false;
  if (/missing_original|missing_preview|missing_x|stub|no-image/i.test(s)) return false;
  return true;
}

function cleanYoutubeId(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const urlMatch = s.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,20})/);
  if (urlMatch) return urlMatch[1];
  const idMatch = s.match(/^([A-Za-z0-9_-]{6,20})$/);
  return idMatch ? idMatch[1] : '';
}

function getPosterFallbackCandidates(rawPosterUrl, itemRef) {
  const list = [];
  const push = u => {
    if (!isValidPosterUrl(u)) return;
    const s = String(u).trim();
    if (!list.includes(s)) list.push(s);
  };
  push(rawPosterUrl);
  if (itemRef && typeof itemRef === 'object') {
    push(itemRef.poster);
    if (Array.isArray(itemRef.posterFallbacks)) {
      itemRef.posterFallbacks.forEach(push);
    }
  }
  return list.slice(0, 6);
}

async function _fetchJikanPoster(malId, category) {
  const idNum = Number(malId);
  if (!idNum || idNum <= 0) return '';
  const ep = category === 'Аниме' ? 'anime' : 'manga';
  const cacheKey = ep + '_' + idNum;
  if (_jikanPosterCache.has(cacheKey)) return _jikanPosterCache.get(cacheKey);
  const p = (async () => {
    try {
      const j = await _jikanJson(`https://api.jikan.moe/v4/${ep}/${idNum}`, 6000);
      const u = j?.data?.images?.jpg?.large_image_url || j?.data?.images?.jpg?.image_url || j?.data?.images?.webp?.large_image_url || '';
      return isValidPosterUrl(u) ? u : '';
    } catch (e) {
      return '';
    }
  })();
  _jikanPosterCache.set(cacheKey, p);
  return p;
}

// Проксирование постеров Shikimori, TMDB и MangaDex через wsrv.nl для стабильной загрузки в РФ без VPN и обхода hotlink-защиты
function safePosterUrl(u) {
  if (!isValidPosterUrl(u)) return FALL;
  const s = u.trim();
  if (s.startsWith('data:image/')) return s;
  if (!/^https?:\/\//i.test(s)) return FALL;
  if (/^https?:\/\/((?:desu\.)?shikimori\.(?:one|io|me|org)|image\.tmdb\.org|uploads\.mangadex\.org)\//i.test(s)) {
    return 'https://wsrv.nl/?url=' + encodeURIComponent(s);
  }
  return s;
}

// Многоступенчатый индивидуальный фоллбэк постера для каждого <img>:
// Для каждого URL из [poster, ...posterFallbacks]: 1) wsrv.nl -> 2) i0.wp.com -> 3) прямой URL
// При исчерпании всех CDN-кандидатов -> 4) Jikan v4 (cdn.myanimelist.net) -> 5) FALL
function handlePosterImgError(imgEl, rawPosterUrl, itemRef) {
  if (!imgEl || imgEl.dataset.posterFailed === '1') return;
  let candidates = [];
  try {
    const parsed = JSON.parse(imgEl.dataset.fallbackPosters || '[]');
    if (Array.isArray(parsed)) candidates = parsed.filter(isValidPosterUrl);
  } catch (e) {}
  for (const extra of getPosterFallbackCandidates(rawPosterUrl, itemRef)) {
    if (!candidates.includes(extra)) candidates.push(extra);
  }
  if (!candidates.length && imgEl.src) {
    if (imgEl.src.includes('wsrv.nl/?url=')) {
      try {
        const extracted = new URL(imgEl.src).searchParams.get('url');
        if (isValidPosterUrl(extracted)) candidates.push(extracted);
      } catch (e) {}
    } else if (!imgEl.src.startsWith('data:') && isValidPosterUrl(imgEl.src)) {
      candidates.push(imgEl.src);
    }
  }
  if (candidates.length) {
    imgEl.dataset.fallbackPosters = JSON.stringify(candidates);
  }

  let candIdx = Number(imgEl.dataset.posterCandIdx || 0);
  let step = Number(imgEl.dataset.posterStep || 0);
  if (step === 0 && imgEl.src && imgEl.src.includes('wsrv.nl')) step = 1;
  else if (step === 0 && imgEl.src && imgEl.src.includes('i0.wp.com/')) step = 2;

  while (candIdx < candidates.length) {
    const raw = candidates[candIdx];
    imgEl.dataset.rawPoster = raw;
    imgEl.dataset.posterCandIdx = String(candIdx);
    if (step < 1 && /^https?:\/\//i.test(raw) && !imgEl.src.includes('wsrv.nl')) {
      imgEl.dataset.posterStep = '1';
      imgEl.src = 'https://wsrv.nl/?url=' + encodeURIComponent(raw);
      return;
    }
    if (step < 2 && /^https?:\/\//i.test(raw)) {
      imgEl.dataset.posterStep = '2';
      imgEl.src = 'https://i0.wp.com/' + raw.replace(/^https?:\/\//i, '');
      return;
    }
    if (step < 3 && /^https?:\/\//i.test(raw) && imgEl.src !== raw) {
      imgEl.dataset.posterStep = '3';
      imgEl.src = raw;
      return;
    }
    candIdx++;
    step = 0;
  }

  const malId = Number(itemRef?.mal || imgEl.dataset.malId || 0);
  const itemCat = itemRef?.category || imgEl.dataset.itemCat || 'Аниме';
  if (imgEl.dataset.posterJikanTried !== '1' && malId > 0 && ['Аниме', 'Манга', 'Ранобэ'].includes(itemCat)) {
    imgEl.dataset.posterJikanTried = '1';
    _fetchJikanPoster(malId, itemCat).then(jUrl => {
      if (jUrl && isValidPosterUrl(jUrl) && !candidates.includes(jUrl)) {
        if (itemRef && typeof itemRef === 'object') {
          if (!isValidPosterUrl(itemRef.poster)) itemRef.poster = jUrl;
          itemRef.posterFallbacks = [...new Set([...(itemRef.posterFallbacks || []), jUrl])].slice(0, 6);
        }
        imgEl.dataset.rawPoster = jUrl;
        imgEl.dataset.posterCandIdx = String(candidates.length);
        imgEl.dataset.posterStep = '3';
        imgEl.dataset.fallbackPosters = JSON.stringify([...candidates, jUrl]);
        imgEl.src = jUrl;
      } else {
        imgEl.dataset.posterFailed = '1';
        imgEl.onerror = null;
        imgEl.src = FALL;
        imgEl.classList.add('ld');
      }
    });
    return;
  }
  imgEl.dataset.posterFailed = '1';
  imgEl.onerror = null;
  imgEl.src = FALL;
  imgEl.classList.add('ld');
}

function applyPosterImg(imgEl, rawPosterUrl, itemRef) {
  if (!imgEl) return;
  delete imgEl.dataset.posterStep;
  delete imgEl.dataset.posterCandIdx;
  delete imgEl.dataset.posterJikanTried;
  delete imgEl.dataset.posterFailed;
  imgEl.referrerPolicy = 'no-referrer';
  imgEl.onload = () => imgEl.classList.add('ld');
  const candidates = getPosterFallbackCandidates(rawPosterUrl, itemRef);
  const raw = candidates[0] || '';
  if (raw) imgEl.dataset.rawPoster = raw;
  else delete imgEl.dataset.rawPoster;
  if (candidates.length) imgEl.dataset.fallbackPosters = JSON.stringify(candidates);
  else delete imgEl.dataset.fallbackPosters;
  if (itemRef?.mal) imgEl.dataset.malId = String(itemRef.mal);
  if (itemRef?.category) imgEl.dataset.itemCat = String(itemRef.category);
  imgEl.onerror = () => handlePosterImgError(imgEl, raw, itemRef);
  const targetSrc = safePosterUrl(raw);
  imgEl.src = targetSrc;
  if (targetSrc === FALL || (imgEl.complete && imgEl.naturalWidth > 0)) {
    imgEl.classList.add('ld');
  }
  if (!raw && Number(itemRef?.mal) > 0 && ['Аниме', 'Манга', 'Ранобэ'].includes(itemRef?.category)) {
    _fetchJikanPoster(itemRef.mal, itemRef.category).then(jUrl => {
      if (jUrl && isValidPosterUrl(jUrl) && (!imgEl.src || imgEl.src === FALL)) {
        if (typeof itemRef === 'object') itemRef.poster = jUrl;
        imgEl.dataset.rawPoster = jUrl;
        imgEl.dataset.fallbackPosters = JSON.stringify([jUrl]);
        imgEl.src = jUrl;
      }
    });
  }
}

function safeCssBgUrl(u) {
  const clean = safePosterUrl(u);
  if (!clean || clean === FALL) return '';
  return `url("${clean.replace(/["\\()\r\n]/g, '')}")`;
}

const app = initializeApp({
  apiKey: "AIzaSyCBBC6gBLvCV7Jx1C8NaMheXwqqKPvpnt8",
  authDomain: "mymediatracker-6e179.firebaseapp.com",
  projectId: "mymediatracker-6e179",
  storageBucket: "mymediatracker-6e179.firebasestorage.app",
  messagingSenderId: "642718397694",
  appId: "1:642718397694:web:7a4e175ed593cc364961af",
  measurementId: "G-NKNYFSP981"
});
const auth = getAuth(app);
const db = (() => {
  try {
    if (typeof initializeFirestore === 'function') {
      const opts = { ignoreUndefinedProperties: true };
      if (typeof persistentLocalCache === 'function') {
        try {
          opts.localCache = typeof persistentMultipleTabManager === 'function'
            ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
            : persistentLocalCache();
        } catch (cacheErr) {
          try { opts.localCache = persistentLocalCache(); } catch (e2) {}
        }
      }
      return initializeFirestore(app, opts);
    }
  } catch (fsErr) {
    console.warn('Firestore persistent cache init fallback:', fsErr);
  }
  return getFirestore(app);
})();
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const $ = id => document.getElementById(id);
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };

// ---- Диалоги внутри страницы
let dlgDone = null;
function dlgOpen(build, okLabel, danger, getVal) {
  return new Promise(res => {
    if (dlgDone) dlgDone(null);
    const m = $('dlgModal'), done = v => {
      if (dlgDone !== done) return;
      dlgDone = null;
      hideModalElement(m);
      res(v);
    };
    dlgDone = done;
    if ($('dlgCancel')) $('dlgCancel').style.display = '';
    build();
    const ok = $('dlgOk'); ok.textContent = okLabel; ok.className = 'btn' + (danger ? ' btn-d' : '');
    ok.onclick = () => done(getVal()); $('dlgCancel').onclick = () => done(null);
    m.style.display = 'flex';
  });
}
const uiConfirm = (msg, okLabel = 'Продолжить', danger = false) => dlgOpen(() => { $('dlgTitle').textContent = 'Подтверждение'; $('dlgText').textContent = msg; $('dlgBody').replaceChildren(); }, okLabel, danger, () => true).then(v => v === true);
function uiPrompt(title, def = '', ph = '', subText = '') {
  let inp; return dlgOpen(() => { inp = el('input'); inp.value = def; inp.placeholder = ph; $('dlgTitle').textContent = title; $('dlgText').textContent = subText || ''; $('dlgBody').replaceChildren(inp); inp.onkeydown = e => { if (e.key === 'Enter') $('dlgOk').click(); }; setTimeout(() => inp.focus(), 40); }, 'Сохранить', false, () => inp.value);
}
function uiListDialog(name, desc, cn, cols) {
  let iName, iDesc, cur = cn || '';
  return dlgOpen(() => {
    iName = el('input'); iDesc = el('input'); const sw = el('div', 'c-swatches');
    iName.value = name || ''; iName.placeholder = 'Название подборки'; iDesc.value = desc || ''; iDesc.placeholder = 'Описание (необязательно)';
    const paint = () => [...sw.children].forEach(b => b.classList.toggle('on', b.dataset.c === cur));
    [['', '#64748b'], ...Object.entries(cols)].forEach(([k, hex]) => { const b = el('button', 'c-sw'); b.type = 'button'; b.dataset.c = k; b.style.background = hex; b.title = k || 'Без цвета'; b.onclick = () => { cur = k; paint(); }; sw.append(b); }); paint();
    const f = (l, x) => { const w = el('div', 'fld'); w.append(el('label', null, l), x); return w; };
    $('dlgTitle').textContent = 'Настройка подборки'; $('dlgText').textContent = 'Оставь название пустым, чтобы удалить подборку (тайтлы останутся в коллекции).';
    $('dlgBody').replaceChildren(f('Название', iName), f('Описание', iDesc), f('Цвет метки', sw));
  }, 'Сохранить', false, () => ({name: iName.value.trim(), desc: iDesc.value.trim(), cn: cur}));
}

function isManualItemEditable(it) {
  if (!it) return false;
  if (typeof KirokuEngine !== 'undefined' && typeof KirokuEngine.isManualTitleItem === 'function') {
    return KirokuEngine.isManualTitleItem(it);
  }
  if (typeof hasExternalCatalogId === 'function' && hasExternalCatalogId(it)) return false;
  return !it.aniId && !it.mal && !it.tmdb && !it.shikiId && !it.mdId && !it.imdbId;
}

function getAllUserCollectionNames() {
  const seen = new Map();
  const add = raw => {
    const nm = String(raw || '').trim();
    if (!nm) return;
    const key = nm.toLowerCase();
    if (!seen.has(key)) seen.set(key, nm);
  };
  (prof.customLists || []).forEach(add);
  (items || []).forEach(x => (x.lists || []).forEach(add));
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'ru'));
}

async function openAddToCollectionModal(targetItem, onUpdated = null) {
  if (!targetItem) return;
  const resolveColItem = () => {
    if (targetItem.id != null) {
      const byId = items.find(x => String(x.id) === String(targetItem.id));
      if (byId) return byId;
    }
    if (typeof same === 'function') {
      const bySame = items.find(x => same(x, targetItem));
      if (bySame) return bySame;
    }
    return null;
  };

  let searchInput = null;
  let listBox = null;

  const computeCountsMap = () => {
    const map = {};
    (items || []).forEach(x => {
      if (x.archived) return;
      (x.lists || []).forEach(l => {
        const k = String(l || '').trim().toLowerCase();
        if (k) map[k] = (map[k] || 0) + 1;
      });
    });
    return map;
  };

  const toggleFolderForItem = async (folderName, isCreate = false) => {
    const cleanName = String(folderName || '').trim();
    if (!cleanName) return;
    let colItem = resolveColItem();
    if (!colItem && typeof quickAdd === 'function') {
      colItem = await quickAdd(targetItem, 'В планах');
    }
    if (!colItem) return;

    prof.customLists = prof.customLists || [];
    if (!prof.customLists.some(x => x.toLowerCase() === cleanName.toLowerCase())) {
      prof.customLists.push(cleanName);
    }

    colItem.lists = Array.isArray(colItem.lists) ? colItem.lists : [];
    const existsInItem = colItem.lists.some(x => x.toLowerCase() === cleanName.toLowerCase());
    if (existsInItem && !isCreate) {
      colItem.lists = colItem.lists.filter(x => x.toLowerCase() !== cleanName.toLowerCase());
      toast(`Убрано из подборки «${cleanName}»`);
    } else if (!existsInItem) {
      colItem.lists.push(cleanName);
      toast(isCreate ? `Подборка «${cleanName}» создана и тайтл добавлен` : `Добавлено в подборку «${cleanName}»`);
    }

    cloudSave(colItem);
    profCloud(true);
    refreshLists();
    if (typeof renderMyListsFolderBlock === 'function') renderMyListsFolderBlock();
    if (typeof refresh === 'function') refresh({ itemId: colItem.id });
    if (isCreate && searchInput) searchInput.value = '';
    renderList();
    if (typeof onUpdated === 'function') onUpdated(colItem);
  };

  const renderList = () => {
    if (!listBox) return;
    listBox.replaceChildren();
    const colItem = resolveColItem();
    const curLists = colItem ? (colItem.lists || []) : [];
    const allFolders = getAllUserCollectionNames();
    const countsMap = computeCountsMap();
    const query = searchInput ? searchInput.value : '';

    const data = (typeof KirokuEngine !== 'undefined' && KirokuEngine.filterAndListCollections)
      ? KirokuEngine.filterAndListCollections(allFolders, curLists, query, countsMap)
      : {
          totalCount: allFolders.length,
          query: String(query || '').trim(),
          canCreateNew: Boolean(String(query || '').trim() && !allFolders.some(f => f.toLowerCase() === String(query || '').trim().toLowerCase())),
          items: allFolders
            .filter(f => !query || f.toLowerCase().includes(String(query).trim().toLowerCase()))
            .map(name => ({
              name,
              inList: curLists.some(x => x.toLowerCase() === name.toLowerCase()),
              count: countsMap[name.toLowerCase()] || 0
            }))
        };

    if (data.canCreateNew) {
      const createBtn = el('button', 'col-picker-item col-picker-create');
      createBtn.type = 'button';
      createBtn.append(
        el('span', 'col-picker-item-left', `＋ Создать подборку «${data.query}» и добавить`),
        el('span', 'col-picker-item-right', 'Новая')
      );
      createBtn.onclick = () => toggleFolderForItem(data.query, true);
      listBox.append(createBtn);
    }

    if (!data.items.length) {
      const msg = data.totalCount === 0
        ? 'Подборок пока нет — введи название выше, чтобы создать первую.'
        : 'Подходящих подборок не найдено. Нажми кнопку выше, чтобы создать новую.';
      listBox.append(el('div', 'col-picker-empty', msg));
      return;
    }

    data.items.forEach(entry => {
      const rowBtn = el('button', 'col-picker-item' + (entry.inList ? ' on' : ''));
      rowBtn.type = 'button';
      rowBtn.dataset.folder = entry.name;
      const left = el('span', 'col-picker-item-left', `${entry.inList ? '✓' : '📁'} ${entry.name}`);
      const right = el('span', 'col-picker-item-right', `${entry.count} шт. · ${entry.inList ? 'В подборке' : '+ Добавить'}`);
      rowBtn.append(left, right);
      rowBtn.onclick = () => toggleFolderForItem(entry.name, false);
      listBox.append(rowBtn);
    });
  };

  await dlgOpen(() => {
    if ($('dlgCancel')) $('dlgCancel').style.display = 'none';
    $('dlgTitle').textContent = '📁 Добавить в подборку';
    $('dlgText').textContent = targetItem.title ? `Тайтл: «${targetItem.title}». Выбери одну или несколько подборок:` : 'Выбери одну или несколько подборок:';
    const body = $('dlgBody');
    body.replaceChildren();
    searchInput = el('input', 'col-picker-search');
    searchInput.type = 'text';
    searchInput.placeholder = 'Поиск по моим подборкам или название новой…';
    searchInput.oninput = renderList;
    searchInput.onkeydown = e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const firstBtn = listBox?.querySelector('.col-picker-item');
        if (firstBtn) firstBtn.click();
      }
    };
    listBox = el('div', 'col-picker-list');
    body.append(searchInput, listBox);
    renderList();
    setTimeout(() => searchInput && searchInput.focus({ preventScroll: true }), 40);
  }, 'Готово', false, () => true);
}

const CATS = ['Фильм','Сериал','Аниме','Манга','Ранобэ','Мультфильм'];
const num = v => parseFloat(v) || 0;

// Схема Варианта А: каждый тайтл имеет kind === 'title', а подвид манги (Манга/Манхва/Маньхуа/Комикс) хранится в subKind
const MANGA_SUBKINDS = ['Манга', 'Манхва', 'Маньхуа', 'Комикс'];
const fix = i => {
  if (!i || typeof i !== 'object') return i;
  if (i.category === 'Манхва') { i.category = 'Манга'; i.subKind = 'Манхва'; }
  else if (i.category === 'Маньхуа') { i.category = 'Манга'; i.subKind = 'Маньхуа'; }
  else if (i.category === 'Манга') {
    if (!i.subKind) {
      if (i.kind && MANGA_SUBKINDS.includes(i.kind)) i.subKind = i.kind;
      else i.subKind = 'Манга';
    }
  } else if (i.category === 'Мультфильм') {
    i.category = (num(i.eps) > 1 || num(i.seasons) > 0) ? 'Сериал' : 'Фильм';
  }
  if (i.status === 'Любимое') {
    i.fav = true;
    i.status = i.prevSt && i.prevSt !== 'Любимое' ? i.prevSt : 'Просмотрено/Прочитано';
  }
  i.kind = 'title';
  i.needsReview = Boolean(i.needsReview ?? false);
  if (Array.isArray(i.posterFallbacks)) {
    i.posterFallbacks = [...new Set(i.posterFallbacks.filter(isValidPosterUrl))].slice(0, 6);
    if (!i.posterFallbacks.length) delete i.posterFallbacks;
  }
  return i;
};
const getMangaSubKind = i => {
  if (!i) return '';
  if (i.subKind && MANGA_SUBKINDS.includes(i.subKind)) return i.subKind;
  if (i.kind && MANGA_SUBKINDS.includes(i.kind)) return i.kind;
  return i.category === 'Манга' ? 'Манга' : '';
};
const catLabel = i => {
  if (!i) return '';
  if (i.category === 'Манга') {
    const sk = getMangaSubKind(i);
    return sk && sk !== 'Манга' ? sk : 'Манга';
  }
  return i.category || '';
};
const STATS = ['В планах','Смотрю/Читаю','Просмотрено/Прочитано','Отложено','Пересматриваю','Брошено'];
const FORMAT_RU = {
  TV: 'TV-сериал', TV_SHORT: 'Короткометражный TV', MOVIE: 'Полнометражный фильм',
  SPECIAL: 'Спешл (Special)', OVA: 'OVA', ONA: 'ONA (Веб-аниме)', MUSIC: 'Музыкальное видео',
  MANGA: 'Манга', NOVEL: 'Ранобэ / Новелла', ONE_SHOT: 'Ваншот'
};
const REL_RU = {
  PREQUEL: 'Предыстория (Приквел)', SEQUEL: 'Продолжение (Сиквел)', PARENT: 'Основная вселенная',
  SIDE_STORY: 'Ответвление (Спин-офф)', ADAPTATION: 'Адаптация / Первоисточник',
  ALTERNATIVE: 'Альтернативная версия', SPIN_OFF: 'Спин-офф', SUMMARY: 'Рекап'
};
let selMode = false;
const selSet = new Set();
const reviewSelSet = new Set();
const uncertainMatchesQueue = [];
const isReadCategory = c => c === 'Манга' || c === 'Ранобэ';
function getStatusLabelForCategory(st, c) {
  if (!st) return '';
  if (st === 'Смотрю/Читаю') {
    if (isReadCategory(c)) return 'Читаю';
    if (!c || c === 'Всё') return 'Смотрю / Читаю';
    return 'Смотрю';
  }
  if (st === 'Просмотрено/Прочитано') {
    if (isReadCategory(c)) return 'Прочитано';
    if (!c || c === 'Всё') return 'Просмотрено / Прочитано';
    return 'Просмотрено';
  }
  if (st === 'Пересматриваю') {
    return isReadCategory(c) ? 'Перечитываю' : 'Пересматриваю';
  }
  return st;
}
function formatAddedDateRu(it) {
  const ts = Number(it?.addedAt) || born(it);
  return ts ? new Date(ts).toLocaleDateString('ru-RU') : '';
}
const FALL = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280" viewBox="0 0 200 280"><rect width="200" height="280" fill="%23222534"/><text x="50%" y="50%" fill="%23777" font-family="Arial, sans-serif" font-size="16" text-anchor="middle" dominant-baseline="middle">Нет постера</text></svg>';

let user = null, items = [], loaded = false, cat = 'Всё', kind = 'Все', curId = null, unsub = null, posterValue = '', view = (localStorage.getItem('view') === 'list' ? 'list' : 'grid'), ongOnly = false, xf = null, lastList = [], afTok = 0;
let profTried = false;
let prof = {name: '', bio: '', mood: '', realName: '', bday: '', avatar: '', cover: '', coverColor: 0, bgAll: false};
let pf = null, pfTarget = '';
const grid = $('itemsGrid');

const resetProfObjectToDefault = () => {
  Object.keys(prof).forEach(k => delete prof[k]);
  Object.assign(prof, { name: '', bio: '', mood: '', realName: '', bday: '', avatar: '', cover: '', coverColor: 0, bgAll: false });
};
const getUidStorageKey = prefix => prefix + '_' + (user && user.uid ? user.uid : 'local_user');

let storageWarned = false;
let _cloudProfLoaded = false;
const isBase64DataUrl = v => typeof v === 'string' && v.startsWith('data:');

// IndexedDB-хранилище без лимита в 5 МБ (мгновенно сохраняет и восстанавливает 500+ тайтлов, аватар и обложку даже при обновлении кода)
const idbVault = (() => {
  let dbProm = null;
  const open = () => {
    if (dbProm) return dbProm;
    dbProm = new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') return rej(new Error('No IDB'));
      const req = indexedDB.open('MediaTrackerVaultDB_v1', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    return dbProm;
  };
  return {
    async get(key) {
      try {
        const d = await open();
        return await new Promise((res, rej) => {
          const tx = d.transaction('kv', 'readonly');
          const r = tx.objectStore('kv').get(key);
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
      } catch (e) { return null; }
    },
    async set(key, val) {
      try {
        const d = await open();
        await new Promise((res, rej) => {
          const tx = d.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(val, key);
          tx.oncomplete = () => res(true);
          tx.onerror = () => rej(tx.error);
        });
      } catch (e) {}
    },
    async del(key) {
      try {
        const d = await open();
        await new Promise((res, rej) => {
          const tx = d.transaction('kv', 'readwrite');
          tx.objectStore('kv').delete(key);
          tx.oncomplete = () => res(true);
          tx.onerror = () => rej(tx.error);
        });
      } catch (e) {}
    }
  };
})();

const stripItemBase64ForLocal = it => {
  if (!it || typeof it !== 'object') return it;
  if (!isBase64DataUrl(it.poster) && !isBase64DataUrl(it.badgeCharImg)) return it;
  const copy = { ...it };
  if (isBase64DataUrl(copy.poster)) copy.poster = '';
  if (isBase64DataUrl(copy.badgeCharImg)) copy.badgeCharImg = '';
  return copy;
};

function stripUndefinedDeep(val) {
  if (Array.isArray(val)) return val.map(stripUndefinedDeep).filter(v => v !== undefined);
  if (val && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) out[k] = stripUndefinedDeep(v);
    }
    return out;
  }
  return val;
}

// В IndexedDB сохраняем полный профиль с base64-аватаром и обложкой, а для localStorage вырезаем base64 (экономия лимита 5 МБ)
const prepareProfForIDB = pObj => {
  const copy = { ...(pObj || {}) };
  if (Array.isArray(copy.favChars)) {
    copy.favChars = copy.favChars.map(fc => isBase64DataUrl(fc?.img) ? { ...fc, img: '' } : fc);
  }
  return copy;
};

const prepareProfForLocal = pObj => {
  const copy = prepareProfForIDB(pObj);
  if (isBase64DataUrl(copy.avatar)) copy.avatar = '';
  if (isBase64DataUrl(copy.cover)) copy.cover = '';
  return copy;
};

let _saveLocalItemsTimer = 0;
const flushLocalItemsNow = (forceEmpty = false) => {
  clearTimeout(_saveLocalItemsTimer);
  _saveLocalItemsTimer = 0;
  if (!loaded) return;
  const uidKey = getUidStorageKey('items');
  const slimItems = items.map(stripItemBase64ForLocal);
  const safetyKey = getUidStorageKey('safetyBackup');

  if (!forceEmpty && slimItems.length === 0) {
    const existingLocal = loadLocalItems();
    let metaCnt = 0;
    try { metaCnt = Number(JSON.parse(localStorage.getItem(uidKey + '_meta') || '{}').count || 0); } catch (e) {}
    if (existingLocal.length > 0 || metaCnt > 0) return;
    // Дополнительно проверяем IndexedDB перед записью пустого массива, чтобы не затереть коллекцию при сбое localStorage
    idbVault.get(uidKey).then(existingIdb => {
      if (Array.isArray(existingIdb) && existingIdb.length > 0) return;
      idbVault.set(uidKey, []);
      if (user && user.isLocal) idbVault.set('localItems', []);
    });
    return;
  }

  // IndexedDB — основное хранилище без лимита 5 МБ (надёжно держит 5 000–10 000+ тайтлов)
  idbVault.set(uidKey, slimItems);
  if (user && user.isLocal) idbVault.set('localItems', slimItems);

  const allowSafetyShrink = Boolean(window._userInitiatedDelete || forceEmpty);
  if (slimItems.length > 0) {
    idbVault.get(safetyKey).then(prevSafety => {
      if (allowSafetyShrink || !Array.isArray(prevSafety) || slimItems.length >= prevSafety.length) {
        idbVault.set(safetyKey, slimItems);
        if (slimItems.length <= 800) {
          try { localStorage.setItem(safetyKey, JSON.stringify(slimItems)); } catch (e) {}
        } else {
          try { localStorage.removeItem(safetyKey); } catch (e) {}
        }
      }
    });
  } else if (forceEmpty) {
    idbVault.set(safetyKey, []);
    try { localStorage.removeItem(safetyKey); } catch (e) {}
  }

  try {
    localStorage.setItem(uidKey + '_meta', JSON.stringify({ count: slimItems.length, updatedAt: Date.now() }));
    if (slimItems.length <= 1500) {
      const json = JSON.stringify(slimItems);
      localStorage.setItem(uidKey, json);
      if (user && user.isLocal) localStorage.setItem('localItems', json);
    } else {
      // При огромной коллекции (1500–10000+ тайтлов) основная копия живёт в IndexedDB, не переполняя 5 МБ localStorage
      const compactItems = slimItems.map(x => ({ ...x, description: (x.description || '').slice(0, 120) }));
      const compactJson = JSON.stringify(compactItems);
      localStorage.setItem(uidKey, compactJson);
      if (user && user.isLocal) localStorage.setItem('localItems', compactJson);
    }
  } catch (e) {
    try {
      localStorage.removeItem('ruCache');
      localStorage.removeItem(safetyKey);
    } catch (e2) {}
  }
};

const saveLocalItems = (forceEmpty = false) => {
  if (!loaded) return;
  if (forceEmpty) {
    flushLocalItemsNow(true);
    return;
  }
  clearTimeout(_saveLocalItemsTimer);
  _saveLocalItemsTimer = setTimeout(() => flushLocalItemsNow(false), 350);
};

const isTitleDoc = x => x && (
  x.kind === 'title' ||
  MANGA_SUBKINDS.includes(x.kind) ||
  (!x.kind && !x.isProfile && !x.isWallComment && !x.isRecInbox && !x.isReport && !x.secretCredKey)
);

const loadLocalItems = (forUid) => {
  try {
    const uidKey = 'items_' + (forUid || (user && user.uid) || 'local_user');
    const raw = localStorage.getItem(uidKey) || (forUid === 'local_user' ? (localStorage.getItem('localItems') || localStorage.getItem('offlineItemsCache')) : '[]') || '[]';
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isTitleDoc).map(fix) : [];
  } catch (e) { return []; }
};

const loadLocalItemsAsync = async (forUid) => {
  const eff = forUid || (user && user.uid) || 'local_user';
  const uidKey = 'items_' + eff;
  const lsItems = loadLocalItems(eff);
  try {
    const idbItems = (await idbVault.get(uidKey)) || (eff === 'local_user' ? await idbVault.get('localItems') : null);
    if (Array.isArray(idbItems) && idbItems.length >= lsItems.length) {
      return idbItems.filter(isTitleDoc).map(fix);
    }
  } catch (e) {}
  return lsItems;
};

let _profLocalTimer = 0;
let _lastSavedProfJson = '';
const profSaveLocal = (immediate = false) => {
  const run = () => {
    _profLocalTimer = 0;
    const uid = (user && user.uid) || 'local_user';
    const idbData = prepareProfForIDB(prof);
    idbVault.set('prof_' + uid, idbData);
    if (uid === 'local_user') idbVault.set('prof', idbData);
    try {
      const lsData = prepareProfForLocal(prof);
      const json = JSON.stringify(lsData);
      localStorage.setItem('prof_' + uid, json);
      if (uid === 'local_user') localStorage.setItem('prof', json);
    } catch (e) {
      try { localStorage.removeItem('ruCache'); } catch (e2) {}
    }
  };
  if (immediate) {
    clearTimeout(_profLocalTimer);
    run();
  } else {
    clearTimeout(_profLocalTimer);
    _profLocalTimer = setTimeout(run, 350);
  }
};

let pend = 0, syncBad = false, cloudAccessError = '';
let cloudQuotaBlockedUntil = 0;
let _quotaToastShown = false;
let _cloudBannerDismissedKey = '';
let _activeCloudSessionUid = '';
let _cloudSyncInFlight = null;
let _colRevBumpTimer = 0;

const CLOUD_QUOTA_COOLDOWN_MS = 15 * 60 * 1000;
const FULL_SYNC_RECONCILE_MS = 24 * 60 * 60 * 1000;

function isQuotaError(err) {
  if (!err) return false;
  const code = String(err.code || '').toLowerCase();
  const msg = String(err.message || err || '').toLowerCase();
  return code.includes('resource-exhausted') || /resource[-_ ]?exhausted|quota exceeded|daily usage limit/i.test(msg);
}

function isNetworkError(err) {
  if (!err) return false;
  const code = String(err.code || '').toLowerCase();
  const msg = String(err.message || err || '').toLowerCase();
  return ['unavailable', 'deadline-exceeded', 'aborted'].some(c => code.includes(c)) || /offline|network|failed to get document because the client is offline/i.test(msg);
}

function getQuotaStorageKey(forUid) {
  return 'cloudQuotaUntil_' + (forUid || (user && user.uid) || 'anon');
}

function loadQuotaCooldownForUid(forUid) {
  try {
    const until = Number(localStorage.getItem(getQuotaStorageKey(forUid)) || 0);
    if (until > Date.now()) {
      cloudQuotaBlockedUntil = until;
      cloudAccessError = 'resource-exhausted';
      syncBad = true;
      return until;
    }
    if (until) localStorage.removeItem(getQuotaStorageKey(forUid));
  } catch (e) {}
  cloudQuotaBlockedUntil = 0;
  return 0;
}

function isCloudQuotaBlocked() {
  if (cloudQuotaBlockedUntil && Date.now() < cloudQuotaBlockedUntil) return true;
  if (cloudQuotaBlockedUntil && Date.now() >= cloudQuotaBlockedUntil) {
    cloudQuotaBlockedUntil = 0;
    try { localStorage.removeItem(getQuotaStorageKey()); } catch (e) {}
  }
  return false;
}

function isCloudWriteBlocked() {
  return !user || user.isLocal || Boolean(window.__FIREBASE_OFFLINE_FALLBACK) || !navigator.onLine || !auth.currentUser || isCloudQuotaBlocked();
}

function getPendingDeletesKey(forUid) {
  return 'pendingCloudDeletes_' + (forUid || (user && user.uid) || 'local_user');
}

function getPendingDeletes(forUid) {
  try {
    const arr = JSON.parse(localStorage.getItem(getPendingDeletesKey(forUid)) || '[]');
    return Array.isArray(arr) ? arr.filter(Boolean).map(String) : [];
  } catch (e) { return []; }
}

function setPendingDeletes(ids, forUid) {
  const clean = [...new Set((ids || []).filter(Boolean).map(String))];
  const key = getPendingDeletesKey(forUid);
  try {
    if (clean.length) localStorage.setItem(key, JSON.stringify(clean));
    else localStorage.removeItem(key);
  } catch (e) {}
  idbVault.set(key, clean);
  return clean;
}

function addPendingDeletes(docIds, forUid) {
  if (!docIds || !docIds.length) return;
  const cur = getPendingDeletes(forUid);
  setPendingDeletes([...cur, ...docIds], forUid);
}

function removePendingDeletes(docIds, forUid) {
  if (!docIds || !docIds.length) return;
  const rm = new Set(docIds.map(String));
  setPendingDeletes(getPendingDeletes(forUid).filter(id => !rm.has(String(id))), forUid);
}

function getCloudSyncMetaKey(forUid) {
  return 'cloudSyncMeta_' + (forUid || (user && user.uid) || 'anon');
}

function getCloudSyncMeta(forUid) {
  try {
    const raw = JSON.parse(localStorage.getItem(getCloudSyncMetaKey(forUid)) || '{}');
    return (raw && typeof raw === 'object') ? raw : {};
  } catch (e) { return {}; }
}

function setCloudSyncMeta(patch, forUid) {
  const key = getCloudSyncMetaKey(forUid);
  const next = { ...getCloudSyncMeta(forUid), ...(patch || {}) };
  try { localStorage.setItem(key, JSON.stringify(next)); } catch (e) {}
  idbVault.set(key, next);
  return next;
}

function clearCloudErrorState(forUid) {
  cloudAccessError = '';
  syncBad = false;
  cloudQuotaBlockedUntil = 0;
  _quotaToastShown = false;
  try { localStorage.removeItem(getQuotaStorageKey(forUid)); } catch (e) {}
  setSync();
}

function handleCloudError(err, silent = false) {
  if (!err) return;
  if (isQuotaError(err)) {
    cloudAccessError = 'resource-exhausted';
    syncBad = true;
    cloudQuotaBlockedUntil = Date.now() + CLOUD_QUOTA_COOLDOWN_MS;
    try { localStorage.setItem(getQuotaStorageKey(), String(cloudQuotaBlockedUntil)); } catch (e) {}
    _cloudBannerDismissedKey = '';
    setSync();
    if (!silent && !_quotaToastShown) {
      _quotaToastShown = true;
      toast('Дневной лимит Firebase исчерпан. Все изменения сохраняются локально в браузере.', true);
    }
    return;
  }
  if (isNetworkError(err) || !navigator.onLine) {
    cloudAccessError = 'unavailable';
    syncBad = true;
    setSync();
    return;
  }
  cloudAccessError = err?.code || err?.message || 'error';
  syncBad = true;
  setSync();
  if (!silent) {
    toast('Ошибка облака (' + cloudAccessError + '). Изменения сохранены локально.', true);
  }
}

const updateAccountBadge = () => {
  const b = $('accountBadge');
  if (!b) return;
  // Приватность в шапке: никогда не показываем email-адрес пользователя в верхней панели
  b.textContent = '';
  b.style.display = 'none';
};

function getUnsyncedPendingCounts() {
  const dirtyItems = items.filter(x => x && x.dirty).length;
  const pendingDeletes = (user && !user.isLocal) ? getPendingDeletes(user.uid).length : 0;
  let dirtyProf = false;
  try { dirtyProf = Boolean(user && !user.isLocal && localStorage.getItem('profDirty_' + user.uid) === '1'); } catch (e) {}
  return { dirtyItems, pendingDeletes, dirtyProf, total: dirtyItems + pendingDeletes + (dirtyProf ? 1 : 0) };
}

function renderCloudStatusBanner() {
  const box = $('cloudStatusBanner');
  if (!box) return;
  if (!user) {
    box.style.display = 'none';
    box.replaceChildren();
    return;
  }

  const pending = getUnsyncedPendingCounts();
  let mode = '';
  let title = '';
  let desc = '';
  let dismissKey = '';
  let showRetry = false;
  let showFlush = false;
  let showBackup = items.length > 0;
  let showDismiss = false;

  if (user.isLocal) {
    mode = 'is-local';
    dismissKey = 'local';
    title = '💻 Локальный режим (без облачной синхронизации)';
    desc = 'Коллекция хранится только в памяти этого браузера (IndexedDB и localStorage). При очистке данных сайта без бэкапа записи пропадут.';
    showDismiss = true;
  } else if (cloudAccessError === 'resource-exhausted' || isCloudQuotaBlocked()) {
    mode = 'is-quota';
    dismissKey = 'quota_' + Math.floor(cloudQuotaBlockedUntil / 60000);
    title = '⏳ Исчерпан дневной лимит облака Firebase (Spark)';
    desc = 'Бесплатный дневной лимит Firestore (50 000 чтений / 20 000 записей) временно исчерпан до суточного сброса (обычно ~10:00–11:00 МСК).'
      + (items.length
        ? ` Показана локальная копия (${items.length} тайтлов). Все новые изменения сохраняются в этом браузере.`
        : ' Твои облачные данные не удалены — они станут доступны после сброса квоты.');
    if (pending.total > 0) desc += ` В очереди на отправку в облако: ${pending.total}.`;
    showRetry = true;
    showDismiss = true;
  } else if (window.__FIREBASE_OFFLINE_FALLBACK || !navigator.onLine || cloudAccessError === 'unavailable') {
    mode = 'is-offline';
    dismissKey = 'offline';
    title = '📡 Нет связи с сервером Firebase (офлайн-режим)';
    desc = 'Приложение работает с локальным кэшем браузера. Новые изменения записываются локально'
      + (pending.total > 0 ? ` (ожидают синхронизации: ${pending.total})` : '')
      + ' и будут отправлены в облако при восстановлении связи.';
    showRetry = true;
    showDismiss = items.length > 0;
  } else if (cloudAccessError) {
    mode = 'is-error';
    dismissKey = 'err_' + cloudAccessError;
    title = `⚠ Облачная синхронизация ограничена (${cloudAccessError})`;
    desc = 'Показана локальная копия коллекции из памяти браузера. Новые изменения сохраняются локально.';
    showRetry = true;
    showDismiss = items.length > 0;
  } else if (pending.total > 0) {
    mode = 'is-pending';
    dismissKey = 'pending';
    title = `⏳ Есть несинхронизированные локальные изменения (${pending.total})`;
    desc = 'Эти правки были сохранены в браузере, пока облако было недоступно, и готовы к отправке в Firestore.';
    showFlush = true;
    showDismiss = true;
  }

  if (!mode || (_cloudBannerDismissedKey && _cloudBannerDismissedKey === dismissKey)) {
    box.style.display = 'none';
    box.replaceChildren();
    return;
  }

  box.className = 'cloud-status-banner ' + mode;
  box.style.display = 'flex';

  const body = el('div', 'cloud-banner-body');
  body.append(el('div', 'cloud-banner-title', title), el('div', 'cloud-banner-desc', desc));

  const actions = el('div', 'cloud-banner-actions');
  if (showFlush && typeof window.forceCloudSyncNow === 'function') {
    const bFlush = el('button', 'btn', '☁ Отправить сейчас');
    bFlush.type = 'button';
    bFlush.onclick = () => window.forceCloudSyncNow(true);
    actions.append(bFlush);
  }
  if (showRetry && typeof window.forceCloudSyncNow === 'function') {
    const bRetry = el('button', 'btn', '↻ Повторить');
    bRetry.type = 'button';
    bRetry.onclick = () => window.forceCloudSyncNow(true);
    actions.append(bRetry);
  }
  if (showBackup && typeof window.exportData === 'function') {
    const bExp = el('button', 'btn btn-s', '⬇ Скачать бэкап');
    bExp.type = 'button';
    bExp.onclick = () => window.exportData();
    actions.append(bExp);
  }
  if (showDismiss) {
    const bHide = el('button', 'btn btn-s', '✕ Скрыть');
    bHide.type = 'button';
    bHide.onclick = () => {
      _cloudBannerDismissedKey = dismissKey;
      box.style.display = 'none';
    };
    actions.append(bHide);
  }

  box.replaceChildren(body, actions);
}

const setSync = () => {
  updateAccountBadge();
  const e = $('syncState');
  const pending = getUnsyncedPendingCounts();
  if (e) {
    const renderSyncLabel = (cls, ic, txt, title) => {
      e.className = cls;
      e.title = title;
      e.setAttribute('aria-label', txt);
      e.replaceChildren(el('span', 'sync-ic', ic), el('span', 'sync-lbl', ' ' + txt));
    };
    e.onclick = () => {
      _cloudBannerDismissedKey = '';
      renderCloudStatusBanner();
      const banner = $('cloudStatusBanner');
      if (banner && banner.style.display !== 'none') {
        banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else if (user && !user.isLocal && typeof window.forceCloudSyncNow === 'function') {
        window.forceCloudSyncNow(true);
      } else if (user && user.isLocal) {
        toast('Локальный режим: данные хранятся только в этом браузере.');
      }
    };
    if (user && user.isLocal) {
      renderSyncLabel('sync warn clickable', '💻', 'Локально (только браузер)', 'Данные хранятся только в этом браузере. Нажми для подробностей');
    } else if (window.__FIREBASE_OFFLINE_FALLBACK) {
      renderSyncLabel('sync err clickable', '⚠', 'Офлайн (только локально)', 'Firebase SDK недоступен, включено локальное сохранение');
    } else if (!navigator.onLine) {
      renderSyncLabel('sync err clickable', '⚠', 'Нет сети (локально)', 'Нет подключения к интернету. Изменения сохраняются в браузер');
    } else if (cloudAccessError === 'resource-exhausted' || isCloudQuotaBlocked()) {
      renderSyncLabel('sync warn clickable', '⏳', 'Лимит Firebase (локально)', 'Дневной лимит запросов Spark исчерпан. Изменения сохраняются локально');
    } else if (cloudAccessError) {
      renderSyncLabel('sync err clickable', '⚠', 'Облако: ' + cloudAccessError, 'Проблема доступа к облаку. Нажми для деталей и повтора');
    } else if (pend) {
      renderSyncLabel('sync sav', '⏳', 'Сохранение...', 'Идёт запись в Firestore');
    } else if (pending.total > 0) {
      renderSyncLabel('sync warn clickable', '⏳', `В очереди: ${pending.total}`, 'Нажми, чтобы отправить локальные изменения в облако');
    } else if (syncBad) {
      renderSyncLabel('sync err clickable', '⚠', 'Ошибка сохранения', 'Нажми, чтобы повторить синхронизацию');
    } else {
      renderSyncLabel('sync clickable', '☁', 'Синхронизировано', 'Нажми, чтобы принудительно проверить обновления в облаке');
    }
  }
  renderCloudStatusBanner();
};

const track = p => {
  pend++; setSync();
  return p.then(res => {
    pend--;
    if (!pend && !isCloudQuotaBlocked()) {
      syncBad = false;
      cloudAccessError = '';
    }
    setSync();
    return res;
  }, e => {
    pend--;
    handleCloudError(e, true);
    throw e;
  });
};
addEventListener('online', () => {
  setSync();
  if (user && !user.isLocal && !isCloudQuotaBlocked() && auth.currentUser && typeof flushPendingCloudChanges === 'function') {
    setTimeout(() => flushPendingCloudChanges(false), 800);
  }
});
addEventListener('offline', setSync);

// Гарантируем, что ID документа тайтла никогда не начинается с зарезервированных префиксов prof_, wall_, rec_, bans_, fr_, dm_
const getCloudDocId = item => {
  let raw = item._docId ? String(item._docId) : ((user && user.uid ? user.uid + '_' : 'item_') + String(item.id));
  if (/^(prof_|wall_|rec_|rep_|ban_|bans_|fr_|dm_)/i.test(raw)) {
    raw = (user && user.uid ? user.uid + '_' : 'item_') + String(item.id || Date.now());
    item._docId = raw;
  }
  return raw;
};

// Очищаем служебные поля и undefined перед сохранением документа в Firestore
const prepareTitleForCloud = (it, uid) => {
  fix(it);
  const docId = getCloudDocId(it);
  const cleanCopy = { ...it };
  delete cleanCopy._knownStatusFromImport;
  delete cleanCopy.lastLinkAttempt;
  delete cleanCopy._normCache;
  delete cleanCopy.dirty;
  return {
    docId,
    payload: stripUndefinedDeep({
      ...cleanCopy,
      _docId: docId,
      kind: 'title',
      userId: uid
    })
  };
};

// Проверка и склейка дублей с одинаковым id (например, если в облаке лежал старый документ "{id}" без префикса и новый "{uid}_{id}" — Этап 1 п.2)
function deduplicateListByIdAndCleanupCloud(rawList, cleanCloud = false) {
  const byId = new Map();
  const orphanDocIdsToDelete = [];
  const preferredPrefix = (user && user.uid) ? (user.uid + '_') : '';
  (rawList || []).forEach(it => {
    if (!it) return;
    if (!it.id) it.id = newId();
    const key = String(it.id);
    if (!byId.has(key)) {
      byId.set(key, it);
      return;
    }
    const prev = byId.get(key);
    const prevPrefixed = preferredPrefix && String(prev._docId || '').startsWith(preferredPrefix);
    const curPrefixed = preferredPrefix && String(it._docId || '').startsWith(preferredPrefix);
    let keeper = prev, duplicate = it;
    if (curPrefixed && !prevPrefixed) { keeper = it; duplicate = prev; }
    const merged = (typeof mergeTwoDuplicateItems === 'function') ? mergeTwoDuplicateItems(keeper, duplicate) : keeper;
    merged._docId = keeper._docId || ((preferredPrefix || 'item_') + merged.id);
    byId.set(key, merged);
    if (duplicate._docId && duplicate._docId !== merged._docId) {
      orphanDocIdsToDelete.push(duplicate._docId);
    }
  });
  if (cleanCloud && orphanDocIdsToDelete.length && user && !user.isLocal) {
    if (isCloudWriteBlocked()) {
      addPendingDeletes(orphanDocIdsToDelete, user.uid);
    } else {
      (async () => {
        for (let i = 0; i < orphanDocIdsToDelete.length; i += 350) {
          const chunk = orphanDocIdsToDelete.slice(i, i + 350);
          try {
            const b = writeBatch(db);
            chunk.forEach(dId => b.delete(doc(db, 'items', dId)));
            await b.commit();
          } catch (err) {
            addPendingDeletes(chunk, user.uid);
            handleCloudError(err, true);
            break;
          }
        }
      })();
    }
  }
  return [...byId.values()];
}

const SESSION_WRITER_ID = 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
let _chunkStorageDenied = false;
let _chunkSyncTimer = 0;
let _chunkSyncInFlight = null;

function isChunkStorageEnabled() {
  return Boolean(typeof KirokuEngine !== 'undefined' && !_chunkStorageDenied);
}

async function saveCollectionChunksToCloud(uid, listToPack, opts = {}) {
  if (!uid || !user || user.isLocal || !isChunkStorageEnabled()) return false;
  if (isCloudWriteBlocked()) {
    try { localStorage.setItem('colChunksDirty_' + uid, '1'); } catch (e) {}
    return false;
  }
  const chunks = KirokuEngine.packCollectionChunks(listToPack || []);
  const prevCount = Math.max(0, Number(prof.colChunkCount || 0));
  const revVal = Date.now();
  try {
    const b = writeBatch(db);
    chunks.forEach(ch => {
      b.set(doc(db, 'items', `prof_col_${uid}_${ch.chunkIdx}`), {
        kind: 'profile',
        isProfile: true,
        isColChunk: true,
        userId: uid,
        chunkIdx: ch.chunkIdx,
        chunkTotal: ch.chunkTotal,
        chunkRev: revVal,
        count: ch.count,
        payloadJson: ch.payloadJson
      });
    });
    for (let oldIdx = chunks.length; oldIdx < prevCount; oldIdx++) {
      b.delete(doc(db, 'items', `prof_col_${uid}_${oldIdx}`));
    }
    b.set(doc(db, 'items', 'prof_' + uid), {
      kind: 'profile',
      isProfile: true,
      userId: uid,
      colStorageV2: true,
      colChunkCount: chunks.length,
      colChunkRev: revVal,
      colChunkWriter: SESSION_WRITER_ID,
      colRev: revVal,
      colCount: (listToPack || []).length,
      schemaMigratedV4: true
    }, { merge: true });
    await track(b.commit());

    prof.colStorageV2 = true;
    prof.colChunkCount = chunks.length;
    prof.colChunkRev = revVal;
    prof.colChunkWriter = SESSION_WRITER_ID;
    prof.colRev = revVal;
    prof.colCount = (listToPack || []).length;
    prof.schemaMigratedV4 = true;
    setCloudSyncMeta({
      colRev: revVal,
      colCount: (listToPack || []).length,
      lastFullSyncAt: Date.now(),
      schemaMigratedV4: true
    }, uid);
    try { localStorage.removeItem('colChunksDirty_' + uid); } catch (e) {}
    profSaveLocal();
    (listToPack || []).forEach(it => { if (it && it.dirty) delete it.dirty; });
    saveLocalItems();
    setSync();
    return true;
  } catch (err) {
    const code = String(err?.code || '').toLowerCase();
    if (code.includes('permission-denied')) {
      _chunkStorageDenied = true;
      return false;
    }
    try { localStorage.setItem('colChunksDirty_' + uid, '1'); } catch (e) {}
    if (!opts.silent) handleCloudError(err, true);
    if (opts.throwOnError) throw err;
    return false;
  }
}

async function loadCollectionChunksFromCloud(uid, chunkCount) {
  const cnt = Math.max(0, Number(chunkCount || 0));
  if (!uid || cnt === 0) return [];
  const snaps = await Promise.all(
    Array.from({ length: cnt }, (_, idx) => track(getDoc(doc(db, 'items', `prof_col_${uid}_${idx}`))))
  );
  const docs = snaps.filter(s => s && s.exists()).map(s => s.data());
  if (!docs.length) return null;
  return KirokuEngine.unpackCollectionChunks(docs).map(fix);
}

function scheduleChunkCloudSync(immediate = false) {
  if (!user || user.isLocal || !isChunkStorageEnabled()) return Promise.resolve(false);
  const uid = user.uid;
  const revVal = Date.now();
  prof.colRev = revVal;
  prof.colCount = items.length;
  prof.colChunkWriter = SESSION_WRITER_ID;
  setCloudSyncMeta({ colRev: revVal, colCount: items.length, lastFullSyncAt: Date.now() }, uid);
  try { localStorage.setItem('colChunksDirty_' + uid, '1'); } catch (e) {}

  if (isCloudWriteBlocked()) {
    setSync();
    return Promise.resolve(false);
  }
  clearTimeout(_chunkSyncTimer);
  const runNow = () => {
    _chunkSyncTimer = 0;
    const prev = _chunkSyncInFlight || Promise.resolve();
    const cur = prev.catch(() => {}).then(() => saveCollectionChunksToCloud(uid, items, { silent: false }));
    _chunkSyncInFlight = cur;
    return cur.finally(() => {
      if (_chunkSyncInFlight === cur) _chunkSyncInFlight = null;
    });
  };
  if (immediate) return runNow();
  return new Promise(resolve => {
    _chunkSyncTimer = setTimeout(() => {
      runNow().then(resolve);
    }, 1800);
  });
}

function scheduleColRevBump() {
  if (!user || user.isLocal) return;
  const nextRev = Date.now();
  prof.colRev = nextRev;
  prof.colCount = items.length;
  prof.colChunkWriter = SESSION_WRITER_ID;
  setCloudSyncMeta({ colRev: nextRev, colCount: items.length, lastFullSyncAt: Date.now() }, user.uid);
  profSaveLocal();
  if (isChunkStorageEnabled() && prof.colStorageV2) {
    return;
  }
  if (isCloudWriteBlocked()) {
    try { localStorage.setItem('profDirty_' + user.uid, '1'); } catch (e) {}
    return;
  }
  clearTimeout(_colRevBumpTimer);
  _colRevBumpTimer = setTimeout(() => {
    if (isCloudWriteBlocked()) return;
    const revVal = Number(prof.colRev || Date.now());
    setCloudSyncMeta({ colRev: revVal, colCount: items.length, lastFullSyncAt: Date.now() }, user.uid);
    setDoc(doc(db, 'items', 'prof_' + user.uid), {
      kind: 'profile',
      isProfile: true,
      userId: user.uid,
      colRev: revVal,
      colCount: items.length,
      colChunkWriter: SESSION_WRITER_ID,
      schemaMigratedV4: Boolean(prof.schemaMigratedV4)
    }, { merge: true }).catch(err => handleCloudError(err, true));
  }, 2600);
}

const profCloud = (onlyWatchingCheck = false) => {
  if (!user) return;
  if (!prof.createdAt) {
    const fbTime = !user.isLocal && user.metadata?.creationTime ? new Date(user.metadata.creationTime).getTime() : 0;
    prof.createdAt = fbTime || Date.now();
  }
  prof.displayName = prof.name || user.displayName || (user.email ? user.email.split('@')[0] : 'Моя коллекция');
  if (!prof.name) prof.name = prof.displayName;

  const watchingNow = items
    .filter(i => !i.archived && i.status === 'Смотрю/Читаю')
    .sort((a, b) => (b.updatedAt || b.id) - (a.updatedAt || a.id))[0];
  const safeNwPoster = watchingNow && watchingNow.poster && !String(watchingNow.poster).startsWith('data:') ? watchingNow.poster : '';
  const nextWatching = watchingNow ? { id: watchingNow.id, title: watchingNow.title, poster: safeNwPoster, category: watchingNow.category } : null;

  if (onlyWatchingCheck) {
    if (JSON.stringify(prof.nowWatching || null) === JSON.stringify(nextWatching)) return;
  }

  prof.nowWatching = nextWatching;
  const nowTs = Date.now();
  const visitChanged = !prof.lastVisit || (nowTs - Number(prof.lastVisit)) > 6 * 3600 * 1000;
  if (visitChanged) prof.lastVisit = nowTs;
  profSaveLocal();

  if (!user.isLocal && !onlyWatchingCheck) {
    if (isCloudWriteBlocked()) {
      try { localStorage.setItem('profDirty_' + user.uid, '1'); } catch (e) {}
      setSync();
      return;
    }
    const safeProf = {...prof};
    delete safeProf.email;
    delete safeProf.ownerEmail;
    delete safeProf.statsSummary;
    delete safeProf.friends;
    if (!_cloudProfLoaded) {
      if (!safeProf.avatar) delete safeProf.avatar;
      if (!safeProf.cover) delete safeProf.cover;
      if (!safeProf.coverColor) delete safeProf.coverColor;
    }
    if (safeProf.cover && String(safeProf.cover).startsWith('data:') && String(safeProf.cover).length > 750000) {
      delete safeProf.cover;
      toast('Обложка слишком большая для облака (>750 КБ) и сохранена локально в IndexedDB. Выбери изображение меньшего размера.', true);
    }
    const cleanProfPayload = stripUndefinedDeep({
      ...safeProf,
      kind: 'profile',
      isProfile: true,
      userId: user.uid
    });
    const profFingerprint = JSON.stringify({ ...cleanProfPayload, lastVisit: 0, colRev: 0, colCount: 0 });
    if (profFingerprint === _lastSavedProfJson) {
      try { localStorage.removeItem('profDirty_' + user.uid); } catch (e) {}
      return;
    }
    _lastSavedProfJson = profFingerprint;
    track(setDoc(doc(db, 'items', 'prof_' + user.uid), cleanProfPayload, { merge: true })).then(() => {
      try { localStorage.removeItem('profDirty_' + user.uid); } catch (e) {}
      setSync();
    }).catch(e => {
      _lastSavedProfJson = '';
      try { localStorage.setItem('profDirty_' + user.uid, '1'); } catch (e2) {}
      handleCloudError(e, false);
    });
  }
};

// Очередь и дебаунс сохранения документов в Firestore (устраняет гонки запросов при быстрых кликах подряд)
const _cloudSaveTimers = new Map();
const _cloudSaveChains = new Map();
const _localPendingWrites = new Map();

const cloudSave = it => {
  if (!it) return Promise.resolve();
  it.updatedAt = Date.now();
  fix(it);
  if (!user || user.isLocal) {
    saveLocalItems();
    setSync();
    return Promise.resolve();
  }
  if (isCloudWriteBlocked()) {
    it.dirty = true;
    saveLocalItems();
    setSync();
    return Promise.resolve();
  }
  it.dirty = true;
  saveLocalItems();

  // Компактное чанковое сохранение: вместо 1 записи на каждый тайтл и шторма чтений — 1 сжатая запись с дебаунсом 1.8 сек
  if (isChunkStorageEnabled()) {
    return scheduleChunkCloudSync(false).then(ok => {
      if (!ok && _chunkStorageDenied) {
        return legacyCloudSaveSingleItem(it);
      }
    });
  }
  return legacyCloudSaveSingleItem(it);
};

function legacyCloudSaveSingleItem(it) {
  const docId = getCloudDocId(it);
  _localPendingWrites.set(docId, it.updatedAt);

  if (_cloudSaveTimers.has(docId)) {
    clearTimeout(_cloudSaveTimers.get(docId).timer);
    _cloudSaveTimers.get(docId).resolve();
  }

  return new Promise(resolve => {
    const timer = setTimeout(() => {
      _cloudSaveTimers.delete(docId);
      const latestItem = items.find(x => x.id === it.id) || it;
      if (isCloudWriteBlocked()) {
        latestItem.dirty = true;
        saveLocalItems();
        setSync();
        resolve();
        return;
      }
      const { payload } = prepareTitleForCloud(latestItem, user.uid);
      const prevChain = _cloudSaveChains.get(docId) || Promise.resolve();
      const nextChain = prevChain
        .catch(() => {})
        .then(() => track(setDoc(doc(db, 'items', docId), payload)))
        .then(() => {
          if (latestItem.dirty) {
            delete latestItem.dirty;
            saveLocalItems();
          }
          scheduleColRevBump();
          setSync();
        })
        .catch(e => {
          latestItem.dirty = true;
          saveLocalItems();
          handleCloudError(e, false);
        })
        .finally(() => {
          if (_cloudSaveChains.get(docId) === nextChain) _cloudSaveChains.delete(docId);
          resolve();
        });
      _cloudSaveChains.set(docId, nextChain);
    }, 450);
    _cloudSaveTimers.set(docId, { timer, resolve });
  });
}

async function startLocalMode(msg) {
  if (unsub) { unsub(); unsub = null; }
  _activeCloudSessionUid = '';
  clearCloudErrorState();
  if (typeof resetSessionMemoryState === 'function') resetSessionMemoryState();
  try { localStorage.setItem('useLocalMode', '1'); } catch (e) {}
  resetProfObjectToDefault();
  try { Object.assign(prof, JSON.parse(localStorage.getItem('prof_local_user') || localStorage.getItem('prof') || '{}')); } catch (e) {}
  const idbProf = (await idbVault.get('prof_local_user')) || (await idbVault.get('prof'));
  if (idbProf && typeof idbProf === 'object') {
    Object.assign(prof, { ...idbProf, avatar: prof.avatar || idbProf.avatar || '', cover: prof.cover || idbProf.cover || '' });
  }
  user = { uid: 'local_user', isLocal: true, displayName: prof.name || 'Моя коллекция', email: '', photoURL: prof.avatar || '', metadata: { creationTime: new Date().toISOString() } };
  $('authScreen').style.display = 'none'; $('appScreen').style.display = 'block';
  $('hdrAvatar').src = user.photoURL || FALL; $('profName').textContent = user.displayName; $('avatar').src = user.photoURL || FALL;
  items = await loadLocalItemsAsync('local_user'); loaded = true; setSync(); refresh(); profPaint();
  if (!cgGrid.children.length) cgLoad(true); homeTab();
  if (msg) toast(msg);
}

// Перенос локальной коллекции в облако (Этап 1 п.7):
// Спрашивает один раз на аккаунт и устройство, запоминает отказ, позволяет удалить локальную копию,
// объединяет локальные данные с облачными без потери полей, а также вызывается кнопкой из окна «Данные»
async function checkMigrateLocalItemsToCloud(manual = false) {
  if (!user || user.isLocal) {
    if (manual) toast('Перенос доступен только при входе в облачный аккаунт', true);
    return;
  }
  const declineKey = 'localMigrateDeclined_' + user.uid;
  const doneKey = 'localMigrateDone_' + user.uid;
  if (!manual && (localStorage.getItem(declineKey) === '1' || localStorage.getItem(doneKey) === '1')) return;

  try {
    const localArr = await loadLocalItemsAsync('local_user');
    if (!localArr.length) {
      if (manual) toast('Локальная копия на этом устройстве пуста.');
      return;
    }

    const toInsert = [];
    const toMerge = [];
    localArr.forEach(loc => {
      const match = findDuplicateMatch(loc, items);
      if (!match) {
        toInsert.push(loc);
      } else {
        // Проверяем, есть ли в локальной записи дополнительные данные (оценка, заметка, списки), которых нет в облачной
        const merged = mergeTwoDuplicateItems(match, loc);
        if (JSON.stringify(merged) !== JSON.stringify(match)) {
          toMerge.push(merged);
        }
      }
    });

    if (!toInsert.length && !toMerge.length) {
      try { localStorage.setItem(doneKey, '1'); } catch (e) {}
      if (manual) {
        if (await uiConfirm(`Все записи из локальной копии (${localArr.length} шт.) уже присутствуют в твоём облачном аккаунте.\nУдалить локальную копию с устройства?`, 'Удалить локальную копию', true)) {
          localStorage.removeItem('localItems');
          localStorage.removeItem('items_local_user');
          await Promise.allSettled([idbVault.del('localItems'), idbVault.del('items_local_user')]);
          toast('Локальная копия очищена ✓');
        }
      }
      return;
    }

    let actionChoice = 'migrate';
    const ok = await dlgOpen(() => {
      $('dlgTitle').textContent = `☁ Найдена локальная коллекция (${localArr.length} шт.)`;
      $('dlgText').textContent = `Новых тайтлов для добавления: ${toInsert.length} шт.\nСуществующих тайтлов для дополнения данными: ${toMerge.length} шт.\nОблачные данные не стираются — записи аккуратно объединятся.`;
      const body = $('dlgBody'); body.replaceChildren();
      const sel = el('select');
      sel.add(new Option(`☁ Перенести и объединить с облаком (+${toInsert.length} новых, ${toMerge.length} дополнить)`, 'migrate'));
      sel.add(new Option('⏭ Не переносить сейчас (больше не спрашивать при входе)', 'decline'));
      sel.add(new Option('🗑 Удалить локальную копию без переноса', 'delete_local'));
      sel.onchange = () => { actionChoice = sel.value; };
      body.append(sel);
    }, 'Выполнить', false, () => actionChoice);

    if (!ok) {
      if (!manual) {
        try { localStorage.setItem(declineKey, '1'); } catch (e) {}
      }
      return;
    }

    if (ok === 'decline') {
      try { localStorage.setItem(declineKey, '1'); } catch (e) {}
      toast('Хорошо! Перенести локальную коллекцию всегда можно вручную в окне «💾 Данные».');
      return;
    }

    if (ok === 'delete_local') {
      if (!(await uiConfirm(`Точно удалить локальную копию (${localArr.length} тайтлов) с этого устройства без переноса?`, 'Удалить локальную копию', true))) return;
      localStorage.removeItem('localItems');
      localStorage.removeItem('items_local_user');
      await Promise.allSettled([idbVault.del('localItems'), idbVault.del('items_local_user')]);
      try { localStorage.setItem(doneKey, '1'); } catch (e) {}
      toast('Локальная копия удалена.');
      return;
    }

    // Выполняем перенос и объединение с откатом при ошибке облака (Этап 1 п.3)
    const prevSnapshot = items.map(x => ({ ...x }));
    const usedIds = new Set(items.map(i => String(i.id)));
    const preparedInsert = toInsert.map(loc => {
      let idVal = Number(loc.id) || 0;
      while (!idVal || usedIds.has(String(idVal))) idVal = newId();
      usedIds.add(String(idVal));
      return fix({ ...loc, id: idVal, _docId: user.uid + '_' + idVal });
    });

    const allToSave = [...preparedInsert, ...toMerge];
    await batchSaveItems(allToSave, { requireCloud: true });

    toMerge.forEach(m => {
      const idx = items.findIndex(x => x.id === m.id);
      if (idx > -1) items[idx] = m;
    });
    items.push(...preparedInsert);
    items = deduplicateListByIdAndCleanupCloud(items, false);
    saveLocalItems();
    localStorage.removeItem('localItems');
    localStorage.removeItem('items_local_user');
    await Promise.allSettled([idbVault.del('localItems'), idbVault.del('items_local_user')]);
    try {
      localStorage.setItem(doneKey, '1');
      localStorage.removeItem(declineKey);
    } catch (e) {}
    refresh();
    toast(`Локальная коллекция перенесена: +${preparedInsert.length} новых, обновлено ${toMerge.length} шт.!`);
  } catch (e) {
    toast('Ошибка переноса локальной коллекции: ' + (e.code || e.message), true);
  }
}

// Одноразовая миграция старых документов в Firestore (включая перенос ID на префикс uid_ и добавление kind/userId)
async function migrateOldDocsToKindSchema(manual = false) {
  if (!user || user.isLocal || !auth.currentUser) {
    if (manual) toast('Миграция доступна только при входе в облачный аккаунт', true);
    return;
  }
  if (isCloudQuotaBlocked()) {
    if (manual) toast('Миграция невозможна: дневной лимит Firebase исчерпан.', true);
    return;
  }
  try {
    const ops = [];
    const uid = user.uid;
    const ownSnap = await getDocs(query(collection(db, 'items'), where('userId', '==', uid)));
    ownSnap.docs.forEach(d => {
      const raw = d.data();
      if (raw.isProfile || d.id === 'prof_' + uid || d.id === 'prof_rucache_' + uid) {
        if (raw.kind !== 'profile' || 'statsSummary' in raw || 'friends' in raw) {
          const clean = stripUndefinedDeep({ ...raw, kind: 'profile', isProfile: true, userId: uid });
          delete clean.statsSummary;
          delete clean.email;
          delete clean.ownerEmail;
          delete clean.friends;
          ops.push(['set', d.id, clean]);
        }
      } else if (raw.isReport || raw.kind === 'report') {
        ops.push(['del', d.id, null]);
      } else if (!raw.isWallComment && !raw.isRecInbox && !raw.secretCredKey && raw.kind !== 'friendReq' && raw.kind !== 'dm') {
        const itemId = raw.id || d.id.replace(new RegExp('^' + uid + '_'), '') || newId();
        const targetDocId = d.id.startsWith(uid + '_') ? d.id : `${uid}_${itemId}`;
        const subK = raw.category === 'Манхва' ? 'Манхва' : (raw.subKind || (MANGA_SUBKINDS.includes(raw.kind) ? raw.kind : (raw.category === 'Манга' ? 'Манга' : '')));
        const needsMove = d.id !== targetDocId;
        if (needsMove || raw.kind !== 'title' || (subK && raw.subKind !== subK) || '_knownStatusFromImport' in raw) {
          const updated = stripUndefinedDeep({
            ...raw,
            id: Number(itemId) || itemId,
            _docId: targetDocId,
            category: raw.category === 'Манхва' ? 'Манга' : raw.category,
            subKind: subK,
            kind: 'title',
            userId: uid
          });
          delete updated._knownStatusFromImport;
          delete updated.lastLinkAttempt;
          delete updated._normCache;
          ops.push(['set', targetDocId, updated]);
          if (needsMove) ops.push(['del', d.id, null]);
        }
      }
    });

    const markMigrated = () => {
      try { localStorage.setItem('schemaMigratedV4_' + uid, '1'); } catch (e) {}
      prof.schemaMigratedV4 = true;
      setCloudSyncMeta({ schemaMigratedV4: true }, uid);
      profSaveLocal();
      setDoc(doc(db, 'items', 'prof_' + uid), { kind: 'profile', isProfile: true, userId: uid, schemaMigratedV4: true }, { merge: true }).catch(() => {});
    };

    if (!ops.length) {
      markMigrated();
      if (manual) toast('Все твои записи уже соответствуют актуальной схеме облака ✓');
      return;
    }

    if (manual) toast(`Обновляю записи под новую схему: ${ops.length} операций…`);
    for (let i = 0; i < ops.length; i += 350) {
      const b = writeBatch(db);
      ops.slice(i, i + 350).forEach(([type, id, data]) => {
        if (type === 'del') b.delete(doc(db, 'items', id));
        else b.set(doc(db, 'items', id), data);
      });
      await track(b.commit());
    }
    markMigrated();
    toast(`Миграция завершена: выполнено ${ops.length} операций ✓`);
  } catch (e) {
    handleCloudError(e, false);
    if (manual) toast('Ошибка миграции старых записей: ' + (e.code || e.message), true);
  }
}

async function flushPendingCloudChanges(showToast = false) {
  if (!user || user.isLocal || isCloudWriteBlocked()) return false;
  const uid = user.uid;
  const pendingDeletes = getPendingDeletes(uid);
  const dirtyItems = items.filter(x => x && x.dirty);
  let dirtyProf = false;
  let dirtyChunks = false;
  try {
    dirtyProf = localStorage.getItem('profDirty_' + uid) === '1';
    dirtyChunks = localStorage.getItem('colChunksDirty_' + uid) === '1';
  } catch (e) {}
  if (!pendingDeletes.length && !dirtyItems.length && !dirtyProf && !dirtyChunks) return true;

  try {
    if (isChunkStorageEnabled() && (dirtyItems.length || pendingDeletes.length || dirtyChunks)) {
      const ok = await saveCollectionChunksToCloud(uid, items, { silent: !showToast, throwOnError: false });
      if (ok) {
        if (pendingDeletes.length) removePendingDeletes(pendingDeletes, uid);
        if (dirtyProf) {
          _lastSavedProfJson = '';
          profCloud(false);
        }
        setSync();
        if (showToast) toast('Отложенные локальные изменения отправлены в облако ✓');
        return true;
      }
    }

    if (pendingDeletes.length) {
      for (let i = 0; i < pendingDeletes.length; i += 350) {
        const chunk = pendingDeletes.slice(i, i + 350);
        const b = writeBatch(db);
        chunk.forEach(dId => b.delete(doc(db, 'items', dId)));
        await track(b.commit());
        removePendingDeletes(chunk, uid);
      }
    }
    if (dirtyItems.length) {
      for (let i = 0; i < dirtyItems.length; i += 350) {
        const chunk = dirtyItems.slice(i, i + 350);
        const b = writeBatch(db);
        chunk.forEach(dIt => {
          const { docId, payload } = prepareTitleForCloud(dIt, uid);
          b.set(doc(db, 'items', docId), payload);
        });
        await track(b.commit());
        chunk.forEach(dIt => { delete dIt.dirty; });
      }
      saveLocalItems();
    }
    if (dirtyProf) {
      _lastSavedProfJson = '';
      profCloud(false);
    }
    if (dirtyItems.length || pendingDeletes.length) {
      scheduleColRevBump();
    }
    setSync();
    if (showToast) toast('Отложенные локальные изменения отправлены в облако ✓');
    return true;
  } catch (err) {
    handleCloudError(err, !showToast);
    return false;
  }
}

async function syncItemsFromCloud(effUid, force = false) {
  if (!effUid || !user || user.isLocal) return;
  if (_cloudSyncInFlight) return _cloudSyncInFlight;
  if (!force && (isCloudQuotaBlocked() || window.__FIREBASE_OFFLINE_FALLBACK || !navigator.onLine)) return;
  if (!auth.currentUser && !window.__FIREBASE_OFFLINE_FALLBACK) return;

  _cloudSyncInFlight = (async () => {
    try {
      let ownList = null;
      let loadedFromChunks = false;

      // 1. Быстрая загрузка из компактных чанков (1–2 чтения Firestore на 500+ тайтлов вместо 500 чтений!)
      if (isChunkStorageEnabled() && prof.colStorageV2) {
        const chunkCnt = Math.max(0, Number(prof.colChunkCount || 0));
        if (chunkCnt === 0) {
          ownList = [];
          loadedFromChunks = true;
        } else {
          try {
            const unpacked = await loadCollectionChunksFromCloud(effUid, chunkCnt);
            if (Array.isArray(unpacked)) {
              ownList = deduplicateListByIdAndCleanupCloud(unpacked, false);
              loadedFromChunks = true;
            }
          } catch (chunkErr) {
            const code = String(chunkErr?.code || '').toLowerCase();
            if (code.includes('permission-denied')) _chunkStorageDenied = true;
            else throw chunkErr;
          }
        }
      }

      // 2. Однополевой fallback-запрос (БЕЗ составного индекса kind+userId, подхватывает даже старые записи без kind=="title"!)
      if (!loadedFromChunks) {
        let docsList = [];
        try {
          const snapAll = await track(getDocs(query(collection(db, 'items'), where('userId', '==', effUid))));
          docsList = snapAll.docs;
        } catch (singleErr) {
          const snapFallback = await track(getDocs(query(collection(db, 'items'), where('kind', '==', 'title'), where('userId', '==', effUid))));
          docsList = snapFallback.docs;
        }
        clearCloudErrorState(effUid);

        const pendingDelSet = new Set(getPendingDeletes(effUid));
        ownList = deduplicateListByIdAndCleanupCloud(
          docsList
            .filter(d => {
              if (d.id.startsWith('prof_')) return false;
              const raw = d.data();
              if (!raw || raw.isProfile || raw.isColChunk || raw.kind === 'profile') return false;
              if (!isTitleDoc(raw)) return false;
              const rawId = raw.id;
              if (pendingDelSet.has(d.id) || (rawId != null && pendingDelSet.has(String(rawId)))) return false;
              if (window._recentlyDeletedIds && (window._recentlyDeletedIds.has(d.id) || window._recentlyDeletedIds.has(String(rawId)))) return false;
              return true;
            })
            .map(d => fix({ ...d.data(), _docId: d.id })),
          false
        );
      } else {
        clearCloudErrorState(effUid);
      }

      if (ownList.length > 0) {
        try { localStorage.setItem('cloudHadSynced_' + effUid, '1'); } catch (e) {}
      }

      // Объединяем несинхронизированные локальные правки (dirty: true), чтобы они не потерялись при загрузке с сервера
      const dirtyLocalItems = items.filter(x => x && x.dirty);
      dirtyLocalItems.forEach(dIt => {
        const oIdx = ownList.findIndex(o => String(o.id) === String(dIt.id));
        if (oIdx > -1) {
          if ((dIt.updatedAt || 0) >= (ownList[oIdx].updatedAt || 0)) ownList[oIdx] = dIt;
        } else {
          ownList.push(dIt);
        }
      });

      const prevCount = items.length;
      if (!window._explicitEmptyAllowed && prevCount === 0 && ownList.length === 0) {
        const sb = await idbVault.get(getUidStorageKey('safetyBackup'));
        if (Array.isArray(sb) && sb.length > 0 && items.length === 0) {
          items = deduplicateListByIdAndCleanupCloud(sb.filter(isTitleDoc).map(fix), false);
          loaded = true;
          refresh();
          toast(`Восстановлено из локальной страховочной копии: ${items.length} тайтлов`);
        } else {
          items = [];
          loaded = true;
        }
      } else if (!window._explicitEmptyAllowed && prevCount > 0 && ownList.length === 0) {
        loaded = true;
      } else {
        items = ownList;
        loaded = true;
        saveLocalItems();
      }

      setCloudSyncMeta({
        lastFullSyncAt: Date.now(),
        colRev: Number(prof.colRev || 0),
        colCount: items.length
      }, effUid);

      // Если загрузили старым способом (500 отдельных доков), 1 раз упаковываем в компактные чанки, чтобы все будущие загрузки стоили 1–2 чтения!
      if (!loadedFromChunks && isChunkStorageEnabled() && items.length > 0 && !isCloudWriteBlocked()) {
        saveCollectionChunksToCloud(effUid, items, { silent: true }).catch(() => {});
      } else if (dirtyLocalItems.length || getPendingDeletes(effUid).length) {
        await flushPendingCloudChanges(false);
      }

      if (!profTried) {
        profTried = true;
        setTimeout(() => checkMigrateLocalItemsToCloud(false), 1200);
        setTimeout(() => restoreUncertainMatchesFromStorage(), 800);
      }
      profPaint();
      refresh();
      homeTab();
      setSync();
    } catch (err) {
      // Железобетонная защита: при ошибке квоты или сети НИКОГДА не затираем текущие items (из IDB / памяти)!
      if (items.length === 0) {
        const fallbackLocal = await loadLocalItemsAsync(effUid);
        if (fallbackLocal.length > 0) {
          items = deduplicateListByIdAndCleanupCloud(fallbackLocal, false);
        } else {
          const sb = await idbVault.get(getUidStorageKey('safetyBackup'));
          if (Array.isArray(sb) && sb.length > 0) {
            items = deduplicateListByIdAndCleanupCloud(sb.filter(isTitleDoc).map(fix), false);
          }
        }
      }
      loaded = true;
      handleCloudError(err, false);
      profPaint();
      refresh();
      homeTab();
    } finally {
      _cloudSyncInFlight = null;
    }
  })();

  return _cloudSyncInFlight;
}

window.forceCloudSyncNow = async function forceCloudSyncNow(manual = true) {
  if (!user || user.isLocal) {
    if (manual) toast('Сейчас включён локальный режим без облака.');
    return;
  }
  if (!navigator.onLine || window.__FIREBASE_OFFLINE_FALLBACK) {
    setSync();
    if (manual) toast('Нет подключения к сети — работаем на локальном кэше.', true);
    return;
  }
  if (!auth.currentUser) {
    if (manual) toast('Сессия авторизации ещё инициализируется, подожди пару секунд.', true);
    return;
  }
  // При ручном клике сбрасываем временный кулдаун, чтобы пользователь мог сразу проверить восстановление квоты
  clearCloudErrorState(user.uid);
  try {
    const pSnap = await track(getDoc(doc(db, 'items', 'prof_' + user.uid)));
    if (pSnap.exists()) {
      const pd = pSnap.data();
      const { isProfile, kind: _k, userId: _u, _docId, statsSummary, friends: _fr, ...rest } = pd;
      Object.assign(prof, rest);
      _cloudProfLoaded = true;
      profSaveLocal();
    }
    await flushPendingCloudChanges(false);
    await syncItemsFromCloud(user.uid, true);
    if (manual && !cloudAccessError) toast('Синхронизация с облаком завершена ✓');
  } catch (err) {
    handleCloudError(err, false);
  }
};

async function hydrateLocalSessionView(uObj) {
  if (!uObj || !uObj.uid) return;
  const effUid = uObj.uid;
  user = uObj;
  loadQuotaCooldownForUid(effUid);
  resetProfObjectToDefault();
  try { Object.assign(prof, JSON.parse(localStorage.getItem('prof_' + effUid) || '{}')); } catch (e) {}
  delete prof.friends;

  const idbProf = await idbVault.get('prof_' + effUid);
  if (idbProf && typeof idbProf === 'object') {
    if (!prof.avatar && idbProf.avatar) prof.avatar = idbProf.avatar;
    if (!prof.cover && idbProf.cover) prof.cover = idbProf.cover;
    Object.assign(prof, { ...idbProf, avatar: prof.avatar || idbProf.avatar || '', cover: prof.cover || idbProf.cover || '' });
  }

  const defaultName = uObj.displayName || (uObj.email ? uObj.email.split('@')[0] : 'Моя коллекция');
  $('authScreen').style.display = 'none';
  $('appScreen').style.display = 'block';
  $('hdrAvatar').src = prof.avatar || uObj.photoURL || FALL;
  $('profName').textContent = prof.name || defaultName;
  $('avatar').src = prof.avatar || uObj.photoURL || FALL;

  let cachedLocal = await loadLocalItemsAsync(effUid);
  if (!cachedLocal.length) {
    const sb = await idbVault.get('safetyBackup_' + effUid);
    if (Array.isArray(sb) && sb.length) cachedLocal = sb.filter(isTitleDoc).map(fix);
  }
  items = deduplicateListByIdAndCleanupCloud(cachedLocal, false);
  loaded = true;
  setSync();
  profPaint();
  refresh();
  homeTab();
  if (!cgGrid.children.length) cgLoad(true);
}

async function activateCloudUserSession(uObj) {
  const effUid = uObj?.uid;
  if (!effUid) return;
  if (_activeCloudSessionUid === effUid && unsub) {
    user = uObj;
    setSync();
    return;
  }
  if (unsub) { unsub(); unsub = null; }
  _activeCloudSessionUid = effUid;
  if (typeof resetSessionMemoryState === 'function') resetSessionMemoryState();
  _cloudProfLoaded = false;

  try {
    localStorage.setItem('lastCloudUid', effUid);
    if (uObj.email) localStorage.setItem('lastCloudEmail', uObj.email);
    if (uObj.displayName) localStorage.setItem('lastCloudName', uObj.displayName);
  } catch (e) {}
  profTried = false;

  await hydrateLocalSessionView(uObj);
  loadRuCacheFromCloud(effUid);

  if (window.__FIREBASE_OFFLINE_FALLBACK || !navigator.onLine) {
    setSync();
    return;
  }

  // Слушаем ТОЛЬКО 1 документ профиля (вместо чтения всей коллекции из тысяч документов при каждом F5!)
  let initialProfileHandled = false;
  unsub = onSnapshot(doc(db, 'items', 'prof_' + effUid),
    async pSnap => {
      if (!isCloudQuotaBlocked()) clearCloudErrorState(effUid);
      const localAvatarBackup = prof.avatar || '';
      const localCoverBackup = prof.cover || '';
      const localCoverColBackup = prof.coverColor || 0;
      const localSyncMeta = getCloudSyncMeta(effUid);
      let remoteColRev = 0;
      let remoteColCount = null;

      if (pSnap.exists()) {
        const pd = pSnap.data();
        const { isProfile, kind: _k, userId: _u, _docId, statsSummary, friends: _fr, ...rest } = pd;
        Object.assign(prof, rest);
        if (pd.schemaMigratedV4) {
          try { localStorage.setItem('schemaMigratedV4_' + effUid, '1'); } catch (e) {}
          setCloudSyncMeta({ schemaMigratedV4: true }, effUid);
        }
        remoteColRev = Number(pd.colRev || 0);
        remoteColCount = (pd.colCount != null) ? Number(pd.colCount) : null;

        let restoredVisuals = false;
        if (!prof.avatar && localAvatarBackup) { prof.avatar = localAvatarBackup; restoredVisuals = true; }
        if (!prof.cover && localCoverBackup) { prof.cover = localCoverBackup; restoredVisuals = true; }
        if (!prof.cover && !prof.coverColor && localCoverColBackup) { prof.coverColor = localCoverColBackup; restoredVisuals = true; }
        _cloudProfLoaded = true;
        const safeProfSnapshot = stripUndefinedDeep({ ...prof, kind: 'profile', isProfile: true, userId: effUid });
        delete safeProfSnapshot.email; delete safeProfSnapshot.ownerEmail; delete safeProfSnapshot.statsSummary; delete safeProfSnapshot.friends;
        _lastSavedProfJson = JSON.stringify({ ...safeProfSnapshot, lastVisit: 0, colRev: 0, colCount: 0 });
        profSaveLocal();
        if (restoredVisuals && !isCloudWriteBlocked()) profCloud();
        profPaint();
      } else {
        _cloudProfLoaded = true;
        if (!isCloudWriteBlocked()) profCloud();
      }

      const lastFullSyncAt = Number(localSyncMeta.lastFullSyncAt || 0);
      const localRev = Number(localSyncMeta.colRev || 0);
      const remoteWriter = pSnap.exists() ? String(pSnap.data()?.colChunkWriter || '') : '';
      const hasPendingWrites = Boolean(pSnap.metadata && pSnap.metadata.hasPendingWrites);
      const shouldPull = typeof KirokuEngine !== 'undefined'
        ? KirokuEngine.shouldPullCollectionFromCloud({
            hasPendingWrites,
            remoteWriter,
            sessionWriter: SESSION_WRITER_ID,
            remoteColRev,
            localRev,
            itemsCount: items.length,
            remoteColCount,
            lastFullSyncAt,
            initialProfileHandled,
            reconcileMs: 7 * 24 * 3600 * 1000
          })
        : (!initialProfileHandled && (items.length === 0 || (remoteColRev && remoteColRev > localRev)));

      if (shouldPull) {
        initialProfileHandled = true;
        await syncItemsFromCloud(effUid, false);
      } else {
        initialProfileHandled = true;
        if (!profTried) {
          profTried = true;
          setTimeout(() => checkMigrateLocalItemsToCloud(false), 1200);
          setTimeout(() => restoreUncertainMatchesFromStorage(), 800);
        }
        await flushPendingCloudChanges(false);
        refresh();
        homeTab();
      }

      // При использовании чанков миграция схемы не нужна и не тратит квоту чтений
      if (!prof.colStorageV2) {
        const migratedLocal = localStorage.getItem('schemaMigratedV4_' + effUid) === '1';
        if (!migratedLocal && !prof.schemaMigratedV4 && !isCloudQuotaBlocked()) {
          const allItemsClean = items.length > 0 && items.every(x => x.kind === 'title' && String(x._docId || '').startsWith(effUid + '_'));
          if (allItemsClean) {
            try { localStorage.setItem('schemaMigratedV4_' + effUid, '1'); } catch (e) {}
            prof.schemaMigratedV4 = true;
            setCloudSyncMeta({ schemaMigratedV4: true }, effUid);
            setDoc(doc(db, 'items', 'prof_' + effUid), { kind: 'profile', isProfile: true, userId: effUid, schemaMigratedV4: true }, { merge: true }).catch(() => {});
          }
        }
      }
    },
    async err => {
      // Никогда не затираем локальную коллекцию из IDB пустым sync-ответом из localStorage!
      if (items.length === 0) {
        const fallbackLocal = await loadLocalItemsAsync(effUid);
        if (fallbackLocal.length > 0) {
          items = deduplicateListByIdAndCleanupCloud(fallbackLocal, false);
        } else {
          const sb = await idbVault.get(getUidStorageKey('safetyBackup'));
          if (Array.isArray(sb) && sb.length > 0) {
            items = deduplicateListByIdAndCleanupCloud(sb.filter(isTitleDoc).map(fix), false);
          }
        }
      }
      loaded = true;
      handleCloudError(err, false);
      profPaint();
      refresh();
      homeTab();
    });
}

// ---------- ОБРАБОТЧИКИ АВТОРИЗАЦИИ ----------
$('localModeBtn').onclick = () => startLocalMode('Включён локальный режим');

// getRedirectResult вызывается внутри window.startApp() после загрузки всех скриптов

$('loginBtn').onclick = async () => {
  try { localStorage.removeItem('useLocalMode'); } catch (e) {}
  if (location.protocol === 'file:') {
    return toast('На file:// вход через Google блокируется браузером. Используй вход по Почте и Паролю или открой сайт по HTTPS.', true);
  }
  const freshProvider = new GoogleAuthProvider();
  freshProvider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, freshProvider);
  } catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) {
      return signInWithRedirect(auth, freshProvider);
    }
    if (e.code === 'auth/unauthorized-domain') {
      return startLocalMode('Домен не добавлен в список разрешённых в Firebase Console (' + location.hostname + '). Включён локальный режим.');
    }
    if (!['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(e.code)) {
      toast('Ошибка входа Google: ' + e.message, true);
    }
  }
};

async function handleEmailPasswordAuth(isRegister) {
  const email = ($('emailAuthInput')?.value || '').trim();
  const pass = ($('passAuthInput')?.value || '').trim();
  if (!email || !email.includes('@')) return toast('Введи корректный адрес электронной почты', true);
  if (!pass || pass.length < 6) return toast('Пароль должен содержать минимум 6 символов', true);
  try { localStorage.removeItem('useLocalMode'); } catch (e) {}
  try {
    if (isRegister) {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      if (cred.user && !cred.user.emailVerified) {
        await sendEmailVerification(cred.user).catch(() => {});
        toast('Аккаунт создан! На почту ' + email + ' отправлено письмо для подтверждения адреса.');
      } else {
        toast('Аккаунт успешно создан! Добро пожаловать.');
      }
    } else {
      const cred = await signInWithEmailAndPassword(auth, email, pass);
      if (cred.user && !cred.user.emailVerified) {
        toast('Вход выполнен. Почта ещё не подтверждена.', false, {
          label: 'Отправить письмо',
          fn: () => sendEmailVerification(cred.user).then(() => toast('Письмо для подтверждения отправлено на ' + email)).catch(err => toast('Ошибка: ' + err.message, true))
        });
      } else {
        toast('Вход выполнен!');
      }
    }
  } catch (e) {
    const code = e.code || '';
    if (code === 'auth/email-already-in-use') toast('Эта почта уже зарегистрирована! Если ты раньше входил через Google, войди через Google и привяжи пароль в «Настройках профиля», либо нажми «Забыли пароль? Сбросить на почту».', true);
    else if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') toast('Неверная почта или пароль. Если ты раньше входил через Google с этой почтой — войди через Google и задай пароль в «Настройках профиля» (или нажми «Забыли пароль?»).', true);
    else if (code === 'auth/weak-password') toast('Слишком простой пароль — укажи минимум 6 символов.', true);
    else toast('Ошибка авторизации: ' + e.message, true);
  }
}

$('emailLoginBtn').onclick = () => handleEmailPasswordAuth(false);
$('emailRegBtn').onclick = () => handleEmailPasswordAuth(true);
$('passAuthInput').onkeydown = e => { if (e.key === 'Enter') handleEmailPasswordAuth(false); };

$('emailResetBtn').onclick = async () => {
  const email = ($('emailAuthInput')?.value || '').trim();
  if (!email || !email.includes('@')) return toast('Сначала введи свою почту в поле Email выше.', true);
  try {
    await sendPasswordResetEmail(auth, email);
    toast('Письмо для сброса пароля отправлено на ' + email);
  } catch (e) {
    toast('Не удалось отправить письмо сброса: ' + e.message, true);
  }
};

function resetSessionMemoryState() {
  window._explicitEmptyAllowed = false;
  window._migrationRetriedOnEmpty = false;
  _cloudSyncInFlight = null;
  _lastSavedProfJson = '';
  _quotaToastShown = false;
  _cloudBannerDismissedKey = '';
  clearTimeout(_colRevBumpTimer);
  if (typeof uncertainMatchesQueue !== 'undefined') uncertainMatchesQueue.length = 0;
  if (typeof selSet !== 'undefined') selSet.clear();
  if (typeof reviewSelSet !== 'undefined') reviewSelSet.clear();
  if ($('reviewItemsBox')) { $('reviewItemsBox').replaceChildren(); $('reviewItemsBox').style.display = 'none'; }
}

$('logoutBtn').onclick = async () => {
  try {
    localStorage.removeItem('useLocalMode');
    localStorage.removeItem('lastCloudUid');
    localStorage.removeItem('lastCloudEmail');
    localStorage.removeItem('lastCloudName');
  } catch (e) {}
  if (unsub) { unsub(); unsub = null; }
  _activeCloudSessionUid = '';
  clearCloudErrorState();
  resetSessionMemoryState();
  resetProfObjectToDefault();
  user = null; items = []; loaded = false;
  renderCloudStatusBanner();
  try { await signOut(auth); } catch (e) {}
  $('appScreen').style.display = 'none'; $('authScreen').style.display = 'flex';
};

let _appStarted = false;
window.startApp = function startApp() {
  if (_appStarted) return;
  _appStarted = true;

  // Мгновенно показываем интерфейс из локального IndexedDB/localStorage БЕЗ дублирующего запуска запросов в Firestore
  if (localStorage.getItem('useLocalMode') === '1') {
    document.body.classList.remove('auth-checking');
    startLocalMode();
  } else {
    const cachedUid = localStorage.getItem('lastCloudUid');
    if (cachedUid && !user) {
      document.body.classList.remove('auth-checking');
      hydrateLocalSessionView({
        uid: cachedUid,
        email: localStorage.getItem('lastCloudEmail') || '',
        displayName: localStorage.getItem('lastCloudName') || 'Моя коллекция',
        photoURL: ''
      });
    }
  }

  getRedirectResult(auth).catch(e => {
    if (e && e.code === 'auth/unauthorized-domain') {
      startLocalMode('Домен ' + location.hostname + ' не добавлен в Firebase Authorized Domains. Включён локальный режим.');
    } else if (e && !['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(e.code)) {
      toast('Ошибка входа Google: ' + (e.message || e.code), true);
    }
  });

  onAuthStateChanged(auth, u => {
    document.body.classList.remove('auth-checking');
    if (u) {
      try { localStorage.removeItem('useLocalMode'); } catch (e) {}
      return activateCloudUserSession(u);
    }
    if (localStorage.getItem('useLocalMode') === '1') return startLocalMode();
    try { localStorage.removeItem('lastCloudUid'); } catch (e) {}
    if (unsub) { unsub(); unsub = null; }
    _activeCloudSessionUid = '';
    resetSessionMemoryState();
    items = []; loaded = false;
    $('appScreen').style.display = 'none'; $('authScreen').style.display = 'flex';
  });
};

// ---------- Отрисовка и утилиты ----------
const names = i => [i.title, i.titleEn, i.titleOrig, i.alt, i.author, i.studio, i.source, i.year, (i.tags || []).join(' ')].join(' ').toLowerCase();
const xmatch = i => xf.k === 'source' ? i.source === xf.v : (i[xf.k] || '').split(',').some(x => x.trim().toLowerCase() === xf.v.toLowerCase());
let lastId = 0;
const newId = () => { const n = Date.now() * 1000 + Math.floor(Math.random() * 1000); return lastId = n > lastId ? n : lastId + 1; };
const KINO = ['Фильм', 'Сериал', 'Мультфильм'];
const sameCat = (a, b) => {
  if (!a || !b) return false;
  if (a === b) return true;
  if ((a === 'Мультфильм' || b === 'Мультфильм') && KINO.includes(a) && KINO.includes(b)) return true;
  return false;
};

// Нормализация названия для точного поиска дубликатов: ё->е, удаление кавычек/скобок/знаков препинания
function normTitleStr(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\(\[](?:(?:мини-)?сериал|тв-?1|tv-?1|1\s*сезон|season\s*1|тв|tv|\d{4})[\)\]]/gi, ' ')
    .replace(/[«»"'„“”‘’`´:;.,!?~—–\-_/\\|()[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Извлечение маркера сезона / части / ТВ / Фильма / OVA, чтобы НЕ склеивать разные сезоны и фильмы одной франшизы при импорте из Anixart
function extractSeasonPartMarker(s) {
  const raw = String(s || '').toLowerCase().replace(/ё/g, 'е');
  let season = '', part = '', fmt = '';
  const mS = raw.match(/(?:сезон|season|s|тв|tv)\s*[-:]?\s*(\d{1,2})\b/) || raw.match(/\b(\d{1,2})\s*(?:сезон|season|nd\s+season|rd\s+season|th\s+season)\b/);
  if (mS && Number(mS[1]) > 1) season = 's' + Number(mS[1]);
  const mP = raw.match(/(?:часть|part|cour)\s*[-:]?\s*(\d{1,2})\b/) || raw.match(/\b(\d{1,2})\s*(?:часть|part)\b/);
  if (mP && Number(mP[1]) > 1) part = 'p' + Number(mP[1]);
  const mFmt = raw.match(/\b(фильм|movie|ova|ona|спешл|special)(?:\s*(\d{1,2}))?\b/);
  if (mFmt) fmt = mFmt[1].replace('movie', 'фильм').replace('special', 'спешл') + (mFmt[2] || '');
  const mTrail = raw.match(/(?:\s|:)(ii|iii|iv|v|2|3|4|5)\s*$/i);
  const romanMap = { ii: '2', iii: '3', iv: '4', v: '5' };
  const trail = mTrail ? (romanMap[mTrail[1].toLowerCase()] || mTrail[1]) : '';
  return [season || (trail ? 's' + trail : ''), part, fmt].filter(Boolean).join('_');
}

const splitAltNames = altStr => String(altStr || '').split(/[,;/|]+/).map(s => s.trim()).filter(Boolean);

// Кэширование нормализованных названий и маркеров в WeakMap для исключения повторных вызовов normTitleStr
const _itemNormMetaCache = new WeakMap();
function getCachedItemNormMeta(o) {
  if (!o || typeof o !== 'object') return { primary: [], all: [], marker: '' };
  const sig = `${o.title || ''}\x00${o.titleEn || o.en || ''}\x00${o.romaji || ''}\x00${o.titleOrig || o.orig || ''}\x00${o.alt || ''}`;
  let cached = _itemNormMetaCache.get(o);
  if (cached && cached.sig === sig) return cached;

  const rawPrimary = [o.title, o.titleEn || o.en, o.romaji, o.titleOrig || o.orig].filter(Boolean);
  const altParts = splitAltNames(o.alt);
  const rawAll = [...rawPrimary, ...altParts].filter(Boolean);
  let marker = '';
  for (const t of rawAll) {
    const m = extractSeasonPartMarker(t);
    if (m) { marker = m; break; }
  }
  const qualifyingAlts = altParts.filter(altName => {
    const n = normTitleStr(altName);
    return n && n.length >= 4 && extractSeasonPartMarker(altName) === marker;
  });
  const primary = [...new Set([...rawPrimary, ...qualifyingAlts].map(normTitleStr).filter(x => x && x.length >= 2))];
  const all = [...new Set(rawAll.map(normTitleStr).filter(x => x && x.length >= 2))];
  cached = { sig, primary, all, marker };
  _itemNormMetaCache.set(o, cached);
  return cached;
}

const getItemMarkers = o => getCachedItemNormMeta(o).marker;
const nset = o => getCachedItemNormMeta(o).all;

// Единая функция поиска повторов для ВСЕХ мест
const same = (a, b) => {
  if (!a || !b) return false;
  if (a.tmdb && b.tmdb && String(a.tmdb) === String(b.tmdb)) return true;
  if (a.imdbId && b.imdbId && String(a.imdbId) === String(b.imdbId)) return true;
  if (!sameCat(a.category, b.category)) return false;
  if (Number(a.aniId) > 0 && Number(b.aniId) > 0 && Number(a.aniId) === Number(b.aniId)) return true;
  if (Number(a.mal) > 0 && Number(b.mal) > 0 && Number(a.mal) === Number(b.mal)) return true;
  if (Number(a.shikiId) > 0 && Number(b.shikiId) > 0 && Number(a.shikiId) === Number(b.shikiId)) return true;
  if (a.mdId && b.mdId && String(a.mdId) === String(b.mdId)) return true;

  if (Number(a.aniId) > 0 && Number(b.aniId) > 0 && Number(a.aniId) !== Number(b.aniId)) return false;
  if (Number(a.mal) > 0 && Number(b.mal) > 0 && Number(a.mal) !== Number(b.mal)) return false;
  if (Number(a.shikiId) > 0 && Number(b.shikiId) > 0 && Number(a.shikiId) !== Number(b.shikiId)) return false;
  if (a.mdId && b.mdId && String(a.mdId) !== String(b.mdId)) return false;
  if (a.tmdb && b.tmdb && String(a.tmdb) !== String(b.tmdb)) return false;
  if (a.imdbId && b.imdbId && String(a.imdbId) !== String(b.imdbId)) return false;

  const metaA = getCachedItemNormMeta(a);
  const metaB = getCachedItemNormMeta(b);
  if (!metaA.primary.length || !metaB.primary.length) return false;
  if (!metaA.primary.some(n => metaB.primary.includes(n))) return false;

  const fa = String(a.format || '').toUpperCase();
  const fb = String(b.format || '').toUpperCase();
  const isSeriesFmt = f => f === 'TV' || f === 'TV_SHORT' || f === 'ONA';
  if ((fa === 'MOVIE' && isSeriesFmt(fb)) || (fb === 'MOVIE' && isSeriesFmt(fa))) return false;

  if (metaA.marker !== metaB.marker) return false;

  const ya = parseInt(a.year) || 0, yb = parseInt(b.year) || 0;
  const maxYearDiff = (a.category === 'Манга' || a.category === 'Ранобэ') ? 2 : 1;
  if (ya && yb && Math.abs(ya - yb) > maxYearDiff) return false;

  return true;
};

function createFastDuplicateIndex(pool = []) {
  const byTmdb = new Map(), byImdb = new Map(), byAni = new Map(), byMal = new Map(), byShiki = new Map(), byMd = new Map(), byTitle = new Map();
  const add = it => {
    if (!it) return;
    if (it.tmdb) byTmdb.set(String(it.tmdb), it);
    if (it.imdbId) byImdb.set(String(it.imdbId), it);
    if (Number(it.aniId) > 0) byAni.set(Number(it.aniId), it);
    if (Number(it.mal) > 0) byMal.set(Number(it.mal), it);
    if (Number(it.shikiId) > 0) byShiki.set(Number(it.shikiId), it);
    if (it.mdId) byMd.set(String(it.mdId), it);
    for (const nt of getCachedItemNormMeta(it).primary) {
      let arr = byTitle.get(nt);
      if (!arr) { arr = []; byTitle.set(nt, arr); }
      arr.push(it);
    }
  };
  pool.forEach(add);
  return {
    add,
    find(cand) {
      if (!cand) return null;
      if (cand.tmdb && byTmdb.has(String(cand.tmdb))) return byTmdb.get(String(cand.tmdb));
      if (cand.imdbId && byImdb.has(String(cand.imdbId))) return byImdb.get(String(cand.imdbId));
      if (Number(cand.aniId) > 0 && byAni.has(Number(cand.aniId))) {
        const h = byAni.get(Number(cand.aniId));
        if (sameCat(h.category, cand.category)) return h;
      }
      if (Number(cand.mal) > 0 && byMal.has(Number(cand.mal))) {
        const h = byMal.get(Number(cand.mal));
        if (sameCat(h.category, cand.category)) return h;
      }
      if (Number(cand.shikiId) > 0 && byShiki.has(Number(cand.shikiId))) {
        const h = byShiki.get(Number(cand.shikiId));
        if (sameCat(h.category, cand.category)) return h;
      }
      if (cand.mdId && byMd.has(String(cand.mdId))) {
        const h = byMd.get(String(cand.mdId));
        if (sameCat(h.category, cand.category)) return h;
      }
      const checked = new Set();
      for (const nt of getCachedItemNormMeta(cand).primary) {
        const bucket = byTitle.get(nt);
        if (!bucket) continue;
        for (const ex of bucket) {
          if (ex === cand || checked.has(ex)) continue;
          checked.add(ex);
          if (same(ex, cand)) return ex;
        }
      }
      return null;
    }
  };
}

const findDuplicateMatch = (candidate, pool = items, prebuiltIndex = null) => {
  if (!candidate) return null;
  if (prebuiltIndex) return prebuiltIndex.find(candidate);
  return (pool || []).find(existing => {
    if (!existing || existing === candidate) return false;
    if (existing.id && candidate.id && existing.id === candidate.id && pool === items) return false;
    return same(existing, candidate);
  }) || null;
};

function isAdultItem(it) {
  if (it.isAdult) return true;
  return (it.tags || []).some(t => /хентай|hentai|18\+|эротик/i.test(t));
}

function getVisibleItems() {
  return items;
}

let activeToastTimer = 0;
function toast(msg, bad, act) {
  const box = $('toasts'); if (!box) return;
  clearTimeout(activeToastTimer); box.replaceChildren();
  const t = el('div', 'toast' + ((bad ?? /не удалось|ошибк|обязательно|должен|нужен|неверн/i.test(msg)) ? ' bad' : ''), msg);
  if (act) { const b = el('button', null, act.label); b.onclick = () => { clearTimeout(activeToastTimer); act.fn(); t.remove(); }; t.append(b); }
  box.append(t); activeToastTimer = setTimeout(() => t.remove(), act ? 8000 : 2800);
}

function catCounts() {
  const vis = getVisibleItems();
  document.querySelectorAll('#catFilters .fb').forEach(b => {
    if (!b.dataset.l) b.dataset.l = b.textContent;
    const cName = b.dataset.c;
    const n = cName === 'Всё' ? vis.filter(i => !i.archived).length : cName === 'Кино и сериалы' ? vis.filter(i => !i.archived && KINO.includes(i.category)).length : vis.filter(i => !i.archived && i.category === cName).length;
    b.textContent = b.dataset.l + (n ? ` (${n})` : '');
  });
  const activeColBtn = document.querySelector(`#catFilters .fb[data-c="${cat}"]`);
  if ($('colCatDropdownBtn')) {
    const baseLbl = activeColBtn?.dataset.l || (cat === 'Всё' ? 'Все типы' : cat === 'Кино и сериалы' ? 'Фильмы и сериалы' : cat);
    $('colCatDropdownBtn').textContent = `Категория: ${baseLbl} ▾`;
  }
}

function refreshTags() {
  const sel = $('tagFilter'), old = sel.value, map = new Map();
  getVisibleItems().forEach(i => (i.tags || []).forEach(t => { if (!map.has(t.toLowerCase())) map.set(t.toLowerCase(), t); }));
  sel.replaceChildren(new Option('Жанры: Все', 'Все'));
  [...map].sort((a, b) => a[1].localeCompare(b[1], 'ru')).forEach(([k, v]) => sel.add(new Option(v, k)));
  sel.value = map.has(old) ? old : 'Все';
}

function refreshLists() {
  const sel = $('listFilter'); if (!sel) return; const old = sel.value, map = new Map();
  (prof.customLists || []).forEach(t => { if (t && !map.has(t.toLowerCase())) map.set(t.toLowerCase(), t); });
  getVisibleItems().forEach(i => (i.lists || []).forEach(t => { if (t && !map.has(t.toLowerCase())) map.set(t.toLowerCase(), t); }));
  sel.replaceChildren(new Option('📁 Все подборки', 'Все'));
  [...map].sort((a, b) => a[1].localeCompare(b[1], 'ru')).forEach(([k, v]) => sel.add(new Option('📁 ' + v, k)));
  sel.value = map.has(old) ? old : 'Все'; sel.style.display = '';
  const canManage = sel.value !== 'Все';
  if ($('manageListBtn')) $('manageListBtn').style.display = canManage ? '' : 'none';
  if ($('deleteListBtn')) $('deleteListBtn').style.display = canManage ? '' : 'none';
  if (typeof renderMyListsFolderBlock === 'function') renderMyListsFolderBlock();
}

let animeSubKind = 'Все', videoSubKind = 'Все';

function getAnimeSubKind(item) {
  if (item.format === 'MOVIE') return 'Фильм';
  if (item.format && item.format !== 'MOVIE') return 'Сериал';
  return (num(item.eps) === 1 && num(item.dur) >= 50) ? 'Фильм' : 'Сериал';
}

function syncHybridStatusTabsUI() {
  const vis = getVisibleItems().filter(i => !i.archived);
  const curSt = $('statusFilter').value;
  const reviewCount = items.filter(i => !i.archived && i.needsReview).length;

  const revBtn = $('reviewTabBtn');
  if (revBtn) {
    revBtn.style.display = reviewCount > 0 ? '' : 'none';
    revBtn.textContent = `📥 Разобрать (${reviewCount})`;
  }

  const counts = {
    'Все': vis.length,
    'Смотрю/Читаю': vis.filter(i => i.status === 'Смотрю/Читаю' || i.status === 'Пересматриваю').length,
    'В планах': vis.filter(i => i.status === 'В планах').length,
    'Просмотрено/Прочитано': vis.filter(i => i.status === 'Просмотрено/Прочитано').length,
    'Отложено': vis.filter(i => i.status === 'Отложено').length,
    'Брошено': vis.filter(i => i.status === 'Брошено').length,
    'Любимое': vis.filter(i => i.fav).length
  };
  const labels = {
    'Все': 'Все',
    'Смотрю/Читаю': getStatusLabelForCategory('Смотрю/Читаю', cat),
    'В планах': 'В планах',
    'Просмотрено/Прочитано': getStatusLabelForCategory('Просмотрено/Прочитано', cat),
    'Отложено': 'Отложено',
    'Брошено': 'Брошено',
    'Любимое': 'Любимое'
  };
  const specialOpen = $('reviewItemsBox')?.style.display !== 'none';
  document.querySelectorAll('#hybStatusTabs .hyb-st-tab').forEach(btn => {
    const st = btn.dataset.st;
    if (st === '__review__') return;
    btn.textContent = `${labels[st] || st} (${counts[st] || 0})`;
    btn.classList.toggle('on', curSt === st && !specialOpen);
  });
  if ($('archiveToggleBtn')) {
    $('archiveToggleBtn').classList.toggle('on', curSt === 'Архив' && !specialOpen);
  }
  document.querySelectorAll('#hybListCardsRow .hyb-lcard').forEach(card => {
    card.classList.toggle('active', card.dataset.st === curSt && !specialOpen);
  });
}

// Ленивая пагинация для мгновенной работы при 1000+ тайтлах (Часть 4 п.5)
const RENDER_PAGE_SIZE = 60;
let currentRenderLimit = RENDER_PAGE_SIZE;

function createCollectionCardNode(i) {
  const stLabel = getStatusLabelForCategory(i.status, i.category);
  const card = el('div', 'card'), pc = el('div', 'pc'), img = el('img'), stEl = el('div', 'status', stLabel);
  card.dataset.id = String(i.id);
  card._item = i;
  stEl.dataset.s = i.status;
  img.loading = 'lazy';
  applyPosterImg(img, i.poster, i);
  const ov = el('div', 'ov'); ov.append(el('p', null, i.description || 'Описание отсутствует.'));
  pc.append(img, ov, stEl);
  const rightBadges = el('div', 'pc-badges-right');
  if (i.ongoing) rightBadges.append(el('div', 'ong', 'ОНГОИНГ'));
  if (i.fav) { const hb = el('div', 'fav-heart-badge', '❤'); hb.title = 'В любимом'; rightBadges.append(hb); }
  if (i.pin) { const pb = el('div', 'pin-badge', '📌'); pb.title = 'Закреплено'; rightBadges.append(pb); }
  if (rightBadges.children.length) pc.append(rightBadges);
  if (i.rating) pc.append(el('div', 'mine', '★ ' + i.rating));

  const info = el('div', 'ci'), row = el('div', 'cm');
  const fmtStr = (typeof FORMAT_RU !== 'undefined' && FORMAT_RU[i.format]) ? FORMAT_RU[i.format] : catLabel(i);
  const epsStr = i.eps ? (i.eps + (i.category === 'Манга' || i.category === 'Ранобэ' ? ' гл.' : ' эп.')) : '';
  const scoreVal = i.rating ? `★ ${i.rating}` : (i.extRating ? `★ ${i.extRating}` : '');
  row.append(
    el('span', null, [i.year, fmtStr, epsStr].filter(Boolean).join(' • ')),
    el('span', 'star', scoreVal)
  );
  const descSnip = el('div', 'list-desc-snip', i.description || 'Описание отсутствует.');
  const bd = el('div', 'bd2'), st2 = el('div', 'status', stLabel); st2.dataset.s = i.status; bd.append(st2);
  if (i.fav) bd.append(el('span', 'chip', '❤ Любимое'));
  if (num(i.rewatchCount) > 0) bd.append(el('span', 'chip', `🔁 ×${i.rewatchCount}`));
  if (i.importSource) bd.append(el('span', 'imp-badge', `Импорт: ${i.importSource}`));
  if (i.needsReview) bd.append(el('span', 'review-badge', '📥 На разбор'));
  if (i.ongoing) bd.append(el('div', 'ong', 'ОНГОИНГ'));

  // Кнопка «⋮» для быстрой смены статуса в компактном списке на телефоне и ПК
  const dotsBtn = el('button', 'card-dots-btn', '⋮');
  dotsBtn.type = 'button';
  dotsBtn.title = 'Сменить статус или добавить в Любимое';
  dotsBtn.onclick = e => {
    e.stopPropagation();
    openQuickAddStatusMenu(dotsBtn, card._item || i, null);
  };

  const addedStr = formatAddedDateRu(i);
  const metaTagsLine = [(i.tags || []).slice(0, 3).join(', '), addedStr ? 'Добавлено: ' + addedStr : ''].filter(Boolean).join(' · ');
  info.append(Object.assign(el('h3', 'title', i.title), {title: i.title}), row, descSnip, el('div', 'tg', metaTagsLine), bd);
  card.append(pc, info, dotsBtn);
  card.tabIndex = 0;
  card.onclick = () => {
    if ($('qaFloatMenu')?.classList.contains('open')) { closeQuickAddStatusMenu(); return; }
    openDetail((card._item || i).id);
  };
  card.onkeydown = e => { if (e.key === 'Enter') openDetail((card._item || i).id); };
  return card;
}

// Точечное обновление существующей карточки в DOM без пересоздания узла и картинки (устраняет «дрожание» сетки)
function patchCollectionCardNode(card, i) {
  if (!card || !i) return;
  card._item = i;
  const stLabel = getStatusLabelForCategory(i.status, i.category);
  const pc = card.querySelector('.pc');
  if (pc) {
    const img = pc.querySelector('img');
    const nextPoster = i.poster || '';
    if (img && img.dataset.rawPoster !== nextPoster) {
      applyPosterImg(img, i.poster, i);
    }
    const ovP = pc.querySelector('.ov p');
    if (ovP) ovP.textContent = i.description || 'Описание отсутствует.';
    const stEl = pc.querySelector(':scope > .status');
    if (stEl) {
      stEl.textContent = stLabel;
      stEl.dataset.s = i.status;
    }
    let rightBadges = pc.querySelector('.pc-badges-right');
    if (i.ongoing || i.fav || i.pin) {
      if (!rightBadges) {
        rightBadges = el('div', 'pc-badges-right');
        pc.append(rightBadges);
      }
      rightBadges.replaceChildren();
      if (i.ongoing) rightBadges.append(el('div', 'ong', 'ОНГОИНГ'));
      if (i.fav) { const hb = el('div', 'fav-heart-badge', '❤'); hb.title = 'В любимом'; rightBadges.append(hb); }
      if (i.pin) { const pb = el('div', 'pin-badge', '📌'); pb.title = 'Закреплено'; rightBadges.append(pb); }
    } else if (rightBadges) {
      rightBadges.remove();
    }
    let mineEl = pc.querySelector('.mine');
    if (i.rating) {
      if (!mineEl) { mineEl = el('div', 'mine'); pc.append(mineEl); }
      mineEl.textContent = '★ ' + i.rating;
    } else if (mineEl) {
      mineEl.remove();
    }
  }
  const titleEl = card.querySelector('.title');
  if (titleEl) { titleEl.textContent = i.title; titleEl.title = i.title; }
  const cm = card.querySelector('.cm');
  if (cm) {
    const fmtStr = (typeof FORMAT_RU !== 'undefined' && FORMAT_RU[i.format]) ? FORMAT_RU[i.format] : catLabel(i);
    const epsStr = i.eps ? (i.eps + (i.category === 'Манга' || i.category === 'Ранобэ' ? ' гл.' : ' эп.')) : '';
    const scoreVal = i.rating ? `★ ${i.rating}` : (i.extRating ? `★ ${i.extRating}` : '');
    if (cm.children[0]) cm.children[0].textContent = [i.year, fmtStr, epsStr].filter(Boolean).join(' • ');
    if (cm.children[1]) cm.children[1].textContent = scoreVal;
  }
  const descSnip = card.querySelector('.list-desc-snip');
  if (descSnip) descSnip.textContent = i.description || 'Описание отсутствует.';
  const tgEl = card.querySelector('.tg');
  if (tgEl) {
    const addedStr = formatAddedDateRu(i);
    tgEl.textContent = [(i.tags || []).slice(0, 3).join(', '), addedStr ? 'Добавлено: ' + addedStr : ''].filter(Boolean).join(' · ');
  }
  const bd = card.querySelector('.bd2');
  if (bd) {
    bd.replaceChildren();
    const st2 = el('div', 'status', stLabel); st2.dataset.s = i.status; bd.append(st2);
    if (i.fav) bd.append(el('span', 'chip', '❤ Любимое'));
    if (num(i.rewatchCount) > 0) bd.append(el('span', 'chip', `🔁 ×${i.rewatchCount}`));
    if (i.importSource) bd.append(el('span', 'imp-badge', `Импорт: ${i.importSource}`));
    if (i.needsReview) bd.append(el('span', 'review-badge', '📥 На разбор'));
    if (i.ongoing) bd.append(el('div', 'ong', 'ОНГОИНГ'));
  }
  card.classList.toggle('sel', Boolean(selMode && selSet.has(i.id)));
}

function itemMatchesCurrentCollectionFilter(i) {
  if (!i) return false;
  const q = $('searchInput').value.toLowerCase().trim(), st = $('statusFilter').value, tg = $('tagFilter').value, lf = $('listFilter').value;
  const catMatch = cat === 'Всё' ? true : cat === 'Кино и сериалы' ? (KINO.includes(i.category) && (videoSubKind === 'Все' || i.category === videoSubKind)) : i.category === cat;
  const kindMatch = (cat !== 'Манга' || kind === 'Все' || getMangaSubKind(i) === kind) && (cat !== 'Аниме' || animeSubKind === 'Все' || getAnimeSubKind(i) === animeSubKind);
  const stMatch = st === 'Архив' ? !!i.archived
    : !i.archived && (
      st === 'Все' ? true
      : st === 'Любимое' ? !!i.fav
      : st === 'Смотрю/Читаю' ? (i.status === 'Смотрю/Читаю' || i.status === 'Пересматриваю')
      : i.status === st
    );
  return (!q || names(i).includes(q)) && catMatch && kindMatch && (!ongOnly || i.ongoing) && (!xf || xmatch(i)) &&
    stMatch &&
    (tg === 'Все' || (i.tags || []).some(t => t.toLowerCase() === tg)) &&
    (lf === 'Все' || (i.lists || []).some(t => t.toLowerCase() === lf));
}

function updateSingleItemCardInDOM(itemId) {
  const it = getVisibleItems().find(x => String(x.id) === String(itemId));
  const existingNode = grid.querySelector(`.card[data-id="${CSS.escape(String(itemId))}"]`);
  const matches = it ? itemMatchesCurrentCollectionFilter(it) : false;
  if (existingNode && matches) {
    patchCollectionCardNode(existingNode, it);
    const lIdx = lastList.findIndex(x => String(x.id) === String(itemId));
    if (lIdx > -1) lastList[lIdx] = it;
    return true;
  }
  if (existingNode && !matches) {
    existingNode.remove();
    lastList = lastList.filter(x => String(x.id) !== String(itemId));
    const visLen = getVisibleItems().length;
    $('countInfo').textContent = `Показано: ${Math.min(currentRenderLimit, lastList.length)} из ${lastList.length} (всего: ${visLen})`;
    if (!lastList.length) render(false);
    return true;
  }
  if (!existingNode && matches) {
    render(false);
    return true;
  }
  return false;
}

function render(appendMore = false) {
  const isAppend = appendMore === true;
  if (!isAppend) {
    currentRenderLimit = RENDER_PAGE_SIZE;
    grid.replaceChildren();
  }
  grid.className = 'grid' + (view === 'list' ? ' list' : '');
  if ($('viewBtn')) {
    $('viewBtn').textContent = view === 'list' ? 'Вид: Список' : 'Вид: Сетка';
  }
  if ($('archiveToggleBtn')) {
    $('archiveToggleBtn').classList.toggle('on', $('statusFilter').value === 'Архив');
  }
  const visItems = getVisibleItems();
  syncHybridStatusTabsUI();

  const moreBtn = $('colLoadMoreBtn');
  if (moreBtn) moreBtn.style.display = 'none';

  if (!loaded) return grid.append(el('div', 'msg', 'Загрузка...'));
  if (!visItems.length) {
    lastList = [];
    renderStatusAndCategoryBanner();
    const isQuota = user && !user.isLocal && (cloudAccessError === 'resource-exhausted' || isCloudQuotaBlocked());
    const isOfflineOrErr = user && !user.isLocal && (cloudAccessError || !navigator.onLine || window.__FIREBASE_OFFLINE_FALLBACK);
    if (isQuota || isOfflineOrErr) {
      const notice = el('div', 'cloud-empty-notice ' + (isQuota ? 'is-quota' : 'is-offline'));
      notice.append(
        el('h3', null, isQuota ? '⏳ Не удалось загрузить коллекцию — исчерпан дневной лимит Firebase' : '📡 Не удалось загрузить коллекцию из облака'),
        el('p', null, isQuota
          ? 'В этом браузере пока нет локальной копии (например, после очистки куки/данных сайта), а бесплатный дневной лимит Firestore (50 000 чтений) временно исчерпан. Твои тайтлы в облаке НЕ удалены — они появятся после суточного сброса лимита (обычно ~10:00–11:00 МСК).'
          : 'Сервер Firebase сейчас недоступен или нет подключения к сети. Твои данные в облаке не затронуты. Можно повторить попытку, загрузить резервную копию .json или временно добавлять тайтлы локально.')
      );
      const actRow = el('div', 'row');
      actRow.style.justifyContent = 'center';
      actRow.style.marginTop = '4px';
      const retryBtn = el('button', 'btn', '↻ Повторить загрузку');
      retryBtn.type = 'button';
      retryBtn.onclick = () => window.forceCloudSyncNow && window.forceCloudSyncNow(true);
      const impBtn = el('button', 'btn btn-s', '📂 Загрузить бэкап (.json)');
      impBtn.type = 'button';
      impBtn.onclick = () => $('universalImportBtn')?.click();
      const addBtn = el('button', 'btn btn-s', '＋ Добавить локально');
      addBtn.type = 'button';
      addBtn.onclick = () => { openAdd(null); draftRestore(); };
      actRow.append(retryBtn, impBtn, addBtn);
      notice.append(actRow);
      return grid.append(notice);
    }
    const m = el('div', 'msg', 'Коллекция пока пуста. Добавь первый тайтл — вручную или из каталога.');
    const r = el('div', 'row'), a = el('button', 'btn', '＋ Добавить тайтл'), c = el('button', 'btn btn-s', '🔍 Открыть каталог');
    r.style.justifyContent = 'center'; r.style.marginTop = '14px';
    a.onclick = () => { openAdd(null); draftRestore(); };
    c.onclick = () => document.querySelector('.tab[data-v="catalog"]').click();
    r.append(a, c); m.append(r);
    return grid.append(m);
  }
  const q = $('searchInput').value.toLowerCase().trim(), st = $('statusFilter').value, tg = $('tagFilter').value, so = $('sortSelect').value, lf = $('listFilter').value;
  const list = visItems.filter(i => {
    const catMatch = cat === 'Всё' ? true : cat === 'Кино и сериалы' ? (KINO.includes(i.category) && (videoSubKind === 'Все' || i.category === videoSubKind)) : i.category === cat;
    const kindMatch = (cat !== 'Манга' || kind === 'Все' || getMangaSubKind(i) === kind) && (cat !== 'Аниме' || animeSubKind === 'Все' || getAnimeSubKind(i) === animeSubKind);
    const stMatch = st === 'Архив' ? !!i.archived
      : !i.archived && (
        st === 'Все' ? true
        : st === 'Любимое' ? !!i.fav
        : st === 'Смотрю/Читаю' ? (i.status === 'Смотрю/Читаю' || i.status === 'Пересматриваю')
        : i.status === st
      );
    return (!q || names(i).includes(q)) && catMatch && kindMatch && (!ongOnly || i.ongoing) && (!xf || xmatch(i)) &&
      stMatch &&
      (tg === 'Все' || (i.tags || []).some(t => t.toLowerCase() === tg)) &&
      (lf === 'Все' || (i.lists || []).some(t => t.toLowerCase() === lf));
  }).sort((a, b) => {
    if (so === 'dateAsc') return a.id - b.id;
    if (so === 'titleAsc') return a.title.localeCompare(b.title, 'ru');
    if (so === 'ratingDesc') return num(b.rating) - num(a.rating);
    if (so === 'extDesc') return num(b.extRating) - num(a.extRating);
    if (so === 'yearDesc') return num(b.year) - num(a.year);
    if (so === 'yearAsc') return (num(a.year) || 9999) - (num(b.year) || 9999);
    return b.id - a.id;
  });
  list.sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0));
  lastList = list;
  renderChips();
  setTimeout(selPaint, 0);
  $('countInfo').textContent = `Показано: ${Math.min(currentRenderLimit, list.length)} из ${list.length} (всего: ${visItems.length})`;
  const xb = $('xfBtn'); xb.style.display = xf ? '' : 'none';
  if (xf) xb.textContent = `${{author: 'Автор', studio: 'Студия', source: 'Источник'}[xf.k]}: ${xf.v} ✕`;
  renderStatusAndCategoryBanner();
  if (!list.length) return grid.append(el('div', 'msg', 'Ничего не найдено по выбранным фильтрам.'));

  const startIdx = isAppend ? Math.max(0, currentRenderLimit - RENDER_PAGE_SIZE) : 0;
  const slice = list.slice(startIdx, currentRenderLimit);
  const frag = document.createDocumentFragment();
  slice.forEach((i, idx) => {
    const node = createCollectionCardNode(i);
    node.style.setProperty('--card-i', String(idx));
    frag.append(node);
  });
  grid.append(frag);

  if (moreBtn) {
    if (list.length > currentRenderLimit) {
      moreBtn.style.display = 'inline-flex';
      moreBtn.textContent = `Показать ещё (${Math.min(RENDER_PAGE_SIZE, list.length - currentRenderLimit)} из ${list.length - currentRenderLimit} оставшихся)`;
    } else {
      moreBtn.style.display = 'none';
    }
  }
}

if ($('colLoadMoreBtn')) {
  $('colLoadMoreBtn').onclick = () => {
    currentRenderLimit += RENDER_PAGE_SIZE;
    render(true);
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting && lastList.length > currentRenderLimit) {
        currentRenderLimit += RENDER_PAGE_SIZE;
        render(true);
      }
    }, { rootMargin: '320px' });
    io.observe($('colLoadMoreBtn'));
  }
}

$('searchInput').addEventListener('input', () => render(false));
['statusFilter', 'tagFilter', 'sortSelect', 'listFilter'].forEach(id => $(id).addEventListener('change', () => render(false)));

// Переключение табов статусов в профиле (включая «📥 Разобрать»)
document.querySelectorAll('#hybStatusTabs .hyb-st-tab').forEach(btn => {
  btn.onclick = () => {
    const st = btn.dataset.st;
    if (st === '__review__') {
      document.querySelectorAll('#hybStatusTabs .hyb-st-tab').forEach(b => b.classList.toggle('on', b === btn));
      if ($('reviewItemsBox')) {
        $('reviewItemsBox').style.display = 'block';
        renderReviewItemsTab();
      }
      $('profColWrap').style.display = 'none';
      return;
    }
    if ($('reviewItemsBox')) $('reviewItemsBox').style.display = 'none';
    $('profColWrap').style.display = '';
    $('statusFilter').value = st;
    render(false);
  };
});

if ($('archiveToggleBtn')) {
  $('archiveToggleBtn').onclick = e => {
    const isArch = $('statusFilter').value === 'Архив';
    $('statusFilter').value = isArch ? 'Все' : 'Архив';
    e.currentTarget.classList.toggle('on', !isArch);
    render();
  };
}

if ($('colCatDropdownBtn')) {
  $('colCatDropdownBtn').onclick = e => {
    e.stopPropagation();
    const wrap = $('colCatDropdownWrap');
    if (!wrap) return;
    if (wrap.dataset.pinned === '1') {
      delete wrap.dataset.pinned;
      wrap.classList.remove('open', 'hover-hold');
    } else {
      wrap.dataset.pinned = '1';
      wrap.classList.add('open');
    }
  };
}
document.querySelectorAll('#catFilters .fb').forEach(b => {
  b.onclick = () => {
    const wrap = $('colCatDropdownWrap');
    if (wrap) { delete wrap.dataset.pinned; wrap.classList.remove('open', 'hover-hold'); }
    document.querySelectorAll('#catFilters .fb').forEach(x => x.classList.remove('on')); b.classList.add('on');
    cat = b.dataset.c; kind = 'Все'; animeSubKind = 'Все'; videoSubKind = 'Все';
    $('kindFilters').style.display = cat === 'Манга' ? 'inline-flex' : 'none';
    if ($('animeKindFilters')) $('animeKindFilters').style.display = cat === 'Аниме' ? 'inline-flex' : 'none';
    if ($('videoKindFilters')) $('videoKindFilters').style.display = cat === 'Кино и сериалы' ? 'inline-flex' : 'none';
    document.querySelectorAll('#kindFilters .kb').forEach(x => x.classList.toggle('on', x.dataset.k === 'Все'));
    document.querySelectorAll('#animeKindFilters .kb').forEach(x => x.classList.toggle('on', x.dataset.ak === 'Все'));
    document.querySelectorAll('#videoKindFilters .kb').forEach(x => x.classList.toggle('on', x.dataset.vk === 'Все'));
    if ($('colKindDropdownBtn')) $('colKindDropdownBtn').textContent = 'Вид: Все виды ▾';
    if ($('colAnimeKindDropdownBtn')) $('colAnimeKindDropdownBtn').textContent = 'Вид: Все аниме ▾';
    if ($('colVideoKindDropdownBtn')) $('colVideoKindDropdownBtn').textContent = 'Вид: Все ▾';
    catCounts();
    render();
  };
});
document.querySelectorAll('#kindFilters .kb').forEach(b => b.onclick = () => {
  kind = b.dataset.k;
  document.querySelectorAll('#kindFilters .kb').forEach(x => x.classList.toggle('on', x === b));
  if ($('colKindDropdownBtn')) $('colKindDropdownBtn').textContent = `Вид: ${b.textContent.replace(/^Вид:\s*/i, '')} ▾`;
  const w = $('kindFilters'); if (w) { delete w.dataset.pinned; w.classList.remove('open', 'hover-hold'); }
  render();
});
document.querySelectorAll('#animeKindFilters .kb').forEach(b => b.onclick = () => {
  animeSubKind = b.dataset.ak;
  document.querySelectorAll('#animeKindFilters .kb').forEach(x => x.classList.toggle('on', x === b));
  if ($('colAnimeKindDropdownBtn')) $('colAnimeKindDropdownBtn').textContent = `Вид: ${b.textContent.replace(/^Вид:\s*/i, '')} ▾`;
  const w = $('animeKindFilters'); if (w) { delete w.dataset.pinned; w.classList.remove('open', 'hover-hold'); }
  render();
});
document.querySelectorAll('#videoKindFilters .kb').forEach(b => b.onclick = () => {
  videoSubKind = b.dataset.vk;
  document.querySelectorAll('#videoKindFilters .kb').forEach(x => x.classList.toggle('on', x === b));
  if ($('colVideoKindDropdownBtn')) $('colVideoKindDropdownBtn').textContent = `Вид: ${b.textContent.replace(/^Вид:\s*/i, '')} ▾`;
  const w = $('videoKindFilters'); if (w) { delete w.dataset.pinned; w.classList.remove('open', 'hover-hold'); }
  render();
});

$('viewBtn').onclick = () => {
  view = view === 'grid' ? 'list' : 'grid';
  try { localStorage.setItem('view', view); } catch (e) {}
  render();
};
$('ongBtn').onclick = e => { ongOnly = !ongOnly; e.currentTarget.classList.toggle('on', ongOnly); render(); };
$('xfBtn').onclick = () => { xf = null; render(); };
const setSize = (v, showHint = false) => {
  const numV = typeof KirokuEngine !== 'undefined' ? KirokuEngine.normalizeGridSize(v) : (Number(v) || 190);
  const sizeKey = numV <= 150 ? 'sm' : numV >= 240 ? 'lg' : 'md';
  document.documentElement.style.setProperty('--cw', numV + 'px');
  document.documentElement.dataset.gridSize = sizeKey;
  if ($('sizeSel') && $('sizeSel').value !== String(numV)) $('sizeSel').value = String(numV);
  const meta = typeof KirokuEngine !== 'undefined'
    ? KirokuEngine.getGridSizeMobileMeta(numV)
    : { shortLabel: sizeKey === 'sm' ? '⊞ 3' : sizeKey === 'lg' ? '⊞ 1' : '⊞ 2', fullLabel: sizeKey === 'sm' ? 'Мелкие (3 в ряд)' : sizeKey === 'lg' ? 'Крупные (1 в ряд)' : 'Средние (2 в ряд)' };
  ['cgMobSizeBtn', 'colMobSizeBtn'].forEach(id => {
    const btn = $(id);
    if (btn) {
      btn.textContent = meta.shortLabel;
      btn.title = 'Размер карточек: ' + meta.fullLabel;
      btn.setAttribute('aria-label', 'Размер карточек: ' + meta.fullLabel);
    }
  });
  document.querySelectorAll('#themeSizeSw button').forEach(b => {
    b.classList.toggle('on', Number(b.dataset.size) === numV);
  });
  try { localStorage.setItem('cw', String(numV)); } catch (e) {}
  if (showHint) toast('Карточки: ' + meta.fullLabel);
};
$('sizeSel').value = localStorage.getItem('cw') || '190';
setSize($('sizeSel').value || '190', false);
$('sizeSel').onchange = e => setSize(e.target.value, false);
['cgMobSizeBtn', 'colMobSizeBtn'].forEach(id => {
  const btn = $(id);
  if (btn) {
    btn.onclick = () => {
      const cur = Number($('sizeSel')?.value || localStorage.getItem('cw') || 190);
      const next = typeof KirokuEngine !== 'undefined'
        ? KirokuEngine.getNextMobileGridSize(cur)
        : (cur === 190 ? 150 : cur === 150 ? 240 : 190);
      setSize(next, true);
    };
  }
});
document.querySelectorAll('#themeSizeSw button').forEach(b => {
  b.onclick = () => setSize(Number(b.dataset.size) || 190, false);
});

// ---------- Модальные окна ----------
let cropDone = null;

// Приоритет модальных окон от самого верхнего к нижнему (по z-index)
const MODAL_STACK_ORDER = ['cropModal', 'dlgModal', 'charPopupModal', 'themeModal', 'dataModal', 'profModal', 'statsModal', 'addModal', 'detailModal', 'rndModal'];

function getOpenModalsInStackOrder() {
  return MODAL_STACK_ORDER.map(id => $(id)).filter(m => m && m.style.display && m.style.display !== 'none');
}

function hideModalElement(modalElOrId, fromPopState = false) {
  const m = typeof modalElOrId === 'string' ? $(modalElOrId) : modalElOrId;
  if (!m || !m.style.display || m.style.display === 'none') return;
  m.style.display = 'none';
  const remaining = getOpenModalsInStackOrder();
  if (!fromPopState && remaining.length === 0 && history.state && history.state.modal) {
    try { history.back(); } catch (e) {}
  }
}

function closeTopModal(fromPopState = false) {
  if (typeof closeQuickAddStatusMenu === 'function' && $('qaFloatMenu')?.classList.contains('open')) {
    closeQuickAddStatusMenu();
    return;
  }
  const openList = getOpenModalsInStackOrder();
  if (!openList.length) return;
  const topModal = openList[0];
  if (topModal.id === 'cropModal' && cropDone) {
    cropDone(null);
    return;
  }
  if (topModal.id === 'dlgModal') {
    if (dlgDone) dlgDone(null);
    else hideModalElement(topModal, fromPopState);
    return;
  }
  hideModalElement(topModal, fromPopState);
}

const closeAll = (fromPopState = false) => {
  if (dlgDone) dlgDone(null);
  if (cropDone) cropDone(null);
  if (typeof closeQuickAddStatusMenu === 'function') closeQuickAddStatusMenu();
  const openList = getOpenModalsInStackOrder();
  MODAL_STACK_ORDER.forEach(id => {
    if ($(id)) $(id).style.display = 'none';
  });
  if (!fromPopState && openList.length > 0 && history.state && history.state.modal) {
    try { history.back(); } catch (e) {}
  }
};

['closeAddBtn', 'closeDetailBtn', 'closeStatsBtn', 'closeStatsTopBtn', 'rndClose'].forEach(id => {
  if ($(id)) $(id).onclick = () => closeTopModal(false);
});

let _lastMouseDownTarget = null;
document.addEventListener('mousedown', e => {
  _lastMouseDownTarget = e.target;
}, true);

document.addEventListener('click', e => {
  const t = e.target;
  if (!t || typeof t.closest !== 'function') return;
  if (!t.closest('#hybMoreWrap')) $('hybMorePop')?.classList.remove('open');
  if (!t.closest('#colMoreWrap')) $('colMorePop')?.classList.remove('open');
  if (!t.closest('#cgPickMenuWrap')) $('cgPickMenuPop')?.classList.remove('open');
  if (!t.closest('#cgCatDropdownWrap')) {
    const w = $('cgCatDropdownWrap');
    if (w) { delete w.dataset.pinned; w.classList.remove('open', 'hover-hold'); }
  }
  if (!t.closest('#colCatDropdownWrap')) {
    const w = $('colCatDropdownWrap');
    if (w) { delete w.dataset.pinned; w.classList.remove('open', 'hover-hold'); }
  }
  if (!t.closest('.acc')) $('accMenu')?.classList.remove('open');
  if ($('qaFloatMenu')?.classList.contains('open') && !t.closest('#qaFloatMenu') && !t.closest('.qa') && !t.closest('.card-dots-btn') && !t.closest('.qa-trigger')) {
    closeQuickAddStatusMenu();
  }
  const clickedDirectlyOnBackdrop = (_lastMouseDownTarget === t);
  if (t.id === 'dlgModal') {
    if (!clickedDirectlyOnBackdrop) return;
    if (dlgDone) dlgDone(null);
    return;
  }
  if (t.classList.contains('modal') && clickedDirectlyOnBackdrop) {
    if (t.id === 'cropModal' && cropDone) { cropDone(null); return; }
    hideModalElement(t, false);
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    $('accMenu')?.classList.remove('open');
    $('hybMorePop')?.classList.remove('open');
    $('colMorePop')?.classList.remove('open');
    $('cgPickMenuPop')?.classList.remove('open');
    ['cgCatDropdownWrap', 'colCatDropdownWrap'].forEach(id => {
      const w = $(id);
      if (w) { delete w.dataset.pinned; w.classList.remove('open', 'hover-hold'); }
    });
    if ($('qaFloatMenu')?.classList.contains('open')) {
      closeQuickAddStatusMenu();
      return;
    }
    closeTopModal(false);
  }
});

const _bindPosterPreviewImg = () => {
  applyPosterImg($('posterPreview'), posterValue, null);
  const baseErr = $('posterPreview').onerror;
  $('posterPreview').onerror = () => {
    if (baseErr) baseErr();
    pvDraw();
  };
};
function setPoster(v) {
  posterValue = v || ''; const data = posterValue.startsWith('data:');
  $('inputPoster').value = data ? '' : posterValue;
  $('inputPoster').placeholder = data ? 'Загружен свой файл ✓' : 'Ссылка на постер (URL)';
  _bindPosterPreviewImg();
}
$('inputPoster').oninput = () => { posterValue = $('inputPoster').value.trim(); _bindPosterPreviewImg(); draftSave(); };
$('clearPoster').onclick = () => { setPoster(''); draftSave(); };
$('inputPosterFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const img = new Image(), url = URL.createObjectURL(f);
  img.onload = () => {
    const w = Math.min(360, img.width), h = Math.round(img.height * w / img.width), c = document.createElement('canvas');
    c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
    setPoster(c.toDataURL('image/jpeg', .75)); URL.revokeObjectURL(url); draftSave();
  };
  img.onerror = () => toast('Не удалось прочитать картинку.');
  img.src = url; e.target.value = '';
};

const parseTags = s => { const seen = new Set(); return s.split(',').map(t => t.trim()).filter(t => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase())); };

function afHint() {
  $('inputKind').style.display = $('inputCategory').value === 'Манга' ? '' : 'none';
}
$('inputCategory').onchange = afHint;

// ---- Перевод и получение русских названий/описаний
const SHK = {'Аниме': 'animes', 'Манга': 'mangas', 'Ранобэ': 'ranobe'}, SHD = ['shikimori.io', 'shikimori.one'], WDP = {animes: 'P4086', mangas: 'P4087', ranobe: 'P4087'};
const hasRu = t => /[а-яё]/i.test(t || ''), ruN = t => (t || '').toLowerCase().replace(/[^a-z0-9а-яё]+/g, ''), ruWait = ms => new Promise(r => setTimeout(r, ms));
const ruClean = t => (t || '').replace(/\[(character|person|anime|manga|ranobe|url|user)[^\]]*\]([^\[]*)\[\/\1\]/gi, '$2').replace(/\[\/?[a-z_]+(?:=[^\]]*)?\]/gi, '').replace(/\n{3,}/g, '\n\n').trim();
const ruJson = async (u, ms = 7000) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); try { const r = await fetch(u, {signal: c.signal}); if (!r.ok) { const err = new Error('HTTP ' + r.status); err.status = r.status; throw err; } return await r.json(); } finally { clearTimeout(t); } };

// Троттлинг-очередь для Shikimori (макс. 2 одновременных запроса, интервал >= 260 мс, 1 авто-повтор при 429)
const shikiOk = () => true;
const _shikiQueue = [];
let _shikiActive = 0;
let _shikiLastRunAt = 0;
function _drainShikiQueue() {
  while (_shikiActive < 2 && _shikiQueue.length > 0) {
    const job = _shikiQueue.shift();
    _shikiActive++;
    (async () => {
      try {
        const now = Date.now();
        const waitMs = Math.max(0, (_shikiLastRunAt + 260) - now);
        _shikiLastRunAt = now + waitMs;
        if (waitMs > 0) await ruWait(waitMs);
        const res = await job.fn();
        job.resolve(res);
      } catch (err) {
        job.reject(err);
      } finally {
        _shikiActive--;
        _drainShikiQueue();
      }
    })();
  }
}
function _enqueueShiki(fn) {
  return new Promise((resolve, reject) => {
    _shikiQueue.push({ fn, resolve, reject });
    _drainShikiQueue();
  });
}

// Троттлинг-очередь и кэш для Jikan v4 (строго <= 3 запросов/сек: интервал >= 380 мс, авто-повтор при 429)
const _jikanQueue = [];
let _jikanActive = 0;
let _jikanLastRunAt = 0;
const _jikanRespCache = new Map();
const _jikanInflight = new Map();
function _drainJikanQueue() {
  while (_jikanActive < 2 && _jikanQueue.length > 0) {
    const job = _jikanQueue.shift();
    _jikanActive++;
    (async () => {
      try {
        const now = Date.now();
        const waitMs = Math.max(0, (_jikanLastRunAt + 380) - now);
        _jikanLastRunAt = now + waitMs;
        if (waitMs > 0) await ruWait(waitMs);
        const res = await job.fn();
        job.resolve(res);
      } catch (err) {
        job.reject(err);
      } finally {
        _jikanActive--;
        _drainJikanQueue();
      }
    })();
  }
}
function _enqueueJikan(fn) {
  return new Promise((resolve, reject) => {
    _jikanQueue.push({ fn, resolve, reject });
    _drainJikanQueue();
  });
}
async function _jikanJson(url, ms = 6500) {
  const cached = _jikanRespCache.get(url);
  if (cached && (Date.now() - cached.t) < 300000) return cached.data;
  if (_jikanInflight.has(url)) return _jikanInflight.get(url);
  const prom = _enqueueJikan(async () => {
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const data = await ruJson(url, ms);
        _jikanRespCache.set(url, { t: Date.now(), data });
        if (_jikanRespCache.size > 150) _jikanRespCache.delete(_jikanRespCache.keys().next().value);
        return data;
      } catch (e) {
        lastErr = e;
        if (attempt === 0 && (e?.status === 429 || /429/.test(e?.message || ''))) {
          await ruWait(1250);
          continue;
        }
        break;
      }
    }
    throw lastErr || new Error('Jikan request failed');
  }).finally(() => {
    _jikanInflight.delete(url);
  });
  _jikanInflight.set(url, prom);
  return prom;
}

// Троттлинг-очередь, кэш и прокси-фоллбэк для MangaDex API (работает без ключей и с обходом блокировок в РФ)
const _mangadexQueue = [];
let _mangadexActive = 0;
let _mangadexLastRunAt = 0;
const _mangadexRespCache = new Map();
const _mangadexInflight = new Map();
let _mangadexDirectBlockedUntil = 0;
function _drainMangadexQueue() {
  while (_mangadexActive < 3 && _mangadexQueue.length > 0) {
    const job = _mangadexQueue.shift();
    _mangadexActive++;
    (async () => {
      try {
        const now = Date.now();
        const waitMs = Math.max(0, (_mangadexLastRunAt + 240) - now);
        _mangadexLastRunAt = now + waitMs;
        if (waitMs > 0) await ruWait(waitMs);
        const res = await job.fn();
        job.resolve(res);
      } catch (err) {
        job.reject(err);
      } finally {
        _mangadexActive--;
        _drainMangadexQueue();
      }
    })();
  }
}
function _enqueueMangaDex(fn) {
  return new Promise((resolve, reject) => {
    _mangadexQueue.push({ fn, resolve, reject });
    _drainMangadexQueue();
  });
}
async function _mangadexJson(url, ms = 6500) {
  const cached = _mangadexRespCache.get(url);
  if (cached && (Date.now() - cached.t) < 300000) return cached.data;
  if (_mangadexInflight.has(url)) return _mangadexInflight.get(url);
  const prom = _enqueueMangaDex(async () => {
    const tryProxy = async () => {
      const proxies = [
        'https://corsproxy.io/?' + encodeURIComponent(url),
        'https://api.allorigins.win/raw?url=' + encodeURIComponent(url)
      ];
      return await Promise.any(proxies.map(pu => ruJson(pu, 6500)));
    };
    let data = null;
    if (Date.now() >= _mangadexDirectBlockedUntil) {
      try {
        data = await ruJson(url, ms);
      } catch (e) {
        if (e?.status === 429) {
          await ruWait(1000);
          data = await ruJson(url, ms);
        } else {
          _mangadexDirectBlockedUntil = Date.now() + 5 * 60 * 1000;
          data = await tryProxy();
        }
      }
    } else {
      data = await tryProxy();
    }
    _mangadexRespCache.set(url, { t: Date.now(), data });
    if (_mangadexRespCache.size > 120) _mangadexRespCache.delete(_mangadexRespCache.keys().next().value);
    return data;
  }).finally(() => {
    _mangadexInflight.delete(url);
  });
  _mangadexInflight.set(url, prom);
  return prom;
}

let _shikiDirectBlockedUntil = 0;
async function shiki(path) {
  return _enqueueShiki(async () => {
    let lastErr = null;
    if (Date.now() >= _shikiDirectBlockedUntil) {
      for (let attempt = 0; attempt < 2; attempt++) {
        for (const d of SHD) {
          try {
            return await ruJson('https://' + d + path, 6000);
          } catch (e) {
            lastErr = e;
            if (e?.status === 429 || /429/.test(e?.message || '')) break;
          }
        }
        if (attempt === 0) {
          const is429 = lastErr?.status === 429 || /429/.test(lastErr?.message || '');
          if (!is429) break;
          await ruWait(1200);
        }
      }
    }
    // Если прямой доступ к Shikimori заблокирован в РФ без VPN — пробуем через CORS-прокси
    if (!lastErr || (lastErr.status !== 429)) {
      try {
        const target = 'https://shikimori.one' + path;
        const pData = await Promise.any([
          ruJson('https://corsproxy.io/?' + encodeURIComponent(target), 6000),
          ruJson('https://api.allorigins.win/raw?url=' + encodeURIComponent(target), 6000)
        ]);
        _shikiDirectBlockedUntil = Date.now() + 3 * 60 * 1000;
        return pData;
      } catch (proxyErr) {}
    }
    throw lastErr || new Error('Shikimori REST error');
  });
}

const _shikiGqlBlockedHosts = new Map();
function isShikiGraphQLBlockedNow() {
  const now = Date.now();
  return (_shikiGqlBlockedHosts.get('https://shikimori.io/api/graphql') || 0) > now
    && (_shikiGqlBlockedHosts.get('https://shikimori.one/api/graphql') || 0) > now;
}

async function shikiGraphQL(query, variables = {}, extSignal = null) {
  if (isShikiGraphQLBlockedNow()) {
    throw new Error('Shikimori GraphQL temporarily unavailable');
  }
  return _enqueueShiki(async () => {
    if (extSignal && extSignal.aborted) throw new Error('Aborted');
    const now = Date.now();
    const endpoints = ['https://shikimori.io/api/graphql', 'https://shikimori.one/api/graphql']
      .filter(ep => (_shikiGqlBlockedHosts.get(ep) || 0) <= now);
    if (!endpoints.length) throw new Error('Shikimori GraphQL temporarily unavailable');

    let lastErr = null;
    for (const ep of endpoints) {
      if (extSignal && extSignal.aborted) throw new Error('Aborted');
      const ctrl = new AbortController();
      const onExtAbort = () => ctrl.abort();
      if (extSignal) extSignal.addEventListener('abort', onExtAbort, { once: true });
      const timer = setTimeout(() => ctrl.abort(), 3200);
      try {
        const resp = await fetch(ep, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query, variables })
        });
        if (resp.status === 429) {
          const err429 = new Error('HTTP 429');
          err429.status = 429;
          throw err429;
        }
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const j = await resp.json();
        if (j.errors && !j.data) throw new Error(j.errors[0]?.message || 'Shikimori GraphQL error');
        return j.data || {};
      } catch (e) {
        lastErr = e;
        if (extSignal && extSignal.aborted) throw e;
        if (e?.status !== 429) {
          _shikiGqlBlockedHosts.set(ep, Date.now() + 5 * 60 * 1000);
        } else {
          break;
        }
      } finally {
        clearTimeout(timer);
        if (extSignal) extSignal.removeEventListener('abort', onExtAbort);
      }
    }
    throw lastErr || new Error('Shikimori GraphQL error');
  });
}

function pickShikiGraphQLPoster(p) {
  const cand = [p?.originalUrl, p?.mainUrl].find(isValidPosterUrl);
  return cand || '';
}
const RUC = (() => { try { return JSON.parse(localStorage.getItem('ruCache') || '{}'); } catch (e) { return {}; } })();
function saveRuCacheLocal() {
  try {
    // Храним переводы названий только локально (localStorage + IndexedDB), чтобы листание каталога не тратило лимиты записей Firebase
    const entries = Object.entries(RUC).filter(([k, v]) => v && !k.startsWith('d') && typeof v === 'string');
    const trimmed = Object.fromEntries(entries.slice(-500));
    localStorage.setItem('ruCache', JSON.stringify(trimmed));
  } catch (e) {}
}
function scheduleSaveRuCacheToCloud() {
  saveRuCacheLocal();
}
async function loadRuCacheFromCloud() {
  // Кэш русских названий каталога теперь полностью локальный (0 чтений и 0 записей в Firebase)
}
let ruWarned = false, ruBusy = false;
const ruWarn = () => { if (!ruWarned) { ruWarned = true; toast('Не удалось получить русский текст — оставил как есть.', true); } };
async function ruChunk(p) {
  if (!p || !p.trim()) return '';
  try {
    const j = await ruJson('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ru&dt=t&q=' + encodeURIComponent(p), 6500);
    const t = (j && Array.isArray(j[0])) ? j[0].map(x => x && x[0] ? x[0] : '').join('') : '';
    if (t && hasRu(t)) return t;
  } catch (e) {}
  try {
    const j2 = await ruJson('https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=ru&q=' + encodeURIComponent(p), 6500);
    const t2 = Array.isArray(j2) ? (typeof j2[0] === 'string' ? j2[0] : (Array.isArray(j2[0]) ? j2[0][0] : '')) : (j2?.sentences ? j2.sentences.map(s => s.trans || '').join('') : '');
    if (t2 && hasRu(t2)) return t2;
  } catch (e) {}
  let out = '';
  for (let i = 0; i < p.length; i += 450) {
    try {
      const j3 = await ruJson('https://api.mymemory.translated.net/get?langpair=en|ru&q=' + encodeURIComponent(p.slice(i, i + 450)), 6500);
      out += j3?.responseData?.translatedText || p.slice(i, i + 450);
    } catch (e) {
      out += p.slice(i, i + 450);
    }
  }
  return out;
}
async function ruTranslate(t) {
  if (!t) return '';
  const cleaned = String(t).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\((?:Source|Note):[^)]*\)/gi, '').trim();
  if (!cleaned || hasRu(cleaned)) return cleaned;
  const parts = []; let rest = cleaned;
  while (rest.length > 1200) {
    let i = rest.lastIndexOf('. ', 1200);
    if (i < 200) i = 1200;
    parts.push(rest.slice(0, i + 1));
    rest = rest.slice(i + 1);
  }
  parts.push(rest);
  let out = '';
  for (const p of parts) out += (out ? ' ' : '') + await ruChunk(p);
  return out.trim() || cleaned;
}
async function wdBatch(mals, prop) {
  const q = `SELECT ?m ?l ?a WHERE { VALUES ?m { ${mals.map(m => `"${m}"`).join(' ')} } ?i wdt:${prop} ?m . OPTIONAL { ?i rdfs:label ?l FILTER(LANG(?l)="ru") } OPTIONAL { ?a schema:about ?i; schema:isPartOf <https://ru.wikipedia.org/> } }`;
  const j = await ruJson('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), 9000), out = {};
  j.results.bindings.forEach(b => { out[b.m.value] = {ru: b.l ? b.l.value : '', wiki: b.a ? decodeURIComponent(b.a.value.split('/wiki/')[1] || '') : ''}; }); return out;
}
const ruWikiDesc = async t => (await ruJson('https://ru.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(t), 6000)).extract || '';
async function ruToEn(q) {
  const s = await ruJson('https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&origin=*&language=ru&uselang=ru&type=item&limit=5&search=' + encodeURIComponent(q), 6000);
  const c = (s.search || []).find(x => /аниме|манг|ранобэ|новелл/i.test(x.description || '')) || (s.search || [])[0]; if (!c) return '';
  const e = await ruJson('https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&props=labels&languages=en&ids=' + c.id, 6000);
  return e.entities?.[c.id]?.labels?.en?.value || '';
}
async function ruWikiFind(q, names, cat, year) {
  const w = {'Аниме': 'аниме', 'Манга': 'манга', 'Ранобэ': 'ранобэ'}[cat] || '';
  const s = await ruJson('https://ru.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=3&srsearch=' + encodeURIComponent(q + ' ' + w), 6000);
  for (const [k, h] of (s.query?.search || []).entries()) {
    const x = await ruJson('https://ru.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(h.title), 6000), ex = ruN(x.extract || '');
    if (names.some(n => n.length > 3 && ex.includes(n)) || (k === 0 && year && (x.extract || '').includes(String(year)))) return {title: (x.title || h.title).replace(/\s*\(.*?\)\s*$/, ''), desc: x.extract || ''};
  }
  return null;
}
async function ruTitles(kind, mals) {
  const out = {};
  const cleanIds = [...new Set((mals || []).map(Number).filter(n => n > 0))];
  if (!cleanIds.length) return out;
  try {
    const field = kind === 'animes' ? 'animes' : 'mangas';
    const q = `query($ids:String,$limit:PositiveInt){${field}(ids:$ids,limit:$limit){id malId name russian poster{originalUrl mainUrl}}}`;
    for (let i = 0; i < cleanIds.length; i += 50) {
      const slice = cleanIds.slice(i, i + 50);
      const data = await shikiGraphQL(q, { ids: slice.join(','), limit: slice.length });
      (data?.[field] || []).forEach(x => {
        const mid = Number(x.malId || x.id);
        if (mid && x.russian) out[mid] = x.russian;
      });
    }
  } catch (e) {
    try {
      for (let i = 0; i < cleanIds.length; i += 50) {
        (await shiki(`/api/${kind}?ids=${cleanIds.slice(i, i + 50).join(',')}&limit=50`)).forEach(x => {
          if (x.russian) out[x.id] = x.russian;
        });
      }
    } catch (e2) {}
  }
  const miss = cleanIds.filter(m => !out[m]);
  if (miss.length) { try { const w = await wdBatch(miss, WDP[kind]); miss.forEach(m => { if (w[m] && hasRu(w[m].ru)) out[m] = w[m].ru; }); } catch (e) {} }
  return out;
}
function ruFull(r) {
  return r.ruP ||= (async () => {
    let ru = '', d = '';
    if (r.mal && SHK[r.category]) {
      try {
        const isAnime = r.category === 'Аниме';
        const field = isAnime ? 'animes' : 'mangas';
        const extraFields = isAnime
          ? 'episodes duration origin studios{name} videos{url kind}'
          : 'chapters volumes publishers{name}';
        const q = `query($ids:String){${field}(ids:$ids,limit:1){id malId name russian english japanese synonyms kind status score airedOn{year} releasedOn{year} isCensored genres{id name russian} description poster{originalUrl mainUrl} ${extraFields}}}`;
        const gData = await shikiGraphQL(q, { ids: String(r.mal) });
        let x = (gData?.[field] || [])[0] || null;
        if (!x) x = await shiki(`/api/${SHK[r.category]}/${r.mal}`).catch(() => null);
        if (x) {
          ru = x.russian || '';
          d = ruClean(x.description);
          if (Array.isArray(x.genres) && x.genres.length && (!r.tags || !r.tags.length)) {
            r.tags = x.genres.map(g => g.russian || g.name).filter(Boolean);
          }
          if (Array.isArray(x.studios) && x.studios.length && !r.studio) {
            r.studio = x.studios.map(s => s.filtered_name || s.name).filter(Boolean).slice(0, 2).join(', ');
          }
          if (Array.isArray(x.publishers) && x.publishers.length && !r.studio) {
            r.studio = x.publishers.map(p => p.name).filter(Boolean).slice(0, 2).join(', ');
          }
          if (Number(x.duration) > 0 && !r.dur) r.dur = Number(x.duration);
          if (Number(x.episodes || x.chapters) > 0 && !r.eps) r.eps = Number(x.episodes || x.chapters);
          if (Number(x.volumes) > 0 && !r.vols) r.vols = Number(x.volumes);
          if (x.name && !r.romaji) r.romaji = x.name;
          if ((x.english || x.name) && !r.en) r.en = x.english || x.name;
          if (x.japanese && !r.orig) r.orig = x.japanese;
          if (Array.isArray(x.synonyms) && x.synonyms.length && !r.alt) {
            r.alt = [x.name, ...x.synonyms].filter(s => s && s !== ru && s !== r.en).slice(0, 5).join(', ');
          }
          const pUrl = x.poster ? pickShikiGraphQLPoster(x.poster) : (x.image?.original ? 'https://shikimori.io' + x.image.original : '');
          if (!isValidPosterUrl(r.poster) && isValidPosterUrl(pUrl)) r.poster = pUrl;
          if (Array.isArray(x.videos) && !r.trailerId) {
            const pv = x.videos.find(v => /pv|trailer/i.test(v.kind || '')) || x.videos[0];
            const cleaned = cleanYoutubeId(pv?.url);
            if (cleaned) r.trailerId = cleaned;
          }
        }
      } catch (e) {}
      if (!isValidPosterUrl(r.poster)) {
        const jPoster = await _fetchJikanPoster(r.mal, r.category);
        if (jPoster) r.poster = jPoster;
      }
      if (!ru || !hasRu(d)) { try { const w = (await wdBatch([r.mal], WDP[SHK[r.category]]))[r.mal]; if (w) { if (!ru && hasRu(w.ru)) ru = w.ru; if (!hasRu(d) && w.wiki) d = await ruWikiDesc(w.wiki); } } catch (e) {} }
    }
    if (ru && !hasRu(r.title)) { if (!r.en) r.en = r.title; r.title = ru; }
    if (hasRu(d)) r.desc = d; else if (r.desc && !hasRu(r.desc)) { try { r.desc = await ruTranslate(r.desc); } catch (e) { ruWarn(); } }
    r.ruDone = 1; return r;
  })();
}
async function ruPreview(r) {
  if (!r || r.ruDone) return;
  if (r.tmdb && typeof tmdbInfo === 'function' && (!r.author || !r.studio || !r.trailerId)) {
    try {
      const info = await tmdbInfo(r);
      Object.assign(r, info);
      r.ruDone = 1;
      if (rndR === r) {
        $('rndCredits').textContent = [r.author && 'Режиссёр: ' + r.author, r.studio && 'Студия: ' + r.studio, r.cast && 'В ролях: ' + r.cast].filter(Boolean).join('  •  ');
        if (typeof rndTagChips === 'function') rndTagChips(r);
      }
    } catch (e) {}
    return;
  }
  if (!['AniList', 'Jikan', 'MangaDex', 'Shikimori'].includes(r.src)) return;
  if (!r.desc) $('rndDesc').textContent = 'Загружаю описание на русском…';
  else if (!hasRu(r.desc)) $('rndDesc').textContent = 'Перевожу на русский…';
  await ruFull(r);
  if (rndR === r) {
    $('rndTitle').textContent = r.title;
    $('rndNames').textContent = [r.en, r.orig].filter(Boolean).join(' / ');
    $('rndDesc').textContent = r.desc || 'Описание отсутствует.';
    $('rndCredits').textContent = [r.author && 'Автор: ' + r.author, r.studio && 'Студия: ' + r.studio, r.source && 'Источник: ' + r.source].filter(Boolean).join('  •  ');
    if (typeof rndTagChips === 'function') rndTagChips(r);
  }
}
const getRuCacheKey = r => (SHK[r.category] || 'media') + '_' + (r.mal || r.aniId || r.tmdb || ruN(r.title));
const ruSet = (c, ru) => {
  const r = c._r;
  r.ruTitle = 1;
  if (!ru) return;
  if (!r.en) r.en = r.title;
  r.title = ru;
  const h = c.querySelector('.title');
  if (h) { h.textContent = ru; h.title = ru; }
  document.querySelectorAll('#cgHeroTrack .cg-hero-card').forEach(hc => {
    if (hc._r === r) {
      const ht = hc.querySelector('.cg-hero-title');
      if (ht) ht.textContent = ru;
    }
  });
};
const ruSetDesc = (c, ruDesc) => {
  const r = c?._r;
  if (!r || !ruDesc) return;
  r.desc = ruDesc;
  r.ruDescDone = 1;
  const pEl = c.querySelector('.ov p');
  if (pEl) pEl.textContent = ruDesc;
};

async function ensureCardRuDescription(c) {
  const r = c?._r;
  if (!r || r.ruDescDone) return;
  const dKey = 'd_' + getRuCacheKey(r);
  if (RUC[dKey] && hasRu(RUC[dKey])) {
    ruSetDesc(c, RUC[dKey]);
    return;
  }
  if (!r.desc || hasRu(r.desc)) {
    r.ruDescDone = 1;
    return;
  }
  if (r._descTranslating) return r._descTranslating;
  r._descTranslating = (async () => {
    try {
      const tr = await ruTranslate(r.desc);
      if (tr && hasRu(tr)) {
        RUC[dKey] = tr;
        ruSetDesc(c, tr);
        scheduleSaveRuCacheToCloud();
      }
    } catch (e) {}
  })();
  return r._descTranslating;
}

async function ruCards() {
  const allCards = [...cgGrid.children].filter(c => c._r);
  allCards.forEach(c => {
    const tKey = getRuCacheKey(c._r);
    if (!hasRu(c._r.title) && RUC['t_' + tKey] && hasRu(RUC['t_' + tKey])) {
      ruSet(c, RUC['t_' + tKey]);
    }
    const dKey = 'd_' + tKey;
    if (RUC[dKey] && hasRu(RUC[dKey])) ruSetDesc(c, RUC[dKey]);
  });

  const cards = allCards.filter(c => c._r.mal && SHK[c._r.category] && !c._r.ruTitle);
  const key = c => SHK[c._r.category] + c._r.mal;
  cards.filter(c => RUC[key(c)]).forEach(c => ruSet(c, RUC[key(c)]));
  for (const kind of ['animes', 'mangas', 'ranobe']) {
    const grp = cards.filter(c => !c._r.ruTitle && SHK[c._r.category] === kind);
    if (!grp.length) continue;
    try {
      const t = await ruTitles(kind, [...new Set(grp.map(c => c._r.mal))]);
      let addedNew = false;
      grp.forEach(c => {
        const ru = t[c._r.mal];
        if (ru && RUC[kind + c._r.mal] !== ru) addedNew = true;
        if (ru) RUC[kind + c._r.mal] = ru;
        ruSet(c, ru);
      });
      if (addedNew) scheduleSaveRuCacheToCloud();
      else saveRuCacheLocal();
    } catch (e) {}
  }
}

const spl = v => (v || '').split(',').map(x => x.trim()).filter(Boolean);


// ---- Темы и цвета оформления
const THEMES = [['', '🌌 Стекло'], ['black', '⬛ Чёрная'], ['white', '⬜ Белая'], ['neon', '🌸 Неон'], ['mocha', '☕ Мокко']];
const ACC = [['#8b5cf6', '#c084fc'], ['#e0245e', '#ff86ad'], ['#0d7d73', '#5eead4'], ['#c2410c', '#fbbf24'], ['#0369a1', '#7dd3fc']];
const accIdx = () => { try { return +localStorage.getItem('acc') || 0; } catch (e) { return 0; } };
const hexL = h => { const n = parseInt(h.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const mixW = (h, k) => { const n = parseInt(h.slice(1), 16); return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(v + (255 - v) * k).toString(16).padStart(2, '0')).join(''); };
let uiT = 0; const uiSync = () => { clearTimeout(uiT); uiT = setTimeout(profCloud, 1500); };

function setTheme(t, quiet) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch (e) {}
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    const themeColors = { white: '#f4f5f8', black: '#000000', neon: '#090812', mocha: '#14110f', '': '#0f1115' };
    metaTheme.setAttribute('content', themeColors[t] || '#0f1115');
  }
  [...$('accTh').children].forEach(b => b.classList.toggle('on', b.dataset.t === t));
  if (!quiet) { prof.theme = t; profSaveLocal(); uiSync(); }
}
THEMES.forEach(([t, n]) => { const b = el('button', null, n); b.type = 'button'; b.dataset.t = t; b.onclick = e => { e.stopPropagation(); setTheme(t); }; $('accTh').append(b); });
try { setTheme(localStorage.getItem('theme') || '', true); } catch (e) {}

function applyAccent() {
  const r = document.documentElement.style, c = prof.customColor;
  if (!c && accIdx() === 0) { ['--ac', '--ach', '--on'].forEach(v => r.removeProperty(v)); return; }
  const [a, h] = c ? [c, mixW(c, 0.3)] : (ACC[accIdx()] || ACC[0]);
  r.setProperty('--ac', a); r.setProperty('--ach', h); r.setProperty('--on', hexL(a) > 0.4 ? '#111' : '#fff');
}
function setAcc(k) { prof.customColor = ''; prof.acc = k; try { localStorage.setItem('acc', k); } catch (e) {} profSaveLocal(); applyAccent(); uiSync(); }
applyAccent();
ACC.forEach(([a], k) => { const b = el('button'); b.type = 'button'; b.style.background = a; b.title = 'Цвет оформления'; b.onclick = e => { e.stopPropagation(); setAcc(k); }; $('accSw').append(b); });

const GRAD = ['linear-gradient(135deg,#6d28d9,#be185d)', 'linear-gradient(135deg,#ff5d8f,#f59e0b)', 'linear-gradient(135deg,#0f766e,#2dd4bf)', 'linear-gradient(135deg,#111827,#4b5563)', 'linear-gradient(135deg,#7c2d12,#f59e0b)', 'linear-gradient(135deg,#1e3a8a,#a78bfa)'];

function rtApply() {
  document.body.classList.remove('rt-ext', 'rt-mine', 'rt-none');
}
if ($('accThemeModalBtn')) {
  $('accThemeModalBtn').onclick = () => {
    $('accMenu')?.classList.remove('open');
    $('themeModal').style.display = 'flex';
  };
}
if ($('closeThemeModalBtn')) $('closeThemeModalBtn').onclick = () => hideModalElement('themeModal');
if ($('doneThemeModalBtn')) $('doneThemeModalBtn').onclick = () => hideModalElement('themeModal');

function profPaint() {
  rtApply();
  if (prof.theme != null && prof.theme !== (document.documentElement.dataset.theme || '')) setTheme(prof.theme, true);
  if (prof.acc != null && prof.acc !== accIdx()) { try { localStorage.setItem('acc', prof.acc); } catch (e) {} }
  applyAccent();
  const u = user || {};
  const fallbackName = u.displayName || (u.email ? u.email.split('@')[0] : 'Пользователь');
  const av = safePosterUrl(prof.avatar || u.photoURL || '') || FALL;
  const rawCover = prof.cover || '';
  const bg = rawCover ? safeCssBgUrl(rawCover) : prof.coverColor ? GRAD[prof.coverColor - 1] : '';
  $('avatar').src = av;
  $('hdrAvatar').src = av;
  $('profName').textContent = prof.name || prof.displayName || fallbackName;
  $('profBio').textContent = prof.bio || '';
  $('profBio').style.display = prof.bio ? '' : 'none';

  const nbLine = $('profNameBdayLine');
  if (nbLine) {
    const parts = [];
    if (prof.realName) parts.push(`Имя: ${prof.realName}`);
    if (prof.bday) parts.push(`День рождения: ${prof.bday}`);
    nbLine.style.display = parts.length ? 'flex' : 'none';
    nbLine.textContent = parts.join('   ·   ');
  }

  const banner = $('hybBanner');
  if (banner) {
    banner.style.backgroundImage = bg || GRAD[0];
  }
  if ($('quickCoverChangeBtn')) $('quickCoverChangeBtn').style.display = '';
  document.documentElement.style.setProperty('--bgimg', bg || 'none');
  document.body.classList.toggle('bgimg', !!(prof.bgAll && bg));
  document.body.classList.remove('cs-sharp', 'cs-minimal');
  if (prof.cardStyle) document.body.classList.add('cs-' + prof.cardStyle);
}



function imgData(file, w, h, q) {
  return new Promise((ok, no) => { const fr = new FileReader(); fr.onerror = no; fr.onload = () => { const im = new Image(); im.onerror = no; im.onload = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; const k = Math.max(w / im.width, h / im.height), sw = w / k, sh = h / k; c.getContext('2d').drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, 0, 0, w, h); ok(c.toDataURL('image/jpeg', q)); }; im.src = fr.result; }; fr.readAsDataURL(file); });
}

function openImageCropperModal(file, targetW, targetH, quality = 0.78, titleText = 'Кадрирование изображения') {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = reject;
    fr.onload = () => {
      const im = new Image();
      im.onerror = reject;
      im.onload = () => {
        const modal = $('cropModal'), canvas = $('cropCanvas'), zoomInp = $('cropZoomInput');
        if (!modal || !canvas || !zoomInp) {
          imgData(file, targetW, targetH, quality).then(resolve, reject);
          return;
        }
        $('cropModalTitle').textContent = titleText;
        const previewW = targetW > targetH ? 480 : 240;
        const previewH = Math.round(previewW * (targetH / targetW));
        canvas.width = previewW;
        canvas.height = previewH;
        const ctx = canvas.getContext('2d');

        let zoom = 1, panX = 0, panY = 0, dragging = false, startX = 0, startY = 0;
        zoomInp.value = '1';

        const clampPan = () => {
          const baseScale = Math.max(previewW / im.width, previewH / im.height) * zoom;
          const drawW = im.width * baseScale;
          const drawH = im.height * baseScale;
          const maxOffX = Math.max(0, (drawW - previewW) / 2);
          const maxOffY = Math.max(0, (drawH - previewH) / 2);
          panX = Math.max(-maxOffX, Math.min(maxOffX, panX));
          panY = Math.max(-maxOffY, Math.min(maxOffY, panY));
        };

        const drawPreview = () => {
          clampPan();
          ctx.clearRect(0, 0, previewW, previewH);
          const baseScale = Math.max(previewW / im.width, previewH / im.height) * zoom;
          const drawW = im.width * baseScale;
          const drawH = im.height * baseScale;
          const dx = (previewW - drawW) / 2 + panX;
          const dy = (previewH - drawH) / 2 + panY;
          ctx.drawImage(im, dx, dy, drawW, drawH);
          if (targetW === targetH) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, previewW, previewH);
            ctx.arc(previewW / 2, previewH / 2, Math.min(previewW, previewH) / 2 - 4, 0, Math.PI * 2, true);
            ctx.fillStyle = 'rgba(10, 12, 16, 0.52)';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(previewW / 2, previewH / 2, Math.min(previewW, previewH) / 2 - 4, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.restore();
          }
        };

        const onDown = (clientX, clientY) => {
          dragging = true;
          startX = clientX - panX;
          startY = clientY - panY;
        };
        const onMove = (clientX, clientY) => {
          if (!dragging) return;
          panX = clientX - startX;
          panY = clientY - startY;
          drawPreview();
        };
        const onUp = () => { dragging = false; };

        canvas.onmousedown = e => onDown(e.clientX, e.clientY);
        canvas.onmousemove = e => onMove(e.clientX, e.clientY);
        window.addEventListener('mouseup', onUp);
        canvas.ontouchstart = e => { if (e.touches[0]) onDown(e.touches[0].clientX, e.touches[0].clientY); };
        canvas.ontouchmove = e => { if (e.touches[0]) { e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY); } };
        canvas.ontouchend = onUp;

        zoomInp.oninput = () => {
          zoom = parseFloat(zoomInp.value) || 1;
          drawPreview();
        };
        $('cropResetBtn').onclick = () => {
          zoom = 1; panX = 0; panY = 0; zoomInp.value = '1';
          drawPreview();
        };

        if (cropDone) cropDone(null);
        const finish = resultDataUrl => {
          if (cropDone !== finish) return;
          cropDone = null;
          window.removeEventListener('mouseup', onUp);
          hideModalElement(modal);
          resolve(resultDataUrl);
        };
        cropDone = finish;
        $('cropCancelBtn').onclick = () => finish(null);
        $('cropCloseBtn').onclick = () => finish(null);
        $('cropApplyBtn').onclick = () => {
          const outCanvas = document.createElement('canvas');
          outCanvas.width = targetW;
          outCanvas.height = targetH;
          const outCtx = outCanvas.getContext('2d');
          const ratio = targetW / previewW;
          const baseScale = Math.max(previewW / im.width, previewH / im.height) * zoom;
          const drawW = im.width * baseScale * ratio;
          const drawH = im.height * baseScale * ratio;
          const dx = ((previewW - im.width * baseScale) / 2 + panX) * ratio;
          const dy = ((previewH - im.height * baseScale) / 2 + panY) * ratio;
          outCtx.drawImage(im, dx, dy, drawW, drawH);
          let q = quality;
          let dataUrl = outCanvas.toDataURL('image/jpeg', q);
          while (dataUrl.length > 720000 && q > 0.32) {
            q = Math.max(0.3, +(q - 0.1).toFixed(2));
            dataUrl = outCanvas.toDataURL('image/jpeg', q);
          }
          finish(dataUrl);
        };

        modal.style.display = 'flex';
        drawPreview();
      };
      im.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
function pfDraw() {
  $('pfAv').src = pf.avatar || (user && user.photoURL) || FALL;
  [...$('pfGrad').children].forEach((b, k) => b.classList.toggle('on', pf.coverColor === k + 1 && !pf.cover));
}
function renderAuthProvidersInProfileModal() {
  const box = $('pfAuthProvidersBox');
  const sec = $('pfAuthProvidersSection');
  if (!box || !sec) return;
  box.replaceChildren();
  const curUser = auth.currentUser;
  if (!user || user.isLocal || !curUser) {
    sec.style.display = 'none';
    return;
  }
  sec.style.display = 'flex';
  const providers = (curUser.providerData || []).map(p => p.providerId);
  const hasGoogle = providers.includes('google.com');
  const hasPassword = providers.includes('password');
  const emailStr = curUser.email || user.email || '';

  // 1. Строка Google
  const gRow = el('div', 'auth-provider-row');
  const gLeft = el('div');
  gLeft.innerHTML = `<b>Google аккаунт</b><div class="meta" style="margin:2px 0 0">${hasGoogle ? esc(emailStr || 'Привязан') : 'Не привязан — можно подключить для быстрого входа'}</div>`;
  gRow.append(gLeft);
  if (hasGoogle) {
    gRow.append(el('span', 'auth-provider-badge', '✓ Подключено'));
  } else {
    const linkGBtn = el('button', 'btn btn-s', 'Привязать Google');
    linkGBtn.type = 'button';
    linkGBtn.style.cssText = 'padding:6px 12px;font-size:12px;white-space:nowrap';
    linkGBtn.onclick = async () => {
      try {
        const freshProvider = new GoogleAuthProvider();
        freshProvider.setCustomParameters({ prompt: 'select_account' });
        await linkWithPopup(auth.currentUser, freshProvider);
        toast('Вход через Google успешно привязан к твоему аккаунту!');
        renderAuthProvidersInProfileModal();
      } catch (e) {
        if (e.code === 'auth/credential-already-in-use' || e.code === 'auth/email-already-in-use') {
          toast('Этот Google-аккаунт уже привязан к другому профилю.', true);
        } else if (e.code !== 'auth/popup-closed-by-user') {
          toast('Не удалось привязать Google: ' + (e.message || e.code), true);
        }
      }
    };
    gRow.append(linkGBtn);
  }
  box.append(gRow);

  // 2. Строка Почта и пароль
  const pRow = el('div', 'auth-provider-row');
  pRow.style.flexDirection = 'column';
  pRow.style.alignItems = 'stretch';
  const pTop = el('div', 'row');
  pTop.style.justifyContent = 'space-between';
  const pLeft = el('div');
  pLeft.innerHTML = `<b>Почта и пароль</b><div class="meta" style="margin:2px 0 0">${hasPassword ? `Вход по почте ${esc(emailStr)} и паролю активен` : `Задай пароль для ${esc(emailStr || 'своей почты')}, чтобы входить и через Google, и по паролю`}</div>`;
  pTop.append(pLeft);
  if (hasPassword) {
    pTop.append(el('span', 'auth-provider-badge', '✓ Подключено'));
  }
  pRow.append(pTop);

  const pForm = el('div', 'row');
  pForm.style.marginTop = '6px';
  pForm.style.gap = '8px';
  let emailInp = null;
  if (!emailStr) {
    emailInp = el('input');
    emailInp.type = 'email';
    emailInp.placeholder = 'Твой Email';
    emailInp.style.flex = '1';
    pForm.append(emailInp);
  }
  const passInp = el('input');
  passInp.type = 'password';
  passInp.placeholder = hasPassword ? 'Новый пароль (мин. 6 символов)' : 'Придумай пароль для входа (мин. 6 символов)';
  passInp.style.flex = '1';
  const savePassBtn = el('button', 'btn btn-s', hasPassword ? 'Сменить пароль' : 'Привязать пароль');
  savePassBtn.type = 'button';
  savePassBtn.style.cssText = 'padding:7px 12px;font-size:12px;white-space:nowrap';
  savePassBtn.onclick = async () => {
    const targetEmail = (emailStr || emailInp?.value || '').trim();
    const newPass = (passInp.value || '').trim();
    if (!targetEmail || !targetEmail.includes('@')) return toast('Укажи корректный Email', true);
    if (newPass.length < 6) return toast('Пароль должен содержать минимум 6 символов', true);
    savePassBtn.disabled = true;
    try {
      if (hasPassword) {
        await updatePassword(auth.currentUser, newPass);
        toast('Пароль успешно обновлён! Теперь можно входить и через Google, и по почте с паролем.');
      } else {
        const cred = EmailAuthProvider.credential(targetEmail, newPass);
        await linkWithCredential(auth.currentUser, cred);
        toast('Вход по почте и паролю привязан! Теперь оба способа ведут в этот аккаунт.');
      }
      passInp.value = '';
      renderAuthProvidersInProfileModal();
    } catch (e) {
      if (e.code === 'auth/requires-recent-login') {
        toast('Для безопасности перезайди в аккаунт и сразу задай пароль.', true);
      } else if (e.code === 'auth/provider-already-linked') {
        toast('Почта и пароль уже привязаны к аккаунту.');
        renderAuthProvidersInProfileModal();
      } else {
        toast('Ошибка привязки пароля: ' + (e.message || e.code), true);
      }
    } finally {
      savePassBtn.disabled = false;
    }
  };
  pForm.append(passInp, savePassBtn);
  pRow.append(pForm);
  box.append(pRow);
}

function pfOpen() {
  pf = {...prof};
  if ($('pfAuthInfoBanner')) {
    const mailTxt = user && user.email ? `Аккаунт: ${user.email} (единая коллекция для всех привязанных способов входа)` : 'Локальный режим (без облачной синхронизации)';
    $('pfAuthInfoBanner').textContent = `🔐 ${mailTxt}`;
  }
  renderAuthProvidersInProfileModal();
  $('pfName').value = pf.name || (user && user.displayName) || '';
  $('pfRealName').value = pf.realName || '';
  $('pfBday').value = pf.bday || '';
  $('pfBio').value = pf.bio || '';
  $('pfBgAll').checked = !!pf.bgAll;
  $('pfCardStyle').value = pf.cardStyle || '';
  $('pfCustomColor').value = pf.customColor || (ACC[accIdx()] || ACC[0])[0];
  pfDraw();
  $('profModal').style.display = 'flex';
}
GRAD.forEach((g, k) => { const b = el('button', 'gsw'); b.type = 'button'; b.style.background = g; b.title = 'Цвет фона'; b.onclick = () => { pf.coverColor = k + 1; pf.cover = ''; pfDraw(); }; $('pfGrad').append(b); });
$('profEditBtn').onclick = pfOpen;
$('menuSettingsBtn').onclick = pfOpen;
if ($('quickCoverChangeBtn')) {
  $('quickCoverChangeBtn').onclick = () => {
    pf = { ...prof };
    pfTarget = 'quickCover';
    $('pfFile').value = '';
    $('pfFile').click();
  };
}
['pfAvBtn', 'pfCvBtn'].forEach(id => $(id).onclick = () => { pfTarget = id; $('pfFile').value = ''; $('pfFile').click(); });
$('pfFile').onchange = async () => {
  const f = $('pfFile').files[0]; if (!f) return;
  try {
    if (pfTarget === 'pfAvBtn') {
      const cropped = await openImageCropperModal(f, 180, 180, 0.8, 'Кадрирование аватара');
      if (cropped) pf.avatar = cropped;
    } else {
      const cropped = await openImageCropperModal(f, 1100, 320, 0.78, 'Кадрирование обложки профиля');
      if (cropped) {
        pf.cover = cropped;
        pf.coverColor = 0;
        if (pfTarget === 'quickCover') {
          prof.cover = cropped;
          prof.coverColor = 0;
          profCloud();
          profPaint();
          toast('Обложка профиля обновлена');
          return;
        }
      }
    }
    if (pf) pfDraw();
  } catch (e) { toast('Не удалось прочитать картинку — попробуй другой файл.', true); }
};
$('pfAvDel').onclick = () => { pf.avatar = ''; pfDraw(); };
$('pfCvDel').onclick = () => { pf.cover = ''; pf.coverColor = 0; pfDraw(); };
$('pfCancel').onclick = () => hideModalElement('profModal');
$('pfCustomColor').oninput = () => { pf.customColor = $('pfCustomColor').value; };
$('pfColReset').onclick = () => { pf.customColor = ''; $('pfCustomColor').value = ACC[0][0]; };

$('pfSave').onclick = () => {
  const oldName = (prof.name || (user && user.displayName) || '').trim();
  const newName = $('pfName').value.trim() || oldName || 'Пользователь';
  delete prof.like;
  delete prof.dislike;
  delete prof.mood;
  delete prof.nickHistory;
  Object.assign(prof, {
    name: newName,
    displayName: newName,
    realName: $('pfRealName').value.trim(),
    bday: $('pfBday').value.trim(),
    bio: $('pfBio').value.trim(),
    avatar: pf.avatar || '',
    cover: pf.cover || '',
    coverColor: pf.coverColor || 0,
    bgAll: $('pfBgAll').checked,
    cardStyle: $('pfCardStyle').value,
    customColor: pf.customColor || ''
  });
  profCloud();
  profPaint();
  refresh();
  hideModalElement('profModal');
  toast('Настройки профиля сохранены!');
};

const kv = (h, l, v) => { if (!v) return; const d = el('div'); d.append(el('span', null, l + ': '), document.createTextNode(v)); h.append(d); };
const LCOL = {красный: '#ef4444', оранжевый: '#f59e0b', жёлтый: '#eab308', зелёный: '#22c55e', голубой: '#38bdf8', синий: '#3b82f6', фиолетовый: '#8b5cf6', розовый: '#ec4899'};

// Явное удаление подборки с подтверждением (тайтлы остаются в коллекции, убирается только метка подборки — Этап 3 п.1)
async function deleteCollectionFolder(name) {
  if (!name || name === 'Все') return;
  const allNames = [...(prof.customLists || []), ...items.flatMap(i => i.lists || [])];
  const canonical = allNames.find(x => x && x.toLowerCase() === name.toLowerCase()) || name;
  const hit = items.filter(i => (i.lists || []).some(x => x.toLowerCase() === canonical.toLowerCase()));
  if (!(await uiConfirm(`Удалить подборку «${canonical}»?\nУберётся только сама подборка, а все тайтлы (${hit.length} шт.) останутся в твоей коллекции.`, '🗑 Удалить только подборку', true))) return;

  if (prof.listMeta) delete prof.listMeta[canonical];
  prof.customLists = (prof.customLists || []).filter(x => x.toLowerCase() !== canonical.toLowerCase());
  hit.forEach(i => {
    i.lists = (i.lists || []).filter(x => x.toLowerCase() !== canonical.toLowerCase());
  });
  profCloud();
  if (hit.length) await batchSaveItems(hit);
  if ($('listFilter') && $('listFilter').value.toLowerCase() === canonical.toLowerCase()) {
    $('listFilter').value = 'Все';
  }
  refresh();
  toast(`Подборка «${canonical}» удалена (тайтлы сохранены в коллекции)`);
}

async function listEdit(name) {
  if (!name) return;
  const allNames = [...(prof.customLists || []), ...items.flatMap(i => i.lists || [])];
  const canonical = allNames.find(x => x && x.toLowerCase() === name.toLowerCase()) || name;
  const hit = items.filter(i => (i.lists || []).some(x => x.toLowerCase() === canonical.toLowerCase()));
  prof.listMeta = prof.listMeta || {};
  const lm = prof.listMeta[canonical] || {};
  const res = await uiListDialog(canonical, lm.desc || '', lm.cn || '', LCOL);
  if (!res) return;
  const nn = res.name;
  if (!nn) {
    return deleteCollectionFolder(canonical);
  }
  delete prof.listMeta[canonical];
  prof.customLists = (prof.customLists || []).filter(x => x.toLowerCase() !== canonical.toLowerCase());
  prof.customLists.push(nn);
  prof.listMeta[nn] = {desc: res.desc, cn: res.cn};
  if (nn !== canonical && hit.length) {
    hit.forEach(i => {
      i.lists = (i.lists || []).filter(x => x.toLowerCase() !== canonical.toLowerCase());
      if (!i.lists.includes(nn)) i.lists.push(nn);
    });
    await batchSaveItems(hit);
  }
  profCloud();
  refresh();
  toast('Подборка сохранена: ' + nn);
}

// Отрисовка отдельного блока «📁 Мои подборки» (Этап 3 п.1)
function renderMyListsFolderBlock() {
  const block = $('myListsBlock'), gridEl = $('myListsFoldersGrid'), metaEl = $('myListsCountMeta'), resetB = $('resetListFilterBtn'), createTopB = $('createListTopBtn');
  if (!block || !gridEl) return;
  const activeProf = prof;
  if (createTopB) createTopB.style.display = '';

  const countsMap = new Map();
  const displayMap = new Map();
  (activeProf.customLists || []).forEach(n => {
    if (n && !displayMap.has(n.toLowerCase())) {
      displayMap.set(n.toLowerCase(), n);
      countsMap.set(n.toLowerCase(), 0);
    }
  });
  getVisibleItems().filter(i => !i.archived).forEach(i => {
    (i.lists || []).forEach(n => {
      if (!n) return;
      const k = n.toLowerCase();
      if (!displayMap.has(k)) displayMap.set(k, n);
      countsMap.set(k, (countsMap.get(k) || 0) + 1);
    });
  });

  const entries = [...displayMap.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ru'));
  const curFilter = ($('listFilter')?.value || 'Все').toLowerCase();
  if (metaEl) metaEl.textContent = `${entries.length} ${pluralRu(entries.length, 'папка', 'папки', 'папок')}`;
  if (resetB) {
    resetB.style.display = curFilter !== 'все' ? '' : 'none';
    resetB.onclick = () => { $('listFilter').value = 'Все'; render(); renderMyListsFolderBlock(); };
  }

  gridEl.replaceChildren();
  if (!entries.length) {
    gridEl.append(el('span', 'meta', 'Личных папок пока нет — нажми «＋ Подборка», чтобы создать первую.'));
    return;
  }

  entries.forEach(([lowKey, dispName]) => {
    const cnt = countsMap.get(lowKey) || 0;
    const pill = el('div', 'folder-pill' + (curFilter === lowKey ? ' active' : ''));
    const lm = (activeProf.listMeta || {})[dispName] || {};
    const dot = el('span');
    const colHex = (lm.cn && LCOL[lm.cn]) ? LCOL[lm.cn] : '#a855f7';
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${colHex};display:inline-block`;
    const lbl = el('span', null, `📁 ${dispName} (${cnt})`);
    if (lm.desc) pill.title = lm.desc;
    pill.append(dot, lbl);

    pill.onclick = () => {
      if ($('reviewItemsBox')) $('reviewItemsBox').style.display = 'none';
      $('profColWrap').style.display = '';
      $('listFilter').value = ($('listFilter').value.toLowerCase() === lowKey) ? 'Все' : lowKey;
      render();
      renderMyListsFolderBlock();
    };

    const edB = el('button', 'fp-act', '✏');
    edB.type = 'button'; edB.title = 'Переименовать / цвет подборки';
    edB.onclick = e => { e.stopPropagation(); listEdit(dispName); };
    const delB = el('button', 'fp-act del', '🗑');
    delB.type = 'button'; delB.title = 'Удалить подборку (тайтлы останутся)';
    delB.onclick = e => { e.stopPropagation(); deleteCollectionFolder(dispName); };
    pill.append(edB, delB);
    gridEl.append(pill);
  });
}

// ---- Подписи полей формы (без поля inputRecBy и inputMyNote)
const LBL = {inputCategory: 'Категория', inputStatus: 'Статус просмотра', inputTitle: 'Название (русское) *', inputTitleEn: 'Английское название', inputTitleOrig: 'Оригинальное название', inputAlt: 'Другие названия (через запятую)', inputPoster: 'Ссылка на постер (URL)', inputYear: 'Год выхода', inputRating: 'Моя оценка (1–10)', inputCompletedAt: 'Дата просмотра / завершения', inputRewatchCount: 'Счётчик пересмотров (раз)', inputExtRating: 'Внешняя оценка (AniList / TMDB)', inputAuthor: 'Автор / режиссёр', inputStudio: 'Студия', inputSource: 'Первоисточник', inputTags: 'Жанры и теги (через запятую)', inputLists: 'Подборки (через запятую)', inputEps: 'Серий или глав', inputVols: 'Томов (для манги и ранобэ)', inputDur: 'Минут на серию или фильм', inputDescription: 'Синопсис / описание'};
Object.entries(LBL).forEach(([id, t]) => { const e = $(id); if (!e) return; const w = el('div', 'fld'); e.replaceWith(w); w.append(el('label', null, t), e); });

if ($('toggleOtherTitlesBtn')) {
  $('toggleOtherTitlesBtn').onclick = () => {
    const box = $('otherTitlesBox');
    if (!box) return;
    const isHidden = box.style.display === 'none';
    box.style.display = isHidden ? 'flex' : 'none';
    $('toggleOtherTitlesBtn').textContent = (isHidden ? '▾ ' : '▸ ') + 'Другие названия (Английское, Оригинальное, Синонимы)';
  };
}

const stars = el('div', 'stars');
const starPaint = () => [...stars.children].forEach((b, k) => b.classList.toggle('on', k < +$('inputRating').value));
for (let k = 1; k <= 10; k++) { const b = el('button', null, '★'); b.type = 'button'; b.title = 'Оценка ' + k; b.onclick = () => { $('inputRating').value = +$('inputRating').value === k ? '' : k; starPaint(); draftSave(); pvDraw(); }; stars.append(b); }
$('inputRating').parentElement.append(stars);
$('inputRating').addEventListener('input', starPaint);

// ИСПРАВЛЕНИЕ ОШИБКИ №3: Критерии можно включать и выключать без возврата старых при сохранении
let criteriaActiveInForm = false;
{
  const criteriaMount = $('criteriaAnchor') || $('inputRating')?.parentElement;
  if (criteriaMount && !$('criteriaBox')) {
    const cBox = el('div', 'criteria-box'); cBox.id = 'criteriaBox';
    const toggleBtn = el('button', 'btn btn-s', '🎛 Оценить по 4 критериям (Сюжет, Рисовка, Персонажи, Музыка)');
    toggleBtn.type = 'button'; toggleBtn.id = 'criteriaToggleBtn'; toggleBtn.style.width = '100%'; toggleBtn.style.fontSize = '12px';
    const cGrid = el('div', 'criteria-grid'); cGrid.id = 'criteriaSlidersGrid'; cGrid.style.display = 'none';
    [['critStory', '📖 Сюжет и сценарий'], ['critArt', '🎨 Рисовка / Визуал'], ['critChars', '👥 Персонажи и химия'], ['critMusic', '🎵 Музыка и атмосфера']].forEach(([cid, label]) => {
      const item = el('div', 'crit-item'), top = el('div'), valB = el('b', null, '8'); valB.id = cid + 'Val';
      top.append(el('span', null, label), valB);
      const rng = el('input'); rng.type = 'range'; rng.id = cid; rng.min = '1'; rng.max = '10'; rng.step = '1'; rng.value = '8';
      rng.oninput = () => {
        valB.textContent = rng.value;
        const avg = (num($('critStory').value) + num($('critArt').value) + num($('critChars').value) + num($('critMusic').value)) / 4;
        $('inputRating').value = avg.toFixed(1).replace(/\.0$/, '');
        starPaint(); pvDraw();
      };
      item.append(top, rng); cGrid.append(item);
    });
    toggleBtn.onclick = () => {
      criteriaActiveInForm = !criteriaActiveInForm;
      cGrid.style.display = criteriaActiveInForm ? 'grid' : 'none';
      toggleBtn.textContent = criteriaActiveInForm ? '✕ Убрать оценку по 4 критериям (оставить обычную)' : '🎛 Оценить по 4 критериям (Сюжет, Рисовка, Персонажи, Музыка)';
    };
    cBox.append(toggleBtn, cGrid); criteriaMount.append(cBox);
  }
}

const CATL = {'Аниме': ['Режиссёр / автор оригинала', 'Студия'], 'Манга': ['Автор / художник', 'Издатель'], 'Ранобэ': ['Автор', 'Издатель'], 'Фильм': ['Режиссёр', 'Студия / компания'], 'Сериал': ['Создатель / режиссёр', 'Студия / канал'], 'Мультфильм': ['Режиссёр', 'Студия']};
function syncInputStatusOptionsForCategory(c) {
  const sel = $('inputStatus'); if (!sel) return;
  const cur = sel.value;
  sel.replaceChildren(...STATS.map(s => new Option(getStatusLabelForCategory(s, c), s)));
  if (STATS.includes(cur)) sel.value = cur;
}
function catFields() {
  const c = $('inputCategory').value, l = CATL[c], a = $('inputAuthor').previousSibling, t = $('inputStudio').previousSibling;
  if (l && a && t) { a.textContent = l[0]; t.textContent = l[1]; }
  const o = $('inputOngoing').parentElement; if (o) o.style.display = c === 'Фильм' ? 'none' : '';
  syncInputStatusOptionsForCategory(c);
}
$('inputCategory').addEventListener('change', catFields);

function pvDraw() {
  const b = $('pvCard'); b.replaceChildren(); const pc = el('div', 'pvp'), im = el('img'), st = el('div', 'status', $('inputStatus').value), info = el('div');
  im.alt = ''; im.src = $('posterPreview').src || FALL; st.dataset.s = $('inputStatus').value; pc.append(im, st);
  info.append(el('div', 'title', $('inputTitle').value || 'Название тайтла'), el('div', 'meta', [$('inputYear').value, $('inputCategory').value, $('inputExtRating').value ? '★ ' + $('inputExtRating').value : ''].filter(Boolean).join(' • ')), el('div', 'tg', $('inputTags').value));
  b.append(pc, info);
}
$('addModal').addEventListener('input', pvDraw); $('addModal').addEventListener('change', pvDraw); $('posterPreview').addEventListener('load', pvDraw);

let exTok = 0, exP = Promise.resolve();

function openAdd(item) {
  exTok++; exP = Promise.resolve();
  $('formTitle').textContent = item ? 'Редактировать тайтл' : 'Добавить тайтл';
  $('saveNextBtn').style.display = item ? 'none' : '';
  const i = item || {id: '', title: '', category: 'Фильм', status: 'В планах', fav: false, year: '', rating: '', extRating: '', description: '', titleEn: '', titleOrig: '', alt: '', tags: [], lists: [], author: '', studio: '', source: '', ongoing: false, eps: '', vols: '', dur: '', myNote: '', rewatchCount: 0, completedAt: 0};
  $('editId').value = i.id;
  $('inputTitle').value = i.title;
  $('inputCategory').value = i.category;
  $('inputStatus').value = STATS.includes(i.status) ? i.status : 'Просмотрено/Прочитано';
  $('inputFavHeart').checked = !!i.fav;
  $('inputYear').value = i.year || '';
  $('inputRating').value = i.rating || '';
  $('inputCompletedAt').value = i.completedAt ? new Date(i.completedAt).toISOString().slice(0, 10) : '';
  $('inputRewatchCount').value = num(i.rewatchCount) || '';
  $('inputExtRating').value = i.extRating || '';
  $('inputExtSrc').value = i.extSrc || '';
  $('inputDescription').value = i.description || '';
  $('inputTitleEn').value = i.titleEn || '';
  $('inputTitleOrig').value = i.titleOrig || '';
  $('inputAlt').value = i.alt || '';
  $('inputTags').value = (i.tags || []).join(', ');
  $('inputLists').value = (i.lists || []).join(', ');
  window._editingRecBy = i.recBy || '';
  $('inputAuthor').value = i.author || '';
  $('inputStudio').value = i.studio || '';
  $('inputSource').value = i.source || '';
  $('inputOngoing').checked = !!i.ongoing;
  $('inputKind').value = getMangaSubKind(i) || 'Манга';
  window._afPickedMeta = null;
  $('inputEps').value = i.eps || '';
  $('inputVols').value = i.vols || '';
  $('inputDur').value = i.dur || '';
  if ($('otherTitlesBox') && $('toggleOtherTitlesBtn')) {
    const hasExtraNames = Boolean((i.titleEn || '').trim() || (i.titleOrig || '').trim() || (i.alt || '').trim());
    $('otherTitlesBox').style.display = hasExtraNames ? 'flex' : 'none';
    $('toggleOtherTitlesBtn').textContent = (hasExtraNames ? '▾ ' : '▸ ') + 'Другие названия (Английское, Оригинальное, Синонимы)';
  }
  setAddFormManualMode(true, false);

  const c = i.criteria || null;
  criteriaActiveInForm = !!c;
  if ($('criteriaSlidersGrid')) {
    $('criteriaSlidersGrid').style.display = criteriaActiveInForm ? 'grid' : 'none';
    if ($('criteriaToggleBtn')) $('criteriaToggleBtn').textContent = criteriaActiveInForm ? '✕ Убрать оценку по 4 критериям (оставить обычную)' : '🎛 Оценить по 4 критериям (Сюжет, Рисовка, Персонажи, Музыка)';
    [['critStory', 'story'], ['critArt', 'art'], ['critChars', 'chars'], ['critMusic', 'music']].forEach(([id, k]) => {
      const v = (c && c[k]) || (num(i.rating) ? Math.round(num(i.rating)) : 8);
      if ($(id)) $(id).value = v;
      if ($(id + 'Val')) $(id + 'Val').textContent = v;
    });
  }

  setPoster(i.poster);
  afHint();
  starPaint();
  catFields();
  pvDraw();
  $('addModal').style.display = 'flex';
}

// ИСПРАВЛЕНИЕ ОШИБКИ №4: Черновик теперь сохраняет и восстанавливает ссылку на постер (posterValue)!
const DF = Object.keys(LBL).concat('inputExtSrc');
const draftClear = () => { try { localStorage.removeItem('draft'); } catch (e) {} };
function draftSave() {
  if ($('editId').value) return;
  const d = {};
  DF.forEach(k => { if ($(k)) { const v = $(k).value; if (v && v.length < 3000) d[k] = v; } });
  if (posterValue && !posterValue.startsWith('data:') && posterValue.length < 4000) d._posterValue = posterValue;
  if (!d.inputTitle) return;
  try { localStorage.setItem('draft', JSON.stringify(d)); } catch (e) {}
}
function draftRestore() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem('draft') || 'null'); } catch (e) {}
  if (!d || !d.inputTitle) return;
  DF.forEach(k => { if (d[k] != null && $(k)) $(k).value = d[k]; });
  if (d._posterValue) setPoster(d._posterValue);
  starPaint(); catFields(); pvDraw();
  toast('Восстановил несохранённый черновик (включая постер)', false, {label: 'Очистить', fn: () => { draftClear(); openAdd(null); }});
}
$('addModal').addEventListener('input', draftSave);
$('addModal').addEventListener('change', draftSave);
$('closeAddBtn').addEventListener('click', draftClear);
$('openModalBtn').onclick = () => { openAdd(null); draftRestore(); };

function setAddFormManualMode() {
  const manEl = $('manualTitlesSec');
  if (manEl) manEl.style.display = 'flex';
}

['dragover', 'drop'].forEach(ev => $('posterPreview').addEventListener(ev, async e => {
  e.preventDefault(); if (ev !== 'drop') return;
  const f = e.dataTransfer && e.dataTransfer.files[0];
  if (!f || !f.type.startsWith('image/')) return toast('Перетащи сюда картинку (jpg, png, webp)', true);
  try {
    const d = await imgData(f, 400, 600, 0.82);
    setPoster(d); draftSave();
    toast(`Постер загружен: ${Math.round(d.length * 0.75 / 1024)} КБ`);
  } catch (e2) { toast('Не удалось прочитать картинку', true); }
}));

let saving = false, again = false;
$('saveNextBtn').onclick = () => { again = true; $('saveItemBtn').click(); };
$('saveItemBtn').onclick = async () => {
  if (saving) return;
  saving = true;
  try {
    await Promise.race([exP.catch(() => {}), new Promise(r => setTimeout(r, 5000))]);
    const title = $('inputTitle').value.trim(), year = $('inputYear').value, editId = $('editId').value;
    if (!title) return toast('Название обязательно!');
    if (year && (year < 1900 || year > 2100)) return toast('Год должен быть между 1900 и 2100');
    const category = $('inputCategory').value;
    const picked = window._afPickedMeta || {};
    const candidateCheck = {
      title,
      titleEn: $('inputTitleEn').value.trim(),
      titleOrig: $('inputTitleOrig').value.trim(),
      alt: $('inputAlt').value.trim(),
      year,
      category,
      aniId: picked.aniId || 0,
      mal: picked.mal || 0,
      tmdb: picked.tmdb || ''
    };
    if (!editId) {
      const dupHit = findDuplicateMatch(candidateCheck, items);
      if (dupHit && !(await uiConfirm(`Тайтл «${dupHit.title}» (${dupHit.year || '—'}, ${dupHit.status}) уже есть в твоей коллекции.\nВсё равно добавить дубликат?`, 'Всё равно добавить'))) return;
    }

    const statusVal = $('inputStatus').value;
    const dateInputVal = $('inputCompletedAt').value;
    const isDoneSt = (statusVal === 'Просмотрено/Прочитано' || statusVal === 'Пересматриваю');
    let completedAtTs = dateInputVal ? new Date(dateInputVal + 'T12:00:00').getTime() : 0;
    if (!completedAtTs && isDoneSt) completedAtTs = Date.now();
    if (!isDoneSt && !dateInputVal) completedAtTs = 0;

    const oldRec = editId ? items.find(x => x.id === Number(editId)) : null;
    const it = {
      id: editId ? Number(editId) : newId(),
      addedAt: oldRec?.addedAt || (editId ? born(oldRec || {}) : Date.now()) || Date.now(),
      kind: 'title',
      title, category,
      subKind: category === 'Манга' ? $('inputKind').value : '',
      status: statusVal,
      needsReview: false,
      fav: $('inputFavHeart').checked,
      poster: posterValue,
      year,
      rating: $('inputRating').value,
      completedAt: completedAtTs,
      rewatchCount: +$('inputRewatchCount').value || 0,
      extRating: $('inputExtRating').value,
      extSrc: $('inputExtSrc').value,
      description: $('inputDescription').value.trim(),
      titleEn: $('inputTitleEn').value.trim(),
      titleOrig: $('inputTitleOrig').value.trim(),
      alt: $('inputAlt').value.trim(),
      author: $('inputAuthor').value.trim(),
      studio: $('inputStudio').value.trim(),
      source: $('inputSource').value,
      ongoing: $('inputOngoing').checked,
      tags: parseTags($('inputTags').value),
      lists: parseTags($('inputLists').value),
      recBy: window._editingRecBy || picked.recBy || '',
      eps: +$('inputEps').value || 0,
      vols: +$('inputVols').value || 0,
      dur: +$('inputDur').value || 0,
      aniId: picked.aniId || 0,
      mal: picked.mal || 0,
      tmdb: picked.tmdb || '',
      format: picked.format || '',
      isAdult: Boolean(picked.isAdult)
    };

    if (criteriaActiveInForm) {
      it.criteria = {
        story: num($('critStory').value),
        art: num($('critArt').value),
        chars: num($('critChars').value),
        music: num($('critMusic').value)
      };
    } else {
      it.criteria = null;
    }

    if (picked.trailerId) it.trailerId = picked.trailerId;
    const old = items.find(x => x.id === it.id);
    if (old) {
      ['pin', 'archived', 'seasons', 'format', 'aniId', 'mal', 'tmdb', 'imdbId', 'vols', 'trailerId', 'badgeCharImg', 'badgeCharName', '_docId', 'importBatchId', 'importSource', 'isAdult'].forEach(k => {
        if (old[k] && !it[k]) it[k] = old[k];
      });
    } else if (user && user.uid) {
      it._docId = user.uid + '_' + it.id;
    }

    const k = items.findIndex(x => String(x.id) === String(it.id));
    if (k > -1) items[k] = it; else items.push(it);
    if (editId) {
      refresh({ itemId: it.id });
      const returnTarget = window._editReturnTarget || 'detail';
      window._editReturnTarget = '';
      closeAll(true);
      if (returnTarget === 'fullPage' && $('titlePageView')?.style.display === 'block' && typeof openFullTitlePage === 'function') {
        openFullTitlePage(it, true);
      } else {
        openDetail(it.id);
      }
    } else {
      refresh();
      closeAll(again ? true : false);
    }
    cloudSave(it); profCloud(true); draftClear();
    if (again && !editId) { toast('Добавлено: ' + it.title); openAdd(null); }
  } finally { saving = false; again = false; }
};

// ИСПРАВЛЕНИЕ ОШИБКИ №2: Итоги года и Капсула времени используют дату просмотра completedAt, если она есть, иначе дату добавления
const born = i => { const v = Number(i.id); return v > 1e14 ? v / 1000 : v > 1e11 && v < 1e13 ? v : 0; };
const itemActionDate = i => Number(i.completedAt) || born(i) || Date.now();
const toList = () => { $('profColWrap').style.display = ''; $('searchInput').scrollIntoView({behavior: 'smooth'}); };

function detailExtra(id) {
  const i = items.find(x => x.id === id); if (!i) return;
  const box = $('detailExtra'); if (!box) return;
  box.replaceChildren();
  const btn = (t, fn) => { const b = el('button', 'btn btn-s', t); b.type = 'button'; b.onclick = fn; box.append(b); };
  {
    btn(i.pin ? '📌 Открепить' : '📌 Закрепить', () => { i.pin = !i.pin; cloudSave(i); refresh({ onlyList: true }); detailExtra(id); });
    btn(i.archived ? '📤 Вернуть из архива' : '📦 В архив', () => {
      i.archived = !i.archived; cloudSave(i); refresh(); closeAll();
      toast(i.archived ? 'Убрано в архив (кнопка «📦 Архив» в фильтрах)' : 'Возвращено из архива');
    });
    btn('📁＋ В подборку', () => {
      openAddToCollectionModal(i, () => {
        if (String(curId) === String(id)) openDetail(id);
      });
    });
  }

  const simB = el('button', 'btn btn-s', '🔗 Похожие');
  simB.type = 'button';
  const simContainer = el('div', 'chips');
  simContainer.style.width = '100%';
  simB.onclick = async () => {
    simB.disabled = true;
    simB.textContent = '⏳ Ищу похожие…';
    await loadSimilarTitlesIntoBox(i, simContainer);
    simB.textContent = '🔗 Похожие ✓';
  };
  box.append(simB);

  const a = el('a', 'btn btn-s', '📖 В Википедии');
  a.href = 'https://ru.wikipedia.org/w/index.php?search=' + encodeURIComponent(i.title);
  a.target = '_blank'; a.rel = 'noopener';
  box.append(a);
  if (i.recBy) box.append(el('span', 'meta', 'Посоветовал(а): ' + i.recBy));
  box.append(simContainer);
}

function pluralRu(n, one, two, five) {
  const abs = Math.abs(n) % 100, n1 = abs % 10;
  if (abs > 10 && abs < 20) return five;
  if (n1 > 1 && n1 < 5) return two;
  return n1 === 1 ? one : five;
}

function openDetail(id) {
  const i = getVisibleItems().find(x => x.id === id) || items.find(x => x.id === id);
  if (!i) return;
  curId = id;
  applyPosterImg($('detailPoster'), i.poster, i);
  $('detailTitle').textContent = i.title;
  const detStLabel = getStatusLabelForCategory(i.status, i.category);
  $('detailStatus').textContent = detStLabel + (i.fav ? ' · ❤ Любимое' : '');
  $('detailStatus').dataset.s = i.status;
  const addDateStr = formatAddedDateRu(i);
  const compDateStr = (addDateStr ? ` • Добавлено в «${detStLabel}»: ${addDateStr}` : '') + (i.completedAt ? ' • Завершено ' + new Date(i.completedAt).toLocaleDateString('ru-RU') : '');
  $('detailMeta').textContent = `${catLabel(i)} • ${i.year || 'Год не указан'}${i.ongoing ? ' • ● Онгоинг' : ''}${compDateStr}${i.eps ? ' • ' + i.eps + (i.category === 'Манга' || i.category === 'Ранобэ' ? ' гл.' : ' эп.') : ''}${i.vols ? ' • ' + i.vols + ' ' + pluralRu(i.vols, 'том', 'тома', 'томов') : ''}${i.dur ? ' • ' + i.dur + ' мин' : ''}`;
  $('detailNames').textContent = [i.titleEn, i.titleOrig, i.alt].filter(Boolean).join(' / ');

  const cr = $('detailCredits'); cr.replaceChildren();
  [['Автор', 'author'], ['Студия', 'studio'], ['Источник', 'source']].forEach(([lab, k]) => {
    const v = (k === 'source' ? [i.source] : (i[k] || '').split(',').map(x => x.trim())).filter(Boolean);
    if (!v.length) return;
    const row = el('div', 'cr'); row.append(el('span', 'meta', lab + ':'));
    v.forEach(x => { const c = el('button', 'chip', x); c.onclick = () => { closeAll(); xf = {k, v: x}; render(); toList(); }; row.append(c); });
    cr.append(row);
  });

  let ratingTxt = `★ Оценка: ${i.rating ? i.rating + '/10' : '-/10'}${i.extRating ? ' | Внешняя оценка: ' + i.extRating + (i.extSrc ? ' (' + i.extSrc + ')' : '') : ''}`;
  if (i.criteria) {
    const c = i.criteria;
    ratingTxt += ` · [Сюжет: ${c.story} | Рисовка: ${c.art} | Герои: ${c.chars} | Музыка: ${c.music}]`;
  }
  $('detailRating').textContent = ratingTxt;

  const tg = $('detailTags'); tg.replaceChildren();
  (i.tags || []).forEach(t => { const c = el('button', 'chip', t); c.onclick = () => { closeAll(); $('tagFilter').value = t.toLowerCase(); render(); toList(); }; tg.append(c); });
  (i.lists || []).forEach(listName => {
    const wrap = el('span', 'chip'); wrap.style.display = 'inline-flex'; wrap.style.gap = '6px';
    const lbl = el('span', null, '📁 ' + listName); lbl.onclick = () => { closeAll(); $('listFilter').value = listName.toLowerCase(); render(); toList(); };
    wrap.append(lbl);
    {
      const delX = el('b', null, '✕'); delX.title = 'Убрать из подборки';
      delX.onclick = e => { e.stopPropagation(); i.lists = (i.lists || []).filter(x => x.toLowerCase() !== listName.toLowerCase()); cloudSave(i); refresh(); openDetail(id); toast(`Убрано из «${listName}»`); };
      wrap.append(delX);
    }
    tg.append(wrap);
  });

  const dKeyDetail = 'd_' + getRuCacheKey(i);
  const resolvedDetDesc = (typeof KirokuEngine !== 'undefined' && KirokuEngine.resolveBestTitleDescription)
    ? KirokuEngine.resolveBestTitleDescription(i, null, RUC[dKeyDetail] || '')
    : (i.description || i.desc || RUC[dKeyDetail] || '');
  if (resolvedDetDesc && !i.description) {
    i.description = resolvedDetDesc;
    saveLocalItems();
  }
  $('detailDescription').textContent = resolvedDetDesc || (isManualItemEditable(i) ? 'Описание отсутствует.' : 'Загружаю описание…');
  if (!resolvedDetDesc && !isManualItemEditable(i)) {
    (async () => {
      try {
        const probe = { ...i, desc: '' };
        if (i.tmdb && typeof tmdbInfo === 'function') {
          const info = await tmdbInfo(probe);
          if (info?.description) probe.desc = info.description;
        } else if (i.mal || i.aniId || SHK[i.category]) {
          await ruFull(probe);
        }
        const fetched = String(probe.desc || probe.description || '').trim();
        if (fetched) {
          i.description = fetched;
          if (hasRu(fetched)) RUC[dKeyDetail] = fetched;
          saveLocalItems();
          if (String(curId) === String(id) && $('detailDescription')) $('detailDescription').textContent = fetched;
          updateSingleItemCardInDOM(i.id);
        } else if (String(curId) === String(id) && $('detailDescription')) {
          $('detailDescription').textContent = 'Описание отсутствует.';
        }
      } catch (e) {
        if (String(curId) === String(id) && $('detailDescription')) $('detailDescription').textContent = 'Описание отсутствует.';
      }
    })();
  } else if (resolvedDetDesc && !hasRu(resolvedDetDesc)) {
    ruTranslate(resolvedDetDesc).then(tr => {
      if (tr && hasRu(tr)) {
        i.description = tr;
        RUC[dKeyDetail] = tr;
        if (String(curId) === String(id) && $('detailDescription')) $('detailDescription').textContent = tr;
        saveLocalItems();
      }
    }).catch(() => {});
  }

  const ds = $('detailStatusSel');
  ds.style.display = '';
  ds.replaceChildren(...STATS.map(x => new Option(getStatusLabelForCategory(x, i.category), x)));
  ds.value = STATS.includes(i.status) ? i.status : 'Просмотрено/Прочитано';
  ds.onchange = () => {
    i.status = ds.value;
    i.needsReview = false;
    if (i.status === 'Просмотрено/Прочитано' && !i.completedAt) i.completedAt = Date.now();
    else if (i.status === 'В планах') i.completedAt = 0;
    const lbl = getStatusLabelForCategory(i.status, i.category);
    $('detailStatus').textContent = lbl + (i.fav ? ' · ❤ Любимое' : '');
    $('detailStatus').dataset.s = i.status;
    cloudSave(i); profCloud(true); refresh({ itemId: i.id }); toast('Статус изменён: ' + lbl);
  };

  // Отдельная кнопка-сердечко «Любимое» (при добавлении в Любимое тайтл автоматически становится просмотренным/прочитанным)
  const favB = $('detailFavToggleBtn');
  if (favB) {
    favB.style.display = '';
    favB.textContent = i.fav ? '❤ В любимом' : '🤍 В любимое';
    favB.onclick = () => {
      i.fav = !i.fav;
      if (i.fav && i.status !== 'Просмотрено/Прочитано' && i.status !== 'Пересматриваю') {
        i.status = 'Просмотрено/Прочитано';
        if (!i.completedAt) i.completedAt = Date.now();
      }
      cloudSave(i); refresh({ itemId: i.id }); openDetail(id);
      toast(i.fav ? `Добавлено в «❤ Любимое» и «${getStatusLabelForCategory(i.status, i.category)}»!` : 'Убрано из «❤ Любимое»');
    };
  }

  // Счётчик повторных просмотров (+1, -1, откат и возврат прежнего статуса)
  const rewB = $('detailRewatchPlusBtn');
  const rewMinB = $('detailRewatchMinusBtn');
  if (rewB) {
    rewB.style.display = '';
    rewB.textContent = `🔁 Пересмотрено: ${num(i.rewatchCount)} раз (+1)`;
    rewB.onclick = () => {
      const prevCount = num(i.rewatchCount);
      const prevSt = i.status;
      i.rewatchCount = prevCount + 1;
      if (i.status !== 'Просмотрено/Прочитано' && i.status !== 'Пересматриваю') {
        i.prevStBeforeRewatch = prevSt;
        i.status = 'Просмотрено/Прочитано';
        if (!i.completedAt) i.completedAt = Date.now();
      }
      cloudSave(i); refresh({ itemId: i.id }); openDetail(id);
      toast(`Пересмотров: ${i.rewatchCount}`, false, {
        label: '↩ Отменить',
        fn: () => {
          i.rewatchCount = prevCount;
          if (i.prevStBeforeRewatch) { i.status = i.prevStBeforeRewatch; delete i.prevStBeforeRewatch; }
          cloudSave(i); refresh({ itemId: i.id }); openDetail(id);
        }
      });
    };
  }
  if (rewMinB) {
    rewMinB.style.display = num(i.rewatchCount) > 0 ? '' : 'none';
    rewMinB.onclick = () => {
      const prevCount = num(i.rewatchCount);
      if (prevCount <= 0) return;
      i.rewatchCount = prevCount - 1;
      cloudSave(i); refresh({ itemId: i.id }); openDetail(id);
      toast(`Пересмотров уменьшено: ${i.rewatchCount}`);
    };
  }

  $('deleteItemBtn').style.display = '';
  const isManualItem = isManualItemEditable(i);
  $('editItemBtn').style.display = isManualItem ? '' : 'none';

  detailExtra(id);
  const charsSec = $('detailCharsSec');
  if (charsSec) {
    charsSec.style.display = 'block';
    const hintBtn = el('button', 'chars-fullpage-hint');
    hintBtn.type = 'button';
    hintBtn.innerHTML = '<span>👤 Персонажи, сэйю, трейлер и франшиза доступны на полной странице тайтла</span><span>Открыть →</span>';
    hintBtn.onclick = () => {
      if (typeof openFullTitlePage === 'function') openFullTitlePage(i);
    };
    charsSec.replaceChildren(hintBtn);
  }
  $('detailModal').style.display = 'flex';
}



$('editItemBtn').onclick = () => {
  const i = items.find(x => String(x.id) === String(curId));
  if (!i || !isManualItemEditable(i)) return;
  window._editReturnTarget = 'detail';
  closeAll(true);
  openAdd(i);
};
$('deleteItemBtn').onclick = async () => {
  if (!(await uiConfirm('Точно удалить этот тайтл из коллекции?', 'Удалить', true))) return;
  const id = curId; closeAll(); removeItem(id, true);
};