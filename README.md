# Kirokucho

Адаптивный веб-трекер фильмов, сериалов, аниме, манги и ранобэ с каталогом и облачной синхронизацией (Firebase Auth + Firestore).

## Архитектура

Приложение написано на чистом HTML / CSS / JavaScript (без React) и собирается через Vite для локального запуска и публикации на GitHub Pages:

- `index.html` — точка входа, разметка вкладок («Каталог», «Моя коллекция», «Профиль»), модальных окон и подключение Firebase SDK.
- `style.css` / `mobile.css` — стили для ПК (> 768px) и мобильных экранов (≤ 768px).
- `kiroku_engine.js` — чистое ядро логики (чанки облачного хранилища, дедупликация, прогресс серий/глав/сезонов, фильтрация работ авторов, совместимость форматов).
- `app_core.js` — работа с локальным хранилищем (IndexedDB + localStorage), облачной синхронизацией Firestore, профилем и поиском дублей.
- `app_catalog.js` — каталог (AniList, Shikimori, Jikan, MangaDex, TMDB), фильтры, быстрое добавление и превью.
- `app.js` — интерфейс коллекции, полная страница тайтла, подборки, импорт/экспорт, навигация.
- `src/utils/kirokuEngine.test.ts` — автотесты чистого движка `kiroku_engine.js`.

## Локальный запуск

Требуется Node.js 22+.

```bash
npm install
npm run dev
```

Приложение откроется на `http://localhost:3000`.

## Сборка и проверка

```bash
npm test          # автотесты движка (node --experimental-strip-types --test)
npm run lint      # проверка типов TypeScript (tsc --noEmit)
npm run build     # сборка в папку dist/ (включая копирование JS/CSS и favicon.ico)
```
