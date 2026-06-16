# AI Reels Factory — настольное приложение

ТЗ → видео с озвучкой, титрами и музыкой. **Полностью локально**: ffmpeg вшит, рендер на машине пользователя, без облака и без n8n. Telegram через polling — работает за любым роутером без публичного URL.

## Как это работает
```
Сценарий (окно ИЛИ Telegram-бот)
   → озвучка ElevenLabs (слова с таймкодами)
   → подбор кадров (каталог / Pexels-европейцы / GPT)
   → ffmpeg: склейка + наезды + титры ASS + музыка
   → mp4 на диск + отправка в Telegram
```

## Запуск (разработка)
```bash
npm install
npm start
```
Первый запуск → вкладка **Настройка**: вставь токен бота (@BotFather), ключ ElevenLabs, при желании OpenAI/Pexels/каталог/музыку → «Сохранить». Дальше пиши сценарий в окне или своему боту.

## Проверка ядра без окна
```bash
ELEVEN_KEY=xxx node src/test-render.js "твой сценарий"
# видео появится в ~/ReelsFactory/videos/
```

## Сборка установщика (.dmg / .exe)
```bash
npm run dist   # electron-builder
```

## Структура
- `main.js` — Electron: окно, трей, IPC, Telegram-бот (polling)
- `preload.cjs` — безопасный мост окно↔main
- `renderer/` — окно (Создать / Мои видео / Настройка)
- `src/pipeline.js` — оркестрация ТЗ→видео
- `src/tts.js` — озвучка ElevenLabs
- `src/match.js` — подбор кадров (каталог + европейский Pexels + GPT)
- `src/render-core.js` — локальный ffmpeg-движок (склейка, титры, музыка)
- `src/telegram.js` — бот через getUpdates (без webhook)

## Google Drive → авто-каталог
1. Клиент делает папку с клипами «Доступ по ссылке» в Google Drive.
2. В «Настройке» вставляет ссылку + Google API key (Drive API).
3. «Собрать каталог» → приложение скачивает клипы в локальный кэш, определяет длительность,
   тегает каждый (GPT-4o Vision если есть ключ OpenAI, иначе по имени файла), пропускает
   неподходящие кадры. Каталог хранится локально (`catalog.local.json`), клипы — в кэше
   (рендер потом без скачиваний).

## Авто-обновление (фиксы прилетают всем копиям)
- Движок: `electron-updater` + GitHub Releases (`build.publish` в package.json → MarkVision2/reels-factory-releases).
- Приложение проверяет обновления при запуске и раз в 6 ч, качает в фоне, показывает плашку
  «Обновление готово → Перезапустить».
- Цикл выпуска фикса: поправил баг → подними `version` в package.json →
  `GH_TOKEN=xxx npm run dist -- --publish always` → залилось в Releases → у всех подтянулось.
- ⚠️ **macOS auto-update требует подписи** (Apple Developer cert, $99/год). Без подписи Mac-копии
  не обновляются автоматически. Windows обновляется без подписи (с предупреждением SmartScreen).
- Работает только в **упакованном** приложении (в `npm start` отключено).

## Статус
- [x] Локальный рендер на компе (озвучка + кадры + ffmpeg + титры) — **проверено**
- [x] Окно с 3 экранами + Telegram-бот (polling)
- [x] Google Drive: подключение папки по ссылке → авто-каталог (Vision-теги, локальный кэш)
- [x] Авто-обновление (electron-updater + GitHub Releases) + плашка в окне
- [x] Упаковка: `dist/AI Reels Factory-0.1.0-arm64.dmg` собран (ffmpeg внутри запускается)
- [x] Визард первого запуска (3 шага: Telegram → ElevenLabs → готово, с проверкой токена)
- [x] ИИ-генерация биролов через FAL.ai (Kling/Veo/Runway/Luma) — опционально, с лимитом бюджета

## ИИ-генерация биролов (опционально)
В «Настройке» → «ИИ-генерация»: выбрать FAL.ai, вставить FAL key, модель (Kling/Veo/Runway), лимит
клипов на ролик. GPT может пометить сегмент `gen` (геройский план, которого нет в стоке) → клип
генерируется моделью (9:16, ~5с). Платно за клип → есть `genMax`. Стиль/ЦА-защита вшиты в промпт.
Один FAL key = доступ ко всем моделям. (FAL вызов не протестирован вживую — нужен ключ + расход.)

## Сборка установщиков
```bash
# macOS (Apple Silicon) — собрано и проверено:
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --publish never
# macOS Intel:  --mac dmg --x64   |  Universal: --mac --universal
# Windows .exe: npx electron-builder --win nsis   (лучше собирать на Windows)
```
⚠️ Сборка **без подписи** (adhoc): на чужом Mac Gatekeeper заблокирует → открывать
правым кликом → «Открыть». Для нормальной раздачи нужна подпись+нотаризация Apple ($99/год).
Сейчас arm64 — для Intel-маков нужен отдельный/universal билд.

### Windows + авто-релиз через CI (рекомендуется)
`.github/workflows/release.yml`: пуш тега `vX.Y.Z` → GitHub Actions собирает **Mac (.dmg) и Windows (.exe)**
на своих раннерах и публикует в Releases → установленные копии обновляются сами. Активация:
```bash
git init && git add -A && git commit -m "init"
git remote add origin https://github.com/MarkVision2/reels-factory-releases.git
git push -u origin main
git tag v0.1.1 && git push --tags     # → CI собирает оба ОС и публикует
```
(Intel-маки — раскомментировать `macos-13` в матрице. Windows .exe собирается на windows-раннере, wine не нужен.)
