// Electron main — окно + трей + IPC + Telegram-бот. Никакого терминала для пользователя.
import { app, BrowserWindow, ipcMain, Tray, Menu, shell, nativeImage } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { generateVideo } from "./src/pipeline.js";
import { TelegramBot, validateToken, sendMessage, sendDocument } from "./src/telegram.js";
import { buildCatalog } from "./src/catalog-builder.js";
import { extractFolderId } from "./src/gdrive.js";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");
const CATALOG_PATH = path.join(app.getPath("userData"), "catalog.local.json");
const CACHE_DIR = path.join(app.getPath("userData"), "catalog-cache");
const DEFAULT_CONFIG = {
  elevenKey: "", voiceId: "IKne3meq5aSn9XLyUdCD", openaiKey: "", pexelsKey: "",
  telegramToken: "", catalogUrl: "", musicUrl: "", musicVolume: 0.05,
  driveFolderUrl: "", googleApiKey: "",
  genProvider: "none", falKey: "", falModel: "kling", genMax: 2,
  outDir: path.join(os.homedir(), "ReelsFactory", "videos"),
};

const loadLocalCatalog = async () => {
  try { return JSON.parse(await fs.readFile(CATALOG_PATH, "utf8")); } catch { return null; }
};

let win = null, tray = null, bot = null, botInfo = null;

const loadConfig = async () => {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(await fs.readFile(CONFIG_PATH, "utf8")) }; }
  catch { return { ...DEFAULT_CONFIG }; }
};
const saveConfig = async (cfg) => {
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2));
};
const toRenderer = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

// общая логика: ТЗ -> видео (+ прогресс в окно). Каталог из Drive подмешиваем в конфиг.
const makeVideo = async (script, onProgress) => {
  const cfg = await loadConfig();
  const catalog = await loadLocalCatalog();
  return generateVideo({ script, config: { ...cfg, catalog }, onProgress });
};

// запустить/перезапустить бота под текущий токен
const restartBot = async () => {
  const cfg = await loadConfig();
  if (bot) { bot.stop(); bot = null; botInfo = null; }
  if (!cfg.telegramToken) { toRenderer("bot:status", { running: false }); return; }
  try { botInfo = await validateToken(cfg.telegramToken); }
  catch (e) { toRenderer("bot:status", { running: false, error: e.message }); return; }
  bot = new TelegramBot(cfg.telegramToken, async ({ chatId, text }) => {
    try {
      await sendMessage(cfg.telegramToken, chatId, "🎬 Принял сценарий, монтирую ролик (1-2 мин)…");
      toRenderer("job:start", { source: "telegram", text });
      const r = await makeVideo(text, (p) => toRenderer("job:progress", p));
      await sendDocument(cfg.telegramToken, chatId, r.outPath, "Готово ✅");
      toRenderer("job:done", { outPath: r.outPath, source: "telegram" });
    } catch (e) {
      await sendMessage(cfg.telegramToken, chatId, "⚠️ Не получилось собрать ролик: " + e.message).catch(() => {});
      toRenderer("job:error", { error: e.message });
    }
  }, (m) => toRenderer("bot:log", m));
  bot.start();
  toRenderer("bot:status", { running: true, username: botInfo.username });
  updateTray();
};

const createWindow = () => {
  win = new BrowserWindow({
    width: 980, height: 720, minWidth: 820, minHeight: 600,
    title: "AI Reels Factory",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.on("close", (e) => { if (!app.isQuitting) { e.preventDefault(); win.hide(); } });
};

const updateTray = () => {
  if (!tray) return;
  const status = bot ? `Бот: @${botInfo?.username || "—"} ✓` : "Бот выключен";
  tray.setToolTip("AI Reels Factory — " + status);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: status, enabled: false },
    { type: "separator" },
    { label: "Открыть окно", click: () => { win.show(); } },
    { label: "Выход", click: () => { app.isQuitting = true; app.quit(); } },
  ]));
};

const createTray = () => {
  // простая иконка-плейсхолдер (1x1 прозрачная), чтобы не падать без файла
  const img = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKElEQVR4nO3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAACAtwGZ8AABDQT3WwAAAABJRU5ErkJggg==");
  try { tray = new Tray(img); updateTray(); } catch {}
};

// --- авто-обновление (electron-updater): фиксы прилетают всем копиям сами ---
const setupAutoUpdate = () => {
  if (!app.isPackaged) return; // в dev (npm start) не проверяем
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", (i) => toRenderer("update:status", { state: "available", version: i?.version }));
  autoUpdater.on("download-progress", (p) => toRenderer("update:status", { state: "downloading", percent: Math.round(p.percent || 0) }));
  autoUpdater.on("update-downloaded", (i) => toRenderer("update:status", { state: "ready", version: i?.version }));
  autoUpdater.on("error", (e) => toRenderer("update:status", { state: "error", error: String(e?.message || e) }));
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000); // раз в 6 ч
};

// --- IPC ---
ipcMain.handle("update:install", () => { app.isQuitting = true; autoUpdater.quitAndInstall(); });
ipcMain.handle("config:get", async () => loadConfig());
ipcMain.handle("config:save", async (_e, cfg) => { await saveConfig(cfg); await restartBot(); return true; });
ipcMain.handle("telegram:validate", async (_e, token) => {
  try { const me = await validateToken(token); return { ok: true, username: me.username }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("video:create", async (_e, script) => {
  toRenderer("job:start", { source: "app", text: script });
  try {
    const r = await makeVideo(script, (p) => toRenderer("job:progress", p));
    toRenderer("job:done", { outPath: r.outPath, source: "app" });
    return { ok: true, outPath: r.outPath };
  } catch (e) { toRenderer("job:error", { error: e.message }); return { ok: false, error: e.message }; }
});
ipcMain.handle("video:reveal", async (_e, p) => { shell.showItemInFolder(p); });
ipcMain.handle("catalog:build", async () => {
  const cfg = await loadConfig();
  const folderId = extractFolderId(cfg.driveFolderUrl);
  if (!folderId) return { ok: false, error: "Не распознал ссылку на папку Google Drive" };
  try {
    const catalog = await buildCatalog({
      folderId, googleApiKey: cfg.googleApiKey, openaiKey: cfg.openaiKey || null, cacheDir: CACHE_DIR,
      onProgress: (p) => toRenderer("catalog:progress", p),
    });
    await fs.writeFile(CATALOG_PATH, JSON.stringify(catalog, null, 2));
    return { ok: true, count: catalog.length, byType: catalog.reduce((a, c) => ((a[c.type] = (a[c.type] || 0) + 1), a), {}) };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("catalog:info", async () => {
  const c = await loadLocalCatalog();
  if (!c) return { count: 0 };
  return { count: c.length, byType: c.reduce((a, x) => ((a[x.type] = (a[x.type] || 0) + 1), a), {}) };
});
ipcMain.handle("video:list", async () => {
  const cfg = await loadConfig();
  try {
    const files = (await fs.readdir(cfg.outDir)).filter((f) => f.endsWith(".mp4"));
    const items = await Promise.all(files.map(async (f) => {
      const full = path.join(cfg.outDir, f); const st = await fs.stat(full);
      return { path: full, name: f, size: st.size, mtime: st.mtimeMs };
    }));
    return items.sort((a, b) => b.mtime - a.mtime);
  } catch { return []; }
});

app.whenReady().then(async () => {
  createWindow();
  createTray();
  setupAutoUpdate();
  await restartBot();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else win.show(); });
});
app.on("window-all-closed", () => { /* живём в трее */ });
