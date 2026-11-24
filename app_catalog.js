// === ЧАСТЬ 2: API AniList/TMDB, статистика, массовый выбор и Каталог (app_catalog.js) ===
// ---------- Автозаполнение и каталоги (AniList и TMDB с встроенным общим ключом) ----------
const decode = s => { const t = document.createElement('textarea'); t.innerHTML = s; return t.value; };
const SRC = {ORIGINAL: 'Оригинал', MANGA: 'Манга', LIGHT_NOVEL: 'Ранобэ', VISUAL_NOVEL: 'Визуальная новелла', VIDEO_GAME: 'Игра', GAME: 'Игра', NOVEL: 'Книга', WEB_NOVEL: 'Книга', COMIC: 'Комикс'};
const RU = {Action:'Экшен',Adventure:'Приключения',Comedy:'Комедия',Drama:'Драма',Ecchi:'Этти',Fantasy:'Фэнтези',Horror:'Ужасы','Mahou Shoujo':'Махо-сёдзё',Mecha:'Меха',Music:'Музыка',Mystery:'Детектив',Psychological:'Психология',Romance:'Романтика','Sci-Fi':'Научная фантастика','Slice of Life':'Повседневность',Sports:'Спорт',Supernatural:'Сверхъестественное',Thriller:'Триллер',Hentai:'Хентай (18+)'};
const TG = {28:'Боевик',12:'Приключения',16:'Мультфильм',35:'Комедия',80:'Криминал',99:'Документальный',18:'Драма',10751:'Семейный',14:'Фэнтези',36:'История',27:'Ужасы',10402:'Музыка',9648:'Детектив',10749:'Мелодрама',878:'Фантастика',53:'Триллер',10752:'Военный',37:'Вестерн',10759:'Боевик и приключения',10765:'Фантастика и фэнтези',10768:'Война и политика',10770:'Телефильм',10762:'Детский',10763:'Новости',10764:'Реалити-шоу',10766:'Мыльная опера',10767:'Ток-шоу'};
const TAGRU = {"Josei":"Дзёсэй","Kids":"Детское","Seinen":"Сэйнэн","Shoujo":"Сёдзё","Shounen":"Сёнэн","Boys' Love":"Яой / Сёнэн-ай (Boys’ Love)","Boys Love":"Яой / Сёнэн-ай","Shounen Ai":"Яой / Сёнэн-ай","Girls' Love":"Юри / Сёдзё-ай (Girls’ Love)","Girls Love":"Юри / Сёдзё-ай","Shoujo Ai":"Юри / Сёдзё-ай","Yaoi":"Яой","Yuri":"Юри","Harem":"Гарем","Reverse Harem":"Обратный гарем","Love Triangle":"Любовный треугольник","Unrequited Love":"Безответная любовь","Age Gap":"Разница в возрасте","Polyamorous":"Полиамория","Matchmaking":"Сватовство","Marriage":"Брак","Cohabitation":"Совместная жизнь","Heterosexual":"Гетеро","Bisexual":"Бисексуальность","Transgender":"Трансгендерность","LGBTQ+ Themes":"ЛГБТ-темы","Isekai":"Исэкай","Reincarnation":"Реинкарнация","Magic":"Магия","Super Power":"Суперсилы","Time Travel":"Путешествия во времени","Time Skip":"Скачок во времени","Time Loop":"Временная петля","Post-Apocalyptic":"Постапокалипсис","Dystopian":"Антиутопия","Cyberpunk":"Киберпанк","Steampunk":"Стимпанк","Alchemy":"Алхимия","Witch":"Ведьмы","Vampire":"Вампиры","Werewolf":"Оборотни","Zombie":"Зомби","Demons":"Демоны","Gods":"Боги","Ghost":"Призраки","Dragons":"Драконы","Elf":"Эльфы","Aliens":"Пришельцы","Robots":"Роботы","Ninja":"Ниндзя","Samurai":"Самураи","Pirates":"Пираты","Military":"Военное","War":"Война","Space":"Космос","Mythology":"Мифология","Religion":"Религия","Politics":"Политика","Royal Affairs":"Королевские интриги","Slavery":"Рабство","Survival":"Выживание","Revenge":"Месть","Crime":"Криминал","Detective":"Детектив","Police":"Полиция","Gangs":"Банды","Yakuza":"Якудза","Espionage":"Шпионаж","Assassins":"Убийцы","Terrorism":"Терроризм","Tragedy":"Трагедия","Parody":"Пародия","Satire":"Сатира","Coming of Age":"Взросление","Anti-Hero":"Антигерой","Bullying":"Буллинг","Body Horror":"Боди-хоррор","Gore":"Жестокость (гор)","Suicide":"Суицид","Death Game":"Игра на выживание","Battle Royale":"Королевская битва","Video Games":"Видеоигры","Virtual World":"Виртуальный мир","Game":"Игры","Idol":"Айдолы","Cute Girls Doing Cute Things":"Милые девочки","Iyashikei":"Ийясикэй (умиротворение)","Otaku Culture":"Культура отаку","Gender Bending":"Смена пола","Crossdressing":"Кроссдрессинг","Body Swapping":"Обмен телами","Super Hero":"Супергерои","Superhero":"Супергерои","Food":"Еда","Cosplay":"Косплей","Dancing":"Танцы","Band":"Музыкальная группа","Classic Literature":"Классическая литература","Fairy Tale":"Сказка","Kaiju":"Кайдзю","Cultivation":"Культивация","Wuxia":"Уся","Martial Arts":"Боевые искусства","Swordplay":"Фехтование","Gambling":"Азартные игры","Chuunibyou":"Тюнибё","Tsundere":"Цундере","Yandere":"Яндере","Kuudere":"Кудере","Dissociative Identities":"Раздвоение личности","Amnesia":"Амнезия","Memory Manipulation":"Манипуляции памятью","Mind Control":"Контроль разума","Twins":"Близнецы","Found Family":"Найденная семья","Family Life":"Семейная жизнь","Rural":"Деревня","Urban":"Город","School":"Школа","College":"Колледж","Work":"Работа","Medieval":"Средневековье","Historical":"Историческое","Ancient China":"Древний Китай","Afterlife":"Загробная жизнь","Angels":"Ангелы","Fairy":"Феи","Monster Girl":"Монстро-девочки","Anthropomorphism":"Антропоморфизм","Animals":"Животные","Ensemble Cast":"Большой ансамбль","Male Protagonist":"Мужской протагонист","Female Protagonist":"Женская протагонистка","Primarily Female Cast":"В основном женский каст","Primarily Male Cast":"В основном мужской каст","Primarily Child Cast":"В основном детский каст","Primarily Adult Cast":"В основном взрослый каст","Teacher":"Учитель","Student Council":"Студсовет","Full Color":"Цветная","4-koma":"4-кома","Anthology":"Антология","Episodic":"Эпизодическое","Gag Humor":"Гэг-юмор","Black Comedy":"Чёрная комедия","Slapstick":"Слэпстик","Surreal Comedy":"Сюрреалистичная комедия","Shapeshifting":"Превращения","Illusions":"Иллюзии","Lost Civilization":"Утраченная цивилизация","Rescue":"Спасение","Nudity":"Обнажёнка","Drugs":"Наркотики"};
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

// Маппинг объекта медиа AniList в карточку каталога
function mapAniListMediaNode(m, type = 'ANIME') {
  const t = m.title || {}, main = t.english || t.romaji || t.native || '';
  const stf = m.staff?.edges || [], pick = re => [...new Set(stf.filter(e => re.test(e.role)).map(e => e.node.name.full))].slice(0, 2).join(', ');
  const alt = [...new Set([t.romaji, ...(m.synonyms || [])].filter(x => x && x !== main && x !== t.english))].join(', ');
  const rawPoster = isValidPosterUrl(m.coverImage?.large) ? m.coverImage.large : '';
  const endYearStr = m.endDate?.year ? String(m.endDate.year) : '';
  const endDateStr = m.endDate?.year
    ? ([m.endDate.day, m.endDate.month, m.endDate.year].filter(Boolean).map(n => String(n).padStart(2, '0')).join('.') || endYearStr)
    : '';
  return {
    aniId: m.id || 0, mal: m.idMal || 0, isAdult: !!m.isAdult, format: m.format || '',
    banner: m.bannerImage || '',
    upcoming: m.status === 'NOT_YET_RELEASED',
    trailerId: (m.trailer && m.trailer.site === 'youtube') ? cleanYoutubeId(m.trailer.id) : '',
    rawGenres: m.genres || [], rawTags: (m.tags || []).filter(t => !t.isMediaSpoiler && t.rank >= 55).map(t => t.name),
    vols: m.volumes || 0, eps: m.episodes || m.chapters || 0, airedEps: (m.nextAiringEpisode && Number(m.nextAiringEpisode.episode) > 1) ? (Number(m.nextAiringEpisode.episode) - 1) : 0, dur: m.duration || 0,
    title: main, en: t.english || '', romaji: t.romaji || '', orig: t.native || '', alt,
    author: type === 'ANIME' ? (pick(/Original Creator/i) || pick(/Director/i)) : (pick(/Story/i) || pick(/Art/i)),
    studio: (m.studios?.nodes || []).map(n => n.name).slice(0, 2).join(', '), source: SRC[m.source] || '', ongoing: m.status === 'RELEASING', releaseStatus: m.status || '', src: 'AniList', url: m.siteUrl, poster: rawPoster, year: m.startDate?.year || '',
    endYear: endYearStr, endDate: endDateStr,
    ext: m.averageScore ? (m.averageScore / 10).toFixed(1) : '', tags: [...(m.genres || []).map(g => RU[g] || g), ...(m.tags || []).filter(t => !t.isMediaSpoiler && t.rank >= 60).slice(0, 8).map(t => ruTag(t.name))],
    desc: m.description ? decode(m.description.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim() : '',
    category: type === 'ANIME' ? 'Аниме' : m.format === 'NOVEL' ? 'Ранобэ' : 'Манга',
    kind: {KR: 'Манхва', CN: 'Маньхуа', TW: 'Маньхуа', JP: 'Манга'}[m.countryOfOrigin] || 'Комикс',
    subKind: {KR: 'Манхва', CN: 'Маньхуа', TW: 'Маньхуа', JP: 'Манга'}[m.countryOfOrigin] || 'Комикс'
  };
}

let _anilistDirectBlockedUntil = 0;
let _anilistRateLimitUntil = 0;
const isAniListBlockedNow = () => Date.now() < Math.max(_anilistDirectBlockedUntil, _anilistRateLimitUntil);

const _anilistQueue = [];
let _anilistActiveCount = 0;
let _anilistLastStartAt = 0;
const ANILIST_MAX_CONCURRENCY = 2;
const ANILIST_MIN_INTERVAL_MS = 260;

function _drainAnilistQueue() {
  while (_anilistActiveCount < ANILIST_MAX_CONCURRENCY && _anilistQueue.length) {
    const now = Date.now();
    const waitMs = Math.max(0, ANILIST_MIN_INTERVAL_MS - (now - _anilistLastStartAt));
    if (waitMs > 0) {
      setTimeout(_drainAnilistQueue, waitMs);
      return;
    }
    const job = _anilistQueue.shift();
    if (!job) break;
    if (job.extSignal && job.extSignal.aborted) {
      const ab = new Error('Aborted');
      ab.name = 'AbortError';
      job.reject(ab);
      continue;
    }
    _anilistActiveCount++;
    _anilistLastStartAt = Date.now();
    Promise.resolve()
      .then(job.fn)
      .then(job.resolve, job.reject)
      .finally(() => {
        _anilistActiveCount = Math.max(0, _anilistActiveCount - 1);
        _drainAnilistQueue();
      });
  }
}

function _enqueueAnilist(fn, extSignal = null) {
  return new Promise((resolve, reject) => {
    _anilistQueue.push({ fn, resolve, reject, extSignal });
    _drainAnilistQueue();
  });
}

async function fetchAniListGraphQL(query, variables = {}, timeoutMs = 2600, extSignal = null) {
  if (extSignal && extSignal.aborted) {
    const ab = new Error('Aborted');
    ab.name = 'AbortError';
    throw ab;
  }
  if (isAniListBlockedNow()) {
    const err = new Error('AniList unavailable (cached)');
    err.isAniListBlocked = true;
    if (Date.now() < _anilistRateLimitUntil) err.isRateLimit = true;
    throw err;
  }

  return _enqueueAnilist(async () => {
    const execOnce = async () => {
      if (extSignal && extSignal.aborted) {
        const ab = new Error('Aborted');
        ab.name = 'AbortError';
        throw ab;
      }
      const ctrl = new AbortController();
      const onExtAbort = () => ctrl.abort();
      if (extSignal) extSignal.addEventListener('abort', onExtAbort, { once: true });
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let r;
      try {
        r = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query, variables })
        });
      } catch (netErr) {
        if (extSignal && extSignal.aborted) {
          const ab = new Error('Aborted');
          ab.name = 'AbortError';
          throw ab;
        }
        _anilistDirectBlockedUntil = Date.now() + 10 * 60 * 1000;
        throw netErr;
      } finally {
        clearTimeout(timer);
        if (extSignal) extSignal.removeEventListener('abort', onExtAbort);
      }
      if (r.status === 429) {
        const err429 = new Error('HTTP 429 Too Many Requests');
        err429.status = 429;
        err429.isRateLimit = true;
        throw err429;
      }
      if (!r.ok) {
        if (r.status >= 500 || r.status === 403) _anilistDirectBlockedUntil = Date.now() + 2 * 60 * 1000;
        throw new Error('HTTP ' + r.status);
      }
      const j = await r.json();
      if (j.errors) throw new Error(j.errors[0].message);
      return j;
    };

    try {
      return await execOnce();
    } catch (e) {
      if (e && e.isRateLimit && !(extSignal && extSignal.aborted)) {
        await new Promise(res => setTimeout(res, 1200));
        try {
          return await execOnce();
        } catch (retryErr) {
          if (retryErr && retryErr.isRateLimit) {
            _anilistRateLimitUntil = Date.now() + 30000;
          }
          throw retryErr;
        }
      }
      throw e;
    }
  }, extSignal);
}

const SHIKI_ANIME_GENRE_IDS = {
  Action: 1, Adventure: 2, Comedy: 4, Drama: 8, Ecchi: 9, Fantasy: 10, Horror: 14, Hentai: 12,
  'Mahou Shoujo': 124, Mecha: 18, Music: 19, Mystery: 7, Psychological: 40, Romance: 22,
  'Sci-Fi': 24, 'Slice of Life': 36, Sports: 30, Supernatural: 37, Thriller: 117,
  Yuri: 34, "Girls' Love": 129, 'Girls Love': 129, Yaoi: 33, "Boys' Love": 133, 'Boys Love': 133,
  Isekai: 130, Reincarnation: 106,
  Vampire: 32, Military: 38, School: 23, Mythology: 6, Space: 29, Gore: 105,
  Seinen: 42, Shounen: 27, Shoujo: 25, Josei: 43, Iyashikei: 140, Harem: 35,
  'Reverse Harem': 125, 'Video Games': 103, 'Time Travel': 111, Historical: 13,
  Detective: 39, Parody: 20, Samurai: 21, 'Martial Arts': 17
};
const SHIKI_MANGA_GENRE_IDS = {
  Action: 56, Adventure: 68, Comedy: 49, Drama: 50, Ecchi: 51, Fantasy: 57, Horror: 80, Hentai: 602,
  'Mahou Shoujo': 160, Mecha: 83, Music: 78, Mystery: 46, Psychological: 67, Romance: 62,
  'Sci-Fi': 53, 'Slice of Life': 54, Sports: 76, Supernatural: 48, Thriller: 153,
  Yuri: 75, "Girls' Love": 73, 'Girls Love': 73, Yaoi: 65, "Boys' Love": 55, 'Boys Love': 55,
  Isekai: 172, Reincarnation: 161,
  Vampire: 64, Military: 70, School: 60, Mythology: 72, Space: 85, Gore: 127,
  Seinen: 52, Shounen: 47, Shoujo: 63, Josei: 87, Iyashikei: 154, Harem: 71,
  'Reverse Harem': 164, 'Video Games': 175, 'Time Travel': 174, Historical: 69,
  Detective: 89, Parody: 86, Samurai: 88, 'Martial Arts': 66
};

function buildShikiGraphQLVars(search, type, o = {}) {
  const isAnime = type === 'ANIME' || type === 'Аниме';
  const isNovel = o.format === 'NOVEL';
  const gMap = isAnime ? SHIKI_ANIME_GENRE_IDS : SHIKI_MANGA_GENRE_IDS;
  const sortVal = (o.sort && o.sort[0]) || 'POPULARITY_DESC';
  const orderMap = {
    SCORE_DESC: 'ranked',
    TRENDING_DESC: 'popularity',
    POPULARITY_DESC: 'popularity',
    START_DATE_DESC: 'aired_on',
    FAVOURITES_DESC: 'popularity',
    SEARCH_MATCH: 'ranked'
  };
  const vars = {
    page: Math.max(1, Number(o.page) || 1),
    limit: Math.min(50, Math.max(1, Number(o.per) || 24)),
    order: orderMap[sortVal] || 'popularity'
  };
  if (search) vars.search = String(search);
  if (o.idMal) vars.ids = String(o.idMal);
  else if (Array.isArray(o.idMalIn) && o.idMalIn.length) vars.ids = o.idMalIn.join(',');

  if (o.status === 'RELEASING') vars.status = 'ongoing';
  else if (o.status === 'NOT_YET_RELEASED') vars.status = 'anons';
  else if (o.status === 'FINISHED') vars.status = 'released';

  if (isAnime) {
    if (o.format === 'MOVIE') vars.kind = 'movie';
    else if (o.fn === 'MOVIE') vars.kind = 'tv,ova,ona,special';
  } else if (isNovel) {
    vars.kind = 'light_novel,novel';
  } else {
    if (o.country === 'KR') vars.kind = 'manhwa';
    else if (o.country === 'CN') vars.kind = 'manhua';
    else if (o.country === 'JP') vars.kind = 'manga,one_shot';
    else if (o.fn === 'NOVEL') vars.kind = 'manga,manhwa,manhua,one_shot';
  }

  const yrFrom = o.sg ? Math.floor((Number(o.sg) + 1) / 10000) : 0;
  const yrTo = o.sl ? (Math.floor(Number(o.sl) / 10000) - (Number(o.sl) % 10000 === 0 ? 1 : 0)) : 0;
  if (o.se && o.sy) {
    vars.season = `${String(o.se).toLowerCase()}_${o.sy}`;
  } else if (yrFrom && yrTo) {
    vars.season = yrFrom === yrTo ? String(yrFrom) : `${yrFrom}_${yrTo}`;
  } else if (yrFrom) {
    vars.season = `${yrFrom}_${new Date().getFullYear() + 2}`;
  } else if (yrTo) {
    vars.season = `1950_${yrTo}`;
  }

  const genreTokens = [];
  [...(o.genre || []), ...(o.tag || [])].forEach(name => {
    const gid = gMap[name];
    if (gid) genreTokens.push(String(gid));
  });
  [...(o.genreNot || []), ...(o.tagNot || [])].forEach(name => {
    const gid = gMap[name];
    if (gid) genreTokens.push('!' + gid);
  });
  const hentaiId = isAnime ? 12 : 602;
  if (o.ad === false) {
    vars.censored = true;
    if (!genreTokens.includes('!' + hentaiId) && !genreTokens.includes(String(hentaiId))) {
      genreTokens.push('!' + hentaiId);
    }
  } else if (o.ad === true) {
    vars.censored = false;
    if (!genreTokens.includes(String(hentaiId))) genreTokens.push(String(hentaiId));
  } else {
    vars.censored = false;
  }
  if (genreTokens.length) vars.genre = [...new Set(genreTokens)].join(',');
  if (o.ag && Number(o.ag) >= 60) vars.score = Math.floor(Number(o.ag) / 10);
  return vars;
}

const JIKAN_ANIME_GENRE_IDS = {
  Action: 1, Adventure: 2, Comedy: 4, Drama: 8, Ecchi: 9, Fantasy: 10, Horror: 14, Hentai: 12,
  'Mahou Shoujo': 66, Mecha: 18, Music: 19, Mystery: 7, Psychological: 40, Romance: 22,
  'Sci-Fi': 24, 'Slice of Life': 36, Sports: 30, Supernatural: 37, Thriller: 41,
  Yuri: 26, "Girls' Love": 26, Yaoi: 28, "Boys' Love": 28, Isekai: 62, Reincarnation: 72,
  Vampire: 32, Military: 38, School: 23, Mythology: 6, Space: 29, Gore: 58,
  Seinen: 42, Shounen: 27, Shoujo: 25, Josei: 43, Iyashikei: 63, Harem: 35,
  'Reverse Harem': 73, 'Video Games': 79, 'Time Travel': 78, Historical: 13,
  Detective: 39, Parody: 20, Samurai: 21, 'Martial Arts': 17, 'Super Power': 31
};
const JIKAN_MANGA_GENRE_IDS = {
  Action: 1, Adventure: 2, Comedy: 4, Drama: 8, Ecchi: 9, Fantasy: 10, Horror: 14, Hentai: 12,
  'Mahou Shoujo': 66, Mecha: 18, Music: 19, Mystery: 7, Psychological: 40, Romance: 22,
  'Sci-Fi': 24, 'Slice of Life': 36, Sports: 30, Supernatural: 37, Thriller: 45,
  Yuri: 26, "Girls' Love": 26, Yaoi: 28, "Boys' Love": 28, Isekai: 62, Reincarnation: 73,
  Vampire: 32, Military: 38, School: 23, Mythology: 6, Space: 29, Gore: 58,
  Seinen: 41, Shounen: 27, Shoujo: 25, Josei: 42, Iyashikei: 63, Harem: 35,
  'Reverse Harem': 74, 'Video Games': 80, 'Time Travel': 79, Historical: 13,
  Detective: 39, Parody: 20, Samurai: 21, 'Martial Arts': 17, 'Super Power': 31
};
const MANGADEX_TAG_IDS = {
  Action: '391b0423-d847-456f-aff0-8b0cfc03066b',
  Adventure: '87cc87cd-a395-47af-b27a-93258283bbc6',
  Comedy: '4d32cc48-9f00-4cca-9b5a-a839f0764984',
  Drama: 'b9af3a63-f058-46de-a9a0-e0c13906197a',
  Fantasy: 'cdc58593-87dd-415e-bbc0-2693bf4b985b',
  Horror: 'cdad7e68-1419-41dd-bdce-27753074a640',
  Mystery: 'ee968100-4191-4968-93d3-f82d72be7e46',
  Psychological: '3b60b75c-a2d7-4860-ab56-05f391bb889c',
  Romance: '423e2eae-a7a2-4a8b-ac03-a8351462d71d',
  'Sci-Fi': '256c8bd9-4904-4360-bf4f-508a76d67183',
  'Slice of Life': 'e5301a23-ebd9-49dd-a0cb-2fe944c7fe94',
  Sports: '69964a64-2f90-4d33-beeb-f3ed2875eb4c',
  Supernatural: 'eabc5b4c-6aff-42f3-b657-3e90cbd00b75',
  Thriller: '07251805-a27e-4d59-b488-f0bfbec15168',
  Yuri: 'a3c67850-4684-404e-9b7f-c69850ee5da6',
  "Girls' Love": 'a3c67850-4684-404e-9b7f-c69850ee5da6',
  Yaoi: '5920b825-4181-4a17-beeb-9918b0ff7a30',
  "Boys' Love": '5920b825-4181-4a17-beeb-9918b0ff7a30',
  Isekai: 'ace04997-f6bd-436e-b261-779182193d3d',
  Reincarnation: '0bc90acb-ccc1-44ca-a34a-b9f3a73259d4',
  Vampire: 'd7d1730f-6eb0-4ba6-9437-602cac38664c',
  Demons: '39730448-9a5f-48a2-85b0-a70db87b1233',
  Military: 'ac72833b-c4e9-4878-b9db-6c8a4a99444a',
  School: 'caaa44eb-cd40-4177-b930-79d3ef2afe87',
  Historical: '33771934-028e-4cb3-8744-691e866a923e',
  Gore: 'b29d6a3d-1569-4e7a-8caf-7557bc92cd5d',
  Crime: '5ca48985-9a9d-4bd8-be29-80e469db1b51',
  Survival: '5fff9cde-849c-4d78-aab0-0d52b2ee1d25',
  Harem: 'aafb99c1-7f60-43fa-b75f-fc9502ce29c7',
  'Reverse Harem': '65761a2a-415e-47f3-bef2-a9dababba7a6',
  'Monster Girl': 'dd1f77c5-dea9-4e2b-97ae-2247b5caf991',
  'Time Travel': '292e862b-2d17-4062-90a2-0356caa4ae27',
  'Video Games': '9438db5a-7e2a-4ac0-b39e-e0d95a34b8a8',
  Magic: 'a1f53773-c69a-4ce5-8cab-fffcd90b1565',
  'Martial Arts': '799c202e-7daa-44eb-9cf7-8a3c0441531e',
  'Post-Apocalyptic': '9467335a-1b83-4497-9231-765337a00b96',
  Mecha: '50880a9d-5440-4732-9afb-8f457127e836',
  Music: 'f42fbf9e-188a-447b-9fdc-f19dc1e4d685',
  Samurai: '81183756-1453-4c81-aa9e-f6e1b63be016',
  Tragedy: 'f8f62932-27da-4fe4-8ee1-6779a8059ba3',
  Villainess: 'd14322ac-4d6f-4e9b-afd9-629d5f4d8a41'
};

const _shikiRestGenresCache = new Map();

function mapShikimoriGraphQLNode(d, type, isNovelHint = false, queryHint = null) {
  const isAnime = type === 'ANIME';
  const ruName = d.russian || d.english || d.name || '';
  const enName = d.english || d.name || '';
  const romajiName = d.name || '';
  const malNum = Number(d.malId || d.id) || 0;
  const shikiNum = Number(d.id) || 0;
  const catName = isAnime ? 'Аниме' : ((isNovelHint || d.kind === 'light_novel' || d.kind === 'novel') ? 'Ранобэ' : 'Манга');
  const subK = catName === 'Манга' ? (d.kind === 'manhwa' ? 'Манхва' : d.kind === 'manhua' ? 'Маньхуа' : 'Манга') : '';
  const fmt = d.kind === 'movie' ? 'MOVIE' : d.kind === 'tv' ? 'TV' : d.kind === 'ova' ? 'OVA' : d.kind === 'ona' ? 'ONA' : d.kind === 'special' ? 'SPECIAL' : (catName === 'Ранобэ' ? 'NOVEL' : d.kind === 'one_shot' ? 'ONE_SHOT' : 'MANGA');
  const ep = SHK[catName] || (isAnime ? 'animes' : 'mangas');
  if (malNum && d.russian) RUC[ep + malNum] = d.russian;
  const posterUrl = pickShikiGraphQLPoster(d.poster);
  const posterFallbacks = [d.poster?.originalUrl, d.poster?.mainUrl].filter(isValidPosterUrl);
  const suspiciousYaoiOnly = typeof KirokuEngine !== 'undefined' && KirokuEngine.isShikimoriSuspiciousYaoiOnlyGenres
    ? KirokuEngine.isShikimoriSuspiciousYaoiOnlyGenres(d.genres, isAnime)
    : false;
  let rawGenres = (d.genres || []).map(g => g.name).filter(Boolean);
  let ruTags = (d.genres || []).map(g => g.russian || RU[g.name] || ruTag(g.name) || g.name).filter(Boolean);
  // Серверный баг Shikimori GraphQL: манга с Сёдзё-ай (73) / Сёнэн-ай (55) приходит с единственным жанром Yaoi (65).
  // Если запрос был по Юри — сразу подставляем Юри и помечаем для уточнения из REST/AniList.
  if (suspiciousYaoiOnly && queryHint && queryHint.queriedYuri && !queryHint.queriedYaoi) {
    rawGenres = ['Shoujo Ai', 'Yuri'];
    ruTags = ['Юри / Сёдзё-ай'];
  }
  let ytId = '';
  if (Array.isArray(d.videos) && d.videos.length) {
    const pv = d.videos.find(v => /pv|trailer/i.test(v.kind || '')) || d.videos[0];
    ytId = cleanYoutubeId(pv?.url);
  }
  const altList = [...new Set([romajiName, ...(Array.isArray(d.synonyms) ? d.synonyms : [])].filter(s => s && s !== ruName && s !== enName))];
  return {
    aniId: 0,
    mal: malNum,
    shikiId: shikiNum,
    isAdult: d.rating === 'rx' || d.isCensored === true || rawGenres.includes('Hentai'),
    format: fmt,
    banner: '',
    upcoming: d.status === 'anons',
    trailerId: ytId,
    rawGenres,
    rawTags: rawGenres,
    vols: Number(d.volumes) || 0,
    eps: Number(d.episodes || d.chapters || d.episodesAired) || 0,
    airedEps: Number(d.episodesAired) || 0,
    dur: Number(d.duration) || (isAnime ? 24 : 0),
    title: ruName,
    en: enName,
    romaji: romajiName,
    orig: d.japanese || romajiName,
    alt: altList.slice(0, 6).join(', '),
    author: '',
    studio: (d.studios || d.publishers || []).map(s => s.name).filter(Boolean).slice(0, 2).join(', '),
    source: SRC[String(d.origin || '').toUpperCase()] || '',
    ongoing: d.status === 'ongoing',
    releaseStatus: d.status || '',
    src: 'Shikimori',
    url: d.url ? (d.url.startsWith('http') ? d.url : 'https://shikimori.io' + d.url) : `https://shikimori.io/${ep}/${malNum}`,
    poster: posterUrl,
    posterFallbacks,
    year: String(d.airedOn?.year || d.releasedOn?.year || ''),
    endYear: d.releasedOn?.year ? String(d.releasedOn.year) : '',
    endDate: d.releasedOn?.year ? ([d.releasedOn.day, d.releasedOn.month, d.releasedOn.year].filter(Boolean).map(n => String(n).padStart(2, '0')).join('.') || String(d.releasedOn.year)) : '',
    ext: d.score && Number(d.score) > 0 ? Number(d.score).toFixed(1) : '',
    tags: ruTags,
    desc: ruClean(d.description || ''),
    ruTitle: d.russian ? 1 : 0,
    ruDone: d.description && hasRu(d.description) ? 1 : 0,
    _fromShikiFallback: true,
    _shikiSuspiciousYaoiOnly: suspiciousYaoiOnly,
    category: catName,
    kind: subK || catName,
    subKind: subK
  };
}

// Уточнение истинных жанров манги через Shikimori REST (обходит баг GraphQL с Yaoi=65 вместо Shoujo Ai/Shounen Ai)
async function resolveSuspiciousShikiMangaGenres(cards, extSignal = null) {
  if (!Array.isArray(cards) || !cards.length) return cards;
  const suspects = cards.filter(c => c && c._shikiSuspiciousYaoiOnly && c.mal && c.category !== 'Аниме').slice(0, 10);
  if (!suspects.length) return cards;
  await Promise.all(suspects.map(async c => {
    if (extSignal && extSignal.aborted) return;
    const ep = SHK[c.category] || 'mangas';
    const key = ep + ':' + c.mal;
    let genres = _shikiRestGenresCache.get(key);
    if (!genres) {
      try {
        const rest = await shiki(`/api/${ep}/${c.mal}`);
        if (Array.isArray(rest?.genres) && rest.genres.length) {
          genres = rest.genres;
          _shikiRestGenresCache.set(key, genres);
          if (_shikiRestGenresCache.size > 300) _shikiRestGenresCache.delete(_shikiRestGenresCache.keys().next().value);
        }
      } catch (e) {}
    }
    if (Array.isArray(genres) && genres.length) {
      const cleanRaw = genres.map(g => g.name).filter(Boolean);
      const cleanRu = genres.map(g => g.russian || RU[g.name] || ruTag(g.name) || g.name).filter(Boolean);
      if (cleanRaw.length) {
        c.rawGenres = cleanRaw;
        c.rawTags = cleanRaw;
      }
      if (cleanRu.length) {
        c.tags = (typeof KirokuEngine !== 'undefined' && KirokuEngine.sanitizeSuspiciousShikiTags)
          ? KirokuEngine.sanitizeSuspiciousShikiTags(c.tags, cleanRu)
          : cleanRu;
      }
      c._shikiSuspiciousYaoiOnly = false;
    }
  }));
  return cards;
}

function mapJikanNode(x, isAnime = true, isNovelHint = false) {
  const posterCandidates = [
    x.images?.jpg?.large_image_url,
    x.images?.webp?.large_image_url,
    x.images?.jpg?.image_url,
    x.images?.webp?.image_url
  ].filter(isValidPosterUrl);
  const posterU = posterCandidates[0] || '';
  const typeStr = String(x.type || '');
  const catN = isAnime ? 'Аниме' : ((typeStr === 'Light Novel' || typeStr === 'Novel' || isNovelHint) ? 'Ранобэ' : 'Манга');
  const subK = catN === 'Манга' ? (typeStr === 'Manhwa' ? 'Манхва' : typeStr === 'Manhua' ? 'Маньхуа' : 'Манга') : '';
  const fmt = isAnime
    ? (typeStr === 'Movie' ? 'MOVIE' : typeStr === 'OVA' ? 'OVA' : typeStr === 'ONA' ? 'ONA' : typeStr === 'Special' ? 'SPECIAL' : 'TV')
    : (catN === 'Ранобэ' ? 'NOVEL' : typeStr === 'One-shot' ? 'ONE_SHOT' : 'MANGA');
  const rawG = [...(x.genres || []), ...(x.explicit_genres || [])].map(g => g.name).filter(Boolean);
  const rawT = [...(x.themes || []), ...(x.demographics || [])].map(g => g.name).filter(Boolean);
  const isAdult = (x.rating || '').includes('Rx') || rawG.includes('Hentai');
  const durMin = isAnime ? (parseInt(String(x.duration || '').match(/\d+/)?.[0] || '') || 24) : 0;
  return {
    aniId: 0,
    mal: Number(x.mal_id) || 0,
    isAdult,
    format: fmt,
    banner: '',
    upcoming: x.status === 'Not yet aired' || x.status === 'Not yet published',
    trailerId: cleanYoutubeId(x.trailer?.youtube_id),
    rawGenres: rawG,
    rawTags: [...rawG, ...rawT],
    vols: Number(x.volumes) || 0,
    eps: Number(x.episodes || x.chapters) || 0,
    dur: durMin,
    title: x.title_english || x.title || '',
    en: x.title_english || x.title || '',
    romaji: x.title || '',
    orig: x.title_japanese || '',
    alt: (x.title_synonyms || []).slice(0, 5).join(', '),
    author: (x.authors || []).map(a => a.name).slice(0, 2).join(', '),
    studio: (x.studios || x.serializations || []).map(s => s.name).slice(0, 2).join(', '),
    source: SRC[String(x.source || '').toUpperCase().replace(/\s+/g, '_')] || '',
    ongoing: Boolean(x.airing || x.publishing),
    releaseStatus: x.status || '',
    src: 'Jikan',
    url: x.url || '',
    poster: posterU,
    posterFallbacks: [...new Set(posterCandidates)],
    year: String(x.year || x.aired?.prop?.from?.year || x.published?.prop?.from?.year || ''),
    endYear: String(x.aired?.prop?.to?.year || x.published?.prop?.to?.year || ''),
    endDate: String(x.aired?.to || x.published?.to || '').slice(0, 10) || String(x.aired?.prop?.to?.year || x.published?.prop?.to?.year || ''),
    ext: x.score ? Number(x.score).toFixed(1) : '',
    tags: [...new Set([...rawG, ...rawT].map(n => RU[n] || ruTag(n) || n).filter(Boolean))],
    desc: x.synopsis || '',
    category: catN,
    kind: subK || catN,
    subKind: subK
  };
}

async function _jikanCatalogRaw(search, type, o = {}) {
  const isAnime = type === 'ANIME' || type === 'Аниме';
  const isNovel = o.format === 'NOVEL';
  const jEp = isAnime ? 'anime' : 'manga';
  const gMap = isAnime ? JIKAN_ANIME_GENRE_IDS : JIKAN_MANGA_GENRE_IDS;
  const p = new URLSearchParams();
  p.set('page', String(Math.max(1, Number(o.page) || 1)));
  p.set('limit', String(Math.min(25, Math.max(1, Number(o.per) || 20))));
  if (search) p.set('q', String(search));
  if (o.ad === false) p.set('sfw', 'true');
  if (o.status === 'RELEASING') p.set('status', isAnime ? 'airing' : 'publishing');
  else if (o.status === 'NOT_YET_RELEASED') p.set('status', 'upcoming');
  else if (o.status === 'FINISHED') p.set('status', 'complete');

  if (isAnime) {
    if (o.format === 'MOVIE') p.set('type', 'movie');
    else if (o.fn === 'MOVIE') p.set('type', 'tv');
  } else if (isNovel) {
    p.set('type', 'lightnovel');
  } else if (o.country === 'KR') {
    p.set('type', 'manhwa');
  } else if (o.country === 'CN') {
    p.set('type', 'manhua');
  } else if (o.country === 'JP') {
    p.set('type', 'manga');
  }

  const yrFrom = o.sg ? Math.floor((Number(o.sg) + 1) / 10000) : 0;
  const yrTo = o.sl ? (Math.floor(Number(o.sl) / 10000) - (Number(o.sl) % 10000 === 0 ? 1 : 0)) : 0;
  if (yrFrom) p.set('start_date', `${yrFrom}-01-01`);
  if (yrTo) p.set('end_date', `${yrTo}-12-31`);

  const incIds = [...new Set([...(o.genre || []), ...(o.tag || [])].map(n => gMap[n]).filter(Boolean))];
  const excIds = [...new Set([...(o.genreNot || []), ...(o.tagNot || [])].map(n => gMap[n]).filter(Boolean))];
  if (o.ad === true && !incIds.includes(12)) incIds.push(12);
  if (incIds.length) p.set('genres', incIds.join(','));
  if (excIds.length) p.set('genres_exclude', excIds.join(','));
  if (o.ag && Number(o.ag) >= 60) p.set('min_score', String(Math.floor(Number(o.ag) / 10)));

  const sortVal = (o.sort && o.sort[0]) || 'POPULARITY_DESC';
  const orderMap = {
    SCORE_DESC: 'score',
    TRENDING_DESC: 'members',
    POPULARITY_DESC: 'popularity',
    START_DATE_DESC: 'start_date',
    FAVOURITES_DESC: 'favorites'
  };
  if (!search && orderMap[sortVal]) {
    p.set('order_by', orderMap[sortVal]);
    p.set('sort', sortVal === 'POPULARITY_DESC' ? 'asc' : 'desc');
  }

  const jResp = await _jikanJson(`https://api.jikan.moe/v4/${jEp}?${p.toString()}`, 6000);
  let mapped = (Array.isArray(jResp?.data) ? jResp.data : []).map(x => mapJikanNode(x, isAnime, isNovel));
  if (isNovel) mapped = mapped.filter(x => x.category === 'Ранобэ');
  else if (!isAnime && o.fn === 'NOVEL') mapped = mapped.filter(x => x.category === 'Манга');
  if (isAnime) {
    if (o.el) mapped = mapped.filter(x => !x.eps || x.eps < o.el);
    if (o.eg) mapped = mapped.filter(x => x.eps > o.eg);
  } else {
    if (o.cl) mapped = mapped.filter(x => !x.eps || x.eps < o.cl);
    if (o.cg) mapped = mapped.filter(x => x.eps > o.cg);
  }
  return mapped;
}

function mapMangaDexNode(d, isNovelHint = false) {
  const attr = d?.attributes || {};
  const titles = attr.title || {};
  const altArr = Array.isArray(attr.altTitles) ? attr.altTitles : [];
  const pickAlt = lang => {
    for (const obj of altArr) {
      if (obj && obj[lang]) return obj[lang];
    }
    return '';
  };
  const ruTitle = titles.ru || pickAlt('ru') || '';
  const enTitle = titles.en || pickAlt('en') || Object.values(titles)[0] || '';
  const romajiTitle = titles['ja-ro'] || titles['ko-ro'] || titles['zh-ro'] || pickAlt('ja-ro') || enTitle;
  const origTitle = titles.ja || titles.ko || titles.zh || pickAlt('ja') || pickAlt('ko') || '';
  const allAlt = [...new Set(altArr.flatMap(o => Object.values(o || {})).filter(s => s && s !== ruTitle && s !== enTitle && s !== origTitle))].slice(0, 6).join(', ');
  const descObj = attr.description || {};
  const rawDesc = descObj.ru || descObj.en || Object.values(descObj).find(Boolean) || '';

  const rels = Array.isArray(d.relationships) ? d.relationships : [];
  const coverRel = rels.find(r => r.type === 'cover_art' && r.attributes?.fileName);
  const coverFile = coverRel?.attributes?.fileName || '';
  const cover512 = coverFile ? `https://uploads.mangadex.org/covers/${d.id}/${coverFile}.512.jpg` : '';
  const cover256 = coverFile ? `https://uploads.mangadex.org/covers/${d.id}/${coverFile}.256.jpg` : '';
  const authors = rels.filter(r => r.type === 'author' || r.type === 'artist').map(r => r.attributes?.name).filter(Boolean);

  const mdTags = (attr.tags || []).map(t => t.attributes?.name?.en).filter(Boolean);
  if (attr.publicationDemographic) {
    const demoCap = attr.publicationDemographic.charAt(0).toUpperCase() + attr.publicationDemographic.slice(1);
    mdTags.push(demoCap);
  }
  const origLang = String(attr.originalLanguage || '').toLowerCase();
  const subK = origLang === 'ko' ? 'Манхва' : (origLang === 'zh' || origLang === 'zh-hk') ? 'Маньхуа' : origLang === 'ja' ? 'Манга' : 'Комикс';
  const catN = isNovelHint ? 'Ранобэ' : 'Манга';
  const malId = Number(attr.links?.mal) || 0;
  const aniId = Number(attr.links?.al) || 0;
  const isAdult = attr.contentRating === 'pornographic' || attr.contentRating === 'erotica';
  return {
    aniId,
    mal: malId,
    mdId: d.id || '',
    isAdult,
    format: isNovelHint ? 'NOVEL' : (attr.tags || []).some(t => t.attributes?.name?.en === 'Oneshot') ? 'ONE_SHOT' : 'MANGA',
    banner: '',
    upcoming: false,
    trailerId: '',
    rawGenres: mdTags,
    rawTags: mdTags,
    vols: parseInt(attr.lastVolume) || 0,
    eps: parseInt(attr.lastChapter) || 0,
    dur: 0,
    title: ruTitle || enTitle || romajiTitle || 'Без названия',
    en: enTitle,
    romaji: romajiTitle,
    orig: origTitle,
    alt: allAlt,
    author: [...new Set(authors)].slice(0, 2).join(', '),
    studio: '',
    source: '',
    ongoing: attr.status === 'ongoing',
    releaseStatus: attr.status || '',
    src: 'MangaDex',
    url: `https://mangadex.org/title/${d.id}`,
    poster: cover512,
    posterFallbacks: [cover512, cover256].filter(isValidPosterUrl),
    year: attr.year ? String(attr.year) : '',
    ext: '',
    tags: [...new Set(mdTags.map(n => RU[n] || ruTag(n) || n).filter(Boolean))],
    desc: ruClean(rawDesc),
    ruTitle: ruTitle ? 1 : 0,
    ruDone: rawDesc && hasRu(rawDesc) ? 1 : 0,
    category: catN,
    kind: subK,
    subKind: catN === 'Манга' ? subK : ''
  };
}

async function _mangadexCatalogRaw(search, o = {}) {
  const isNovel = o.format === 'NOVEL';
  const limit = Math.min(24, Math.max(1, Number(o.per) || 16));
  const page = Math.max(1, Number(o.page) || 1);
  const p = new URLSearchParams();
  p.set('limit', String(limit));
  p.set('offset', String((page - 1) * limit));
  p.append('includes[]', 'cover_art');
  p.append('includes[]', 'author');
  p.append('includes[]', 'artist');
  p.append('hasAvailableChapters', 'true');
  if (search) p.set('title', String(search));

  const ratings = o.ad === true ? ['erotica', 'pornographic'] : o.ad === undefined ? ['safe', 'suggestive', 'erotica', 'pornographic'] : ['safe', 'suggestive'];
  ratings.forEach(r => p.append('contentRating[]', r));

  if (o.country === 'JP') p.append('originalLanguage[]', 'ja');
  else if (o.country === 'KR') p.append('originalLanguage[]', 'ko');
  else if (o.country === 'CN') { p.append('originalLanguage[]', 'zh'); p.append('originalLanguage[]', 'zh-hk'); }

  if (o.status === 'RELEASING') p.append('status[]', 'ongoing');
  else if (o.status === 'FINISHED') p.append('status[]', 'completed');

  const yrFrom = o.sg ? Math.floor((Number(o.sg) + 1) / 10000) : 0;
  const yrTo = o.sl ? (Math.floor(Number(o.sl) / 10000) - (Number(o.sl) % 10000 === 0 ? 1 : 0)) : 0;
  if (yrFrom && yrFrom === yrTo) p.set('year', String(yrFrom));

  const demos = new Set(['Shounen', 'Shoujo', 'Seinen', 'Josei']);
  [...(o.genre || []), ...(o.tag || [])].forEach(name => {
    if (demos.has(name)) p.append('publicationDemographic[]', name.toLowerCase());
    else if (MANGADEX_TAG_IDS[name]) p.append('includedTags[]', MANGADEX_TAG_IDS[name]);
  });
  [...(o.genreNot || []), ...(o.tagNot || [])].forEach(name => {
    if (MANGADEX_TAG_IDS[name]) p.append('excludedTags[]', MANGADEX_TAG_IDS[name]);
  });

  const sortVal = (o.sort && o.sort[0]) || 'POPULARITY_DESC';
  if (search) p.set('order[relevance]', 'desc');
  else if (sortVal === 'SCORE_DESC') p.set('order[rating]', 'desc');
  else if (sortVal === 'START_DATE_DESC') p.set('order[year]', 'desc');
  else p.set('order[followedCount]', 'desc');

  const jResp = await _mangadexJson(`https://api.mangadex.org/manga?${p.toString()}`, 6500);
  let mapped = (Array.isArray(jResp?.data) ? jResp.data : []).map(d => mapMangaDexNode(d, isNovel));
  if (yrFrom) mapped = mapped.filter(x => !x.year || parseInt(x.year) >= yrFrom);
  if (yrTo) mapped = mapped.filter(x => !x.year || parseInt(x.year) <= yrTo);
  return mapped;
}

// Фоллбэк каталога через официальный Shikimori GraphQL API + Jikan v4 + MangaDex (работает в РФ без VPN и с VPN)
async function _shikiCatalogFallback(search, type, o = {}) {
  const isAnime = type === 'ANIME';
  try {
    if (typeof isShikiGraphQLBlockedNow === 'function' && isShikiGraphQLBlockedNow()) {
      throw new Error('Shikimori GraphQL blocked');
    }
    return await _shikiDirectOnly(search, type, o);
  } catch (gqlErr) {
    const fbTasks = [_jikanCatalogRaw(search, type, o).catch(() => [])];
    if (!isAnime && !o.idMal && !o.idMalIn) fbTasks.push(_mangadexCatalogRaw(search, o).catch(() => []));
    const fbLists = await Promise.all(fbTasks);
    let mapped = interleaveAndDedupCatalogLists(fbLists);
    if (isAnime) {
      if (o.el) mapped = mapped.filter(x => !x.eps || x.eps < o.el);
      if (o.eg) mapped = mapped.filter(x => x.eps > o.eg);
    } else {
      if (o.cl) mapped = mapped.filter(x => !x.eps || x.eps < o.cl);
      if (o.cg) mapped = mapped.filter(x => x.eps > o.cg);
    }
    return mapped;
  }
}

// Прямой одиночный запрос к Shikimori GraphQL без каскадных повторов (для Primary-First водопада каталога)
async function _shikiDirectOnly(search, type, o = {}, extSignal = null) {
  if (typeof isShikiGraphQLBlockedNow === 'function' && isShikiGraphQLBlockedNow()) return [];
  if (extSignal && extSignal.aborted) return [];
  const isAnime = type === 'ANIME';
  const isNovel = o.format === 'NOVEL';
  const field = isAnime ? 'animes' : 'mangas';
  const typeDefs = isAnime
    ? '$page:PositiveInt,$limit:PositiveInt,$order:OrderEnum,$kind:AnimeKindString,$status:AnimeStatusString,$season:SeasonString,$score:Int,$genre:String,$censored:Boolean,$search:String,$ids:String'
    : '$page:PositiveInt,$limit:PositiveInt,$order:OrderEnum,$kind:MangaKindString,$status:MangaStatusString,$season:SeasonString,$score:Int,$genre:String,$censored:Boolean,$search:String,$ids:String';
  const argPass = 'page:$page,limit:$limit,order:$order,kind:$kind,status:$status,season:$season,score:$score,genre:$genre,censored:$censored,search:$search,ids:$ids';
  const extraFields = isAnime
    ? 'episodes episodesAired duration origin rating studios{name} videos{url kind}'
    : 'chapters volumes publishers{name}';
  const gql = `query(${typeDefs}){${field}(${argPass}){id malId name russian english japanese synonyms kind status score airedOn{year month day} releasedOn{year month day} isCensored genres{id name russian} description poster{originalUrl mainUrl} ${extraFields}}}`;

  const incAll = [...(o.genre || []), ...(o.tag || [])];
  const hasYuri = incAll.some(t => t === 'Yuri' || t === "Girls' Love" || t === 'Girls Love' || t === 'Shoujo Ai');
  const hasYaoi = incAll.some(t => t === 'Yaoi' || t === "Boys' Love" || t === 'Boys Love' || t === 'Shounen Ai');
  const queryHint = { queriedYuri: hasYuri, queriedYaoi: hasYaoi };
  let optsList = [o];
  if (hasYuri || hasYaoi) {
    const expandPair = (optsArr, targets, primary, alt) => optsArr.flatMap(cur => {
      const replaceNames = arr => (arr || []).map(x => targets.includes(x) ? primary : x);
      const replaceNamesAlt = arr => (arr || []).map(x => targets.includes(x) ? alt : x);
      return [
        { ...cur, genre: replaceNames(cur.genre), tag: replaceNames(cur.tag) },
        { ...cur, genre: replaceNamesAlt(cur.genre), tag: replaceNamesAlt(cur.tag) }
      ];
    });
    if (hasYuri) optsList = expandPair(optsList, ['Yuri', "Girls' Love", 'Girls Love', 'Shoujo Ai'], "Girls' Love", 'Yuri');
    if (hasYaoi) optsList = expandPair(optsList, ['Yaoi', "Boys' Love", 'Boys Love', 'Shounen Ai'], "Boys' Love", 'Yaoi');
  }

  const lists = await Promise.all(optsList.map(async optItem => {
    const vars = buildShikiGraphQLVars(search, type, optItem);
    const data = await shikiGraphQL(gql, vars, extSignal);
    const list = data?.[field];
    return Array.isArray(list) ? list.map(d => mapShikimoriGraphQLNode(d, type, isNovel, queryHint)) : [];
  }));
  let mapped = lists.length === 1 ? lists[0] : interleaveAndDedupCatalogLists(lists);
  if (!isAnime) await resolveSuspiciousShikiMangaGenres(mapped, extSignal);
  if (isAnime) {
    if (o.el) mapped = mapped.filter(x => !x.eps || x.eps < o.el);
    if (o.eg) mapped = mapped.filter(x => x.eps > o.eg);
  } else {
    if (o.cl) mapped = mapped.filter(x => !x.eps || x.eps < o.cl);
    if (o.cg) mapped = mapped.filter(x => x.eps > o.cg);
  }
  return mapped;
}

function normalizeAniListGenresAndTags(o = {}) {
  const isYuriKey = s => s === 'Yuri' || s === "Girls' Love" || s === 'Girls Love';
  const isYaoiKey = s => s === 'Yaoi' || s === "Boys' Love" || s === 'Boys Love';
  const mapTagName = s => isYuriKey(s) ? 'Yuri' : isYaoiKey(s) ? "Boys' Love" : s;

  const g = [], tg = [];
  (o.genre || []).forEach(x => {
    if (isYuriKey(x) || isYaoiKey(x)) tg.push(mapTagName(x));
    else g.push(x);
  });
  (o.tag || []).forEach(x => tg.push(mapTagName(x)));

  const gn = [], tgn = [];
  (o.genreNot || []).forEach(x => {
    if (isYuriKey(x) || isYaoiKey(x)) tgn.push(mapTagName(x));
    else gn.push(x);
  });
  (o.tagNot || []).forEach(x => tgn.push(mapTagName(x)));

  return {
    g: g.length ? [...new Set(g)] : undefined,
    gn: gn.length ? [...new Set(gn)] : undefined,
    tg: tg.length ? [...new Set(tg)] : undefined,
    tgn: tgn.length ? [...new Set(tgn)] : undefined
  };
}

async function _anilistRaw(search, type, o = {}) {
  const origSearch = search;
  // Если AniList недоступен (заблокирован без VPN) — мгновенно идём в Shikimori GraphQL + Jikan v4!
  if (isAniListBlockedNow()) {
    return await _shikiCatalogFallback(origSearch || '', type, o);
  }

  if (hasRu(search)) {
    let en = findCachedEnForRuQuery(search, type);
    if (!en) {
      try {
        const field = type === 'ANIME' ? 'animes' : 'mangas';
        const qSh = `query($s:String,$c:Boolean){${field}(search:$s,limit:3,censored:$c){id name}}`;
        const dSh = await shikiGraphQL(qSh, { s: search, c: o.ad === false });
        if (dSh?.[field]?.[0]?.name) en = dSh[field][0].name;
      } catch (e) {}
    }
    if (!en) { try { en = await ruToEn(search); } catch (e) {} }
    if (!en) { try { en = await ruToEnTranslate(search); } catch (e) {} }
    if (en) search = en;
  }
  const { g, gn, tg, tgn } = normalizeAniListGenresAndTags(o);
  const gql = 'query($s:String,$id:Int,$idMal:Int,$idMalIn:[Int],$t:MediaType,$p:Int,$pp:Int,$so:[MediaSort],$st:MediaStatus,$f:MediaFormat,$fn:MediaFormat,$c:CountryCode,$ad:Boolean,$pg:Int,$g:[String],$gn:[String],$sg:FuzzyDateInt,$sl:FuzzyDateInt,$ag:Int,$pl:Int,$el:Int,$eg:Int,$cl:Int,$cg:Int,$se:MediaSeason,$sy:Int,$tg:[String],$tgn:[String]){Page(page:$p,perPage:$pp){media(search:$s,id:$id,idMal:$idMal,idMal_in:$idMalIn,type:$t,sort:$so,status:$st,format:$f,format_not:$fn,countryOfOrigin:$c,isAdult:$ad,popularity_greater:$pg,genre_in:$g,genre_not_in:$gn,startDate_greater:$sg,startDate_lesser:$sl,averageScore_greater:$ag,popularity_lesser:$pl,episodes_lesser:$el,episodes_greater:$eg,chapters_lesser:$cl,chapters_greater:$cg,season:$se,seasonYear:$sy,tag_in:$tg,tag_not_in:$tgn){id idMal isAdult format siteUrl countryOfOrigin bannerImage trailer{id site} title{romaji english native} synonyms coverImage{large} description(asHtml:false) startDate{year month day} endDate{year month day} nextAiringEpisode{episode} averageScore episodes duration chapters volumes genres tags{name rank isMediaSpoiler} status source studios(isMain:true){nodes{name}} staff(perPage:12){edges{role node{name{full}}}}}}}';
  try {
    const j = await fetchAniListGraphQL(gql, {s: search || undefined, id: o.id || undefined, idMal: o.idMal || undefined, idMalIn: o.idMalIn || undefined, t: type, p: o.page || 1, pp: o.per || 10, so: o.sort || ['SEARCH_MATCH'], st: o.status, f: o.format, fn: o.fn, c: o.country, ad: o.ad, pg: o.pg, g, gn, sg: o.sg, sl: o.sl, ag: o.ag, pl: o.pl, el: o.el, eg: o.eg, cl: o.cl, cg: o.cg, se: o.se, sy: o.sy, tg, tgn}, 2600);
    return (j.data?.Page?.media || []).map(m => mapAniListMediaNode(m, type));
  } catch (err) {
    if (!o.id) {
      const fbRes = await _shikiCatalogFallback(origSearch || search, type, o).catch(() => null);
      if (fbRes && fbRes.length) return fbRes;
    }
    throw err;
  }
}

// Прямой одиночный запрос к AniList GraphQL без каскадных повторов (для Primary-First водопада каталога)
async function _anilistDirectOnly(search, type, o = {}, extSignal = null) {
  if (isAniListBlockedNow()) return [];
  if (extSignal && extSignal.aborted) return [];
  if (hasRu(search)) {
    let en = findCachedEnForRuQuery(search, type);
    if (!en) {
      try {
        const field = type === 'ANIME' ? 'animes' : 'mangas';
        const qSh = `query($s:String,$c:Boolean){${field}(search:$s,limit:3,censored:$c){id name}}`;
        const dSh = await shikiGraphQL(qSh, { s: search, c: o.ad === false }, extSignal);
        if (dSh?.[field]?.[0]?.name) en = dSh[field][0].name;
      } catch (e) {}
    }
    if (!en) { try { en = await ruToEn(search); } catch (e) {} }
    if (!en) { try { en = await ruToEnTranslate(search); } catch (e) {} }
    if (en) search = en;
  }
  const { g, gn, tg, tgn } = normalizeAniListGenresAndTags(o);
  const gql = 'query($s:String,$id:Int,$idMal:Int,$idMalIn:[Int],$t:MediaType,$p:Int,$pp:Int,$so:[MediaSort],$st:MediaStatus,$f:MediaFormat,$fn:MediaFormat,$c:CountryCode,$ad:Boolean,$pg:Int,$g:[String],$gn:[String],$sg:FuzzyDateInt,$sl:FuzzyDateInt,$ag:Int,$pl:Int,$el:Int,$eg:Int,$cl:Int,$cg:Int,$se:MediaSeason,$sy:Int,$tg:[String],$tgn:[String]){Page(page:$p,perPage:$pp){media(search:$s,id:$id,idMal:$idMal,idMal_in:$idMalIn,type:$t,sort:$so,status:$st,format:$f,format_not:$fn,countryOfOrigin:$c,isAdult:$ad,popularity_greater:$pg,genre_in:$g,genre_not_in:$gn,startDate_greater:$sg,startDate_lesser:$sl,averageScore_greater:$ag,popularity_lesser:$pl,episodes_lesser:$el,episodes_greater:$eg,chapters_lesser:$cl,chapters_greater:$cg,season:$se,seasonYear:$sy,tag_in:$tg,tag_not_in:$tgn){id idMal isAdult format siteUrl countryOfOrigin bannerImage trailer{id site} title{romaji english native} synonyms coverImage{large} description(asHtml:false) startDate{year month day} endDate{year month day} nextAiringEpisode{episode} averageScore episodes duration chapters volumes genres tags{name rank isMediaSpoiler} status source studios(isMain:true){nodes{name}} staff(perPage:12){edges{role node{name{full}}}}}}}';
  const j = await fetchAniListGraphQL(gql, {s: search || undefined, id: o.id || undefined, idMal: o.idMal || undefined, idMalIn: o.idMalIn || undefined, t: type, p: o.page || 1, pp: o.per || 24, so: o.sort || ['POPULARITY_DESC'], st: o.status, f: o.format, fn: o.fn, c: o.country, ad: o.ad, pg: o.pg, g, gn, sg: o.sg, sl: o.sl, ag: o.ag, pl: o.pl, el: o.el, eg: o.eg, cl: o.cl, cg: o.cg, se: o.se, sy: o.sy, tg, tgn}, 2600, extSignal);
  return (j.data?.Page?.media || []).map(m => mapAniListMediaNode(m, type));
}

const getActiveTmdbKey = () => localStorage.getItem('tmdbKey') || DEFAULT_TMDB_KEY;

// Запрос к TMDB с автоматическим обходом блокировки в РФ без VPN через прокси при недоступности api.themoviedb.org
let _tmdbDirectBlocked = false;
async function fetchTmdbJson(targetUrl, timeoutMs = 4200) {
  const tryDirect = async () => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    try {
      const r = await fetch(targetUrl, { signal: c.signal });
      if (r.status === 401) {
        localStorage.removeItem('tmdbKey');
        throw new Error('ключ TMDB не подошёл');
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  };
  const tryProxy = async () => {
    const proxies = [
      'https://api.allorigins.win/raw?url=' + encodeURIComponent(targetUrl),
      'https://corsproxy.io/?' + encodeURIComponent(targetUrl),
      'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(targetUrl)
    ];
    return await Promise.any(proxies.map(pu => ruJson(pu, 6500)));
  };
  if (!_tmdbDirectBlocked) {
    try {
      return await tryDirect();
    } catch (e) {
      if (/ключ/.test(e.message)) throw e;
      _tmdbDirectBlocked = true;
      return await tryProxy();
    }
  }
  try {
    return await tryProxy();
  } catch (e) {
    _tmdbDirectBlocked = false;
    return await tryDirect();
  }
}

async function _tmdbRaw(search, path, media, page = 1) {
  const k = getActiveTmdbKey();
  const includeAdultTmdb = ($('cgAge')?.value || '') !== 'no';
  const targetUrl = path
    ? `https://api.themoviedb.org/3${path}${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(k)}&language=ru-RU&page=${page}`
    : `https://api.themoviedb.org/3/search/multi?api_key=${encodeURIComponent(k)}&language=ru-RU&include_adult=${includeAdultTmdb ? 'true' : 'false'}&query=${encodeURIComponent(search)}&page=${page}`;
  const j = await fetchTmdbJson(targetUrl);
  const nowMs = Date.now();
  const isReturningFilter = Boolean(path && path.includes('with_status=0'));
  return (j.results || []).map(x => ({...x, media_type: x.media_type || media})).filter(x => x.media_type === 'movie' || x.media_type === 'tv').slice(0, path ? 20 : 12).map(x => {
    const orig = x.original_title || x.original_name || '', ids = x.genre_ids || [];
    const relDateStr = x.release_date || x.first_air_date || '';
    const isUpc = Boolean(relDateStr && new Date(relDateStr).getTime() > nowMs);
    const p342 = x.poster_path ? 'https://image.tmdb.org/t/p/w342' + x.poster_path : '';
    const p500 = x.poster_path ? 'https://image.tmdb.org/t/p/w500' + x.poster_path : '';
    const originCountry = Array.isArray(x.origin_country) ? x.origin_country : [];
    const origLang = x.original_language || '';
    const isTmdbAnime = ids.includes(16) && (origLang === 'ja' || originCountry.includes('JP'));
    return {
      title: x.title || x.name, en: origLang === 'en' ? orig : '', orig, alt: '',
      isAdult: Boolean(x.adult),
      poster: p342,
      posterFallbacks: [p342, p500].filter(Boolean),
      banner: x.backdrop_path ? 'https://image.tmdb.org/t/p/w780' + x.backdrop_path : '',
      ongoing: Boolean(x.status === 'Returning Series' || x.status === 'In Production' || (x.media_type === 'tv' && isReturningFilter && !isUpc)),
      upcoming: isUpc,
      releaseStatus: x.status || (isUpc ? 'NOT_YET_RELEASED' : ''),
      year: relDateStr.slice(0, 4), ext: x.vote_count ? x.vote_average.toFixed(1) : '',
      tags: ids.map(g => TG[g]).filter(Boolean),
      tmdbGenreIds: ids,
      origLang,
      originCountry,
      isTmdbAnime,
      tmdb: x.media_type + '/' + x.id, src: 'TMDB', url: 'https://www.themoviedb.org/' + x.media_type + '/' + x.id, desc: x.overview || '',
      category: x.media_type === 'tv' ? 'Сериал' : 'Фильм'
    };
  });
}

const ALC = new Map();
function cached(fn) {
  return async (...a) => {
    const k = JSON.stringify(a), h = ALC.get(k);
    if (h && Date.now() - h.t < 6e5) return h.v.map(r => ({...r}));
    const v = await fn(...a);
    if (Array.isArray(v) && v.length) {
      ALC.set(k, {t: Date.now(), v});
      if (ALC.size > 100) ALC.delete(ALC.keys().next().value);
    }
    return Array.isArray(v) ? v.map(r => ({...r})) : [];
  };
}
const anilist = cached(_anilistRaw);
const tmdb = cached(_tmdbRaw);
const _tmdbDetailCache = new Map();

async function tmdbInfo(r) {
  if (!r || !r.tmdb) return {};
  if (_tmdbDetailCache.has(r.tmdb)) return { ..._tmdbDetailCache.get(r.tmdb) };
  const k = getActiveTmdbKey();
  const d = await fetchTmdbJson(`https://api.themoviedb.org/3/${r.tmdb}?api_key=${encodeURIComponent(k)}&language=ru-RU&append_to_response=credits,videos,external_ids&include_video_language=ru,en,null`);
  const dir = (d.credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name), by = (d.created_by || []).map(c => c.name);
  const castNames = (d.credits?.cast || []).slice(0, 6).map(c => c.name).filter(Boolean).join(', ');
  const vids = (d.videos?.results || []).filter(v => String(v.site || '').toLowerCase() === 'youtube');
  const pickedVid = vids.find(v => v.type === 'Trailer' && v.iso_639_1 === 'ru')
    || vids.find(v => v.type === 'Trailer' && v.official)
    || vids.find(v => v.type === 'Trailer')
    || vids[0];
  const trailerId = cleanYoutubeId(pickedVid?.key);
  const seasonsMeta = Array.isArray(d.seasons)
    ? d.seasons
        .filter(s => Number(s.season_number) > 0 && Number(s.episode_count) > 0)
        .map(s => ({ n: Number(s.season_number), eps: Number(s.episode_count) }))
        .sort((a, b) => a.n - b.n)
    : [];
  const originCountry = Array.isArray(d.origin_country) ? d.origin_country : [];
  const origLang = d.original_language || '';
  const genreIds = Array.isArray(d.genres) ? d.genres.map(g => Number(g.id)).filter(Boolean) : [];
  const isTmdbAnime = genreIds.includes(16) && (origLang === 'ja' || originCountry.includes('JP'));
  const out = {
    author: [...new Set([...by, ...dir])].slice(0, 2).join(', '),
    studio: (d.production_companies || []).slice(0, 2).map(c => c.name).join(', '),
    cast: castNames,
    countries: (d.production_countries || []).map(c => c.name).filter(Boolean).slice(0, 3).join(', '),
    ongoing: d.status === 'Returning Series' || d.status === 'In Production',
    dur: d.runtime || (d.episode_run_time || [])[0] || (d.last_episode_to_air?.runtime || 0) || 0,
    eps: d.number_of_episodes || (seasonsMeta.length ? seasonsMeta.reduce((s, x) => s + x.eps, 0) : 0),
    seasons: d.number_of_seasons || seasonsMeta.length || 0,
    seasonsMeta: seasonsMeta.length ? seasonsMeta : undefined,
    tmdbGenreIds: genreIds.length ? genreIds : undefined,
    origLang,
    originCountry: originCountry.length ? originCountry : undefined,
    isTmdbAnime,
    trailerId,
    imdbId: d.external_ids?.imdb_id || '',
    endDate: d.last_air_date || '',
    endYear: d.last_air_date ? String(d.last_air_date).slice(0, 4) : '',
    banner: d.backdrop_path ? 'https://image.tmdb.org/t/p/w780' + d.backdrop_path : ''
  };
  if (d.overview && (!r.desc || !hasRu(r.desc))) out.desc = d.overview;
  if (Array.isArray(d.genres) && d.genres.length) out.tags = d.genres.map(g => g.name || TG[g.id]).filter(Boolean);
  if (d.vote_count && d.vote_average) out.ext = d.vote_average.toFixed(1);
  _tmdbDetailCache.set(r.tmdb, out);
  if (_tmdbDetailCache.size > 100) _tmdbDetailCache.delete(_tmdbDetailCache.keys().next().value);
  return { ...out };
}

function tmdbExtra(r) {
  const t = ++exTok;
  return exP = (async () => {
    const x = await tmdbInfo(r);
    if (t !== exTok) return;
    if (!$('inputAuthor').value.trim()) $('inputAuthor').value = x.author || '';
    if (!$('inputStudio').value.trim()) $('inputStudio').value = x.studio || '';
    if (x.ongoing) $('inputOngoing').checked = true;
    if (x.dur && !$('inputDur').value) $('inputDur').value = x.dur;
    if (x.eps && !$('inputEps').value) $('inputEps').value = x.eps;
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

// Поиск тайтлов выполняется напрямую через вкладку «Каталог»

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
  return item.status === 'Просмотрено/Прочитано' || item.status === 'Пересматриваю';
}

// Фоновое связывание коллекции с каталогом объявлено ниже в блоке управления данными

// ---------- Статистика и блоки Профиля ----------
const MON = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'], PAL = ['#7c5cff','#38bdf8','#10b981','#f59e0b','#ec4899','#ef4444'];
function topBy(f) { const c = {}; getVisibleItems().forEach(i => f(i).forEach(x => c[x] = (c[x] || 0) + 1)); return Object.entries(c).sort((a, b) => b[1] - a[1]); }

function computeProgressChartData(visList, nowMs = Date.now()) {
  const list = Array.isArray(visList) ? visList.filter(Boolean) : [];
  const catDefs = [
    { key: 'Аниме', label: 'Аниме', color: '#7c5cff', match: i => i.category === 'Аниме' },
    { key: 'Кино и сериалы', label: 'Фильмы и сериалы', color: '#38bdf8', match: i => (typeof KINO !== 'undefined' ? KINO : ['Фильм', 'Сериал', 'Мультфильм']).includes(i.category) },
    { key: 'Манга', label: 'Манга', color: '#f59e0b', match: i => i.category === 'Манга' },
    { key: 'Ранобэ', label: 'Ранобэ', color: '#ec4899', match: i => i.category === 'Ранобэ' }
  ];
  const categories = catDefs.map(def => {
    const sub = list.filter(def.match);
    const done = sub.filter(isCompletedItem).length;
    const total = sub.length;
    return {
      key: def.key,
      label: def.label,
      color: def.color,
      done,
      total,
      pct: total ? Math.round((done / total) * 100) : 0
    };
  });
  const totalCount = list.length;
  const totalDone = list.filter(isCompletedItem).length;
  const totalPct = totalCount ? Math.round((totalDone / totalCount) * 100) : 0;

  const baseDate = new Date(nowMs);
  const months = [];
  const monthMap = new Map();
  for (let offset = 5; offset >= 0; offset--) {
    const d = new Date(baseDate.getFullYear(), baseDate.getMonth() - offset, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const bucket = {
      key,
      label: MON[d.getMonth()] || '',
      year: d.getFullYear(),
      added: 0,
      completed: 0
    };
    months.push(bucket);
    monthMap.set(key, bucket);
  }
  const toMonthKey = ts => {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return '';
    const d = new Date(n);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  list.forEach(it => {
    const addTs = Number(it.addedAt) || (typeof born === 'function' ? born(it) : 0);
    const addKey = toMonthKey(addTs);
    if (addKey && monthMap.has(addKey)) monthMap.get(addKey).added++;
    if (isCompletedItem(it)) {
      const compTs = Number(it.completedAt) || Number(it.updatedAt) || addTs;
      const compKey = toMonthKey(compTs);
      if (compKey && monthMap.has(compKey)) monthMap.get(compKey).completed++;
    }
  });
  const maxMonthVal = Math.max(1, ...months.map(m => Math.max(m.added, m.completed)));
  return { categories, months, maxMonthVal, totalCount, totalDone, totalPct };
}

function buildProgressChartNode(visList) {
  const data = computeProgressChartData(visList);
  if (!data.totalCount) {
    return el('div', 'meta', 'Добавь тайтлы в коллекцию, чтобы увидеть график прогресса.');
  }
  const wrap = el('div', 'progress-chart-box');

  const catPanel = el('div', 'prog-panel');
  const catHdr = el('div', 'prog-panel-title');
  const catCountMeta = el('span', 'meta', `${data.totalDone} / ${data.totalCount} (${data.totalPct}%)`);
  catCountMeta.style.margin = '0';
  catHdr.append(el('span', null, 'Завершение по категориям'), catCountMeta);
  const catList = el('div', 'prog-cat-list');

  const rowsToRender = [
    ...data.categories.filter(c => c.total > 0),
    { key: 'all', label: 'Общий прогресс', color: '#10b981', done: data.totalDone, total: data.totalCount, pct: data.totalPct }
  ];
  rowsToRender.forEach(row => {
    const rEl = el('div', 'prog-cat-row');
    const meta = el('div', 'prog-cat-meta');
    meta.append(el('span', null, row.label), el('b', null, `${row.done} / ${row.total} (${row.pct}%)`));
    const track = el('div', 'prog-bar-track');
    const fill = el('div', 'prog-bar-fill');
    fill.style.width = `${row.pct}%`;
    fill.style.background = row.color;
    track.append(fill);
    rEl.append(meta, track);
    catList.append(rEl);
  });
  catPanel.append(catHdr, catList);

  const actPanel = el('div', 'prog-panel');
  const actHdr = el('div', 'prog-panel-title');
  const actSub = el('span', 'meta', 'за 6 месяцев');
  actSub.style.margin = '0';
  actHdr.append(el('span', null, 'Динамика активности'), actSub);

  const svgWrap = el('div', 'prog-svg-wrap');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'prog-svg-chart');
  svg.setAttribute('viewBox', '0 0 320 150');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'График активности за последние 6 месяцев');

  const topPad = 18;
  const chartBottom = 124;
  const chartHeight = chartBottom - topPad;
  [0, 0.5, 1].forEach(ratio => {
    const y = Math.round(chartBottom - chartHeight * ratio) + 0.5;
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', '8');
    line.setAttribute('x2', '312');
    line.setAttribute('y1', String(y));
    line.setAttribute('y2', String(y));
    line.setAttribute('stroke', ratio === 0 ? 'rgba(148,163,184,0.35)' : 'rgba(148,163,184,0.14)');
    line.setAttribute('stroke-width', '1');
    svg.appendChild(line);
  });

  const colW = 300 / data.months.length;
  data.months.forEach((m, idx) => {
    const cx = 10 + colW * idx + colW / 2;
    const barW = 13;
    const gap = 4;
    const addH = m.added ? Math.max(4, Math.round((m.added / data.maxMonthVal) * chartHeight)) : 2;
    const compH = m.completed ? Math.max(4, Math.round((m.completed / data.maxMonthVal) * chartHeight)) : 2;

    const g = document.createElementNS(ns, 'g');
    const titleEl = document.createElementNS(ns, 'title');
    titleEl.textContent = `${m.label} ${m.year}: добавлено ${m.added}, завершено ${m.completed}`;
    g.appendChild(titleEl);

    const rectAdd = document.createElementNS(ns, 'rect');
    rectAdd.setAttribute('class', 'prog-svg-bar');
    rectAdd.setAttribute('x', String(Math.round(cx - barW - gap / 2)));
    rectAdd.setAttribute('y', String(chartBottom - addH));
    rectAdd.setAttribute('width', String(barW));
    rectAdd.setAttribute('height', String(addH));
    rectAdd.setAttribute('rx', '3');
    rectAdd.setAttribute('fill', '#7c5cff');
    rectAdd.setAttribute('fill-opacity', m.added ? '0.82' : '0.18');
    g.appendChild(rectAdd);

    const rectComp = document.createElementNS(ns, 'rect');
    rectComp.setAttribute('class', 'prog-svg-bar');
    rectComp.setAttribute('x', String(Math.round(cx + gap / 2)));
    rectComp.setAttribute('y', String(chartBottom - compH));
    rectComp.setAttribute('width', String(barW));
    rectComp.setAttribute('height', String(compH));
    rectComp.setAttribute('rx', '3');
    rectComp.setAttribute('fill', '#10b981');
    rectComp.setAttribute('fill-opacity', m.completed ? '0.92' : '0.18');
    g.appendChild(rectComp);

    const topCount = Math.max(m.added, m.completed);
    if (topCount > 0) {
      const valTxt = document.createElementNS(ns, 'text');
      valTxt.setAttribute('x', String(Math.round(cx)));
      valTxt.setAttribute('y', String(Math.max(11, chartBottom - Math.max(addH, compH) - 4)));
      valTxt.setAttribute('text-anchor', 'middle');
      valTxt.setAttribute('font-size', '10');
      valTxt.setAttribute('font-weight', '700');
      valTxt.setAttribute('fill', 'currentColor');
      valTxt.textContent = `${m.added}/${m.completed}`;
      g.appendChild(valTxt);
    }

    const lbl = document.createElementNS(ns, 'text');
    lbl.setAttribute('x', String(Math.round(cx)));
    lbl.setAttribute('y', '142');
    lbl.setAttribute('text-anchor', 'middle');
    lbl.setAttribute('font-size', '10.5');
    lbl.setAttribute('fill', '#94a3b8');
    lbl.textContent = m.label;
    g.appendChild(lbl);

    svg.appendChild(g);
  });

  const legend = el('div', 'prog-chart-legend');
  const legAdd = el('span');
  const dotAdd = el('i');
  dotAdd.style.background = '#7c5cff';
  legAdd.append(dotAdd, document.createTextNode('Добавлено'));
  const legComp = el('span');
  const dotComp = el('i');
  dotComp.style.background = '#10b981';
  legComp.append(dotComp, document.createTextNode('Завершено'));
  legend.append(legAdd, legComp);

  svgWrap.append(svg, legend);
  actPanel.append(actHdr, svgWrap);
  wrap.append(catPanel, actPanel);
  return wrap;
}

function buildStats(b) {
  const vis = getVisibleItems();
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
    { label: 'Отложено', count: vis.filter(i => i.status === 'Отложено').length, color: '#f59e0b' },
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

  const progWrap = el('div', 'anix-sec-card');
  progWrap.style.margin = '10px 0';
  progWrap.append(el('h4', null, '📈 График прогресса'), buildProgressChartNode(vis));
  b.append(progWrap);

  const addSection = (title, rows) => {
    if (!rows.length) return;
    const det = el('details', 'stats-acc');
    const sum = el('summary', 'stats-acc-sum');
    const meta = el('span', 'stats-acc-meta');
    meta.append(el('span', 'stats-acc-cnt', String(rows.length)), el('span', 'stats-acc-chev', '▸'));
    sum.append(el('span', null, title), meta);
    const body = el('div', 'stats-acc-body');
    rows.forEach(([label, valText]) => {
      const r = el('div', 'sr');
      r.append(el('span', null, label), el('span', 'sr-val', valText));
      body.append(r);
    });
    det.append(sum, body);
    b.append(det);
  };

  // 1. По типам (Аниме, Фильмы, Сериалы, Манга, Ранобэ): точное количество штук цифрами и средняя оценка
  const typeRows = typeDefs.map(td => {
    const arr = vis.filter(td.flt);
    return [td.label, `${arr.length} шт. · ср. оценка: ${avgMine(arr)}`];
  });
  addSection('По типам (количество и средняя оценка)', typeRows);

  // 2. По статусам (В планах, Смотрю, Просмотрено, Отложено, Брошено, Любимое): точное количество штук и доля в %
  const favCount = vis.filter(i => i.fav).length;
  const rewatchingCount = vis.filter(i => i.status === 'Пересматриваю').length;
  const statusRows = [
    ['В планах', statusEntries[0].count],
    ['Смотрю / Читаю', vis.filter(i => i.status === 'Смотрю/Читаю').length],
    ['Просмотрено / Прочитано', statusEntries[2].count],
    ['Отложено', statusEntries[3].count],
    ['Пересматриваю', rewatchingCount],
    ['Брошено', statusEntries[4].count],
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
    .filter(i => i.fav)
    .sort((a, b) => (num(b.rating) || num(b.extRating)) - (num(a.rating) || num(a.extRating)))
    .slice(0, 18);

  if (favList.length) {
    const card = el('div', 'anix-sec-card');
    card.style.marginBottom = '10px';
    card.append(el('h4', 'sec', `❤ Любимые произведения (${favList.length})`));
    const w = el('div', 'strip');
    favList.forEach(i => {
      const m = el('div', 'mini'), im = el('img');
      im.loading = 'lazy'; applyPosterImg(im, i.poster, i);
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
      im.loading = 'lazy'; applyPosterImg(im, fc.img, null);
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
  const activeCount = vis.length;
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
  if (ongOnly) add('Онгоинг', () => { ongOnly = false; $('ongBtn')?.classList.remove('on'); render(); });
  if (finOnly) add('Завершено', () => { finOnly = false; $('finBtn')?.classList.remove('on'); render(); });
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
    if (typeof syncItemProgressOnStatusChange === 'function') syncItemProgressOnStatusChange(i, v);
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
  const hiddenNote = hiddenSelectedCount > 0
    ? `⚠ Внимание: из выбранных сейчас НЕ видно на экране (скрыто фильтрами): ${hiddenSelectedCount} шт.\n\nЧтобы подтвердить удаление, введи число ${toDelete.length}:`
    : `Все выбранные тайтлы видны в текущем списке.\nЧтобы подтвердить удаление, введи число ${toDelete.length}:`;
  const typedCount = await uiPrompt(
    `Удаление ${toDelete.length} тайтлов`,
    '',
    String(toDelete.length),
    hiddenNote
  );
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
const cg = {g: 'Аниме', page: 1, q: '', t: 0, hide: false, ongOnly: false, finOnly: false, min: 0, feedSeedPage: 1}, cgGrid = $('cgGrid');
let _cgLookupIdx = null;
let _cgLookupCount = -1;
function getCatalogLookupIndex(forceRebuild = false) {
  if (forceRebuild || !_cgLookupIdx || _cgLookupCount !== items.length) {
    _cgLookupIdx = buildCollectionLookupIndex(items);
    _cgLookupCount = items.length;
  }
  return _cgLookupIdx;
}
const has = r => Boolean(findInCollectionWithIndex(r, getCatalogLookupIndex()));
const cgKey = r => r.url || r.title + '|' + r.category;
try { localStorage.removeItem('cgHid'); localStorage.removeItem('cgTagStateV2'); } catch (e) {}

// Кэш готовых страниц каталога (10 мин) + AbortController и дебаунс тегов
const _cgPageCache = (typeof window !== 'undefined' && window.KirokuEngine && window.KirokuEngine.createCatalogCache)
  ? window.KirokuEngine.createCatalogCache(600000, 60)
  : null;
let _cgAbortCtrl = null;
let _cgTagDebounceTimer = null;
function scheduleCgLoad(delayMs = 320) {
  clearTimeout(_cgTagDebounceTimer);
  _cgTagDebounceTimer = setTimeout(() => {
    _cgTagDebounceTimer = null;
    cgLoad(true);
  }, delayMs);
}

// Состояние кликабельных жанров и тегов: Map(key -> 1 (включить, зелёный) | -1 (исключить, красный))
const cgTagState = new Map();

function isCatalogItemFinished(r) {
  if (!r) return false;
  if (r.ongoing || r.upcoming) return false;
  const rawSt = String(r.releaseStatus || '').trim().toUpperCase();
  if (rawSt) {
    if (['RELEASING', 'ONGOING', 'AIRING', 'PUBLISHING', 'NOT_YET_RELEASED', 'ANONS', 'UPCOMING', 'HIATUS', 'PLANNED', 'IN PRODUCTION', 'RETURNING SERIES', 'CURRENTLY AIRING', 'NOT YET AIRED', 'NOT YET PUBLISHED'].includes(rawSt)) {
      return false;
    }
  }
  if (typeof getItemReleaseState === 'function') {
    return getItemReleaseState(r) === 'finished';
  }
  return true;
}

const cgPass = r => !(cg.hide && has(r)) && (!cg.ongOnly || r.ongoing) && (!cg.finOnly || isCatalogItemFinished(r)) && num(r.ext) >= cg.min;

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
  "Yuri": ["Yuri", "Girls' Love", "Girls Love", "Shoujo Ai", "Юри", "Сёдзё-ай", "Сёдзе-ай", "Юри / Сёдзё-ай", "Юри / Сёдзё-ай (Girls’ Love)", "Юри (Yuri / Сёдзё-ай)", "Юри (Yuri — женская любовь)"],
  "Girls' Love": ["Yuri", "Girls' Love", "Girls Love", "Shoujo Ai", "Юри", "Сёдзё-ай", "Сёдзе-ай", "Юри / Сёдзё-ай", "Юри / Сёдзё-ай (Girls’ Love)", "Юри (Yuri / Сёдзё-ай)", "Юри (Yuri — женская любовь)"],
  "Girls Love": ["Yuri", "Girls' Love", "Girls Love", "Shoujo Ai", "Юри", "Сёдзё-ай", "Сёдзе-ай", "Юри / Сёдзё-ай", "Юри / Сёдзё-ай (Girls’ Love)", "Юри (Yuri / Сёдзё-ай)", "Юри (Yuri — женская любовь)"],
  "Shoujo Ai": ["Yuri", "Girls' Love", "Girls Love", "Shoujo Ai", "Юри", "Сёдзё-ай", "Сёдзе-ай", "Юри / Сёдзё-ай", "Юри / Сёдзё-ай (Girls’ Love)", "Юри (Yuri / Сёдзё-ай)", "Юри (Yuri — женская любовь)"],
  "Yaoi": ["Yaoi", "Boys' Love", "Boys Love", "Shounen Ai", "Яой", "Сёнен-ай", "Сёнэн-ай", "Яой / Сёнэн-ай", "Яой / Сёнэн-ай (Boys’ Love)", "Яой (Yaoi / Сёнэн-ай)", "Яой (Yaoi — мужская любовь)"],
  "Boys' Love": ["Yaoi", "Boys' Love", "Boys Love", "Shounen Ai", "Яой", "Сёнен-ай", "Сёнэн-ай", "Яой / Сёнэн-ай", "Яой / Сёнэн-ай (Boys’ Love)", "Яой (Yaoi / Сёнэн-ай)", "Яой (Yaoi — мужская любовь)"],
  "Boys Love": ["Yaoi", "Boys' Love", "Boys Love", "Shounen Ai", "Яой", "Сёнен-ай", "Сёнэн-ай", "Яой / Сёнэн-ай", "Яой / Сёнэн-ай (Boys’ Love)", "Яой (Yaoi / Сёнэн-ай)", "Яой (Yaoi — мужская любовь)"],
  "Shounen Ai": ["Yaoi", "Boys' Love", "Boys Love", "Shounen Ai", "Яой", "Сёнен-ай", "Сёнэн-ай", "Яой / Сёнэн-ай", "Яой / Сёнэн-ай (Boys’ Love)", "Яой (Yaoi / Сёнэн-ай)", "Яой (Yaoi — мужская любовь)"],
  "Gore": ["Gore", "Violence", "Graphic Violence", "Жестокость (гор)", "Жестокость и насилие"],
  "Drugs": ["Drugs", "Narcotics", "Наркотики"]
};
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
  const adult = ($('cgAge')?.value || '') !== 'no';
  const flt = arr => arr.filter(([v]) => (adult || v !== 'g:Hentai' || cgTagState.has(v)));
  const groupRomance = [
    ['g:Romance', 'Романтика'],
    ['t:Harem', 'Гарем'],
    ['t:Reverse Harem', 'Обратный гарем'],
    ['t:Love Triangle', 'Любовный треугольник'],
    ['t:Unrequited Love', 'Безответная любовь'],
    ['t:Age Gap', 'Разница в возрасте (Age Gap)'],
    ['t:Marriage', 'Брак / Семейные узы'],
    ['t:Cohabitation', 'Совместная жизнь'],
    ['t:Yuri', 'Юри (Yuri / Сёдзё-ай)'],
    ['t:Yaoi', 'Яой (Yaoi / Сёнэн-ай)'],
    ['t:Tsundere', 'Цундере'],
    ['t:Yandere', 'Яндере'],
    ['g:Ecchi', 'Этти'],
    ['g:Hentai', 'Хентай (18+)']
  ];
  const groupAction = [
    ['g:Action', 'Экшен'],
    ['g:Adventure', 'Приключения'],
    ['g:Fantasy', 'Фэнтези'],
    ['g:Sci-Fi', 'Научная фантастика'],
    ['g:Supernatural', 'Сверхъестественное'],
    ['t:Magic', 'Магия (Magic)'],
    ['t:Isekai', 'Исэкай'],
    ['t:Reincarnation', 'Реинкарнация'],
    ['g:Mecha', 'Меха'],
    ['t:Military', 'Военное'],
    ['t:Space', 'Космос'],
    ['t:Cyberpunk', 'Киберпанк'],
    ['t:Post-Apocalyptic', 'Постапокалипсис'],
    ['t:Time Travel', 'Путешествия во времени'],
    ['t:Vampire', 'Вампиры'],
    ['t:Demons', 'Демоны'],
    ['t:Dragons', 'Драконы'],
    ['t:Elf', 'Эльфы'],
    ['t:Witch', 'Ведьмы'],
    ['t:Mythology', 'Мифология']
  ];
  const groupThriller = [
    ['g:Drama', 'Драма'],
    ['g:Thriller', 'Триллер'],
    ['g:Mystery', 'Детектив (Мистика)'],
    ['t:Detective', 'Детективное расследование'],
    ['g:Psychological', 'Психология'],
    ['g:Horror', 'Ужасы'],
    ['t:Crime', 'Криминал и мафия'],
    ['t:Yakuza', 'Якудза'],
    ['t:Survival', 'Выживание'],
    ['t:Revenge', 'Месть'],
    ['t:Tragedy', 'Трагедия'],
    ['t:Death Game', 'Игра на выживание'],
    ['t:Gore', 'Жестокость и насилие (Gore)'],
    ['t:Anti-Hero', 'Антигерой'],
    ['t:Slavery', 'Рабство (Slavery)'],
    ['t:Drugs', 'Наркотики (Drugs)'],
    ['t:Bullying', 'Буллинг / Травля'],
    ['t:Body Horror', 'Боди-хоррор'],
    ['t:Amnesia', 'Амнезия']
  ];
  const groupSlice = [
    ['g:Comedy', 'Комедия'],
    ['g:Slice of Life', 'Повседневность'],
    ['t:School', 'Школа'],
    ['g:Sports', 'Спорт'],
    ['g:Music', 'Музыка'],
    ['g:Mahou Shoujo', 'Махо-сёдзё'],
    ['t:Iyashikei', 'Ийясикэй (Умиротворение)'],
    ['t:Animals', 'Животные (Animals)'],
    ['t:Idol', 'Айдолы'],
    ['t:Video Games', 'Видеоигры'],
    ['t:Monster Girl', 'Монстро-девочки']
  ];
  const groupDemo = [
    ['t:Shounen', 'Демография: Сёнэн'],
    ['t:Seinen', 'Демография: Сэйнэн'],
    ['t:Shoujo', 'Демография: Сёдзё'],
    ['t:Josei', 'Демография: Дзёсэй']
  ];
  return [
    ['Романтика и отношения', flt(groupRomance)],
    ['Экшен и приключения', flt(groupAction)],
    ['Триллер, криминал и драма', flt(groupThriller)],
    ['Повседневность и комедия', flt(groupSlice)],
    ['Демография и дополнительные теги', flt(groupDemo)]
  ].filter(([, list]) => list.length > 0);
}

// Выпадающие кнопки выбора категории и подкатегории в каталоге (с открытием при наведении и клике)
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

  // Дополнительный выпадающий фильтр подкатегорий (Вид аниме / Вид фильмов и сериалов / Вид манги) с открытием при наведении
  let subConfig = null;
  if (curNorm === 'Аниме' && $('cgAnimeKind')) {
    subConfig = {
      selectEl: $('cgAnimeKind'),
      prefix: 'Вид аниме',
      options: [
        ['', 'Все аниме'],
        ['TV', 'Аниме-сериалы (ТВ / OVA / ONA)'],
        ['MOVIE', 'Аниме-фильмы (Полнометражные)']
      ]
    };
  } else if (curNorm === 'Кино и сериалы' && $('cgVideoKind')) {
    subConfig = {
      selectEl: $('cgVideoKind'),
      prefix: 'Вид',
      options: [
        ['all', 'Все фильмы и сериалы'],
        ['movie', 'Только фильмы'],
        ['tv', 'Только сериалы']
      ]
    };
  } else if (curNorm === 'Манга' && $('cgKind')) {
    subConfig = {
      selectEl: $('cgKind'),
      prefix: 'Вид манги',
      options: [
        ['', 'Вся манга'],
        ['JP', 'Японская манга'],
        ['KR', 'Корейская манхва'],
        ['CN', 'Китайская маньхуа'],
        ['COMIC', 'Западные комиксы']
      ]
    };
  }

  if (subConfig) {
    const curSubVal = subConfig.selectEl.value;
    const curSubLbl = (subConfig.options.find(o => o[0] === curSubVal) || subConfig.options[0])[1];
    const subWrap = el('div', 'cat-dd-wrap');
    subWrap.id = 'cgSubKindDropdownWrap';
    const subBtn = el('button', 'cat-dd-btn', `${subConfig.prefix}: ${curSubLbl} ▾`);
    subBtn.id = 'cgSubKindDropdownBtn';
    subBtn.type = 'button';
    subBtn.onclick = e => {
      e.stopPropagation();
      if (subWrap.dataset.pinned === '1') {
        delete subWrap.dataset.pinned;
        subWrap.classList.remove('open', 'hover-hold');
      } else {
        subWrap.dataset.pinned = '1';
        subWrap.classList.add('open');
      }
    };
    const subMenu = el('div', 'cat-dd-menu');
    subConfig.options.forEach(([val, lbl]) => {
      const optBtn = el('button', curSubVal === val ? 'on' : '', lbl);
      optBtn.type = 'button';
      optBtn.onclick = e => {
        e.stopPropagation();
        delete subWrap.dataset.pinned;
        subWrap.classList.remove('open', 'hover-hold');
        subConfig.selectEl.value = val;
        cg.feedSeedPage = 1;
        updateActiveFiltersCounterUI();
        cgLoad(true);
      };
      subMenu.append(optBtn);
    });
    subWrap.append(subBtn, subMenu);
    bar.append(subWrap);
  }
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
  if (cg.g === 'Аниме' && $('cgAnimeKind')?.value) addChip(`Формат: ${$('cgAnimeKind').selectedOptions[0]?.textContent}`, () => { $('cgAnimeKind').value = ''; cgLoad(true); });
  if (cg.g === 'Кино и сериалы' && $('cgVideoKind')?.value && $('cgVideoKind').value !== 'all') addChip(`Тип: ${$('cgVideoKind').selectedOptions[0]?.textContent}`, () => { $('cgVideoKind').value = 'all'; cgLoad(true); });
  if (cg.g === 'Манга' && $('cgKind')?.value) addChip(`Вид: ${$('cgKind').selectedOptions[0]?.textContent}`, () => { $('cgKind').value = ''; cgLoad(true); });
  if ($('cgMode')?.value && $('cgMode').value !== 'actual') addChip(`Сортировка: ${$('cgMode').selectedOptions[0]?.textContent}`, () => { $('cgMode').value = 'actual'; cgLoad(true); });
  if ($('cgYear')?.value) addChip(`Год от: ${$('cgYear').value}`, () => { $('cgYear').value = ''; cgLoad(true); });
  if ($('cgYear2')?.value) addChip(`Год до: ${$('cgYear2').value}`, () => { $('cgYear2').value = ''; cgLoad(true); });
  if (cg.ongOnly) addChip('🟢 Только онгоинги', () => { cg.ongOnly = false; $('cgOngBtn')?.classList.remove('on'); updateActiveFiltersCounterUI(); cgLoad(true); });
  if (cg.finOnly) addChip('✓ Только завершённые', () => { cg.finOnly = false; $('cgFinBtn')?.classList.remove('on'); updateActiveFiltersCounterUI(); cgLoad(true); });
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
  if (chips.length >= 2) {
    const resetAll = el('button', 'chip cg-chip-reset-all', '✕ Сбросить все');
    resetAll.type = 'button';
    resetAll.onclick = () => $('cgReset')?.click();
    bar.append(resetAll);
  }
}

function syncCatalogSourceCaption(itemsSample = []) {
  const srcCap = $('cgSourceCaption');
  if (!srcCap) return;
  const isVideo = cg.g === 'Кино и сериалы' || cg.g === 'Фильм' || cg.g === 'Сериал';
  const modeLbl = $('cgMode')?.selectedOptions[0]?.textContent || 'Сейчас актуально';
  if (isVideo) {
    srcCap.textContent = `🌐 TMDB (${cg.g}) · ${modeLbl}${cg.feedSeedPage > 1 ? ` · лента #${cg.feedSeedPage}` : ''}`;
    return;
  }
  const srcSet = new Set();
  (itemsSample || []).forEach(x => {
    if (Array.isArray(x?.mergedSources) && x.mergedSources.length) x.mergedSources.forEach(s => srcSet.add(s));
    else if (x?.src) srcSet.add(x.src);
  });
  const aniLabel = srcSet.size
    ? [...srcSet].join(' + ')
    : (isAniListBlockedNow() ? 'Shikimori + Jikan' : 'AniList + Shikimori');
  srcCap.textContent = `🌐 ${aniLabel} (${cg.g}) · ${modeLbl}${cg.feedSeedPage > 1 ? ` · лента #${cg.feedSeedPage}` : ''}`;
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
  if (cg.ongOnly) totalActive++;
  if (cg.finOnly) totalActive++;
  if (cg.hide) totalActive++;
  if (cg.min > 0) totalActive++;
  if ($('cgKind')?.value && cg.g === 'Манга') totalActive++;
  if ($('cgAnimeKind')?.value && cg.g === 'Аниме') totalActive++;
  if ($('cgVideoKind')?.value && $('cgVideoKind').value !== 'all' && cg.g === 'Кино и сериалы') totalActive++;
  if ($('cgLen')?.value) totalActive++;
  if ($('cgAge')?.value && !isVideo) totalActive++;
  if ($('cgCountry')?.value && isVideo) totalActive++;
  if ($('cgActiveFiltersBadge')) $('cgActiveFiltersBadge').textContent = totalActive ? `(${totalActive})` : '';
  if ($('cgFltBtn')) $('cgFltBtn').dataset.cnt = String(totalActive);
  updateCatalogFilterBtnState();

  syncCatalogSourceCaption();
  renderCatalogSubKindBar();
  renderCatalogActiveChipsBar();
}

let _cgTagSearchQuery = '';
let _cgActiveTagTab = 'Популярные';

const POPULAR_ANI_TAG_KEYS = [
  'g:Action', 'g:Adventure', 'g:Comedy', 'g:Drama', 'g:Fantasy', 'g:Romance',
  'g:Mystery', 'g:Psychological', 'g:Thriller', 'g:Slice of Life', 'g:Sci-Fi',
  'g:Supernatural', 't:Isekai', 't:Reincarnation', 't:Magic', 't:School',
  't:Yuri', 't:Yaoi', 't:Harem', 't:Shounen', 't:Seinen', 't:Shoujo'
];
const POPULAR_VIDEO_TAG_IDS = ['28', '12', '35', '18', '14', '27', '9648', '10749', '878', '53', '80', '16', '10759', '10765'];

function cgGenres() {
  const isVideo = cg.g === 'Кино и сериалы' || cg.g === 'Фильм' || cg.g === 'Сериал';
  const baseGroups = isVideo
    ? [
        ['Основные жанры', [28, 12, 16, 35, 80, 18, 14, 27, 9648, 10749, 878, 53].map(k => [String(k), TG[k]]).filter(x => x[1])],
        ['Тематика и форматы', [99, 10751, 36, 10402, 10752, 37, 10759, 10765, 10768, 10762, 10764, 10766].map(k => [String(k), TG[k]]).filter(x => x[1])]
      ]
    : aniOptions().map(([title, list]) => {
        const shortMap = {
          'Романтика и отношения': 'Романтика и отношения',
          'Экшен и приключения': 'Экшен и фэнтези',
          'Триллер, криминал и драма': 'Драма и триллер',
          'Повседневность и комедия': 'Повседневность',
          'Демография и дополнительные теги': 'Демография и теги'
        };
        return [shortMap[title] || title, list];
      });

  const allUnique = [];
  const seenKeys = new Set();
  baseGroups.forEach(([, list]) => {
    list.forEach(([valKey, label]) => {
      if (!seenKeys.has(valKey)) {
        seenKeys.add(valKey);
        allUnique.push([valKey, label]);
      }
    });
  });

  const popList = (isVideo ? POPULAR_VIDEO_TAG_IDS : POPULAR_ANI_TAG_KEYS)
    .map(k => allUnique.find(([vk]) => vk === k))
    .filter(Boolean);

  const tabsData = [
    ['Все', allUnique],
    ['Популярные', popList.length ? popList : allUnique.slice(0, 16)],
    ...baseGroups
  ];

  if (!tabsData.some(([name]) => name === _cgActiveTagTab)) {
    _cgActiveTagTab = 'Популярные';
  }

  const panel = $('cgTagsPanel');
  if (panel) {
    panel.replaceChildren();
    const sWrap = el('div', 'cg-tags-search-wrap');
    const sInp = el('input', 'cg-tags-search');
    sInp.type = 'search';
    sInp.placeholder = 'Быстрый поиск жанра или тега (например: романтика, криминал, якудза, юри)…';
    sInp.value = _cgTagSearchQuery;
    const hintSpan = el('span', 'cg-tags-hint', '1 клик: ✓ включить · 2: ✕ исключить · 3: сброс');
    sWrap.append(sInp, hintSpan);

    const selectedStrip = el('div', 'cg-tags-selected-strip');
    const rebuildSelectedStrip = () => {
      selectedStrip.replaceChildren();
      const activePairs = allUnique
        .map(([valKey, label]) => ({ valKey, label, st: cgTagState.get(valKey) || 0 }))
        .filter(x => x.st !== 0);
      if (!activePairs.length) {
        selectedStrip.style.display = 'none';
        return;
      }
      selectedStrip.style.display = 'flex';
      selectedStrip.append(el('span', 'meta', 'Выбрано:'));
      activePairs.forEach(({ valKey, label, st }) => {
        const chip = el('button', 'cg-tchip', label);
        chip.type = 'button';
        chip.dataset.state = st === 1 ? 'inc' : 'exc';
        chip.title = 'Нажми, чтобы переключить (включить / исключить / убрать)';
        chip.onclick = () => {
          const next = st === 1 ? -1 : 0;
          if (next === 0) cgTagState.delete(valKey);
          else cgTagState.set(valKey, next);
          cgGenres();
          scheduleCgLoad(320);
        };
        selectedStrip.append(chip);
      });
    };

    const tabsRow = el('div', 'cg-tag-tabs');
    const chipsGrid = el('div', 'cg-tag-chips');
    const emptyMsg = el('div', 'meta', 'По этому запросу жанры и теги не найдены');
    emptyMsg.style.display = 'none';
    emptyMsg.style.padding = '8px 2px';

    const renderTabsAndChips = () => {
      const ql = _cgTagSearchQuery.trim().toLowerCase();
      tabsRow.style.display = ql ? 'none' : 'flex';

      tabsRow.replaceChildren();
      tabsData.forEach(([tabName, tabList]) => {
        const activeCnt = tabList.filter(([vk]) => (cgTagState.get(vk) || 0) !== 0).length;
        const btn = el('button', 'cg-tag-tab' + (_cgActiveTagTab === tabName ? ' on' : ''), tabName + (activeCnt ? ` (${activeCnt})` : ''));
        btn.type = 'button';
        btn.onclick = () => {
          _cgActiveTagTab = tabName;
          renderTabsAndChips();
        };
        tabsRow.append(btn);
      });

      const sourceList = ql
        ? allUnique.filter(([vk, lbl]) => lbl.toLowerCase().includes(ql) || vk.toLowerCase().includes(ql))
        : (tabsData.find(([name]) => name === _cgActiveTagTab)?.[1] || allUnique);

      chipsGrid.replaceChildren();
      emptyMsg.style.display = sourceList.length ? 'none' : '';
      sourceList.forEach(([valKey, label]) => {
        const b = el('button', 'cg-tchip', label);
        b.type = 'button';
        b.dataset.k = valKey;
        b.title = label;
        const st = cgTagState.get(valKey) || 0;
        if (st === 1) b.dataset.state = 'inc';
        else if (st === -1) b.dataset.state = 'exc';
        b.onclick = () => {
          const cur = cgTagState.get(valKey) || 0;
          const next = cur === 0 ? 1 : cur === 1 ? -1 : 0;
          if (next === 0) cgTagState.delete(valKey);
          else cgTagState.set(valKey, next);
          rebuildSelectedStrip();
          renderTabsAndChips();
          updateActiveFiltersCounterUI();
          scheduleCgLoad(320);
        };
        chipsGrid.append(b);
      });
    };

    sInp.oninput = () => {
      _cgTagSearchQuery = sInp.value;
      renderTabsAndChips();
    };
    rebuildSelectedStrip();
    renderTabsAndChips();
    panel.append(sWrap, selectedStrip, tabsRow, chipsGrid, emptyMsg);
  }

  // Нативные <select> подкатегорий скрыты, так как управление вынесено в hover-список в #cgSubKindBar
  if ($('cgAnimeKind')) $('cgAnimeKind').style.display = 'none';
  if ($('cgKind')) $('cgKind').style.display = 'none';
  if ($('cgVideoKind')) $('cgVideoKind').style.display = 'none';
  $('cgCountry').style.display = isVideo ? '' : 'none';
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
  if (cg.ongOnly && !r.ongoing) return false;
  if (cg.finOnly && !isCatalogItemFinished(r)) return false;

  if (isVideo || r.src === 'TMDB') {
    if (ageMode === 'no' && r.isAdult) return false;
  }

  if (!isVideo && r.src !== 'TMDB') {
    if (typeof KirokuEngine !== 'undefined' && typeof KirokuEngine.matchesAdultFilter === 'function') {
      if (!KirokuEngine.matchesAdultFilter(r, ageMode)) return false;
    } else {
      const hasHentai = (r.rawGenres || []).includes('Hentai') || (r.tags || []).some(t => /хентай|hentai/i.test(t));
      if (ageMode === 'no' && (r.isAdult || hasHentai)) return false;
      if (ageMode === 'only' && !(r.isAdult || hasHentai)) return false;
    }
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
      return (r.rawGenres || []).some(x => x.toLowerCase() === gEn.toLowerCase()) || (r.tags || []).some(x => x.toLowerCase() === gRu.toLowerCase() || x.toLowerCase() === gEn.toLowerCase());
    };
    const itemHasTag = tEn => {
      const valid = (CANONICAL_TAG_SYNONYMS[tEn] || [tEn, ruTag(tEn)]).map(s => s.toLowerCase());
      return (r.rawGenres || []).some(x => valid.includes(x.toLowerCase())) || (r.rawTags || []).some(x => valid.includes(x.toLowerCase())) || (r.tags || []).some(x => valid.includes(x.toLowerCase()));
    };
    const hasTagInfo = (r.tags && r.tags.length) || (r.rawGenres && r.rawGenres.length) || (r.rawTags && r.rawTags.length);
    if (hasTagInfo) {
      for (const g of incG) if (!itemHasGenre(g)) return false;
      for (const g of excG) if (itemHasGenre(g)) return false;
      for (const t of incT) if (!itemHasTag(t)) return false;
      for (const t of excT) if (itemHasTag(t)) return false;
    }
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

// Запрос фильмов/сериалов TMDB с маппингом жанров Movie <-> TV и поддержкой рейтинга/годов/онгоингов
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
  const minVoteParam = cg.min > 0 ? `&vote_average.gte=${cg.min}&vote_count.gte=40` : '';
  const EX = {date: `sort_by=${dk}.desc&${dk}.lte=${today}&vote_count.gte=20`, votes: 'sort_by=vote_count.desc&vote_count.gte=100', month: `sort_by=popularity.desc&${dk}.gte=${ago(30)}&${dk}.lte=${today}`, hidden: 'sort_by=vote_average.desc&vote_count.gte=150&vote_count.lte=1500', classic: `sort_by=vote_average.desc&vote_count.gte=1000&${dk}.lte=1999-12-31`, rare: 'sort_by=vote_average.desc&vote_count.gte=50&vote_count.lte=400'};
  let yearFilterParams = '';
  if (yrFrom && yrTo) yearFilterParams = `&${dk}.gte=${yrFrom}-01-01&${dk}.lte=${yrTo}-12-31`;
  else if (yrFrom) yearFilterParams = `&${dk}.gte=${yrFrom}-01-01`;
  else if (yrTo) yearFilterParams = `&${dk}.lte=${yrTo}-12-31`;

  if (cg.ongOnly && mv) return [];
  const ongStatusParam = (cg.ongOnly && !mv)
    ? '&with_status=0'
    : (cg.finOnly ? (mv ? `&primary_release_date.lte=${today}` : '&with_status=3') : '');
  const hasNarrowVideoFilters = Boolean(gens || withoutGens || yrFrom || yrTo || cty || rt || cg.ongOnly || cg.finOnly || cg.min > 0);
  let path = '';
  if (q && !cg.ongOnly) {
    const incAdult = ($('cgAge')?.value || '') !== 'no';
    path = `/search/${m}?query=${encodeURIComponent(q)}&include_adult=${incAdult ? 'true' : 'false'}${(yrFrom && yrTo && yrFrom === yrTo) ? '&' + (mv ? 'year' : yk) + '=' + yrFrom : ''}`;
    return tmdb(null, path, m, page);
  }
  if ((mode === 'actual' || !mode) && !hasNarrowVideoFilters) {
    return tmdb(null, `/trending/${m}/week`, m, page).catch(() => []);
  }
  if (mode === 'trend' && !hasNarrowVideoFilters) {
    return tmdb(null, `/trending/${m}/week`, m, page);
  }
  if (hasNarrowVideoFilters || EX[mode] || mode === 'soon' || mode === 'trend' || mode === 'actual') {
    path = `/discover/${m}?` + (EX[mode] || (mode === 'top' ? 'sort_by=vote_average.desc&vote_count.gte=300' : (mode === 'new' || mode === 'actual') ? `sort_by=popularity.desc&${dk}.gte=${ago(180)}&${dk}.lte=${today}` : 'sort_by=popularity.desc'))
      + (gens ? '&with_genres=' + gens : '')
      + (withoutGens ? '&without_genres=' + withoutGens : '')
      + yearFilterParams
      + (mode === 'soon' && !cg.finOnly ? `&${dk}.gte=${today}` : '')
      + (cty ? '&with_origin_country=' + cty : '') + rt + ongStatusParam + minVoteParam;
  } else {
    path = mode === 'top' ? `/${m}/top_rated` : mode === 'new' ? (mv ? '/movie/now_playing' : '/tv/on_the_air') : `/${m}/popular`;
  }
  return tmdb(null, path, m, page);
}

function getCatalogItemDedupKeys(r) {
  if (!r) return [];
  const keys = [];
  if (Number(r.mal) > 0) keys.push(`mal_${r.category}_${Number(r.mal)}`);
  if (Number(r.aniId) > 0) keys.push(`ani_${r.category}_${Number(r.aniId)}`);
  if (Number(r.shikiId) > 0) keys.push(`shiki_${r.category}_${Number(r.shikiId)}`);
  if (r.mdId) keys.push(`md_${r.category}_${String(r.mdId)}`);
  if (r.tmdb) keys.push(`tmdb_${r.tmdb}`);
  if (r.imdbId) keys.push(`imdb_${r.imdbId}`);
  const marker = getItemMarkers(r);
  const meta = getCachedItemNormMeta(r);
  for (const nt of (meta.primary.length ? meta.primary : [normTitleStr(r.title)]).filter(Boolean)) {
    keys.push(`title_${r.category}_${nt}_${marker}`);
  }
  return keys;
}

function enrichCatalogCardInPlace(target, src) {
  if (!target || !src) return;
  if (!Number(target.aniId) && Number(src.aniId) > 0) target.aniId = src.aniId;
  if (!Number(target.mal) && Number(src.mal) > 0) target.mal = src.mal;
  if (!Number(target.shikiId) && Number(src.shikiId) > 0) target.shikiId = src.shikiId;
  if (!target.mdId && src.mdId) target.mdId = src.mdId;
  if (!target.tmdb && src.tmdb) target.tmdb = src.tmdb;
  if (!target.imdbId && src.imdbId) target.imdbId = src.imdbId;

  // Сбор и объединение запасных постеров со всех баз (AniList, MAL/Jikan, MangaDex, Shikimori, TMDB)
  const allPosters = [];
  const pushPoster = u => {
    if (isValidPosterUrl(u) && !allPosters.includes(u.trim())) allPosters.push(u.trim());
  };
  pushPoster(target.poster);
  (target.posterFallbacks || []).forEach(pushPoster);
  pushPoster(src.poster);
  (src.posterFallbacks || []).forEach(pushPoster);
  if (allPosters.length) {
    if (!isValidPosterUrl(target.poster)) target.poster = allPosters[0];
    target.posterFallbacks = allPosters.slice(0, 6);
  }

  if (!target.banner && src.banner) target.banner = src.banner;
  if (src.isAdult) target.isAdult = true;
  if (src.ongoing && !target.ongoing) target.ongoing = true;

  // Взаимообогащение жанров и тегов из всех баз без потери специфичных тегов (Yuri, Yaoi, Isekai и т.п.)
  const mergeStrList = (a = [], b = []) => {
    const seen = new Set();
    const out = [];
    for (const s of [...a, ...b]) {
      const clean = String(s || '').trim();
      const key = clean.toLowerCase();
      if (!clean || seen.has(key)) continue;
      seen.add(key);
      out.push(clean);
    }
    return out;
  };
  // Защита от подмешивания ошибочного тега «Яой» из бага Shikimori GraphQL в карточки с доверенными жанрами AniList/MangaDex
  const srcSuspiciousYaoi = Boolean(src._shikiSuspiciousYaoiOnly);
  const targetSuspiciousYaoi = Boolean(target._shikiSuspiciousYaoiOnly);
  if (targetSuspiciousYaoi && !srcSuspiciousYaoi && Array.isArray(src.tags) && src.tags.length) {
    target.tags = mergeStrList([], src.tags);
    if (Array.isArray(src.rawGenres) && src.rawGenres.length) target.rawGenres = mergeStrList([], src.rawGenres);
    if (Array.isArray(src.rawTags) && src.rawTags.length) target.rawTags = mergeStrList([], src.rawTags);
    target._shikiSuspiciousYaoiOnly = false;
  } else if (!(srcSuspiciousYaoi && Array.isArray(target.tags) && target.tags.length)) {
    if (Array.isArray(src.tags) && src.tags.length) target.tags = mergeStrList(target.tags, src.tags);
    if (Array.isArray(src.rawGenres) && src.rawGenres.length) target.rawGenres = mergeStrList(target.rawGenres, src.rawGenres);
    if (Array.isArray(src.rawTags) && src.rawTags.length) target.rawTags = mergeStrList(target.rawTags, src.rawTags);
  }

  // Русское название и описание в приоритете (из Shikimori / MangaDex RU / TMDB)
  if (hasRu(src.title) && !hasRu(target.title)) {
    if (!target.en) target.en = target.title;
    target.title = src.title;
    target.ruTitle = 1;
  }
  if (src.desc && (!target.desc || (hasRu(src.desc) && !hasRu(target.desc)))) {
    target.desc = src.desc;
    if (hasRu(src.desc)) target.ruDone = 1;
  }

  if (!target.studio && src.studio) target.studio = src.studio;
  if (!target.author && src.author) target.author = src.author;
  if (!target.source && src.source) target.source = src.source;
  if (!target.romaji && src.romaji) target.romaji = src.romaji;
  if (!target.en && src.en) target.en = src.en;
  if (!target.orig && src.orig) target.orig = src.orig;
  if (!target.alt && src.alt) target.alt = src.alt;
  if (!target.trailerId && src.trailerId) target.trailerId = src.trailerId;
  if (!target.year && src.year) target.year = src.year;
  if (!target.endYear && src.endYear) target.endYear = src.endYear;
  if (!target.endDate && src.endDate) target.endDate = src.endDate;
  if (!num(target.eps) && num(src.eps)) target.eps = src.eps;
  if (!num(target.vols) && num(src.vols)) target.vols = src.vols;
  if (!num(target.dur) && num(src.dur)) target.dur = src.dur;
  if (!target.ext && src.ext) target.ext = src.ext;

  const srcs = new Set(Array.isArray(target.mergedSources) ? target.mergedSources : (target.src ? [target.src] : []));
  if (Array.isArray(src.mergedSources)) src.mergedSources.forEach(s => srcs.add(s));
  else if (src.src) srcs.add(src.src);
  if (srcs.size) target.mergedSources = [...srcs];
  if (!src._fromShikiFallback) target._fromShikiFallback = false;
}

function interleaveAndDedupCatalogLists(lists) {
  const out = [];
  const keyMap = new Map();
  const maxLen = Math.max(0, ...lists.map(l => (l || []).length));
  for (let idx = 0; idx < maxLen; idx++) {
    for (const arr of lists) {
      const r = arr && arr[idx];
      if (!r) continue;
      const keys = getCatalogItemDedupKeys(r);
      let existingCard = null;
      for (const k of keys) {
        if (keyMap.has(k)) { existingCard = keyMap.get(k); break; }
      }
      if (!existingCard) {
        existingCard = out.find(ex => same(ex, r)) || null;
      }
      if (existingCard) {
        enrichCatalogCardInPlace(existingCard, r);
        keys.forEach(k => { if (!keyMap.has(k)) keyMap.set(k, existingCard); });
        continue;
      }
      if (!Array.isArray(r.posterFallbacks)) {
        r.posterFallbacks = isValidPosterUrl(r.poster) ? [r.poster] : [];
      }
      if (r.src && !Array.isArray(r.mergedSources)) r.mergedSources = [r.src];
      out.push(r);
      keys.forEach(k => keyMap.set(k, r));
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

async function cgFetch(page, per, q, mode, optsOverride = null, signal = null) {
  const g = cg.g;
  const effPage = (!q && page === 1 && cg.feedSeedPage > 1) ? cg.feedSeedPage : ((page > 1 && cg.feedSeedPage > 1) ? page + cg.feedSeedPage - 1 : page);
  const cachedHits = (q && page === 1 && !optsOverride) ? getCachedCatalogMatchesForRuQuery(q, g) : [];
  const { incG, excG, incT, excT, incVid, excVid } = getActiveCatalogTagLists();
  const len = $('cgLen')?.value || '';
  const yrFrom = parseInt($('cgYear')?.value) || 0;
  const yrTo = parseInt($('cgYear2')?.value) || 0;
  const age = (optsOverride && 'age' in optsOverride) ? optsOverride.age : ($('cgAge')?.value || '');
  const subKind = g === 'Аниме'
    ? ($('cgAnimeKind')?.value || '')
    : g === 'Манга'
      ? ($('cgKind')?.value || '')
      : (g === 'Кино и сериалы' ? ($('cgVideoKind')?.value || 'all') : '');

  const cacheKey = (!optsOverride && _cgPageCache && window.KirokuEngine)
    ? window.KirokuEngine.buildCatalogCacheKey({
        g, sub: subKind, page: effPage, q, mode: mode || 'actual', age, len, yrFrom, yrTo,
        ongOnly: cg.ongOnly, finOnly: cg.finOnly, country: $('cgCountry')?.value || '',
        tags: [...cgTagState.entries()].filter(([, st]) => st !== 0).map(([k, st]) => `${k}:${st}`)
      })
    : '';
  if (cacheKey && _cgPageCache) {
    const hit = _cgPageCache.get(cacheKey);
    if (hit && hit.length) return hit.map(x => ({ ...x }));
  }

  const saveCache = list => {
    if (cacheKey && _cgPageCache && Array.isArray(list) && list.length) {
      _cgPageCache.set(cacheKey, list.map(x => ({ ...x })));
    }
    return list;
  };

  const resolvedAdFlag = (typeof KirokuEngine !== 'undefined' && typeof KirokuEngine.resolveAdultFilterFlag === 'function')
    ? KirokuEngine.resolveAdultFilterFlag(age)
    : (age === 'only' ? true : age === 'no' ? false : undefined);

  if (g === 'Все') {
    const allStatus = cg.ongOnly ? 'RELEASING' : (cg.finOnly ? 'FINISHED' : undefined);
    const primaryAnime = () => (!isAniListBlockedNow()
      ? _anilistDirectOnly(q || null, 'ANIME', { page: effPage, per: 10, sort: [q ? 'SEARCH_MATCH' : 'TRENDING_DESC'], status: allStatus, ad: resolvedAdFlag }, signal)
          .then(res => (res && res.length) ? res : _shikiDirectOnly(q || '', 'ANIME', { page: effPage, per: 10, sort: ['TRENDING_DESC'], status: allStatus, ad: resolvedAdFlag }, signal))
      : _shikiDirectOnly(q || '', 'ANIME', { page: effPage, per: 10, sort: ['TRENDING_DESC'], status: allStatus, ad: resolvedAdFlag }, signal)
    ).catch(() => []);
    const primaryManga = () => (!isAniListBlockedNow()
      ? _anilistDirectOnly(q || null, 'MANGA', { page: effPage, per: 10, sort: [q ? 'SEARCH_MATCH' : 'TRENDING_DESC'], status: allStatus, ad: resolvedAdFlag }, signal)
          .then(res => (res && res.length) ? res : _shikiDirectOnly(q || '', 'MANGA', { page: effPage, per: 10, sort: ['TRENDING_DESC'], status: allStatus, ad: resolvedAdFlag }, signal))
      : _shikiDirectOnly(q || '', 'MANGA', { page: effPage, per: 10, sort: ['TRENDING_DESC'], status: allStatus, ad: resolvedAdFlag }, signal)
    ).catch(() => []);
    const [aRes, mRes, fRes, sRes] = await Promise.all([
      primaryAnime(),
      primaryManga(),
      cgFetchSingleVideo('movie', effPage, q, mode).catch(() => []),
      cgFetchSingleVideo('tv', effPage, q, mode).catch(() => [])
    ]);
    return saveCache(interleaveAndDedupCatalogLists([cachedHits, aRes, mRes, fRes.slice(0, 8), sRes.slice(0, 8)]).filter(verifyCatalogItemMatchesFilters));
  }

  if (g === 'Кино и сериалы' || g === 'Фильм' || g === 'Сериал') {
    const vk = g === 'Фильм' ? 'movie' : g === 'Сериал' ? 'tv' : ($('cgVideoKind')?.value || 'all');
    if (vk === 'movie' || vk === 'tv') {
      return saveCache((await cgFetchSingleVideo(vk, effPage, q, mode)).filter(verifyCatalogItemMatchesFilters));
    }
    const [r1, r2] = await Promise.all([
      cgFetchSingleVideo('movie', effPage, q, mode).catch(() => []),
      cgFetchSingleVideo('tv', effPage, q, mode).catch(() => [])
    ]);
    return saveCache(interleaveAndDedupCatalogLists([r1, r2]).filter(verifyCatalogItemMatchesFilters));
  }

  const iso = d => d.toISOString().slice(0, 10), today = iso(new Date()), ago = n => iso(new Date(Date.now() - n * 864e5)), num8 = t => Number(t.replace(/-/g, ''));
  const SO = {actual: 'TRENDING_DESC', top: 'SCORE_DESC', trend: 'TRENDING_DESC', date: 'START_DATE_DESC', votes: 'FAVOURITES_DESC', hidden: 'SCORE_DESC', classic: 'SCORE_DESC', rare: 'SCORE_DESC'};
  const baseOpts = {page: effPage, per: Math.max(per || 24, 24), ad: resolvedAdFlag};
  if (cg.ongOnly) baseOpts.status = 'RELEASING';
  else if (cg.finOnly) baseOpts.status = 'FINISHED';
  if (incG.length) baseOpts.genre = incG;
  if (excG.length) baseOpts.genreNot = excG;
  if (incT.length) baseOpts.tag = incT;
  if (excT.length) baseOpts.tagNot = excT;

  if (yrFrom) baseOpts.sg = yrFrom * 10000 - 1;
  if (yrTo) baseOpts.sl = (yrTo + 1) * 10000;
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
      return saveCache(await fetchCatalogComics(effPage, q, mode));
    }
    if (mk === 'JP' || mk === 'KR' || mk === 'CN') baseOpts.country = mk;
  }

  const mType = g === 'Аниме' ? 'ANIME' : 'MANGA';
  const hasTagOrGenreFilter = Boolean(incG.length || excG.length || incT.length || excT.length);
  const effectiveSort = q
    ? 'SEARCH_MATCH'
    : ((mode === 'actual' || !mode) && hasTagOrGenreFilter ? 'POPULARITY_DESC' : (SO[mode] || 'POPULARITY_DESC'));
  const o = { ...baseOpts, sort: [effectiveSort] };
  if (!q) {
    if (mode === 'top' && age !== 'only') o.pg = 3000;
    if (mode === 'new' && !cg.finOnly) o.status = 'RELEASING';
    if (mode === 'soon' && !cg.finOnly && !cg.ongOnly) o.status = 'NOT_YET_RELEASED';
    if (mode === 'date') o.sl = num8(today);
    if (mode === 'month') { o.sg = num8(ago(30)); o.sl = num8(today); }
    if (mode === 'hidden') { o.ag = 75; o.pl = 60000; }
    if (mode === 'classic') { o.sl = 20000101; o.pg = 5000; }
    if (mode === 'rare') { o.ag = 65; o.pl = 15000; }
  }
  if (cg.finOnly) o.status = 'FINISHED';
  else if (cg.ongOnly) o.status = 'RELEASING';

  // Primary-First водопад: сначала один быстрый живой источник (AniList или Shikimori),
  // а дополнительные интеграции подключаются ТОЛЬКО если первый источник недоступен или вернул < 12 подходящих тайтлов.
  const sources = [];
  if (!isAniListBlockedNow()) {
    sources.push({
      name: 'AniList',
      timeoutMs: 2600,
      run: sig => _anilistDirectOnly(q || null, mType, o, sig)
    });
  }
  if (typeof isShikiGraphQLBlockedNow !== 'function' || !isShikiGraphQLBlockedNow()) {
    sources.push({
      name: 'Shikimori',
      timeoutMs: 3000,
      run: sig => _shikiDirectOnly(q || '', mType, o, sig)
    });
  }
  if (!optsOverride?.primaryOnly) {
    if (mType === 'MANGA') {
      sources.push({
        name: 'MangaDex',
        timeoutMs: 2600,
        run: () => _mangadexCatalogRaw(q || '', { ...o, per: Math.min(20, o.per || 20) })
      });
    }
    sources.push({
      name: 'Jikan',
      timeoutMs: 2400,
      run: () => _jikanCatalogRaw(q || '', mType, { ...o, per: Math.min(20, o.per || 20) })
    });
  } else if (sources.length > 1) {
    sources.length = 1;
  }

  let merged = [];
  if (typeof window !== 'undefined' && window.KirokuEngine && window.KirokuEngine.runPrimaryFirstWaterfall) {
    const wf = await window.KirokuEngine.runPrimaryFirstWaterfall(sources, {
      minEnough: optsOverride?.primaryOnly ? 1 : 12,
      filterFn: optsOverride ? null : verifyCatalogItemMatchesFilters,
      dedupFn: interleaveAndDedupCatalogLists,
      signal,
      timeoutMs: 2800
    });
    const wfItems = Array.isArray(wf?.items) ? wf.items : [];
    merged = cachedHits.length ? interleaveAndDedupCatalogLists([cachedHits, wfItems]) : wfItems;
  } else {
    for (const s of sources) {
      if (signal && signal.aborted) break;
      try {
        const part = await s.run(signal);
        const filtered = optsOverride ? (part || []) : (part || []).filter(verifyCatalogItemMatchesFilters);
        merged = interleaveAndDedupCatalogLists([merged, filtered]);
        if (merged.length >= 12) break;
      } catch (e) {}
    }
    if (cachedHits.length) merged = interleaveAndDedupCatalogLists([cachedHits, merged]);
  }
  return saveCache(merged);
}

const adding = new Set();
const QUICK_STATUS_OPTIONS = [
  ['В планах', 'В планах', '#5b6b8c', '📋'],
  ['Смотрю/Читаю', 'Смотрю / Читаю', '#2f8fe8', '▶'],
  ['Просмотрено/Прочитано', 'Просмотрено', '#1db57a', '●'],
  ['Отложено', 'Отложено', '#f59e0b', '⏸'],
  ['Брошено', 'Брошено', '#c2543e', '✕'],
  ['Любимое', 'В любимое', '#e0457b', '❤']
];
const SHORT_ST_BTN = {
  'В планах': 'В планах',
  'Смотрю/Читаю': 'Смотрю',
  'Просмотрено/Прочитано': 'Просмотрено',
  'Отложено': 'Отложено',
  'Пересматриваю': 'Пересматриваю',
  'Брошено': 'Брошено'
};
const SHORT_ST_ICON = {
  'В планах': '📋',
  'Смотрю/Читаю': '▶',
  'Просмотрено/Прочитано': '●',
  'Отложено': '⏸',
  'Пересматриваю': '🔁',
  'Брошено': '✕',
  'Любимое': '❤'
};

// Быстрый и строгий индекс по внешним ID и основным названиям (без коротких alt-синонимов, чтобы чужие тайтлы не помечались как добавленные)
function buildCollectionLookupIndex(pool = items) {
  const byId = new Map(), byTmdb = new Map(), byImdb = new Map(), byAniId = new Map(), byMal = new Map(), byShikiId = new Map(), byMdId = new Map(), byNormTitle = new Map(), byCjk = new Map();
  const cjkFn = (typeof KirokuEngine !== 'undefined' && KirokuEngine.extractCjkCore) ? KirokuEngine.extractCjkCore : (() => '');
  (pool || []).forEach(it => {
    if (!it) return;
    if (it.id != null) byId.set(String(it.id), it);
    if (it.tmdb) byTmdb.set(String(it.tmdb), it);
    if (it.imdbId) byImdb.set(String(it.imdbId), it);
    if (Number(it.aniId) > 0) byAniId.set(Number(it.aniId), it);
    const malKey = Number(it.mal) || Number(it.shikiId) || 0;
    if (malKey > 0) byMal.set(malKey, it);
    if (Number(it.shikiId) > 0) byShikiId.set(Number(it.shikiId), it);
    if (it.mdId) byMdId.set(String(it.mdId), it);
    const meta = getCachedItemNormMeta(it);
    const allNames = [...new Set([...(meta.primary || []), ...(meta.all || [])])].filter(x => x && x.length >= 2);
    allNames.forEach(nt => {
      let arr = byNormTitle.get(nt);
      if (!arr) { arr = []; byNormTitle.set(nt, arr); }
      arr.push(it);
    });
    const cjkCore = cjkFn(it.titleOrig || it.orig || it.title || '');
    if (cjkCore && cjkCore.length >= 2) {
      let arr = byCjk.get(cjkCore);
      if (!arr) { arr = []; byCjk.set(cjkCore, arr); }
      arr.push(it);
    }
  });
  return { byId, byTmdb, byImdb, byAniId, byMal, byShikiId, byMdId, byNormTitle, byCjk };
}

function findInCollectionWithIndex(r, idx) {
  if (!r || !idx) return null;
  if (r.id != null) {
    if (idx.byId && idx.byId.has(String(r.id))) return idx.byId.get(String(r.id));
  }
  const catIdOk = (a, b) => (typeof sameCatForId === 'function' ? sameCatForId(a, b) : sameCat(a, b));
  if (r.tmdb && idx.byTmdb.has(String(r.tmdb))) return idx.byTmdb.get(String(r.tmdb));
  if (r.imdbId && idx.byImdb.has(String(r.imdbId))) return idx.byImdb.get(String(r.imdbId));
  if (Number(r.aniId) > 0 && idx.byAniId.has(Number(r.aniId))) {
    const hit = idx.byAniId.get(Number(r.aniId));
    if (catIdOk(hit.category, r.category)) return hit;
  }
  const rMalKey = Number(r.mal) || Number(r.shikiId) || 0;
  if (rMalKey > 0 && idx.byMal.has(rMalKey)) {
    const hit = idx.byMal.get(rMalKey);
    if (catIdOk(hit.category, r.category)) return hit;
  }
  if (Number(r.shikiId) > 0 && idx.byShikiId && idx.byShikiId.has(Number(r.shikiId))) {
    const hit = idx.byShikiId.get(Number(r.shikiId));
    if (catIdOk(hit.category, r.category)) return hit;
  }
  if (r.mdId && idx.byMdId && idx.byMdId.has(String(r.mdId))) {
    const hit = idx.byMdId.get(String(r.mdId));
    if (catIdOk(hit.category, r.category)) return hit;
  }
  const metaR = getCachedItemNormMeta(r);
  const namesR = [...new Set([...(metaR.primary || []), ...(metaR.all || [])])].filter(x => x && x.length >= 2);
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
  // Кросс-поиск по оригинальному японскому названию (CJK), например «Наруто» (TMDB: ナルト) <-> «Naruto» (AniList: NARUTO -ナルト-)
  if (idx.byCjk && idx.byCjk.size && typeof KirokuEngine !== 'undefined' && KirokuEngine.extractCjkCore) {
    const cjkR = KirokuEngine.extractCjkCore(r.orig || r.titleOrig || r.title || '');
    if (cjkR && cjkR.length >= 2) {
      const bucket = idx.byCjk.get(cjkR);
      if (bucket) {
        for (const cand of bucket) {
          if (checked.has(cand)) continue;
          checked.add(cand);
          if (same(cand, r)) return cand;
        }
      }
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
    const prevWatched = num(existing.watchedEps);
    applyCatalogMatchToItem(existing, r, true);
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
    if (typeof syncItemProgressOnStatusChange === 'function') syncItemProgressOnStatusChange(existing, existing.status);
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
          existing.watchedEps = prevWatched;
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
      poster: isValidPosterUrl(r.poster) ? r.poster : '',
      posterFallbacks: Array.isArray(r.posterFallbacks) ? r.posterFallbacks.filter(isValidPosterUrl).slice(0, 6) : undefined,
      year: r.year || '', rating: '', extRating: r.ext || '',
      description: r.desc || '', titleEn: r.en || (r.titleEn || ''), romaji: r.romaji || '', titleOrig: r.orig || (r.titleOrig || ''), alt: r.alt || '',
      tags: r.tags || [], author: r.author || '', studio: r.studio || '', source: r.source || '', ongoing: !!r.ongoing, upcoming: !!r.upcoming,
      trailerId: r.trailerId || '',
      shikiId: Number(r.shikiId) || 0,
      mdId: r.mdId || '',
      tmdbGenreIds: Array.isArray(r.tmdbGenreIds) && r.tmdbGenreIds.length ? r.tmdbGenreIds.slice() : undefined,
      origLang: r.origLang || r.originalLanguage || undefined,
      originCountry: Array.isArray(r.originCountry) && r.originCountry.length ? r.originCountry.slice() : undefined,
      isTmdbAnime: r.isTmdbAnime === true ? true : undefined
    });
    if (r.tmdb) { try { Object.assign(it, await tmdbInfo(r)); } catch (e) {} }
    if (r.tmdb) it.tmdb = r.tmdb;
    if (['AniList', 'Shikimori', 'Jikan', 'MangaDex'].includes(r.src) || r.aniId || r.mal || r.shikiId || r.mdId) {
      it.eps = r.eps || 0; it.vols = r.vols || 0; it.dur = r.dur || 0; it.format = r.format || ''; it.aniId = r.aniId || 0; it.mal = r.mal || 0;
      if (['AniList', 'Shikimori', 'Jikan', 'MangaDex'].includes(r.src) && (!r.ruDone || !r.desc)) {
        try {
          await ruFull(r);
          it.title = r.title;
          it.titleEn = r.en || it.titleEn || '';
          if (r.romaji) it.romaji = r.romaji;
          it.description = r.desc || it.description || '';
          if (isValidPosterUrl(r.poster) && !isValidPosterUrl(it.poster)) it.poster = r.poster;
          if (Array.isArray(r.posterFallbacks) && r.posterFallbacks.length) {
            it.posterFallbacks = [...new Set([...(it.posterFallbacks || []), ...r.posterFallbacks].filter(isValidPosterUrl))].slice(0, 6);
          }
          if (Array.isArray(r.tags) && r.tags.length && (!it.tags || !it.tags.length)) it.tags = r.tags;
        } catch (e) {}
      }
    }
    if (typeof syncItemProgressOnStatusChange === 'function') syncItemProgressOnStatusChange(it, it.status);
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

  const idxLookup = buildCollectionLookupIndex(items);
  let existing = (r.id && items.find(i => String(i.id) === String(r.id))) || findInCollectionWithIndex(r, idxLookup);
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
      if (onAfterPick) onAfterPick(findInCollectionWithIndex(r, buildCollectionLookupIndex(items)));
    };
    menu.append(b);
  });

  // Компактный пункт «📁 В подборку…» (раскрывает прокручиваемый список всех подборок без перегрузки постера)
  const curListsCount = existing && Array.isArray(existing.lists) ? existing.lists.length : 0;
  const folderToggleBtn = el('button');
  folderToggleBtn.type = 'button';
  folderToggleBtn.style.borderTop = '1px solid var(--bd)';
  folderToggleBtn.style.marginTop = '2px';
  folderToggleBtn.append(
    el('span', null, `📁 В подборку${curListsCount ? ` (${curListsCount})` : ''}`),
    el('span', 'meta', '▸')
  );
  const folderSub = el('div', 'qa-folder-sub');
  folderSub.style.display = 'none';

  const rebuildFolderSub = () => {
    folderSub.replaceChildren();
    const allFolders = typeof getAllUserCollectionNames === 'function'
      ? getAllUserCollectionNames()
      : [...new Set([...(prof.customLists || []), ...items.flatMap(i => i.lists || [])])].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ru'));
    if (!allFolders.length) {
      const emptyHint = el('div', 'meta', 'Подборок пока нет');
      emptyHint.style.padding = '4px 8px';
      folderSub.append(emptyHint);
    } else {
      allFolders.forEach(folderName => {
        const hasF = Boolean(existing && (existing.lists || []).some(x => x.toLowerCase() === folderName.toLowerCase()));
        const fb = el('button', 'qa-folder-item' + (hasF ? ' on' : ''));
        fb.type = 'button';
        fb.append(
          el('span', null, `${hasF ? '✓ ' : '📁 '}${folderName}`),
          el('span', 'meta', hasF ? 'убрать' : '+')
        );
        fb.onclick = async ev => {
          ev.stopPropagation();
          if (!existing) {
            existing = await quickAdd(r, 'В планах');
          }
          if (!existing) return;
          existing.lists = existing.lists || [];
          const existsNow = existing.lists.some(x => x.toLowerCase() === folderName.toLowerCase());
          if (existsNow) {
            existing.lists = existing.lists.filter(x => x.toLowerCase() !== folderName.toLowerCase());
            toast(`Убрано из подборки «${folderName}»`);
          } else {
            existing.lists.push(folderName);
            toast(`Добавлено в подборку «${folderName}»`);
          }
          cloudSave(existing);
          refreshLists();
          if (typeof renderMyListsFolderBlock === 'function') renderMyListsFolderBlock();
          refresh({ itemId: existing.id });
          const cnt = existing.lists.length;
          folderToggleBtn.firstChild.textContent = `📁 В подборку${cnt ? ` (${cnt})` : ''}`;
          rebuildFolderSub();
          if (onAfterPick) onAfterPick(existing);
        };
        folderSub.append(fb);
      });
    }
    const newFB = el('button', 'qa-folder-item');
    newFB.type = 'button';
    newFB.style.color = 'var(--ach)';
    newFB.append(el('span', null, '🔍 Все подборки / Новая…'));
    newFB.onclick = async ev => {
      ev.stopPropagation();
      closeQuickAddStatusMenu();
      if (typeof openAddToCollectionModal === 'function') {
        await openAddToCollectionModal(existing || r, updated => {
          if (onAfterPick) onAfterPick(updated);
        });
      }
    };
    folderSub.append(newFB);
  };

  folderToggleBtn.onclick = ev => {
    ev.stopPropagation();
    const isHidden = folderSub.style.display === 'none';
    if (isHidden) rebuildFolderSub();
    folderSub.style.display = isHidden ? 'flex' : 'none';
    folderToggleBtn.lastChild.textContent = isHidden ? '▾' : '▸';
  };
  menu.append(folderToggleBtn, folderSub);

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
  const idx = getCatalogLookupIndex(true);
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
    applyPosterImg(pImg, r.poster, r);

    const body = el('div', 'cg-hero-info');
    const badges = el('div', 'cg-hero-badges');
    if (r.ongoing) badges.append(el('span', 'ong', 'ОНГОИНГ'));
    else if (r.upcoming) badges.append(el('span', 'anon-badge', 'АНОНС'));
    else badges.append(el('span', 'chip', 'В тренде'));
    if (r.ext) badges.append(el('span', 'star', '★ ' + r.ext));

    const fmtStr = displayFormatLabel(r);
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
  card._r = r; img.loading = 'lazy';
  applyPosterImg(img, r.poster, r);
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
  const rightBadges = el('div', 'pc-badges-right');
  if (r.ongoing) rightBadges.append(el('div', 'ong', 'ОНГОИНГ'));
  else if (r.upcoming) rightBadges.append(el('div', 'anon-badge', 'АНОНС'));
  if (rightBadges.children.length) pc.append(rightBadges);

  const info = el('div', 'ci'), row = el('div', 'cm');
  const fmtStr = displayFormatLabel(r);
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
  card.style.setProperty('--card-i', String(cgGrid.children.length));
  cgGrid.append(card);
}

const cgSeenKeys = new Set();
let cgSeenItems = [];
let _cgBusy = false;

async function cgLoad(reset) {
  window._cgInCreatorView = false;
  clearTimeout(_cgTagDebounceTimer);
  _cgTagDebounceTimer = null;
  updateActiveFiltersCounterUI();
  if (_cgAbortCtrl) {
    try { _cgAbortCtrl.abort(); } catch (e) {}
  }
  const myCtrl = new AbortController();
  _cgAbortCtrl = myCtrl;
  const signal = myCtrl.signal;

  const t = ++cg.t; let cleared = false, shown = 0, more = true;
  _cgBusy = true;
  getCatalogLookupIndex(true);
  if (reset) {
    cg.page = 1;
    cgSeenKeys.clear();
    cgSeenItems = [];
    cgGrid.replaceChildren(...Array.from({length: 12}, () => el('div', 'sk')));
    $('cgMore').style.display = 'none';
  }
  try {
    let firstBatchVis = [];
    for (let tries = 0; tries < 2; tries++) {
      const res = await cgFetch(cg.page, 24, cg.q, $('cgMode').value, null, signal);
      if (t !== cg.t || signal.aborted) return;
      const vis = res.filter(r => {
        if (!cgPass(r)) return false;
        const keys = getCatalogItemDedupKeys(r);
        if (keys.some(k => cgSeenKeys.has(k))) return false;
        if (cgSeenItems.some(ex => same(ex, r))) return false;
        keys.forEach(k => cgSeenKeys.add(k));
        cgSeenItems.push(r);
        return true;
      });
      if (vis.length > 0 && reset && !cleared) {
        cgGrid.replaceChildren();
        cleared = true;
      }
      if (!firstBatchVis.length && vis.length) firstBatchVis = vis;
      vis.forEach(cgCard); shown += vis.length; cg.page++; more = res.length > 0;
      if (!more || shown >= 8 || !(cg.hide || cg.min)) break;
    }
    syncCatalogSourceCaption(firstBatchVis);
    cgMarks();
    if (reset) {
      renderCatalogHeroSlider(firstBatchVis);
    }
    if (reset && !shown) {
      const isVideo = cg.g === 'Кино и сериалы' || cg.g === 'Фильм' || cg.g === 'Сериал';
      const ageMode = $('cgAge')?.value || '';
      let hasHiddenAdult = false;
      if (!isVideo && ageMode === 'no') {
        try {
          const probe = await cgFetch(1, 8, cg.q, $('cgMode').value, { age: '', primaryOnly: true }, signal);
          if (t !== cg.t || signal.aborted) return;
          hasHiddenAdult = Array.isArray(probe) && probe.some(x => x && (x.isAdult || (x.rawGenres || []).includes('Hentai') || (x.tags || []).some(tg => /хентай|hentai|этти|ecchi|юри|яой/i.test(tg))));
        } catch (probeErr) {}
      }
      if (!cleared) { cgGrid.replaceChildren(); cleared = true; }
      if (hasHiddenAdult) {
        const hintBox = el('div', 'cg-adult-hint');
        hintBox.append(
          el('b', null, '🔞 Результаты скрыты фильтром «Без 18+»'),
          el('p', null, 'По выбранному жанру или запросу есть тайтлы с возрастным рейтингом. Ты можешь включить отображение всех тайтлов в один клик.'),
          (() => {
            const btn = el('button', 'btn', '🔓 Показать все (вкл. 18+)');
            btn.type = 'button';
            btn.onclick = () => {
              if ($('cgAge')) $('cgAge').value = '';
              cg.feedSeedPage = 1;
              cgGenres();
              cgLoad(true);
            };
            return btn;
          })()
        );
        cgGrid.append(hintBox);
      } else {
        cgGrid.append(el('div', 'msg', more ? 'Под выбранные фильтры тут ничего не подошло — нажми «Показать ещё» или смени фильтры.' : 'Ничего не найдено.'));
      }
    } else if (reset && !cleared) {
      cgGrid.replaceChildren();
      cleared = true;
    }
    $('cgMore').style.display = more ? '' : 'none';
    ruCards();
  } catch (e) {
    if (t !== cg.t || signal.aborted || e?.name === 'AbortError') return;
    if (reset && !shown) {
      const m = el('div', 'msg', 'Ошибка загрузки: ' + e.message + ' '), rb = el('button', 'btn btn-s', 'Повторить');
      rb.onclick = () => cgLoad(true); m.append(rb); cgGrid.replaceChildren(m);
    } else toast('Ошибка загрузки: ' + e.message, true);
  } finally {
    if (t === cg.t) _cgBusy = false;
  }
}

document.querySelectorAll('#cgCats .tb').forEach(b => b.onclick = () => {
  document.querySelectorAll('#cgCats .tb').forEach(x => x.classList.toggle('on', x === b));
  cg.g = b.dataset.g;
  cg.feedSeedPage = 1;
  cgGenres(); cgLoad(true);
});
['cgMode', 'cgKind', 'cgLen', 'cgCountry'].forEach(id => {
  if ($(id)) $(id).onchange = () => { cg.feedSeedPage = 1; updateActiveFiltersCounterUI(); cgLoad(true); };
});
$('cgAge').onchange = () => {
  if ($('cgAge').value === 'no' && cgTagState.has('g:Hentai')) {
    cgTagState.delete('g:Hentai');
    toast('Фильтр «Хентай (18+)» сброшен при переключении в режим «Без 18+»');
  }
  cg.feedSeedPage = 1;
  cgGenres();
  cgLoad(true);
};

let cgT; const cgGo = () => { clearTimeout(cgT); cg.q = $('cgSearch').value.trim(); cg.feedSeedPage = 1; cgLoad(true); };
$('cgSearch').oninput = () => { $('cgClear').style.display = $('cgSearch').value ? 'grid' : 'none'; clearTimeout(cgT); cgT = setTimeout(cgGo, 450); };
$('cgSearch').onkeydown = e => { if (e.key === 'Enter') cgGo(); };
if ($('cgOngBtn')) {
  $('cgOngBtn').onclick = e => {
    cg.ongOnly = !cg.ongOnly;
    if (cg.ongOnly && cg.finOnly) {
      cg.finOnly = false;
      $('cgFinBtn')?.classList.remove('on');
    }
    e.currentTarget.classList.toggle('on', cg.ongOnly);
    cg.feedSeedPage = 1;
    updateActiveFiltersCounterUI();
    cgLoad(true);
  };
}
if ($('cgFinBtn')) {
  $('cgFinBtn').onclick = e => {
    cg.finOnly = !cg.finOnly;
    if (cg.finOnly && cg.ongOnly) {
      cg.ongOnly = false;
      $('cgOngBtn')?.classList.remove('on');
    }
    e.currentTarget.classList.toggle('on', cg.finOnly);
    cg.feedSeedPage = 1;
    updateActiveFiltersCounterUI();
    cgLoad(true);
  };
}
$('cgHide').onclick = e => { cg.hide = !cg.hide; e.currentTarget.classList.toggle('on', cg.hide); updateActiveFiltersCounterUI(); cgLoad(true); };
let cgY;
['cgYear', 'cgYear2'].forEach(id => {
  if ($(id)) $(id).oninput = () => {
    clearTimeout(cgY);
    cgY = setTimeout(() => { cg.feedSeedPage = 1; updateActiveFiltersCounterUI(); cgLoad(true); }, 600);
  };
});
$('cgReset').onclick = () => {
  cgTagState.clear();
  _cgTagSearchQuery = '';
  ['cgYear2', 'cgLen', 'cgCountry', 'cgAge'].forEach(i => { if ($(i)) $(i).value = ''; });
  $('cgSearch').value = ''; cg.q = ''; $('cgYear').value = ''; $('cgKind').value = ''; $('cgMode').value = 'actual';
  if ($('cgAnimeKind')) $('cgAnimeKind').value = '';
  if ($('cgVideoKind')) $('cgVideoKind').value = 'all';
  cg.hide = false; cg.ongOnly = false; cg.finOnly = false; cg.min = 0; cg.feedSeedPage = 1; $('cgMin').value = '0'; $('cgClear').style.display = 'none';
  $('cgHide').classList.remove('on');
  $('cgOngBtn')?.classList.remove('on');
  $('cgFinBtn')?.classList.remove('on');
  cgGenres(); cgLoad(true);
};
$('cgMore').onclick = () => cgLoad(false);

// Автоматическая бесконечная подгрузка каталога при прокрутке к кнопке #cgMore
if (typeof IntersectionObserver !== 'undefined' && $('cgMore')) {
  const cgObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting && !_cgBusy && $('cgMore')?.style.display !== 'none' && $('catalogView')?.style.display !== 'none') {
        cgLoad(false);
      }
    }
  }, { rootMargin: '320px' });
  cgObserver.observe($('cgMore'));
}
$('cgMin').onchange = () => { cg.min = +$('cgMin').value || 0; updateActiveFiltersCounterUI(); cgLoad(true); };
$('cgClear').onclick = () => { $('cgSearch').value = ''; $('cgClear').style.display = 'none'; cgGo(); };
$('cgFltBtn').onclick = () => {
  $('cgFilters').classList.toggle('fopen');
  updateCatalogFilterBtnState();
};
if ($('cgMobApplyBtn')) {
  $('cgMobApplyBtn').onclick = () => {
    $('cgFilters')?.classList.remove('fopen');
    updateCatalogFilterBtnState();
    if (_cgTagDebounceTimer) {
      clearTimeout(_cgTagDebounceTimer);
      _cgTagDebounceTimer = null;
      cgLoad(true);
    }
  };
}

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
    const planned = items.filter(i => i.status === 'В планах');
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
        let ns = [];
        try {
          const useAni = Number(r.aniId) > 0;
          const q = useAni
            ? 'query($id:Int,$t:MediaType){Media(id:$id,type:$t){recommendations(perPage:6,sort:RATING_DESC){nodes{mediaRecommendation{id idMal title{romaji english}}}}}}'
            : 'query($m:Int,$t:MediaType){Media(idMal:$m,type:$t){recommendations(perPage:6,sort:RATING_DESC){nodes{mediaRecommendation{id idMal title{romaji english}}}}}}';
          const vars = useAni
            ? { id: Number(r.aniId), t: r.category === 'Аниме' ? 'ANIME' : 'MANGA' }
            : { m: Number(r.mal), t: r.category === 'Аниме' ? 'ANIME' : 'MANGA' };
          const j = await fetchAniListGraphQL(q, vars, 2800);
          ns = (j.data?.Media?.recommendations?.nodes || []).map(n => n.mediaRecommendation).filter(Boolean).map(x => ({mal: x.idMal, en: x.title.english || x.title.romaji}));
          let ru = {};
          if (ns.length) {
            try { ru = await ruTitles(r.category === 'Аниме' ? 'animes' : 'mangas', ns.map(x => x.mal).filter(Boolean)); } catch (e) {}
          }
          list = ns.map(x => ({ mal: x.mal, en: x.en, label: ru[x.mal] || x.en }));
        } catch (aniErr) {
          list = [];
        }
        // Фоллбэк без VPN: Shikimori /similar + Jikan v4 /recommendations
        if ((!list || !list.length) && Number(r.mal) > 0) {
          const shEp = SHK[r.category] || 'animes';
          try {
            const shSim = await shiki(`/api/${shEp}/${Number(r.mal)}/similar`);
            if (Array.isArray(shSim) && shSim.length) {
              list = shSim.slice(0, 6).map(x => ({
                mal: x.id,
                en: x.name || x.russian || '',
                label: x.russian || x.name || ''
              })).filter(x => x.label);
            }
          } catch (e) {}
          if (!list || !list.length) {
            try {
              const jEp = r.category === 'Аниме' ? 'anime' : 'manga';
              const jr = await _jikanJson(`https://api.jikan.moe/v4/${jEp}/${Number(r.mal)}/recommendations`, 5500);
              const recs = (jr?.data || []).slice(0, 6);
              const mals = recs.map(x => x.entry?.mal_id).filter(Boolean);
              let ru = {};
              if (mals.length) {
                try { ru = await ruTitles(shEp, mals); } catch (e) {}
              }
              list = recs.map(x => ({
                mal: x.entry?.mal_id || 0,
                en: x.entry?.title || '',
                label: ru[x.entry?.mal_id] || x.entry?.title || ''
              })).filter(x => x.label);
            } catch (e) {}
          }
        }
      } else if (r.tmdb && String(r.tmdb).includes('/')) {
        const k = getActiveTmdbKey();
        const j = await fetchTmdbJson(`https://api.themoviedb.org/3/${r.tmdb}/recommendations?api_key=${encodeURIComponent(k)}&language=ru-RU&page=1`, 6000);
        list = (j.results || []).slice(0, 6).map(x => ({ en: x.title || x.name, label: x.title || x.name }));
      } else {
        list = [];
      }
      simPreviewCache.set(cacheKey, list);
      if (simPreviewCache.size > 120) simPreviewCache.delete(simPreviewCache.keys().next().value);
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

function formatRndMetaLine(r) {
  if (!r) return '';
  const rndRelState = typeof getItemReleaseState === 'function' ? getItemReleaseState(r) : (r.ongoing ? 'ongoing' : r.upcoming ? 'upcoming' : 'finished');
  const rndRelLabel = rndRelState === 'ongoing' ? 'Онгоинг' : rndRelState === 'upcoming' ? 'Анонс' : 'Завершён';
  const parts = [r.year, catLabel(r), r.ext ? '★ ' + r.ext + (r.src ? ' (' + r.src + ')' : '') : ''];
  if (r.category === 'Сериал' && (num(r.seasons) > 0 || num(r.eps) > 0)) {
    const sTxt = num(r.seasons) > 0 ? `${num(r.seasons)} сез.` : '';
    const eTxt = num(r.eps) > 0 ? `${num(r.eps)} эп.` : '';
    parts.push([sTxt, eTxt].filter(Boolean).join(' · '));
  } else if (r.category === 'Аниме' && num(r.eps) > 0) {
    parts.push(`${num(r.eps)} эп.`);
  } else if ((r.category === 'Манга' || r.category === 'Ранобэ') && (num(r.vols) > 0 || num(r.eps) > 0)) {
    parts.push([num(r.vols) > 0 ? `${num(r.vols)} т.` : '', num(r.eps) > 0 ? `${num(r.eps)} гл.` : ''].filter(Boolean).join(' · '));
  }
  if (num(r.dur) > 0 && r.category !== 'Манга' && r.category !== 'Ранобэ') {
    parts.push(`${num(r.dur)} мин.`);
  }
  parts.push(rndRelLabel);
  return parts.filter(Boolean).join(' | ');
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
  applyPosterImg($('rndPoster'), r.poster, r);
  $('rndTitle').textContent = r.title;
  $('rndNames').textContent = [r.en, r.orig].filter(Boolean).join(' / ');
  $('rndMeta').textContent = formatRndMetaLine(r);
  $('rndCredits').textContent = [r.author && 'Автор: ' + r.author, r.studio && 'Студия: ' + r.studio, r.source && 'Источник: ' + r.source].filter(Boolean).join('  •  ');
  rndTagChips(r);
  const dKeyRnd = 'd_' + getRuCacheKey(r);
  const bestRndDesc = (typeof KirokuEngine !== 'undefined' && KirokuEngine.resolveBestTitleDescription)
    ? KirokuEngine.resolveBestTitleDescription(r, null, RUC[dKeyRnd] || '')
    : (r.desc || RUC[dKeyRnd] || '');
  if (bestRndDesc && !r.desc) r.desc = bestRndDesc;
  $('rndDesc').textContent = bestRndDesc || 'Описание отсутствует.';
  $('rndLink').href = r.url || '#';
  $('rndLink').style.display = r.url ? '' : 'none';
  $('rndMore').style.display = rnd ? '' : 'none';
  if ($('rndEdit')) $('rndEdit').style.display = 'none';
  syncRndAddBtnUI(r);
  $('rndModal').style.display = 'flex';
  ruPreview(r);
  renderOnDemandSimilarButton(r, $('rndSim'));
  if ($('rndCharsSec')) {
    const chSec = $('rndCharsSec');
    chSec.replaceChildren();
    chSec.style.display = 'block';
    const hintText = (r.category === 'Фильм' || r.category === 'Сериал')
      ? '🎬 Актёры, трейлер, сезоны и франшиза доступны на полной странице тайтла →'
      : (r.category === 'Манга' || r.category === 'Ранобэ')
        ? '📖 Персонажи, подробности и франшиза доступны на полной странице тайтла →'
        : '👤 Персонажи, сэйю, трейлер и франшиза доступны на полной странице тайтла →';
    const hintBtn = el('button', 'chars-fullpage-hint', hintText);
    hintBtn.type = 'button';
    hintBtn.onclick = () => {
      $('rndModal').style.display = 'none';
      if (typeof openFullTitlePage === 'function') openFullTitlePage(r);
    };
    chSec.append(hintBtn);
  }
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
$('rndEdit').onclick = () => { closeAll(true); openAdd(null); fillForm(rndR); if (rndR.tmdb) tmdbExtra(rndR).catch(() => {}); };
$('rndAdd').onclick = e => {
  e.stopPropagation();
  openQuickAddStatusMenu($('rndAdd'), rndR, () => syncRndAddBtnUI(rndR));
};

// ---------- Проверка вышедших и анонсированных сиквелов по коллекции ----------
let _sequelsScanAbort = null;
let _sequelsLastResults = [];
let _sequelsFilterMode = 'all';

function renderSequelsListUI() {
  const listEl = $('sequelsList');
  const tabsEl = $('sequelsTabs');
  if (!listEl) return;
  const all = _sequelsLastResults || [];
  const outCount = all.filter(x => x.statusBucket === 'released' || x.statusBucket === 'ongoing').length;
  const anonsCount = all.filter(x => x.statusBucket === 'announced').length;

  if (tabsEl) {
    tabsEl.style.display = all.length ? 'flex' : 'none';
    const bAll = tabsEl.querySelector('[data-sf="all"]');
    const bOut = tabsEl.querySelector('[data-sf="out"]');
    const bAnons = tabsEl.querySelector('[data-sf="anons"]');
    if (bAll) { bAll.textContent = `Все (${all.length})`; bAll.classList.toggle('on', _sequelsFilterMode === 'all'); }
    if (bOut) { bOut.textContent = `Вышли / Онгоинг (${outCount})`; bOut.classList.toggle('on', _sequelsFilterMode === 'out'); }
    if (bAnons) { bAnons.textContent = `Анонсы (${anonsCount})`; bAnons.classList.toggle('on', _sequelsFilterMode === 'anons'); }
  }

  const filtered = all.filter(x => {
    if (_sequelsFilterMode === 'out') return x.statusBucket === 'released' || x.statusBucket === 'ongoing';
    if (_sequelsFilterMode === 'anons') return x.statusBucket === 'announced';
    return true;
  });

  listEl.replaceChildren();
  if (!filtered.length) {
    const empty = el('div', 'seq-empty', all.length
      ? 'В этой вкладке нет пропущенных продолжений.'
      : 'Пропущенных продолжений не найдено — все известные сиквелы уже есть в твоей коллекции!');
    listEl.append(empty);
    return;
  }

  const stLabels = { released: 'Вышел', ongoing: 'Онгоинг', announced: 'Анонс' };
  const stClasses = { released: 'is-released', ongoing: 'is-ongoing', announced: 'is-announced' };

  filtered.forEach(seq => {
    const card = el('div', 'seq-card');
    const img = el('img', 'seq-poster');
    img.alt = seq.title || '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    applyPosterImg(img, seq.poster, seq);

    const openPage = () => {
      hideModalElement('sequelsModal', false);
      if (typeof openFullTitlePage === 'function') openFullTitlePage(seq);
    };
    img.onclick = openPage;

    const info = el('div', 'seq-info');
    const ttl = el('div', 'seq-title', seq.title);
    ttl.onclick = openPage;
    info.append(ttl);

    if (seq.parentTitles && seq.parentTitles.length) {
      const parentStr = seq.parentTitles.slice(0, 2).join(', ');
      info.append(el('div', 'seq-parent', `Продолжение для: ${parentStr}`));
    }

    const metaRow = el('div', 'seq-meta-row');
    const pill = el('span', `seq-st ${stClasses[seq.statusBucket] || 'is-released'}`, stLabels[seq.statusBucket] || 'Вышел');
    metaRow.append(pill);

    const fmtLbl = typeof displayFormatLabel === 'function' ? displayFormatLabel(seq) : (seq.category || '');
    const metaParts = [fmtLbl, seq.year, seq.eps ? `${seq.eps} ${seq.category === 'Манга' || seq.category === 'Ранобэ' ? 'гл.' : 'эп.'}` : '', seq.extRating ? `★ ${seq.extRating}` : ''].filter(Boolean);
    if (metaParts.length) {
      metaRow.append(el('span', null, metaParts.join(' · ')));
    }
    info.append(metaRow);

    const alreadyOwned = !!has(seq);
    const addBtn = el('button', alreadyOwned ? 'btn btn-s seq-add-btn' : 'btn seq-add-btn', alreadyOwned ? '✓ В коллекции' : '＋ В планы');
    addBtn.type = 'button';
    addBtn.disabled = alreadyOwned;
    addBtn.onclick = async e => {
      e.stopPropagation();
      if (has(seq)) {
        addBtn.textContent = '✓ В коллекции';
        addBtn.className = 'btn btn-s seq-add-btn';
        addBtn.disabled = true;
        return;
      }
      addBtn.disabled = true;
      addBtn.textContent = '…';
      try {
        await quickAdd(seq, 'В планах');
        addBtn.textContent = '✓ В планах';
        addBtn.className = 'btn btn-s seq-add-btn';
      } catch (err) {
        addBtn.disabled = false;
        addBtn.textContent = '＋ В планы';
      }
    };

    card.append(img, info, addBtn);
    listEl.append(card);
  });
}

async function runSequelsCheckScan() {
  if (_sequelsScanAbort) {
    try { _sequelsScanAbort.abort(); } catch (e) {}
  }
  const ctrl = new AbortController();
  _sequelsScanAbort = ctrl;

  const summaryEl = $('sequelsSummary');
  const progWrap = $('sequelsProgressWrap');
  const progTxt = $('sequelsProgressTxt');
  const progBar = $('sequelsProgressBar');
  const listEl = $('sequelsList');
  const tabsEl = $('sequelsTabs');
  const rescanBtn = $('sequelsRescanBtn');

  const setProg = (pct, txt) => {
    if (progWrap) progWrap.style.display = 'flex';
    if (progBar) progBar.style.width = `${Math.max(0, Math.min(100, Math.round(pct)))}%`;
    if (progTxt) progTxt.textContent = txt;
  };

  _sequelsLastResults = [];
  _sequelsFilterMode = 'all';
  if (tabsEl) tabsEl.style.display = 'none';
  if (listEl) listEl.replaceChildren();
  if (rescanBtn) rescanBtn.disabled = true;

  const targetParents = (items || []).filter(i =>
    i && (i.status === 'Просмотрено/Прочитано' || i.status === 'Пересматриваю' || i.fav)
  );

  if (!targetParents.length) {
    if (progWrap) progWrap.style.display = 'none';
    if (summaryEl) summaryEl.textContent = 'В коллекции пока нет просмотренных, прочитанных или любимых тайтлов для проверки.';
    if (listEl) listEl.append(el('div', 'seq-empty', 'Отметь хотя бы один тайтл как «Просмотрено/Прочитано» или «Любимое», и здесь появятся все его пропущенные продолжения.'));
    if (rescanBtn) rescanBtn.disabled = false;
    return;
  }

  const aniAnimeParents = targetParents.filter(i => i.category === 'Аниме' && (Number(i.aniId) > 0 || Number(i.mal) > 0 || Number(i.shikiId) > 0));
  const aniMangaParents = targetParents.filter(i => (i.category === 'Манга' || i.category === 'Ранобэ') && (Number(i.aniId) > 0 || Number(i.mal) > 0 || Number(i.shikiId) > 0));
  const movieParents = targetParents.filter(i => i.category === 'Фильм' && i.tmdb).slice(0, 18);

  const totalCheckable = aniAnimeParents.length + aniMangaParents.length + movieParents.length;
  if (!totalCheckable) {
    if (progWrap) progWrap.style.display = 'none';
    if (summaryEl) summaryEl.textContent = `Найдено ${targetParents.length} просмотренных/любимых тайтлов, но они пока не привязаны к каталогу (AniList / Shikimori / TMDB).`;
    if (listEl) listEl.append(el('div', 'seq-empty', 'Запусти «Данные → Навести порядок» для привязки коллекции к каталогу, после чего проверка сиквелов сможет найти все продолжения.'));
    if (rescanBtn) rescanBtn.disabled = false;
    return;
  }

  if (summaryEl) {
    summaryEl.textContent = `Проверяем связи франшиз для ${totalCheckable} просмотренных и любимых тайтлов…`;
  }
  setProg(8, 'Загружаем деревья франшиз…');

  const relationRecords = [];
  let checkedCount = 0;
  const bumpProg = (inc, label) => {
    checkedCount = Math.min(totalCheckable, checkedCount + inc);
    const pct = 10 + Math.round((checkedCount / Math.max(1, totalCheckable)) * 80);
    setProg(pct, label || `Проверено ${checkedCount} из ${totalCheckable}…`);
  };

  const mapAniRelNodeToCard = node => {
    const isAni = node.type === 'ANIME';
    const cat = isAni ? 'Аниме' : (node.format === 'NOVEL' ? 'Ранобэ' : 'Манга');
    const ttlObj = node.title || {};
    const main = ttlObj.english || ttlObj.romaji || ttlObj.native || '';
    return {
      aniId: Number(node.id) || 0,
      mal: Number(node.idMal) || 0,
      category: cat,
      format: node.format || '',
      status: node.status || '',
      releaseStatus: node.status || '',
      ongoing: node.status === 'RELEASING',
      upcoming: node.status === 'NOT_YET_RELEASED',
      title: main,
      titleEn: ttlObj.english || '',
      en: ttlObj.english || '',
      romaji: ttlObj.romaji || '',
      titleOrig: ttlObj.native || '',
      orig: ttlObj.native || '',
      year: node.startDate?.year ? String(node.startDate.year) : '',
      eps: Number(node.episodes || node.chapters) || 0,
      dur: Number(node.duration) || (isAni ? 24 : 0),
      extRating: node.averageScore ? (node.averageScore / 10).toFixed(1) : '',
      ext: node.averageScore ? (node.averageScore / 10).toFixed(1) : '',
      poster: isValidPosterUrl(node.coverImage?.large) ? node.coverImage.large : '',
      url: node.siteUrl || '',
      src: 'AniList'
    };
  };

  const scanAniBatchGroup = async (groupParents, mediaType) => {
    if (!groupParents.length || ctrl.signal.aborted) return;
    const byAniId = new Map();
    const byMalId = new Map();
    groupParents.forEach(p => {
      if (Number(p.aniId) > 0) byAniId.set(Number(p.aniId), p);
      const mid = Number(p.mal || p.shikiId) || 0;
      if (mid > 0) byMalId.set(mid, p);
    });

    const aniCoveredParentIds = new Set();
    const gqlById = `query($ids:[Int],$t:MediaType){Page(perPage:50){media(id_in:$ids,type:$t){id idMal relations{edges{relationType node{id idMal type format status startDate{year} episodes chapters duration averageScore title{romaji english native} coverImage{large} siteUrl}}}}}}`;
    const gqlByMal = `query($ids:[Int],$t:MediaType){Page(perPage:50){media(idMal_in:$ids,type:$t){id idMal relations{edges{relationType node{id idMal type format status startDate{year} episodes chapters duration averageScore title{romaji english native} coverImage{large} siteUrl}}}}}}`;

    const ingestAniMedia = mediaList => {
      (mediaList || []).forEach(m => {
        const parent = byAniId.get(Number(m.id)) || byMalId.get(Number(m.idMal));
        if (!parent) return;
        aniCoveredParentIds.add(String(parent.id));
        (m.relations?.edges || []).forEach(edge => {
          if (edge?.relationType === 'SEQUEL' && edge.node) {
            relationRecords.push({
              parentItem: parent,
              relationType: 'SEQUEL',
              node: mapAniRelNodeToCard(edge.node)
            });
          }
        });
      });
    };

    if (!isAniListBlockedNow()) {
      const aniIds = [...byAniId.keys()];
      for (let i = 0; i < aniIds.length; i += 40) {
        if (ctrl.signal.aborted) return;
        const slice = aniIds.slice(i, i + 40);
        try {
          const j = await fetchAniListGraphQL(gqlById, { ids: slice, t: mediaType }, 4500, ctrl.signal);
          ingestAniMedia(j?.data?.Page?.media);
        } catch (e) {}
        bumpProg(slice.length, `Проверяем ${mediaType === 'ANIME' ? 'аниме' : 'мангу и ранобэ'} (${checkedCount}/${totalCheckable})…`);
      }

      const remainingMalIds = groupParents
        .filter(p => !aniCoveredParentIds.has(String(p.id)) && (Number(p.mal || p.shikiId) > 0))
        .map(p => Number(p.mal || p.shikiId));
      const uniqMal = [...new Set(remainingMalIds)];
      for (let i = 0; i < uniqMal.length; i += 40) {
        if (ctrl.signal.aborted) return;
        const slice = uniqMal.slice(i, i + 40);
        try {
          const j = await fetchAniListGraphQL(gqlByMal, { ids: slice, t: mediaType }, 4500, ctrl.signal);
          ingestAniMedia(j?.data?.Page?.media);
        } catch (e) {}
        bumpProg(slice.length, `Проверяем ${mediaType === 'ANIME' ? 'аниме' : 'мангу и ранобэ'} (${checkedCount}/${totalCheckable})…`);
      }
    }

    // Shikimori GraphQL fallback для тех, кто не нашёлся в AniList (или если AniList недоступен)
    const missedForShiki = groupParents.filter(p => !aniCoveredParentIds.has(String(p.id)) && (Number(p.mal || p.shikiId) > 0));
    if (missedForShiki.length && !ctrl.signal.aborted && !(typeof isShikiGraphQLBlockedNow === 'function' && isShikiGraphQLBlockedNow())) {
      const shField = mediaType === 'ANIME' ? 'animes' : 'mangas';
      const shQ = `query($ids:String,$limit:PositiveInt){${shField}(ids:$ids,limit:$limit){id malId related{relationKind anime{id malId name russian kind status episodes episodesAired duration score airedOn{year} poster{mainUrl originalUrl}} manga{id malId name russian kind status chapters score airedOn{year} poster{mainUrl originalUrl}}}}}`;
      const uniqShIds = [...new Set(missedForShiki.map(p => Number(p.mal || p.shikiId)))];
      for (let i = 0; i < uniqShIds.length; i += 35) {
        if (ctrl.signal.aborted) return;
        const slice = uniqShIds.slice(i, i + 35);
        try {
          const data = await shikiGraphQL(shQ, { ids: slice.join(','), limit: slice.length }, ctrl.signal);
          (data?.[shField] || []).forEach(node => {
            const parent = byMalId.get(Number(node.malId || node.id));
            if (!parent) return;
            (node.related || []).forEach(rel => {
              const rk = String(rel.relationKind || '').toLowerCase();
              if (rk !== 'sequel') return;
              const obj = rel.anime || rel.manga;
              if (!obj) return;
              const isRelAni = Boolean(rel.anime);
              const knd = String(obj.kind || '').toLowerCase();
              const fmt = knd === 'movie' ? 'MOVIE' : knd === 'ova' ? 'OVA' : knd === 'ona' ? 'ONA' : knd === 'special' ? 'SPECIAL' : (knd === 'light_novel' || knd === 'novel') ? 'NOVEL' : (isRelAni ? 'TV' : 'MANGA');
              const cat = isRelAni ? 'Аниме' : (fmt === 'NOVEL' ? 'Ранобэ' : 'Манга');
              const st = obj.status === 'ongoing' ? 'RELEASING' : obj.status === 'anons' ? 'NOT_YET_RELEASED' : 'FINISHED';
              relationRecords.push({
                parentItem: parent,
                relationType: 'SEQUEL',
                node: {
                  aniId: 0,
                  mal: Number(obj.malId || obj.id) || 0,
                  shikiId: Number(obj.id || obj.malId) || 0,
                  category: cat,
                  format: fmt,
                  status: st,
                  releaseStatus: st,
                  ongoing: st === 'RELEASING',
                  upcoming: st === 'NOT_YET_RELEASED',
                  title: obj.russian || obj.name || '',
                  titleEn: obj.name || '',
                  en: obj.name || '',
                  year: obj.airedOn?.year ? String(obj.airedOn.year) : '',
                  eps: Number(obj.episodes || obj.chapters || obj.episodesAired) || 0,
                  airedEps: Number(obj.episodesAired) || 0,
                  dur: Number(obj.duration) || (isRelAni ? 24 : 0),
                  extRating: obj.score && Number(obj.score) > 0 ? Number(obj.score).toFixed(1) : '',
                  ext: obj.score && Number(obj.score) > 0 ? Number(obj.score).toFixed(1) : '',
                  poster: typeof pickShikiGraphQLPoster === 'function' ? pickShikiGraphQLPoster(obj.poster) : (obj.poster?.originalUrl || obj.poster?.mainUrl || ''),
                  src: 'Shikimori'
                }
              });
            });
          });
        } catch (e) {}
        bumpProg(slice.length, `Проверяем через Shikimori (${checkedCount}/${totalCheckable})…`);
      }
    }
  };

  await scanAniBatchGroup(aniAnimeParents, 'ANIME');
  await scanAniBatchGroup(aniMangaParents, 'MANGA');

  // Проверка кинофраншиз (TMDB collections) для завершённых/любимых фильмов
  if (movieParents.length && !ctrl.signal.aborted) {
    const key = getActiveTmdbKey();
    const checkedColIds = new Set();
    for (let i = 0; i < movieParents.length; i += 3) {
      if (ctrl.signal.aborted) break;
      const chunk = movieParents.slice(i, i + 3);
      await Promise.all(chunk.map(async mv => {
        try {
          const d = await fetchTmdbJson(`https://api.themoviedb.org/3/movie/${mv.tmdb}?api_key=${key}&language=ru-RU`, 4000);
          const colId = d?.belongs_to_collection?.id;
          if (!colId || checkedColIds.has(colId)) return;
          checkedColIds.add(colId);
          const colData = await fetchTmdbJson(`https://api.themoviedb.org/3/collection/${colId}?api_key=${key}&language=ru-RU`, 4000);
          const baseDate = String(d.release_date || `${mv.year || '0000'}-01-01`);
          (colData?.parts || []).forEach(part => {
            if (!part || String(part.id) === String(mv.tmdb)) return;
            const pDate = String(part.release_date || '');
            const isLater = pDate ? (pDate > baseDate) : true;
            if (!isLater) return;
            const yr = pDate ? Number(pDate.slice(0, 4)) : 0;
            const isFuture = !pDate || pDate > new Date().toISOString().slice(0, 10);
            relationRecords.push({
              parentItem: mv,
              relationType: 'tmdb_collection_sequel',
              node: {
                tmdb: String(part.id),
                category: 'Фильм',
                format: 'MOVIE',
                status: isFuture ? 'NOT_YET_RELEASED' : 'FINISHED',
                releaseStatus: isFuture ? 'NOT_YET_RELEASED' : 'FINISHED',
                upcoming: isFuture,
                title: part.title || part.original_title || '',
                titleOrig: part.original_title || '',
                orig: part.original_title || '',
                year: yr ? String(yr) : '',
                dur: 110,
                extRating: part.vote_average > 0 ? Number(part.vote_average).toFixed(1) : '',
                ext: part.vote_average > 0 ? Number(part.vote_average).toFixed(1) : '',
                poster: part.poster_path ? 'https://image.tmdb.org/t/p/w500' + part.poster_path : '',
                url: 'https://www.themoviedb.org/movie/' + part.id,
                src: 'TMDB'
              }
            });
          });
        } catch (e) {}
      }));
      bumpProg(chunk.length, `Проверяем сиквелы фильмов (${checkedCount}/${totalCheckable})…`);
    }
  }

  let missing = (typeof KirokuEngine !== 'undefined' && KirokuEngine.extractMissingSequels)
    ? KirokuEngine.extractMissingSequels(targetParents, relationRecords, node => !!has(node))
    : [];

  // Подтягиваем русские названия для найденных сиквелов с AniList
  if (missing.length && !ctrl.signal.aborted && typeof ruTitles === 'function') {
    setProg(94, 'Подбираем русские названия для найденных сиквелов…');
    try {
      const animeMals = missing.filter(x => x.category === 'Аниме' && x.mal > 0 && !hasRu(x.title)).map(x => x.mal);
      const mangaMals = missing.filter(x => (x.category === 'Манга' || x.category === 'Ранобэ') && x.mal > 0 && !hasRu(x.title)).map(x => x.mal);
      const [ruAni, ruMan] = await Promise.all([
        animeMals.length ? ruTitles('animes', animeMals).catch(() => ({})) : Promise.resolve({}),
        mangaMals.length ? ruTitles('mangas', mangaMals).catch(() => ({})) : Promise.resolve({})
      ]);
      missing.forEach(x => {
        const ruName = x.category === 'Аниме' ? ruAni[x.mal] : ruMan[x.mal];
        if (ruName) x.title = ruName;
      });
    } catch (e) {}
  }

  _sequelsLastResults = missing;
  if (progWrap) progWrap.style.display = 'none';
  if (rescanBtn) rescanBtn.disabled = false;

  const abortedNote = ctrl.signal.aborted ? ' (проверка остановлена досрочно)' : '';
  const checkedWord = typeof pluralRu === 'function' ? pluralRu(totalCheckable, 'тайтл', 'тайтла', 'тайтлов') : 'тайтлов';
  if (summaryEl) {
    summaryEl.textContent = missing.length
      ? `Проверено ${totalCheckable} ${checkedWord}${abortedNote}. Найдено пропущенных продолжений: ${missing.length}.`
      : `Проверено ${totalCheckable} ${checkedWord}${abortedNote}. Пропущенных продолжений не обнаружено.`;
  }
  renderSequelsListUI();
}

function openSequelsCheckModal() {
  $('colMorePop')?.classList.remove('open');
  $('hybMorePop')?.classList.remove('open');
  const m = $('sequelsModal');
  if (!m) return;
  m.style.display = 'flex';
  if (typeof pushModalHistory === 'function') pushModalHistory();
  runSequelsCheckScan();
}
window.openSequelsCheckModal = openSequelsCheckModal;

if ($('checkSequelsBtn')) $('checkSequelsBtn').onclick = openSequelsCheckModal;
if ($('profCheckSequelsBtn')) $('profCheckSequelsBtn').onclick = openSequelsCheckModal;
if ($('sequelsRescanBtn')) $('sequelsRescanBtn').onclick = () => runSequelsCheckScan();
if ($('sequelsStopBtn')) $('sequelsStopBtn').onclick = () => {
  if (_sequelsScanAbort) {
    try { _sequelsScanAbort.abort(); } catch (e) {}
  }
};
if ($('sequelsTabs')) {
  $('sequelsTabs').onclick = e => {
    const btn = e.target.closest('button[data-sf]');
    if (!btn) return;
    _sequelsFilterMode = btn.dataset.sf || 'all';
    renderSequelsListUI();
  };
}