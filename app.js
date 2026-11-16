import {initializeApp} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {getAuth,signInWithPopup,signInWithRedirect,getRedirectResult,GoogleAuthProvider,EmailAuthProvider,linkWithPopup,linkWithCredential,reauthenticateWithPopup,reauthenticateWithCredential,updatePassword,signOut,onAuthStateChanged,signInWithEmailAndPassword,createUserWithEmailAndPassword,sendPasswordResetEmail,sendEmailVerification,deleteUser} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {getFirestore,collection,doc,setDoc,deleteDoc,getDoc,query,where,onSnapshot,writeBatch,getDocs,limit} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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
    await signInWithRedirect(auth, freshProvider);
  } catch (e) {
    if (e.code === 'auth/unauthorized-domain') {
      return startLocalMode('Домен не добавлен в список разрешённых в Firebase Console (' + location.hostname + '). Включён локальный режим.');
    }
    toast('Ошибка входа Google: ' + e.message, true);
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
  ['addModal', 'detailModal', 'statsModal', 'rndModal', 'profModal', 'calModal', 'cropModal', 'charPopupModal', 'dataModal', 'themeModal'].forEach(id => {
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

// ---------- Автозаполнение и каталоги (AniList и TMDB с встроенным общим ключом) ----------
const decode = s => { const t = document.createElement('textarea'); t.innerHTML = s; return t.value; };
const SRC = {ORIGINAL: 'Оригинал', MANGA: 'Манга', LIGHT_NOVEL: 'Ранобэ', VISUAL_NOVEL: 'Визуальная новелла', VIDEO_GAME: 'Игра', GAME: 'Игра', NOVEL: 'Книга', WEB_NOVEL: 'Книга', COMIC: 'Комикс'};
const RU = {Action:'Экшен',Adventure:'Приключения',Comedy:'Комедия',Drama:'Драма',Ecchi:'Этти',Fantasy:'Фэнтези',Horror:'Ужасы','Mahou Shoujo':'Махо-сёдзё',Mecha:'Меха',Music:'Музыка',Mystery:'Детектив',Psychological:'Психология',Romance:'Романтика','Sci-Fi':'Научная фантастика','Slice of Life':'Повседневность',Sports:'Спорт',Supernatural:'Сверхъестественное',Thriller:'Триллер',Hentai:'Хентай (18+)'};
const TG = {28:'Боевик',12:'Приключения',16:'Мультфильм',35:'Комедия',80:'Криминал',99:'Документальный',18:'Драма',10751:'Семейный',14:'Фэнтези',36:'История',27:'Ужасы',10402:'Музыка',9648:'Детектив',10749:'Мелодрама',878:'Фантастика',53:'Триллер',10752:'Военный',37:'Вестерн',10759:'Боевик и приключения',10765:'Фантастика и фэнтези',10768:'Война и политика',10770:'Телефильм',10762:'Детский',10763:'Новости',10764:'Реалити-шоу',10766:'Мыльная опера',10767:'Ток-шоу'};
const TAGRU = {"Josei":"Дзёсэй","Kids":"Детское","Seinen":"Сэйнэн","Shoujo":"Сёдзё","Shounen":"Сёнэн","Boys' Love":"Яой / Сёнэн-ай (Boys’ Love)","Girls' Love":"Юри / Сёдзё-ай (Girls’ Love)","Yaoi":"Яой","Yuri":"Юри","Harem":"Гарем","Reverse Harem":"Обратный гарем","Love Triangle":"Любовный треугольник","Unrequited Love":"Безответная любовь","Age Gap":"Разница в возрасте","Polyamorous":"Полиамория","Matchmaking":"Сватовство","Marriage":"Брак","Cohabitation":"Совместная жизнь","Heterosexual":"Гетеро","Bisexual":"Бисексуальность","Transgender":"Трансгендерность","LGBTQ+ Themes":"ЛГБТ-темы","Isekai":"Исэкай","Reincarnation":"Реинкарнация","Magic":"Магия","Super Power":"Суперсилы","Time Travel":"Путешествия во времени","Time Skip":"Скачок во времени","Time Loop":"Временная петля","Post-Apocalyptic":"Постапокалипсис","Dystopian":"Антиутопия","Cyberpunk":"Киберпанк","Steampunk":"Стимпанк","Alchemy":"Алхимия","Witch":"Ведьмы","Vampire":"Вампиры","Werewolf":"Оборотни","Zombie":"Зомби","Demons":"Демоны","Gods":"Боги","Ghost":"Призраки","Dragons":"Драконы","Elf":"Эльфы","Aliens":"Пришельцы","Robots":"Роботы","Ninja":"Ниндзя","Samurai":"Самураи","Pirates":"Пираты","Military":"Военное","War":"Война","Space":"Космос","Mythology":"Мифология","Religion":"Религия","Politics":"Политика","Royal Affairs":"Королевские интриги","Slavery":"Рабство","Survival":"Выживание","Revenge":"Месть","Crime":"Криминал","Detective":"Детектив","Police":"Полиция","Gangs":"Банды","Yakuza":"Якудза","Espionage":"Шпионаж","Assassins":"Убийцы","Terrorism":"Терроризм","Tragedy":"Трагедия","Parody":"Пародия","Satire":"Сатира","Coming of Age":"Взросление","Anti-Hero":"Антигерой","Bullying":"Буллинг","Body Horror":"Боди-хоррор","Gore":"Жестокость (гор)","Suicide":"Суицид","Death Game":"Игра на выживание","Battle Royale":"Королевская битва","Video Games":"Видеоигры","Virtual World":"Виртуальный мир","Game":"Игры","Idol":"Айдолы","Cute Girls Doing Cute Things":"Милые девочки","Iyashikei":"Ийясикэй (умиротворение)","Otaku Culture":"Культура отаку","Gender Bending":"Смена пола","Crossdressing":"Кроссдрессинг","Body Swapping":"Обмен телами","Super Hero":"Супергерои","Superhero":"Супергерои","Food":"Еда","Cosplay":"Косплей","Dancing":"Танцы","Band":"Музыкальная группа","Classic Literature":"Классическая литература","Fairy Tale":"Сказка","Kaiju":"Кайдзю","Cultivation":"Культивация","Wuxia":"Уся","Martial Arts":"Боевые искусства","Swordplay":"Фехтование","Gambling":"Азартные игры","Chuunibyou":"Тюнибё","Tsundere":"Цундере","Yandere":"Яндере","Kuudere":"Кудере","Dissociative Identities":"Раздвоение личности","Amnesia":"Амнезия","Memory Manipulation":"Манипуляции памятью","Mind Control":"Контроль разума","Twins":"Близнецы","Found Family":"Найденная семья","Family Life":"Семейная жизнь","Rural":"Деревня","Urban":"Город","School":"Школа","College":"Колледж","Work":"Работа","Medieval":"Средневековье","Historical":"Историческое","Ancient China":"Древний Китай","Afterlife":"Загробная жизнь","Angels":"Ангелы","Fairy":"Феи","Monster Girl":"Монстро-девочки","Anthropomorphism":"Антропоморфизм","Animals":"Животные","Ensemble Cast":"Большой ансамбль","Male Protagonist":"Мужской протагонист","Female Protagonist":"Женская протагонистка","Primarily Female Cast":"В основном женский каст","Primarily Male Cast":"В основном мужской каст","Primarily Child Cast":"В основном детский каст","Primarily Adult Cast":"В основном взрослый каст","Teacher":"Учитель","Student Council":"Студсовет","Full Color":"Цветная","4-koma":"4-кома","Anthology":"Антология","Episodic":"Эпизодическое","Gag Humor":"Гэг-юмор","Black Comedy":"Чёрная комедия","Slapstick":"Слэпстик","Surreal Comedy":"Сюрреалистичная комедия","Shapeshifting":"Превращения","Illusions":"Иллюзии","Lost Civilization":"Утраченная цивилизация","Rescue":"Спасение","Nudity":"Обнажёнка","Drugs":"Наркотики"};
const ruTag = n => TAGRU[n] || n;

function findCachedEnForRuQuery(qStr, type) {
  const ql = (qStr || '').toLowerCase().trim();
  if (!ql) return '';
  for (const entry of ALC.values()) {
    for (const r of (entry.v || [])) {
      if (!r || !r.title) continue;
      if (type === 'ANIME' && r.category !== 'Аниме') continue;
      if (type === 'MANGA' && r.category === 'Аниме') continue;
      if (r.title.toLowerCase().includes(ql) && (r.en || r.orig)) return r.en || r.orig;
    }
  }
  return '';
}

async function ruToEnTranslate(qStr) {
  try {
    const j = await ruJson('https://translate.googleapis.com/translate_a/single?client=gtx&sl=ru&tl=en&dt=t&q=' + encodeURIComponent(qStr), 5000);
    const t = (j[0] || []).map(x => x[0]).join('').trim();
    if (t && !hasRu(t)) return t;
  } catch (e) {}
  return '';
}

async function _anilistRaw(search, type, o = {}) {
  if (hasRu(search)) {
    let en = findCachedEnForRuQuery(search, type);
    if (!en && shikiOk()) {
      try {
        const shikiKinds = type === 'ANIME' ? ['animes'] : (o.format === 'NOVEL' ? ['ranobe', 'mangas'] : ['mangas', 'ranobe']);
        for (const kk of shikiKinds) {
          const l = await shiki(`/api/${kk}?search=${encodeURIComponent(search)}&limit=5`);
          if (l && l[0]) { en = l[0].name; break; }
        }
      } catch (e) {}
    }
    if (!en) { try { en = await ruToEn(search); } catch (e) {} }
    if (!en) { try { en = await ruToEnTranslate(search); } catch (e) {} }
    if (en) search = en;
  }
  const gql = 'query($s:String,$id:Int,$idMal:Int,$t:MediaType,$p:Int,$pp:Int,$so:[MediaSort],$st:MediaStatus,$f:MediaFormat,$fn:MediaFormat,$c:CountryCode,$ad:Boolean,$pg:Int,$g:[String],$gn:[String],$sg:FuzzyDateInt,$sl:FuzzyDateInt,$ag:Int,$pl:Int,$el:Int,$eg:Int,$cl:Int,$cg:Int,$se:MediaSeason,$sy:Int,$tg:[String],$tgn:[String]){Page(page:$p,perPage:$pp){media(search:$s,id:$id,idMal:$idMal,type:$t,sort:$so,status:$st,format:$f,format_not:$fn,countryOfOrigin:$c,isAdult:$ad,popularity_greater:$pg,genre_in:$g,genre_not_in:$gn,startDate_greater:$sg,startDate_lesser:$sl,averageScore_greater:$ag,popularity_lesser:$pl,episodes_lesser:$el,episodes_greater:$eg,chapters_lesser:$cl,chapters_greater:$cg,season:$se,seasonYear:$sy,tag_in:$tg,tag_not_in:$tgn){id idMal isAdult format siteUrl countryOfOrigin bannerImage trailer{id site} title{romaji english native} synonyms coverImage{large} description(asHtml:false) startDate{year} averageScore episodes duration chapters volumes genres tags{name rank isMediaSpoiler} status source studios(isMain:true){nodes{name}} staff(perPage:12){edges{role node{name{full}}}}}}}';
  const r = await fetch('https://graphql.anilist.co', {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify({query: gql, variables: {s: search || undefined, id: o.id || undefined, idMal: o.idMal || undefined, t: type, p: o.page || 1, pp: o.per || 10, so: o.sort || ['SEARCH_MATCH'], st: o.status, f: o.format, fn: o.fn, c: o.country, ad: o.ad, pg: o.pg, g: o.genre, gn: o.genreNot, sg: o.sg, sl: o.sl, ag: o.ag, pl: o.pl, el: o.el, eg: o.eg, cl: o.cl, cg: o.cg, se: o.se, sy: o.sy, tg: o.tag, tgn: o.tagNot}})});
  const j = await r.json(); if (j.errors) throw new Error(j.errors[0].message);
  return j.data.Page.media.map(m => {
    const t = m.title, main = t.english || t.romaji || t.native;
    const stf = m.staff?.edges || [], pick = re => [...new Set(stf.filter(e => re.test(e.role)).map(e => e.node.name.full))].slice(0, 2).join(', ');
    const alt = [...new Set([t.romaji, ...(m.synonyms || [])].filter(x => x && x !== main && x !== t.english))].join(', ');
    return {
      aniId: m.id || 0, mal: m.idMal || 0, isAdult: !!m.isAdult, format: m.format || '',
      banner: m.bannerImage || '',
      upcoming: m.status === 'NOT_YET_RELEASED',
      trailerId: (m.trailer && m.trailer.site === 'youtube') ? m.trailer.id : '',
      rawGenres: m.genres || [], rawTags: (m.tags || []).filter(t => !t.isMediaSpoiler && t.rank >= 55).map(t => t.name),
      vols: m.volumes || 0, eps: m.episodes || m.chapters || 0, dur: m.duration || 0, title: main, en: t.english || '', orig: t.native || '', alt,
      author: type === 'ANIME' ? (pick(/Original Creator/i) || pick(/Director/i)) : (pick(/Story/i) || pick(/Art/i)),
      studio: (m.studios?.nodes || []).map(n => n.name).slice(0, 2).join(', '), source: SRC[m.source] || '', ongoing: m.status === 'RELEASING', src: 'AniList', url: m.siteUrl, poster: m.coverImage.large, year: m.startDate.year || '',
      ext: m.averageScore ? (m.averageScore / 10).toFixed(1) : '', tags: [...(m.genres || []).map(g => RU[g] || g), ...(m.tags || []).filter(t => !t.isMediaSpoiler && t.rank >= 60).slice(0, 8).map(t => ruTag(t.name))],
      desc: m.description ? decode(m.description.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim() : '',
      category: type === 'ANIME' ? 'Аниме' : m.format === 'NOVEL' ? 'Ранобэ' : 'Манга',
      kind: {KR: 'Манхва', CN: 'Маньхуа', TW: 'Маньхуа', JP: 'Манга'}[m.countryOfOrigin] || 'Комикс',
      subKind: {KR: 'Манхва', CN: 'Маньхуа', TW: 'Маньхуа', JP: 'Манга'}[m.countryOfOrigin] || 'Комикс'
    };
  });
}

const getActiveTmdbKey = () => localStorage.getItem('tmdbKey') || DEFAULT_TMDB_KEY;

async function _tmdbRaw(search, path, media, page = 1) {
  const k = getActiveTmdbKey();
  const r = await fetch(path ? `https://api.themoviedb.org/3${path}${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(k)}&language=ru-RU&page=${page}` : `https://api.themoviedb.org/3/search/multi?api_key=${encodeURIComponent(k)}&language=ru-RU&include_adult=false&query=${encodeURIComponent(search)}`);
  if (r.status === 401) { localStorage.removeItem('tmdbKey'); throw new Error('ключ TMDB не подошёл'); }
  const j = await r.json();
  const nowMs = Date.now();
  return (j.results || []).map(x => ({...x, media_type: x.media_type || media})).filter(x => x.media_type === 'movie' || x.media_type === 'tv').slice(0, path ? 20 : 10).map(x => {
    const orig = x.original_title || x.original_name || '', ids = x.genre_ids || [];
    const relDateStr = x.release_date || x.first_air_date || '';
    const isUpc = Boolean(relDateStr && new Date(relDateStr).getTime() > nowMs);
    return {
      title: x.title || x.name, en: x.original_language === 'en' ? orig : '', orig, alt: '',
      poster: x.poster_path ? 'https://image.tmdb.org/t/p/w342' + x.poster_path : '',
      banner: x.backdrop_path ? 'https://image.tmdb.org/t/p/w780' + x.backdrop_path : '',
      upcoming: isUpc,
      year: relDateStr.slice(0, 4), ext: x.vote_count ? x.vote_average.toFixed(1) : '',
      tags: ids.map(g => TG[g]).filter(Boolean), tmdb: x.media_type + '/' + x.id, src: 'TMDB', url: 'https://www.themoviedb.org/' + x.media_type + '/' + x.id, desc: x.overview || '',
      category: x.media_type === 'tv' ? 'Сериал' : 'Фильм'
    };
  });
}

const ALC = new Map();
function cached(fn) {
  return async (...a) => {
    const k = JSON.stringify(a), h = ALC.get(k);
    if (h && Date.now() - h.t < 6e5) return h.v.map(r => ({...r}));
    let v;
    try { v = await fn(...a); } catch (e) { if (/ключ/.test(e.message)) throw e; await ruWait(800); v = await fn(...a); }
    ALC.set(k, {t: Date.now(), v});
    if (ALC.size > 80) ALC.delete(ALC.keys().next().value);
    return v.map(r => ({...r}));
  };
}
const anilist = cached(_anilistRaw);
const tmdb = cached(_tmdbRaw);

async function tmdbInfo(r) {
  const k = getActiveTmdbKey();
  const d = await (await fetch(`https://api.themoviedb.org/3/${r.tmdb}?api_key=${encodeURIComponent(k)}&language=ru-RU&append_to_response=credits`)).json();
  const dir = (d.credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name), by = (d.created_by || []).map(c => c.name);
  return {author: [...new Set([...by, ...dir])].slice(0, 2).join(', '), studio: (d.production_companies || []).slice(0, 2).map(c => c.name).join(', '), ongoing: d.status === 'Returning Series', dur: d.runtime || (d.episode_run_time || [])[0] || 0, eps: d.number_of_episodes || 0, seasons: d.number_of_seasons || 0};
}

function tmdbExtra(r) {
  const t = ++exTok;
  return exP = (async () => {
    const x = await tmdbInfo(r);
    if (t !== exTok) return;
    if (!$('inputAuthor').value.trim()) $('inputAuthor').value = x.author;
    if (!$('inputStudio').value.trim()) $('inputStudio').value = x.studio;
    if (x.ongoing) $('inputOngoing').checked = true;
  })();
}

function fillForm(r) {
  exTok++;
  window._afPickedMeta = r;
  // После выбора результата автозаполнения открываем поля названий (Этап 3 п.5)
  setAddFormManualMode(true, true);
  if (!$('inputTitle').value.trim()) $('inputTitle').value = r.title;
  $('inputAuthor').value = r.author || '';
  $('inputStudio').value = r.studio || '';
  $('inputSource').value = r.source || '';
  $('inputOngoing').checked = !!r.ongoing;
  $('inputTitleEn').value = r.en;
  $('inputTitleOrig').value = r.orig;
  $('inputAlt').value = r.alt;
  $('inputCategory').value = r.category;
  $('inputKind').value = r.kind || 'Манга';
  $('inputYear').value = r.year;
  $('inputExtRating').value = r.ext;
  $('inputExtSrc').value = r.src || '';
  $('inputDescription').value = r.desc;
  $('inputTags').value = parseTags($('inputTags').value + ',' + r.tags.join(',')).join(', ');
  setPoster(r.poster); afHint();
  $('inputEps').value = r.eps || '';
  $('inputVols').value = r.vols || '';
  $('inputDur').value = r.dur || '';
  pvDraw();
  if (r.src === 'AniList' && !r.ruDone) {
    const t0 = $('inputTitle').value, d0 = $('inputDescription').value;
    ruFull(r).then(() => {
      if ($('inputTitle').value === t0) { $('inputTitle').value = r.title; $('inputTitleEn').value = r.en || ''; }
      if ($('inputDescription').value === d0) $('inputDescription').value = r.desc || '';
      pvDraw();
    }).catch(() => {});
  }
}

$('afBtn').onclick = async () => {
  const q = $('afQuery').value.trim(), c = $('inputCategory').value, box = $('afResults'); if (!q) return;
  const tk = ++afTok; box.replaceChildren(el('div', 'meta', 'Ищу...'));
  try {
    const res = c === 'Аниме' ? await anilist(q, 'ANIME') : ['Манга', 'Манхва', 'Ранобэ'].includes(c) ? await anilist(q, 'MANGA') : await tmdb(q);
    if (tk !== afTok) return; box.replaceChildren(); if (!res.length) return box.append(el('div', 'meta', 'Ничего не найдено.'));
    res.forEach(r => {
      const row = el('div', 'afr'), im = el('img'), t = el('div');
      im.loading = 'lazy'; im.src = safePosterUrl(r.poster);
      t.append(el('b', null, r.title), el('div', 'meta', `${r.category} • ${r.year || '?'}${r.ext ? ' • ★ ' + r.ext : ''}`));
      row.append(im, t);
      row.onclick = async () => { fillForm(r); box.replaceChildren(); if (r.tmdb) { try { await tmdbExtra(r); } catch (e) {} } };
      box.append(row);
    });
  } catch (e) { box.replaceChildren(el('div', 'meta', 'Ошибка поиска: ' + e.message)); }
};
$('afQuery').onkeydown = e => { if (e.key === 'Enter') $('afBtn').click(); };

// ---------- Расчёт времени просмотра и пересмотров (Б4) ----------
function formatWatchTimeRu(totalMinutes) {
  const totalHours = Math.round((totalMinutes || 0) / 60);
  if (totalHours <= 0) return '0 часов';
  const days = Math.floor(totalHours / 24), remHours = totalHours % 24;
  const dStr = days > 0 ? `${days} ${pluralRu(days, 'день', 'дня', 'дней')}` : '';
  const hStr = remHours > 0 ? `${remHours} ${pluralRu(remHours, 'час', 'часа', 'часов')}` : '';
  return (days > 0 && remHours > 0) ? `${dStr} и ${hStr}` : (days > 0 ? dStr : hStr);
}

function getBaseItemMinutes(item) {
  if (item.category === 'Манга' || item.category === 'Ранобэ') return 0;
  const eps = num(item.eps), dur = num(item.dur);
  if (eps > 0 && dur > 0) return eps * dur;
  if (eps > 0) return eps * (item.category === 'Сериал' ? 42 : 24);
  if (dur > 0) return dur;
  if (item.category === 'Аниме') return item.format === 'MOVIE' ? 105 : 12 * 24;
  if (item.category === 'Сериал') return 10 * 42;
  if (item.category === 'Фильм' || item.category === 'Мультфильм') return 105;
  return 0;
}

// Умножает время на (1 + число повторных просмотров) согласно пункту Б4
function getItemMinutes(item) {
  const base = getBaseItemMinutes(item);
  const mult = 1 + Math.max(0, num(item.rewatchCount));
  return base * mult;
}

function getItemEpisodesCount(item) {
  if (item.category === 'Манга' || item.category === 'Ранобэ') return 0;
  const eps = num(item.eps);
  const base = eps > 0 ? eps : (item.category === 'Аниме' ? (item.format === 'MOVIE' ? 1 : 12) : item.category === 'Сериал' ? 10 : 1);
  return base * (1 + Math.max(0, num(item.rewatchCount)));
}

function isCompletedItem(item) {
  if (item.archived) return false;
  return item.status === 'Просмотрено/Прочитано' || item.status === 'Пересматриваю';
}

// Фоновое связывание коллекции с каталогом объявлено ниже в блоке управления данными
function backfillMissingDurations() { resumeBackgroundCatalogLinkingIfNeeded(); }

// ---------- Статистика и блоки Профиля ----------
const MON = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'], PAL = ['#7c5cff','#38bdf8','#10b981','#f59e0b','#ec4899','#ef4444'];
function topBy(f) { const c = {}; getVisibleItems().forEach(i => f(i).forEach(x => c[x] = (c[x] || 0) + 1)); return Object.entries(c).sort((a, b) => b[1] - a[1]); }

function buildStats(b) {
  const vis = getVisibleItems().filter(i => !i.archived);
  b.replaceChildren();
  if (!vis.length) {
    b.append(el('div', 'msg', 'В коллекции пока нет тайтлов для расчёта статистики.'));
    return;
  }

  const total = vis.length;
  const avgMine = arr => {
    const rated = arr.filter(i => num(i.rating) > 0);
    return rated.length ? (rated.reduce((s, i) => s + num(i.rating), 0) / rated.length).toFixed(1).replace(/\.0$/, '') + ' / 10' : '—';
  };
  const pctStr = cnt => Math.round((cnt / Math.max(1, total)) * 100) + '%';

  // Верхние сводные показатели
  const kpiRow = el('div', 'stats-kpi-row');
  const addKpi = (val, lbl) => {
    const box = el('div', 'stats-kpi-box');
    box.append(el('b', null, String(val)), el('span', null, lbl));
    kpiRow.append(box);
  };
  const doneCount = vis.filter(isCompletedItem).length;
  const totalRewatches = vis.reduce((s, i) => s + num(i.rewatchCount), 0);
  const totalWatchTime = formatWatchTimeRu(vis.filter(isCompletedItem).reduce((s, i) => s + getItemMinutes(i), 0));
  addKpi(`${total} шт.`, 'Всего в коллекции');
  addKpi(`${doneCount} шт. (${pctStr(doneCount)})`, 'Завершено');
  addKpi(avgMine(vis), 'Средняя оценка');
  addKpi(totalWatchTime, 'Время просмотра');
  if (totalRewatches > 0) addKpi(`${totalRewatches} раз`, 'Всего пересмотров');
  b.append(kpiRow);

  // Круговые диаграммы (donut-графики) по статусам и по категориям с легендой
  const makeDonutCard = (title, entries) => {
    const card = el('div', 'stats-donut-card');
    card.append(el('h4', null, title));
    const activeEntries = entries.filter(e => e.count > 0);
    const sum = activeEntries.reduce((s, e) => s + e.count, 0) || 1;
    const row = el('div', 'row');
    row.style.gap = '14px';
    row.style.alignItems = 'center';
    const donut = el('div', 'donut');
    const legend = el('div', 'lg');
    legend.style.flex = '1';
    let acc = 0;
    const gradParts = [];
    activeEntries.forEach((entry, idx) => {
      const startPct = (acc / sum) * 100;
      acc += entry.count;
      const endPct = (acc / sum) * 100;
      const color = entry.color || PAL[idx % PAL.length];
      gradParts.push(`${color} ${startPct.toFixed(1)}% ${endPct.toFixed(1)}%`);
      const lgRow = el('div');
      lgRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12.5px';
      const left = el('span');
      left.style.cssText = 'display:inline-flex;align-items:center;gap:7px';
      const dot = el('i');
      dot.style.background = color;
      left.append(dot, document.createTextNode(entry.label));
      const right = el('b', null, `${entry.count} шт. (${Math.round((entry.count / sum) * 100)}%)`);
      right.style.fontSize = '12px';
      lgRow.append(left, right);
      legend.append(lgRow);
    });
    donut.style.background = gradParts.length ? `conic-gradient(${gradParts.join(',')})` : 'var(--bd)';
    row.append(donut, legend);
    card.append(row);
    return card;
  };

  const statusEntries = [
    { label: 'В планах', count: vis.filter(i => i.status === 'В планах').length, color: '#a855f7' },
    { label: 'Смотрю / Читаю', count: vis.filter(i => i.status === 'Смотрю/Читаю' || i.status === 'Пересматриваю').length, color: '#10b981' },
    { label: 'Просмотрено / Прочитано', count: vis.filter(i => i.status === 'Просмотрено/Прочитано').length, color: '#38bdf8' },
    { label: 'Брошено', count: vis.filter(i => i.status === 'Брошено').length, color: '#ef4444' }
  ];
  const typeDefs = [
    { label: 'Аниме', flt: i => i.category === 'Аниме', color: '#7c5cff' },
    { label: 'Фильмы', flt: i => i.category === 'Фильм' || i.category === 'Мультфильм', color: '#38bdf8' },
    { label: 'Сериалы', flt: i => i.category === 'Сериал', color: '#10b981' },
    { label: 'Манга', flt: i => i.category === 'Манга', color: '#f59e0b' },
    { label: 'Ранобэ', flt: i => i.category === 'Ранобэ', color: '#ec4899' }
  ];
  const catEntries = typeDefs.map(td => ({ label: td.label, count: vis.filter(td.flt).length, color: td.color }));

  const donutsGrid = el('div', 'stats-grid-2');
  donutsGrid.append(
    makeDonutCard('По статусам', statusEntries),
    makeDonutCard('По категориям', catEntries)
  );
  b.append(donutsGrid);

  const addSection = (title, rows) => {
    if (!rows.length) return;
    const h = el('h4', null, title);
    h.style.margin = '12px 0 6px';
    b.append(h);
    rows.forEach(([label, valText]) => {
      const r = el('div', 'sr');
      r.append(el('span', null, label), el('span', 'sr-val', valText));
      b.append(r);
    });
  };

  // 1. По типам (Аниме, Фильмы, Сериалы, Манга, Ранобэ): точное количество штук цифрами и средняя оценка
  const typeRows = typeDefs.map(td => {
    const arr = vis.filter(td.flt);
    return [td.label, `${arr.length} шт. · ср. оценка: ${avgMine(arr)}`];
  });
  addSection('По типам (количество и средняя оценка)', typeRows);

  // 2. По статусам (В планах, Смотрю, Просмотрено, Брошено, Любимое): точное количество штук и доля в %
  const favCount = vis.filter(i => i.fav).length;
  const rewatchingCount = vis.filter(i => i.status === 'Пересматриваю').length;
  const statusRows = [
    ['В планах', statusEntries[0].count],
    ['Смотрю / Читаю', vis.filter(i => i.status === 'Смотрю/Читаю').length],
    ['Просмотрено / Прочитано', statusEntries[2].count],
    ['Пересматриваю', rewatchingCount],
    ['Брошено', statusEntries[3].count],
    ['❤ Любимое', favCount]
  ].map(([lbl, cnt]) => [lbl, `${cnt} шт. (${pctStr(cnt)})`]);
  addSection('По статусам (количество и доля в коллекции)', statusRows);

  // 3. Частые жанры и теги: в процентах (%) от коллекции и количеством, без зелёных полосок
  const tc = {};
  vis.forEach(i => (i.tags || []).forEach(t => { tc[t] = (tc[t] || 0) + 1; }));
  const tagRows = Object.entries(tc)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([t, c]) => [t, `${pctStr(c)} (${c} шт.)`]);
  addSection('Частые жанры и теги', tagRows);

  // Дополнительные аккуратные сводки без полосок
  const myTop = vis.filter(i => num(i.rating) > 0).sort((a, b) => num(b.rating) - num(a.rating)).slice(0, 5);
  if (myTop.length) {
    addSection('Топ по моей оценке', myTop.map(i => [i.title, `★ ${i.rating} / 10`]));
  }
  const cntWithPct = f => {
    const c = {};
    vis.forEach(i => f(i).forEach(x => { c[x] = (c[x] || 0) + 1; }));
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => [t, `${n} шт. (${pctStr(n)})`]);
  };
  const decMap = {};
  vis.forEach(i => { if (i.year) { const d = Math.floor(i.year / 10) * 10 + '-е'; decMap[d] = (decMap[d] || 0) + 1; } });
  const decRows = Object.entries(decMap).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).map(([d, n]) => [d, `${n} шт. (${pctStr(n)})`]);
  addSection('По десятилетиям', decRows);
  addSection('Топ студий', cntWithPct(i => spl(i.studio)));
  addSection('Топ авторов и режиссёров', cntWithPct(i => spl(i.author)));
}

const openFullStatsModal = () => {
  $('hybMorePop')?.classList.remove('open');
  $('colMorePop')?.classList.remove('open');
  buildStats($('statsBody'));
  $('statsModal').style.display = 'flex';
};
if ($('statsBtn')) $('statsBtn').onclick = openFullStatsModal;
if ($('colStatsBtn')) $('colStatsBtn').onclick = openFullStatsModal;

function profStrips() {
  const vis = getVisibleItems();
  const box = $('profStrips'); if (!box) return;
  box.replaceChildren();
  const favList = vis
    .filter(i => !i.archived && i.fav)
    .sort((a, b) => (num(b.rating) || num(b.extRating)) - (num(a.rating) || num(a.extRating)))
    .slice(0, 18);

  if (favList.length) {
    const card = el('div', 'anix-sec-card');
    card.style.marginBottom = '10px';
    card.append(el('h4', 'sec', `❤ Любимые произведения (${favList.length})`));
    const w = el('div', 'strip');
    favList.forEach(i => {
      const m = el('div', 'mini'), im = el('img');
      im.loading = 'lazy'; im.src = safePosterUrl(i.poster); im.onerror = () => { im.onerror = null; im.src = FALL; };
      m.append(im, el('span', null, i.title));
      m.onclick = () => openDetail(i.id);
      w.append(m);
    });
    card.append(w);
    box.append(card);
  }

  const favChars = prof.favChars || [];
  if (favChars.length) {
    const card = el('div', 'anix-sec-card');
    card.append(el('h4', 'sec', `🌟 Мои любимые герои (${favChars.length})`));
    const w = el('div', 'strip');
    favChars.forEach(fc => {
      const m = el('div', 'mini'), im = el('img');
      im.loading = 'lazy'; im.src = safePosterUrl(fc.img); im.onerror = () => { im.onerror = null; im.src = FALL; };
      m.append(im, el('span', null, fc.name));
      m.onclick = () => openCharacterPopup(fc);
      w.append(m);
    });
    card.append(w);
    box.append(card);
  }
}

function profStats() {
  const vis = getVisibleItems();
  const activeCount = vis.filter(i => !i.archived).length;
  const pct = activeCount ? Math.round(vis.filter(isCompletedItem).length / activeCount * 100) : 0;
  if ($('profRing')) $('profRing').style.setProperty('--p', pct);
  if ($('profRingTxt')) $('profRingTxt').textContent = pct + '%';
  profStrips();
}
if ($('hybMoreBtn')) {
  $('hybMoreBtn').onclick = e => {
    e.stopPropagation();
    $('hybMorePop')?.classList.toggle('open');
  };
}
if ($('colMoreBtn')) {
  $('colMoreBtn').onclick = e => {
    e.stopPropagation();
    $('colMorePop')?.classList.toggle('open');
  };
}
$('accBtn').onclick = e => { e.stopPropagation(); $('accMenu').classList.toggle('open'); };
$('accProfile').onclick = () => { document.querySelector('.tab[data-v="profile"]')?.click(); };

$('rndBtn').onclick = () => {
  if (!lastList.length) return toast('В текущем списке пусто. Попробуй сбросить фильтры.');
  openDetail(lastList[Math.floor(Math.random() * lastList.length)].id);
};

// ---------- Чипы фильтров и расширенный массовый выбор (Этап 3 п.5) ----------
function renderChips() {
  const box = $('chips'); if (!box) return; box.replaceChildren();
  const add = (t, fn) => { const c = el('button', 'chip', t + ' ✕'); c.onclick = fn; box.append(c); };
  if ($('searchInput').value.trim()) add('🔍 ' + $('searchInput').value.trim(), () => { $('searchInput').value = ''; render(); });
  if ($('statusFilter').value !== 'Все') add($('statusFilter').value, () => { $('statusFilter').value = 'Все'; render(); });
  if ($('tagFilter').value !== 'Все') add('Жанр: ' + $('tagFilter').selectedOptions[0].textContent, () => { $('tagFilter').value = 'Все'; render(); });
  if ($('listFilter').value !== 'Все') add($('listFilter').selectedOptions[0].textContent, () => { $('listFilter').value = 'Все'; render(); });
}

window._recentlyDeletedIds = window._recentlyDeletedIds || new Set();

function selHas(id) {
  if (id == null) return false;
  return selSet.has(id) || selSet.has(Number(id)) || selSet.has(String(id));
}
function selAdd(id) {
  if (id == null) return;
  selSet.delete(String(id));
  selSet.delete(Number(id));
  const numId = Number(id);
  selSet.add(Number.isNaN(numId) ? String(id) : numId);
}
function selDelete(id) {
  selSet.delete(id);
  selSet.delete(Number(id));
  selSet.delete(String(id));
}

function selPaint() {
  [...grid.children].forEach(c => {
    if (!c.classList || !c.dataset.id) return;
    c.classList.toggle('sel', !!(selMode && selHas(c.dataset.id)));
  });
  if ($('selN')) $('selN').textContent = 'Выбрано: ' + selSet.size;
  if ($('selAllBtn')) $('selAllBtn').textContent = `Выбрать все (${lastList.length})`;
}

function selToggle(on) {
  selMode = on;
  if (!on) {
    selSet.clear();
    $('selSecGroup')?.classList.remove('open');
  }
  $('selbar').style.display = on ? 'flex' : 'none';
  $('selBtn').classList.toggle('on', on);
  document.body.classList.toggle('selmode', on);
  selPaint();
}
if ($('selMoreMobBtn')) {
  $('selMoreMobBtn').onclick = e => {
    e.stopPropagation();
    const grp = $('selSecGroup');
    if (!grp) return;
    const isOpen = grp.classList.toggle('open');
    $('selMoreMobBtn').textContent = isOpen ? '▴ Скрыть' : '⋯ Ещё';
  };
}

grid.addEventListener('click', e => {
  if (!selMode) return;
  const c = e.target.closest('.card');
  if (!c) return;
  e.preventDefault();
  e.stopPropagation();
  const rawId = c.dataset.id;
  if (!rawId) return;
  if (selHas(rawId)) selDelete(rawId);
  else selAdd(rawId);
  selPaint();
}, true);

$('selBtn').onclick = () => selToggle(!selMode);
$('selOff').onclick = () => selToggle(false);

if ($('selAllBtn')) {
  $('selAllBtn').onclick = () => {
    lastList.forEach(i => selAdd(i.id));
    selPaint();
  };
}
if ($('selClearBtn')) {
  $('selClearBtn').onclick = () => {
    selSet.clear();
    selPaint();
  };
}
if ($('selInvBtn')) {
  $('selInvBtn').onclick = () => {
    lastList.forEach(i => {
      if (selHas(i.id)) selDelete(i.id);
      else selAdd(i.id);
    });
    selPaint();
  };
}
if ($('selByStatus')) {
  $('selByStatus').replaceChildren(
    new Option('Выбрать всё в статусе…', ''),
    ...STATS.map(x => new Option(getStatusLabelForCategory(x, cat), x)),
    new Option('❤ В любимом', '__fav__')
  );
  $('selByStatus').onchange = () => {
    const v = $('selByStatus').value;
    $('selByStatus').value = '';
    if (!v) return;
    const pool = (lastList || []).filter(i => v === '__fav__' ? !!i.fav : i.status === v);
    pool.forEach(i => selAdd(i.id));
    selPaint();
    toast(`Выделено в текущем списке: ${pool.length} шт.`);
  };
}

$('selSt').replaceChildren(new Option('Сменить статус…', ''), ...STATS.map(x => new Option(x, x)));
$('selSt').onchange = async () => {
  const v = $('selSt').value;
  $('selSt').value = '';
  if (!v || !selSet.size) return;
  const hit = items.filter(i => selHas(i.id));
  hit.forEach(i => {
    i.status = v;
    i.needsReview = false;
    if (v === 'Просмотрено/Прочитано' && !i.completedAt) i.completedAt = Date.now();
  });
  await batchSaveItems(hit);
  refresh();
  toast(`Статус «${v}» установлен для ${hit.length} тайтлов`);
};

$('selList').onclick = async () => {
  if (!selSet.size) return toast('Сначала выбери тайтлы');
  const existingFolders = [...new Set([...(prof.customLists || []), ...items.flatMap(i => i.lists || [])])].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ru'));
  let pickedName = '', newInput = null;
  const ok = await dlgOpen(() => {
    $('dlgTitle').textContent = `📁 Добавить в подборку (${selSet.size} шт.)`;
    $('dlgText').textContent = existingFolders.length ? 'Нажми на созданную подборку или введи новую ниже:' : 'Создай новую подборку для выбранных тайтлов:';
    const body = $('dlgBody'); body.replaceChildren();
    if (existingFolders.length) {
      const chipsWrap = el('div', 'chips');
      existingFolders.forEach(fn => {
        const b = el('button', 'btn btn-s', '📁 ' + fn);
        b.type = 'button';
        b.style.cssText = 'padding:7px 12px;font-size:13px';
        b.onclick = () => {
          pickedName = fn;
          $('dlgOk').click();
        };
        chipsWrap.append(b);
      });
      body.append(chipsWrap);
    }
    newInput = el('input');
    newInput.placeholder = 'Или название новой подборки…';
    newInput.onkeydown = e => { if (e.key === 'Enter') $('dlgOk').click(); };
    body.append(newInput);
  }, 'Добавить', false, () => (pickedName || (newInput?.value || '').trim()));

  const nm = (ok || '').trim();
  if (!nm) return;
  const hit = items.filter(i => selHas(i.id));
  prof.customLists = prof.customLists || [];
  if (!prof.customLists.some(x => x.toLowerCase() === nm.toLowerCase())) prof.customLists.push(nm);
  hit.forEach(i => {
    i.lists = i.lists || [];
    if (!i.lists.some(x => x.toLowerCase() === nm.toLowerCase())) i.lists.push(nm);
  });
  profCloud();
  await batchSaveItems(hit);
  refresh();
  toast(`В подборку «${nm}» добавлено: ${hit.length}`);
};

if ($('selUnlist')) {
  $('selUnlist').onclick = async () => {
    if (!selSet.size) return toast('Сначала выбери тайтлы');
    const hit = items.filter(i => selHas(i.id));
    const foldersInSel = [...new Set(hit.flatMap(i => i.lists || []))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ru'));
    if (!foldersInSel.length) return toast('У выбранных тайтлов нет подборок');
    let pickedFolder = null;
    const ok = await dlgOpen(() => {
      $('dlgTitle').textContent = `📁− Убрать из подборки (${hit.length} шт.)`;
      $('dlgText').textContent = 'Нажми на подборку, из которой хочешь убрать выбранные тайтлы:';
      const body = $('dlgBody'); body.replaceChildren();
      const chipsWrap = el('div', 'chips');
      foldersInSel.forEach(fn => {
        const b = el('button', 'btn btn-s', '✕ ' + fn);
        b.type = 'button';
        b.style.cssText = 'padding:7px 12px;font-size:13px';
        b.onclick = () => { pickedFolder = fn.toLowerCase(); $('dlgOk').click(); };
        chipsWrap.append(b);
      });
      const allB = el('button', 'btn btn-d', '🗑 Убрать из всех подборок');
      allB.type = 'button';
      allB.style.cssText = 'padding:7px 12px;font-size:13px';
      allB.onclick = () => { pickedFolder = '__ALL__'; $('dlgOk').click(); };
      body.append(chipsWrap, allB);
    }, 'Готово', false, () => pickedFolder);

    if (!ok) return;
    hit.forEach(i => {
      if (ok === '__ALL__') i.lists = [];
      else i.lists = (i.lists || []).filter(x => x.toLowerCase() !== ok);
    });
    await batchSaveItems(hit);
    refresh();
    toast(ok === '__ALL__' ? `Убрано из всех подборок (${hit.length} шт.)` : `Убрано из подборки (${hit.length} шт.)`);
  };
}

if ($('selFavBtn')) {
  $('selFavBtn').onclick = async () => {
    if (!selSet.size) return toast('Сначала выбери тайтлы');
    const hit = items.filter(i => selHas(i.id));
    const turnOn = hit.some(i => !i.fav);
    hit.forEach(i => { i.fav = turnOn; });
    await batchSaveItems(hit);
    refresh();
    toast(turnOn ? `Добавлено в ❤ Любимое: ${hit.length} шт.` : `Убрано из ❤ Любимого: ${hit.length} шт.`);
  };
}

if ($('selLinkCatBtn')) {
  $('selLinkCatBtn').onclick = async () => {
    if (!selSet.size) return toast('Сначала выбери тайтлы');
    const hit = items.filter(i => selHas(i.id));
    selToggle(false);
    await startCatalogLinkingForList(hit, true);
  };
}

$('selDel').onclick = async () => {
  if (!selSet.size) return toast('Сначала выбери тайтлы');
  const toDelete = items.filter(i => selHas(i.id));
  if (!toDelete.length) return;
  const visibleIds = new Set((lastList || []).map(x => x.id));
  const hiddenSelectedCount = toDelete.filter(i => !visibleIds.has(i.id)).length;
  const hiddenNote = hiddenSelectedCount > 0 ? `\n⚠ Внимание: из выбранных сейчас НЕ видно на экране (скрыто фильтрами): ${hiddenSelectedCount} шт.` : '\n(Все выбранные тайтлы видны в текущем списке)';
  const typedCount = await uiPrompt(`Удаление ${toDelete.length} тайтлов${hiddenNote}\n\nЧтобы подтвердить удаление, введи число ${toDelete.length}:`, '', String(toDelete.length));
  if (String(typedCount || '').trim() !== String(toDelete.length)) return toast('Массовое удаление отменено (число не совпало)');
  selToggle(false);
  await batchDeleteItemsWithUndo(toDelete, `Удалено тайтлов: ${toDelete.length}`);
};

document.querySelectorAll('#botnav button').forEach(b => b.onclick = () => {
  const g = b.dataset.go || 'catalog';
  document.querySelector(`.tab[data-v="${g}"]`)?.click();
  window.scrollTo({top: 0, behavior: 'smooth'});
});

const handleCreateNewListPrompt = async () => {
  const name = ((await uiPrompt('Создать новую подборку (папку)', '', 'Например: Любимое фэнтези, Шедевры...')) || '').trim();
  if (!name) return;
  prof.customLists = prof.customLists || [];
  if (!prof.customLists.some(x => x.toLowerCase() === name.toLowerCase())) prof.customLists.push(name);
  profCloud(); refreshLists(); $('listFilter').value = name.toLowerCase(); render(); renderMyListsFolderBlock();
  toast(`Подборка «${name}» создана!`);
};
$('createListBtn').onclick = handleCreateNewListPrompt;
if ($('createListTopBtn')) $('createListTopBtn').onclick = handleCreateNewListPrompt;
if ($('deleteListBtn')) {
  $('deleteListBtn').onclick = () => {
    const curVal = $('listFilter').value;
    if (curVal && curVal !== 'Все') deleteCollectionFolder(curVal);
  };
}
$('manageListBtn').onclick = async () => {
  const curVal = $('listFilter').value; if (curVal === 'Все') return;
  const allNames = [...(prof.customLists || []), ...items.flatMap(i => i.lists || [])];
  const canonical = allNames.find(x => x && x.toLowerCase() === curVal) || curVal;
  prof.listMeta = prof.listMeta || {}; const lm = prof.listMeta[canonical] || {};
  const res = await uiListDialog(canonical, lm.desc || '', lm.cn || '', LCOL); if (!res) return;
  const nn = res.name; delete prof.listMeta[canonical];
  prof.customLists = (prof.customLists || []).filter(x => x.toLowerCase() !== canonical.toLowerCase());
  if (nn) { prof.customLists.push(nn); prof.listMeta[nn] = {desc: res.desc, cn: res.cn}; }
  const changed = [];
  items.forEach(i => {
    if ((i.lists || []).some(x => x.toLowerCase() === canonical.toLowerCase())) {
      i.lists = i.lists.filter(x => x.toLowerCase() !== canonical.toLowerCase());
      if (nn && !i.lists.includes(nn)) i.lists.push(nn);
      changed.push(i);
    }
  });
  profCloud();
  if (changed.length) await batchSaveItems(changed);
  refresh(); $('listFilter').value = nn ? nn.toLowerCase() : 'Все'; render();
  toast(nn ? `Подборка «${nn}» сохранена` : `Подборка «${canonical}» удалена`);
};

// ---------- Каталог (AniList и TMDB) с кликабельной панелью жанров/тегов, полосой подкатегорий и живой подборкой ----------
// Часть 1 п.4: Убрана кнопка «✕ Не показывать в каталоге» (.hid / cgHid)
// Часть 1 п.5: Не восстанавливаем старые жанровые фильтры из localStorage при перезагрузке страницы, чтобы выдача не оказывалась скрыто урезанной на телефоне
const cg = {g: 'Аниме', page: 1, q: '', t: 0, hide: false, min: 0, feedSeedPage: 1}, cgGrid = $('cgGrid');
const has = r => items.some(i => same(i, r));
const cgKey = r => r.url || r.title + '|' + r.category;
try { localStorage.removeItem('cgHid'); localStorage.removeItem('cgTagStateV2'); } catch (e) {}

// Состояние кликабельных жанров и тегов: Map(key -> 1 (включить, зелёный) | -1 (исключить, красный))
const cgTagState = new Map();
const saveCgTagState = () => {};

const cgPass = r => !(cg.hide && has(r)) && num(r.ext) >= cg.min;

const CLASSIC_GENRES = [
  ['g:Action', 'Экшен'], ['g:Adventure', 'Приключения'], ['g:Comedy', 'Комедия'], ['g:Drama', 'Драма'],
  ['g:Ecchi', 'Этти'], ['g:Fantasy', 'Фэнтези'], ['g:Hentai', 'Хентай (18+)'], ['g:Mahou Shoujo', 'Махо-сёдзё'],
  ['g:Mecha', 'Меха'], ['g:Music', 'Музыка'], ['g:Mystery', 'Детектив'], ['g:Psychological', 'Психология'],
  ['g:Romance', 'Романтика'], ['g:Sci-Fi', 'Научная фантастика'], ['g:Slice of Life', 'Повседневность'],
  ['g:Sports', 'Спорт'], ['g:Supernatural', 'Сверхъестественное'], ['g:Thriller', 'Триллер'], ['g:Horror', 'Ужасы']
];
const ROMANCE_REL_TAGS = [
  ["t:Yuri", "Юри (Yuri — женская любовь)"], ["t:Yaoi", "Яой (Yaoi — мужская любовь)"],
  ["t:Age Gap", "Разница в возрасте (Age Gap)"], ["t:Love Triangle", "Любовный треугольник"],
  ["t:Unrequited Love", "Безответная любовь"], ["t:Harem", "Гарем"], ["t:Reverse Harem", "Обратный гарем"],
  ["t:Marriage", "Брак / Семейные узы"], ["t:Cohabitation", "Совместная жизнь"]
];
const THEME_PLOT_TAGS = [
  ["t:Magic", "Магия (Magic)"], ["t:Animals", "Животные (Animals)"],
  ["t:Gore", "Жестокость и насилие (Gore / Violence)"], ["t:Slavery", "Рабство (Slavery)"],
  ["t:Isekai", "Исэкай"], ["t:Reincarnation", "Реинкарнация"], ["t:Vampire", "Вампиры"], ["t:Demons", "Демоны"],
  ["t:Dragons", "Драконы"], ["t:Elf", "Эльфы"], ["t:Witch", "Ведьмы"], ["t:Cyberpunk", "Киберпанк"],
  ["t:Post-Apocalyptic", "Постапокалипсис"], ["t:Time Travel", "Путешествия во времени"],
  ["t:Survival", "Выживание"], ["t:Revenge", "Месть"], ["t:Detective", "Детектив"],
  ["t:Military", "Военное"], ["t:School", "Школа"], ["t:Mythology", "Мифология"], ["t:Space", "Космос"]
];
const EXTRA_SENSITIVE_TAGS = [
  ["t:Drugs", "Наркотики (Narcotics / Drugs)"], ["t:Crime", "Криминал и мафия"], ["t:Yakuza", "Якудза"],
  ["t:Bullying", "Буллинг / Травля"], ["t:Tragedy", "Трагедия"], ["t:Death Game", "Игра на выживание"],
  ["t:Body Horror", "Боди-хоррор"], ["t:Amnesia", "Амнезия"], ["t:Yandere", "Яндере"], ["t:Tsundere", "Цундере"],
  ["t:Anti-Hero", "Антигерой"], ["t:Monster Girl", "Монстро-девочки"], ["t:Idol", "Айдолы"],
  ["t:Video Games", "Видеоигры"], ["t:Iyashikei", "Ийясикэй (Умиротворение)"],
  ["t:Seinen", "Демография: Сэйнэн"], ["t:Shounen", "Демография: Сёнэн"],
  ["t:Shoujo", "Демография: Сёдзё"], ["t:Josei", "Демография: Дзёсэй"]
];
const CANONICAL_TAG_SYNONYMS = {
  "Yuri": ["Yuri", "Girls' Love", "Юри", "Юри / Сёдзё-ай (Girls’ Love)"],
  "Girls' Love": ["Yuri", "Girls' Love", "Юри", "Юри / Сёдзё-ай (Girls’ Love)"],
  "Yaoi": ["Yaoi", "Boys' Love", "Яой", "Яой / Сёнэн-ай (Boys’ Love)"],
  "Boys' Love": ["Yaoi", "Boys' Love", "Яой", "Яой / Сёнэн-ай (Boys’ Love)"],
  "Gore": ["Gore", "Violence", "Graphic Violence", "Жестокость (гор)", "Жестокость и насилие"],
  "Drugs": ["Drugs", "Narcotics", "Наркотики"]
};
const MOVIE_G = [28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 10770, 53, 10752, 37];
const TV_G = [10759, 16, 35, 80, 99, 18, 10751, 10762, 9648, 10763, 10764, 10765, 10766, 10767, 10768, 37];
// Маппинг жанров Фильмов <-> Сериалов для TMDB (Часть 2 Важные баги: 28/12 <-> 10759, 14/878 <-> 10765, 10752 <-> 10768)
const TMDB_GENRE_EQUIV = {
  '28': ['28', '10759'],
  '12': ['12', '10759'],
  '10759': ['10759', '28', '12'],
  '14': ['14', '10765'],
  '878': ['878', '10765'],
  '10765': ['10765', '14', '878'],
  '10752': ['10752', '10768'],
  '10768': ['10768', '10752']
};
function mapTmdbGenreIdForMedia(idStr, mediaType) {
  const s = String(idStr);
  if (mediaType === 'tv') {
    if (s === '28' || s === '12') return '10759';
    if (s === '14' || s === '878') return '10765';
    if (s === '10752') return '10768';
  } else if (mediaType === 'movie') {
    if (s === '10759') return '28';
    if (s === '10765') return '878';
    if (s === '10768') return '10752';
  }
  return s;
}

function aniOptions() {
  const adult = ($('cgAge')?.value || '') !== '';
  const flt = arr => arr.filter(([v]) => (adult || v !== 'g:Hentai' || cgTagState.has(v)));
  return [
    ['Жанры (1 клик — включить, 2 клик — исключить)', flt(CLASSIC_GENRES)],
    ['Романтика и отношения', flt(ROMANCE_REL_TAGS)],
    ['Темы и сюжет', flt(THEME_PLOT_TAGS)],
    ['Демография и дополнительные теги', flt(EXTRA_SENSITIVE_TAGS)]
  ].filter(([, list]) => list.length > 0);
}

// Выпадающая кнопка выбора категории в каталоге (с открытием при наведении и клике) + объединение «Фильмы и сериалы»
function renderCatalogSubKindBar() {
  const bar = $('cgSubKindBar');
  if (!bar) return;
  bar.replaceChildren();
  const defs = [
    ['Все', 'Все категории'],
    ['Аниме', 'Аниме'],
    ['Кино и сериалы', 'Фильмы и сериалы'],
    ['Манга', 'Манга'],
    ['Ранобэ', 'Ранобэ']
  ];
  const curNorm = (cg.g === 'Фильм' || cg.g === 'Сериал') ? 'Кино и сериалы' : cg.g;
  const curLabel = (defs.find(d => d[0] === curNorm) || defs[1])[1];

  const wrap = el('div', 'cat-dd-wrap');
  wrap.id = 'cgCatDropdownWrap';
  const btn = el('button', 'cat-dd-btn', `Категория: ${curLabel} ▾`);
  btn.id = 'cgCatDropdownBtn';
  btn.type = 'button';
  btn.onclick = e => {
    e.stopPropagation();
    if (wrap.dataset.pinned === '1') {
      delete wrap.dataset.pinned;
      wrap.classList.remove('open', 'hover-hold');
    } else {
      wrap.dataset.pinned = '1';
      wrap.classList.add('open');
    }
  };

  const menu = el('div', 'cat-dd-menu');
  defs.forEach(([gVal, gLbl]) => {
    const itemBtn = el('button', curNorm === gVal ? 'on' : '', gLbl);
    itemBtn.type = 'button';
    itemBtn.onclick = e => {
      e.stopPropagation();
      delete wrap.dataset.pinned;
      wrap.classList.remove('open', 'hover-hold');
      cg.g = gVal;
      cg.feedSeedPage = 1;
      document.querySelectorAll('#cgCats .tb').forEach(x => x.classList.toggle('on', x.dataset.g === gVal));
      cgGenres();
      cgLoad(true);
    };
    menu.append(itemBtn);
  });

  wrap.append(btn, menu);
  bar.append(wrap);
}

function updateCatalogFilterBtnState() {
  const btn = $('cgFltBtn'), panel = $('cgFilters');
  if (!btn || !panel) return;
  const isOpen = panel.classList.contains('fopen');
  const cnt = Number(btn.dataset.cnt || 0);
  btn.classList.toggle('on', isOpen || cnt > 0);
  btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  btn.textContent = `Фильтры${cnt > 0 ? ` (${cnt})` : ''} ${isOpen ? '▴' : '▾'}`;
}

function renderCatalogActiveChipsBar() {
  const bar = $('cgActiveChipsBar');
  if (!bar) return;
  bar.replaceChildren();
  const chips = [];
  const addChip = (lbl, onClear) => {
    const b = el('button', 'chip', lbl + ' ✕');
    b.type = 'button';
    b.onclick = onClear;
    chips.push(b);
  };
  if (cg.q) addChip(`🔍 «${cg.q}»`, () => { $('cgSearch').value = ''; cg.q = ''; $('cgClear').style.display = 'none'; cgLoad(true); });
  if ($('cgYear')?.value) addChip(`Год от: ${$('cgYear').value}`, () => { $('cgYear').value = ''; cgLoad(true); });
  if ($('cgYear2')?.value) addChip(`Год до: ${$('cgYear2').value}`, () => { $('cgYear2').value = ''; cgLoad(true); });
  if ($('cgSeason')?.value && cg.g === 'Аниме') addChip(`Сезон: ${$('cgSeason').selectedOptions[0]?.textContent}`, () => { $('cgSeason').value = ''; cgLoad(true); });
  if ($('cgLen')?.value) addChip(`Длина: ${$('cgLen').selectedOptions[0]?.textContent}`, () => { $('cgLen').value = ''; cgLoad(true); });
  if ($('cgCountry')?.value && cg.g === 'Кино и сериалы') addChip(`Страна: ${$('cgCountry').selectedOptions[0]?.textContent}`, () => { $('cgCountry').value = ''; cgLoad(true); });
  if ($('cgAge')?.value && cg.g !== 'Кино и сериалы') addChip(`${$('cgAge').selectedOptions[0]?.textContent}`, () => { $('cgAge').value = ''; cgGenres(); cgLoad(true); });
  if (cg.min > 0) addChip(`★ от ${cg.min}+`, () => { cg.min = 0; $('cgMin').value = '0'; cgLoad(true); });
  if (cg.hide) addChip('👁 Скрыто добавленное', () => { cg.hide = false; $('cgHide').classList.remove('on'); cgLoad(true); });

  const allAniPairs = [...CLASSIC_GENRES, ...ROMANCE_REL_TAGS, ...THEME_PLOT_TAGS, ...EXTRA_SENSITIVE_TAGS];
  cgTagState.forEach((st, k) => {
    if (!st) return;
    let lbl = k;
    if (/^\d+$/.test(k)) lbl = TG[k] || k;
    else {
      const hit = allAniPairs.find(x => x[0] === k);
      if (hit) lbl = hit[1];
    }
    addChip(`${st === 1 ? '✓ ' : '✕ без: '}${lbl}`, () => {
      cgTagState.delete(k);
      cgGenres();
      cgLoad(true);
    });
  });

  if (!chips.length) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  chips.forEach(c => bar.append(c));
}

function updateActiveFiltersCounterUI() {
  const isVideo = cg.g === 'Кино и сериалы' || cg.g === 'Фильм' || cg.g === 'Сериал';
  let tagCnt = 0;
  cgTagState.forEach((st, k) => {
    if (!st) return;
    if (isVideo && /^\d+$/.test(k)) tagCnt++;
    else if (!isVideo && (k.startsWith('g:') || k.startsWith('t:'))) tagCnt++;
  });
  if ($('cgTagsCountBadge')) $('cgTagsCountBadge').textContent = tagCnt ? `(${tagCnt})` : '';
  if ($('cgTagsToggleBtn')) $('cgTagsToggleBtn').classList.toggle('on', tagCnt > 0 || ($('cgTagsPanel')?.style.display !== 'none'));

  let totalActive = tagCnt;
  if ($('cgYear')?.value) totalActive++;
  if ($('cgYear2')?.value) totalActive++;
  if (cg.hide) totalActive++;
  if (cg.min > 0) totalActive++;
  if ($('cgKind')?.value && cg.g === 'Манга') totalActive++;
  if ($('cgAnimeKind')?.value && cg.g === 'Аниме') totalActive++;
  if ($('cgVideoKind')?.value && $('cgVideoKind').value !== 'all' && cg.g === 'Кино и сериалы') totalActive++;
  if ($('cgSeason')?.value && cg.g === 'Аниме') totalActive++;
  if ($('cgLen')?.value) totalActive++;
  if ($('cgAge')?.value && !isVideo) totalActive++;
  if ($('cgCountry')?.value && isVideo) totalActive++;
  if ($('cgActiveFiltersBadge')) $('cgActiveFiltersBadge').textContent = totalActive ? `(${totalActive})` : '';
  if ($('cgFltBtn')) $('cgFltBtn').dataset.cnt = String(totalActive);
  updateCatalogFilterBtnState();

  const srcCap = $('cgSourceCaption');
  if (srcCap) {
    const modeLbl = $('cgMode')?.selectedOptions[0]?.textContent || 'Сейчас актуально';
    srcCap.textContent = isVideo
      ? `🌐 TMDB (${cg.g}) · ${modeLbl}${cg.feedSeedPage > 1 ? ` · лента #${cg.feedSeedPage}` : ''}`
      : `🌐 AniList (${cg.g}) · ${modeLbl}${cg.feedSeedPage > 1 ? ` · лента #${cg.feedSeedPage}` : ''}`;
  }
  renderCatalogSubKindBar();
  renderCatalogActiveChipsBar();
}

function cgGenres() {
  const isVideo = cg.g === 'Кино и сериалы' || cg.g === 'Фильм' || cg.g === 'Сериал';
  const groups = isVideo
    ? [['Жанры кино и сериалов (1 клик — включить, 2 клик — исключить)', [...new Set([...MOVIE_G, ...TV_G])].map(k => [String(k), TG[k]]).filter(x => x[1])]]
    : aniOptions();

  const panel = $('cgTagsPanel');
  if (panel) {
    panel.replaceChildren();
    groups.forEach(([gTitle, list]) => {
      const sec = el('div');
      sec.append(el('div', 'cg-tag-group-title', gTitle));
      const row = el('div', 'cg-tag-chips');
      list.forEach(([valKey, label]) => {
        const b = el('button', 'cg-tchip', label);
        b.type = 'button';
        b.dataset.k = valKey;
        const st = cgTagState.get(valKey) || 0;
        if (st === 1) b.dataset.state = 'inc';
        else if (st === -1) b.dataset.state = 'exc';
        b.onclick = () => {
          const cur = cgTagState.get(valKey) || 0;
          const next = cur === 0 ? 1 : cur === 1 ? -1 : 0;
          if (next === 0) { cgTagState.delete(valKey); delete b.dataset.state; }
          else { cgTagState.set(valKey, next); b.dataset.state = next === 1 ? 'inc' : 'exc'; }
          saveCgTagState();
          updateActiveFiltersCounterUI();
          cgLoad(true);
        };
        row.append(b);
      });
      sec.append(row);
      panel.append(sec);
    });
  }

  if ($('cgAnimeKind')) $('cgAnimeKind').style.display = cg.g === 'Аниме' ? '' : 'none';
  if ($('cgKind')) $('cgKind').style.display = cg.g === 'Манга' ? '' : 'none';
  if ($('cgVideoKind')) $('cgVideoKind').style.display = cg.g === 'Кино и сериалы' ? '' : 'none';
  $('cgCountry').style.display = isVideo ? '' : 'none';
  $('cgSeason').style.display = cg.g === 'Аниме' ? '' : 'none';
  $('cgAge').style.display = isVideo ? 'none' : '';
  const L = cg.g === 'Аниме' ? [['', 'Любая длина'], ['s', 'Короткие (до 13 серий)'], ['m', 'До 26 серий'], ['l', 'Длинные (50+ серий)']] : isVideo ? [['', 'Любая длина'], ['s', 'До 100 минут'], ['m', 'До 130 минут'], ['l', 'Длинные (от 150 мин)']] : cg.g === 'Манга' ? [['', 'Любой объём'], ['s', 'Короткие (до 30 глав)'], ['m', 'До 100 глав'], ['l', 'Длинные (200+ глав)']] : [['', 'Любая длина']];
  const prevLen = $('cgLen').value;
  $('cgLen').replaceChildren(...L.map(([v, t]) => new Option(t, v)));
  if ([...$('cgLen').options].some(o => o.value === prevLen)) $('cgLen').value = prevLen;
  $('cgLen').style.display = L.length > 1 ? '' : 'none';
  updateActiveFiltersCounterUI();
}
cgGenres();

if ($('cgTagsToggleBtn')) {
  $('cgTagsToggleBtn').onclick = () => {
    const p = $('cgTagsPanel');
    if (!p) return;
    const show = p.style.display === 'none';
    p.style.display = show ? 'flex' : 'none';
    updateActiveFiltersCounterUI();
  };
}
if ($('cgAnimeKind')) $('cgAnimeKind').addEventListener('change', () => { updateActiveFiltersCounterUI(); cgLoad(true); });
if ($('cgVideoKind')) $('cgVideoKind').addEventListener('change', () => { updateActiveFiltersCounterUI(); cgLoad(true); });

function getActiveCatalogTagLists() {
  const isVideo = cg.g === 'Кино и сериалы' || cg.g === 'Фильм' || cg.g === 'Сериал';
  const incG = [], excG = [], incT = [], excT = [], incVid = [], excVid = [];
  cgTagState.forEach((st, k) => {
    if (!st) return;
    if (isVideo && /^\d+$/.test(k)) {
      if (st === 1) incVid.push(k);
      else if (st === -1) excVid.push(k);
    } else if (!isVideo) {
      if (k.startsWith('g:')) {
        if (st === 1) incG.push(k.slice(2));
        else if (st === -1) excG.push(k.slice(2));
      } else if (k.startsWith('t:')) {
        if (st === 1) incT.push(k.slice(2));
        else if (st === -1) excT.push(k.slice(2));
      }
    }
  });
  return { incG, excG, incT, excT, incVid, excVid };
}

function verifyCatalogItemMatchesFilters(r) {
  const { incG, excG, incT, excT, incVid, excVid } = getActiveCatalogTagLists();
  const ageMode = $('cgAge')?.value || '';
  const isVideo = cg.g === 'Кино и сериалы' || cg.g === 'Фильм' || cg.g === 'Сериал';
  const yrFrom = parseInt($('cgYear')?.value) || 0;
  const yrTo = parseInt($('cgYear2')?.value) || 0;
  const itemYr = parseInt(r.year) || 0;
  if (yrFrom && itemYr && itemYr < yrFrom) return false;
  if (yrTo && itemYr && itemYr > yrTo) return false;

  if (!isVideo && r.src === 'AniList') {
    const hasHentai = (r.rawGenres || []).includes('Hentai') || (r.tags || []).some(t => /хентай|hentai/i.test(t));
    if (ageMode === '' && (r.isAdult || hasHentai)) return false;
    if (ageMode === 'only' && !(r.isAdult || hasHentai)) return false;
    if (cg.g === 'Аниме') {
      const ak = $('cgAnimeKind')?.value || '';
      if (ak === 'MOVIE' && r.format && r.format !== 'MOVIE') return false;
      if (ak === 'TV' && r.format && r.format === 'MOVIE') return false;
    } else if (cg.g === 'Манга') {
      const mk = $('cgKind')?.value || '';
      if (mk === 'COMIC' && (r.subKind || r.kind) !== 'Комикс') return false;
      if (mk === 'JP' && (r.subKind || r.kind || 'Манга') !== 'Манга') return false;
      if (mk === 'KR' && (r.subKind || r.kind) !== 'Манхва') return false;
      if (mk === 'CN' && (r.subKind || r.kind) !== 'Маньхуа') return false;
    }
    const itemHasGenre = gEn => {
      const gRu = RU[gEn] || gEn;
      return (r.rawGenres || []).some(x => x.toLowerCase() === gEn.toLowerCase()) || (r.tags || []).some(x => x.toLowerCase() === gRu.toLowerCase());
    };
    const itemHasTag = tEn => {
      const valid = (CANONICAL_TAG_SYNONYMS[tEn] || [tEn, ruTag(tEn)]).map(s => s.toLowerCase());
      return (r.rawTags || []).some(x => valid.includes(x.toLowerCase())) || (r.tags || []).some(x => valid.includes(x.toLowerCase()));
    };
    for (const g of incG) if (!itemHasGenre(g)) return false;
    for (const g of excG) if (itemHasGenre(g)) return false;
    for (const t of incT) if (!itemHasTag(t)) return false;
    for (const t of excT) if (itemHasTag(t)) return false;
  } else if (isVideo) {
    const vk = $('cgVideoKind')?.value || 'all';
    if (cg.g === 'Кино и сериалы') {
      if (vk === 'movie' && r.category !== 'Фильм') return false;
      if (vk === 'tv' && r.category !== 'Сериал') return false;
    }
    const matchesTmdbGenre = id => {
      const equivIds = TMDB_GENRE_EQUIV[String(id)] || [String(id)];
      return equivIds.some(eqId => TG[eqId] && (r.tags || []).includes(TG[eqId]));
    };
    for (const id of incVid) if (!matchesTmdbGenre(id)) return false;
    for (const id of excVid) if (matchesTmdbGenre(id)) return false;
  }
  return true;
}

// Запрос фильмов/сериалов TMDB с маппингом жанров Movie <-> TV (Часть 2 Важные баги)
async function cgFetchSingleVideo(m, page, q, mode) {
  const { incVid, excVid } = getActiveCatalogTagLists();
  const mappedInc = [...new Set(incVid.map(id => mapTmdbGenreIdForMedia(id, m)))];
  const mappedExc = [...new Set(excVid.map(id => mapTmdbGenreIdForMedia(id, m)))];
  const gens = mappedInc.join(','), withoutGens = mappedExc.join(','), len = $('cgLen').value;
  const yrFrom = parseInt($('cgYear').value) || 0;
  const yrTo = parseInt($('cgYear2').value) || 0;
  const iso = d => d.toISOString().slice(0, 10), today = iso(new Date()), ago = n => iso(new Date(Date.now() - n * 864e5));
  const mv = m === 'movie', dk = mv ? 'primary_release_date' : 'first_air_date', yk = mv ? 'primary_release_year' : 'first_air_date_year', cty = $('cgCountry').value;
  const rt = mv ? ({s: '&with_runtime.lte=100', m: '&with_runtime.lte=130', l: '&with_runtime.gte=150'}[len] || '') : '';
  const EX = {date: `sort_by=${dk}.desc&${dk}.lte=${today}&vote_count.gte=20`, votes: 'sort_by=vote_count.desc&vote_count.gte=100', month: `sort_by=popularity.desc&${dk}.gte=${ago(30)}&${dk}.lte=${today}`, hidden: 'sort_by=vote_average.desc&vote_count.gte=150&vote_count.lte=1500', classic: `sort_by=vote_average.desc&vote_count.gte=1000&${dk}.lte=1999-12-31`, rare: 'sort_by=vote_average.desc&vote_count.gte=50&vote_count.lte=400'};
  let yearFilterParams = '';
  if (yrFrom && yrTo) yearFilterParams = `&${dk}.gte=${yrFrom}-01-01&${dk}.lte=${yrTo}-12-31`;
  else if (yrFrom) yearFilterParams = `&${dk}.gte=${yrFrom}-01-01`;
  else if (yrTo) yearFilterParams = `&${dk}.lte=${yrTo}-12-31`;

  const hasNarrowVideoFilters = Boolean(gens || withoutGens || yrFrom || yrTo || cty || rt);
  let path = '';
  if (q) {
    path = `/search/${m}?query=${encodeURIComponent(q)}${(yrFrom && yrTo && yrFrom === yrTo) ? '&' + (mv ? 'year' : yk) + '=' + yrFrom : ''}`;
    return tmdb(null, path, m, page);
  }
  if ((mode === 'actual' || !mode) && !hasNarrowVideoFilters) {
    const [trList, nowList] = await Promise.all([
      tmdb(null, `/trending/${m}/week`, m, page).catch(() => []),
      tmdb(null, mv ? '/movie/now_playing' : '/tv/on_the_air', m, page).catch(() => [])
    ]);
    return interleaveAndDedupCatalogLists([trList, nowList]);
  }
  if (mode === 'trend' && !hasNarrowVideoFilters) {
    return tmdb(null, `/trending/${m}/week`, m, page);
  }
  if (hasNarrowVideoFilters || EX[mode] || mode === 'soon' || mode === 'trend' || mode === 'actual') {
    path = `/discover/${m}?` + (EX[mode] || (mode === 'top' ? 'sort_by=vote_average.desc&vote_count.gte=300' : (mode === 'new' || mode === 'actual') ? `sort_by=popularity.desc&${dk}.gte=${ago(180)}&${dk}.lte=${today}` : 'sort_by=popularity.desc'))
      + (gens ? '&with_genres=' + gens : '')
      + (withoutGens ? '&without_genres=' + withoutGens : '')
      + yearFilterParams
      + (mode === 'soon' ? `&${dk}.gte=${today}` : '')
      + (cty ? '&with_origin_country=' + cty : '') + rt;
  } else {
    path = mode === 'top' ? `/${m}/top_rated` : mode === 'new' ? (mv ? '/movie/now_playing' : '/tv/on_the_air') : `/${m}/popular`;
  }
  return tmdb(null, path, m, page);
}

function getCurrentAnimeSeasonAndYear() {
  const d = new Date(), m = d.getMonth(), y = d.getFullYear();
  const se = (m < 2 || m === 11) ? 'WINTER' : m < 5 ? 'SPRING' : m < 8 ? 'SUMMER' : 'FALL';
  return { se, sy: y };
}

function interleaveAndDedupCatalogLists(lists) {
  const out = [];
  const seen = new Set();
  const maxLen = Math.max(0, ...lists.map(l => (l || []).length));
  for (let idx = 0; idx < maxLen; idx++) {
    for (const arr of lists) {
      const r = arr && arr[idx];
      if (!r) continue;
      const key = r.aniId ? `ani_${r.aniId}` : r.tmdb ? `tmdb_${r.tmdb}` : r.mal ? `mal_${r.mal}` : `${r.category}_${normTitleStr(r.title)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

function getCachedCatalogMatchesForRuQuery(q, gFilter) {
  const ql = (q || '').toLowerCase().trim();
  if (!ql) return [];
  const out = [];
  const seen = new Set();
  for (const entry of ALC.values()) {
    for (const r of (entry.v || [])) {
      if (!r || !r.title) continue;
      if (gFilter && gFilter !== 'Все') {
        if (gFilter === 'Кино и сериалы' && r.category !== 'Фильм' && r.category !== 'Сериал') continue;
        else if (gFilter !== 'Кино и сериалы' && r.category !== gFilter) continue;
      }
      const hay = [r.title, r.en, r.orig, r.alt].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(ql)) continue;
      const k = r.aniId ? `ani_${r.aniId}` : r.tmdb ? `tmdb_${r.tmdb}` : r.title;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ ...r });
    }
  }
  return out;
}


// ---------- Каталог западных комиксов и графических романов (Каталог -> Манга -> Комикс) ----------
const CURATED_COMICS_DB = [
  { title: 'Хранители', en: 'Watchmen', author: 'Алан Мур, Дэйв Гиббонс', studio: 'DC Comics', year: '1986', ext: '9.1', eps: 12, vols: 1, tags: ['Фантастика', 'Драма', 'Детектив', 'Психология', 'Супергерои'], poster: 'https://upload.wikimedia.org/wikipedia/en/a/a2/Watchmen%2C_issue_1.jpg', desc: 'Альтернативная Америка 1985 года на грани ядерной войны. Убийство бывшего правительственного супергероя Комедианта заставляет Роршаха начать собственное расследование заговора.' },
  { title: 'Песочный человек', en: 'The Sandman', author: 'Нил Гейман', studio: 'DC / Vertigo', year: '1989', ext: '9.0', eps: 75, vols: 10, tags: ['Фэнтези', 'Драма', 'Ужасы', 'Сверхъестественное', 'Мифология'], poster: 'https://upload.wikimedia.org/wikipedia/en/9/9f/Sandman_no_1_%28DC_Comics%29.jpg', desc: 'Морфей, Повелитель Снов и один из Вечных, освобождается после 70-летнего плена у оккультистов и отправляется восстанавливать разрушенное Царство Сновидений.' },
  { title: 'Неуязвимый', en: 'Invincible', author: 'Роберт Киркман, Кори Уокер', studio: 'Image Comics', year: '2003', ext: '8.9', eps: 144, vols: 25, tags: ['Экшен', 'Фантастика', 'Драма', 'Супергерои', 'Приключения'], poster: 'https://upload.wikimedia.org/wikipedia/en/0/07/Invincible_1.png', desc: 'Семнадцатилетний Марк Грейсон — сын Омни-Мэна, самого могущественного супергероя Земли. Унаследовав сверхспособности отца, Марк узнаёт страшную правду о его настоящей миссии.' },
  { title: 'Ходячие мертвецы', en: 'The Walking Dead', author: 'Роберт Киркман, Тони Мур', studio: 'Image Comics', year: '2003', ext: '8.7', eps: 193, vols: 32, tags: ['Ужасы', 'Драма', 'Выживание', 'Постапокалипсис', 'Триллер'], poster: 'https://upload.wikimedia.org/wikipedia/en/8/8c/Walking_Dead_1.jpg', desc: 'Помощник шерифа Рик Граймс выходит из комы в мире, охваченном зомби-апокалипсисом, и возглавляет группу выживших, где главную опасность представляют не мертвецы, а люди.' },
  { title: 'Сага', en: 'Saga', author: 'Брайан К. Вон, Фиона Стэйплз', studio: 'Image Comics', year: '2012', ext: '8.9', eps: 66, vols: 11, ongoing: true, tags: ['Фантастика', 'Фэнтези', 'Драма', 'Романтика', 'Приключения'], poster: 'https://upload.wikimedia.org/wikipedia/en/7/7c/Saga_1_cover.jpg', desc: 'Эпическая космоопера о влюблённых солдатах из двух враждующих галактических рас — Алане и Марко, которые пытаются защитить свою новорождённую дочь Хейзел от обеих империй.' },
  { title: 'Бэтмен: Год первый', en: 'Batman: Year One', author: 'Фрэнк Миллер, Дэвид Маццукелли', studio: 'DC Comics', year: '1987', ext: '8.8', eps: 4, vols: 1, tags: ['Экшен', 'Криминал', 'Драма', 'Детектив', 'Супергерои'], poster: 'https://upload.wikimedia.org/wikipedia/en/5/52/Batman_Year_One.jpg', desc: 'История первого года Брюса Уэйна в роли Бэтмена и лейтенанта Джеймса Гордона в погрязшем в коррупции Готэме.' },
  { title: 'Бэтмен: Возвращение Тёмного рыцаря', en: 'Batman: The Dark Knight Returns', author: 'Фрэнк Миллер', studio: 'DC Comics', year: '1986', ext: '9.0', eps: 4, vols: 1, tags: ['Экшен', 'Драма', 'Криминал', 'Антиутопия', 'Супергерои'], poster: 'https://upload.wikimedia.org/wikipedia/en/7/74/Dark_knight_returns.jpg', desc: '55-летний Брюс Уэйн спустя десять лет после ухода на покой вновь надевает плащ Бэтмена, чтобы спасти Готэм от банды мутантов и сойтись в поединке с Суперменом.' },
  { title: 'Бэтмен: Долгий Хэллоуин', en: 'Batman: The Long Halloween', author: 'Джеф Лоэб, Тим Сейл', studio: 'DC Comics', year: '1996', ext: '8.9', eps: 13, vols: 1, tags: ['Детектив', 'Криминал', 'Драма', 'Триллер', 'Супергерои'], poster: 'https://upload.wikimedia.org/wikipedia/en/6/6f/Batman_The_Long_Halloween.jpg', desc: 'Загадочный серийный убийца по прозвищу Праздник совершает покушения на мафиозные кланы Готэма строго по праздничным дням календаря.' },
  { title: 'Бэтмен: Убийственная шутка', en: 'Batman: The Killing Joke', author: 'Алан Мур, Брайан Болланд', studio: 'DC Comics', year: '1988', ext: '8.7', eps: 1, vols: 1, tags: ['Психология', 'Триллер', 'Драма', 'Криминал', 'Супергерои'], poster: 'https://upload.wikimedia.org/wikipedia/en/3/32/Killingjoke.JPG', desc: 'Психологическое противостояние Бэтмена и Джокера, решившего доказать, что всего один безумный день способен свести с ума даже самого стойкого человека.' },
  { title: 'V — значит Вендетта', en: 'V for Vendetta', author: 'Алан Мур, Дэвид Ллойд', studio: 'DC / Vertigo', year: '1982', ext: '8.8', eps: 10, vols: 1, tags: ['Антиутопия', 'Драма', 'Триллер', 'Политика'], poster: 'https://upload.wikimedia.org/wikipedia/en/c/c0/V_for_vendettax.jpg', desc: 'В тоталитарной Великобритании недалёкого будущего таинственный анархист в маске Гая Фокса начинает одиночную войну против фашистского режима.' },
  { title: 'Город грехов', en: 'Sin City', author: 'Фрэнк Миллер', studio: 'Dark Horse Comics', year: '1991', ext: '8.6', eps: 40, vols: 7, tags: ['Криминал', 'Триллер', 'Экшен', 'Драма', 'Детектив'], poster: 'https://upload.wikimedia.org/wikipedia/en/f/f6/Sin_City_Hard_Goodbye.jpg', desc: 'Черно-белый неонуар о жестоких улицах Бэйсин-Сити, где громила Марв и другие антигерои ищут возмездия в мире продажных политиков и мафии.' },
  { title: 'Хеллбой', en: 'Hellboy', author: 'Майк Миньола', studio: 'Dark Horse Comics', year: '1994', ext: '8.5', eps: 90, vols: 12, tags: ['Фэнтези', 'Ужасы', 'Экшен', 'Сверхъестественное', 'Мифология'], poster: 'https://upload.wikimedia.org/wikipedia/en/9/91/Hellboy_-_Seed_of_Destruction_1.jpg', desc: 'Демон из Ада, призванный оккультистами в 1944 году, но воспитанный людьми, становится лучшим агентом Бюро паранормальных исследований и обороны.' },
  { title: 'Спаун', en: 'Spawn', author: 'Тодд Макфарлейн', studio: 'Image Comics', year: '1992', ext: '8.3', eps: 350, vols: 30, ongoing: true, tags: ['Экшен', 'Ужасы', 'Сверхъестественное', 'Антигерой', 'Супергерои'], poster: 'https://upload.wikimedia.org/wikipedia/en/0/05/Spawn_issue_1.jpg', desc: 'Наёмник Эл Симмонс после предательства и гибели заключает сделку с демоном Мэлболгией, чтобы ещё раз увидеть жену, и возвращается на Землю в облике Хеллспауна.' },
  { title: 'Проповедник', en: 'Preacher', author: 'Гарт Эннис, Стив Диллон', studio: 'DC / Vertigo', year: '1995', ext: '8.7', eps: 66, vols: 9, tags: ['Приключения', 'Фэнтези', 'Драма', 'Чёрная комедия', 'Сверхъестественное'], poster: 'https://upload.wikimedia.org/wikipedia/en/a/a1/Preacher1.jpg', desc: 'Техасский проповедник Джесси Кастер обретает сверхъестественный голос Слова Божьего и вместе с бывшей возлюбленной Тюлип и вампиром Кэссиди отправляется искать сбежавшего с Небес Бога.' },
  { title: 'Скотт Пилигрим', en: 'Scott Pilgrim', author: 'Брайан Ли О’Мэлли', studio: 'Oni Press', year: '2004', ext: '8.6', eps: 6, vols: 6, tags: ['Комедия', 'Романтика', 'Экшен', 'Повседневность', 'Музыка'], poster: 'https://upload.wikimedia.org/wikipedia/en/1/10/Scott_Pilgrim_1.jpg', desc: 'Беззаботный бас-гитарист из Торонто Скотт Пилигрим влюбляется в девушку своей мечты Рамону Флауэрс, но чтобы встречаться с ней, ему предстоит победить семерых её злых бывших.' },
  { title: 'Пацаны', en: 'The Boys', author: 'Гарт Эннис, Дарик Робертсон', studio: 'WildStorm / Dynamite', year: '2006', ext: '8.2', eps: 72, vols: 12, tags: ['Экшен', 'Чёрная комедия', 'Фантастика', 'Супергерои', 'Триллер'], poster: 'https://upload.wikimedia.org/wikipedia/en/f/f6/The_Boys_Issue_1.jpg', desc: 'Секретный отряд ЦРУ под руководством Билли Бутчера держит в узде коррумпированных и вышедших из-под контроля супергероев корпорации Vought.' },
  { title: 'Трансметрополитен', en: 'Transmetropolitan', author: 'Уоррен Эллис, Дарик Робертсон', studio: 'DC / Vertigo', year: '1997', ext: '8.8', eps: 60, vols: 10, tags: ['Киберпанк', 'Фантастика', 'Сатира', 'Политика', 'Драма'], poster: 'https://upload.wikimedia.org/wikipedia/en/4/4b/Transmetropolitan_1.jpg', desc: 'Гонзо-журналист Спайдер Иерусалим возвращается в безумный мегаполис будущего, чтобы с помощью правды и сатиры сокрушить двух продажных кандидатов в президенты.' },
  { title: 'Сказки', en: 'Fables', author: 'Билл Уиллингем', studio: 'DC / Vertigo', year: '2002', ext: '8.5', eps: 150, vols: 22, tags: ['Фэнтези', 'Детектив', 'Драма', 'Сказка', 'Мифология'], poster: 'https://upload.wikimedia.org/wikipedia/en/0/00/Fables1.jpg', desc: 'Герои классических сказок, изгнанные из своих волшебных земель таинственным Врагом, тайно живут в районе Нью-Йорка под присмотром шерифа Бигби Волка.' },
  { title: 'Лок и Ключ', en: 'Locke & Key', author: 'Джо Хилл, Габриэль Родригес', studio: 'IDW Publishing', year: '2008', ext: '8.6', eps: 37, vols: 6, tags: ['Ужасы', 'Фэнтези', 'Триллер', 'Детектив', 'Сверхъестественное'], poster: 'https://upload.wikimedia.org/wikipedia/en/9/9f/Locke_and_Key_Welcome_to_Lovecraft.jpg', desc: 'После трагической гибели отца трое детей семьи Лок переезжают в фамильное поместье Дом Ключей, где находят магические ключи, дарующие невероятные способности и пробуждающие древнее зло.' },
  { title: 'Человек-паук: Последняя охота Крэйвена', en: "Spider-Man: Kraven's Last Hunt", author: 'Дж. М. ДеМаттейс, Майк Зек', studio: 'Marvel Comics', year: '1987', ext: '8.8', eps: 6, vols: 1, tags: ['Экшен', 'Драма', 'Психология', 'Супергерои'], poster: 'https://upload.wikimedia.org/wikipedia/en/7/75/Web_of_Spider-Man_31.jpg', desc: 'Крэйвен-охотник одерживает победу над Человеком-пауком, хоронит его заживо и сам надевает чёрный костюм Паука, чтобы доказать своё превосходство.' },
  { title: 'Совершенный Человек-паук', en: 'Ultimate Spider-Man', author: 'Брайан Майкл Бендис, Марк Багли', studio: 'Marvel Comics', year: '2000', ext: '8.7', eps: 160, vols: 22, tags: ['Экшен', 'Приключения', 'Драма', 'Школа', 'Супергерои'], poster: 'https://upload.wikimedia.org/wikipedia/en/3/35/Ultimate_Spider-Man_1.png', desc: 'Современное переосмысление истории юного Питера Паркера — от укуса генетически изменённого паука до сражений с Зелёным Гоблином, Веномом и Зловещей Шестёркой.' },
  { title: 'Сорвиголова: Рождённый заново', en: 'Daredevil: Born Again', author: 'Фрэнк Миллер, Дэвид Маццукелли', studio: 'Marvel Comics', year: '1986', ext: '8.9', eps: 7, vols: 1, tags: ['Криминал', 'Драма', 'Экшен', 'Триллер', 'Супергерои'], poster: 'https://upload.wikimedia.org/wikipedia/en/6/64/Daredevil_227.jpg', desc: 'Узнав тайну личности Сорвиголовы, Кингпин методично разрушает жизнь адвоката Мэтта Мёрдока, толкая его на грань безумия в Адской Кухне.' },
  { title: 'Супермен: Все звёзды', en: 'All-Star Superman', author: 'Грант Моррисон, Фрэнк Куайтли', studio: 'DC Comics', year: '2005', ext: '8.7', eps: 12, vols: 2, tags: ['Фантастика', 'Приключения', 'Драма', 'Супергерои'], poster: 'https://upload.wikimedia.org/wikipedia/en/3/30/All_Star_Superman_1.jpg', desc: 'Получив смертельную дозу солнечной радиации из-за ловушки Лекса Лютора, Супермен решает совершить двенадцать великих подвигов в оставшееся ему время.' },
  { title: 'Маус', en: 'Maus', author: 'Арт Шпигельман', studio: 'Pantheon Books', year: '1980', ext: '9.2', eps: 12, vols: 2, tags: ['Историческое', 'Драма', 'Военное'], poster: 'https://upload.wikimedia.org/wikipedia/en/7/7d/Maus_%28volume_1%29_cover.jpg', desc: 'Единственный графический роман, удостоенный Пулитцеровской премии: биографическая история отца автора, пережившего Холокост.' }
];

async function fetchCatalogComics(page, q, mode) {
  const ql = (q || '').toLowerCase().trim();
  const baseCurated = CURATED_COMICS_DB.map((c, idx) => ({
    id: 900000 + idx,
    title: c.title,
    en: c.en,
    orig: c.en,
    alt: '',
    author: c.author,
    studio: c.studio,
    year: c.year,
    ext: c.ext,
    eps: c.eps,
    vols: c.vols,
    ongoing: !!c.ongoing,
    tags: c.tags,
    rawGenres: c.tags,
    rawTags: c.tags,
    poster: c.poster,
    desc: c.desc,
    category: 'Манга',
    subKind: 'Комикс',
    kind: 'Комикс',
    source: 'Комикс',
    src: 'Комиксы',
    url: 'https://www.google.com/search?q=' + encodeURIComponent(c.en + ' comic')
  }));

  let filteredCurated = baseCurated;
  if (ql) {
    filteredCurated = baseCurated.filter(c =>
      [c.title, c.en, c.author, c.studio, ...(c.tags || [])].filter(Boolean).join(' ').toLowerCase().includes(ql)
    );
  }
  if (mode === 'top') filteredCurated.sort((a, b) => (parseFloat(b.ext) || 0) - (parseFloat(a.ext) || 0));
  else if (mode === 'date' || mode === 'new') filteredCurated.sort((a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0));
  else if (mode === 'classic') filteredCurated = filteredCurated.filter(c => (parseInt(c.year) || 2005) < 2000);

  // Дополняем живым поиском из Google Books API по комиксам / графическим романам
  let apiComics = [];
  try {
    const startIdx = Math.max(0, (page - 1) * 20);
    const gbQuery = ql ? `${q} subject:comics` : (mode === 'new' ? 'subject:comics+graphic+novel+2024' : 'subject:comics+graphic+novel');
    const gbUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(gbQuery)}&printType=books&maxResults=20&startIndex=${startIdx}`;
    const gbJson = await ruJson(gbUrl, 4500).catch(() => null);
    if (gbJson && Array.isArray(gbJson.items)) {
      apiComics = gbJson.items.map(it => {
        const info = it.volumeInfo || {};
        const titleStr = String(info.title || '').trim();
        if (!titleStr) return null;
        const thumb = (info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || '').replace(/^http:/i, 'https:');
        if (!thumb) return null;
        return {
          title: titleStr,
          en: titleStr,
          orig: titleStr,
          alt: info.subtitle || '',
          author: (info.authors || []).join(', '),
          studio: info.publisher || 'Comics',
          year: String(info.publishedDate || '').slice(0, 4),
          ext: info.averageRating ? Math.min(10, info.averageRating * 2).toFixed(1) : '',
          eps: info.pageCount ? Math.max(1, Math.round(info.pageCount / 28)) : 0,
          vols: 1,
          ongoing: false,
          tags: ['Комикс', ...(info.categories || []).slice(0, 3)],
          rawGenres: info.categories || [],
          rawTags: ['Superhero', 'Comics'],
          poster: thumb,
          desc: info.description ? String(info.description).replace(/<[^>]+>/g, '').trim() : '',
          category: 'Манга',
          subKind: 'Комикс',
          kind: 'Комикс',
          source: 'Комикс',
          src: 'Google Books',
          url: info.infoLink || ''
        };
      }).filter(Boolean);
    }
  } catch (e) {}

  const combined = page === 1
    ? interleaveAndDedupCatalogLists([filteredCurated, apiComics])
    : apiComics.length ? apiComics : filteredCurated.slice((page - 1) * 12, page * 12);
  return combined.filter(verifyCatalogItemMatchesFilters);
}

async function cgFetch(page, per, q, mode) {
  const g = cg.g;
  const effPage = (!q && page === 1 && cg.feedSeedPage > 1) ? cg.feedSeedPage : ((page > 1 && cg.feedSeedPage > 1) ? page + cg.feedSeedPage - 1 : page);
  const cachedHits = (q && page === 1) ? getCachedCatalogMatchesForRuQuery(q, g) : [];

  if (g === 'Все') {
    const [aRes, mRes, fRes, sRes] = await Promise.all([
      anilist(q || null, 'ANIME', { page: effPage, per: 8, sort: [q ? 'SEARCH_MATCH' : 'TRENDING_DESC'], ad: false }).catch(() => []),
      anilist(q || null, 'MANGA', { page: effPage, per: 8, sort: [q ? 'SEARCH_MATCH' : 'TRENDING_DESC'], ad: false }).catch(() => []),
      cgFetchSingleVideo('movie', effPage, q, mode).catch(() => []),
      cgFetchSingleVideo('tv', effPage, q, mode).catch(() => [])
    ]);
    return interleaveAndDedupCatalogLists([cachedHits, aRes, mRes, fRes.slice(0, 6), sRes.slice(0, 6)]);
  }

  if (g === 'Кино и сериалы' || g === 'Фильм' || g === 'Сериал') {
    const vk = g === 'Фильм' ? 'movie' : g === 'Сериал' ? 'tv' : ($('cgVideoKind')?.value || 'all');
    if (vk === 'movie' || vk === 'tv') {
      return (await cgFetchSingleVideo(vk, effPage, q, mode)).filter(verifyCatalogItemMatchesFilters);
    }
    const [r1, r2] = await Promise.all([
      cgFetchSingleVideo('movie', effPage, q, mode).catch(() => []),
      cgFetchSingleVideo('tv', effPage, q, mode).catch(() => [])
    ]);
    return interleaveAndDedupCatalogLists([r1, r2]).filter(verifyCatalogItemMatchesFilters);
  }

  const { incG, excG, incT, excT } = getActiveCatalogTagLists();
  const len = $('cgLen').value, season = $('cgSeason').value;
  const yrFrom = parseInt($('cgYear').value) || 0;
  const yrTo = parseInt($('cgYear2').value) || 0;
  const iso = d => d.toISOString().slice(0, 10), today = iso(new Date()), ago = n => iso(new Date(Date.now() - n * 864e5)), num8 = t => Number(t.replace(/-/g, ''));
  const SO = {actual: 'TRENDING_DESC', top: 'SCORE_DESC', trend: 'TRENDING_DESC', date: 'START_DATE_DESC', votes: 'FAVOURITES_DESC', hidden: 'SCORE_DESC', classic: 'SCORE_DESC', rare: 'SCORE_DESC'};
  const age = $('cgAge').value;
  const baseOpts = {page: effPage, per, ad: age === 'only' ? true : age === 'all' ? undefined : false};
  if (incG.length) baseOpts.genre = incG;
  if (excG.length) baseOpts.genreNot = excG;
  if (incT.length) baseOpts.tag = incT;
  if (excT.length) baseOpts.tagNot = excT;

  if (g === 'Аниме' && season) { baseOpts.se = season; baseOpts.sy = yrFrom || yrTo || new Date().getFullYear(); }
  else {
    if (yrFrom) baseOpts.sg = yrFrom * 10000 - 1;
    if (yrTo) baseOpts.sl = (yrTo + 1) * 10000;
  }
  if (g === 'Аниме') {
    const ak = $('cgAnimeKind')?.value || '';
    if (ak === 'MOVIE') baseOpts.format = 'MOVIE';
    else if (ak === 'TV') baseOpts.fn = 'MOVIE';
    if (len === 's') baseOpts.el = 14; else if (len === 'm') baseOpts.el = 27; else if (len === 'l') baseOpts.eg = 49;
  }
  if (g === 'Манга') { if (len === 's') baseOpts.cl = 31; else if (len === 'm') baseOpts.cl = 101; else if (len === 'l') baseOpts.cg = 199; }
  if (g === 'Ранобэ') baseOpts.format = 'NOVEL';
  if (g === 'Манга') {
    baseOpts.fn = 'NOVEL';
    const mk = $('cgKind')?.value || '';
    if (mk === 'COMIC') {
      return await fetchCatalogComics(effPage, q, mode);
    }
    if (mk === 'JP' || mk === 'KR' || mk === 'CN') baseOpts.country = mk;
  }

  // Живая подборка «🔥 Сейчас актуально» (Часть 3): смесь трендов, активно выходящих онгоингов и текущего сезона
  if (!q && (mode === 'actual' || !mode)) {
    const mType = g === 'Аниме' ? 'ANIME' : 'MANGA';
    if (g === 'Аниме' && !season && !yrFrom && !yrTo) {
      const { se, sy } = getCurrentAnimeSeasonAndYear();
      const [trendRes, airingRes, seasonRes] = await Promise.all([
        anilist(null, 'ANIME', { ...baseOpts, per: 16, sort: ['TRENDING_DESC'] }).catch(() => []),
        anilist(null, 'ANIME', { ...baseOpts, per: 16, status: 'RELEASING', sort: ['POPULARITY_DESC'] }).catch(() => []),
        anilist(null, 'ANIME', { ...baseOpts, per: 16, se, sy, sort: ['POPULARITY_DESC'] }).catch(() => [])
      ]);
      return interleaveAndDedupCatalogLists([trendRes, airingRes, seasonRes]).filter(verifyCatalogItemMatchesFilters);
    }
    const [trendRes, airingRes] = await Promise.all([
      anilist(null, mType, { ...baseOpts, per: 18, sort: ['TRENDING_DESC'] }).catch(() => []),
      anilist(null, mType, { ...baseOpts, per: 18, status: 'RELEASING', sort: ['POPULARITY_DESC'] }).catch(() => [])
    ]);
    return interleaveAndDedupCatalogLists([trendRes, airingRes]).filter(verifyCatalogItemMatchesFilters);
  }

  const o = { ...baseOpts, sort: [q ? 'SEARCH_MATCH' : SO[mode] || 'POPULARITY_DESC'] };
  if (!q) {
    if (mode === 'top' && age !== 'only') o.pg = 3000;
    if (mode === 'new') o.status = 'RELEASING';
    if (mode === 'soon') o.status = 'NOT_YET_RELEASED';
    if (mode === 'date') o.sl = num8(today);
    if (mode === 'month') { o.sg = num8(ago(30)); o.sl = num8(today); }
    if (mode === 'hidden') { o.ag = 75; o.pl = 60000; }
    if (mode === 'classic') { o.sl = 20000101; o.pg = 5000; }
    if (mode === 'rare') { o.ag = 65; o.pl = 15000; }
  }

  let res = await anilist(q || null, g === 'Аниме' ? 'ANIME' : 'MANGA', o);
  if (!res.length && incT.some(t => t === 'Yuri' || t === 'Yaoi')) {
    o.tag = incT.map(t => t === 'Yuri' ? "Girls' Love" : t === 'Yaoi' ? "Boys' Love" : t);
    res = await anilist(q || null, g === 'Аниме' ? 'ANIME' : 'MANGA', o).catch(() => []);
  }
  if (cachedHits.length) {
    res = interleaveAndDedupCatalogLists([cachedHits, res]);
  }
  return res.filter(verifyCatalogItemMatchesFilters);
}

const adding = new Set();
const QUICK_STATUS_OPTIONS = [
  ['В планах', 'В планах', '#5b6b8c', '📋'],
  ['Смотрю/Читаю', 'Смотрю / Читаю', '#2f8fe8', '▶'],
  ['Просмотрено/Прочитано', 'Просмотрено', '#1db57a', '●'],
  ['Брошено', 'Брошено', '#c2543e', '✕'],
  ['Любимое', 'В любимое', '#e0457b', '❤']
];
const SHORT_ST_BTN = {
  'В планах': 'В планах',
  'Смотрю/Читаю': 'Смотрю',
  'Просмотрено/Прочитано': 'Просмотрено',
  'Пересматриваю': 'Пересматриваю',
  'Брошено': 'Брошено'
};
const SHORT_ST_ICON = {
  'В планах': '📋',
  'Смотрю/Читаю': '▶',
  'Просмотрено/Прочитано': '●',
  'Пересматриваю': '🔁',
  'Брошено': '✕',
  'Любимое': '❤'
};

// Быстрый индекс по ID и нормализованным названиям для мгновенного сопоставления каталога с коллекцией
function buildCollectionLookupIndex(pool = items) {
  const byTmdb = new Map(), byImdb = new Map(), byAniId = new Map(), byMal = new Map(), byNormTitle = new Map();
  (pool || []).forEach(it => {
    if (!it) return;
    if (it.tmdb) byTmdb.set(String(it.tmdb), it);
    if (it.imdbId) byImdb.set(String(it.imdbId), it);
    if (Number(it.aniId) > 0) byAniId.set(Number(it.aniId), it);
    if (Number(it.mal) > 0) byMal.set(Number(it.mal), it);
    nset(it).forEach(nt => {
      let arr = byNormTitle.get(nt);
      if (!arr) { arr = []; byNormTitle.set(nt, arr); }
      arr.push(it);
    });
  });
  return { byTmdb, byImdb, byAniId, byMal, byNormTitle };
}

function findInCollectionWithIndex(r, idx) {
  if (!r || !idx) return null;
  if (r.tmdb && idx.byTmdb.has(String(r.tmdb))) return idx.byTmdb.get(String(r.tmdb));
  if (r.imdbId && idx.byImdb.has(String(r.imdbId))) return idx.byImdb.get(String(r.imdbId));
  if (Number(r.aniId) > 0 && idx.byAniId.has(Number(r.aniId))) {
    const hit = idx.byAniId.get(Number(r.aniId));
    if (sameCat(hit.category, r.category)) return hit;
  }
  if (Number(r.mal) > 0 && idx.byMal.has(Number(r.mal))) {
    const hit = idx.byMal.get(Number(r.mal));
    if (sameCat(hit.category, r.category)) return hit;
  }
  const namesR = nset(r);
  const checked = new Set();
  for (const nt of namesR) {
    const bucket = idx.byNormTitle.get(nt);
    if (!bucket) continue;
    for (const cand of bucket) {
      if (checked.has(cand)) continue;
      checked.add(cand);
      if (same(cand, r)) return cand;
    }
  }
  return null;
}

// Единая функция quickAdd(r, targetStatus): выбор «Любимое» ставит сердечко fav:true и автоматически отмечает тайтл просмотренным/прочитанным
async function quickAdd(r, targetStatus = 'В планах') {
  if (!r) return;
  const isFavPick = (targetStatus === 'Любимое' || targetStatus === '❤ Любимое');
  const resolvedSt = isFavPick
    ? 'Просмотрено/Прочитано'
    : ( targetStatus === 'Просмотрено' || targetStatus === 'Прочитано' ? 'Просмотрено/Прочитано' : ( targetStatus === 'Смотрю' || targetStatus === 'Читаю' ? 'Смотрю/Читаю' : (STATS.includes(targetStatus) ? targetStatus : 'В планах') ) );
  const isDoneSt = (resolvedSt === 'Просмотрено/Прочитано' || resolvedSt === 'Пересматриваю');

  const existing = items.find(i => same(i, r));
  if (existing) {
    const prevSt = existing.status;
    const prevFav = !!existing.fav;
    const prevComp = existing.completedAt || 0;
    if (isFavPick) {
      existing.fav = !existing.fav;
      if (existing.fav && existing.status !== 'Просмотрено/Прочитано' && existing.status !== 'Пересматриваю') {
        existing.status = 'Просмотрено/Прочитано';
        if (!existing.completedAt) existing.completedAt = Date.now();
      }
    } else {
      existing.status = resolvedSt;
      existing.needsReview = false;
      if (isDoneSt && !existing.completedAt) existing.completedAt = Date.now();
      else if (resolvedSt === 'В планах') existing.completedAt = 0;
    }
    cloudSave(existing);
    profCloud(true);
    refresh({ itemId: existing.id });
    const stLbl = getStatusLabelForCategory(existing.status, existing.category);
    toast(
      isFavPick
        ? (existing.fav ? `«${existing.title}» отмечено как ❤ Любимое (${stLbl})` : `«${existing.title}» убрано из Любимого`)
        : `Статус «${existing.title}» изменён: ${stLbl}`,
      false,
      {
        label: 'Отменить',
        fn: () => {
          existing.status = prevSt;
          existing.fav = prevFav;
          existing.completedAt = prevComp;
          cloudSave(existing);
          refresh({ itemId: existing.id });
        }
      }
    );
    return existing;
  }

  const ak = r.url || r.title + '|' + r.category;
  if (adding.has(ak)) return;
  adding.add(ak);
  try {
    const newItemId = newId();
    const it = fix({
      id: newItemId, _docId: (user && user.uid ? user.uid + '_' : '') + newItemId,
      addedAt: Date.now(),
      kind: 'title',
      isAdult: Boolean(r.isAdult),
      needsReview: false,
      fav: isFavPick,
      completedAt: isDoneSt ? Date.now() : 0,
      extSrc: r.src || '', title: r.title, category: r.category,
      subKind: r.category === 'Манга' ? (r.subKind || r.kind || 'Манга') : '',
      status: resolvedSt,
      poster: r.poster || '', year: r.year || '', rating: '', extRating: r.ext || '',
      description: r.desc || '', titleEn: r.en || (r.titleEn || ''), titleOrig: r.orig || (r.titleOrig || ''), alt: r.alt || '',
      tags: r.tags || [], author: r.author || '', studio: r.studio || '', source: r.source || '', ongoing: !!r.ongoing,
      trailerId: r.trailerId || ''
    });
    if (r.tmdb) { try { Object.assign(it, await tmdbInfo(r)); } catch (e) {} }
    if (r.tmdb) it.tmdb = r.tmdb;
    if (r.src === 'AniList' || r.aniId || r.mal) {
      it.eps = r.eps || 0; it.vols = r.vols || 0; it.dur = r.dur || 0; it.format = r.format || ''; it.aniId = r.aniId || 0; it.mal = r.mal || 0;
      if (r.src === 'AniList') {
        try { await ruFull(r); it.title = r.title; it.titleEn = r.en || ''; it.description = r.desc || ''; } catch (e) {}
      }
    }
    if (has(r)) { cgMarks(); return items.find(i => same(i, r)); }
    items.push(it); refresh(); cloudSave(it); profCloud(true);
    toast(`Добавлено (${isFavPick ? '❤ Любимое · ' + it.status : it.status}): ${it.title}`, false, {label: 'Отменить', fn: () => removeItem(it.id)});
    return it;
  } finally { adding.delete(ak); }
}

// Меню выбора статуса с цветными точками и перехватом первого клика мимо через #qaMenuBackdrop (Часть 1 п.3 и п.8)
let _qaMenuHideTimer = 0;
let _qaLockCard = null;
function closeQuickAddStatusMenu() {
  $('qaFloatMenu')?.classList.remove('open');
  $('qaMenuBackdrop')?.classList.remove('open');
  if (_qaLockCard) { _qaLockCard.classList.remove('qa-hover-lock'); _qaLockCard = null; }
}

function openQuickAddStatusMenu(anchorBtn, r, onAfterPick = null, fromHover = false) {
  const menu = $('qaFloatMenu'), backdrop = $('qaMenuBackdrop');
  if (!menu || !anchorBtn || !r) return;
  clearTimeout(_qaMenuHideTimer);
  const hostCard = anchorBtn.closest('.card');
  if (_qaLockCard && _qaLockCard !== hostCard) _qaLockCard.classList.remove('qa-hover-lock');
  _qaLockCard = hostCard || null;
  if (_qaLockCard) _qaLockCard.classList.add('qa-hover-lock');

  const existing = items.find(i => same(i, r));
  const itemCat = (existing && existing.category) || r.category || '';
  menu.replaceChildren();

  const hdr = el('div', 'qa-menu-hdr');
  hdr.append(el('span', null, existing ? `В коллекции: ${getStatusLabelForCategory(existing.status, itemCat)}` : 'Добавить в список:'));
  menu.append(hdr);

  QUICK_STATUS_OPTIONS.forEach(([stKey, defaultLabel, dotColor, stIcon]) => {
    const stLabel = stKey === 'Любимое' ? 'В любимое' : getStatusLabelForCategory(stKey, itemCat);
    const b = el('button'); b.type = 'button';
    const isAct = existing && ((stKey === 'Любимое' && existing.fav) || (stKey !== 'Любимое' && existing.status === stKey));
    if (isAct) b.classList.add('active');
    const leftSpan = el('span');
    leftSpan.style.cssText = 'display:inline-flex;align-items:center';
    const dot = el('span', 'st-dot');
    dot.style.background = dotColor;
    leftSpan.append(dot, document.createTextNode(`${stIcon} ${stLabel}`));
    b.append(leftSpan, el('span', 'meta', isAct ? '●' : ''));
    b.onclick = async e => {
      e.stopPropagation();
      closeQuickAddStatusMenu();
      anchorBtn.disabled = true;
      await quickAdd(r, stKey);
      anchorBtn.disabled = false;
      cgMarks();
      if (onAfterPick) onAfterPick(items.find(i => same(i, r)));
    };
    menu.append(b);
  });

  if (existing) {
    const delB = el('button'); delB.type = 'button'; delB.style.color = '#fda4af';
    delB.append(el('span', null, '🗑 Удалить из коллекции'));
    delB.onclick = e => {
      e.stopPropagation();
      closeQuickAddStatusMenu();
      removeItem(existing.id, true);
      if (onAfterPick) onAfterPick(null);
    };
    menu.append(delB);
  }

  menu.classList.add('open');
  if (backdrop) backdrop.classList.toggle('open', !fromHover);
  if (window.innerWidth > 600) {
    const rect = anchorBtn.getBoundingClientRect();
    const menuW = 215;
    const menuH = menu.offsetHeight || 230;
    let left = Math.min(window.innerWidth - menuW - 10, Math.max(10, rect.right - menuW));
    let top = rect.top - menuH - 6;
    if (top < 10) top = Math.min(window.innerHeight - menuH - 10, rect.bottom + 6);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  } else {
    menu.style.left = '';
    menu.style.top = '';
  }
}

{
  const menu = $('qaFloatMenu'), backdrop = $('qaMenuBackdrop');
  if (menu) {
    menu.addEventListener('mouseenter', () => clearTimeout(_qaMenuHideTimer));
    menu.addEventListener('mouseleave', () => {
      if (window.matchMedia('(hover: hover)').matches) {
        _qaMenuHideTimer = setTimeout(() => closeQuickAddStatusMenu(), 220);
      }
    });
  }
  if (backdrop) {
    // Клик по подложке только закрывает меню и НЕ проваливается в карточку под ним (Часть 1 п.8)
    backdrop.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      closeQuickAddStatusMenu();
    });
  }
  window.addEventListener('scroll', () => closeQuickAddStatusMenu(), { passive: true });
}

function removeItem(id, undo) {
  const old = items.find(i => String(i.id) === String(id));
  if (!old) return;
  batchDeleteItemsWithUndo([old], 'Удалено: ' + old.title);
}

// Отрисовка меток на карточках каталога с использованием быстрого индекса по ID и названиям
function cgMarks() {
  const idx = buildCollectionLookupIndex(items);
  [...cgGrid.children].forEach(c => {
    if (!c._r) return;
    const b = c.querySelector('.qa'), m = findInCollectionWithIndex(c._r, idx), pc = c.querySelector('.pc');
    let st = pc.querySelector('.status');
    b.replaceChildren();
    if (m) {
      const colorKey = m.fav ? 'Любимое' : m.status;
      b.dataset.s = colorKey;
      const stLbl = getStatusLabelForCategory(m.status, m.category);
      const ic = el('span', 'qa-ic', m.fav ? '❤' : (SHORT_ST_ICON[m.status] || '●'));
      const lbl = el('span', 'qa-lbl', stLbl);
      b.append(ic, lbl);
      b.title = `В коллекции: ${stLbl}${m.fav ? ' (❤ В любимом)' : ''} — нажми для смены статуса`;
    } else {
      delete b.dataset.s;
      b.append(el('span', 'qa-ic', '＋'));
      b.title = 'Выбрать статус и добавить в коллекцию';
    }
    if (m) {
      if (!st) { st = el('span', 'status'); pc.append(st); }
      st.dataset.s = m.status;
      st.textContent = getStatusLabelForCategory(m.status, m.category) + (m.fav ? ' ❤' : '');
    } else if (st) {
      st.remove();
    }
  });
}

// Отрисовка верхнего слайдера «🔥 Рекомендуем сегодня» (Часть 1)
function renderCatalogHeroSlider(itemsList) {
  const wrap = $('cgHeroWrap'), track = $('cgHeroTrack'), titleEl = $('cgHeroTitle');
  if (!wrap || !track) return;
  if (cg.q || !itemsList || !itemsList.length) {
    wrap.style.display = 'none';
    return;
  }
  const picks = itemsList.slice(0, 10);
  if (!picks.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  if (titleEl) {
    titleEl.textContent = `Рекомендуем сегодня · ${cg.g === "Кино и сериалы" ? "Фильмы и сериалы" : cg.g}`;
  }
  track.replaceChildren();
  picks.forEach(r => {
    const card = el('div', 'cg-hero-card');
    card._r = r;
    const bg = el('div', 'cg-hero-card-bg');
    const bgImgUrl = safePosterUrl(r.banner || r.poster);
    if (bgImgUrl && bgImgUrl !== FALL) {
      bg.style.backgroundImage = `url("${bgImgUrl.replace(/["\\()\r\n]/g, '')}")`;
    }
    const pImg = el('img', 'cg-hero-poster');
    pImg.loading = 'lazy';
    pImg.src = safePosterUrl(r.poster);
    pImg.onerror = () => { pImg.onerror = null; pImg.src = FALL; };

    const body = el('div', 'cg-hero-info');
    const badges = el('div', 'cg-hero-badges');
    if (r.ongoing) badges.append(el('span', 'ong', 'ОНГОИНГ'));
    else if (r.upcoming) badges.append(el('span', 'anon-badge', 'АНОНС'));
    else badges.append(el('span', 'chip', 'В тренде'));
    if (r.ext) badges.append(el('span', 'star', '★ ' + r.ext));

    const fmtStr = (typeof FORMAT_RU !== 'undefined' && FORMAT_RU[r.format]) ? FORMAT_RU[r.format] : catLabel(r);
    const epsStr = r.eps ? (r.eps + (r.category === 'Манга' || r.category === 'Ранобэ' ? ' гл.' : ' эп.')) : '';
    const sub = el('div', 'cg-hero-meta', [r.year, fmtStr, epsStr].filter(Boolean).join(' • '));
    const tgs = el('div', 'cg-hero-tags', (r.tags || []).slice(0, 3).join(', '));
    const tEl = el('div', 'cg-hero-title', r.title);
    body.append(badges, tEl, sub, tgs);
    card.append(bg, pImg, body);
    card.onclick = () => showPreview(r, false);
    track.append(card);
  });
}

if ($('cgHeroPrevBtn')) $('cgHeroPrevBtn').onclick = () => $('cgHeroTrack')?.scrollBy({ left: -360, behavior: 'smooth' });
if ($('cgHeroNextBtn')) $('cgHeroNextBtn').onclick = () => $('cgHeroTrack')?.scrollBy({ left: 360, behavior: 'smooth' });

// Карточка каталога с плашками «ОНГОИНГ» / «АНОНС» и полной строкой метаданных под постером (Часть 1)
function cgCard(r) {
  const card = el('div', 'card'), pc = el('div', 'pc'), img = el('img'), ov = el('div', 'ov'), add = el('button', 'qa');
  add.type = 'button';
  card._r = r; img.loading = 'lazy'; img.src = safePosterUrl(r.poster);
  img.onerror = () => {
    if (img.src.includes('wsrv.nl') && r.poster && !img.dataset.retriedDirect) {
      img.dataset.retriedDirect = '1';
      _wsrvDown = true;
      img.src = r.poster;
      return;
    }
    img.onerror = null;
    img.src = FALL;
  };
  ov.append(el('p', null, r.desc || 'Описание отсутствует.')); add.title = 'Выбрать статус и добавить';
  add.addEventListener('mouseenter', () => {
    if (window.matchMedia('(hover: hover)').matches) openQuickAddStatusMenu(add, r, null, true);
  });
  add.addEventListener('mouseleave', () => {
    if (window.matchMedia('(hover: hover)').matches) {
      _qaMenuHideTimer = setTimeout(() => closeQuickAddStatusMenu(), 240);
    }
  });
  add.onclick = e => {
    e.stopPropagation();
    openQuickAddStatusMenu(add, r);
  };
  pc.append(img, ov, add);
  if (r.ongoing) pc.append(el('div', 'ong', 'ОНГОИНГ'));
  else if (r.upcoming) pc.append(el('div', 'anon-badge', 'АНОНС'));

  const info = el('div', 'ci'), row = el('div', 'cm');
  const fmtStr = (typeof FORMAT_RU !== 'undefined' && FORMAT_RU[r.format]) ? FORMAT_RU[r.format] : catLabel(r);
  const epsStr = r.eps ? (r.eps + (r.category === 'Манга' || r.category === 'Ранобэ' ? ' гл.' : ' эп.')) : '';
  row.append(
    el('span', null, [r.year, fmtStr, epsStr].filter(Boolean).join(' • ')),
    Object.assign(el('span', 'star', r.ext ? '★ ' + r.ext : ''), {title: r.src ? 'Оценка: ' + r.src : 'Внешняя оценка'})
  );
  info.append(Object.assign(el('h3', 'title', r.title), {title: r.title}), row, el('div', 'tg', r.tags.slice(0, 3).join(', ')));
  card.append(pc, info); card.tabIndex = 0;
  card.addEventListener('mouseenter', () => { ensureCardRuDescription(card); });
  card.onclick = () => {
    if ($('qaFloatMenu')?.classList.contains('open')) { closeQuickAddStatusMenu(); return; }
    showPreview(r, false);
  };
  card.onkeydown = e => { if (e.key === 'Enter') showPreview(r, false); };
  cgGrid.append(card);
}

async function cgLoad(reset) {
  updateActiveFiltersCounterUI();
  const t = ++cg.t; let cleared = false, shown = 0, more = true;
  if (reset) {
    cg.page = 1;
    cgGrid.replaceChildren(...Array.from({length: 12}, () => el('div', 'sk')));
    $('cgMore').style.display = 'none';
  }
  try {
    let firstBatchVis = [];
    for (let tries = 0; tries < 5; tries++) {
      const res = await cgFetch(cg.page, 24, cg.q, $('cgMode').value);
      if (t !== cg.t) return;
      if (reset && !cleared) { cgGrid.replaceChildren(); cleared = true; }
      const vis = res.filter(cgPass);
      if (!firstBatchVis.length && vis.length) firstBatchVis = vis;
      vis.forEach(cgCard); shown += vis.length; cg.page++; more = res.length > 0;
      if (!more || shown >= 8 || !(cg.hide || cg.min)) break;
    }
    cgMarks();
    if (reset) {
      renderCatalogHeroSlider(firstBatchVis);
    }
    if (reset && !shown) cgGrid.append(el('div', 'msg', more ? 'Под выбранные фильтры тут ничего не подошло — нажми «Показать ещё» или смени фильтры.' : 'Ничего не найдено.'));
    $('cgMore').style.display = more ? '' : 'none';
    ruCards();
  } catch (e) {
    if (t !== cg.t) return;
    if (reset && !shown) {
      const m = el('div', 'msg', 'Ошибка загрузки: ' + e.message + ' '), rb = el('button', 'btn btn-s', 'Повторить');
      rb.onclick = () => cgLoad(true); m.append(rb); cgGrid.replaceChildren(m);
    } else toast('Ошибка загрузки: ' + e.message, true);
  }
}

// Кнопка «🔄 Обновить» — сбрасывает кэш и загружает свежую ленту трендов и сезона (Часть 3)
function refreshCatalogFeedWithNewPage() {
  ALC.clear();
  const nextSeed = 1 + ((cg.feedSeedPage % 6));
  cg.feedSeedPage = nextSeed === cg.feedSeedPage ? 2 : nextSeed;
  updateActiveFiltersCounterUI();
  cgLoad(true);
  toast(`Лента обновлена: свежая подборка #${cg.feedSeedPage} (${cg.g})`);
}
if ($('cgRefreshFeedBtn')) $('cgRefreshFeedBtn').onclick = refreshCatalogFeedWithNewPage;
if ($('cgQuickShuffleBtn')) $('cgQuickShuffleBtn').onclick = refreshCatalogFeedWithNewPage;

document.querySelectorAll('#cgCats .tb').forEach(b => b.onclick = () => {
  document.querySelectorAll('#cgCats .tb').forEach(x => x.classList.toggle('on', x === b));
  cg.g = b.dataset.g;
  cg.feedSeedPage = 1;
  $('cgKind').style.display = cg.g === 'Манга' ? '' : 'none';
  cgGenres(); cgLoad(true);
});
['cgMode', 'cgKind', 'cgYear2', 'cgSeason', 'cgLen', 'cgCountry'].forEach(id => {
  if ($(id)) $(id).onchange = () => { cg.feedSeedPage = 1; updateActiveFiltersCounterUI(); cgLoad(true); };
});
$('cgAge').onchange = () => {
  if ($('cgAge').value === '' && cgTagState.has('g:Hentai')) {
    cgTagState.delete('g:Hentai');
    saveCgTagState();
    toast('Фильтр «Хентай (18+)» сброшен при переключении в режим «Без 18+»');
  }
  cg.feedSeedPage = 1;
  cgGenres();
  cgLoad(true);
};
$('cgNow').onclick = () => {
  const m = new Date().getMonth();
  $('cgSeason').value = m < 2 || m === 11 ? 'WINTER' : m < 5 ? 'SPRING' : m < 8 ? 'SUMMER' : 'FALL';
  $('cgYear').value = new Date().getFullYear();
  if ($('cgSeason').style.display === 'none') toast('Сезоны работают для аниме — открой вкладку «Аниме»');
  cgLoad(true);
};

let cgT; const cgGo = () => { clearTimeout(cgT); cg.q = $('cgSearch').value.trim(); cg.feedSeedPage = 1; cgLoad(true); };
$('cgSearch').oninput = () => { $('cgClear').style.display = $('cgSearch').value ? 'grid' : 'none'; clearTimeout(cgT); cgT = setTimeout(cgGo, 450); };
$('cgSearch').onkeydown = e => { if (e.key === 'Enter') cgGo(); };
$('cgHide').onclick = e => { cg.hide = !cg.hide; e.currentTarget.classList.toggle('on', cg.hide); updateActiveFiltersCounterUI(); cgLoad(true); };
let cgY; $('cgYear').oninput = () => { clearTimeout(cgY); cgY = setTimeout(() => { cg.feedSeedPage = 1; updateActiveFiltersCounterUI(); cgLoad(true); }, 600); };
$('cgReset').onclick = () => {
  cgTagState.clear(); saveCgTagState();
  ['cgYear2', 'cgSeason', 'cgLen', 'cgCountry', 'cgMood', 'cgAge'].forEach(i => { if ($(i)) $(i).value = ''; });
  $('cgSearch').value = ''; cg.q = ''; $('cgYear').value = ''; $('cgKind').value = ''; $('cgMode').value = 'actual';
  if ($('cgAnimeKind')) $('cgAnimeKind').value = '';
  if ($('cgVideoKind')) $('cgVideoKind').value = 'all';
  cg.hide = false; cg.min = 0; cg.feedSeedPage = 1; $('cgMin').value = '0'; $('cgClear').style.display = 'none';
  $('cgHide').classList.remove('on');
  cgGenres(); cgLoad(true);
};
$('cgMore').onclick = () => cgLoad(false);
$('cgMin').onchange = () => { cg.min = +$('cgMin').value || 0; updateActiveFiltersCounterUI(); cgLoad(true); };
$('cgClear').onclick = () => { $('cgSearch').value = ''; $('cgClear').style.display = 'none'; cgGo(); };
$('cgFltBtn').onclick = () => {
  $('cgFilters').classList.toggle('fopen');
  updateCatalogFilterBtnState();
};

const MOODS = {fun: ['g:Comedy', '35'], serious: ['g:Drama', '18'], scary: ['g:Horror', '27'], love: ['g:Romance', '10749'], thrill: ['g:Action', '28'], mystery: ['g:Mystery', '9648'], scifi: ['g:Sci-Fi', '878']};
$('cgMood').onchange = () => {
  const v = $('cgMood').value; if (!v) return; $('cgMood').value = '';
  if (v === 'short') { if ($('cgLen').style.display === 'none') return toast('Для этой категории фильтр длины недоступен'); $('cgLen').value = 's'; return cgLoad(true); }
  const isVideo = cg.g === 'Кино и сериалы' || cg.g === 'Фильм' || cg.g === 'Сериал';
  const key = (MOODS[v] || [])[isVideo ? 1 : 0];
  if (!key) return;
  cgTagState.clear();
  cgTagState.set(key, 1);
  saveCgTagState();
  $('cgMode').value = 'top';
  cgGenres();
  cgLoad(true);
};

// Меню «🎲 Подобрать» (объединяет Случайное, Три варианта, Для тебя и Выбери за меня)
if ($('cgPickMenuBtn')) {
  $('cgPickMenuBtn').onclick = e => {
    e.stopPropagation();
    $('cgPickMenuPop')?.classList.toggle('open');
  };
}


// «✨ Для тебя» использует выбранные кликабельные жанры или любимые жанры из оценок коллекции
if ($('cgRec')) {
  $('cgRec').onclick = async () => {
    $('cgPickMenuPop')?.classList.remove('open');
    const isVideo = cg.g === 'Кино и сериалы' || cg.g === 'Фильм' || cg.g === 'Сериал';
    const { incG, incT, incVid } = getActiveCatalogTagLists();
    if (!incG.length && !incT.length && !incVid.length && items.length) {
      // Если жанры вручную не кликнуты — берём топ-2 жанра из высоко оценённых тайтлов пользователя
      const favGenres = {};
      items.filter(i => num(i.rating) >= 8 || i.fav).forEach(i => (i.tags || []).forEach(t => { favGenres[t] = (favGenres[t] || 0) + 1; }));
      const best = Object.entries(favGenres).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]);
      best.forEach(ruName => {
        if (isVideo) {
          const id = Object.keys(TG).find(k => TG[k].toLowerCase() === ruName.toLowerCase());
          if (id) cgTagState.set(String(id), 1);
        } else {
          const gPair = CLASSIC_GENRES.find(([, l]) => l.toLowerCase() === ruName.toLowerCase());
          if (gPair) cgTagState.set(gPair[0], 1);
        }
      });
      saveCgTagState();
      cgGenres();
    }
    $('cgMode').value = 'top';
    cg.hide = true;
    $('cgHide').classList.add('on');
    await cgLoad(true);
    toast('✨ Подобрано для тебя с учётом выбранных жанров и топ-рейтинга!');
  };
}

// «🧭 Выбери за меня» (выбирает из запланированных в коллекции пользователя или из топа каталога)
if ($('cgPick')) {
  $('cgPick').onclick = () => {
    $('cgPickMenuPop')?.classList.remove('open');
    const planned = items.filter(i => !i.archived && i.status === 'В планах');
    if (planned.length) {
      const pick = planned[Math.floor(Math.random() * planned.length)];
      openDetail(pick.id);
      toast(`🧭 Выбрал из твоего списка «В планах»: ${pick.title}`);
    } else {
      cgRandom();
    }
  };
}

// ---------- Предпросмотр каталога (с кэшем рекомендаций simPreview!) ----------
let rndR = null;
const rndSeen = new Set();
const simPreviewCache = new Map();
try { JSON.parse(localStorage.getItem('rndSeen') || '[]').forEach(k => rndSeen.add(k)); } catch (e) {}

function rndTagChips(r) {
  const b = $('rndTags'); b.replaceChildren();
  (r.tags || []).forEach(t => {
    const c = el('button', 'chip', t); c.type = 'button';
    c.onclick = () => {
      const isVideo = cg.g === 'Кино и сериалы' || cg.g === 'Фильм' || cg.g === 'Сериал';
      let foundKey = '';
      if (isVideo) {
        const k = Object.keys(TG).find(id => TG[id].toLowerCase() === t.toLowerCase());
        if (k) foundKey = String(k);
      } else {
        const allAni = [...CLASSIC_GENRES, ...ROMANCE_REL_TAGS, ...THEME_PLOT_TAGS, ...EXTRA_SENSITIVE_TAGS];
        const hit = allAni.find(([k, l]) => l.toLowerCase().includes(t.toLowerCase()) || ruTag(k.slice(2)).toLowerCase() === t.toLowerCase());
        if (hit) foundKey = hit[0];
      }
      if (!foundKey) return toast('Для этого тега нет быстрого фильтра в текущей категории');
      closeAll();
      cgTagState.set(foundKey, 1);
      saveCgTagState();
      cgGenres();
      cgLoad(true);
    };
    b.append(c);
  });
}

// Загрузка похожих тайтлов ТОЛЬКО по нажатию кнопки «🔗 Похожие» с сохранением кэша simPreviewCache (Этап 3 п.6)
async function loadSimilarTitlesIntoBox(r, targetBox) {
  if (!targetBox || !r) return;
  targetBox.replaceChildren(el('span', 'meta', '⏳ Загружаю похожие произведения…'));
  const cacheKey = `${r.category}_${r.aniId || r.mal || r.tmdb || r.title}`;
  try {
    let list = simPreviewCache.get(cacheKey);
    if (!list) {
      if (['Аниме', 'Манга', 'Ранобэ'].includes(r.category) && (r.aniId || r.mal)) {
        const useAni = Number(r.aniId) > 0;
        const q = useAni
          ? 'query($id:Int,$t:MediaType){Media(id:$id,type:$t){recommendations(perPage:6,sort:RATING_DESC){nodes{mediaRecommendation{id idMal title{romaji english}}}}}}'
          : 'query($m:Int,$t:MediaType){Media(idMal:$m,type:$t){recommendations(perPage:6,sort:RATING_DESC){nodes{mediaRecommendation{id idMal title{romaji english}}}}}}';
        const vars = useAni
          ? { id: Number(r.aniId), t: r.category === 'Аниме' ? 'ANIME' : 'MANGA' }
          : { m: Number(r.mal), t: r.category === 'Аниме' ? 'ANIME' : 'MANGA' };
        const j = await (await fetch('https://graphql.anilist.co', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({query: q, variables: vars})})).json();
        const ns = (j.data?.Media?.recommendations?.nodes || []).map(n => n.mediaRecommendation).filter(Boolean).map(x => ({mal: x.idMal, en: x.title.english || x.title.romaji}));
        let ru = {};
        if (ns.length) {
          try { ru = await ruTitles(r.category === 'Аниме' ? 'animes' : 'mangas', ns.map(x => x.mal).filter(Boolean)); } catch (e) {}
        }
        list = ns.map(x => ({ mal: x.mal, en: x.en, label: ru[x.mal] || x.en }));
      } else if (r.tmdb && String(r.tmdb).includes('/')) {
        const k = getActiveTmdbKey();
        const j = await ruJson(`https://api.themoviedb.org/3/${r.tmdb}/recommendations?api_key=${encodeURIComponent(k)}&language=ru-RU&page=1`, 6000);
        list = (j.results || []).slice(0, 6).map(x => ({ en: x.title || x.name, label: x.title || x.name }));
      } else {
        list = [];
      }
      simPreviewCache.set(cacheKey, list);
    }
    targetBox.replaceChildren();
    if (!list || !list.length) {
      targetBox.append(el('span', 'meta', 'Похожих рекомендаций в базе не найдено.'));
      return;
    }
    targetBox.append(el('span', 'meta', 'Похожие:'));
    list.forEach(x => {
      const b = el('button', 'chip', x.label); b.type = 'button';
      b.onclick = () => {
        closeAll();
        document.querySelector('#mainTabs .tab[data-v="catalog"]')?.click();
        $('cgSearch').value = x.en;
        $('cgClear').style.display = 'grid';
        cgGo();
      };
      targetBox.append(b);
    });
  } catch (e) {
    targetBox.replaceChildren(el('span', 'meta', 'Не удалось загрузить похожие: ' + e.message));
  }
}

function renderOnDemandSimilarButton(r, container) {
  if (!container) return;
  container.replaceChildren();
  const canFetchSim = Boolean((['Аниме', 'Манга', 'Ранобэ'].includes(r.category) && (r.aniId || r.mal)) || (r.tmdb && String(r.tmdb).includes('/')));
  if (!canFetchSim) return;
  const btn = el('button', 'btn btn-s', '🔗 Похожие');
  btn.type = 'button';
  btn.style.fontSize = '12px';
  btn.style.padding = '6px 12px';
  btn.onclick = () => loadSimilarTitlesIntoBox(r, container);
  container.append(btn);
}

function syncRndAddBtnUI(r) {
  const a = $('rndAdd');
  if (!a || !r) return;
  const m = items.find(i => same(i, r));
  a.disabled = false;
  a.classList.add('qa-trigger');
  a.textContent = m ? `${SHORT_ST_ICON[m.status] || '●'} ${SHORT_ST_BTN[m.status] || m.status}${m.fav ? ' ❤' : ''} ▾` : '＋ Выбрать статус ▾';
}

function showPreview(r, rnd) {
  if (rnd) {
    rndSeen.add(cgKey(r));
    try { localStorage.setItem('rndSeen', JSON.stringify([...rndSeen].slice(-300))); } catch (e) {}
  }
  rndR = r;
  $('rndPoster').onerror = () => { $('rndPoster').onerror = null; $('rndPoster').src = FALL; }; $('rndPoster').src = safePosterUrl(r.poster);
  $('rndTitle').textContent = r.title;
  $('rndNames').textContent = [r.en, r.orig].filter(Boolean).join(' / ');
  $('rndMeta').textContent = [r.year, catLabel(r), r.ext ? '★ ' + r.ext + (r.src ? ' (' + r.src + ')' : '') : '', r.ongoing ? 'Онгоинг' : ''].filter(Boolean).join(' | ');
  $('rndCredits').textContent = [r.author && 'Автор: ' + r.author, r.studio && 'Студия: ' + r.studio, r.source && 'Источник: ' + r.source].filter(Boolean).join('  •  ');
  rndTagChips(r);
  $('rndDesc').textContent = r.desc || 'Описание отсутствует.';
  $('rndLink').href = r.url || '#';
  $('rndLink').style.display = r.url ? '' : 'none';
  $('rndMore').style.display = rnd ? '' : 'none';
  syncRndAddBtnUI(r);
  $('rndModal').style.display = 'flex';
  ruPreview(r);
  renderOnDemandSimilarButton(r, $('rndSim'));
  CharacterSeiyuuManager.render($('rndCharsSec'), r);
}

async function cgRandom() {
  $('cgPickMenuPop')?.classList.remove('open');
  const b = $('cgRand'); if (b) b.disabled = true;
  try {
    const md = $('cgMode').value, q = cg.q;
    const rp = q ? 1 : 1 + Math.floor(Math.random() * (md === 'new' || md === 'soon' ? 3 : md === 'top' ? 10 : 20));
    let res = await cgFetch(rp, 24, q, md);
    if (!res.length && rp > 1) res = await cgFetch(1, 24, q, md);
    const fresh = res.filter(r => !has(r) && cgPass(r) && !rndSeen.has(cgKey(r))), pool = fresh.length ? fresh : res;
    if (!pool.length) throw new Error('ничего не пришло');
    showPreview(pool[Math.floor(Math.random() * pool.length)], true);
  } catch (e) { toast('Не удалось получить случайный тайтл: ' + e.message, true); }
  if (b) b.disabled = false;
}

async function cgThree() {
  $('cgPickMenuPop')?.classList.remove('open');
  const b = $('cgThree'); if (b) b.disabled = true;
  try {
    const md = $('cgMode').value, rp = cg.q ? 1 : 1 + Math.floor(Math.random() * (md === 'new' || md === 'soon' ? 3 : md === 'top' ? 10 : 20));
    let res = await cgFetch(rp, 24, cg.q, md);
    if (!res.length && rp > 1) res = await cgFetch(1, 24, cg.q, md);
    const pool = res.filter(r => !has(r) && cgPass(r) && !rndSeen.has(cgKey(r))).sort(() => Math.random() - 0.5).slice(0, 3);
    if (!pool.length) throw new Error('ничего подходящего');
    cgGrid.replaceChildren(); pool.forEach(cgCard); cgMarks(); $('cgMore').style.display = 'none';
    toast('Три случайных варианта — выбирай'); ruCards();
  } catch (e) { toast('Не удалось подобрать: ' + e.message, true); }
  if (b) b.disabled = false;
}

$('cgThree').onclick = cgThree;
$('cgRand').onclick = cgRandom;
$('rndMore').onclick = cgRandom;
$('rndEdit').onclick = () => { closeAll(); openAdd(null); fillForm(rndR); if (rndR.tmdb) tmdbExtra(rndR).catch(() => {}); };
$('rndAdd').onclick = e => {
  e.stopPropagation();
  openQuickAddStatusMenu($('rndAdd'), rndR, () => syncRndAddBtnUI(rndR));
};

// ---------- Календарь выхода серий ----------
let calWeek = 0, calTab = 'a', calMine = false;
const calStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + calWeek * 7); return d; };
const fmtD = d => d.toLocaleDateString('ru-RU', {day: 'numeric', month: 'long'});

async function calAnime(a, b) {
  const q = 'query($a:Int,$b:Int,$p:Int){Page(page:$p,perPage:50){pageInfo{hasNextPage} airingSchedules(airingAt_greater:$a,airingAt_lesser:$b,sort:TIME){airingAt episode media{idMal title{romaji english} coverImage{medium} siteUrl isAdult}}}}', out = [];
  for (let p = 1; p <= 6; p++) {
    const j = await (await fetch('https://graphql.anilist.co', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({query: q, variables: {a: Math.floor(a / 1000), b: Math.floor(b / 1000), p}})})).json(), pg = j.data.Page;
    pg.airingSchedules.forEach(x => { if (!x.media.isAdult) out.push({t: x.airingAt * 1000, ep: x.episode, mal: x.media.idMal, en: x.media.title.english || x.media.title.romaji, names: [x.media.title.romaji, x.media.title.english], img: x.media.coverImage.medium, url: x.media.siteUrl}); });
    if (!pg.pageInfo.hasNextPage) break;
  }
  const mals = [...new Set(out.map(x => x.mal).filter(Boolean))];
  for (let i = 0; i < mals.length; i += 50) { try { const t = await ruTitles('animes', mals.slice(i, i + 50)); out.forEach(x => { if (t[x.mal]) { x.ru = t[x.mal]; x.names.push(t[x.mal]); } }); } catch (e) {} }
  return out;
}

async function calMovies(a, b) {
  const k = getActiveTmdbKey();
  const A = a.toISOString().slice(0, 10), B = new Date(b - 864e5).toISOString().slice(0, 10), out = [];
  for (const [m, dk] of [['movie', 'primary_release_date'], ['tv', 'first_air_date']]) {
    const j = await ruJson(`https://api.themoviedb.org/3/discover/${m}?api_key=${encodeURIComponent(k)}&language=ru-RU&sort_by=popularity.desc&${dk}.gte=${A}&${dk}.lte=${B}`, 8000);
    (j.results || []).slice(0, 15).forEach(x => out.push({t: new Date((x.release_date || x.first_air_date) + 'T12:00:00').getTime(), day: true, ep: m === 'movie' ? 'Фильм' : 'Сериал', ru: x.title || x.name, names: [x.title, x.name, x.original_title, x.original_name], img: x.poster_path ? 'https://image.tmdb.org/t/p/w92' + x.poster_path : '', url: 'https://www.themoviedb.org/' + m + '/' + x.id}));
  }
  return out;
}

function calDraw(ev) {
  const body = $('calBody'), find = n => items.find(i => nset(i).some(x => n.some(y => y && ruN(y) === ruN(x)))), fol = prof.follow || [];
  ev = ev.map(x => ({...x, it: find(x.names)})).filter(x => !calMine || x.it || (x.mal && fol.includes(x.mal))).sort((p, q) => p.t - q.t);
  body.replaceChildren(); if (!ev.length) return body.append(el('div', 'msg', calMine ? 'На этой неделе из твоей коллекции и подписок ничего не выходит.' : 'Ничего не нашлось.'));
  const todayS = new Date().toDateString(); let last = '';
  ev.forEach(x => {
    const d = new Date(x.t), ds = d.toDateString();
    if (ds !== last) { last = ds; body.append(el('div', 'fs', (ds === todayS ? 'Сегодня · ' : '') + d.toLocaleDateString('ru-RU', {weekday: 'long', day: 'numeric', month: 'long'}))); }
    const r = el('div', 'calr'), img = el('img'), tx = el('div', 'calt'); img.src = x.img || ''; img.alt = ''; img.loading = 'lazy';
    tx.append(el('b', null, x.ru || x.en), el('span', 'meta', (x.day ? x.ep : d.toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'}) + ' · серия ' + x.ep)));
    if (x.it) tx.append(el('span', 'chip', '✓ ' + x.it.status));
    if (!x.day && x.t < Date.now()) tx.append(el('span', 'chip', 'вышла'));
    r.append(img, tx);
    if (x.mal) {
      const st = el('button', 'chip', fol.includes(x.mal) ? '★' : '☆'); st.title = 'Следить за этим тайтлом';
      st.onclick = () => { const f = prof.follow || []; prof.follow = f.includes(x.mal) ? f.filter(m => m !== x.mal) : [...f, x.mal]; profCloud(); st.textContent = prof.follow.includes(x.mal) ? '★' : '☆'; };
      r.append(st);
    }
    if (x.url) { img.style.cursor = 'pointer'; img.onclick = () => window.open(x.url, '_blank', 'noopener'); }
    body.append(r);
  });
}

async function calLoad() {
  const a = calStart(), b = new Date(a.getTime() + 7 * 864e5), body = $('calBody');
  $('calRange').textContent = `${fmtD(a)} — ${fmtD(new Date(b.getTime() - 864e5))}`;
  body.replaceChildren(el('div', 'msg', 'Загружаю…'));
  try { calDraw(calTab === 'a' ? await calAnime(a, b) : await calMovies(a, b)); } catch (e) { body.replaceChildren(el('div', 'msg', 'Не удалось загрузить календарь: ' + e.message)); }
}
const calOpen = () => { calWeek = 0; $('calModal').style.display = 'flex'; calLoad(); };
$('cgCal').onclick = calOpen; $('calClose').onclick = () => { $('calModal').style.display = 'none'; };
$('calPrev').onclick = () => { calWeek--; calLoad(); }; $('calNext').onclick = () => { calWeek++; calLoad(); }; $('calToday').onclick = () => { calWeek = 0; calLoad(); };
$('calTabA').onclick = () => { calTab = 'a'; $('calTabA').classList.add('on'); $('calTabM').classList.remove('on'); calLoad(); };
$('calTabM').onclick = () => { calTab = 'm'; $('calTabM').classList.add('on'); $('calTabA').classList.remove('on'); calLoad(); };
$('calMine').onclick = () => { calMine = !calMine; $('calMine').classList.toggle('on', calMine); calLoad(); };

// ---------- Управление данными (💾), Пакетные операции, Поиск и объединение повторов (🧹), Связь с каталогом (🔗), Разобрать (📥) и Импорт (Бэкап, Кинопоиск, MAL/Shikimori/AniList) ----------

let importReplace = false;

function openDataManagementModal() {
  $('accMenu')?.classList.remove('open');
  $('hybMorePop')?.classList.remove('open');
  updateLastImportBatchBarUI();
  $('dataModal').style.display = 'flex';
}
if ($('accDataBtn')) $('accDataBtn').onclick = openDataManagementModal;
if ($('profDataModalBtn')) $('profDataModalBtn').onclick = openDataManagementModal;
if ($('closeDataModalBtn')) $('closeDataModalBtn').onclick = () => { $('dataModal').style.display = 'none'; };

$('accKey').onclick = async () => {
  let cur = ''; try { cur = localStorage.getItem('tmdbKey') || ''; } catch (e) {}
  const v = await uiPrompt('Свой ключ TMDB (необязательно — общий ключ уже встроен)', cur, 'Оставь пустым для использования встроенного ключа');
  if (v === null) return;
  try { if (v.trim()) localStorage.setItem('tmdbKey', v.trim()); else localStorage.removeItem('tmdbKey'); } catch (e) {}
  toast(v.trim() ? 'Свой ключ TMDB сохранён' : 'Включён встроенный общий ключ TMDB');
};
$('accReset').onclick = async () => {
  if (!(await uiConfirm('Сбросить оформление (цвет, тема, размер карточек, вид)? Коллекция не пострадает.', 'Сбросить'))) return;
  try { ['acc', 'cw', 'profHide', 'view', 'cgHid', 'draft', 'theme', 'cgTagStateV2'].forEach(k => localStorage.removeItem(k)); } catch (e) {}
  location.reload();
};

// Пакетное сохранение и удаление в Firestore с откатом при ошибке облака (Этап 1 п.3)
async function batchSaveItems(listToSave) {
  if (!listToSave || !listToSave.length) return;
  const now = Date.now();
  listToSave.forEach(it => { it.updatedAt = now; fix(it); });
  if (user && !user.isLocal && auth.currentUser) {
    for (let i = 0; i < listToSave.length; i += 380) {
      const b = writeBatch(db);
      listToSave.slice(i, i + 380).forEach(it => {
        const { docId, payload } = prepareTitleForCloud(it, user.uid);
        b.set(doc(db, 'items', docId), payload);
      });
      await track(b.commit());
    }
  } else {
    setSync();
  }
  saveLocalItems();
}

async function batchDeleteItemsWithUndo(listToDelete, toastMsg = 'Удалено') {
  if (!listToDelete || !listToDelete.length) return;
  const backupCopies = listToDelete.map(x => ({ ...x }));
  const delIdStrs = new Set(listToDelete.map(x => String(x.id)));
  window._recentlyDeletedIds = window._recentlyDeletedIds || new Set();

  // 1. Отменяем любые отложенные сохранения в облако для удаляемых карточек и помечаем их удалёнными
  const docIdsToRemove = new Set();
  backupCopies.forEach(it => {
    const primaryDocId = getCloudDocId(it);
    const actualDocId = it._docId ? String(it._docId) : primaryDocId;
    docIdsToRemove.add(actualDocId);
    docIdsToRemove.add(primaryDocId);
    window._recentlyDeletedIds.add(String(it.id));
    window._recentlyDeletedIds.add(actualDocId);
    window._recentlyDeletedIds.add(primaryDocId);
    [actualDocId, primaryDocId].forEach(dId => {
      if (_cloudSaveTimers.has(dId)) {
        clearTimeout(_cloudSaveTimers.get(dId).timer);
        _cloudSaveTimers.get(dId).resolve();
        _cloudSaveTimers.delete(dId);
      }
    });
  });

  // 2. Сразу обновляем локальный список, кэш и DOM ДО сетевого ожидания, чтобы onSnapshot не вернул старый кэш
  window._explicitEmptyAllowed = true;
  items = items.filter(i => !delIdStrs.has(String(i.id)));
  saveLocalItems(items.length === 0);
  profCloud(true);
  refresh();

  // 3. Удаляем документы в Firestore и сбрасываем _explicitEmptyAllowed обратно в false после завершения удаления
  try {
    if (user && !user.isLocal && auth.currentUser) {
      const allDelIds = [...docIdsToRemove].filter(Boolean);
      try {
        for (let i = 0; i < allDelIds.length; i += 350) {
          const b = writeBatch(db);
          allDelIds.slice(i, i + 350).forEach(dId => b.delete(doc(db, 'items', dId)));
          await track(b.commit());
        }
      } catch (e) {
        await Promise.allSettled(allDelIds.map(dId => track(deleteDoc(doc(db, 'items', dId)))));
      }
    }
  } finally {
    setTimeout(() => { window._explicitEmptyAllowed = false; }, 1500);
  }

  toast(toastMsg, false, {
    label: '↩ Отменить удаление',
    fn: async () => {
      try {
        backupCopies.forEach(it => {
          window._recentlyDeletedIds.delete(String(it.id));
          window._recentlyDeletedIds.delete(getCloudDocId(it));
          if (it._docId) window._recentlyDeletedIds.delete(String(it._docId));
          if (!items.some(x => String(x.id) === String(it.id))) items.push(fix(it));
        });
        saveLocalItems();
        refresh();
        await batchSaveItems(backupCopies);
        profCloud(true);
        toast(`Восстановлено записей: ${backupCopies.length}`);
      } catch (err) {
        toast('Не удалось восстановить в облаке: ' + (err.code || err.message), true);
      }
    }
  });
}

// Экспорт полного бэкапа (.json) + напоминание раз в 2 недели
window.exportData = () => {
  const myOwnItems = items;
  if (!myOwnItems.length) return toast('Твоя коллекция пуста, нечего скачивать.');
  const payload = {
    version: 4,
    exportedAt: new Date().toISOString(),
    profile: {
      name: prof.name, bio: prof.bio, mood: prof.mood, realName: prof.realName, bday: prof.bday,
      cardStyle: prof.cardStyle, customColor: prof.customColor,
      showMyNotes: !!prof.showMyNotes,
      customLists: prof.customLists || [], listMeta: prof.listMeta || {},
      favChars: prof.favChars || [], equippedMedals: prof.equippedMedals || []
    },
    items: myOwnItems.map(({userId, _docId, _knownStatusFromImport, lastLinkAttempt, ...r}) => r)
  };
  const a = document.createElement('a'), u = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'}));
  a.href = u; a.download = `MediaTracker_FullBackup_${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(u);
  try { localStorage.setItem('lastBackup', String(Date.now())); } catch (e) {}
};

let nudged = false;
function backupNudge() {
  if (nudged || items.length < 5) return;
  nudged = true; let t = 0; try { t = +localStorage.getItem('lastBackup') || 0; } catch (e) {}
  if (Date.now() - t > 14 * 864e5) {
    toast('Напоминание: давно не сохранялась резервная копия коллекции.', false, {label: 'Скачать бэкап', fn: () => window.exportData()});
  }
}

function getSavedImportMeta() {
  try { return JSON.parse(localStorage.getItem(getUidStorageKey('lastImportMeta')) || 'null'); } catch (e) { return null; }
}
function setSavedImportMeta(meta) {
  try {
    if (!meta) localStorage.removeItem(getUidStorageKey('lastImportMeta'));
    else localStorage.setItem(getUidStorageKey('lastImportMeta'), JSON.stringify(meta));
  } catch (e) {}
  updateLastImportBatchBarUI();
}
function updateLastImportBatchBarUI() {
  const bar = $('lastImportBatchBar'), txt = $('lastImportBatchTxt'), btn = $('undoLastImportBtn');
  if (!bar || !txt || !btn) return;
  const meta = getSavedImportMeta();
  if (!meta || !meta.batchId) {
    bar.style.display = 'none';
    return;
  }
  const batchItems = items.filter(i => i.importBatchId === meta.batchId);
  if (!batchItems.length) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  txt.textContent = `Последний импорт (${meta.source || 'Файл'}): ${batchItems.length} шт. от ${new Date(meta.ts || Date.now()).toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'})}`;
  btn.onclick = async () => {
    if (!(await uiConfirm(`Отменить импорт «${meta.source}» и удалить все добавленные в нём записи (${batchItems.length} шт.)?`, 'Отменить импорт', true))) return;
    await batchDeleteItemsWithUndo(batchItems, `Импорт «${meta.source}» отменён (${batchItems.length} шт.)`);
    setSavedImportMeta(null);
  };
}

// Единое окно предпросмотра перед ЛЮБЫМ импортом (исправлены Этап 1 п.2 и п.3:
// при replaceAll удаляются ВСЕ старые документы по их реальным docId, а локальный список и кэш обновляются ТОЛЬКО после успешной записи в облако с откатом при ошибке)
async function previewAndExecuteImport(rawCandidates, sourceName, fileFingerprint = '', replaceAll = false, profBackup = null) {
  let sameFileWarn = '';
  const prevMeta = getSavedImportMeta();
  if (fileFingerprint && prevMeta && prevMeta.fingerprint === fileFingerprint && !replaceAll) {
    sameFileWarn = '⚠ ВНИМАНИЕ: этот же файл уже загружался ранее! Все совпадения автоматически отфильтрованы.\n\n';
  }

  const basePool = replaceAll ? [] : items.map(x => ({ ...x, tags: [...(x.tags || [])], lists: [...(x.lists || [])] }));
  const toAdd = [];
  const duplicates = [];
  const enrichedExisting = [];

  rawCandidates.forEach(cand => {
    if (!cand || !String(cand.title || '').trim()) return;
    const dupInCol = findDuplicateMatch(cand, basePool);
    const dupInBatch = findDuplicateMatch(cand, toAdd);
    if (dupInCol) {
      // Слияние выполняется строго на копии (dupInCol из basePool) и применяется к основной коллекции только после подтверждения импорта
      const beforeJson = JSON.stringify(dupInCol);
      const merged = mergeTwoDuplicateItems(dupInCol, cand);
      Object.assign(dupInCol, merged);
      if (JSON.stringify(dupInCol) !== beforeJson && !enrichedExisting.includes(dupInCol)) {
        enrichedExisting.push(dupInCol);
      }
      duplicates.push({ cand, existing: dupInCol });
      return;
    }
    if (dupInBatch) {
      const mergedBatch = mergeTwoDuplicateItems(dupInBatch, cand);
      Object.assign(dupInBatch, mergedBatch);
      duplicates.push({ cand, existing: dupInBatch });
      return;
    }
    toAdd.push(cand);
  });

  const reviewList = toAdd.filter(x => x.needsReview);
  const summaryText = `${sameFileWarn}Источник: ${sourceName}\nВсего записей в источнике: ${rawCandidates.length}\n• Будет добавлено новых: ${toAdd.length} шт.\n• Пропущено повторов: ${duplicates.length} шт.\n• Отправлено во вкладку «📥 Разобрать» (неизвестен статус или не связан ID): ${reviewList.length} шт.`;

  let overrideCategory = '';
  const confirmed = await dlgOpen(() => {
    $('dlgTitle').textContent = replaceAll ? `⚠ Импорт с ЗАМЕНОЙ коллекции (${sourceName})` : `📥 Предпросмотр импорта (${sourceName})`;
    $('dlgText').textContent = summaryText;
    const body = $('dlgBody');
    body.replaceChildren();

    const catRow = el('div', 'row');
    catRow.style.cssText = 'justify-content:space-between;background:var(--inp);padding:8px 10px;border-radius:10px;border:1px solid var(--bd);font-size:13px';
    const catLbl = el('span', null, 'Категория записей:');
    const catSel = el('select');
    catSel.style.cssText = 'padding:5px 10px;font-size:13px';
    const autoCatSample = toAdd[0]?.category || rawCandidates[0]?.category || 'Аниме';
    [
      ['', `Автоопределение (сейчас: ${autoCatSample})`],
      ['Аниме', 'Все записи → Аниме'],
      ['Фильм', 'Все записи → Фильмы'],
      ['Сериал', 'Все записи → Сериалы'],
      ['Манга', 'Все записи → Манга'],
      ['Ранобэ', 'Все записи → Ранобэ']
    ].forEach(([val, txt]) => catSel.add(new Option(txt, val)));
    catSel.value = overrideCategory;
    catRow.append(catLbl, catSel);
    body.append(catRow);

    const listWrap = el('div');
    catSel.onchange = () => {
      overrideCategory = catSel.value;
      if (overrideCategory) {
        toAdd.forEach(x => {
          x.category = overrideCategory;
          if (overrideCategory === 'Манга' && !x.subKind) x.subKind = 'Манга';
        });
      }
    };
    listWrap.style.cssText = 'max-height:240px;overflow-y:auto;display:flex;flex-direction:column;gap:5px;padding:6px;background:rgba(0,0,0,.25);border-radius:10px;border:1px solid var(--bd);font-size:12.5px';
    if (!toAdd.length && !duplicates.length) {
      listWrap.append(el('div', 'meta', 'В файле не найдено подходящих записей.'));
    } else {
      toAdd.slice(0, 60).forEach(x => {
        const r = el('div', 'row'); r.style.justifyContent = 'space-between';
        r.append(
          el('b', null, `＋ ${x.title} (${x.year || '—'}, ${catLabel(x)})`),
          el('span', x.needsReview ? 'review-badge' : 'chip', x.needsReview ? `📥 На разбор (${x.status})` : x.status)
        );
        listWrap.append(r);
      });
      if (toAdd.length > 60) listWrap.append(el('div', 'meta', `…и ещё ${toAdd.length - 60} новых записей`));
      duplicates.slice(0, 25).forEach(({ cand, existing }) => {
        const r = el('div', 'row'); r.style.justifyContent = 'space-between'; r.style.opacity = '0.65';
        r.append(
          el('span', null, `⏭ Повтор: ${cand.title} (${cand.year || '—'})`),
          el('span', 'meta', `уже есть как «${existing.title}»`)
        );
        listWrap.append(r);
      });
    }
    body.append(listWrap);
  }, replaceAll ? 'Заменить коллекцию' : `Импортировать (${toAdd.length})`, replaceAll, () => true);

  if (!confirmed) return;
  const applyEnrichedCopiesToMainCollection = () => {
    enrichedExisting.forEach(copyItem => {
      const target = items.find(x => String(x.id) === String(copyItem.id));
      if (target) Object.assign(target, copyItem);
    });
  };
  if (!toAdd.length && !replaceAll) {
    if (enrichedExisting.length) {
      applyEnrichedCopiesToMainCollection();
      await batchSaveItems(enrichedExisting);
      saveLocalItems();
      refresh();
      $('dataModal').style.display = 'none';
      toast(`Все тайтлы уже были в коллекции — обновлены данные (избранное / альт. названия / оценки) у ${enrichedExisting.length} записей! ✨`);
      return;
    }
    toast('Новых записей для добавления нет — все тайтлы уже есть в коллекции.');
    return;
  }

  if (replaceAll && items.length) window.exportData();

  const prevItemsSnapshot = items.map(x => ({ ...x }));
  const batchId = 'imp_' + Date.now();
  const usedIds = new Set(replaceAll ? [] : items.map(i => String(i.id)));
  const finalAdd = toAdd.map(x => {
    let idVal = Number(x.id) || 0;
    while (!idVal || usedIds.has(String(idVal))) idVal = newId();
    usedIds.add(String(idVal));
    const docId = (user && user.uid ? user.uid + '_' : 'item_') + idVal;
    const cleaned = fix({
      ...x,
      id: idVal,
      _docId: docId,
      importBatchId: batchId,
      importSource: sourceName
    });
    delete cleaned._knownStatusFromImport;
    return cleaned;
  });

  // Этап 1 п.2 и п.3: Сначала выполняем облачную транзакцию (при replaceAll удаляем ВСЕ старые документы по их реальным docId, включая старые без префикса uid_), и только после успеха обновляем локальный список и кэш!
  if (user && !user.isLocal && auth.currentUser) {
    try {
      if (replaceAll) {
        const oldDocIdsSet = new Set();
        prevItemsSnapshot.forEach(old => {
          oldDocIdsSet.add(getCloudDocId(old));
          if (old._docId) oldDocIdsSet.add(String(old._docId));
          if (old.id) {
            oldDocIdsSet.add(String(old.id));
            oldDocIdsSet.add(user.uid + '_' + String(old.id));
          }
        });
        try {
          const cloudOwnSnap = await getDocs(query(collection(db, 'items'), where('userId', '==', user.uid)));
          cloudOwnSnap.docs.forEach(d => {
            const raw = d.data();
            if (!raw.isProfile && d.id !== 'prof_' + user.uid && raw.kind !== 'wall' && raw.kind !== 'rec' && raw.kind !== 'friendReq' && raw.kind !== 'dm') {
              oldDocIdsSet.add(d.id);
            }
          });
        } catch (e) {}
        const allOldDocIds = [...oldDocIdsSet];
        for (let i = 0; i < allOldDocIds.length; i += 380) {
          const bDel = writeBatch(db);
          allOldDocIds.slice(i, i + 380).forEach(dId => bDel.delete(doc(db, 'items', dId)));
          await track(bDel.commit());
        }
      }

      const allCloudWrites = [...finalAdd, ...enrichedExisting];
      for (let i = 0; i < allCloudWrites.length; i += 380) {
        const bSet = writeBatch(db);
        allCloudWrites.slice(i, i + 380).forEach(it => {
          const { docId, payload } = prepareTitleForCloud(it, user.uid);
          bSet.set(doc(db, 'items', docId), payload);
        });
        await track(bSet.commit());
      }
    } catch (cloudErr) {
      items = prevItemsSnapshot;
      saveLocalItems();
      refresh();
      toast('Импорт отменён — ошибка записи в облако: ' + (cloudErr.code || cloudErr.message), true);
      return;
    }
  }

  if (profBackup) {
    if (profBackup.customLists) prof.customLists = [...new Set([...(prof.customLists || []), ...profBackup.customLists])];
    if (profBackup.listMeta) prof.listMeta = { ...(prof.listMeta || {}), ...profBackup.listMeta };
    if (profBackup.favChars && (!prof.favChars || !prof.favChars.length)) prof.favChars = profBackup.favChars;
    if (profBackup.equippedMedals && (!prof.equippedMedals || !prof.equippedMedals.length)) prof.equippedMedals = profBackup.equippedMedals;
    profCloud();
  }

  if (!replaceAll && enrichedExisting.length) {
    applyEnrichedCopiesToMainCollection();
  }
  if (replaceAll && !finalAdd.length) { window._explicitEmptyAllowed = true; setTimeout(() => { window._explicitEmptyAllowed = false; }, 1500); }
  items = deduplicateListByIdAndCleanupCloud(replaceAll ? finalAdd : [...items, ...finalAdd], true);
  saveLocalItems();
  setSavedImportMeta({ batchId, source: sourceName, count: finalAdd.length, fingerprint: fileFingerprint, ts: Date.now() });
  refresh();
  $('dataModal').style.display = 'none';

  toast(`Импортировано: ${finalAdd.length} шт. (повторов пропущено: ${duplicates.length}, на разбор: ${reviewList.length})`, false, {
    label: '↩ Отменить импорт',
    fn: () => $('undoLastImportBtn')?.click()
  });

  const unlinkedNew = finalAdd.filter(i => !hasExternalCatalogId(i));
  if (unlinkedNew.length) {
    setTimeout(() => startCatalogLinkingForList(unlinkedNew, false), 900);
  }
}

// Загрузка JSON-бэкапа
window.importData = e => {
  const f = e.target.files[0]; if (!f) return;
  const rep = importReplace; importReplace = false;
  const r = new FileReader();
  r.onload = async () => {
    try {
      const txt = r.result;
      const fp = await sha256Hex(txt.slice(0, 50000) + '_' + txt.length);
      const raw = JSON.parse(txt);
      const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : null);
      if (!arr) throw new Error('Неверный формат JSON');
      const profBackup = (!Array.isArray(raw) && raw?.profile) ? raw.profile : null;

      const candidates = arr.map(x => {
        const wasFavStatus = x.status === 'Любимое';
        const knownStatus = wasFavStatus
          ? (x.prevSt && STATS.includes(x.prevSt) ? x.prevSt : 'Просмотрено/Прочитано')
          : (STATS.includes(x.status) ? x.status : '');
        const resolvedStatus = knownStatus || 'В планах';
        const isDone = resolvedStatus === 'Просмотрено/Прочитано' || resolvedStatus === 'Пересматриваю';
        const rawComp = Number(x.completedAt) || 0;
        const compTs = isDone && rawComp > 0 ? rawComp : 0;
        const catVal = x.category === 'Кино' ? 'Фильм' : (x.category === 'Манхва' || x.category === 'Маньхуа') ? 'Манга' : CATS.includes(x.category) ? x.category : 'Фильм';
        const subK = x.category === 'Манхва' ? 'Манхва' : x.category === 'Маньхуа' ? 'Маньхуа' : (x.subKind || (MANGA_SUBKINDS.includes(x.kind) ? x.kind : (catVal === 'Манга' ? 'Манга' : '')));
        const hasExtId = Boolean(Number(x.aniId) || Number(x.mal) || x.tmdb);
        return fix({
          id: Number(x.id) || 0,
          title: String(x.title || '').trim(),
          category: catVal,
          subKind: subK,
          status: resolvedStatus,
          needsReview: Boolean(x.needsReview || !knownStatus || !hasExtId),
          fav: !!(x.fav || wasFavStatus),
          isAdult: Boolean(x.isAdult),
          completedAt: compTs,
          rewatchCount: Number(x.rewatchCount) || 0,
          poster: x.poster || '', year: x.year || '', rating: x.rating || '',
          extRating: x.extRating || '', extSrc: x.extSrc || '', description: x.description || '',
          titleEn: x.titleEn || '', titleOrig: x.titleOrig || '',
          alt: x.alt || '', author: x.author || '', studio: x.studio || '', source: x.source || '', ongoing: !!x.ongoing,
          tags: Array.isArray(x.tags) ? x.tags : [], lists: Array.isArray(x.lists) ? x.lists : [], recBy: x.recBy || '',
          pin: !!x.pin, archived: !!x.archived, eps: +x.eps || 0, vols: +x.vols || 0,
          format: x.format || '', aniId: +x.aniId || 0, mal: +x.mal || 0, tmdb: x.tmdb || '', imdbId: x.imdbId || '',
          dur: +x.dur || 0, seasons: +x.seasons || 0, myNote: x.myNote || '', criteria: x.criteria || null
        });
      });

      await previewAndExecuteImport(candidates, 'JSON-бэкап', fp, rep, profBackup);
    } catch (err) { toast('Ошибка чтения JSON файла: ' + err.message, true); }
    e.target.value = '';
  };
  r.readAsText(f);
};

// Импорт XML / JSON файлов MyAnimeList и Shikimori
window.importMalXml = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = async () => {
    try {
      const txt = r.result;
      const fp = await sha256Hex(txt.slice(0, 50000) + '_' + txt.length);
      if (txt.trim().startsWith('[') || txt.trim().startsWith('{')) {
        const jsonArr = JSON.parse(txt);
        const ST_SH = { completed: 'Просмотрено/Прочитано', watching: 'Смотрю/Читаю', planned: 'В планах', dropped: 'Брошено', on_hold: 'В планах', rewatching: 'Пересматриваю' };
        const candidates = (Array.isArray(jsonArr) ? jsonArr : []).map(entry => {
          const title = String(entry.target_title || entry.title || '').trim();
          if (!title) return null;
          const catType = entry.target_type === 'Manga' ? 'Манга' : 'Аниме';
          const malId = Number(entry.target_id || entry.mal_id) || 0;
          const knownSt = ST_SH[entry.status] || '';
          const status = knownSt || 'В планах';
          const isDone = status === 'Просмотрено/Прочитано' || status === 'Пересматриваю';
          const compTs = isDone && entry.updated_at ? new Date(entry.updated_at).getTime() : 0;
          return fix({
            mal: malId, title, titleEn: title, category: catType, subKind: catType === 'Манга' ? 'Манга' : '',
            status,
            needsReview: Boolean(!knownSt || !malId),
            rating: entry.score ? String(entry.score) : '',
            eps: Number(entry.episodes || entry.chapters) || 0,
            vols: Number(entry.volumes) || 0,
            rewatchCount: Number(entry.rewatches) || 0,
            completedAt: compTs || 0,
            tags: []
          });
        }).filter(Boolean);
        await previewAndExecuteImport(candidates, 'Shikimori JSON', fp, false, null);
        e.target.value = '';
        return;
      }

      const xml = new DOMParser().parseFromString(txt, 'text/xml');
      const animeNodes = [...xml.querySelectorAll('anime')];
      const mangaNodes = [...xml.querySelectorAll('manga')];
      const ST_MAL = { 'Completed': 'Просмотрено/Прочитано', 'Watching': 'Смотрю/Читаю', 'Reading': 'Смотрю/Читаю', 'Plan to Watch': 'В планах', 'Plan to Read': 'В планах', 'Dropped': 'Брошено', 'On-Hold': 'В планах' };
      const gTxt = (node, tag) => node.querySelector(tag)?.textContent?.trim() || '';
      const candidates = [];

      animeNodes.forEach(n => {
        const title = gTxt(n, 'series_title');
        if (!title) return;
        const mal = Number(gTxt(n, 'series_animedb_id')) || 0;
        const knownSt = ST_MAL[gTxt(n, 'my_status')] || '';
        const st = knownSt || 'В планах';
        const isDone = st === 'Просмотрено/Прочитано' || st === 'Пересматриваю';
        const score = Number(gTxt(n, 'my_score')) || 0;
        const finDate = gTxt(n, 'my_finish_date');
        const parsedDate = (finDate && finDate !== '0000-00-00') ? new Date(finDate).getTime() : 0;
        const compTs = (isDone && parsedDate && !isNaN(parsedDate)) ? parsedDate : 0;
        candidates.push(fix({
          mal, title, titleEn: title, category: 'Аниме', status: st,
          needsReview: Boolean(!knownSt || !mal),
          rating: score > 0 ? String(score) : '',
          eps: Number(gTxt(n, 'series_episodes')) || Number(gTxt(n, 'my_watched_episodes')) || 0,
          dur: 24, rewatchCount: Number(gTxt(n, 'my_times_watched')) || 0,
          completedAt: compTs, tags: []
        }));
      });

      mangaNodes.forEach(n => {
        const title = gTxt(n, 'manga_title');
        if (!title) return;
        const mal = Number(gTxt(n, 'manga_mangadb_id')) || 0;
        const knownSt = ST_MAL[gTxt(n, 'my_status')] || '';
        const st = knownSt || 'В планах';
        const isDone = st === 'Просмотрено/Прочитано' || st === 'Пересматриваю';
        const score = Number(gTxt(n, 'my_score')) || 0;
        const finDate = gTxt(n, 'my_finish_date');
        const parsedDate = (finDate && finDate !== '0000-00-00') ? new Date(finDate).getTime() : 0;
        const compTs = (isDone && parsedDate && !isNaN(parsedDate)) ? parsedDate : 0;
        candidates.push(fix({
          mal, title, titleEn: title, category: 'Манга', subKind: 'Манга', status: st,
          needsReview: Boolean(!knownSt || !mal),
          rating: score > 0 ? String(score) : '',
          eps: Number(gTxt(n, 'manga_chapters')) || Number(gTxt(n, 'my_read_chapters')) || 0,
          vols: Number(gTxt(n, 'manga_volumes')) || Number(gTxt(n, 'my_read_volumes')) || 0,
          completedAt: compTs, tags: []
        }));
      });

      await previewAndExecuteImport(candidates, 'MAL XML', fp, false, null);
    } catch (err) { toast('Не удалось разобрать XML/JSON файл: ' + err.message, true); }
    e.target.value = '';
  };
  r.readAsText(f);
};

// ИМПОРТ ФАЙЛОВ КИНОПОИСКА (ИСПРАВЛЕНЫ ВСЕ РЕГУЛЯРКИ БЕЗ ДВОЙНЫХ СЛЭШЕЙ + САМОПРОВЕРКА ПАРСЕРОВ — Этап 1 п.1)
function splitCsvRow(line, sep) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === sep && !inQ) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseKinopoiskDate(str) {
  if (!str) return 0;
  const s = String(str).trim();
  const mRu = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (mRu) {
    const ts = new Date(Number(mRu[3]), Number(mRu[2]) - 1, Number(mRu[1]), 12, 0, 0).getTime();
    return isNaN(ts) ? 0 : ts;
  }
  const ts = new Date(s).getTime();
  return isNaN(ts) ? 0 : ts;
}

function buildKinopoiskCandidateFromRecord(rec, defaultCat = 'Фильм') {
  let titleRu = String(rec.titleRu || rec.ru || rec.nameRu || rec.title || '').trim();
  let titleOrig = String(rec.titleOrig || rec.orig || rec.nameEn || rec.originalTitle || '').trim();
  let year = String(rec.year || '').trim();
  const yrInTitle = titleRu.match(/\((?:[^)]*?(\b(?:19|20)\d{2}\b)[^)]*)\)$/);
  const typeAndCatStr = String(rec.type || '') + ' ' + String(rec.category || '') + ' ' + String(rec.genre || '');
  const isRanobeHint = /ранобэ|light novel|новелл/i.test(typeAndCatStr);
  const isMangaHint = /манга|манхва|маньхуа|manga|manhwa|manhua|комикс/i.test(typeAndCatStr);
  const isAnimeHint = defaultCat === 'Аниме' || /аниме|anime|anixart|shikimori|mal|озвучка|серий|эпизод|ova|ona|тв-\d/i.test(typeAndCatStr + ' ' + titleRu + ' ' + String(rec.status || ''));
  const isSeriesHint = /сериал|мини-сериал|season|сезон/i.test(titleRu + ' ' + typeAndCatStr);
  if (yrInTitle && !year) year = yrInTitle[1];
  // Убираем в конце только чистый год (2014) или общую пометку (сериал)/(фильм) без номера сезона/части, чтобы НЕ терять (ТВ-2), (Фильм 1), (OVA) и т.д.
  titleRu = titleRu.replace(/\s*\((?:(?:мини-)?сериал|фильм|\d{4})\)\s*$/i, '').trim();
  if (!titleRu && titleOrig) titleRu = titleOrig;
  if (!titleRu) return null;

  let rawRateNum = parseFloat(String(rec.rating || rec.myRating || rec.vote || '').replace(',', '.')) || 0;
  // Если в Anixart оценка по 5-балльной шкале и указан флаг 5-балльной, или если от 1 до 10 — сохраняем корректно
  if (rawRateNum > 10 && rawRateNum <= 100) rawRateNum = +(rawRateNum / 10).toFixed(1);
  const myRating = (rawRateNum >= 1 && rawRateNum <= 10) ? String(rawRateNum) : '';
  const extNum = parseFloat(String(rec.kpRating || rec.imdbRating || rec.extRating || '').replace(',', '.')) || 0;
  const extRating = (extNum > 0 && extNum <= 10) ? extNum.toFixed(1) : '';
  const imdbMatch = String(rec.imdb || rec.imdbId || rec.url || '').match(/tt\d{5,10}/i);
  const imdbId = imdbMatch ? imdbMatch[0].toLowerCase() : '';
  const dateTs = parseKinopoiskDate(rec.date || rec.completedAt || '');

  const rawSt = String(rec.status || rec.folder || rec.list || '').trim().toLowerCase();
  const rawFav = String(rec.fav || rec.favorite || rec.isFavorite || '').trim().toLowerCase();
  // ИСПРАВЛЕНИЕ БАГА №3: учитываем «Добавлено» (CSV Anixart) и «В избранном» (TXT Anixart), исключая «Не добавлено» / «Не в избранном»
  let isFav = /^(да|yes|true|1|\+|★|❤|добавлено|в избранном|избранное|любимое)$/i.test(rawFav)
    || ((/добавлен|в избранн|избранн|любим/i.test(rawFav)) && !/не\s+в|не\s+добав|^нет$|^no$|^false$|^0$/i.test(rawFav))
    || /любим|избран|fav/i.test(rawSt);

  let status = '';
  if (rawSt === '1' || /смотрю|читаю|watching|reading|current/i.test(rawSt)) status = 'Смотрю/Читаю';
  else if (rawSt === '2' || /план|буду|запланир|отложен|пауз|hold|paused|watchlist|plan/i.test(rawSt)) status = 'В планах';
  else if (rawSt === '3' || /просмотр|прочит|заверш|watched|completed|оценен/i.test(rawSt)) status = 'Просмотрено/Прочитано';
  else if (rawSt === '4') status = 'В планах';
  else if (rawSt === '5' || /брош|dropped/i.test(rawSt)) status = 'Брошено';
  else if (/пересматр|rewatch|repeat/i.test(rawSt)) status = 'Пересматриваю';
  else if (isFav || myRating) status = 'Просмотрено/Прочитано';

  const knownSt = Boolean(status);
  if (!status) status = defaultCat === 'Аниме' ? 'В планах' : 'Просмотрено/Прочитано';
  const isDone = status === 'Просмотрено/Прочитано' || status === 'Пересматриваю';

  const cat = isRanobeHint ? 'Ранобэ' : isMangaHint ? 'Манга' : isAnimeHint ? 'Аниме' : isSeriesHint ? 'Сериал' : defaultCat;
  const epsVal = parseInt(rec.eps || rec.episodes || rec.watchedEpisodes || '') || 0;
  const altClean = String(rec.alt || rec.altTitles || '').trim();
  return fix({
    title: titleRu,
    titleEn: titleOrig,
    titleOrig,
    alt: altClean,
    year: year.slice(0, 4),
    category: cat,
    status,
    fav: isFav,
    needsReview: Boolean(!knownSt && !imdbId),
    _knownStatusFromImport: knownSt,
    rating: myRating,
    extRating,
    extSrc: extRating ? (cat === 'Аниме' ? 'Anixart' : 'Кинопоиск') : '',
    imdbId,
    eps: epsVal,
    completedAt: isDone && dateTs > 0 ? dateTs : 0,
    dur: parseInt(rec.dur || rec.runtime) || (cat === 'Аниме' ? 24 : 0),
    myNote: String(rec.comment || rec.note || '').trim(),
    tags: rec.genre ? parseTags(String(rec.genre)) : []
  });
}

function parseKinopoiskContent(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];

  // 1. JSON формат
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const j = JSON.parse(trimmed);
      const arr = Array.isArray(j) ? j : (j.items || j.movies || j.data || []);
      return arr.map(x => buildKinopoiskCandidateFromRecord({
        titleRu: x.nameRu || x.titleRu || x.russian || x.title || x.name,
        titleOrig: x.nameEn || x.nameOriginal || x.titleOrig || x.originalTitle || '',
        year: x.year || x.releaseYear || '',
        rating: x.userRate || x.myRating || x.rating || x.vote || '',
        kpRating: x.ratingKinopoisk || x.kpRating || x.extRating || '',
        imdbId: x.imdbId || x.imdb_id || '',
        type: x.type || x.category || '',
        date: x.date || x.votedAt || x.completedAt || '',
        dur: x.filmLength || x.dur || '',
        genre: Array.isArray(x.genres) ? x.genres.map(g => g.genre || g).join(', ') : (x.genre || ''),
        status: x.status || (x.userRate ? 'просмотрено' : '')
      })).filter(Boolean);
    } catch (e) {}
  }

  // 2. HTML / XLS-таблица экспорта Кинопоиска
  if (/<table|<tr|<td/i.test(trimmed)) {
    const docDom = new DOMParser().parseFromString(trimmed, 'text/html');
    const rows = [...docDom.querySelectorAll('tr')];
    if (rows.length > 1) {
      const headers = [...rows[0].querySelectorAll('th,td')].map(c => c.textContent.trim().toLowerCase());
      const findCol = re => headers.findIndex(h => re.test(h));
      const cRu = findCol(/русскоязычн|название|фильм|title|name/i);
      const cOrig = findCol(/оригинальн|original|eng/i);
      const cYear = findCol(/год|year/i);
      const cRate = findCol(/моя оценка|оценка|rating|vote|балл/i);
      const cDate = findCol(/дата|date|voted/i);
      const cImdb = findCol(/imdb/i);
      const cKpRate = findCol(/кинопоиск|kp|рейтинг/i);
      const cGenre = findCol(/жанр|genre/i);
      const cDur = findCol(/мин|длительн|runtime|хронометраж/i);

      const out = [];
      for (let rIdx = 1; rIdx < rows.length; rIdx++) {
        const cells = [...rows[rIdx].querySelectorAll('td')].map(c => c.textContent.trim());
        if (cells.length < 2) continue;
        const rec = {
          titleRu: cRu >= 0 ? cells[cRu] : cells[1] || cells[0],
          titleOrig: cOrig >= 0 ? cells[cOrig] : (cells[2] || ''),
          year: cYear >= 0 ? cells[cYear] : '',
          rating: cRate >= 0 ? cells[cRate] : '',
          date: cDate >= 0 ? cells[cDate] : '',
          imdbId: cImdb >= 0 ? cells[cImdb] : rows[rIdx].innerHTML,
          kpRating: (cKpRate >= 0 && cKpRate !== cRate) ? cells[cKpRate] : '',
          genre: cGenre >= 0 ? cells[cGenre] : '',
          dur: cDur >= 0 ? cells[cDur] : ''
        };
        const cand = buildKinopoiskCandidateFromRecord(rec);
        if (cand) out.push(cand);
      }
      if (out.length) return out;
    }
  }

  // 3. CSV / TSV или построчный список с поддержкой многострочных кавычек внутри ячеек CSV
  const splitCsvLogicalLines = raw => {
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === '"') {
        cur += ch;
        if (inQ && raw[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if ((ch === '\n' || ch === '\r') && !inQ) {
        if (ch === '\r' && raw[i + 1] === '\n') i++;
        if (cur.trim()) out.push(cur.trim());
        cur = '';
      } else if ((ch === '\n' || ch === '\r') && inQ) {
        if (ch === '\r' && raw[i + 1] === '\n') i++;
        cur += ' ';
      } else {
        cur += ch;
      }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  const lines = splitCsvLogicalLines(trimmed);
  if (!lines.length) return [];
  const first = lines[0];

  // ИСПРАВЛЕНИЕ БАГА №4: Распознавание формата .txt из Anixart, где поля разделены через « / » (напр. 1 / "История финала 2" / ... / Смотрю)
  const splitAnixartSlashRow = line => {
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === '/' && !inQ && (i > 0 && /\s/.test(line[i - 1])) && (i + 1 < line.length && /\s/.test(line[i + 1]))) {
        out.push(cur.trim().replace(/^"|"$/g, '').trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim().replace(/^"|"$/g, '').trim());
    return out;
  };

  const isAnixartSlashTxt = lines.slice(0, Math.min(10, lines.length)).some(l => splitAnixartSlashRow(l).length >= 4 && (/^\d+\s+\/\s+/.test(l) || /смотрю|в планах|просмотрено|отложено|брошено|в избранном|название/i.test(l)));
  if (isAnixartSlashTxt) {
    const firstCols = splitAnixartSlashRow(first).map(h => h.replace(/^[\uFEFF"'\s]+|["'\s]+$/g, '').toLowerCase());
    const hasTxtHeader = firstCols.some(h => /название|оригинал|альтернатив|статус|список|избранн|оценка/i.test(h));
    const findTxtCol = (re, ex = null) => firstCols.findIndex(h => re.test(h) && (!ex || !ex.test(h)));
    const tRu = findTxtCol(/русскоязычн|русское|^название$|^наименование$|название релиз|title_ru|^title$/i, /оригин|альтерн/i);
    const tOrig = findTxtCol(/оригинальн|original|romaji|title_orig/i, /альтерн/i);
    const tAlt = findTxtCol(/альтернативн|другие назван|синоним|alt/i);
    const tStatus = findTxtCol(/статус|список|закладк|папка|status|list/i);
    const tFav = findTxtCol(/избранн|любим|favorite|fav/i);
    const tRate = findTxtCol(/оценка|балл|рейтинг|score|rating|vote/i);

    const outTxt = [];
    for (let i = hasTxtHeader ? 1 : 0; i < lines.length; i++) {
      const rawCols = splitAnixartSlashRow(lines[i]);
      if (rawCols.length < 2) continue;
      if (hasTxtHeader) {
        const cand = buildKinopoiskCandidateFromRecord({
          titleRu: tRu >= 0 ? rawCols[tRu] : (rawCols[1] || rawCols[0]),
          titleOrig: tOrig >= 0 ? rawCols[tOrig] : (rawCols[2] || ''),
          alt: tAlt >= 0 ? rawCols[tAlt] : (rawCols[3] || ''),
          status: tStatus >= 0 ? rawCols[tStatus] : (rawCols[4] || ''),
          fav: tFav >= 0 ? rawCols[tFav] : (rawCols[5] || ''),
          rating: tRate >= 0 ? rawCols[tRate] : (rawCols[6] || '')
        }, 'Аниме');
        if (cand) outTxt.push(cand);
      } else {
        // Формат без заголовка: 1 / "Русское название" / "Оригинальное" / "Альтернативные" / Смотрю / В избранном / 10
        const cols = /^\d+$/.test(rawCols[0]) ? rawCols.slice(1) : rawCols;
        if (!cols.length) continue;
        const isStToken = s => /^(смотрю|в планах|просмотрено|отложено|брошено|запланировано|пересматриваю|watching|planned|completed|on hold|dropped)$/i.test(String(s || '').trim());
        const isFavToken = s => /^(в избранном|не в избранном|добавлено|не добавлено|избранное|любимое)$/i.test(String(s || '').trim());
        const isRateToken = s => /^(?:[1-9]|10)(?:[.,]\d)?$/.test(String(s || '').trim()) || /^оценка\s*[:\-]?\s*\d/i.test(String(s || '').trim());

        let titleRu = cols[0] || '';
        let titleOrig = '', alt = '', status = '', fav = '', rating = '';
        for (let k = 1; k < cols.length; k++) {
          const val = String(cols[k] || '').trim();
          if (!val || val === '-' || val === '—') continue;
          if (!status && isStToken(val)) { status = val; continue; }
          if (!fav && isFavToken(val)) { fav = val; continue; }
          if (!rating && isRateToken(val)) { rating = val.replace(/[^0-9.,]/g, ''); continue; }
          if (!titleOrig && k === 1) titleOrig = val;
          else if (!alt && k === 2) alt = val;
          else if (!status && /смотрю|план|просмотр|отлож|брош/i.test(val)) status = val;
          else if (!fav && /избранн|добавлен|любим/i.test(val)) fav = val;
        }
        const cand = buildKinopoiskCandidateFromRecord({ titleRu, titleOrig, alt, status, fav, rating }, 'Аниме');
        if (cand) outTxt.push(cand);
      }
    }
    if (outTxt.length) return outTxt;
  }

  const sep = first.includes(';') ? ';' : first.includes('\t') ? '\t' : first.includes(',') ? ',' : '';

  if (sep && lines.length > 1) {
    const hdr = splitCsvRow(first, sep).map(h => h.replace(/^[\uFEFF"'\s]+|["'\s]+$/g, '').toLowerCase());
    const hasHeader = hdr.some(h => /название|title|name|фильм|аниме|релиз|тайтл|год|year|оценка|rating|score|статус|status|список|закладк|imdb/i.test(h));
    const findCol = (re, excludeRe = null) => hdr.findIndex(h => re.test(h) && (!excludeRe || !excludeRe.test(h)));
    // Ищем русское/основное название, исключая колонки «оригинальное/альтернативное/английское название»
    let cRu = findCol(/русскоязычн|русское|^название$|^наименование$|название релиз|название аниме|фильм|^ru$|title_ru|name_ru|^title$|^name$|^аниме$|^тайтл$|^релиз$/i, /оригин|альтерн|англ|orig|romaji|en_/i);
    if (cRu < 0) cRu = findCol(/название|title|name/i, /оригин|альтерн|англ|orig|romaji/i);
    // ИСПРАВЛЕНИЕ БАГА №3: Разделяем колонку «Оригинальное название» (cOrig) и «Альтернативные названия» (cAlt)!
    const cOrig = findCol(/оригинальн|английск|original|romaji|eng|title_en|title_orig|name_orig/i, /альтернативн|alt/i);
    const cAlt = findCol(/альтернативн|другие назван|синоним|alt|synonyms/i);
    const cYear = findCol(/^год|год выход|year|released|aired/i);
    const cRate = findCol(/моя оценка|^оценка$|оценка пользовател|my_rating|user_rate|user_rating|^rating$|^score$|^vote$|балл/i);
    const cDate = findCol(/дата|date|updated|completed/i);
    const cImdb = findCol(/imdb/i);
    const cType = findCol(/^тип$|^вид$|категор|формат|type|kind|category|media_type/i);
    const cStatus = findCol(/статус|список|закладк|папка|status|list|bookmark|folder/i);
    const cFav = findCol(/избранн|любим|favorite|is_fav|^fav$/i);
    const cEps = findCol(/серий|серии|эпизод|глав|просмотрено|episodes|watched|eps|chapters|progress/i);
    const cNote = findCol(/заметк|комментар|отзыв|note|comment/i);
    const cGenre = findCol(/жанр|тег|genre|tag/i);

    // Определяем, является ли CSV выгрузкой Anixart / аниме-списка
    const sampleText = lines.slice(0, Math.min(25, lines.length)).join(' ');
    const isAnixartOrAnimeCsv = (cEps >= 0 || cFav >= 0 || cAlt >= 0 || /anixart|аниме|anime|просмотрено серий|в планах|брошено|отложено|в избранном|добавлено|онгоинг|ova|ona|тв-1|тв-2|манга|ранобэ/i.test(sampleText)) && !/tt\d{6,}/i.test(sampleText);
    const defaultCsvCat = isAnixartOrAnimeCsv ? 'Аниме' : 'Фильм';

    const out = [];
    for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
      const cols = splitCsvRow(lines[i], sep);
      if (!cols.length || cols.every(c => !c)) continue;
      const rec = hasHeader ? {
        titleRu: (cRu >= 0 && cols[cRu]) ? cols[cRu] : (cOrig >= 0 && cols[cOrig] ? cols[cOrig] : cols[0]),
        titleOrig: (cOrig >= 0 && cOrig !== cRu) ? (cols[cOrig] || '') : '',
        alt: (cAlt >= 0 && cAlt !== cRu && cAlt !== cOrig) ? (cols[cAlt] || '') : '',
        year: cYear >= 0 ? (cols[cYear] || '') : '',
        rating: cRate >= 0 ? (cols[cRate] || '') : '',
        date: cDate >= 0 ? (cols[cDate] || '') : '',
        imdbId: cImdb >= 0 ? (cols[cImdb] || '') : lines[i],
        type: cType >= 0 ? (cols[cType] || '') : '',
        status: cStatus >= 0 ? (cols[cStatus] || '') : '',
        fav: cFav >= 0 ? (cols[cFav] || '') : '',
        eps: cEps >= 0 ? (cols[cEps] || '') : '',
        note: cNote >= 0 ? (cols[cNote] || '') : '',
        genre: cGenre >= 0 ? (cols[cGenre] || '') : ''
      } : {
        titleRu: cols[0] || '',
        titleOrig: cols[1] || '',
        year: cols[2] || '',
        rating: cols[3] || '',
        date: cols[4] || '',
        imdbId: lines[i]
      };
      const cand = buildKinopoiskCandidateFromRecord(rec, defaultCsvCat);
      if (cand) out.push(cand);
    }
    if (out.length) return out;
  }

  // 4. Простой текстовый список (по одной записи на строке: «Название (2014) - 9»)
  return lines.map(line => {
    const m = line.match(/^(.*?)\s*(?:\((\d{4})\))?\s*(?:[-—:]\s*(\d{1,2}(?:[.,]\d)?))?$/);
    if (!m) return null;
    return buildKinopoiskCandidateFromRecord({ titleRu: m[1], year: m[2] || '', rating: m[3] || '' });
  }).filter(Boolean);
}

// Внутренняя самопроверка парсеров на примерах (CSV, TSV, HTML-таблица, JSON, текстовый список, дата, imdb-id — Этап 1 п.1)
function runParserSelfTests() {
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });

  // 1. Дата ДД.ММ.ГГГГ
  const ts = parseKinopoiskDate('15.11.2023');
  check('Дата ДД.ММ.ГГГГ', ts > 0 && new Date(ts).getFullYear() === 2023, `ts=${ts}`);

  // 2. CSV + год в скобках + imdb-id
  const csvSample = 'Название;Оригинал;Год;Моя оценка;Дата;IMDb\nИнтерстеллар (2014);Interstellar;2014;10;15.11.2023;tt0816692\nДжентльмены (фильм);The Gentlemen;2019;9;10.02.2022;tt8367814';
  const csvRes = parseKinopoiskContent(csvSample);
  check('CSV + очистка скобок + IMDb-id', csvRes.length === 2 && csvRes[0].title === 'Интерстеллар' && csvRes[0].year === '2014' && csvRes[0].imdbId === 'tt0816692' && csvRes[0].completedAt > 0, `len=${csvRes.length}`);

  // 3. TSV с табуляцией + «(сериал)»
  const tsvSample = 'Название\tОригинал\tГод\tМоя оценка\tДата\tIMDb\nВо все тяжкие (сериал)\tBreaking Bad\t2008\t9.5\t01.05.2022\ttt0903747';
  const tsvRes = parseKinopoiskContent(tsvSample);
  check('TSV (табуляция) + (сериал)', tsvRes.length === 1 && tsvRes[0].title === 'Во все тяжкие' && tsvRes[0].category === 'Сериал' && tsvRes[0].imdbId === 'tt0903747', `title=${tsvRes[0]?.title}`);

  // 4. HTML-таблица (.xls выгрузка Кинопоиска)
  const htmlSample = '<table><tr><th>Русскоязычное название</th><th>Оригинальное название</th><th>Год</th><th>Моя оценка</th><th>Дата</th><th>IMDb</th></tr><tr><td>Начало (2010)</td><td>Inception</td><td>2010</td><td>9</td><td>20.08.2021</td><td>https://www.imdb.com/title/tt1375666/</td></tr></table>';
  const htmlRes = parseKinopoiskContent(htmlSample);
  check('HTML-таблица Кинопоиска', htmlRes.length === 1 && htmlRes[0].title === 'Начало' && htmlRes[0].imdbId === 'tt1375666' && htmlRes[0].completedAt > 0, `imdb=${htmlRes[0]?.imdbId}`);

  // 5. JSON выгрузка
  const jsonSample = JSON.stringify([{ nameRu: 'Матрица (1999)', nameEn: 'The Matrix', userRate: 10, date: '12.04.2020', imdbId: 'tt0133093' }]);
  const jsonRes = parseKinopoiskContent(jsonSample);
  check('JSON выгрузка', jsonRes.length === 1 && jsonRes[0].title === 'Матрица' && jsonRes[0].year === '1999' && jsonRes[0].imdbId === 'tt0133093', `year=${jsonRes[0]?.year}`);

  // 6. Простой текстовый список «Название (2014) - 9»
  const txtSample = 'Дюна (2021) - 8.5\nБегущий по лезвию 2049 (2017) - 9';
  const txtRes = parseKinopoiskContent(txtSample);
  check('Текстовый список «Название (2014) - 9»', txtRes.length === 2 && txtRes[0].title === 'Дюна' && txtRes[0].year === '2021' && txtRes[0].rating === '8.5', `len=${txtRes.length}`);

  window._parserSelfTestResults = results;
  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    console.error('Parser self-test failed:', failed);
  }
  return results;
}
try { runParserSelfTests(); } catch (e) {}


if ($('universalImportBtn')) {
  $('universalImportBtn').onclick = () => {
    if ($('universalImportFile')) {
      $('universalImportFile').value = '';
      $('universalImportFile').click();
    }
  };
}

window.handleUniversalFileImport = e => {
  const f = e.target.files?.[0];
  if (!f) return;
  const fName = (f.name || '').toLowerCase();

  // 1. Если это XML-файл (MAL / Shikimori)
  if (fName.endsWith('.xml')) {
    window.importMalXml(e);
    return;
  }

  const readWithEncoding = enc => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsText(f, enc);
  });

  (async () => {
    try {
      let txt = await readWithEncoding('UTF-8');
      if ((txt.match(/\uFFFD/g) || []).length > 3) {
        txt = await readWithEncoding('windows-1251');
      }
      const trimmed = (txt || '').trim();
      if (!trimmed) {
        toast('Выбранный файл пуст', true);
        e.target.value = '';
        return;
      }
      const fp = await sha256Hex(trimmed.slice(0, 50000) + '_' + trimmed.length);

      // 2. Проверяем XML внутри любого файла
      if (trimmed.startsWith('<?xml') || /<myanimelist|<anime>/i.test(trimmed.slice(0, 400))) {
        window.importMalXml(e);
        return;
      }

      // 3. Проверяем JSON (полный бэкап MediaTracker, выгрузка Shikimori или JSON из Anixart)
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : (Array.isArray(parsed?.bookmarks) ? parsed.bookmarks : (Array.isArray(parsed?.releases) ? parsed.releases : null)));
          if (arr && arr.length) {
            // Если это наш собственный бэкап MediaTracker
            if (parsed?.version || (arr[0] && ('extSrc' in arr[0] || 'category' in arr[0] || 'titleEn' in arr[0]))) {
              window.importData(e);
              return;
            }
            // Если это Shikimori JSON (target_title / target_id)
            if (arr[0] && ('target_title' in arr[0] || 'target_id' in arr[0])) {
              window.importMalXml(e);
              return;
            }
            // Если это JSON выгрузка Anixart или табличный JSON
            const isAnixJson = /anix/i.test(fName) || arr.some(x => x && ('title_ru' in x || 'title_original' in x || 'profile_list_status' in x || 'episodes_released' in x));
            const jsonCandidates = arr.map(x => buildKinopoiskCandidateFromRecord({
              titleRu: x.title_ru || x.nameRu || x.titleRu || x.russian || x.title || x.name || '',
              titleOrig: x.title_original || x.nameEn || x.nameOriginal || x.titleOrig || x.originalTitle || '',
              year: x.year || x.releaseYear || '',
              rating: x.my_vote || x.vote || x.userRate || x.myRating || x.rating || x.score || '',
              kpRating: x.grade || x.ratingKinopoisk || x.kpRating || x.extRating || '',
              imdbId: x.imdbId || x.imdb_id || '',
              type: x.type || x.category?.name || x.category || '',
              status: x.profile_list_status || x.status_name || x.list || x.bookmark || x.status || '',
              fav: x.is_favorite || x.favorite || x.fav || '',
              eps: x.watched_episodes || x.episodes_released || x.episodes || x.eps || '',
              date: x.date || x.votedAt || x.completedAt || '',
              dur: x.duration || x.filmLength || x.dur || '',
              genre: Array.isArray(x.genres) ? x.genres.map(g => g.genre || g.name || g).join(', ') : (x.genres || x.genre || ''),
              note: x.note || x.comment || ''
            }, isAnixJson ? 'Аниме' : 'Фильм')).filter(Boolean);
            if (jsonCandidates.length) {
              await previewAndExecuteImport(jsonCandidates, isAnixJson ? 'Anixart JSON' : 'JSON файл', fp, false, null);
              e.target.value = '';
              return;
            }
          }
        } catch (jsonErr) {}
      }

      // 4. CSV / TSV / Таблица Anixart / Google Таблицы / Кинопоиск / Текстовый список
      const candidates = parseKinopoiskContent(trimmed);
      if (candidates.length) {
        const isAnixFile = /anix|anime|аниме|shiki|закладк/i.test(fName) || candidates.some(c => c.category === 'Аниме');
        if (/anix|anime|аниме/i.test(fName)) {
          candidates.forEach(c => { if (c.category === 'Фильм') c.category = 'Аниме'; });
        }
        const srcLabel = isAnixFile ? `Таблица Anixart / CSV (${f.name})` : `Таблица / Список (${f.name})`;
        await previewAndExecuteImport(candidates, srcLabel, fp, false, null);
      } else {
        toast('Не удалось распознать записи в файле. Проверь, что это CSV, JSON, XML или текстовый список.', true);
      }
    } catch (err) {
      toast('Ошибка чтения файла: ' + err.message, true);
    }
    e.target.value = '';
  })();
};

window.importKinopoiskFile = e => {
  const f = e.target.files[0]; if (!f) return;
  const readWithEncoding = enc => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsText(f, enc);
  });
  (async () => {
    try {
      let txt = await readWithEncoding('UTF-8');
      if ((txt.match(/\uFFFD/g) || []).length > 3) {
        txt = await readWithEncoding('windows-1251');
      }
      const fp = await sha256Hex(txt.slice(0, 50000) + '_' + txt.length);
      const candidates = parseKinopoiskContent(txt);
      if (!candidates.length) {
        toast('Не удалось распознать записи в файле Кинопоиска. Поддерживаются CSV, XLS/HTML таблицы, JSON и текстовые списки.', true);
        e.target.value = '';
        return;
      }
      await previewAndExecuteImport(candidates, 'Кинопоиск', fp, false, null);
    } catch (err) {
      toast('Ошибка чтения файла Кинопоиска: ' + err.message, true);
    }
    e.target.value = '';
  })();
};

// ---------- КНОПКА «🧹 Найти и объединить повторы» (с откатом при ошибке облака — Этап 1 п.1 и п.3) ----------
function itemCompletenessScore(it) {
  let s = 0;
  if (it.aniId || it.mal || it.tmdb) s += 50;
  if (num(it.rating) > 0) s += 30;
  if (it.status && it.status !== 'В планах') s += 20;
  if (it.completedAt) s += 15;
  if (it.myNote) s += 15;
  if (it.poster && !it.poster.startsWith('data:')) s += 10;
  if (it.description) s += 8;
  if ((it.tags || []).length) s += 5;
  if ((it.lists || []).length) s += 5;
  if (num(it.eps) > 0 || num(it.dur) > 0) s += 5;
  return s;
}

function mergeTwoDuplicateItems(best, other) {
  const merged = { ...best };
  if (!num(merged.rating) && num(other.rating)) merged.rating = other.rating;
  if (!merged.criteria && other.criteria) merged.criteria = other.criteria;
  if (merged.status === 'В планах' && other.status && other.status !== 'В планах') merged.status = other.status;
  if (!merged.completedAt && other.completedAt) merged.completedAt = other.completedAt;
  merged.fav = Boolean(merged.fav || other.fav);
  merged.pin = Boolean(merged.pin || other.pin);
  merged.rewatchCount = Math.max(num(merged.rewatchCount), num(other.rewatchCount));

  if (other.myNote && !merged.myNote) merged.myNote = other.myNote;
  else if (other.myNote && merged.myNote && !merged.myNote.includes(other.myNote)) {
    merged.myNote = merged.myNote + '\n' + other.myNote;
  }

  merged.lists = [...new Set([...(merged.lists || []), ...(other.lists || [])])];
  merged.tags = [...new Set([...(merged.tags || []), ...(other.tags || [])])];

  ['aniId', 'mal', 'tmdb', 'imdbId', 'poster', 'titleEn', 'titleOrig', 'alt', 'year', 'extRating', 'extSrc', 'description', 'author', 'studio', 'source', 'eps', 'vols', 'dur', 'format', 'subKind', 'recBy'].forEach(k => {
    if (!merged[k] && other[k]) merged[k] = other[k];
  });
  merged.needsReview = Boolean(!hasExternalCatalogId(merged) && merged.needsReview && other.needsReview);
  delete merged._knownStatusFromImport;
  return fix(merged);
}

async function findAndMergeDuplicatesModal() {
  $('dataModal').style.display = 'none';
  const visited = new Set();
  const groups = [];

  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    if (visited.has(a.id)) continue;
    const grp = [a];
    visited.add(a.id);
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      if (visited.has(b.id)) continue;
      if (same(a, b)) {
        grp.push(b);
        visited.add(b.id);
      }
    }
    if (grp.length > 1) groups.push(grp);
  }

  if (!groups.length) {
    return toast('Повторов не найдено — все записи в твоей коллекции уникальны! ✨');
  }

  const totalExtra = groups.reduce((s, g) => s + g.length - 1, 0);
  const confirmed = await dlgOpen(() => {
    $('dlgTitle').textContent = `🧹 Найдено групп повторов: ${groups.length} (лишних дублей: ${totalExtra})`;
    $('dlgText').textContent = 'Для каждой группы автоматически выбрана самая полная запись, в которую объединятся оценки, заметки, избранное, подборки и пересмотры. Перед запуском автоматически скачается резервная копия.';
    const body = $('dlgBody'); body.replaceChildren();
    const wrap = el('div');
    wrap.style.cssText = 'max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding:6px;background:rgba(0,0,0,.25);border-radius:10px;border:1px solid var(--bd);font-size:12.5px';
    groups.forEach(grp => {
      const sorted = [...grp].sort((x, y) => itemCompletenessScore(y) - itemCompletenessScore(x));
      const best = sorted[0];
      const r = el('div', 'row'); r.style.justifyContent = 'space-between';
      r.append(
        el('b', null, `${best.title} (${best.year || '—'}, ${catLabel(best)})`),
        el('span', 'chip', `×${grp.length} → 1 (${best.status}${best.rating ? ', ★' + best.rating : ''})`)
      );
      wrap.append(r);
    });
    body.append(wrap);
  }, `Объединить и удалить ${totalExtra} дублей`, false, () => true);

  if (!confirmed) return;

  window.exportData();
  const snapshotBeforeMerge = items.map(x => ({ ...x }));
  const toUpdate = [];
  const toDelete = [];

  groups.forEach(grp => {
    const sorted = [...grp].sort((x, y) => itemCompletenessScore(y) - itemCompletenessScore(x));
    let winner = { ...sorted[0] };
    for (let k = 1; k < sorted.length; k++) {
      winner = mergeTwoDuplicateItems(winner, sorted[k]);
      toDelete.push(sorted[k]);
    }
    toUpdate.push(winner);
  });

  // Этап 1 п.3: Сначала записываем изменения и удаления в облако, а при сбое откатываем и сообщаем причину!
  if (user && !user.isLocal && auth.currentUser) {
    try {
      const ops = [...toUpdate.map(i => ['s', i]), ...toDelete.map(i => ['d', i])];
      for (let i = 0; i < ops.length; i += 380) {
        const b = writeBatch(db);
        ops.slice(i, i + 380).forEach(([mode, it]) => {
          if (mode === 'd') {
            b.delete(doc(db, 'items', getCloudDocId(it)));
            if (it._docId && it._docId !== getCloudDocId(it)) b.delete(doc(db, 'items', String(it._docId)));
          } else {
            const { docId, payload } = prepareTitleForCloud(it, user.uid);
            b.set(doc(db, 'items', docId), payload);
          }
        });
        await track(b.commit());
      }
    } catch (cloudErr) {
      items = snapshotBeforeMerge;
      saveLocalItems();
      refresh();
      toast('Объединение повторов отменено — ошибка облака: ' + (cloudErr.code || cloudErr.message), true);
      return;
    }
  }

  toUpdate.forEach(winner => {
    const idx = items.findIndex(x => x.id === winner.id);
    if (idx > -1) items[idx] = winner;
  });
  const delSet = new Set(toDelete.map(x => x.id));
  items = deduplicateListByIdAndCleanupCloud(items.filter(i => !delSet.has(i.id)), false);
  saveLocalItems();
  refresh();

  toast(`Объединено групп: ${groups.length}, удалено лишних дублей: ${toDelete.length}!`, false, {
    label: '↩ Отменить объединение',
    fn: async () => {
      try {
        await batchSaveItems(snapshotBeforeMerge);
        items = snapshotBeforeMerge.map(fix);
        saveLocalItems();
        refresh();
        toast('Объединение повторов отменено — все записи возвращены.');
      } catch (e) {
        toast('Не удалось отменить в облаке: ' + (e.code || e.message), true);
      }
    }
  });
}
if ($('dedupMergeBtn')) $('dedupMergeBtn').onclick = findAndMergeDuplicatesModal;

// ---------- КНОПКА «🔗 Связать коллекцию с каталогом» (Исправлен Этап 1 п.11) ----------
function hasExternalCatalogId(it) {
  return Boolean(Number(it.aniId) > 0 || Number(it.mal) > 0 || (it.tmdb && String(it.tmdb).includes('/')));
}

// Хранение попыток связывания и очереди спорных совпадений в localStorage (чтобы не засорять документы в базе и восстанавливать очередь после перезагрузки — Этап 1 п.11)
function getLinkAttemptsMap() {
  try { return JSON.parse(localStorage.getItem(getUidStorageKey('linkAttemptsMap')) || '{}'); } catch (e) { return {}; }
}
function recordItemLinkAttempt(itemId) {
  try {
    const m = getLinkAttemptsMap();
    m[String(itemId)] = Date.now();
    localStorage.setItem(getUidStorageKey('linkAttemptsMap'), JSON.stringify(m));
  } catch (e) {}
}
function getItemLastLinkAttempt(it) {
  const m = getLinkAttemptsMap();
  return Number(m[String(it.id)] || it.lastLinkAttempt || 0);
}

let catalogLinkingActive = false;
let catalogLinkingStopRequested = false;

function saveUncertainMatchesCache() {
  const serialized = uncertainMatchesQueue.slice(0, 150).map(u => ({ itemId: u.item.id, candidates: u.candidates }));
  const key = getUidStorageKey('uncertainMatchesCache');
  idbVault.set(key, serialized);
  try {
    localStorage.setItem(key, JSON.stringify(serialized));
  } catch (e) {}
}

async function restoreUncertainMatchesFromStorage() {
  if (!items.length) return;
  try {
    const key = getUidStorageKey('uncertainMatchesCache');
    let raw = await idbVault.get(key);
    if (!Array.isArray(raw) || !raw.length) {
      raw = JSON.parse(localStorage.getItem(key) || '[]');
    }
    if (Array.isArray(raw) && raw.length) {
      const existingIds = new Set(uncertainMatchesQueue.map(u => String(u.item.id)));
      raw.forEach(entry => {
        if (existingIds.has(String(entry.itemId))) return;
        const it = items.find(x => String(x.id) === String(entry.itemId) && !hasExternalCatalogId(x));
        if (it && Array.isArray(entry.candidates) && entry.candidates.length) {
          uncertainMatchesQueue.push({ item: it, candidates: entry.candidates });
          existingIds.add(String(it.id));
        }
      });
    }
    if (uncertainMatchesQueue.length) {
      updateCatalogLinkProgressUI(`📋 Спорные совпадения для проверки: ${uncertainMatchesQueue.length} шт.`, false);
    }
  } catch (e) {}
}

// Этап 1 п.11: НЕ перезаписываем уже существующие aniId, mal и tmdb!
function applyCatalogMatchToItem(it, match, allowFillMissingIds = true) {
  if (allowFillMissingIds) {
    if (match.aniId && !Number(it.aniId)) it.aniId = match.aniId;
    if (match.mal && !Number(it.mal)) it.mal = match.mal;
    if (match.tmdb && !it.tmdb) it.tmdb = match.tmdb;
  }
  if (match.format && !it.format) it.format = match.format;
  if (match.isAdult) it.isAdult = true;
  if (match.subKind && it.category === 'Манга' && (!it.subKind || it.subKind === 'Манга')) it.subKind = match.subKind;
  if (match.poster && (!it.poster || it.poster === FALL)) it.poster = match.poster;
  if (match.title && hasRu(match.title) && !hasRu(it.title)) {
    if (!it.titleEn) it.titleEn = it.title;
    it.title = match.title;
  }
  if (match.en && !it.titleEn) it.titleEn = match.en;
  if (match.orig && !it.titleOrig) it.titleOrig = match.orig;
  if (match.alt && !it.alt) it.alt = match.alt;
  if (match.year && !it.year) it.year = String(match.year);
  if (match.ext && !it.extRating) { it.extRating = String(match.ext); it.extSrc = match.src || ''; }
  if (match.desc && !it.description) it.description = match.desc;
  if (match.author && !it.author) it.author = match.author;
  if (match.studio && !it.studio) it.studio = match.studio;
  if (match.source && !it.source) it.source = match.source;
  if (match.eps && !num(it.eps)) it.eps = match.eps;
  if (match.vols && !num(it.vols)) it.vols = match.vols;
  if (match.dur && !num(it.dur)) it.dur = match.dur;
  if (Array.isArray(match.tags) && match.tags.length && (!it.tags || !it.tags.length)) it.tags = match.tags;
  if (it._knownStatusFromImport !== false) it.needsReview = false;
  delete it._knownStatusFromImport;
  delete it.lastLinkAttempt;
  fix(it);
}

// Этап 1 п.11: Если у тайтла УЖЕ есть aniId, mal или tmdb — запрашиваем каталог строго по этому ID, а не ищем по названию!
async function findCatalogMatchForItem(it) {
  const isAni = ['Аниме', 'Манга', 'Ранобэ'].includes(it.category);
  if (isAni) {
    const mType = it.category === 'Аниме' ? 'ANIME' : 'MANGA';
    // 1. Если уже есть aniId — запрашиваем строго по id
    if (Number(it.aniId) > 0) {
      const byAni = await _anilistRaw(null, mType, { id: Number(it.aniId), per: 1 }).catch(() => []);
      if (byAni[0]) {
        try { await ruFull(byAni[0]); } catch (e) {}
        return { confident: true, match: byAni[0], candidates: byAni };
      }
    }
    // 2. Если уже есть idMal — запрашиваем строго по idMal
    if (Number(it.mal) > 0) {
      const byMal = await _anilistRaw(null, mType, { idMal: Number(it.mal), per: 3 }).catch(() => []);
      if (byMal[0]) {
        try { await ruFull(byMal[0]); } catch (e) {}
        return { confident: true, match: byMal[0], candidates: byMal };
      }
    }
    // 3. Быстрый и точный поиск по названию (сначала напрямую через Shikimori для русских названий из Anixart, затем AniList)
    const cleanAnixSearch = s => String(s || '')
      .replace(/\[(?:тв|tv|ova|ona|фильм|movie)[^\]]*\]/gi, ' ')
      .replace(/\((?:тв-?1|tv-?1|тв|tv|сериал)\)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const qStr = cleanAnixSearch(it.title || it.titleEn || it.titleOrig);
    if (!qStr) return { confident: false, match: null, candidates: [] };

    const itemNames = nset(it);
    const itemYear = parseInt(it.year) || 0;
    const itemMarker = getItemMarkers(it);

    const calcWordOverlap = (aStr, bStr) => {
      const wa = normTitleStr(aStr).split(' ').filter(w => w.length >= 2);
      const wb = normTitleStr(bStr).split(' ').filter(w => w.length >= 2);
      if (!wa.length || !wb.length) return 0;
      const setB = new Set(wb);
      const common = wa.filter(w => setB.has(w)).length;
      return common / Math.max(Math.min(wa.length, wb.length), 1);
    };

    // Шаг 3А: Прямой поиск в Shikimori (идеально понимает русские названия Anixart за 1 быстрый запрос!)
    const shikiKind = SHK[it.category] || 'animes';
    try {
      const shRes = await shiki(`/api/${shikiKind}?search=${encodeURIComponent(qStr)}&limit=6`);
      if (Array.isArray(shRes) && shRes.length) {
        const shCandidates = shRes.map(d => ({
          mal: d.id,
          title: d.russian || d.name || '',
          en: d.name || '',
          orig: d.name || '',
          alt: '',
          poster: d.image?.original ? 'https://shikimori.io' + d.image.original : '',
          year: String(d.aired_on || d.released_on || '').slice(0, 4),
          ext: d.score && Number(d.score) > 0 ? Number(d.score).toFixed(1) : '',
          src: 'Shikimori',
          eps: Number(d.episodes || d.chapters || d.episodes_aired) || 0,
          vols: Number(d.volumes) || 0,
          dur: it.category === 'Аниме' ? 24 : 0,
          ongoing: d.status === 'ongoing',
          category: it.category,
          subKind: it.category === 'Манга' ? (d.kind === 'manhwa' ? 'Манхва' : d.kind === 'manhua' ? 'Маньхуа' : 'Манга') : ''
        }));

        for (const c of shCandidates) {
          const candNames = nset(c);
          const exactTitle = itemNames.some(n => candNames.includes(n));
          const overlap = Math.max(calcWordOverlap(it.title, c.title), calcWordOverlap(it.titleEn || it.title, c.en));
          const cYear = parseInt(c.year) || 0;
          const yearOk = !itemYear || !cYear || Math.abs(itemYear - cYear) <= 2;
          const markerOk = getItemMarkers(c) === itemMarker || (!itemMarker && !getItemMarkers(c));
          if ((exactTitle || overlap >= 0.8) && yearOk && markerOk) {
            return { confident: true, match: c, candidates: shCandidates };
          }
        }
        // Если на Shikimori ровно 1 результат или первый результат очень близок по словам и году
        const topSh = shCandidates[0];
        const topOverlap = Math.max(calcWordOverlap(it.title, topSh.title), calcWordOverlap(it.titleEn || it.title, topSh.en));
        const topYearOk = !itemYear || !parseInt(topSh.year) || Math.abs(itemYear - parseInt(topSh.year)) <= 2;
        if ((shCandidates.length === 1 && topOverlap >= 0.5) || (topOverlap >= 0.72 && topYearOk)) {
          return { confident: true, match: topSh, candidates: shCandidates };
        }
        return { confident: false, match: topSh, candidates: shCandidates };
      }
    } catch (e) {}

    // Шаг 3Б: Поиск через AniList GraphQL
    const candidates = await anilist(it.titleEn || qStr, mType, { per: 6 }).catch(() => []);
    if (!candidates.length) return { confident: false, match: null, candidates: [] };
    try { await ruFull(candidates[0]); } catch (e) {}

    for (const c of candidates) {
      const candNames = nset(c);
      const exactTitle = itemNames.some(n => candNames.includes(n));
      const overlap = Math.max(calcWordOverlap(it.title, c.title), calcWordOverlap(it.titleEn || it.title, c.en));
      const cYear = parseInt(c.year) || 0;
      const yearOk = !itemYear || !cYear || Math.abs(itemYear - cYear) <= 2;
      const markerOk = getItemMarkers(c) === itemMarker;
      if ((exactTitle || overlap >= 0.8) && yearOk && markerOk) {
        try { await ruFull(c); } catch (e) {}
        return { confident: true, match: c, candidates };
      }
    }
    return { confident: false, match: candidates[0], candidates };
  } else {
    const k = getActiveTmdbKey();
    // 1. Если у тайтла УЖЕ есть tmdb ('movie/123' или 'tv/123') — запрашиваем TMDB напрямую по этому ID!
    if (it.tmdb && /^(movie|tv)\/\d+$/i.test(String(it.tmdb))) {
      try {
        const [mType, rawId] = String(it.tmdb).split('/');
        const d = await ruJson(`https://api.themoviedb.org/3/${mType}/${rawId}?api_key=${encodeURIComponent(k)}&language=ru-RU&append_to_response=credits`, 6000);
        if (d && d.id) {
          const orig = d.original_title || d.original_name || '';
          const dir = (d.credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name);
          const by = (d.created_by || []).map(c => c.name);
          const matchObj = {
            title: d.title || d.name, en: orig, orig, alt: '',
            poster: d.poster_path ? 'https://image.tmdb.org/t/p/w342' + d.poster_path : '',
            year: (d.release_date || d.first_air_date || '').slice(0, 4),
            ext: d.vote_count ? d.vote_average.toFixed(1) : '',
            tags: (d.genres || []).map(g => g.name || TG[g.id]).filter(Boolean),
            tmdb: mType + '/' + d.id, src: 'TMDB', desc: d.overview || '',
            category: mType === 'tv' ? 'Сериал' : 'Фильм',
            author: [...new Set([...by, ...dir])].slice(0, 2).join(', '),
            studio: (d.production_companies || []).slice(0, 2).map(c => c.name).join(', '),
            dur: d.runtime || (d.episode_run_time || [])[0] || 0,
            eps: d.number_of_episodes || 0
          };
          return { confident: true, match: matchObj, candidates: [matchObj] };
        }
      } catch (e) {}
    }

    // 2. Поиск по imdbId (с одинарным слэшем /^tt\d+$/i!)
    if (it.imdbId && /^tt\d+$/i.test(it.imdbId)) {
      try {
        const fj = await ruJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(it.imdbId)}?api_key=${encodeURIComponent(k)}&language=ru-RU&external_source=imdb_id`, 6000);
        const hitM = (fj.movie_results || [])[0];
        const hitT = (fj.tv_results || [])[0];
        const x = hitM || hitT;
        if (x) {
          const mType = hitM ? 'movie' : 'tv';
          const orig = x.original_title || x.original_name || '';
          const matchObj = {
            title: x.title || x.name, en: orig, orig, alt: '',
            poster: x.poster_path ? 'https://image.tmdb.org/t/p/w342' + x.poster_path : '',
            year: (x.release_date || x.first_air_date || '').slice(0, 4),
            ext: x.vote_count ? x.vote_average.toFixed(1) : '',
            tags: (x.genre_ids || []).map(g => TG[g]).filter(Boolean),
            tmdb: mType + '/' + x.id, src: 'TMDB', desc: x.overview || '',
            category: mType === 'tv' ? 'Сериал' : 'Фильм'
          };
          try { Object.assign(matchObj, await tmdbInfo(matchObj)); } catch (e) {}
          return { confident: true, match: matchObj, candidates: [matchObj] };
        }
      } catch (e) {}
    }

    // 3. Поиск по названию и году
    const qStr = it.title || it.titleEn || it.titleOrig;
    if (!qStr) return { confident: false, match: null, candidates: [] };
    const candidates = await tmdb(qStr).catch(() => []);
    if (!candidates.length) return { confident: false, match: null, candidates: [] };
    const itemNames = nset(it);
    const itemYear = parseInt(it.year) || 0;

    for (const c of candidates) {
      const candNames = nset(c);
      const exactTitle = itemNames.some(n => candNames.includes(n));
      const cYear = parseInt(c.year) || 0;
      const yearOk = !itemYear || !cYear || Math.abs(itemYear - cYear) <= 1;
      if (exactTitle && yearOk && sameCat(c.category, it.category)) {
        try { Object.assign(c, await tmdbInfo(c)); } catch (e) {}
        return { confident: true, match: c, candidates };
      }
    }
    return { confident: false, match: candidates[0], candidates };
  }
}

function updateCatalogLinkProgressUI(text, showStop = true) {
  const bar = $('catalogLinkProgressBar'), txt = $('catalogLinkProgressTxt'), revB = $('catalogLinkReviewBtn'), stopB = $('catalogLinkStopBtn');
  if (!bar || !txt) return;
  bar.style.display = text ? 'flex' : 'none';
  txt.textContent = text || '';
  if (stopB) stopB.style.display = showStop ? '' : 'none';
  if (revB) {
    revB.style.display = uncertainMatchesQueue.length ? '' : 'none';
    revB.textContent = `📋 Подтвердить спорные (${uncertainMatchesQueue.length})`;
  }
}

async function startCatalogLinkingForList(targetList, manualTrigger = false) {
  if (catalogLinkingActive) {
    if (manualTrigger) toast('Связывание с каталогом уже выполняется в фоне');
    return;
  }
  const now = Date.now();
  const queue = (targetList || []).filter(i => {
    if (!i || i.archived) return false;
    if (hasExternalCatalogId(i) && i.poster && num(i.eps || i.dur)) return false;
    const lastTry = getItemLastLinkAttempt(i);
    if (!manualTrigger && lastTry && (now - lastTry) < 86400000) return false;
    return true;
  });

  if (!queue.length) {
    restoreUncertainMatchesFromStorage();
    if (manualTrigger) toast('Все тайтлы уже связаны с каталогом (AniList / TMDB) ✓', false, { label: '🧹 Найти повторы', fn: () => findAndMergeDuplicatesModal() });
    return;
  }

  catalogLinkingActive = true;
  catalogLinkingStopRequested = false;
  $('dataModal').style.display = 'none';
  try { localStorage.setItem(getUidStorageKey('catalogLinkPending'), '1'); } catch (e) {}

  let linkedCount = 0;
  const dirtyBatch = [];
  const flushDirtyBatch = async () => {
    if (!dirtyBatch.length) return;
    const toSave = dirtyBatch.splice(0, dirtyBatch.length);
    saveLocalItems();
    try { await batchSaveItems(toSave); } catch (e) {}
  };

  // Обрабатываем микро-пачками по 2 тайтла с короткой паузой 320мс и пакетной записью в Firestore каждые 25 записей
  const CONCURRENCY = 2;
  for (let idx = 0; idx < queue.length; idx += CONCURRENCY) {
    if (catalogLinkingStopRequested) break;
    const slice = queue.slice(idx, idx + CONCURRENCY);
    updateCatalogLinkProgressUI(`🔗 Связываю с каталогом: ${Math.min(queue.length, idx + slice.length)} из ${queue.length} («${slice[0].title}»)… Связано: ${linkedCount}`);

    await Promise.all(slice.map(async it => {
      recordItemLinkAttempt(it.id);
      try {
        const res = await findCatalogMatchForItem(it);
        if (res.confident && res.match) {
          applyCatalogMatchToItem(it, res.match, true);
          it.needsReview = false;
          dirtyBatch.push(it);
          linkedCount++;
          const qIdx = uncertainMatchesQueue.findIndex(u => String(u.item.id) === String(it.id));
          if (qIdx > -1) uncertainMatchesQueue.splice(qIdx, 1);
          updateSingleItemCardInDOM(it.id);
        } else if (res.candidates && res.candidates.length) {
          // Не сбрасываем статус и не прячем тайтл из коллекции — просто сохраняем кандидатов в список спорных
          const existingQ = uncertainMatchesQueue.findIndex(u => String(u.item.id) === String(it.id));
          if (existingQ > -1) uncertainMatchesQueue[existingQ] = { item: it, candidates: res.candidates.slice(0, 4) };
          else uncertainMatchesQueue.push({ item: it, candidates: res.candidates.slice(0, 4) });
        }
      } catch (e) {}
    }));

    if (dirtyBatch.length >= 25) {
      await flushDirtyBatch();
      saveUncertainMatchesCache();
    }
    await ruWait(320);
  }

  await flushDirtyBatch();
  catalogLinkingActive = false;
  try { localStorage.removeItem(getUidStorageKey('catalogLinkPending')); } catch (e) {}
  saveUncertainMatchesCache();
  refresh();

  if (uncertainMatchesQueue.length) {
    updateCatalogLinkProgressUI(`🔗 Готово! Автоматически связано: ${linkedCount} из ${queue.length}. Требуют подтверждения: ${uncertainMatchesQueue.length} шт.`, false);
  } else {
    updateCatalogLinkProgressUI('', false);
  }
  // Этап 1 п.11: После связывания предлагаем «🧹 Найти повторы»
  if (manualTrigger || linkedCount > 0) {
    toast(`🔗 Связано с каталогом: ${linkedCount} из ${queue.length} тайтлов!`, false, {
      label: '🧹 Найти повторы',
      fn: () => findAndMergeDuplicatesModal()
    });
  }
}

function resumeBackgroundCatalogLinkingIfNeeded() {
  if (catalogLinkingActive || !items.length) return;
  restoreUncertainMatchesFromStorage();
  const pendingFlag = localStorage.getItem(getUidStorageKey('catalogLinkPending'));
  const unlinked = items.filter(i => !i.archived && !hasExternalCatalogId(i) && (Date.now() - getItemLastLinkAttempt(i)) > 86400000);
  if (pendingFlag && unlinked.length) {
    startCatalogLinkingForList(unlinked, false);
  }
}

if ($('linkCollectionCatalogBtn')) {
  $('linkCollectionCatalogBtn').onclick = () => {
    const needLink = items.filter(i => !i.archived && (!hasExternalCatalogId(i) || !i.poster || (!num(i.eps) && !num(i.dur))));
    startCatalogLinkingForList(needLink, true);
  };
}
if ($('catalogLinkStopBtn')) {
  $('catalogLinkStopBtn').onclick = () => {
    catalogLinkingStopRequested = true;
    try { localStorage.removeItem(getUidStorageKey('catalogLinkPending')); } catch (e) {}
    updateCatalogLinkProgressUI('⏹ Фоновое связывание приостановлено.', false);
  };
}
if ($('catalogLinkReviewBtn')) {
  $('catalogLinkReviewBtn').onclick = () => openUncertainMatchesConfirmDialog();
}

async function openUncertainMatchesConfirmDialog() {
  await restoreUncertainMatchesFromStorage();
  if (!uncertainMatchesQueue.length) return toast('Нет спорных совпадений для подтверждения');
  dlgOpen(() => {
    $('dlgTitle').textContent = `📋 Подтверждение совпадений с каталогом (${uncertainMatchesQueue.length})`;
    $('dlgText').textContent = 'Можно привязать лучший вариант для всех сразу одной кнопкой или выбрать вручную:';
    const body = $('dlgBody'); body.replaceChildren();

    const bulkRow = el('div', 'row');
    bulkRow.style.cssText = 'gap:8px;margin-bottom:6px';
    const acceptAllBtn = el('button', 'btn', `✨ Принять первый вариант для всех (${uncertainMatchesQueue.length})`);
    acceptAllBtn.type = 'button';
    acceptAllBtn.style.cssText = 'flex:1;padding:8px 12px;font-size:12.5px';
    acceptAllBtn.onclick = async () => {
      acceptAllBtn.disabled = true;
      acceptAllBtn.textContent = '⏳ Привязываю все записи…';
      const modified = [];
      while (uncertainMatchesQueue.length) {
        const entry = uncertainMatchesQueue.shift();
        if (entry && entry.item && entry.candidates && entry.candidates[0]) {
          applyCatalogMatchToItem(entry.item, entry.candidates[0], true);
          entry.item.needsReview = false;
          modified.push(entry.item);
        }
      }
      saveUncertainMatchesCache();
      saveLocalItems();
      if (modified.length) await batchSaveItems(modified);
      updateCatalogLinkProgressUI('', false);
      if (dlgDone) dlgDone(true);
      refresh();
      toast(`Связано записей: ${modified.length} шт.!`, false, { label: '🧹 Объединить дубликаты', fn: () => findAndMergeDuplicatesModal() });
    };

    const dismissAllBtn = el('button', 'btn btn-s', '✕ Скрыть список');
    dismissAllBtn.type = 'button';
    dismissAllBtn.style.cssText = 'padding:8px 12px;font-size:12.5px';
    dismissAllBtn.onclick = () => {
      uncertainMatchesQueue.length = 0;
      saveUncertainMatchesCache();
      updateCatalogLinkProgressUI('', false);
      if (dlgDone) dlgDone(true);
      toast('Список спорных совпадений скрыт');
    };
    bulkRow.append(acceptAllBtn, dismissAllBtn);
    body.append(bulkRow);

    const wrap = el('div');
    wrap.style.cssText = 'max-height:360px;overflow-y:auto;display:flex;flex-direction:column;gap:10px';
    uncertainMatchesQueue.slice(0, 20).forEach(entry => {
      const box = el('div');
      box.style.cssText = 'padding:10px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid var(--bd)';
      box.append(el('b', null, `В коллекции: «${entry.item.title}» (${entry.item.year || 'год не указан'}, ${catLabel(entry.item)})`));
      const cList = el('div'); cList.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:6px';
      entry.candidates.forEach(cand => {
        const r = el('div', 'u-res-row'); r.style.padding = '6px 8px'; r.style.background = 'rgba(0,0,0,.25)';
        const im = el('img'); im.src = safePosterUrl(cand.poster); im.style.borderRadius = '6px';
        const inf = el('div'); inf.style.flex = '1';
        inf.append(el('b', null, cand.title), el('div', 'meta', `${catLabel(cand)} · ${cand.year || '?'} · ★ ${cand.ext || '—'}`));
        const pickB = el('button', 'btn', 'Выбрать'); pickB.type = 'button'; pickB.style.padding = '5px 10px'; pickB.style.fontSize = '12px';
        pickB.onclick = async () => {
          applyCatalogMatchToItem(entry.item, cand, true);
          entry.item.needsReview = false;
          await cloudSave(entry.item);
          const qIdx = uncertainMatchesQueue.indexOf(entry);
          if (qIdx > -1) uncertainMatchesQueue.splice(qIdx, 1);
          saveUncertainMatchesCache();
          box.remove();
          refresh();
          toast(`Связано: ${entry.item.title}`, false, { label: '🧹 Найти повторы', fn: () => findAndMergeDuplicatesModal() });
        };
        r.append(im, inf, pickB);
        cList.append(r);
      });
      box.append(cList);
      wrap.append(box);
    });
    body.append(wrap);
  }, 'Готово', false, () => true);
}

// ---------- ВКЛАДКА «📥 Разобрать (N)» (Этап 2 п.5) ----------
function renderReviewItemsTab() {
  const box = $('reviewItemsBox');
  if (!box) return;
  box.replaceChildren();
  const revList = items.filter(i => !i.archived && i.needsReview);
  if (!revList.length) {
    box.append(el('div', 'msg', 'Во вкладке «📥 Разобрать» пусто — все записи проверены и связаны с каталогом!'));
    return;
  }

  const hdr = el('div', 'row'); hdr.style.justifyContent = 'space-between'; hdr.style.marginBottom = '10px';
  hdr.append(
    el('h4', null, `📥 Записи на разбор (${revList.length}) — уточни статус или свяжи с каталогом`),
    el('span', 'meta', `Выделено: ${reviewSelSet.size}`)
  );

  const bar = el('div', 'row'); bar.style.marginBottom = '12px'; bar.style.gap = '6px';
  const btnAll = el('button', 'btn btn-s', `Выбрать все (${revList.length})`); btnAll.type = 'button';
  btnAll.onclick = () => { revList.forEach(i => reviewSelSet.add(i.id)); renderReviewItemsTab(); };
  const btnNone = el('button', 'btn btn-s', 'Снять выделение'); btnNone.type = 'button';
  btnNone.onclick = () => { reviewSelSet.clear(); renderReviewItemsTab(); };

  const stSel = el('select');
  stSel.replaceChildren(new Option('Задать статус выбранным…', ''), ...STATS.map(s => new Option(s, s)));
  stSel.onchange = async () => {
    const v = stSel.value; stSel.value = '';
    if (!v || !reviewSelSet.size) return toast('Сначала отметь записи галочками', true);
    const hit = revList.filter(i => reviewSelSet.has(i.id));
    hit.forEach(i => { i.status = v; i.needsReview = false; });
    reviewSelSet.clear();
    await batchSaveItems(hit);
    refresh();
    renderReviewItemsTab();
    toast(`Статус «${v}» назначен для ${hit.length} записей!`);
  };

  const btnLink = el('button', 'btn btn-s', '🔗 Связать выбранные с каталогом'); btnLink.type = 'button';
  btnLink.onclick = async () => {
    const hit = reviewSelSet.size ? revList.filter(i => reviewSelSet.has(i.id)) : revList;
    await startCatalogLinkingForList(hit, true);
    renderReviewItemsTab();
  };

  const btnApprove = el('button', 'btn btn-s', '✓ Убрать метку «На разбор»'); btnApprove.type = 'button';
  btnApprove.onclick = async () => {
    const hit = reviewSelSet.size ? revList.filter(i => reviewSelSet.has(i.id)) : revList;
    hit.forEach(i => { i.needsReview = false; });
    reviewSelSet.clear();
    await batchSaveItems(hit);
    refresh();
    renderReviewItemsTab();
    toast(`Подтверждено записей: ${hit.length}`);
  };

  const btnDel = el('button', 'btn btn-d', '🗑 Удалить выбранные'); btnDel.type = 'button';
  btnDel.onclick = async () => {
    if (!reviewSelSet.size) return toast('Сначала отметь записи для удаления', true);
    const hit = revList.filter(i => reviewSelSet.has(i.id));
    if (!(await uiConfirm(`Удалить выбранные записи (${hit.length} шт.)?`, 'Удалить', true))) return;
    reviewSelSet.clear();
    await batchDeleteItemsWithUndo(hit, `Удалено из разбора: ${hit.length} шт.`);
    renderReviewItemsTab();
  };

  bar.append(btnAll, btnNone, stSel, btnLink, btnApprove, btnDel);
  box.append(hdr, bar);

  const listWrap = el('div'); listWrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;max-height:60vh;overflow-y:auto';
  revList.forEach(it => {
    const row = el('div', 'u-res-row'); row.style.border = '1px solid var(--bd)';
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = reviewSelSet.has(it.id); cb.style.width = '18px'; cb.style.height = '18px';
    cb.onchange = () => { if (cb.checked) reviewSelSet.add(it.id); else reviewSelSet.delete(it.id); renderReviewItemsTab(); };
    const im = el('img'); im.src = safePosterUrl(it.poster); im.style.borderRadius = '8px';
    const inf = el('div'); inf.style.flex = '1';
    const linkedTxt = hasExternalCatalogId(it) ? '✓ ID привязан' : '⚠ Без ID каталога';
    inf.append(
      el('b', null, `${it.title} (${it.year || '—'}, ${catLabel(it)})`),
      el('div', 'meta', `${linkedTxt} · Текущий статус: ${it.status}${it.importSource ? ' · Импорт: ' + it.importSource : ''}`)
    );
    const oneLinkB = el('button', 'btn btn-s', '🔗 Найти в каталоге'); oneLinkB.type = 'button';
    oneLinkB.onclick = () => { closeAll(); openAdd(it); $('afQuery').value = it.titleEn || it.title; $('afBtn').click(); };
    const okB = el('button', 'btn', '✓ ОК'); okB.type = 'button';
    okB.onclick = async () => { it.needsReview = false; await cloudSave(it); refresh(); renderReviewItemsTab(); };
    row.append(cb, im, inf, oneLinkB, okB);
    listWrap.append(row);
  });
  box.append(listWrap);
}

// ---------- Канбан-доска (ИСПРАВЛЕНИЕ ОШИБКИ №1: перенос в «Любимое» ставит отметку-сердечко и не ломает статус!) ----------
class KanbanManager {
  static STATUSES = [
    { key: 'В планах', label: '📋 В планах', color: '#64748b' },
    { key: 'Смотрю/Читаю', label: '▶ Смотрю / Читаю', color: '#38bdf8' },
    { key: 'Просмотрено/Прочитано', label: '✅ Завершено', color: '#1db57a' },
    { key: 'Брошено', label: '🛑 Брошено', color: '#ef4444' }
  ];
  static isKanbanActive = (window.innerWidth > 600 && localStorage.getItem('view') === 'kanban');
  static draggedId = null;

  static init() {
    window.addEventListener('resize', () => {
      if (window.innerWidth <= 600 && this.isKanbanActive) {
        this.isKanbanActive = false;
        if (view === 'kanban') view = 'grid';
        this.sync();
        render();
      }
    });
    this.sync();
  }
  static sync() {
    if (window.innerWidth <= 600 && this.isKanbanActive) {
      this.isKanbanActive = false;
      if (view === 'kanban') view = 'grid';
    }
    const b = $('kanbanBoard'), g = $('itemsGrid'); if (!b || !g) return;
    g.style.display = this.isKanbanActive ? 'none' : '';
    b.style.display = this.isKanbanActive ? 'grid' : 'none';
    if (this.isKanbanActive) this.renderBoard();
  }
  static renderBoard() {
    const board = $('kanbanBoard'); if (!board || !this.isKanbanActive) return;
    board.replaceChildren();
    const vis = getVisibleItems();
    const q = $('searchInput').value.toLowerCase().trim(), tg = $('tagFilter').value, lf = $('listFilter').value;
    const pool = vis.filter(i => !i.archived && (!q || names(i).includes(q)) && (cat === 'Всё' || (cat === 'Кино и сериалы' ? KINO.includes(i.category) : i.category === cat)) && (tg === 'Все' || (i.tags || []).some(t => t.toLowerCase() === tg)) && (lf === 'Все' || (i.lists || []).some(t => t.toLowerCase() === lf)));
    this.STATUSES.forEach(stCol => {
      const col = el('div', 'kanban-col'), list = el('div', 'kanban-list');
      const colItems = pool.filter(i => stCol.key === 'Смотрю/Читаю' ? (i.status === 'Смотрю/Читаю' || i.status === 'Пересматриваю') : i.status === stCol.key);
      const hdr = el('div', 'kanban-hdr'); const sp = el('span', null, stCol.label); sp.style.color = stCol.color; hdr.append(sp, el('span', 'meta', String(colItems.length)));
      col.ondragover = e => { e.preventDefault(); col.classList.add('drag-over'); };
      col.ondragleave = () => col.classList.remove('drag-over');
      col.ondrop = e => { e.preventDefault(); col.classList.remove('drag-over'); const id = Number(e.dataTransfer?.getData('text/plain') || this.draggedId); if (id) this.move(id, stCol.key); };
      colItems.forEach(it => {
        const c = el('div', 'k-card' + (selMode && selSet.has(it.id) ? ' sel' : ''));
        c.dataset.id = String(it.id);
        c.draggable = !selMode;
        c.ondragstart = e => { this.draggedId = it.id; e.dataTransfer?.setData('text/plain', String(it.id)); };
        const im = el('img'); im.loading = 'lazy'; im.src = safePosterUrl(it.poster); im.onerror = () => { im.onerror = null; im.src = FALL; };
        const inf = el('div'); inf.style.minWidth = '0';
        const mRow = el('div', 'k-meta'); mRow.append(el('span', null, [it.year, catLabel(it), it.fav ? '❤' : ''].filter(Boolean).join(' • ')), el('span', null, it.rating ? '★ ' + it.rating : ''));
        const qm = el('div', 'k-quick-move');
        {
          this.STATUSES.filter(s => s.key !== stCol.key).forEach(ts => {
            const mb = el('button', 'k-move-btn', '→ ' + ts.label.split(' ')[0]); mb.type = 'button';
            mb.onclick = ev => { ev.stopPropagation(); this.move(it.id, ts.key); }; qm.append(mb);
          });
        }
        inf.append(el('div', 'k-title', it.title), mRow, qm); c.append(im, inf);
        c.onclick = () => {
          if (selMode) {
            if (selSet.has(it.id)) selSet.delete(it.id);
            else selSet.add(it.id);
            selPaint();
            this.renderBoard();
            return;
          }
          openDetail(it.id);
        };
        list.append(c);
      });
      col.append(hdr, list); board.append(col);
    });
  }
  static move(id, newSt) {
    const it = items.find(i => i.id === id); if (!it) return;
    if (newSt === 'Любимое') {
      it.fav = !it.fav;
      if (it.fav && it.status !== 'Просмотрено/Прочитано' && it.status !== 'Пересматриваю') {
        it.status = 'Просмотрено/Прочитано';
        if (!it.completedAt) it.completedAt = Date.now();
      }
      cloudSave(it); refresh({ itemId: it.id });
      toast(it.fav ? `«${it.title}» отмечено как ❤ Любимое` : `«${it.title}» убрано из Любимого`);
      return;
    }
    const oldSt = it.status; if (oldSt === newSt) return;
    it.status = newSt;
    if (newSt === 'Просмотрено/Прочитано' && !it.completedAt) it.completedAt = Date.now();
    cloudSave(it); refresh({ itemId: it.id });
    toast(`«${it.title}» → ${getStatusLabelForCategory(newSt, it.category)}`, false, { label: 'Отменить', fn: () => { it.status = oldSt; cloudSave(it); refresh({ itemId: it.id }); } });
  }
}

// Безопасная отрисовка баннера выборки (без XSS через название подборки!)
function renderStatusAndCategoryBanner() {
  const banner = $('statusSummaryBanner'); if (!banner) return;
  const vis = getVisibleItems();
  if (!vis.length) { banner.style.display = 'none'; return; }
  const st = $('statusFilter').value, lf = $('listFilter').value;
  banner.style.display = 'flex'; banner.replaceChildren();
  const left = el('div'), right = el('div', 'status-summary-metrics');
  if (st === 'Архив') {
    left.append(el('b', null, '📦 Архив коллекции'), el('div', 'meta', 'Произведения, временно скрытые из основной коллекции.'));
  } else {
    const stLbl = st === 'Все' ? 'Вся активная коллекция' : `Список: «${st}»`;
    const lLbl = lf !== 'Все' ? ` · Подборка «${$('listFilter').selectedOptions[0]?.textContent.replace('📁 ', '')}»` : '';
    left.append(el('b', null, `📊 Статистика выборки (${stLbl}${lLbl})`), el('div', 'meta', 'Учитываются произведения внутри выбранного фильтра'));
  }
  const addP = (l, v) => { const p = el('span', 'status-metric-pill'); p.append(document.createTextNode(l + ': '), el('b', null, v)); right.append(p); };
  addP('Тайтлов', String(lastList.length));
  const an = lastList.filter(i => i.category === 'Аниме');
  if (an.length) addP('🌸 Аниме', `${an.length} шт. · ${formatWatchTimeRu(an.reduce((s, i) => s + getItemMinutes(i), 0))}`);
  const mg = lastList.filter(i => i.category === 'Манга');
  if (mg.length) {
    const ch = mg.reduce((s, i) => s + num(i.eps), 0), vl = mg.reduce((s, i) => s + num(i.vols), 0);
    addP('📖 Манга', `${mg.length} шт. · ${ch} гл.${vl ? ' · ' + vl + ' т.' : ''}`);
  }
  const vd = lastList.filter(i => KINO.includes(i.category));
  if (vd.length) addP('🎬 Кино и сериалы', `${vd.length} шт. · ${formatWatchTimeRu(vd.reduce((s, i) => s + getItemMinutes(i), 0))}`);
  banner.append(left, right);
}

// ---------- ОТРИСОВКА НОВОГО ГИБРИДНОГО ПРОФИЛЯ (Между Скриншотом 1 и Скриншотом 2) ----------
function renderAnixartHeroAndCategoryCards() {
  const vis = getVisibleItems().filter(i => !i.archived);
  const completed = vis.filter(isCompletedItem);
  const doneAnime = completed.filter(i => i.category === 'Аниме');
  const doneVideoAll = completed.filter(i => KINO.includes(i.category));
  const doneManga = completed.filter(i => i.category === 'Манга');
  const doneRanobe = completed.filter(i => i.category === 'Ранобэ');

  const animeMins = doneAnime.reduce((s, i) => s + getItemMinutes(i), 0);
  const videoMinsAll = doneVideoAll.reduce((s, i) => s + getItemMinutes(i), 0);
  const totalWatchMins = animeMins + videoMinsAll;
  const rewatchExtraMins = completed.reduce((s, i) => s + getBaseItemMinutes(i) * Math.max(0, num(i.rewatchCount)), 0);
  const totalEpisodes = completed.filter(i => i.category === 'Аниме' || i.category === 'Сериал').reduce((s, i) => s + getItemEpisodesCount(i), 0);
  const totalChapters = [...doneManga, ...doneRanobe].reduce((s, i) => s + num(i.eps), 0);
  const totalVolumes = [...doneManga, ...doneRanobe].reduce((s, i) => s + num(i.vols), 0);
  const favCount = vis.filter(i => i.fav).length;
  const ratedCount = vis.filter(i => num(i.rating) > 0).length;

  // Плашка «СЕЙЧАС СМОТРЮ» на обложке
  const nwBox = $('hybNowWatching');
  if (nwBox) {
    const watchingItem = vis.filter(i => i.status === 'Смотрю/Читаю').sort((a, b) => (b.updatedAt || b.id) - (a.updatedAt || a.id))[0];
    if (watchingItem) {
      nwBox.style.display = 'inline-flex';
      $('hybNwPoster').src = safePosterUrl(watchingItem.poster);
      $('hybNwTitle').textContent = watchingItem.title;
      $('hybNwSub').textContent = `${catLabel(watchingItem)}${watchingItem.eps ? ' · ' + watchingItem.eps + ' сер.' : ''}`;
      nwBox.onclick = () => openDetail(watchingItem.id);
    } else {
      nwBox.style.display = 'none';
    }
  }

  const regDate = new Date(prof.createdAt || Date.now());
  const sinceStr = regDate.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  if ($('hybHeroTimeNum')) {
    $('hybHeroTimeNum').textContent = formatWatchTimeRu(totalWatchMins);
  }
  if ($('hybHeroTimeSub')) {
    $('hybHeroTimeSub').textContent = `общее время просмотра (фильмы, сериалы и аниме) с ${sinceStr}${rewatchExtraMins > 0 ? ' · вкл. пересмотры: ' + formatWatchTimeRu(rewatchExtraMins) : ''}`;
  }

  const qcBox = $('hybQuickCounters');
  if (qcBox) {
    qcBox.replaceChildren();
    const addQc = (val, lbl, onClickFn = null) => {
      const d = el('div', 'hyb-qc-item' + (onClickFn ? ' clickable' : ''));
      d.append(el('b', null, String(val)), el('span', null, lbl));
      if (onClickFn) {
        d.title = 'Нажми, чтобы открыть «Любимое»';
        d.onclick = onClickFn;
      }
      qcBox.append(d);
    };
    addQc(totalEpisodes.toLocaleString('ru-RU'), `${pluralRu(totalEpisodes, 'серия', 'серии', 'серий')} просмотрено`);
    if (totalChapters > 0) addQc(totalChapters.toLocaleString('ru-RU'), `${pluralRu(totalChapters, 'глава', 'главы', 'глав')} прочитано (манга и ранобэ)`);
    if (totalVolumes > 0) addQc(totalVolumes.toLocaleString('ru-RU'), `${pluralRu(totalVolumes, 'том', 'тома', 'томов')} прочитано`);
    addQc(favCount, 'в любимом', () => {
      applyMainTabView('collection');
      if ($('reviewItemsBox')) $('reviewItemsBox').style.display = 'none';
      $('profColWrap').style.display = '';
      $('statusFilter').value = 'Любимое';
      render(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    addQc(ratedCount, pluralRu(ratedCount, 'оценка', 'оценки', 'оценок'));
  }

  if ($('hybTotalListCount')) $('hybTotalListCount').textContent = `${vis.length} ${pluralRu(vis.length, 'тайтл', 'тайтла', 'тайтлов')}`;
  const tot = Math.max(1, vis.length);
  const wWatch = (vis.filter(i => i.status === 'Смотрю/Читаю' || i.status === 'Пересматриваю').length / tot * 100).toFixed(1);
  const wDone = (vis.filter(i => i.status === 'Просмотрено/Прочитано').length / tot * 100).toFixed(1);
  const wPlan = (vis.filter(i => i.status === 'В планах').length / tot * 100).toFixed(1);
  const wDrop = (vis.filter(i => i.status === 'Брошено').length / tot * 100).toFixed(1);
  if ($('hybProgressBar')) {
    $('hybProgressBar').innerHTML = `
      <i style="width:${wWatch}%;background:#10b981"></i>
      <i style="width:${wDone}%;background:#38bdf8"></i>
      <i style="width:${wPlan}%;background:#8b5cf6"></i>
      <i style="width:${wDrop}%;background:#ef4444"></i>
    `;
  }

  const cardsRow = $('hybListCardsRow');
  if (cardsRow) {
    cardsRow.replaceChildren();
    const LIST_DEFS = [
      { st: 'Смотрю/Читаю', title: 'Смотрю', dot: '#10b981', flt: i => i.status === 'Смотрю/Читаю' || i.status === 'Пересматриваю' },
      { st: 'Просмотрено/Прочитано', title: 'Просмотрено', dot: '#38bdf8', flt: i => i.status === 'Просмотрено/Прочитано' },
      { st: 'В планах', title: 'В планах', dot: '#a855f7', flt: i => i.status === 'В планах' },
      { st: 'Любимое', title: 'Любимое', dot: '#ec4899', flt: i => !!i.fav },
      { st: 'Брошено', title: 'Брошено', dot: '#ef4444', flt: i => i.status === 'Брошено' }
    ];
    const curSt = $('statusFilter').value;
    LIST_DEFS.forEach(def => {
      const matched = vis.filter(def.flt);
      const card = el('div', 'hyb-lcard' + (curSt === def.st ? ' active' : ''));
      card.dataset.st = def.st;
      const collage = el('div', 'hyb-lcard-collage');
      const posters = matched.map(x => x.poster).filter(Boolean).slice(0, 3);
      for (let idx = 0; idx < 3; idx++) {
        if (posters[idx]) {
          const im = el('img', 'c-slot' + (idx === 0 ? ' main' : ''));
          im.loading = 'lazy';
          im.src = safePosterUrl(posters[idx]);
          im.onerror = () => { im.onerror = null; im.src = FALL; };
          collage.append(im);
        } else {
          const empty = el('div', 'c-slot' + (idx === 0 ? ' main' : ''));
          collage.append(empty);
        }
      }
      const lbl = el('div', 'hyb-lcard-lbl');
      const dot = el('span'); dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${def.dot};display:inline-block`;
      lbl.append(dot, document.createTextNode(def.title));
      const cnt = el('div', 'hyb-lcard-cnt', `${matched.length} ${pluralRu(matched.length, 'тайтл', 'тайтла', 'тайтлов')}`);
      card.append(collage, lbl, cnt);
      card.onclick = () => {
        applyMainTabView('collection');
        if ($('reviewItemsBox')) $('reviewItemsBox').style.display = 'none';
        $('profColWrap').style.display = '';
        $('statusFilter').value = def.st;
        render(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      };
      cardsRow.append(card);
    });
  }
}



function updateProfileMetaAndPrivacyUI() {
  if (!prof.createdAt) {
    const fbTime = user && !user.isLocal && user.metadata?.creationTime ? new Date(user.metadata.creationTime).getTime() : 0;
    prof.createdAt = fbTime || items.map(born).filter(Boolean).sort((a, b) => a - b)[0] || Date.now();
  }
  const regDate = new Date(prof.createdAt || Date.now());
  if ($('profSince')) {
    const daysOnSite = Math.max(1, Math.floor((Date.now() - regDate.getTime()) / 86400000));
    $('profSince').textContent = `📅 Веду коллекцию с ${regDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })} (${daysOnSite} ${pluralRu(daysOnSite, 'день', 'дня', 'дней')})`;
    $('profSince').onclick = () => {
      const exact = regDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) + ' в ' + regDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      dlgOpen(() => { $('dlgTitle').textContent = '📅 Дата создания коллекции'; $('dlgText').textContent = `Профиль создан: ${exact}`; $('dlgBody').replaceChildren(); }, 'ОК', false, () => true);
    };
  }
}

// Отрисовка блоков профиля по образцу Anixart (Скриншоты 4, 6, 7): Кольцевая диаграмма статусов + Жанры, История просмотра и Оценки
function renderAnixartProfileExtras() {
  const vis = getVisibleItems().filter(i => !i.archived);
  const typeGrid = $('anixTypeStatsGrid');
  if (typeGrid) {
    typeGrid.replaceChildren();
    const TYPE_DEFS = [
      ['Аниме', 'Аниме', false],
      ['Кино и сериалы', 'Фильмы и сериалы', false],
      ['Манга', 'Манга', true],
      ['Ранобэ', 'Ранобэ', true]
    ];
    TYPE_DEFS.forEach(([catKey, titleLbl, isRead]) => {
      const allOfType = vis.filter(i => catKey === 'Кино и сериалы' ? KINO.includes(i.category) : i.category === catKey);
      const doneOfType = allOfType.filter(isCompletedItem);
      const card = el('div', 'anix-type-card');
      const top = el('b');
      top.append(document.createTextNode(titleLbl), el('span', 'chip', String(allOfType.length)));
      let subTxt = '';
      if (isRead) {
        const ch = doneOfType.reduce((s, i) => s + num(i.eps), 0);
        const vl = doneOfType.reduce((s, i) => s + num(i.vols), 0);
        subTxt = `Прочитано: ${doneOfType.length}${ch ? ` · ${ch} гл.` : ''}${vl ? ` · ${vl} т.` : ''}`;
      } else {
        const mins = doneOfType.reduce((s, i) => s + getItemMinutes(i), 0);
        subTxt = `Просмотрено: ${doneOfType.length}${mins > 0 ? ' · ' + formatWatchTimeRu(mins) : ''}`;
      }
      card.append(top, el('div', 'meta', subTxt));
      card.onclick = () => {
        applyMainTabView('collection');
        const btn = document.querySelector(`#catFilters .fb[data-c="${catKey}"]`);
        if (btn) btn.click();
      };
      typeGrid.append(card);
    });
  }
  const ratedBox = $('anixRatedStripBox'), ratedMeta = $('anixRatedCountMeta');

  if (ratedBox) {
    ratedBox.replaceChildren();
    const ratedList = vis.filter(i => num(i.rating) > 0).sort((a, b) => (b.updatedAt || b.id) - (a.updatedAt || a.id) || num(b.rating) - num(a.rating)).slice(0, 18);
    if (ratedMeta) ratedMeta.textContent = ratedList.length ? `${vis.filter(i => num(i.rating) > 0).length} оценено` : '';
    if (!ratedList.length) {
      ratedBox.append(el('div', 'meta', 'Поставь личную оценку любому тайтлу (от 1 до 10 ★), и он появится на этой полке.'));
    } else {
      ratedList.forEach(i => {
        const card = el('div', 'anix-r-card');
        const im = el('img'); im.loading = 'lazy'; im.src = safePosterUrl(i.poster); im.onerror = () => { im.onerror = null; im.src = FALL; };
        const t = el('div', 'r-title', i.title);
        const stars = el('div', 'anix-r-stars', `★ ${i.rating} / 10`);
        card.append(im, t, stars);
        card.onclick = () => openDetail(i.id);
        ratedBox.append(card);
      });
    }
  }
}





// ---------- Персонажи и сэйю + Галерея любимых персонажей (Б6) ----------
function enableDragToScroll(trackEl) {
  let isDown = false, startX = 0, scrollL = 0, movedDist = 0;
  trackEl.addEventListener('mousedown', e => {
    if (trackEl.classList.contains('expanded-grid')) return;
    isDown = true; movedDist = 0;
    trackEl.classList.add('dragging-track');
    startX = e.pageX - trackEl.offsetLeft;
    scrollL = trackEl.scrollLeft;
  });
  const stop = () => { isDown = false; trackEl.classList.remove('dragging-track'); };
  trackEl.addEventListener('mouseleave', stop);
  trackEl.addEventListener('mouseup', stop);
  trackEl.addEventListener('mousemove', e => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - trackEl.offsetLeft;
    const walk = (x - startX) * 1.4;
    movedDist = Math.abs(walk);
    trackEl.scrollLeft = scrollL - walk;
  });
  trackEl._wasDragged = () => movedDist > 7;
}

const seiyuuRuCache = new Map();
async function openCharacterPopup(ch) {
  const modal = $('charPopupModal'); if (!modal) return;
  $('charPopPoster').src = safePosterUrl(ch.img);
  const badge = $('charPopBadge');
  badge.textContent = ch.role === 'MAIN' ? 'Главный персонаж' : 'Второстепенный персонаж';
  badge.className = 'char-pop-badge' + (ch.role === 'MAIN' ? '' : ' char-pop-badge-sup');

  $('charPopRuName').textContent = ch.name || ch.enName || 'Персонаж';
  $('charPopEnName').textContent = ch.enName || ch.name || '';

  const vaBlock = $('charPopVaBlock');
  if (ch.vaName) {
    vaBlock.style.display = 'block';
    $('charPopVaHdr').textContent = ch.isLiveActor ? 'АКТЁР · РОЛЬ В КАДРЕ' : 'СЕЙЮ · ЯПОНСКАЯ ОЗВУЧКА';
    $('charPopVaAv').src = safePosterUrl(ch.vaImg);
    $('charPopVaEn').textContent = ch.vaName;
    $('charPopVaRu').textContent = seiyuuRuCache.get(ch.vaName) || ch.vaName;
    modal.style.display = 'flex';
    if (!hasRu($('charPopVaRu').textContent) && !seiyuuRuCache.has(ch.vaName)) {
      try {
        const tr = await ruChunk(ch.vaName);
        if (hasRu(tr)) { seiyuuRuCache.set(ch.vaName, tr.trim()); $('charPopVaRu').textContent = tr.trim(); }
      } catch (e) {}
    }
    if (!hasRu($('charPopRuName').textContent) && ch.enName) {
      try {
        const trC = await ruChunk(ch.enName);
        if (hasRu(trC)) $('charPopRuName').textContent = trC.trim();
      } catch (e) {}
    }
  } else {
    vaBlock.style.display = 'none';
    modal.style.display = 'flex';
  }

  const favBtn = $('favCharToggleBtn');
  if (favBtn) {
    const favs = prof.favChars || [];
    const key = ch.enName || ch.name;
    const isFav = favs.some(f => f.enName === key);
    favBtn.textContent = isFav ? '💔 Убрать из любимых персонажей' : '❤ Добавить персонажа в любимые';
    favBtn.onclick = () => {
      
      prof.favChars = prof.favChars || [];
      if (prof.favChars.some(f => f.enName === key)) {
        prof.favChars = prof.favChars.filter(f => f.enName !== key);
        toast(`Персонаж «${ch.name}» убран из любимых`);
      } else {
        prof.favChars.push({
          name: $('charPopRuName').textContent || ch.name,
          enName: key,
          img: ch.img || FALL,
          vaName: $('charPopVaRu').textContent || ch.vaName || '',
          vaEn: ch.vaName || '',
          vaImg: ch.vaImg || '',
          role: ch.role || 'MAIN'
        });
        toast(`Персонаж «${$('charPopRuName').textContent || ch.name}» добавлен на полку «Мои любимые герои»!`);
      }
      profCloud(); refresh(); openCharacterPopup(ch);
    };
  }
}
if ($('charPopCloseBtn')) $('charPopCloseBtn').onclick = () => { $('charPopupModal').style.display = 'none'; };

class CharacterSeiyuuManager {
  static cache = new Map();
  static async fetchChars(item) {
    const k = `${item.category}_${item.aniId || ''}_${item.mal || ''}_${item.tmdb || ''}_${item.titleEn || item.title}`;
    if (this.cache.has(k)) return this.cache.get(k);
    if (['Аниме', 'Манга', 'Ранобэ'].includes(item.category) || item.src === 'AniList') {
      const mType = item.category === 'Аниме' ? 'ANIME' : 'MANGA';
      const q = `query($id:Int,$mal:Int,$s:String,$t:MediaType){Media(id:$id,idMal:$mal,search:$s,type:$t){id idMal bannerImage format source duration episodes volumes chapters trailer{id site} relations{edges{relationType node{id idMal title{romaji english} format type coverImage{large} startDate{year} averageScore}}} characters(sort:[ROLE,RELEVANCE,ID],perPage:25){edges{role node{name{full native}image{large}}voiceActors(language:JAPANESE,sort:[RELEVANCE,ID]){name{full native}image{large}}}}}}`;
      const vars = { t: mType };
      if (item.aniId) vars.id = Number(item.aniId); else if (item.mal) vars.mal = Number(item.mal); else vars.s = item.titleEn || item.en || item.title;
      const j = await (await fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, variables: vars }) })).json();
      const media = j?.data?.Media, edges = media?.characters?.edges || [];
      const ruMap = new Map();
      const malId = media?.idMal || item.mal;
      if (malId && shikiOk() && SHK[item.category]) {
        try { (await shiki(`/api/${SHK[item.category]}/${malId}/roles`) || []).forEach(r => { if (r.character?.name && r.character?.russian) ruMap.set(ruN(r.character.name), r.character.russian); }); } catch (e) {}
      }
      const res = {
        mediaMeta: media || null,
        isAnime: item.category === 'Аниме',
        isLiveAction: false,
        items: edges.map(e => {
          const en = e.node?.name?.full || '', va = (e.voiceActors || [])[0];
          return { name: ruMap.get(ruN(en)) || en, enName: en, role: e.role === 'MAIN' ? 'MAIN' : 'SUP', img: e.node?.image?.large || FALL, vaName: va?.name?.full || '', vaImg: va?.image?.large || '', isLiveActor: false };
        })
      };
      this.cache.set(k, res); return res;
    }
    const tk = getActiveTmdbKey();
    if (tk && item.tmdb) {
      const d = await ruJson(`https://api.themoviedb.org/3/${item.tmdb}?api_key=${encodeURIComponent(tk)}&language=ru-RU&append_to_response=credits`, 6000);
      const cast = d?.credits?.cast || d?.cast || [];
      const res = {
        isAnime: false,
        isLiveAction: true,
        mediaMeta: { bannerImage: d?.backdrop_path ? 'https://image.tmdb.org/t/p/w780' + d.backdrop_path : '' },
        items: cast.slice(0, 20).map((c, idx) => ({ name: c.character || c.name, enName: c.original_name || c.name, role: idx < 4 ? 'MAIN' : 'SUP', img: c.profile_path ? 'https://image.tmdb.org/t/p/w342' + c.profile_path : FALL, vaName: c.name || '', vaImg: c.profile_path ? 'https://image.tmdb.org/t/p/w185' + c.profile_path : '', isLiveActor: true }))
      };
      this.cache.set(k, res); return res;
    }
    return { items: [] };
  }
  static async render(box, item) {
    if (!box || !item) return;
    box.style.display = 'block'; box.replaceChildren(el('div', 'meta', 'Загрузка персонажей…'));
    try {
      const data = await this.fetchChars(item);
      if (!data.items.length) { box.style.display = 'none'; return; }
      box.replaceChildren();
      const hdr = el('div', 'jutsu-hdr'), tw = el('div', 'jutsu-hdr-title');
      const secTitle = data.isAnime ? 'Персонажи и сэйю' : data.isLiveAction ? 'Актёры и роли' : 'Персонажи';
      const secSub = data.isAnime ? 'Нажми на героя, чтобы открыть карточку сэйю или добавить в «Мои любимые герои»' : data.isLiveAction ? 'Главные актёры и исполнители ролей' : 'Главные и второстепенные герои';
      tw.innerHTML = `<h4><span style="color:#d946ef">👤</span> ${secTitle}</h4><div class="jutsu-hdr-sub">${secSub}</div>`;
      const nav = el('div', 'jutsu-nav-btns'), pB = el('button', 'jutsu-arrow', '←'), nB = el('button', 'jutsu-arrow', '→');
      pB.type = nB.type = 'button'; nav.append(pB, nB); hdr.append(tw, nav);
      const track = el('div', 'jutsu-track');
      enableDragToScroll(track);
      pB.onclick = () => track.scrollBy({ left: -380, behavior: 'smooth' }); nB.onclick = () => track.scrollBy({ left: 380, behavior: 'smooth' });
      let exp = false;
      const draw = () => {
        track.replaceChildren(); track.classList.toggle('expanded-grid', exp); nav.style.display = exp ? 'none' : 'flex';
        (exp ? data.items : data.items.slice(0, 8)).forEach(ch => {
          const c = el('div', 'j-char-card' + (ch.role === 'MAIN' ? ' is-main' : '')), art = el('div', 'j-char-art'), im = el('img', 'j-char-img');
          im.loading = 'lazy'; im.src = safePosterUrl(ch.img); im.onerror = () => { im.onerror = null; im.src = FALL; }; art.append(im);
          if (ch.role === 'MAIN') art.append(el('span', 'j-main-badge', 'Главный'));
          if (ch.vaImg) { const vw = el('div', 'j-va-avatar'), vi = el('img'); vi.loading = 'lazy'; vi.src = safePosterUrl(ch.vaImg); vw.append(vi); art.append(vw); }
          c.append(art, el('div', 'j-char-name', ch.name));
          if (ch.vaName) c.append(el('div', 'j-va-name', ch.vaName));
          c.onclick = () => { if (track._wasDragged && track._wasDragged()) return; openCharacterPopup(ch); };
          track.append(c);
        });
      };
      draw(); box.append(hdr, track);
      if (data.items.length > 8) {
        const w = el('div', 'jutsu-toggle-wrap'), b = el('button', 'jutsu-toggle-btn', `ПОКАЗАТЬ ВСЕХ (${data.items.length})`);
        b.type = 'button'; b.onclick = () => { exp = !exp; b.textContent = exp ? 'СВЕРНУТЬ ▲' : `ПОКАЗАТЬ ВСЕХ (${data.items.length})`; draw(); };
        w.append(b); box.append(w);
      }
    } catch (e) { box.style.display = 'none'; }
  }
}

// ---------- Полная внутренняя страница тайтла: Дерево франшизы с галочками (Б1), Трейлер YouTube (Б2), Опенинги/Эндинги AnimeThemes (Б3) и фикс Ранобэ (Ошибка №11) ----------
// FORMAT_RU и REL_RU объявлены в начале модуля

async function openFullTitlePage(itemObj) {
  if (!itemObj) return;
  closeAll();
  const page = $('titlePageView'); if (!page) return;
  $('catalogView').style.display = 'none';
  $('profileView').style.display = 'none';
  page.style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });

  const inCol = items.find(i => i.id === itemObj.id || same(i, itemObj));
  const activeItem = inCol || itemObj;

  page.replaceChildren();
  const backWrap = el('div'); backWrap.style.marginBottom = '14px';
  const backBtn = el('button', 'btn btn-s', '← Назад'); backBtn.type = 'button';
  backBtn.onclick = () => {
    page.style.display = 'none';
    const activeTab = document.querySelector('#mainTabs .tab.on')?.dataset.v || 'catalog';
    if (activeTab === 'profile' || activeTab === 'collection') $('profileView').style.display = '';
    else $('catalogView').style.display = '';
  };
  backWrap.append(backBtn);

  // Карточка тайтла в стиле Jut-su (Скриншот 5): слева постер, по центру информация, справа — мягкий фоновый арт главного героя / баннера
  const wrap = el('div', 'tp-wrap'), hero = el('div', 'tp-hero');
  const heroArtBg = el('div', 'tp-hero-art-bg');
  const initialArt = safePosterUrl(activeItem.banner || activeItem.poster);
  if (initialArt && initialArt !== FALL) {
    heroArtBg.style.backgroundImage = `url("${initialArt.replace(/["\\()\r\n]/g, '')}")`;
  }
  const posterImg = el('img', 'tp-poster'); posterImg.onerror = () => { posterImg.onerror = null; posterImg.src = FALL; }; posterImg.src = safePosterUrl(activeItem.poster);
  const heroInfo = el('div');
  const badgesRow = el('div', 'row'); badgesRow.style.marginBottom = '8px';
  const stPill = el('span', 'status', activeItem.status ? getStatusLabelForCategory(activeItem.status, activeItem.category) : 'В каталоге'); stPill.dataset.s = activeItem.status || 'В планах';
  badgesRow.append(stPill);
  if (activeItem.fav) badgesRow.append(el('span', 'chip', '❤ Любимое'));
  if (activeItem.ongoing) badgesRow.append(el('span', 'ong', 'ОНГОИНГ'));
  badgesRow.append(el('span', 'chip', catLabel(activeItem)));

  const titleH1 = el('h1', null, activeItem.title); titleH1.style.cssText = 'margin:0 0 6px;font-size:26px';
  const subNames = el('div', 'meta', [activeItem.titleEn || activeItem.en, activeItem.titleOrig || activeItem.orig].filter(Boolean).join(' / '));
  const specsGrid = el('div', 'tp-specs-grid');
  const tagsBox = el('div', 'chips'); tagsBox.style.margin = '12px 0';
  (activeItem.tags || []).forEach(t => tagsBox.append(el('span', 'chip', t)));
  const actRow = el('div', 'row'); actRow.style.marginTop = '12px';

  const addSpec = (lbl, val) => {
    if (!val) return;
    const b = el('div', 'tp-spec-box');
    b.append(el('span', null, lbl), el('b', null, String(val)));
    specsGrid.append(b);
  };
  addSpec('Год выпуска', activeItem.year || 'Не указан');
  addSpec('Тип произведения', FORMAT_RU[activeItem.format] || catLabel(activeItem));
  addSpec('Первоисточник', activeItem.source || 'Оригинал / Не указан');
  const addClickableSpec = (lbl, rawVal, kindType) => {
    const list = spl(rawVal);
    if (!list.length) return addSpec(lbl, 'Не указан');
    const b = el('div', 'tp-spec-box');
    const chips = el('div', 'chips');
    chips.style.margin = '2px 0 0';
    list.forEach(nameStr => {
      const ch = el('button', 'chip', nameStr + ' ↗');
      ch.type = 'button';
      ch.title = `Показать все работы: ${nameStr}`;
      ch.onclick = () => openCatalogByCreator(kindType, nameStr, activeItem.category);
      chips.append(ch);
    });
    b.append(el('span', null, lbl), chips);
    specsGrid.append(b);
  };
  addClickableSpec('Автор / Режиссёр', activeItem.author, 'author');
  addClickableSpec('Студия / Издатель', activeItem.studio, 'studio');
  if (activeItem.category === 'Манга' || activeItem.category === 'Ранобэ') {
    addSpec('Объём (Главы и Тома)', `${num(activeItem.eps) || '?'} гл. · ${num(activeItem.vols) || '?'} т.`);
  } else {
    addSpec('Количество серий', num(activeItem.eps) ? `${activeItem.eps} эп.` : (activeItem.category === 'Фильм' ? 'Полнометражный фильм' : 'Не указано'));
    addSpec('Длительность', num(activeItem.dur) ? `${activeItem.dur} мин. (${formatWatchTimeRu(getItemMinutes(activeItem))} всего)` : formatWatchTimeRu(getItemMinutes(activeItem)));
  }
  addSpec('Внешний рейтинг', (activeItem.extRating || activeItem.ext) ? `★ ${activeItem.extRating || activeItem.ext}` : '—');
  addSpec('Моя оценка', activeItem.rating ? `★ ${activeItem.rating} / 10` : 'Не оценено');
  if (inCol) {
    const addDt = formatAddedDateRu(inCol);
    if (addDt) addSpec(`Добавлено в «${getStatusLabelForCategory(inCol.status, inCol.category)}»`, addDt);
  }

  const fullPageSimBox = el('div', 'chips');
  fullPageSimBox.style.marginTop = '10px';
  {
    const curMatch = items.find(x => same(x, activeItem));
    const stB = el('button', 'btn qa-trigger', curMatch ? `✓ ${SHORT_ST_BTN[curMatch.status] || curMatch.status}${curMatch.fav ? ' ❤' : ''} ▾` : '＋ Выбрать статус ▾');
    stB.type = 'button';
    stB.onclick = e => {
      e.stopPropagation();
      openQuickAddStatusMenu(stB, activeItem, updated => {
        stB.textContent = updated ? `✓ ${SHORT_ST_BTN[updated.status] || updated.status}${updated.fav ? ' ❤' : ''} ▾` : '＋ Выбрать статус ▾';
      });
    };
    actRow.append(stB);
    if (curMatch) {
      const edB = el('button', 'btn btn-s', '✏ Редактировать');
      edB.type = 'button';
      edB.onclick = () => openAdd(curMatch);
      actRow.append(edB);
    }
  }
  const simBtnFp = el('button', 'btn btn-s', '🔗 Похожие');
  simBtnFp.type = 'button';
  simBtnFp.onclick = async () => {
    simBtnFp.disabled = true;
    simBtnFp.textContent = '⏳ Ищу похожие…';
    await loadSimilarTitlesIntoBox(activeItem, fullPageSimBox);
    simBtnFp.textContent = '🔗 Похожие ✓';
  };
  actRow.append(simBtnFp);

  heroInfo.append(badgesRow, titleH1, subNames, specsGrid, tagsBox, actRow, fullPageSimBox);
  hero.append(heroArtBg, posterImg, heroInfo);

  const descHdr = el('h3', null, '📖 Описание и синопсис'); descHdr.style.margin = '22px 0 8px';
  const descBody = el('div', null, activeItem.description || activeItem.desc || 'Описание отсутствует.');
  descBody.style.cssText = 'background:rgba(0,0,0,.25);padding:14px;border-radius:12px;line-height:1.6;white-space:pre-wrap';

  const mediaRowSec = el('div', 'dash'); mediaRowSec.style.marginTop = '18px';
  const trailerBox = el('div', 'pb'); trailerBox.style.display = 'none';
  const themesBox = el('div', 'pb'); themesBox.style.display = 'none';
  mediaRowSec.append(trailerBox, themesBox);

  const charsSec = el('div', 'jutsu-chars-sec'); charsSec.style.marginTop = '18px'; charsSec.style.display = 'none';
  const franchiseSec = el('div'); franchiseSec.style.marginTop = '20px'; franchiseSec.style.display = 'none';
  const franchiseHdr = el('h3', null, '🌳 Франшиза и порядок просмотра'); franchiseHdr.style.margin = '0 0 8px';
  const relGrid = el('div', 'tp-rel-grid');
  franchiseSec.append(franchiseHdr, relGrid);

  const autoSimSec = el('div'); autoSimSec.style.marginTop = '20px';
  const autoSimHdr = el('h3', null, '🔗 Похожие произведения'); autoSimHdr.style.margin = '0 0 8px';
  const autoSimChips = el('div', 'chips');
  autoSimSec.append(autoSimHdr, autoSimChips);

  wrap.append(hero, descHdr, descBody, mediaRowSec, charsSec, franchiseSec, autoSimSec);
  page.append(backWrap, wrap);

  await CharacterSeiyuuManager.render(charsSec, activeItem);
  const cachedData = await CharacterSeiyuuManager.fetchChars(activeItem);
  const mediaMeta = cachedData?.mediaMeta;

  // Устанавливаем на правую часть шапки портрет главного героя или широкоформатный баннер (как на Jut-su, Скриншот 5)
  const mainCharImg = (cachedData?.items || []).find(c => c.role === 'MAIN' && c.img && c.img !== FALL)?.img || (cachedData?.items || [])[0]?.img || '';
  const bestArtUrl = safePosterUrl(mediaMeta?.bannerImage || activeItem.banner || mainCharImg || activeItem.poster);
  if (bestArtUrl && bestArtUrl !== FALL) {
    heroArtBg.style.backgroundImage = `url("${bestArtUrl.replace(/["\\()\r\n]/g, '')}")`;
  }
  loadSimilarTitlesIntoBox(activeItem, autoSimChips).catch(() => {});

  // Отрисовка Трейлера YouTube + кнопки открытия (Б2)
  const ytId = activeItem.trailerId || (mediaMeta?.trailer?.site === 'youtube' ? mediaMeta.trailer.id : '');
  if (ytId) {
    trailerBox.style.display = 'block';
    const th = el('div', 'row'); th.style.justifyContent = 'space-between'; th.style.marginBottom = '10px';
    th.append(el('h4', null, '🎬 Официальный трейлер'));
    const extYt = el('a', 'btn btn-s', 'Открыть на YouTube ↗');
    extYt.href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(ytId);
    extYt.target = '_blank'; extYt.rel = 'noopener'; extYt.style.fontSize = '12px'; extYt.style.padding = '6px 10px';
    th.append(extYt);
    const ifr = el('iframe');
    ifr.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(ytId);
    ifr.style.cssText = 'width:100%;aspect-ratio:16/9;border:0;border-radius:12px;background:#000';
    ifr.allowFullscreen = true;
    trailerBox.append(th, ifr);
  } else {
    const searchYt = el('a', 'btn btn-s', '🎬 Найти трейлер на YouTube ↗');
    searchYt.href = 'https://www.youtube.com/results?search_query=' + encodeURIComponent((activeItem.titleEn || activeItem.title) + ' anime trailer');
    searchYt.target = '_blank'; searchYt.rel = 'noopener';
    actRow.append(searchYt);
  }

  // Загрузка Опенингов и Эндингов через открытый API AnimeThemes (Б3)
  const malId = activeItem.mal || mediaMeta?.idMal;
  if (activeItem.category === 'Аниме' && malId) {
    fetch(`https://api.animethemes.moe/anime?filter[has]=resources&filter[site]=MyAnimeList&filter[external_id]=${encodeURIComponent(malId)}&include=animethemes.animethemeentries.videos.audio,animethemes.song.artists`)
      .then(r => r.json())
      .then(j => {
        const themes = j?.anime?.[0]?.animethemes || [];
        if (!themes.length) return;
        themesBox.style.display = 'block';
        themesBox.replaceChildren(el('h4', null, `🎵 Опенинги и Эндинги (${themes.length})`));
        const listWrap = el('div'); listWrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;max-height:280px;overflow-y:auto';
        const playerBox = el('div'); playerBox.style.marginTop = '10px';
        themes.forEach(th => {
          const slug = th.slug || th.type || 'OP';
          const songTitle = th.song?.title || 'Без названия';
          const artist = (th.song?.artists || []).map(a => a.name).join(', ');
          const vid = th.animethemeentries?.[0]?.videos?.[0];
          const audioUrl = vid?.audio?.link || vid?.link || '';
          const row = el('div', 'row'); row.style.cssText = 'justify-content:space-between;padding:7px 10px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid var(--bd)';
          const inf = el('div');
          inf.append(el('b', null, `${slug} — ${songTitle}`), el('div', 'meta', artist || 'Оригинальный саундтрек'));
          row.append(inf);
          if (audioUrl) {
            const playB = el('button', 'btn btn-s', '▶ Слушать'); playB.type = 'button'; playB.style.padding = '5px 10px'; playB.style.fontSize = '12px';
            playB.onclick = () => {
              playerBox.replaceChildren();
              if (audioUrl.endsWith('.ogg') || audioUrl.endsWith('.mp3')) {
                const aud = el('audio'); aud.controls = true; aud.autoplay = true; aud.src = audioUrl; aud.style.width = '100%';
                playerBox.append(aud);
              } else {
                const vd = el('video'); vd.controls = true; vd.autoplay = true; vd.src = audioUrl; vd.style.cssText = 'width:100%;max-height:200px;border-radius:10px';
                playerBox.append(vd);
              }
            };
            row.append(playB);
          }
          listWrap.append(row);
        });
        themesBox.append(listWrap, playerBox);
      }).catch(() => {});
  }

  // Дерево просмотра франшизы с пронумерованным маршрутом, отметками «✓ В коллекции» и корректным определением Ранобэ (Б1 + Ошибка №11)
  const relEdges = mediaMeta?.relations?.edges || [];
  if (relEdges.length) {
    franchiseSec.style.display = 'block';
    const ORDER_WEIGHT = { PREQUEL: 1, PARENT: 2, SEQUEL: 3, SIDE_STORY: 4, SPIN_OFF: 5, ADAPTATION: 6, SUMMARY: 7, ALTERNATIVE: 8 };
    const sortedEdges = [...relEdges].sort((a, b) => {
      const wa = ORDER_WEIGHT[a.relationType] || 9, wb = ORDER_WEIGHT[b.relationType] || 9;
      if (wa !== wb) return wa - wb;
      return (a.node?.startDate?.year || 9999) - (b.node?.startDate?.year || 9999);
    });
    sortedEdges.forEach((edge, idx) => {
      const node = edge.node; if (!node) return;
      const titleStr = node.title?.english || node.title?.romaji || 'Произведение';
      const resolvedCat = node.type === 'ANIME' ? 'Аниме' : node.format === 'NOVEL' ? 'Ранобэ' : 'Манга';
      const matchedInCol = items.find(i => (node.id && Number(i.aniId) === Number(node.id)) || (node.idMal && Number(i.mal) === Number(node.idMal)) || same(i, { title: titleStr, category: resolvedCat }));
      const card = el('div', 'tp-rel-card' + (matchedInCol ? ' in-col' : ''));
      const im = el('img'); im.src = safePosterUrl(node.coverImage?.large);
      const inf = el('div'); inf.style.minWidth = '0';
      const stepBadge = el('span', 'tp-step-num', `#${idx + 1} · ${REL_RU[edge.relationType] || edge.relationType}`);
      const tBold = el('b', null, titleStr); tBold.style.cssText = 'font-size:13px;display:block;margin:2px 0';
      const metaLine = el('div', 'meta', [
        FORMAT_RU[node.format] || resolvedCat,
        node.startDate?.year || '',
        node.averageScore ? '★ ' + (node.averageScore / 10).toFixed(1) : '',
        matchedInCol ? `✓ В коллекции (${matchedInCol.status})` : ''
      ].filter(Boolean).join(' · '));
      metaLine.style.margin = '0';
      if (matchedInCol) metaLine.style.color = '#34d399';
      inf.append(stepBadge, tBold, metaLine);
      card.append(im, inf);
      card.onclick = () => {
        openFullTitlePage({
          aniId: node.id, mal: node.idMal, title: titleStr, en: titleStr,
          poster: node.coverImage?.large || FALL, year: node.startDate?.year || '',
          ext: node.averageScore ? (node.averageScore / 10).toFixed(1) : '',
          format: node.format || '', category: resolvedCat, src: 'AniList', tags: []
        });
      };
      relGrid.append(card);
    });
  }
}

async function openCatalogByCreator(kindType, nameStr, itemCat) {
  if (!nameStr) return;
  applyMainTabView('catalog');
  cgGrid.replaceChildren(...Array.from({ length: 8 }, () => el('div', 'sk')));
  $('cgMore').style.display = 'none';
  if ($('cgHeroWrap')) $('cgHeroWrap').style.display = 'none';
  toast(`Ищу все работы: ${nameStr}…`);
  try {
    let found = [];
    const isAni = ['Аниме', 'Манга', 'Ранобэ'].includes(itemCat);
    if (isAni) {
      if (kindType === 'studio') {
        const q = 'query($s:String){Studio(search:$s){name media(sort:POPULARITY_DESC,perPage:24){nodes{id idMal isAdult format siteUrl countryOfOrigin bannerImage trailer{id site} title{romaji english native} synonyms coverImage{large} description(asHtml:false) startDate{year} averageScore episodes duration chapters volumes genres status source}}}}';
        const j = await (await fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, variables: { s: nameStr } }) })).json();
        const nodes = j?.data?.Studio?.media?.nodes || [];
        found = nodes.map(m => ({
          aniId: m.id, mal: m.idMal || 0, isAdult: !!m.isAdult, format: m.format || '',
          banner: m.bannerImage || '', trailerId: (m.trailer?.site === 'youtube') ? m.trailer.id : '',
          vols: m.volumes || 0, eps: m.episodes || m.chapters || 0, dur: m.duration || 0,
          title: m.title.english || m.title.romaji || m.title.native, en: m.title.english || '', orig: m.title.native || '', alt: '',
          studio: nameStr, author: '', ongoing: m.status === 'RELEASING', src: 'AniList', url: m.siteUrl,
          poster: m.coverImage?.large || '', year: m.startDate?.year || '',
          ext: m.averageScore ? (m.averageScore / 10).toFixed(1) : '',
          tags: (m.genres || []).map(g => RU[g] || g),
          desc: m.description ? decode(m.description.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim() : '',
          category: m.format === 'NOVEL' ? 'Ранобэ' : ['MANGA', 'ONE_SHOT'].includes(m.format) ? 'Манга' : 'Аниме'
        }));
      } else {
        const q = 'query($s:String){Staff(search:$s){name{full} staffMedia(sort:POPULARITY_DESC,perPage:24){nodes{id idMal isAdult format siteUrl countryOfOrigin bannerImage trailer{id site} title{romaji english native} synonyms coverImage{large} description(asHtml:false) startDate{year} averageScore episodes duration chapters volumes genres status source}}}}';
        const j = await (await fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, variables: { s: nameStr } }) })).json();
        const nodes = j?.data?.Staff?.staffMedia?.nodes || [];
        found = nodes.map(m => ({
          aniId: m.id, mal: m.idMal || 0, isAdult: !!m.isAdult, format: m.format || '',
          banner: m.bannerImage || '', trailerId: (m.trailer?.site === 'youtube') ? m.trailer.id : '',
          vols: m.volumes || 0, eps: m.episodes || m.chapters || 0, dur: m.duration || 0,
          title: m.title.english || m.title.romaji || m.title.native, en: m.title.english || '', orig: m.title.native || '', alt: '',
          author: nameStr, studio: '', ongoing: m.status === 'RELEASING', src: 'AniList', url: m.siteUrl,
          poster: m.coverImage?.large || '', year: m.startDate?.year || '',
          ext: m.averageScore ? (m.averageScore / 10).toFixed(1) : '',
          tags: (m.genres || []).map(g => RU[g] || g),
          desc: m.description ? decode(m.description.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim() : '',
          category: m.format === 'NOVEL' ? 'Ранобэ' : ['MANGA', 'ONE_SHOT'].includes(m.format) ? 'Манга' : 'Аниме'
        }));
      }
    } else {
      const k = getActiveTmdbKey();
      if (kindType === 'studio') {
        const cj = await ruJson(`https://api.themoviedb.org/3/search/company?api_key=${encodeURIComponent(k)}&query=${encodeURIComponent(nameStr)}`, 6000);
        const cid = cj?.results?.[0]?.id;
        if (cid) found = await tmdb(null, `/discover/movie?with_companies=${cid}&sort_by=popularity.desc`, 'movie', 1);
      } else {
        const pj = await ruJson(`https://api.themoviedb.org/3/search/person?api_key=${encodeURIComponent(k)}&language=ru-RU&query=${encodeURIComponent(nameStr)}`, 6000);
        const pid = pj?.results?.[0]?.id;
        if (pid) {
          const cr = await ruJson(`https://api.themoviedb.org/3/person/${pid}/combined_credits?api_key=${encodeURIComponent(k)}&language=ru-RU`, 6000);
          found = [...(cr.crew || []), ...(cr.cast || [])].filter(x => x.media_type === 'movie' || x.media_type === 'tv').slice(0, 24).map(x => ({
            title: x.title || x.name, en: x.original_title || x.original_name || '', orig: x.original_title || x.original_name || '', alt: '',
            poster: x.poster_path ? 'https://image.tmdb.org/t/p/w342' + x.poster_path : '',
            year: (x.release_date || x.first_air_date || '').slice(0, 4),
            ext: x.vote_count ? x.vote_average.toFixed(1) : '', tags: (x.genre_ids || []).map(g => TG[g]).filter(Boolean),
            tmdb: x.media_type + '/' + x.id, src: 'TMDB', url: 'https://www.themoviedb.org/' + x.media_type + '/' + x.id,
            desc: x.overview || '', category: x.media_type === 'tv' ? 'Сериал' : 'Фильм'
          }));
        }
      }
    }
    cgGrid.replaceChildren();
    if (!found.length) {
      cgGrid.append(el('div', 'msg', `Работы для «${nameStr}» не найдены.`));
      return;
    }
    if ($('cgSourceCaption')) $('cgSourceCaption').textContent = `🔎 Работы ${kindType === 'studio' ? 'студии' : 'автора/режиссёра'}: ${nameStr} (${found.length})`;
    found.forEach(cgCard);
    cgMarks();
    ruCards();
  } catch (e) {
    cgGrid.replaceChildren(el('div', 'msg', 'Не удалось загрузить работы: ' + e.message));
  }
}

if ($('openFullPageFromDetailBtn')) $('openFullPageFromDetailBtn').onclick = () => { const it = items.find(x => x.id === curId); if (it) openFullTitlePage(it); };
if ($('openFullPageFromRndBtn')) $('openFullPageFromRndBtn').onclick = () => { if (rndR) openFullTitlePage(rndR); };

// ---------- Управление аккаунтом и диагностика облака (режим одного пользователя) ----------
async function wipeAllUserDataFromFirestore(targetUid) {
  if (!targetUid || !auth.currentUser) return 0;
  const docIds = new Set(['prof_' + targetUid]);
  try {
    const s = await getDocs(query(collection(db, 'items'), where('userId', '==', targetUid)));
    s.docs.forEach(d => docIds.add(d.id));
  } catch (e) {}
  const allIds = [...docIds];
  for (let i = 0; i < allIds.length; i += 350) {
    const b = writeBatch(db);
    allIds.slice(i, i + 350).forEach(id => b.delete(doc(db, 'items', id)));
    await track(b.commit());
  }
  return allIds.length;
}

// ---------- Задержка закрытия выпадающих меню при уводе курсора (450 мс) ----------
{
  const hoverTimers = new WeakMap();
  document.querySelectorAll('.cat-dd-wrap, .pick-menu-wrap, .hyb-more-wrap, .toolbar-more-wrap').forEach(wrap => {
    wrap.addEventListener('mouseenter', () => {
      if (hoverTimers.has(wrap)) {
        clearTimeout(hoverTimers.get(wrap));
        hoverTimers.delete(wrap);
      }
      wrap.classList.add('hover-hold');
      if (wrap.classList.contains('cat-dd-wrap')) wrap.classList.add('open');
    });
    wrap.addEventListener('mouseleave', () => {
      const t = setTimeout(() => {
        wrap.classList.remove('hover-hold');
        if (wrap.classList.contains('cat-dd-wrap') && !wrap.dataset.pinned) {
          wrap.classList.remove('open');
        }
      }, 450);
      hoverTimers.set(wrap, t);
    });
  });
  // Делегированный обработчик для динамически пересоздаваемого #cgCatDropdownWrap
  let cgHoverTimer = 0;
  document.addEventListener('mouseover', e => {
    const cgWrap = e.target.closest('#cgCatDropdownWrap, #colCatDropdownWrap');
    if (cgWrap) {
      clearTimeout(cgHoverTimer);
      cgWrap.classList.add('open', 'hover-hold');
    }
  });
  document.addEventListener('mouseout', e => {
    const cgWrap = e.target.closest('#cgCatDropdownWrap, #colCatDropdownWrap');
    if (cgWrap && !cgWrap.contains(e.relatedTarget)) {
      clearTimeout(cgHoverTimer);
      cgHoverTimer = setTimeout(() => {
        cgWrap.classList.remove('hover-hold');
        if (!cgWrap.dataset.pinned) cgWrap.classList.remove('open');
      }, 450);
    }
  });
}

// ---------- Кнопка «🪪 Скачать PNG-визитку» в меню «Ещё ▾» профиля ----------
async function downloadProfilePngBusinessCard() {
  $('hybMorePop')?.classList.remove('open');
  toast('🎨 Рисую PNG-визитку профиля…');
  try {
    const W = 1200, H = 640;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const rRect = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };

    const loadImgSafe = src => new Promise(res => {
      if (!src || src === FALL) return res(null);
      const im = new Image();
      if (!src.startsWith('data:')) im.crossOrigin = 'anonymous';
      const timer = setTimeout(() => res(null), 3500);
      im.onload = () => { clearTimeout(timer); res(im); };
      im.onerror = () => { clearTimeout(timer); res(null); };
      im.src = safePosterUrl(src);
    });

    // 1. Фон карточки
    ctx.fillStyle = '#0f1115';
    ctx.fillRect(0, 0, W, H);

    // 2. Шапка-обложка (210px)
    const bannerH = 210;
    const activeProf = prof;
    const coverImg = await loadImgSafe(activeProf.cover);
    ctx.save();
    rRect(24, 24, W - 48, bannerH, 18);
    ctx.clip();
    if (coverImg) {
      const k = Math.max((W - 48) / coverImg.width, bannerH / coverImg.height);
      const dw = coverImg.width * k, dh = coverImg.height * k;
      ctx.drawImage(coverImg, 24 + (W - 48 - dw) / 2, 24 + (bannerH - dh) / 2, dw, dh);
    } else {
      const g = ctx.createLinearGradient(24, 24, W - 24, 24 + bannerH);
      g.addColorStop(0, '#312e81');
      g.addColorStop(0.5, '#5c6ac4');
      g.addColorStop(1, '#1e1b4b');
      ctx.fillStyle = g;
      ctx.fillRect(24, 24, W - 48, bannerH);
    }
    const vig = ctx.createLinearGradient(0, 24, 0, 24 + bannerH);
    vig.addColorStop(0, 'rgba(15,17,21,0.15)');
    vig.addColorStop(1, 'rgba(15,17,21,0.88)');
    ctx.fillStyle = vig;
    ctx.fillRect(24, 24, W - 48, bannerH);
    ctx.restore();

    // 3. Круглый аватар
    const avX = 64, avY = 148, avR = 62;
    ctx.save();
    ctx.beginPath();
    ctx.arc(avX + avR, avY + avR, avR + 5, 0, Math.PI * 2);
    ctx.fillStyle = '#161920';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = activeProf.customColor || '#5c6ac4';
    ctx.stroke();
    ctx.restore();

    const avSrc = activeProf.avatar || (user && user.photoURL) || '';
    const avImg = await loadImgSafe(avSrc);
    ctx.save();
    ctx.beginPath();
    ctx.arc(avX + avR, avY + avR, avR, 0, Math.PI * 2);
    ctx.clip();
    if (avImg) {
      const k = Math.max((avR * 2) / avImg.width, (avR * 2) / avImg.height);
      const dw = avImg.width * k, dh = avImg.height * k;
      ctx.drawImage(avImg, avX + avR - dw / 2, avY + avR - dh / 2, dw, dh);
    } else {
      ctx.fillStyle = '#1c2029';
      ctx.fillRect(avX, avY, avR * 2, avR * 2);
    }
    ctx.restore();

    // 4. Имя, дата и статистика времени
    const vis = getVisibleItems().filter(i => !i.archived);
    const completed = vis.filter(isCompletedItem);
    const totalWatchMins = completed.filter(i => i.category === 'Аниме' || KINO.includes(i.category)).reduce((s, i) => s + getItemMinutes(i), 0);
    const totalEps = completed.filter(i => i.category === 'Аниме' || i.category === 'Сериал').reduce((s, i) => s + getItemEpisodesCount(i), 0);
    const favCount = vis.filter(i => i.fav).length;
    const ratedCount = vis.filter(i => num(i.rating) > 0).length;

    const nick = activeProf.name || (user && user.displayName) || 'Моя коллекция';
    ctx.fillStyle = '#f3f4f6';
    ctx.font = 'bold 34px system-ui, -apple-system, sans-serif';
    ctx.fillText(nick.slice(0, 28), 210, 205);

    const regDate = new Date(activeProf.createdAt || Date.now());
    ctx.fillStyle = '#9ca3af';
    ctx.font = '500 16px system-ui, -apple-system, sans-serif';
    ctx.fillText(`Коллекция с ${regDate.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}  •  Всего тайтлов: ${vis.length}`, 210, 232);

    // Большой блок времени справа
    ctx.textAlign = 'right';
    ctx.fillStyle = '#7c89e8';
    ctx.font = 'bold 36px system-ui, -apple-system, sans-serif';
    ctx.fillText(formatWatchTimeRu(totalWatchMins), W - 54, 198);
    ctx.fillStyle = '#9ca3af';
    ctx.font = '500 15px system-ui, -apple-system, sans-serif';
    ctx.fillText(`${totalEps.toLocaleString('ru-RU')} серий  •  ❤ ${favCount} в любимом  •  ★ ${ratedCount} оценок`, W - 54, 226);
    ctx.textAlign = 'left';

    // 5. Пять карточек статусов
    const stCards = [
      ['Смотрю', vis.filter(i => i.status === 'Смотрю/Читаю' || i.status === 'Пересматриваю').length, '#10b981'],
      ['Просмотрено', vis.filter(i => i.status === 'Просмотрено/Прочитано').length, '#38bdf8'],
      ['В планах', vis.filter(i => i.status === 'В планах').length, '#a855f7'],
      ['Любимое', favCount, '#ec4899'],
      ['Брошено', vis.filter(i => i.status === 'Брошено').length, '#ef4444']
    ];
    const cardW = (W - 48 - 48) / 5;
    stCards.forEach(([lbl, cnt, col], idx) => {
      const cx = 24 + idx * (cardW + 12), cy = 290;
      rRect(cx, cy, cardW, 92, 12);
      ctx.fillStyle = '#161920';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx + 22, cy + 30, 6, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();

      ctx.fillStyle = '#d1d5db';
      ctx.font = '600 16px system-ui, -apple-system, sans-serif';
      ctx.fillText(lbl, cx + 36, cy + 35);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px system-ui, -apple-system, sans-serif';
      ctx.fillText(String(cnt), cx + 18, cy + 72);
    });

    // 6. Нижний ряд: Любимые жанры (слева) и Топ тайтлов коллекции (справа)
    rRect(24, 404, 460, 210, 14);
    ctx.fillStyle = '#161920';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.stroke();

    ctx.fillStyle = '#f3f4f6';
    ctx.font = 'bold 18px system-ui, -apple-system, sans-serif';
    ctx.fillText('Любимые жанры', 44, 438);

    const topGenres = topBy(i => i.tags || []).slice(0, 5);
    if (!topGenres.length) {
      ctx.fillStyle = '#8b92a5';
      ctx.font = '15px system-ui, -apple-system, sans-serif';
      ctx.fillText('Жанры появятся после добавления тайтлов', 44, 475);
    } else {
      topGenres.forEach(([gName, gCnt], idx) => {
        const gy = 468 + idx * 28;
        ctx.fillStyle = '#d1d5db';
        ctx.font = '500 15px system-ui, -apple-system, sans-serif';
        ctx.fillText(gName.slice(0, 26), 44, gy);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#7c89e8';
        ctx.font = 'bold 15px system-ui, -apple-system, sans-serif';
        ctx.fillText(`${gCnt} шт.`, 464, gy);
        ctx.textAlign = 'left';
      });
    }

    rRect(502, 404, W - 526, 210, 14);
    ctx.fillStyle = '#161920';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.stroke();

    ctx.fillStyle = '#f3f4f6';
    ctx.font = 'bold 18px system-ui, -apple-system, sans-serif';
    ctx.fillText('Избранные и лучшие тайтлы коллекции', 524, 438);

    const bestItems = vis
      .slice()
      .sort((a, b) => (Number(b.fav) - Number(a.fav)) || (num(b.rating) - num(a.rating)) || ((b.updatedAt || 0) - (a.updatedAt || 0)))
      .slice(0, 5);
    bestItems.forEach((it, idx) => {
      const ty = 468 + idx * 28;
      ctx.fillStyle = '#e5e7eb';
      ctx.font = '500 15px system-ui, -apple-system, sans-serif';
      const titleClean = (it.fav ? '❤ ' : '') + it.title;
      ctx.fillText(titleClean.slice(0, 44), 524, ty);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 15px system-ui, -apple-system, sans-serif';
      ctx.fillText(it.rating ? `★ ${it.rating}` : (it.extRating ? `★ ${it.extRating}` : it.status.split('/')[0]), W - 46, ty);
      ctx.textAlign = 'left';
    });

    const dataUrl = canvas.toDataURL('image/png');
    const fileName = `MediaTracker_Card_${nick.replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]/g, '_') || 'Profile'}.png`;
    const shouldDownload = await dlgOpen(() => {
      $('dlgTitle').textContent = '🪪 Предпросмотр PNG-визитки профиля';
      $('dlgText').textContent = 'Так выглядит твоя визитка. Нажми на картинку, чтобы увеличить, или кнопку «Скачать PNG», чтобы сохранить файл:';
      const body = $('dlgBody');
      body.replaceChildren();
      const prevImg = el('img');
      prevImg.src = dataUrl;
      prevImg.alt = 'PNG-визитка профиля';
      prevImg.style.cssText = 'width:100%;height:auto;border-radius:12px;border:1px solid var(--bd);box-shadow:0 8px 28px rgba(0,0,0,.55);cursor:zoom-in';
      prevImg.onclick = () => openPosterLightbox(dataUrl, `PNG-визитка: ${nick}`);
      body.append(prevImg);
    }, '⬇ Скачать PNG', false, () => true);

    if (shouldDownload) {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = fileName;
      a.click();
      toast('PNG-визитка профиля сохранена! 🪪');
    }
  } catch (err) {
    toast('Не удалось создать PNG-визитку: ' + err.message, true);
  }
}
if ($('downloadPngCardBtn')) $('downloadPngCardBtn').onclick = downloadProfilePngBusinessCard;

// ---------- Полноэкранное открытие постеров и фото по клику (в маленьком окне тайтла и на полной странице) ----------
function getHighResPosterUrl(src) {
  if (!src || src === FALL) return FALL;
  // Для TMDB автоматически подгружаем более высокое разрешение при открытии постера
  return String(src).replace('/w342/', '/w780/').replace('/w185/', '/w500/');
}

function openPosterLightbox(src, titleText = '') {
  if (!src || src === FALL) return toast('У этого тайтла пока нет постера');
  const modal = $('posterLightboxModal');
  const img = $('posterLightboxImg');
  const ttl = $('posterLightboxTitle');
  const lnk = $('posterLightboxOrigLink');
  if (!modal || !img) return;
  const hiRes = getHighResPosterUrl(src);
  img.src = hiRes;
  img.onerror = () => { if (img.src !== src) img.src = src; };
  if (ttl) ttl.textContent = titleText || 'Постер';
  if (lnk) {
    lnk.href = hiRes;
    lnk.style.display = hiRes.startsWith('data:') ? 'none' : '';
  }
  modal.classList.add('open');
}

function closePosterLightbox() {
  $('posterLightboxModal')?.classList.remove('open');
}

if ($('posterLightboxModal')) {
  $('posterLightboxModal').onclick = e => {
    if (e.target === $('posterLightboxModal') || e.target === $('posterLightboxCloseBtn')) {
      closePosterLightbox();
    }
  };
}
if ($('posterLightboxCloseBtn')) $('posterLightboxCloseBtn').onclick = closePosterLightbox;
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('posterLightboxModal')?.classList.contains('open')) {
    closePosterLightbox();
  }
});

// Делегированный обработчик клика по постерам в маленьких окнах (#detailPoster, #rndPoster, #charPopPoster, #posterPreview) и на полной странице (.tp-poster)
document.addEventListener('click', e => {
  const t = e.target;
  if (!t || t.tagName !== 'IMG') return;
  if (t.id === 'detailPoster') {
    e.stopPropagation();
    openPosterLightbox(t.src, $('detailTitle')?.textContent || 'Постер');
  } else if (t.id === 'rndPoster') {
    e.stopPropagation();
    openPosterLightbox(t.src, $('rndTitle')?.textContent || 'Постер');
  } else if (t.classList.contains('tp-poster')) {
    e.stopPropagation();
    const h1 = document.querySelector('#titlePageView h1')?.textContent || 'Постер';
    openPosterLightbox(t.src, h1);
  } else if (t.id === 'charPopPoster') {
    e.stopPropagation();
    openPosterLightbox(t.src, $('charPopRuName')?.textContent || 'Персонаж');
  } else if (t.id === 'posterPreview' && t.src && t.src !== FALL) {
    e.stopPropagation();
    openPosterLightbox(t.src, $('inputTitle')?.value || 'Предпросмотр постера');
  }
});


// ---------- Удаление профиля строго по подтверждению через почту (без индексов Firebase) ----------
if ($('deleteMyAccountBtn')) {
  $('deleteMyAccountBtn').onclick = async () => {
    if (!user) return;
    if (user.isLocal) {
      if (!(await uiConfirm('Точно удалить локальный профиль и все записи с этого устройства?', 'Удалить локальные данные', true))) return;
      localStorage.removeItem('localItems');
      localStorage.removeItem('items_local_user');
      localStorage.removeItem('prof_local_user');
      localStorage.removeItem('prof');
      await idbVault.del('items_local_user');
      await idbVault.del('localItems');
      await idbVault.del('prof_local_user');
      await idbVault.del('prof');
      items = [];
      resetProfObjectToDefault();
      closeAll();
      refresh();
      toast('Локальные данные полностью удалены.');
      return;
    }

    const userEmail = (auth.currentUser?.email || user.email || '').trim();
    const providers = (auth.currentUser?.providerData || []).map(p => p.providerId);
    const hasGoogle = providers.includes('google.com');
    const hasPassword = providers.includes('password');

    let emailInputEl = null, passInputEl = null, emailVerifiedStepDone = false;
    const confirmed = await dlgOpen(() => {
      $('dlgTitle').textContent = '⚠ Удаление профиля по подтверждению почты';
      $('dlgText').textContent = `Для защиты твоей коллекции (${items.length} тайтлов) удаление возможно только после подтверждения владельца почты ${userEmail}:`;
      const body = $('dlgBody');
      body.replaceChildren();

      // Шаг 1: Отправка проверочного письма на почту или подтверждение через почтовый провайдер
      const mailStepBox = el('div');
      mailStepBox.style.cssText = 'padding:10px 12px;background:var(--inp);border:1px solid var(--bd);border-radius:10px;display:flex;flex-direction:column;gap:8px';
      const mailHdr = el('div', 'meta', `1. Подтверди доступ к почте ${userEmail}:`);
      mailHdr.style.margin = '0';
      const btnRow = el('div', 'row');
      btnRow.style.gap = '8px';

      const sendMailBtn = el('button', 'btn btn-s', '📧 Отправить письмо на почту');
      sendMailBtn.type = 'button';
      sendMailBtn.style.cssText = 'flex:1;font-size:12.5px;padding:7px 10px';
      sendMailBtn.onclick = async () => {
        try {
          sendMailBtn.disabled = true;
          if (!auth.currentUser.emailVerified) {
            await sendEmailVerification(auth.currentUser);
            toast(`Письмо подтверждения отправлено на ${userEmail}! Перейди по ссылке в письме.`);
          } else {
            await sendPasswordResetEmail(auth, userEmail);
            toast(`Контрольное письмо отправлено на ${userEmail}!`);
          }
          emailVerifiedStepDone = true;
          sendMailBtn.textContent = '✓ Письмо отправлено на почту';
        } catch (e) {
          toast('Ошибка отправки письма: ' + (e.message || e.code), true);
          sendMailBtn.disabled = false;
        }
      };
      btnRow.append(sendMailBtn);

      if (hasGoogle) {
        const googleReauthBtn = el('button', 'btn btn-s', '🔐 Подтвердить почту через Google');
        googleReauthBtn.type = 'button';
        googleReauthBtn.style.cssText = 'flex:1;font-size:12.5px;padding:7px 10px';
        googleReauthBtn.onclick = async () => {
          try {
            const freshProvider = new GoogleAuthProvider();
            freshProvider.setCustomParameters({ prompt: 'select_account', login_hint: userEmail });
            await reauthenticateWithPopup(auth.currentUser, freshProvider);
            emailVerifiedStepDone = true;
            googleReauthBtn.textContent = '✓ Почта подтверждена';
            googleReauthBtn.disabled = true;
            toast('Владение почтой подтверждено!');
          } catch (e) {
            if (e.code !== 'auth/popup-closed-by-user') toast('Не удалось подтвердить: ' + (e.message || e.code), true);
          }
        };
        btnRow.append(googleReauthBtn);
      }

      mailStepBox.append(mailHdr, btnRow);
      body.append(mailStepBox);

      // Шаг 2: Ввод своего точного Email (и пароля, если вход по паролю)
      emailInputEl = el('input');
      emailInputEl.type = 'email';
      emailInputEl.placeholder = `Введи свою почту (${userEmail}) для подтверждения`;
      body.append(emailInputEl);

      if (hasPassword) {
        passInputEl = el('input');
        passInputEl.type = 'password';
        passInputEl.placeholder = 'Введи текущий пароль от аккаунта';
        body.append(passInputEl);
      }
    }, 'Удалить профиль навсегда', true, () => ({
      typedEmail: (emailInputEl?.value || '').trim(),
      typedPass: (passInputEl?.value || '').trim()
    }));

    if (!confirmed) return;
    if (!userEmail || confirmed.typedEmail.toLowerCase() !== userEmail.toLowerCase()) {
      return toast(`Отменено: нужно точно ввести адрес своей почты (${userEmail})`, true);
    }

    try {
      if (hasPassword && confirmed.typedPass) {
        const cred = EmailAuthProvider.credential(userEmail, confirmed.typedPass);
        await reauthenticateWithCredential(auth.currentUser, cred);
        emailVerifiedStepDone = true;
      }
      if (!emailVerifiedStepDone) {
        return toast('Сначала нажми кнопку подтверждения почты выше (письмо на почту или подтверждение Google / пароля).', true);
      }

      toast('Очищаю все данные профиля и коллекции в облаке…');
      const uid = user.uid;
      window._explicitEmptyAllowed = true;
      await wipeAllUserDataFromFirestore(uid);
      try {
        localStorage.removeItem('items_' + uid);
        localStorage.removeItem('prof_' + uid);
      } catch (e) {}
      await idbVault.del('items_' + uid);
      await idbVault.del('prof_' + uid);
      closeAll();
      try {
        await deleteUser(auth.currentUser);
        toast('Твой аккаунт и все данные полностью удалены.');
      } catch (authErr) {
        if (authErr.code === 'auth/requires-recent-login') {
          await signOut(auth).catch(() => {});
          toast('Все данные коллекции и профиля удалены! Перезайди в аккаунт для окончательного удаления учётной записи.', true);
        } else {
          throw authErr;
        }
      }
    } catch (e) {
      toast('Ошибка при проверке почты или удалении аккаунта: ' + (e.code || e.message), true);
    }
  };
}

// Кнопка «🩺 Проверка облака» (runCloudDiagnostics) в окне «Данные»
async function runCloudDiagnostics() {
  const box = $('cloudDiagResultBox');
  if (!box) return;
  box.style.display = 'block';
  if (!user || user.isLocal || !auth.currentUser) {
    box.replaceChildren(el('div', 'diag-err', '⚠ Ты сейчас в локальном режиме. Войди в облачный аккаунт (Google или Почта), чтобы проверить правила Firestore.'));
    return;
  }

  box.replaceChildren(el('div', 'meta', '🩺 Выполняю проверку правил Firestore и парсеров импорта…'));
  const rows = [];
  const runStep = async (label, fn) => {
    try {
      const detail = await fn();
      rows.push({ label, ok: true, detail: detail || 'ОК' });
    } catch (e) {
      rows.push({ label, ok: false, detail: (e.code ? `[${e.code}] ` : '') + (e.message || 'Отклонено') });
    }
  };

  const uid = user.uid;
  const now = Date.now();

  await runStep('1. Загрузка своей коллекции (kind=="title" && userId==uid)', async () => {
    const s1 = await getDocs(query(collection(db, 'items'), where('kind', '==', 'title'), where('userId', '==', uid), limit(5)));
    return `ОК (прочитано тайтлов: ${s1.docs.length})`;
  });

  await runStep('2. Запись и удаление тестового тайтла', async () => {
    const tmpId = `${uid}_diag_${now}`;
    await setDoc(doc(db, 'items', tmpId), {
      id: now,
      _docId: tmpId,
      kind: 'title',
      userId: uid,
      title: '__diag_test__',
      category: 'Фильм',
      status: 'В планах',
      updatedAt: now
    });
    await deleteDoc(doc(db, 'items', tmpId));
    return 'ОК (создан и удалён)';
  });

  await runStep('3. Запись и чтение документа профиля (prof_' + uid.slice(0, 6) + '…)', async () => {
    await setDoc(doc(db, 'items', 'prof_' + uid), {
      kind: 'profile',
      isProfile: true,
      userId: uid,
      lastVisit: Date.now()
    }, { merge: true });
    profCloud(false);
    return 'ОК (профиль синхронизирован)';
  });

  await runStep('4. Самопроверка парсеров (CSV/TSV/HTML/JSON/TXT/IMDb)', async () => {
    const pRes = runParserSelfTests();
    const okCnt = pRes.filter(x => x.ok).length;
    if (okCnt !== pRes.length) throw new Error(`Прошло ${okCnt} из ${pRes.length}`);
    return `ОК (${okCnt}/${pRes.length} форматов пройдено)`;
  });

  const tbl = el('table', 'diag-table');
  const thead = el('thead'), trH = el('tr');
  ['Проверка', 'Статус', 'Результат'].forEach(h => trH.append(el('th', null, h)));
  thead.append(trH);
  const tbody = el('tbody');
  rows.forEach(r => {
    const tr = el('tr');
    tr.append(
      el('td', null, r.label),
      el('td', r.ok ? 'diag-ok' : 'diag-err', r.ok ? '✓ ОК' : '✕ Ошибка'),
      el('td', null, r.detail)
    );
    tbody.append(tr);
  });
  tbl.append(thead, tbody);
  box.replaceChildren(tbl);
}
if ($('cloudDiagBtn')) $('cloudDiagBtn').onclick = runCloudDiagnostics;
if ($('manualLocalMigrateBtn')) $('manualLocalMigrateBtn').onclick = () => checkMigrateLocalItemsToCloud(true);
if ($('runSchemaMigrationBtn')) $('runSchemaMigrationBtn').onclick = () => migrateOldDocsToKindSchema(true);

// ---------- В1. Индивидуальные значки за аниме (до 3 надетых одновременно + неоновая рамка для оценки 10!), В2. Битва тайтлов с сохранением Топа, В3. Капсула времени по дате просмотра, В4. Импорт Shikimori/AniList/MAL (аниме + манга + 1000+ записей + русские названия) ----------


// В2. Битва тайтлов (выбор категории и размера 8/16/32, только завершённые без архива, автоматические проходы bye, матч за 3-е место и точный Топ-3, кнопка «Назад на шаг» и подтверждение при попытке закрыть)
function openTitleBattleModal() {
  $('hybMorePop')?.classList.remove('open');
  $('colMorePop')?.classList.remove('open');

  const BATTLE_CATS = [
    { key: 'all', label: 'Всё сразу', match: () => true },
    { key: 'Аниме', label: 'Аниме', match: i => i.category === 'Аниме' },
    { key: 'Фильм', label: 'Фильмы', match: i => i.category === 'Фильм' || i.category === 'Мультфильм' },
    { key: 'Сериал', label: 'Сериалы', match: i => i.category === 'Сериал' },
    { key: 'Манга', label: 'Манга', match: i => i.category === 'Манга' },
    { key: 'Ранобэ', label: 'Ранобэ', match: i => i.category === 'Ранобэ' }
  ];
  const SIZES = [8, 16, 32];

  const getEligiblePool = catKey => {
    const def = BATTLE_CATS.find(c => c.key === catKey) || BATTLE_CATS[0];
    return getVisibleItems().filter(i => !i.archived && isCompletedItem(i) && def.match(i));
  };

  let selectedCat = 'all';
  let selectedSize = 16;
  let state = null;
  const historyStack = [];

  const cloneState = st => ({
    phase: st.phase,
    roundPool: [...st.roundPool],
    matches: st.matches.map(p => [p[0], p[1]]),
    matchIdx: st.matchIdx,
    roundWinners: [...st.roundWinners],
    autoAdvancers: [...st.autoAdvancers],
    semiLosers: [...st.semiLosers],
    finalPair: [...st.finalPair],
    thirdPlacePair: [...st.thirdPlacePair],
    firstPlace: st.firstPlace,
    secondPlace: st.secondPlace,
    thirdPlace: st.thirdPlace,
    fourthPlace: st.fourthPlace,
    earlierEliminated: [...st.earlierEliminated],
    totalParticipants: st.totalParticipants,
    catLabelText: st.catLabelText
  });

  const buildRoundMatchesWithByes = pool => {
    const M = pool.length;
    if (M <= 1) return { matches: [], autoAdvancers: [...pool] };
    // Наименьшая степень двойки >= M (4, 8, 16, 32...)
    let bracketSize = 2;
    while (bracketSize < M) bracketSize *= 2;
    const byesCount = bracketSize - M; // число участников, получающих автоматический проход (bye)
    const playCount = M - byesCount;   // чётное число участников, играющих матчи в этом раунде
    const matches = [];
    for (let i = 0; i < playCount; i += 2) {
      matches.push([pool[i], pool[i + 1]]);
    }
    const autoAdvancers = pool.slice(playCount);
    return { matches, autoAdvancers };
  };

  const startTournament = () => {
    const pool = getEligiblePool(selectedCat);
    const catObj = BATTLE_CATS.find(c => c.key === selectedCat) || BATTLE_CATS[0];
    if (pool.length < 4) {
      toast(`В категории «${catObj.label}» сейчас ${pool.length} завершённых тайтлов. Для запуска турнира нужно минимум 4 просмотренных или прочитанных произведения!`, true);
      return;
    }
    const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(selectedSize, pool.length));
    historyStack.length = 0;
    const { matches, autoAdvancers } = buildRoundMatchesWithByes(shuffled);
    state = {
      phase: shuffled.length <= 4 && autoAdvancers.length === 0 ? 'semi' : 'main',
      roundPool: shuffled,
      matches,
      matchIdx: 0,
      roundWinners: [],
      autoAdvancers,
      semiLosers: [],
      finalPair: [],
      thirdPlacePair: [],
      firstPlace: null,
      secondPlace: null,
      thirdPlace: null,
      fourthPlace: null,
      earlierEliminated: [],
      totalParticipants: shuffled.length,
      catLabelText: catObj.label
    };
    battleActiveInProgress = true;
    renderCurrentView();
  };

  const handlePickWinner = (winner, loser) => {
    historyStack.push(cloneState(state));

    if (state.phase === 'third_place') {
      state.thirdPlace = winner;
      state.fourthPlace = loser;
      state.phase = 'final';
      renderCurrentView();
      return;
    }

    if (state.phase === 'final') {
      state.firstPlace = winner;
      state.secondPlace = loser;
      state.phase = 'done';
      battleActiveInProgress = false;
      renderCurrentView();
      return;
    }

    // Обычный раунд или полуфинал
    state.roundWinners.push(winner);
    if (state.phase === 'semi') {
      state.semiLosers.push(loser);
    } else {
      state.earlierEliminated.push(loser);
    }
    state.matchIdx++;

    if (state.matchIdx >= state.matches.length) {
      const nextPool = [...state.roundWinners, ...state.autoAdvancers];
      if (state.phase === 'semi' || nextPool.length === 2) {
        state.finalPair = nextPool.slice(0, 2);
        if (state.semiLosers.length >= 2) {
          state.thirdPlacePair = state.semiLosers.slice(0, 2);
          state.phase = 'third_place';
        } else {
          state.thirdPlace = state.semiLosers[0] || state.earlierEliminated[state.earlierEliminated.length - 1] || null;
          state.phase = 'final';
        }
      } else {
        const { matches, autoAdvancers } = buildRoundMatchesWithByes(nextPool);
        state.roundPool = nextPool;
        state.matches = matches;
        state.matchIdx = 0;
        state.roundWinners = [];
        state.autoAdvancers = autoAdvancers;
        state.phase = (nextPool.length === 4 && autoAdvancers.length === 0) ? 'semi' : 'main';
      }
    }
    renderCurrentView();
  };

  const handleUndoStep = () => {
    if (!historyStack.length) return;
    state = historyStack.pop();
    battleActiveInProgress = (state.phase !== 'done');
    renderCurrentView();
  };

  const renderCurrentView = () => {
    const body = $('dlgBody');
    if (!body) return;
    body.replaceChildren();

    // 1. Экран настройки перед стартом
    if (!state) {
      battleActiveInProgress = false;
      $('dlgTitle').textContent = '⚔ Битва тайтлов — Настройка турнира';
      $('dlgText').textContent = 'Выбери категорию и размер турнирной сетки (участвуют только завершённые тайтлы без архива):';

      const catTitle = el('div', 'fs', 'Категория произведений');
      const catChips = el('div', 'chips');
      BATTLE_CATS.forEach(c => {
        const cnt = getEligiblePool(c.key).length;
        const btn = el('button', 'tb' + (selectedCat === c.key ? ' on' : ''), `${c.label} (${cnt})`);
        btn.type = 'button';
        btn.onclick = () => { selectedCat = c.key; renderCurrentView(); };
        catChips.append(btn);
      });

      const sizeTitle = el('div', 'fs', 'Размер турнира');
      const sizeChips = el('div', 'chips');
      SIZES.forEach(sz => {
        const btn = el('button', 'tb' + (selectedSize === sz ? ' on' : ''), `${sz} участников`);
        btn.type = 'button';
        btn.onclick = () => { selectedSize = sz; renderCurrentView(); };
        sizeChips.append(btn);
      });

      const availCount = getEligiblePool(selectedCat).length;
      const infoNote = el('div', 'meta');
      infoNote.style.margin = '4px 0 0';
      if (availCount < 4) {
        infoNote.style.color = '#fda4af';
        infoNote.textContent = `⚠ В этой категории завершено всего ${availCount} шт. Нужно минимум 4 просмотренных или прочитанных тайтла!`;
      } else {
        const actualCount = Math.min(selectedSize, availCount);
        let b = 2; while (b < actualCount) b *= 2;
        const byes = b - actualCount;
        infoNote.textContent = `Будет выбрано участников: ${actualCount} из ${availCount} доступных` + (byes > 0 ? ` (автоматических проходов во 2-й раунд по bye: ${byes}).` : '.');
      }

      const startBtn = el('button', 'btn', '⚔ Начать Битву тайтлов');
      startBtn.type = 'button';
      startBtn.style.marginTop = '8px';
      startBtn.onclick = startTournament;

      body.append(catTitle, catChips, sizeTitle, sizeChips, infoNote, startBtn);
      return;
    }

    // 2. Экран итогов турнира (Топ-3 + полный список)
    if (state.phase === 'done') {
      const win = state.firstPlace;
      const second = state.secondPlace;
      const third = state.thirdPlace;
      const fourth = state.fourthPlace;
      const top3 = [win, second, third].filter(Boolean);
      const fullRanking = [win, second, third, fourth, ...[...state.earlierEliminated].reverse()].filter(Boolean);

      $('dlgTitle').textContent = `🏆 Итоги Битвы тайтлов (${state.catLabelText})`;
      $('dlgText').textContent = `Победитель финала: «${win?.title || '—'}». Топ-3 призёров определён с учётом финала и матча за 3-е место:`;

      const podiumWrap = el('div');
      podiumWrap.style.cssText = 'display:flex;flex-direction:column;gap:7px;margin:4px 0';
      const medals = [
        ['🥇 1 место (Победитель финала)', win, '#fbbf24'],
        ['🥈 2 место (Финалист)', second, '#cbd5e1'],
        ['🥉 3 место (Победитель матча за 3-е место)', third, '#d97706']
      ];
      medals.forEach(([placeLabel, item, col]) => {
        if (!item) return;
        const card = el('div', 'row');
        card.style.cssText = `padding:8px 10px;background:var(--inp);border:1px solid ${col};border-radius:10px;justify-content:space-between;gap:10px`;
        const left = el('div', 'row');
        left.style.gap = '10px';
        left.style.flex = '1';
        const im = el('img');
        im.src = safePosterUrl(item.poster);
        im.onerror = () => { im.onerror = null; im.src = FALL; };
        im.style.cssText = 'width:38px;height:54px;object-fit:cover;border-radius:6px;flex-shrink:0';
        const txt = el('div');
        const badge = el('div', null, placeLabel);
        badge.style.cssText = `font-size:11px;font-weight:700;color:${col}`;
        txt.append(badge, el('b', null, item.title), el('div', 'meta', `${catLabel(item)} · ${item.year || '—'} · ★ ${item.rating || item.extRating || '—'}`));
        left.append(im, txt);
        card.append(left);
        podiumWrap.append(card);
      });
      body.append(podiumWrap);

      if (fullRanking.length > 3) {
        const restWrap = el('div');
        restWrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;max-height:140px;overflow-y:auto;margin-top:4px';
        fullRanking.slice(3, 10).forEach((it, idx) => {
          const r = el('div', 'sr');
          r.append(el('span', null, `#${idx + 4} ${it.title}`), el('span', 'meta', `${catLabel(it)} · ★ ${it.rating || it.extRating || '—'}`));
          restWrap.append(r);
        });
        body.append(restWrap);
      }

      const actionsRow = el('div', 'row');
      actionsRow.style.gap = '8px';
      actionsRow.style.marginTop = '6px';

      const saveTopB = el('button', 'btn', '💾 Сохранить Топ-3 в подборку «🏆 Топ Битвы тайтлов»');
      saveTopB.type = 'button';
      saveTopB.style.flex = '1';
      saveTopB.onclick = () => {
        const listName = '🏆 Топ Битвы тайтлов';
        prof.customLists = prof.customLists || [];
        if (!prof.customLists.includes(listName)) prof.customLists.push(listName);
        top3.forEach(it => {
          it.lists = it.lists || [];
          if (!it.lists.includes(listName)) { it.lists.push(listName); cloudSave(it); }
        });
        profCloud();
        refresh();
        toast('Топ-3 сохранён в подборку «🏆 Топ Битвы тайтлов»!');
      };

      const undoB = el('button', 'btn btn-s', '↩ Назад на шаг');
      undoB.type = 'button';
      undoB.onclick = handleUndoStep;

      const restartB = el('button', 'btn btn-s', '🔄 Новый турнир');
      restartB.type = 'button';
      restartB.onclick = () => { state = null; historyStack.length = 0; renderCurrentView(); };

      actionsRow.append(saveTopB, undoB, restartB);
      body.append(actionsRow);
      return;
    }

    // 3. Экран текущего матча (основная сетка, полуфинал, матч за 3-е место или финал)
    let stageName = '';
    let pair = null;
    let subNote = 'Нажми на постер произведения, которое нравится тебе больше:';

    if (state.phase === 'third_place') {
      stageName = '🥉 Матч за 3-е место (Бронзовый финал)';
      pair = state.thirdPlacePair;
      subNote = 'Встречаются проигравшие в полуфиналах — выбери обладателя 3-го места:';
    } else if (state.phase === 'final') {
      stageName = '🔥 ФИНАЛ (Матч за 1-е и 2-е место)';
      pair = state.finalPair;
      subNote = 'Главный поединок турнира — выбери чемпиона (1 место):';
    } else {
      const effSize = state.roundPool.length + state.autoAdvancers.length;
      const bSize = Math.pow(2, Math.ceil(Math.log2(Math.max(4, state.roundPool.length))));
      const baseStage = state.phase === 'semi' || bSize === 4
        ? 'Полуфинал (1/2)'
        : bSize === 8
        ? 'Четвертьфинал (1/4)'
        : bSize === 16
        ? '1/8 финала'
        : '1/16 финала';
      stageName = `${baseStage} · Матч ${state.matchIdx + 1} из ${state.matches.length}`;
      pair = state.matches[state.matchIdx];
      if (state.autoAdvancers.length > 0) {
        subNote = `Автоматический проход (bye) в следующий раунд: ${state.autoAdvancers.length} уч. Выбери победителя пары:`;
      }
    }

    $('dlgTitle').textContent = `⚔ Битва тайтлов · ${stageName}`;
    $('dlgText').textContent = subNote;

    const [a, b] = pair;
    const arena = el('div', 'battle-arena');
    const mkCard = (it, other) => {
      const c = el('div', 'battle-contender');
      const im = el('img');
      im.src = safePosterUrl(it.poster);
      im.onerror = () => { im.onerror = null; im.src = FALL; };
      c.append(
        im,
        el('b', null, it.title),
        el('span', 'meta', `${catLabel(it)} · ${it.year || '—'}${it.rating ? ' · ★ ' + it.rating : (it.extRating ? ' · ★ ' + it.extRating : '')}`)
      );
      c.onclick = () => handlePickWinner(it, other);
      return c;
    };
    arena.append(mkCard(a, b), el('div', 'battle-vs', 'VS'), mkCard(b, a));
    body.append(arena);

    const navRow = el('div', 'row');
    navRow.style.justifyContent = 'space-between';
    const undoBtn = el('button', 'btn btn-s', '↩ Назад на шаг');
    undoBtn.type = 'button';
    undoBtn.disabled = historyStack.length === 0;
    undoBtn.onclick = handleUndoStep;

    const changeSetupBtn = el('button', 'btn btn-s', '⚙ Сменить категорию / размер');
    changeSetupBtn.type = 'button';
    changeSetupBtn.onclick = () => {
      if (battleActiveInProgress && !confirmExitBattleIfActive()) return;
      state = null;
      historyStack.length = 0;
      renderCurrentView();
    };
    navRow.append(undoBtn, changeSetupBtn);
    body.append(navRow);
  };

  dlgOpen(() => {
    renderCurrentView();
  }, 'Закрыть турнир', false, () => true);

  // Перехватываем кнопки закрытия #dlgOk и #dlgCancel, чтобы не закрыть активный турнир случайно без подтверждения
  const origOk = $('dlgOk').onclick;
  const origCancel = $('dlgCancel').onclick;
  $('dlgOk').onclick = () => {
    if (battleActiveInProgress && !confirmExitBattleIfActive()) return;
    if (origOk) origOk();
  };
  $('dlgCancel').onclick = () => {
    if (battleActiveInProgress && !confirmExitBattleIfActive()) return;
    if (origCancel) origCancel();
  };
}

['battleBtn', 'colBattleBtn', 'colMoreBattleBtn'].forEach(id => {
  if ($(id)) $(id).onclick = openTitleBattleModal;
});



// В4. Онлайн-импорт Аниме и Манги с AniList / Shikimori через единую воронку предпросмотра (с поддержкой «Отменить этот импорт» и разбора!)
if ($('shikiImportBtn')) {
  $('shikiImportBtn').onclick = () => {
    $('hybMorePop')?.classList.remove('open');
    $('dataModal').style.display = 'none';
    let iNick, iPlatform;
    dlgOpen(() => {
      $('dlgTitle').textContent = '⚡ Импорт из Shikimori / AniList / MyAnimeList';
      $('dlgText').textContent = 'Введи свой никнейм для переноса аниме и манги (с предпросмотром, проверкой повторов и сохранением дат) или выбери XML/JSON-файл экспорта:';
      const sel = el('select');
      sel.add(new Option('🅰 AniList — Аниме + Манга (по никнейму, работает без VPN)', 'anilist'));
      sel.add(new Option('🌸 Shikimori — Аниме + Манга (по никнейму, до 1000+ тайтлов)', 'shiki'));
      const inp = el('input'); inp.placeholder = 'Твой никнейм на выбранном сайте';
      const fileBtn = el('button', 'btn btn-s', '📂 Или выбрать XML / JSON файл экспорта (MAL / Shikimori)');
      fileBtn.type = 'button';
      fileBtn.onclick = () => { closeAll(); $('malXmlFile').click(); };
      iPlatform = sel; iNick = inp;
      $('dlgBody').replaceChildren(sel, inp, fileBtn);
    }, 'Загрузить для предпросмотра', false, () => ({ p: iPlatform.value, n: iNick.value.trim() })).then(async res => {
      if (!res || !res.n) return;
      toast(`Подключаюсь к ${res.p === 'shiki' ? 'Shikimori' : 'AniList'} (${res.n})…`);
      try {
        const candidates = [];
        if (res.p === 'anilist') {
          const ST_MAP = { COMPLETED: 'Просмотрено/Прочитано', CURRENT: 'Смотрю/Читаю', PLANNING: 'В планах', DROPPED: 'Брошено', PAUSED: 'В планах', REPEATING: 'Пересматриваю' };
          for (const mediaType of ['ANIME', 'MANGA']) {
            const q = `query($u:String,$t:MediaType){MediaListCollection(userName:$u,type:$t){lists{entries{status score(format:POINT_10) repeat updatedAt completedAt{year month day} media{id idMal isAdult countryOfOrigin format duration episodes volumes chapters startDate{year} averageScore genres coverImage{large} title{romaji english}}}}}}`;
            const j = await (await fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, variables: { u: res.n, t: mediaType } }) })).json();
            const lists = j?.data?.MediaListCollection?.lists || [];
            const entries = lists.flatMap(l => l.entries || []);
            const mals = [...new Set(entries.map(e => e.media?.idMal).filter(Boolean))];
            const ruMap = {};
            for (let i = 0; i < mals.length; i += 50) {
              try { Object.assign(ruMap, await ruTitles(mediaType === 'ANIME' ? 'animes' : 'mangas', mals.slice(i, i + 50))); } catch (e) {}
            }
            entries.forEach(e => {
              const m = e.media; if (!m) return;
              const enTitle = m.title?.english || m.title?.romaji || 'Тайтл';
              const ruTitle = ruMap[m.idMal] || enTitle;
              const catName = mediaType === 'ANIME' ? 'Аниме' : (m.format === 'NOVEL' ? 'Ранобэ' : 'Манга');
              const subK = catName === 'Манга' ? ({KR: 'Манхва', CN: 'Маньхуа', TW: 'Маньхуа', JP: 'Манга'}[m.countryOfOrigin] || 'Манга') : '';
              const knownSt = ST_MAP[e.status] || '';
              const status = knownSt || 'В планах';
              const isDone = status === 'Просмотрено/Прочитано' || status === 'Пересматриваю';
              const compDate = isDone ? ((e.completedAt?.year) ? new Date(e.completedAt.year, (e.completedAt.month || 1) - 1, e.completedAt.day || 1).getTime() : 0) : 0;
              candidates.push(fix({
                aniId: m.id, mal: m.idMal || 0, isAdult: Boolean(m.isAdult),
                title: ruTitle, titleEn: enTitle, category: catName, subKind: subK,
                format: m.format || '', status,
                needsReview: Boolean(!knownSt),
                rating: e.score ? String(e.score) : '', extRating: m.averageScore ? (m.averageScore / 10).toFixed(1) : '',
                extSrc: 'AniList', poster: m.coverImage?.large || '', year: m.startDate?.year || '',
                eps: (mediaType === 'ANIME' ? m.episodes : m.chapters) || 0, vols: m.volumes || 0, dur: m.duration || 0,
                rewatchCount: e.repeat || 0, completedAt: compDate,
                tags: (m.genres || []).map(g => RU[g] || g)
              }));
            });
          }
          await previewAndExecuteImport(candidates, `AniList (${res.n})`, `anilist_${res.n}_${candidates.length}`, false, null);
        } else {
          const uInfo = await shiki(`/api/users/${encodeURIComponent(res.n)}?is_nickname=1`);
          if (!uInfo || !uInfo.id) throw new Error('пользователь Shikimori не найден');
          const ST_SHIKI = { completed: 'Просмотрено/Прочитано', watching: 'Смотрю/Читаю', planned: 'В планах', dropped: 'Брошено', on_hold: 'В планах', rewatching: 'Пересматриваю' };
          for (const [targetType, apiKind, catName] of [['Anime', 'animes', 'Аниме'], ['Manga', 'mangas', 'Манга']]) {
            const rates = await shiki(`/api/v2/user_rates?user_id=${uInfo.id}&target_type=${targetType}`);
            const mals = [...new Set((rates || []).map(r => r.target_id).filter(Boolean))];
            let details = [];
            for (let i = 0; i < mals.length; i += 50) {
              const chunk = await shiki(`/api/${apiKind}?ids=${mals.slice(i, i + 50).join(',')}&limit=50`).catch(() => []);
              details = details.concat(chunk || []);
              await ruWait(350);
            }
            const detMap = new Map(details.map(x => [x.id, x]));
            (rates || []).forEach(r => {
              const d = detMap.get(r.target_id); if (!d) return;
              const title = d.russian || d.name;
              const resolvedCat = (catName === 'Манга' && (d.kind === 'light_novel' || d.kind === 'novel')) ? 'Ранобэ' : catName;
              const subK = resolvedCat === 'Манга' ? (d.kind === 'manhwa' ? 'Манхва' : d.kind === 'manhua' ? 'Маньхуа' : 'Манга') : '';
              const knownSt = ST_SHIKI[r.status] || '';
              const status = knownSt || 'В планах';
              const isDone = status === 'Просмотрено/Прочитано' || status === 'Пересматриваю';
              const compTs = (isDone && r.updated_at) ? new Date(r.updated_at).getTime() : 0;
              candidates.push(fix({
                mal: d.id, title, titleEn: d.name || '', category: resolvedCat, subKind: subK,
                status,
                needsReview: Boolean(!knownSt),
                rating: r.score ? String(r.score) : '',
                extRating: d.score || '', extSrc: 'Shikimori',
                poster: d.image?.original ? 'https://shikimori.io' + d.image.original : '',
                year: (d.aired_on || '').slice(0, 4),
                eps: (targetType === 'Anime' ? (d.episodes || r.episodes) : (d.chapters || r.chapters)) || 0,
                vols: d.volumes || r.volumes || 0, dur: 24,
                rewatchCount: r.rewatches || 0,
                completedAt: compTs,
                tags: []
              }));
            });
          }
          await previewAndExecuteImport(candidates, `Shikimori (${res.n})`, `shiki_${res.n}_${candidates.length}`, false, null);
        }
      } catch (err) {
        toast('Онлайн-запрос не удался (' + err.message + '). Если Shikimori недоступен без VPN — используй кнопку загрузки XML/JSON файла.', true);
      }
    });
  };
}

// ---------- Переключение 3 главных вкладок: 🌐 Каталог / 📚 Моя коллекция / 👤 Профиль ----------
function applyMainTabView(v) {
  const mode = (v === 'collection' || v === 'profile') ? v : 'catalog';
  document.querySelectorAll('#mainTabs .tab').forEach(x => x.classList.toggle('on', x.dataset.v === mode));
  document.querySelectorAll('#botnav button').forEach(x => x.classList.toggle('on', x.dataset.go === mode));
  try { localStorage.setItem('lastTab', mode); } catch (e) {}
  if ($('titlePageView')) $('titlePageView').style.display = 'none';
  $('catalogView').style.display = mode === 'catalog' ? '' : 'none';
  $('profileView').style.display = (mode === 'profile' || mode === 'collection') ? '' : 'none';

  // Разграничиваем Профиль и Коллекцию по образцу Anixart:
  // В «👤 Профиль» показываем только карточку профиля, статистику по типам, диаграмму, историю и оценки.
  // В «📚 Моя коллекция» показываем папки, вкладки статусов, фильтры и список/сетку/канбан тайтлов.
  const shellEl = document.querySelector('.hyb-profile-shell');
  const extrasEl = $('profAnixartExtrasSec');
  const listsBlock = $('myListsBlock');
  const subtabsBar = document.querySelector('.hyb-subtabs-bar');
  const colWrap = $('profColWrap');
  const revBox = $('reviewItemsBox');
  const isCol = mode === 'collection';
  document.body.dataset.pview = mode;
  if (shellEl) shellEl.style.display = isCol ? 'none' : '';
  if (extrasEl) extrasEl.style.display = isCol ? 'none' : '';
  if (listsBlock) listsBlock.style.display = isCol ? '' : 'none';
  if (subtabsBar) subtabsBar.style.display = isCol ? '' : 'none';
  if (colWrap) colWrap.style.display = isCol ? '' : 'none';
  if (!isCol && revBox) revBox.style.display = 'none';
  if (mode === 'catalog') cgMarks();
}

document.querySelectorAll('#mainTabs .tab').forEach(b => {
  b.onclick = () => applyMainTabView(b.dataset.v);
});

let tabDone = false;
function homeTab() {
  if (tabDone) return; tabDone = true;
  let t = ''; try { t = localStorage.getItem('lastTab'); } catch (e) {}
  if (!['catalog', 'collection', 'profile'].includes(t)) t = 'catalog';
  applyMainTabView(t);
}

function refresh(opts = {}) {
  if (opts && opts.itemId != null) {
    updateSingleItemCardInDOM(opts.itemId);
    syncHybridStatusTabsUI();
    catCounts();
    cgMarks();
    renderAnixartHeroAndCategoryCards();
    renderAnixartProfileExtras();
    renderStatusAndCategoryBanner();
    if (KanbanManager.isKanbanActive) KanbanManager.renderBoard();
    return;
  }
  if (opts && opts.onlyList) {
    render(false);
    cgMarks();
    catCounts();
    renderAnixartHeroAndCategoryCards();
    renderAnixartProfileExtras();
    return;
  }
  refreshTags();
  refreshLists();
  render(false);
  profStats();
  cgMarks();
  catCounts();
  renderAnixartHeroAndCategoryCards();
  renderAnixartProfileExtras();
  updateProfileMetaAndPrivacyUI();
  renderStatusAndCategoryBanner();
  renderMyListsFolderBlock();
  updateLastImportBatchBarUI();
  if ($('reviewItemsBox')?.style.display !== 'none') renderReviewItemsTab();
  // Фоновый перевод описаний вызывается только при открытии карточки, чтобы не нагружать сеть на 500 тайтлах
  setTimeout(backupNudge, 4000);
}

// Синхронизация прокрутки и кнопки закрытия в модальных окнах
{
  const mods = [...document.querySelectorAll('.modal')]; let back = null;
  const sync = () => {
    const open = mods.find(m => m.style.display && m.style.display !== 'none');
    document.body.style.overflow = open ? 'hidden' : '';
    $('modalX').classList.toggle('show', !!open);
    if (open && !back) {
      back = document.activeElement;
      const f = open.querySelector('input:not([type=hidden]),select,textarea,button');
      if (f) setTimeout(() => f.focus({preventScroll: true}), 30);
    }
    if (!open && back) { try { back.focus({preventScroll: true}); } catch (e) {} back = null; }
  };
  mods.forEach(m => new MutationObserver(sync).observe(m, {attributes: true, attributeFilter: ['style']}));
}
$('modalX').onclick = closeAll;
document.querySelectorAll('#accMenu .mi, #accMenu .mrow').forEach(n => n.addEventListener('click', e => e.stopPropagation()));
document.addEventListener('load', e => { if (e.target && e.target.tagName === 'IMG') e.target.classList.add('ld'); }, true);
document.addEventListener('error', e => { if (e.target && e.target.tagName === 'IMG') e.target.classList.add('ld'); }, true);

// Автоматический фоллбэк постеров при недоступности прокси wsrv.nl (Часть 4 п.6)
document.addEventListener('error', e => {
  const t = e.target;
  if (!t || t.tagName !== 'IMG') return;
  if (t.src && t.src.includes('wsrv.nl') && !t.dataset.wsrvFallbackDone) {
    t.dataset.wsrvFallbackDone = '1';
    _wsrvDown = true;
    try {
      const u = new URL(t.src).searchParams.get('url');
      if (u) { t.src = u; return; }
    } catch (err) {}
    t.src = FALL;
  } else if (t.src !== FALL && !t.dataset.fallFallbackDone) {
    t.dataset.fallFallbackDone = '1';
    t.src = FALL;
  }
}, true);

KanbanManager.init();

window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && _cloudSaveTimers.size && user && !user.isLocal && auth.currentUser) {
    _cloudSaveTimers.forEach((entry, docId) => {
      clearTimeout(entry.timer);
      const it = items.find(x => getCloudDocId(x) === docId);
      if (it) {
        const { payload } = prepareTitleForCloud(it, user.uid);
        setDoc(doc(db, 'items', docId), payload).catch(() => {});
      }
      entry.resolve();
    });
    _cloudSaveTimers.clear();
  }
});

if ($('restoreSafetyBackupBtn')) {
  $('restoreSafetyBackupBtn').onclick = async () => {
    const safetyKey = getUidStorageKey('safetyBackup');
    const localKey = getUidStorageKey('items');
    const pool = (await idbVault.get(safetyKey)) || (await idbVault.get(localKey)) || loadLocalItems();
    if (!Array.isArray(pool) || !pool.length) {
      return toast('В локальном кэше этого браузера резервных записей не найдено', true);
    }
    await previewAndExecuteImport(pool.map(fix), 'Страховочная копия браузера', '', false, null);
  };
}