// === ЧАСТЬ 1: Ядро, облако Firebase, авторизация, темы, профиль и карточки коллекции (app-core.js) ===
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
let _wsrvDown = false;

// ИСПРАВЛЕНИЕ БАГА №6 (Shikimori постеры): прокси для обхода блокировки картинок с shikimori.one без VPN
function safePosterUrl(u) {
  if (!u || typeof u !== 'string') return FALL;
  const s = u.trim();
  if (!s) return FALL;
  if (s.startsWith('data:image/')) return s;
  if (!/^https?:\/\//i.test(s)) return FALL;
  if (!_wsrvDown && /^https?:\/\/(shikimori\.(one|org|me|io)|desu\.shikimori\.one)/i.test(s)) {
    return 'https://wsrv.nl/?url=' + encodeURIComponent(s);
  }
  return s;
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
const auth = getAuth(app), db = getFirestore(app), provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const $ = id => document.getElementById(id);
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };

// ---- Диалоги внутри страницы
let dlgDone = null;
function dlgOpen(build, okLabel, danger, getVal) {
  return new Promise(res => {
    if (dlgDone) dlgDone(null);
    const m = $('dlgModal'), done = v => { if (dlgDone !== done) return; dlgDone = null; m.style.display = 'none'; res(v); };
    dlgDone = done; build();
    const ok = $('dlgOk'); ok.textContent = okLabel; ok.className = 'btn' + (danger ? ' btn-d' : '');
    ok.onclick = () => done(getVal()); $('dlgCancel').onclick = () => done(null);
    m.style.display = 'flex';
  });
}
const uiConfirm = (msg, okLabel = 'Продолжить', danger = false) => dlgOpen(() => { $('dlgTitle').textContent = 'Подтверждение'; $('dlgText').textContent = msg; $('dlgBody').replaceChildren(); }, okLabel, danger, () => true).then(v => v === true);
function uiPrompt(title, def = '', ph = '') {
  let inp; return dlgOpen(() => { inp = el('input'); inp.value = def; inp.placeholder = ph; $('dlgTitle').textContent = title; $('dlgText').textContent = ''; $('dlgBody').replaceChildren(inp); inp.onkeydown = e => { if (e.key === 'Enter') $('dlgOk').click(); }; setTimeout(() => inp.focus(), 40); }, 'Сохранить', false, () => inp.value);
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
const STATS = ['В планах','Смотрю/Читаю','Просмотрено/Прочитано','Пересматриваю','Брошено'];
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

let user = null, items = [], loaded = false, cat = 'Всё', kind = 'Все', curId = null, unsub = null, posterValue = '', view = localStorage.getItem('view') || 'grid', ongOnly = false, xf = null, lastList = [], afTok = 0;
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

// НЕ удаляем prof.avatar и prof.cover при сохранении профиля, чтобы аватарка и фон никогда не сбрасывались при перезагрузке!
const prepareProfForLocal = pObj => {
  const copy = { ...(pObj || {}) };
  if (Array.isArray(copy.favChars)) {
    copy.favChars = copy.favChars.map(fc => isBase64DataUrl(fc?.img) ? { ...fc, img: '' } : fc);
  }
  return copy;
};

const saveLocalItems = (forceEmpty = false) => {
  if (!loaded) return;
  const uidKey = getUidStorageKey('items');
  const slimItems = items.map(stripItemBase64ForLocal);
  const safetyKey = getUidStorageKey('safetyBackup');

  if (!forceEmpty && slimItems.length === 0) {
    const existingLocal = loadLocalItems();
    if (existingLocal.length > 0) return;
  }

  idbVault.set(uidKey, slimItems);
  if (user && user.isLocal) idbVault.set('localItems', slimItems);

  if (slimItems.length > 0) {
    idbVault.get(safetyKey).then(prevSafety => {
      if (!Array.isArray(prevSafety) || slimItems.length >= prevSafety.length) {
        idbVault.set(safetyKey, slimItems);
        try { localStorage.setItem(safetyKey, JSON.stringify(slimItems)); } catch (e) {}
      }
    });
  }

  try {
    const json = JSON.stringify(slimItems);
    localStorage.setItem(uidKey, json);
    if (user && user.isLocal) localStorage.setItem('localItems', json);
  } catch (e) {
    try {
      localStorage.removeItem('ruCache');
      const compactItems = slimItems.map(x => ({ ...x, description: (x.description || '').slice(0, 180) }));
      const compactJson = JSON.stringify(compactItems);
      localStorage.setItem(uidKey, compactJson);
      if (user && user.isLocal) localStorage.setItem('localItems', compactJson);
    } catch (e2) {}
  }
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

const profSaveLocal = () => {
  const uid = (user && user.uid) || 'local_user';
  const prepared = prepareProfForLocal(prof);
  idbVault.set('prof_' + uid, prepared);
  if (uid === 'local_user') idbVault.set('prof', prepared);
  try {
    const json = JSON.stringify(prepared);
    localStorage.setItem('prof_' + uid, json);
    if (uid === 'local_user') localStorage.setItem('prof', json);
  } catch (e) {
    try {
      localStorage.removeItem('ruCache');
      localStorage.setItem('prof_' + uid, JSON.stringify(prepared));
    } catch (e2) {}
  }
};

let pend = 0, syncBad = false, cloudAccessError = '';
const updateAccountBadge = () => {
  const b = $('accountBadge');
  if (!b) return;
  if (!user) { b.textContent = ''; return; }
  b.textContent = user.isLocal
    ? '💻 Локальный режим'
    : `👤 ${user.email || prof.name || user.uid.slice(0, 8)}`;
};
const setSync = () => {
  updateAccountBadge();
  const e = $('syncState');
  if (!e) return;
  if (user && user.isLocal) { e.className = 'sync'; e.textContent = '💾 Локальный режим'; return; }
  if (!navigator.onLine) { e.className = 'sync err'; e.textContent = '⚠ Нет подключения'; }
  else if (cloudAccessError) { e.className = 'sync err'; e.textContent = '⚠ Нет доступа к облаку: ' + cloudAccessError; }
  else if (pend) { e.className = 'sync sav'; e.textContent = '⏳ Сохранение...'; }
  else if (syncBad) { e.className = 'sync err'; e.textContent = '⚠ Ошибка сохранения'; }
  else { e.className = 'sync'; e.textContent = '☁ Синхронизировано'; }
};
const track = p => {
  pend++; setSync();
  return p.then(res => {
    pend--;
    if (!pend) { syncBad = false; cloudAccessError = ''; }
    setSync();
    return res;
  }, e => {
    pend--;
    syncBad = true;
    cloudAccessError = e?.code || e?.message || 'error';
    setSync();
    throw e;
  });
};
addEventListener('online', setSync); addEventListener('offline', setSync);

// Гарантируем, что ID документа тайтла никогда не начинается с зарезервированных префиксов prof_, wall_, rec_, bans_, fr_, dm_
const getCloudDocId = item => {
  let raw = item._docId ? String(item._docId) : ((user && user.uid ? user.uid + '_' : 'item_') + String(item.id));
  if (/^(prof_|wall_|rec_|rep_|ban_|bans_|fr_|dm_)/i.test(raw)) {
    raw = (user && user.uid ? user.uid + '_' : 'item_') + String(item.id || Date.now());
    item._docId = raw;
  }
  return raw;
};

// Очищаем служебные поля (_knownStatusFromImport, lastLinkAttempt) перед сохранением документа в Firestore (Этап 1 п.11)
const prepareTitleForCloud = (it, uid) => {
  fix(it);
  const docId = getCloudDocId(it);
  const cleanCopy = { ...it };
  delete cleanCopy._knownStatusFromImport;
  delete cleanCopy.lastLinkAttempt;
  return {
    docId,
    payload: {
      ...cleanCopy,
      _docId: docId,
      kind: 'title',
      userId: uid
    }
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
  if (cleanCloud && orphanDocIdsToDelete.length && user && !user.isLocal && auth.currentUser) {
    orphanDocIdsToDelete.forEach(dId => {
      deleteDoc(doc(db, 'items', dId)).catch(() => {});
    });
  }
  return [...byId.values()];
}

const profCloud = (onlyHeartbeat = false) => {
  if (!user) return;
  if (!prof.createdAt) {
    const fbTime = !user.isLocal && user.metadata?.creationTime ? new Date(user.metadata.creationTime).getTime() : 0;
    prof.createdAt = fbTime || Date.now();
  }
  prof.displayName = prof.name || user.displayName || (user.email ? user.email.split('@')[0] : 'Моя коллекция');
  if (!prof.name) prof.name = prof.displayName;
  prof.lastVisit = Date.now();

  const watchingNow = items
    .filter(i => !i.archived && i.status === 'Смотрю/Читаю')
    .sort((a, b) => (b.updatedAt || b.id) - (a.updatedAt || a.id))[0];
  const safeNwPoster = watchingNow && watchingNow.poster && !String(watchingNow.poster).startsWith('data:') ? watchingNow.poster : '';
  prof.nowWatching = watchingNow ? { id: watchingNow.id, title: watchingNow.title, poster: safeNwPoster, category: watchingNow.category } : null;

  profSaveLocal();
  if (!user.isLocal && auth.currentUser && !onlyHeartbeat) {
    const safeProf = {...prof};
    delete safeProf.email;
    delete safeProf.ownerEmail;
    delete safeProf.statsSummary;
    delete safeProf.friends;
    // Если облачный профиль ещё в процессе первичной загрузки, не затираем аватар и обложку пустыми полями
    if (!_cloudProfLoaded) {
      if (!safeProf.avatar) delete safeProf.avatar;
      if (!safeProf.cover) delete safeProf.cover;
      if (!safeProf.coverColor) delete safeProf.coverColor;
    }
    if (safeProf.cover && String(safeProf.cover).startsWith('data:') && String(safeProf.cover).length > 750000) {
      delete safeProf.cover;
      toast('Обложка слишком большая для облака (>750 КБ) и сохранена только локально. Выбери изображение меньшего размера.', true);
    }
    track(setDoc(doc(db, 'items', 'prof_' + user.uid), {
      ...safeProf,
      kind: 'profile',
      isProfile: true,
      userId: user.uid
    }, { merge: true })).catch(e => {
      toast('Ошибка сохранения профиля: ' + e.message, true);
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
  saveLocalItems();
  if (!user || user.isLocal || !auth.currentUser) { setSync(); return Promise.resolve(); }
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
      const { payload } = prepareTitleForCloud(latestItem, user.uid);
      const prevChain = _cloudSaveChains.get(docId) || Promise.resolve();
      const nextChain = prevChain
        .catch(() => {})
        .then(() => track(setDoc(doc(db, 'items', docId), payload)))
        .catch(e => toast('Не удалось сохранить в облако: ' + e.message, true))
        .finally(() => {
          if (_cloudSaveChains.get(docId) === nextChain) _cloudSaveChains.delete(docId);
          resolve();
        });
      _cloudSaveChains.set(docId, nextChain);
    }, 220);
    _cloudSaveTimers.set(docId, { timer, resolve });
  });
};

function startLocalMode(msg) {
  if (unsub) { unsub(); unsub = null; }
  if (typeof resetSessionMemoryState === 'function') resetSessionMemoryState();
  try { localStorage.setItem('useLocalMode', '1'); } catch (e) {}
  resetProfObjectToDefault();
  try { Object.assign(prof, JSON.parse(localStorage.getItem('prof_local_user') || localStorage.getItem('prof') || '{}')); } catch (e) {}
  user = { uid: 'local_user', isLocal: true, displayName: prof.name || 'Моя коллекция', email: '', photoURL: prof.avatar || '', metadata: { creationTime: new Date().toISOString() } };
  $('authScreen').style.display = 'none'; $('appScreen').style.display = 'block';
  $('hdrAvatar').src = user.photoURL || FALL; $('profName').textContent = user.displayName; $('avatar').src = user.photoURL || FALL;
  items = loadLocalItems('local_user'); loaded = true; setSync(); refresh(); profPaint();
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
    const localArr = loadLocalItems('local_user');
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
    await batchSaveItems(allToSave);

    toMerge.forEach(m => {
      const idx = items.findIndex(x => x.id === m.id);
      if (idx > -1) items[idx] = m;
    });
    items.push(...preparedInsert);
    items = deduplicateListByIdAndCleanupCloud(items, false);
    saveLocalItems();
    localStorage.removeItem('localItems');
    localStorage.removeItem('items_local_user');
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

// Одноразовая миграция старых документов в Firestore (Этап 1 п.6 + Этап 4 п.1)
async function migrateOldDocsToKindSchema(manual = false) {
  if (!user || user.isLocal || !auth.currentUser) {
    if (manual) toast('Миграция доступна только при входе в облачный аккаунт', true);
    return;
  }
  try {
    const ops = [];
    let legacyFriendsToConvert = [];
    const ownSnap = await getDocs(query(collection(db, 'items'), where('userId', '==', user.uid)));
    ownSnap.docs.forEach(d => {
      const raw = d.data();
      if (raw.isProfile || d.id === 'prof_' + user.uid) {
        if (Array.isArray(raw.friends) && raw.friends.length) {
          legacyFriendsToConvert = raw.friends.filter(Boolean);
        }
        if (raw.kind !== 'profile' || 'statsSummary' in raw || 'friends' in raw) {
          const clean = { ...raw, kind: 'profile', isProfile: true, userId: user.uid };
          delete clean.statsSummary;
          delete clean.email;
          delete clean.ownerEmail;
          delete clean.friends;
          ops.push(['set', d.id, clean]);
        }
      } else if (raw.isReport || raw.kind === 'report') {
        ops.push(['del', d.id, null]);
      } else if (!raw.isWallComment && !raw.isRecInbox && !raw.secretCredKey && raw.kind !== 'friendReq' && raw.kind !== 'dm') {
        const subK = raw.category === 'Манхва' ? 'Манхва' : (raw.subKind || (MANGA_SUBKINDS.includes(raw.kind) ? raw.kind : (raw.category === 'Манга' ? 'Манга' : '')));
        if (raw.kind !== 'title' || (subK && raw.subKind !== subK) || '_knownStatusFromImport' in raw) {
          const updated = {
            ...raw,
            category: raw.category === 'Манхва' ? 'Манга' : raw.category,
            subKind: subK,
            kind: 'title',
            userId: user.uid
          };
          delete updated._knownStatusFromImport;
          delete updated.lastLinkAttempt;
          ops.push(['set', d.id, updated]);
        }
      }
    });

    if (!ops.length) {
      try { localStorage.setItem('schemaMigratedV3_' + user.uid, '1'); } catch (e) {}
      if (manual) toast('Все твои записи уже соответствуют актуальной схеме облака ✓');
      return;
    }

    if (manual) toast(`Обновляю записи под новую схему: ${ops.length} шт.…`);
    for (let i = 0; i < ops.length; i += 350) {
      const b = writeBatch(db);
      ops.slice(i, i + 350).forEach(([type, id, data]) => {
        if (type === 'del') b.delete(doc(db, 'items', id));
        else b.set(doc(db, 'items', id), data);
      });
      await track(b.commit());
    }
    try { localStorage.setItem('schemaMigratedV3_' + user.uid, '1'); } catch (e) {}
    toast(`Миграция завершена: обновлено ${ops.length} документов ✓`);
  } catch (e) {
    cloudAccessError = e?.code || e?.message || 'migration-error';
    syncBad = true;
    setSync();
    toast('Ошибка миграции старых записей: ' + (e.code || e.message), true);
  }
}

async function activateCloudUserSession(uObj) {
  if (unsub) { unsub(); unsub = null; }
  if (typeof resetSessionMemoryState === 'function') resetSessionMemoryState();
  user = uObj;
  cloudAccessError = '';
  syncBad = false;
  _cloudProfLoaded = false;
  const effUid = uObj.uid;
  profTried = false;
  resetProfObjectToDefault();
  try { Object.assign(prof, JSON.parse(localStorage.getItem('prof_' + effUid) || '{}')); } catch (e) {}
  delete prof.friends;

  // Дополнительно восстанавливаем профиль и коллекцию из IndexedDB (если localStorage был очищен или переполнен)
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

  let cachedLocal = loadLocalItems(effUid);
  const idbItems = await idbVault.get('items_' + effUid);
  if (Array.isArray(idbItems) && idbItems.length >= cachedLocal.length) {
    cachedLocal = idbItems.filter(isTitleDoc).map(fix);
  }
  items = deduplicateListByIdAndCleanupCloud(cachedLocal, false);
  loaded = true;
  profPaint();
  refresh();
  homeTab();
  if (!cgGrid.children.length) cgLoad(true);

  getDoc(doc(db, 'items', 'prof_' + effUid)).then(pSnap => {
    const localAvatarBackup = prof.avatar || '';
    const localCoverBackup = prof.cover || '';
    const localCoverColBackup = prof.coverColor || 0;
    if (pSnap.exists()) {
      const pd = pSnap.data();
      const {isProfile, kind: _k, userId: _u, _docId, statsSummary, friends: _fr, ...rest} = pd;
      Object.assign(prof, rest);
      // Если в облаке аватар/обложка случайно оказались пустыми, а локально они сохранены — восстанавливаем их и синхронизируем обратно
      let restoredVisuals = false;
      if (!prof.avatar && localAvatarBackup) { prof.avatar = localAvatarBackup; restoredVisuals = true; }
      if (!prof.cover && localCoverBackup) { prof.cover = localCoverBackup; restoredVisuals = true; }
      if (!prof.cover && !prof.coverColor && localCoverColBackup) { prof.coverColor = localCoverColBackup; restoredVisuals = true; }
      _cloudProfLoaded = true;
      profSaveLocal();
      if (restoredVisuals) profCloud();
      profPaint();
      refresh();
    } else {
      _cloudProfLoaded = true;
      profCloud();
    }
  }).catch(() => { _cloudProfLoaded = true; });

  loadRuCacheFromCloud(effUid);

  if (!localStorage.getItem('schemaMigratedV3_' + effUid)) {
    setTimeout(() => migrateOldDocsToKindSchema(false), 1500);
  }

  unsub = onSnapshot(query(collection(db, 'items'), where('kind', '==', 'title'), where('userId', '==', effUid)),
    snap => {
      cloudAccessError = '';
      syncBad = false;
      setSync();

      const changes = snap.docChanges();
      if (profTried && loaded && changes.length > 0 && changes.length <= 3 && changes.every(c => c.type === 'modified')) {
        let anyExternalDiff = false;
        const changedIds = [];
        changes.forEach(c => {
          const incoming = fix({ ...c.doc.data(), _docId: c.doc.id });
          const pendingTs = _localPendingWrites.get(c.doc.id) || 0;
          if (pendingTs && incoming.updatedAt && incoming.updatedAt < pendingTs) return;
          const idx = items.findIndex(x => String(x.id) === String(incoming.id));
          if (idx > -1) {
            const cur = items[idx];
            if ((cur.updatedAt || 0) <= (incoming.updatedAt || 0)) {
              if (cur.status !== incoming.status || cur.fav !== incoming.fav || cur.rating !== incoming.rating || cur.title !== incoming.title || cur.archived !== incoming.archived || cur.pin !== incoming.pin) {
                anyExternalDiff = true;
              }
              items[idx] = incoming;
              changedIds.push(incoming.id);
            }
          }
        });
        saveLocalItems();
        if (anyExternalDiff && changedIds.length === 1) {
          refresh({ itemId: changedIds[0] });
        } else if (anyExternalDiff) {
          refresh({ onlyList: true });
        }
        return;
      }

      const ownList = deduplicateListByIdAndCleanupCloud(
        snap.docs
          .filter(d => !window._recentlyDeletedIds || (!window._recentlyDeletedIds.has(d.id) && !window._recentlyDeletedIds.has(String(d.data()?.id))))
          .map(d => fix({ ...d.data(), _docId: d.id })),
        false
      );
      if (ownList.length > 0) {
        try { localStorage.setItem('cloudHadSynced_' + effUid, '1'); } catch (e) {}
      }

      // ЖЕЛЕЗОБЕТОННАЯ ЗАЩИТА КОЛЛЕКЦИИ (~500 аниме):
      // Никогда не затираем существующую локальную коллекцию пустым или неполным кэш-ответом облака!
      const prevCount = items.length;
      if (!window._explicitEmptyAllowed && prevCount === 0 && ownList.length === 0) {
        idbVault.get(getUidStorageKey('safetyBackup')).then(sb => {
          if (Array.isArray(sb) && sb.length > 0 && items.length === 0) {
            items = deduplicateListByIdAndCleanupCloud(sb.filter(isTitleDoc).map(fix), false);
            refresh();
            toast(`Восстановлено из локальной страховочной копии: ${items.length} тайтлов`);
          }
        });
      }
      if (!window._explicitEmptyAllowed && prevCount > 0 && ownList.length === 0) {
        loaded = true;
        if (!window._migrationRetriedOnEmpty) {
          window._migrationRetriedOnEmpty = true;
          migrateOldDocsToKindSchema(false);
        }
      } else if (!window._explicitEmptyAllowed && prevCount > 20 && ownList.length < prevCount * 0.6 && snap.metadata?.fromCache) {
        // Если локальный кэш Firestore отдал только часть документов до полной загрузки с сервера — объединяем, не теряя карточки
        items = deduplicateListByIdAndCleanupCloud([...items, ...ownList], false);
        loaded = true;
        saveLocalItems();
      } else {
        items = ownList;
        loaded = true;
        saveLocalItems();
      }

      if (!profTried) {
        profTried = true;
        setTimeout(() => checkMigrateLocalItemsToCloud(false), 1200);
        setTimeout(() => restoreUncertainMatchesFromStorage(), 800);
        profPaint();
      }
      refresh();
      homeTab();
    },
    err => {
      // Этап 1 п.5: Показываем явную красную ошибку «⚠ Нет доступа к облаку: <код ошибки>» вместо молчаливого «Синхронизировано»
      items = deduplicateListByIdAndCleanupCloud(loadLocalItems(effUid), false);
      loaded = true;
      syncBad = true;
      cloudAccessError = err?.code || err?.message || 'permission-denied';
      setSync();
      toast('Нет доступа к облаку (' + cloudAccessError + '). Показана локальная копия.', true);
      profPaint();
      refresh();
      homeTab();
    });
}

// ---------- ОБРАБОТЧИКИ АВТОРИЗАЦИИ ----------
$('localModeBtn').onclick = () => startLocalMode('Включён локальный режим');

getRedirectResult(auth).catch(e => {
  if (e && e.code === 'auth/unauthorized-domain') {
    startLocalMode('Домен ' + location.hostname + ' не добавлен в Firebase Authorized Domains. Включён локальный режим.');
  } else if (e && !['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(e.code)) {
    toast('Ошибка входа Google: ' + (e.message || e.code), true);
  }
});

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
  if (typeof uncertainMatchesQueue !== 'undefined') uncertainMatchesQueue.length = 0;
  if (typeof selSet !== 'undefined') selSet.clear();
  if (typeof reviewSelSet !== 'undefined') reviewSelSet.clear();
  if ($('reviewItemsBox')) { $('reviewItemsBox').replaceChildren(); $('reviewItemsBox').style.display = 'none'; }
}

$('logoutBtn').onclick = async () => {
  try { localStorage.removeItem('useLocalMode'); } catch (e) {}
  if (unsub) { unsub(); unsub = null; }
  resetSessionMemoryState();
  resetProfObjectToDefault();
  user = null; items = []; loaded = false;
  try { await signOut(auth); } catch (e) {}
  $('appScreen').style.display = 'none'; $('authScreen').style.display = 'flex';
};

onAuthStateChanged(auth, u => {
  document.body.classList.remove('auth-checking');
  if (u) {
    try { localStorage.removeItem('useLocalMode'); } catch (e) {}
    return activateCloudUserSession(u);
  }
  if (localStorage.getItem('useLocalMode') === '1') return startLocalMode();
  if (unsub) { unsub(); unsub = null; }
  resetSessionMemoryState();
  items = []; loaded = false;
  $('appScreen').style.display = 'none'; $('authScreen').style.display = 'flex';
});

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

const getItemMarkers = o => {
  const all = [o.title, o.titleEn || o.en, o.titleOrig || o.orig, ...splitAltNames(o.alt)].filter(Boolean);
  for (const t of all) {
    const m = extractSeasonPartMarker(t);
    if (m) return m;
  }
  return '';
};

const nset = o => {
  if (!o) return [];
  return [...new Set(
    [o.title, o.titleEn || o.en, o.titleOrig || o.orig, ...splitAltNames(o.alt)]
      .map(normTitleStr)
      .filter(x => x && x.length >= 2)
  )];
};

// Единая функция поиска повторов для ВСЕХ мест
const same = (a, b) => {
  if (!a || !b) return false;
  if (a.tmdb && b.tmdb && String(a.tmdb) === String(b.tmdb)) return true;
  if (a.imdbId && b.imdbId && String(a.imdbId) === String(b.imdbId)) return true;
  if (!sameCat(a.category, b.category)) return false;
  if (a.aniId && b.aniId && Number(a.aniId) === Number(b.aniId)) return true;
  if (a.mal && b.mal && Number(a.mal) === Number(b.mal)) return true;

  if (a.aniId && b.aniId && Number(a.aniId) !== Number(b.aniId)) return false;
  if (a.mal && b.mal && Number(a.mal) !== Number(b.mal)) return false;
  if (a.tmdb && b.tmdb && String(a.tmdb) !== String(b.tmdb)) return false;

  const primaryA = [a.title, a.titleEn || a.en, a.titleOrig || a.orig].map(normTitleStr).filter(x => x && x.length >= 2);
  const primaryB = [b.title, b.titleEn || b.en, b.titleOrig || b.orig].map(normTitleStr).filter(x => x && x.length >= 2);
  if (!primaryA.length || !primaryB.length) return false;
  if (!primaryA.some(n => primaryB.includes(n))) return false;

  if (a.format && b.format && a.format !== b.format) return false;
  const ma = getItemMarkers(a), mb = getItemMarkers(b);
  if (ma !== mb) return false;

  const ya = parseInt(a.year) || 0, yb = parseInt(b.year) || 0;
  if (ya && yb && Math.abs(ya - yb) > 1) return false;
  if ((!ya || !yb) && !a.aniId && !b.aniId && !a.mal && !b.mal && !a.tmdb && !b.tmdb) return false;

  return true;
};

const findDuplicateMatch = (candidate, pool = items) => {
  if (!candidate) return null;
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
  box.append(t); activeToastTimer = setTimeout(() => t.remove(), act ? 3500 : 2500);
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
    'Брошено': vis.filter(i => i.status === 'Брошено').length,
    'Любимое': vis.filter(i => i.fav).length
  };
  const labels = {
    'Все': 'Все',
    'Смотрю/Читаю': getStatusLabelForCategory('Смотрю/Читаю', cat),
    'В планах': 'В планах',
    'Просмотрено/Прочитано': getStatusLabelForCategory('Просмотрено/Прочитано', cat),
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
  stEl.dataset.s = i.status;
  img.loading = 'lazy'; img.src = safePosterUrl(i.poster);
  img.onerror = () => {
    if (img.src.includes('wsrv.nl') && i.poster && !img.dataset.retriedDirect) {
      img.dataset.retriedDirect = '1';
      _wsrvDown = true;
      img.src = i.poster;
      return;
    }
    img.onerror = null;
    img.src = FALL;
  };
  const ov = el('div', 'ov'); ov.append(el('p', null, i.description || 'Описание отсутствует.'));
  pc.append(img, ov, stEl);
  if (i.ongoing) pc.append(el('div', 'ong', 'ОНГОИНГ'));
  if (i.fav) { const hb = el('div', 'fav-heart-badge', '❤'); hb.title = 'В любимом'; pc.append(hb); }
  if (i.pin) { const pb = el('div', 'pin-badge', '📌'); pb.title = 'Закреплено'; pc.append(pb); }
  if (i.rating) pc.append(el('div', 'mine', '★ ' + i.rating));

  const info = el('div', 'ci'), row = el('div', 'cm');
  const fmtStr = (typeof FORMAT_RU !== 'undefined' && FORMAT_RU[i.format]) ? FORMAT_RU[i.format] : catLabel(i);
  const epsStr = i.eps ? (i.eps + (i.category === 'Манга' || i.category === 'Ранобэ' ? ' гл.' : ' эп.')) : '';
  const scoreVal = i.rating ? `★ ${i.rating}` : (i.extRating ? `★ ${i.extRating}` : '');
  row.append(
    el('span', null, [i.year, fmtStr, epsStr].filter(Boolean).join(' • ')),
    el('span', 'star', scoreVal)
  );
  const descSnip = el('div', 'list-desc-snip', i.description || i.myNote || 'Описание отсутствует.');
  const bd = el('div', 'bd2'), st2 = el('div', 'status', stLabel); st2.dataset.s = i.status; bd.append(st2);
  if (i.fav) bd.append(el('span', 'chip', '❤ Любимое'));
  if (num(i.rewatchCount) > 0) bd.append(el('span', 'chip', `🔁 ×${i.rewatchCount}`));
  if (i.importSource) bd.append(el('span', 'imp-badge', `Импорт: ${i.importSource}`));
  if (i.needsReview) bd.append(el('span', 'review-badge', '📥 На разбор'));
  if (i.ongoing) bd.append(el('div', 'ong', 'ОНГОИНГ'));

  // Кнопка «⋮» для быстрой смены статуса в компактном списке на телефоне и ПК (Скриншот 2)
  const dotsBtn = el('button', 'card-dots-btn', '⋮');
  dotsBtn.type = 'button';
  dotsBtn.title = 'Сменить статус или добавить в Любимое';
  dotsBtn.onclick = e => {
    e.stopPropagation();
    openQuickAddStatusMenu(dotsBtn, i, () => refresh({ onlyList: true }));
  };

  const addedStr = formatAddedDateRu(i);
  const metaTagsLine = [(i.tags || []).slice(0, 3).join(', '), addedStr ? 'Добавлено: ' + addedStr : ''].filter(Boolean).join(' · ');
  info.append(Object.assign(el('h3', 'title', i.title), {title: i.title}), row, descSnip, el('div', 'tg', metaTagsLine), bd);
  card.append(pc, info, dotsBtn);
  card.tabIndex = 0;
  card.onclick = () => {
    if ($('qaFloatMenu')?.classList.contains('open')) { closeQuickAddStatusMenu(); return; }
    openDetail(i.id);
  };
  card.onkeydown = e => { if (e.key === 'Enter') openDetail(i.id); };
  return card;
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
    const newNode = createCollectionCardNode(it);
    if (selMode && selSet.has(it.id)) newNode.classList.add('sel');
    existingNode.replaceWith(newNode);
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
    $('viewBtn').textContent = view === 'kanban' ? 'Вид: Канбан' : view === 'list' ? 'Вид: Список' : 'Вид: Сетка';
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
    const m = el('div', 'msg', 'Коллекция пока пуста. Добавь первый тайтл — вручную или из каталога.');
    const r = el('div', 'row'), a = el('button', 'btn', '＋ Добавить тайтл'), c = el('button', 'btn btn-s', '🔍 Открыть каталог');
    r.style.justifyContent = 'center'; r.style.marginTop = '14px';
    a.onclick = () => { openAdd(null); draftRestore(); };
    c.onclick = () => document.querySelector('.tab[data-v="catalog"]').click();
    r.append(a, c); m.append(r);
    renderStatusAndCategoryBanner();
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
  if (KanbanManager.isKanbanActive) KanbanManager.renderBoard();
  if (!list.length) return grid.append(el('div', 'msg', 'Ничего не найдено по выбранным фильтрам.'));

  const startIdx = isAppend ? Math.max(0, currentRenderLimit - RENDER_PAGE_SIZE) : 0;
  const slice = list.slice(startIdx, currentRenderLimit);
  const frag = document.createDocumentFragment();
  slice.forEach(i => frag.append(createCollectionCardNode(i)));
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
    $('kindFilters').style.display = cat === 'Манга' ? 'flex' : 'none';
    if ($('animeKindFilters')) $('animeKindFilters').style.display = cat === 'Аниме' ? 'flex' : 'none';
    if ($('videoKindFilters')) $('videoKindFilters').style.display = cat === 'Кино и сериалы' ? 'flex' : 'none';
    document.querySelectorAll('#kindFilters .kb').forEach(x => x.classList.toggle('on', x.dataset.k === 'Все'));
    document.querySelectorAll('#animeKindFilters .kb').forEach(x => x.classList.toggle('on', x.dataset.ak === 'Все'));
    document.querySelectorAll('#videoKindFilters .kb').forEach(x => x.classList.toggle('on', x.dataset.vk === 'Все'));
    catCounts();
    render();
  };
});
document.querySelectorAll('#kindFilters .kb').forEach(b => b.onclick = () => { kind = b.dataset.k; document.querySelectorAll('#kindFilters .kb').forEach(x => x.classList.toggle('on', x === b)); render(); });
document.querySelectorAll('#animeKindFilters .kb').forEach(b => b.onclick = () => { animeSubKind = b.dataset.ak; document.querySelectorAll('#animeKindFilters .kb').forEach(x => x.classList.toggle('on', x === b)); render(); });
document.querySelectorAll('#videoKindFilters .kb').forEach(b => b.onclick = () => { videoSubKind = b.dataset.vk; document.querySelectorAll('#videoKindFilters .kb').forEach(x => x.classList.toggle('on', x === b)); render(); });

$('viewBtn').onclick = () => {
  const isMobile = window.innerWidth <= 600;
  if (view === 'grid') view = 'list';
  else if (view === 'list') view = isMobile ? 'grid' : 'kanban';
  else view = 'grid';
  localStorage.setItem('view', view);
  KanbanManager.isKanbanActive = (view === 'kanban' && !isMobile);
  KanbanManager.sync();
  render();
};
$('ongBtn').onclick = e => { ongOnly = !ongOnly; e.currentTarget.classList.toggle('on', ongOnly); render(); };
$('xfBtn').onclick = () => { xf = null; render(); };
const setSize = v => {
  const numV = Number(v) || 190;
  document.documentElement.style.setProperty('--cw', numV + 'px');
  document.documentElement.dataset.gridSize = numV <= 150 ? 'sm' : numV >= 240 ? 'lg' : 'md';
  try { localStorage.setItem('cw', String(numV)); } catch (e) {}
};
$('sizeSel').value = localStorage.getItem('cw') || '190'; setSize($('sizeSel').value || '190'); $('sizeSel').onchange = e => setSize(e.target.value);

// ---------- Модальные окна ----------
let cropDone = null;
let battleActiveInProgress = false;

function confirmExitBattleIfActive() {
  if (!battleActiveInProgress) return true;
  const ok = window.confirm('Турнир «Битва тайтлов» ещё не завершён! Точно закрыть окно и сбросить текущий прогресс?');
  if (ok) battleActiveInProgress = false;
  return ok;
}

const closeAll = () => {
  if (battleActiveInProgress && !confirmExitBattleIfActive()) return;
  if (dlgDone) dlgDone(null);
  if (cropDone) cropDone(null);
  if (typeof closeQuickAddStatusMenu === 'function') closeQuickAddStatusMenu();
  ['addModal', 'detailModal', 'statsModal', 'rndModal', 'profModal', 'cropModal', 'charPopupModal', 'dataModal', 'themeModal'].forEach(id => {
    if ($(id)) $(id).style.display = 'none';
  });
};
['closeAddBtn', 'closeDetailBtn', 'closeStatsBtn', 'closeStatsTopBtn', 'rndClose'].forEach(id => { if ($(id)) $(id).onclick = closeAll; });
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
  if (t.id === 'dlgModal') {
    if (battleActiveInProgress && !confirmExitBattleIfActive()) return;
    if (dlgDone) dlgDone(null);
    return;
  }
  if (t.classList.contains('modal')) closeAll();
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
    if (cropDone) { cropDone(null); return; }
    if (dlgDone) {
      if (battleActiveInProgress && !confirmExitBattleIfActive()) return;
      dlgDone(null);
    } else closeAll();
  }
});

function setPoster(v) {
  posterValue = v || ''; const data = posterValue.startsWith('data:');
  $('inputPoster').value = data ? '' : posterValue;
  $('inputPoster').placeholder = data ? 'Загружен свой файл ✓' : 'Ссылка на постер (URL)';
  $('posterPreview').src = safePosterUrl(posterValue);
}
$('inputPoster').oninput = () => { posterValue = $('inputPoster').value.trim(); $('posterPreview').src = safePosterUrl(posterValue); draftSave(); };
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
  const c = $('inputCategory').value;
  $('afHint').textContent = c === 'Аниме' || ['Манга', 'Манхва', 'Ранобэ'].includes(c)
    ? 'Ищет в AniList: можно вводить русское, английское или японское название.'
    : 'Ищет в TMDB: подойдёт русское или английское название.';
}
$('inputCategory').onchange = afHint;

// ---- Перевод и получение русских названий/описаний
const SHK = {'Аниме': 'animes', 'Манга': 'mangas', 'Ранобэ': 'ranobe'}, SHD = ['shikimori.io', 'shikimori.me'], WDP = {animes: 'P4086', mangas: 'P4087', ranobe: 'P4087'};
const hasRu = t => /[а-яё]/i.test(t || ''), ruN = t => (t || '').toLowerCase().replace(/[^a-z0-9а-яё]+/g, ''), ruWait = ms => new Promise(r => setTimeout(r, ms));
const ruClean = t => (t || '').replace(/\[(character|person|anime|manga|ranobe|url|user)[^\]]*\]([^\[]*)\[\/\1\]/gi, '$2').replace(/\[\/?[a-z_]+(?:=[^\]]*)?\]/gi, '').replace(/\n{3,}/g, '\n\n').trim();
const ruJson = async (u, ms = 7000) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); try { const r = await fetch(u, {signal: c.signal}); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(t); } };
let shDown = 0; const shikiOk = () => Date.now() - shDown > 15000;
async function shiki(path) {
  if (!shikiOk()) throw new Error('Shikimori cooldown');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await Promise.any(SHD.map(d => ruJson('https://' + d + path, 5200)));
    } catch (e) {
      if (attempt === 0) await ruWait(900);
      else { shDown = Date.now(); throw e; }
    }
  }
}
const RUC = (() => { try { return JSON.parse(localStorage.getItem('ruCache') || '{}'); } catch (e) { return {}; } })();
let _ruCloudSaveTimer = 0;
function saveRuCacheLocal() {
  try {
    // В localStorage храним только компактные переводы названий (без тяжёлых описаний 'd...'), чтобы никогда не переполнять 5 МБ квоту!
    const entries = Object.entries(RUC).filter(([k, v]) => v && !k.startsWith('d') && typeof v === 'string');
    const trimmed = Object.fromEntries(entries.slice(-450));
    localStorage.setItem('ruCache', JSON.stringify(trimmed));
  } catch (e) {}
}
function scheduleSaveRuCacheToCloud() {
  saveRuCacheLocal();
  if (!user || user.isLocal || !auth.currentUser) return;
  clearTimeout(_ruCloudSaveTimer);
  _ruCloudSaveTimer = setTimeout(() => {
    if (!user || user.isLocal || !auth.currentUser) return;
    const entries = Object.entries(RUC).filter(([k, v]) => v && !k.startsWith('d_') && !k.startsWith('d') && typeof v === 'string' && v.length <= 280);
    const titlesPayload = Object.fromEntries(entries.slice(-1200));
    setDoc(doc(db, 'items', 'prof_rucache_' + user.uid), {
      kind: 'profile',
      isProfile: true,
      userId: user.uid,
      updatedAt: Date.now(),
      titles: titlesPayload
    }, { merge: true }).catch(() => {});
  }, 1800);
}
async function loadRuCacheFromCloud(uid) {
  if (!uid || !auth.currentUser) return;
  try {
    const snap = await getDoc(doc(db, 'items', 'prof_rucache_' + uid));
    if (snap.exists()) {
      const data = snap.data();
      if (data && data.titles && typeof data.titles === 'object') {
        Object.assign(RUC, data.titles);
        saveRuCacheLocal();
        if ($('catalogView')?.style.display !== 'none') ruCards();
      }
    }
  } catch (e) {}
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
  if (shikiOk()) { try { (await shiki(`/api/${kind}?ids=${mals.join(',')}&limit=50`)).forEach(x => { if (x.russian) out[x.id] = x.russian; }); } catch (e) {} }
  const miss = mals.filter(m => !out[m]);
  if (miss.length) { try { const w = await wdBatch(miss, WDP[kind]); miss.forEach(m => { if (w[m] && hasRu(w[m].ru)) out[m] = w[m].ru; }); } catch (e) {} }
  return out;
}
function ruFull(r) {
  return r.ruP ||= (async () => {
    let ru = '', d = '';
    if (r.mal && SHK[r.category]) {
      if (shikiOk()) { try { const x = await shiki(`/api/${SHK[r.category]}/${r.mal}`); ru = x.russian || ''; d = ruClean(x.description); } catch (e) {} }
      if (!ru || !hasRu(d)) { try { const w = (await wdBatch([r.mal], WDP[SHK[r.category]]))[r.mal]; if (w) { if (!ru && hasRu(w.ru)) ru = w.ru; if (!hasRu(d) && w.wiki) d = await ruWikiDesc(w.wiki); } } catch (e) {} }
    }
    if (ru && !hasRu(r.title)) { if (!r.en) r.en = r.title; r.title = ru; }
    if (hasRu(d)) r.desc = d; else if (r.desc && !hasRu(r.desc)) { try { r.desc = await ruTranslate(r.desc); } catch (e) { ruWarn(); } }
    r.ruDone = 1; return r;
  })();
}
async function ruPreview(r) {
  if (r.src !== 'AniList' || r.ruDone) return;
  $('rndDesc').textContent = 'Перевожу на русский…';
  await ruFull(r);
  if (rndR === r) { $('rndTitle').textContent = r.title; $('rndNames').textContent = [r.en, r.orig].filter(Boolean).join(' / '); $('rndDesc').textContent = r.desc || 'Описание отсутствует.'; }
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

let _descBgRunId = 0;
async function ruCards() {
  const allCards = [...cgGrid.children].filter(c => c._r);
  allCards.forEach(c => {
    const dKey = 'd_' + getRuCacheKey(c._r);
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
        RUC[kind + c._r.mal] = ru || '';
        ruSet(c, ru);
      });
      if (addedNew) scheduleSaveRuCacheToCloud();
      else saveRuCacheLocal();
    } catch (e) {}
  }

  const runId = ++_descBgRunId;
  for (const c of allCards) {
    if (runId !== _descBgRunId) break;
    const r = c._r;
    if (!r) continue;
    const tKey = getRuCacheKey(r);
    if (!hasRu(r.title)) {
      if (RUC['t_' + tKey] && hasRu(RUC['t_' + tKey])) {
        ruSet(c, RUC['t_' + tKey]);
      } else {
        try {
          const trTitle = await ruTranslate(r.title);
          if (trTitle && hasRu(trTitle)) {
            RUC['t_' + tKey] = trTitle;
            ruSet(c, trTitle);
            scheduleSaveRuCacheToCloud();
          }
        } catch (e) {}
      }
    }
    if (r.desc && !hasRu(r.desc) && !r.ruDescDone) {
      await ensureCardRuDescription(c);
      await ruWait(180);
    }
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
  if (prof.rt) document.body.classList.add('rt-' + prof.rt);
  if ($('accRt')) $('accRt').value = prof.rt || '';
}
if ($('accRt')) $('accRt').onchange = () => { prof.rt = $('accRt').value; profCloud(); rtApply(); };
if ($('accThemeModalBtn')) {
  $('accThemeModalBtn').onclick = () => {
    $('accMenu')?.classList.remove('open');
    rtApply();
    $('themeModal').style.display = 'flex';
  };
}
if ($('closeThemeModalBtn')) $('closeThemeModalBtn').onclick = () => { $('themeModal').style.display = 'none'; };
if ($('doneThemeModalBtn')) $('doneThemeModalBtn').onclick = () => { $('themeModal').style.display = 'none'; };

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
          modal.style.display = 'none';
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
$('pfCancel').onclick = () => { $('profModal').style.display = 'none'; };
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
  $('profModal').style.display = 'none';
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

// ---- Подписи полей формы (без поля inputRecBy — Этап 3 п.5)
const LBL = {inputCategory: 'Категория', inputStatus: 'Статус просмотра', inputTitle: 'Название (русское) *', inputTitleEn: 'Английское название', inputTitleOrig: 'Оригинальное название', inputAlt: 'Другие названия (через запятую)', inputPoster: 'Ссылка на постер (URL)', inputYear: 'Год выхода', inputRating: 'Моя оценка (1–10)', inputCompletedAt: 'Дата просмотра / завершения', inputRewatchCount: 'Счётчик пересмотров (раз)', inputExtRating: 'Внешняя оценка (AniList / TMDB)', inputAuthor: 'Автор / режиссёр', inputStudio: 'Студия', inputSource: 'Первоисточник', inputTags: 'Жанры и теги (через запятую)', inputLists: 'Подборки (через запятую)', inputEps: 'Серий или глав', inputVols: 'Томов (для манги и ранобэ)', inputDur: 'Минут на серию или фильм', inputMyNote: 'Личная заметка / мой отзыв', inputDescription: 'Синопсис / описание'};
Object.entries(LBL).forEach(([id, t]) => { const e = $(id); if (!e) return; const w = el('div', 'fld'); e.replaceWith(w); w.append(el('label', null, t), e); });

const stars = el('div', 'stars');
const starPaint = () => [...stars.children].forEach((b, k) => b.classList.toggle('on', k < +$('inputRating').value));
for (let k = 1; k <= 10; k++) { const b = el('button', null, '★'); b.type = 'button'; b.title = 'Оценка ' + k; b.onclick = () => { $('inputRating').value = +$('inputRating').value === k ? '' : k; starPaint(); draftSave(); pvDraw(); }; stars.append(b); }
$('inputRating').parentElement.append(stars);
$('inputRating').addEventListener('input', starPaint);

// ИСПРАВЛЕНИЕ ОШИБКИ №3: Критерии можно включать и выключать без возврата старых при сохранении
let criteriaActiveInForm = false;
{
  const ratingWrap = $('inputRating')?.parentElement;
  if (ratingWrap && !$('criteriaBox')) {
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
    cBox.append(toggleBtn, cGrid); ratingWrap.append(cBox);
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
  $('inputMyNote').value = i.myNote || '';
  $('afQuery').value = '';
  $('afResults').replaceChildren();

  // Этап 3 п.5: Два режима («Автозаполнение» — виден только поиск; «Заполнить вручную» — видны поля названий; при редактировании существующего тайтла поля открыты)
  setAddFormManualMode(Boolean(item && (item.id || item.title)));

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

function setAddFormManualMode(isManual, keepSearchVisible = false) {
  const afEl = $('afBox') || document.querySelector('#addModal .af');
  const manEl = $('manualTitlesSec');
  if (afEl) afEl.style.display = (isManual && !keepSearchVisible) ? 'none' : '';
  if (manEl) manEl.style.display = isManual ? 'flex' : 'none';
  if ($('afToggle')) {
    $('afToggle').textContent = (isManual && !keepSearchVisible) ? '🔍 Режим: Автозаполнение' : '✍ Заполнить вручную';
  }
}

$('afToggle').onclick = () => {
  const manEl = $('manualTitlesSec');
  const currentlyManualOnly = manEl && manEl.style.display !== 'none' && ($('afBox')?.style.display === 'none');
  setAddFormManualMode(!currentlyManualOnly, false);
};

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
      myNote: $('inputMyNote').value.trim(),
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

    const k = items.findIndex(x => x.id === it.id);
    if (k > -1) items[k] = it; else items.push(it);
    refresh(); closeAll();
    if (editId) openDetail(it.id);
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
    btn('📁＋ В подборку', async () => {
      const existing = [...new Set([...(prof.customLists || []), ...items.flatMap(x => x.lists || [])])];
      const nm = ((await uiPrompt('Добавить в подборку', '', existing.length ? `Существующие: ${existing.join(', ')}` : 'Название подборки')) || '').trim();
      if (!nm) return;
      i.lists = i.lists || [];
      if (!i.lists.some(x => x.toLowerCase() === nm.toLowerCase())) {
        i.lists.push(nm);
        prof.customLists = prof.customLists || [];
        if (!prof.customLists.some(x => x.toLowerCase() === nm.toLowerCase())) prof.customLists.push(nm);
        profCloud(); cloudSave(i); refresh(); openDetail(id); toast(`Добавлено в «${nm}»`);
      }
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
  $('detailPoster').src = safePosterUrl(i.poster);
  $('detailPoster').onerror = () => { $('detailPoster').onerror = null; $('detailPoster').src = FALL; };
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
      delX.onclick = e => { e.stopPropagation(); i.lists = (i.lists || []).filter(x => x !== listName); cloudSave(i); refresh(); openDetail(id); toast(`Убрано из «${listName}»`); };
      wrap.append(delX);
    }
    tg.append(wrap);
  });

  const mn = $('detailMyNote');
  mn.style.display = i.myNote ? '' : 'none';
  mn.textContent = i.myNote ? ('💬 Личная заметка: ' + i.myNote) : '';
  $('detailDescription').textContent = i.description || 'Описание отсутствует.';
  if (i.description && !hasRu(i.description)) {
    ruTranslate(i.description).then(tr => {
      if (tr && hasRu(tr)) {
        i.description = tr;
        if (curId === id && $('detailDescription')) $('detailDescription').textContent = tr;
        cloudSave(i);
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
  $('editItemBtn').style.display = '';

  detailExtra(id);
  CharacterSeiyuuManager.render($('detailCharsSec'), i);
  $('detailModal').style.display = 'flex';
}



$('editItemBtn').onclick = () => { const i = items.find(x => x.id === curId); if (i) { closeAll(); openAdd(i); } };
$('deleteItemBtn').onclick = async () => {
  if (!(await uiConfirm('Точно удалить этот тайтл из коллекции?', 'Удалить', true))) return;
  const id = curId; closeAll(); removeItem(id, true);
};