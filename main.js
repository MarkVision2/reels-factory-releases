// Electron main — окно + трей + IPC + Telegram-бот. Никакого терминала для пользователя.
import { app, BrowserWindow, ipcMain, Tray, Menu, shell, nativeImage, dialog } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { generateVideo } from "./src/pipeline.js";
import { TelegramBot, validateToken, sendMessage, sendDocument, getFileLink } from "./src/telegram.js";
import electronUpdater from "electron-updater";
import { paths, ensureFolders, readMeta, writeMeta, listProjects, createProject } from "./src/local-content.js";
import { thumbDataUrl } from "./src/thumbs.js";
import { transcribeAudio } from "./src/stt.js";

const { autoUpdater } = electronUpdater;
const P = paths();

// фикс белого экрана на части Mac: окно отрисовано, но GPU-композитор не выводит кадр.
// Полное отключение GPU = софтверный рендер (надёжно показывает окно).
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");
const FONT_PATH = path.join(app.getPath("userData"), "brand-font.ttf");
const DEFAULT_CONFIG = {
  elevenKey: "", voiceId: "IKne3meq5aSn9XLyUdCD", openaiKey: "", pexelsKey: "",
  telegramToken: "", musicUrl: "", musicVolume: 0.05,
  genProvider: "none", falKey: "", falModel: "kling", genMax: 2,
  fontPath: "", fontName: "", accentColor: "#42C8F5",
  voiceStability: 0.35, voiceStyle: 0.55, voiceSimilarity: 0.8,
  activeProject: "", telegramChatId: "",
  videoMode: "faceless", heygenKey: "", heygenAvatarId: "", heygenVoiceId: "",
};

let win = null, tray = null, bot = null, botInfo = null, latestVersion = null;

const loadConfig = async () => {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(await fs.readFile(CONFIG_PATH, "utf8")) }; }
  catch { return { ...DEFAULT_CONFIG }; }
};
const saveConfig = async (cfg) => {
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2));
};
const toRenderer = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

// общая логика: ТЗ -> видео (каталог/музыка/звуки берутся из локальных папок внутри pipeline).
const makeVideo = async (script, onProgress) => {
  const cfg = await loadConfig();
  return generateVideo({ script, config: cfg, onProgress });
};

// запустить/перезапустить бота под текущий токен
const restartBot = async () => {
  const cfg = await loadConfig();
  if (bot) { bot.stop(); bot = null; botInfo = null; }
  if (!cfg.telegramToken) { toRenderer("bot:status", { running: false }); return; }
  try { botInfo = await validateToken(cfg.telegramToken); }
  catch (e) { toRenderer("bot:status", { running: false, error: e.message }); return; }
  bot = new TelegramBot(cfg.telegramToken, async ({ chatId, text, voiceFileId }) => {
    try {
      // запоминаем чат — туда же шлём ролики, созданные из окна
      const c0 = await loadConfig();
      if (String(c0.telegramChatId) !== String(chatId)) { c0.telegramChatId = chatId; await saveConfig(c0); }
      // голосовое → расшифровка
      let script = text;
      if (voiceFileId) {
        await sendMessage(cfg.telegramToken, chatId, "🎧 Слушаю голосовое…");
        const link = await getFileLink(cfg.telegramToken, voiceFileId);
        const audio = Buffer.from(await (await fetch(link)).arrayBuffer());
        script = await transcribeAudio({ audioBuffer: audio, apiKey: cfg.elevenKey });
        if (!script) { await sendMessage(cfg.telegramToken, chatId, "Не разобрал голосовое, попробуй ещё раз."); return; }
        await sendMessage(cfg.telegramToken, chatId, "📝 Услышал: " + script.slice(0, 300));
      }
      if (!script) return;
      await sendMessage(cfg.telegramToken, chatId, "🎬 Принял, монтирую ролик (1-2 мин)…");
      toRenderer("job:start", { source: "telegram", text: script });
      const r = await makeVideo(script, (p) => toRenderer("job:progress", p));
      await sendDocument(cfg.telegramToken, chatId, r.outPath, "Готово ✅");
      toRenderer("job:done", { outPath: r.outPath, source: "telegram" });
    } catch (e) {
      await sendMessage(cfg.telegramToken, chatId, "⚠️ Не получилось: " + e.message).catch(() => {});
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
    backgroundColor: "#0f1116",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.webContents.on("console-message", (_e, _lvl, msg) => console.log("[renderer]", msg));
  win.webContents.on("unresponsive", () => console.log("[ОКНО ЗАВИСЛО]"));
  win.webContents.on("render-process-gone", (_e, d) => console.log("[renderer упал]", d?.reason));
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
  autoUpdater.autoDownload = true;           // качаем обновление в фоне, ставим по кнопке
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", (i) => { latestVersion = i?.version; toRenderer("update:status", { state: "available", version: i?.version }); });
  autoUpdater.on("download-progress", (p) => toRenderer("update:status", { state: "downloading", percent: Math.round(p.percent || 0) }));
  autoUpdater.on("update-downloaded", (i) => toRenderer("update:status", { state: "ready", version: i?.version }));
  autoUpdater.on("error", () => {});         // тихо игнорируем (нет подписи/нет zip и т.п.)
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000); // раз в 6 ч
};

// глобально гасим необработанные отклонения апдейтера, чтобы не сыпались варнинги
process.on("unhandledRejection", () => {});

// --- IPC ---
ipcMain.handle("update:install", async () => {
  // На Mac без подписи Apple авто-установка не работает → сами качаем dmg и открываем (юзер перетащит).
  if (process.platform === "darwin") {
    const v = latestVersion;
    const page = "https://github.com/MarkVision2/reels-factory-releases/releases/latest";
    if (!v) { shell.openExternal(page); return; }
    const url = `https://github.com/MarkVision2/reels-factory-releases/releases/download/v${v}/AI-Reels-Factory-${v}-arm64.dmg`;
    const dest = path.join(app.getPath("downloads"), `AI Reels Factory ${v}.dmg`);
    toRenderer("update:status", { state: "downloading", percent: 0 });
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("dl");
      await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
      toRenderer("update:status", { state: "ready", version: v });
      shell.openPath(dest); // монтирует dmg — юзер перетаскивает приложение в Программы
    } catch { shell.openExternal(page); }
    return;
  }
  app.isQuitting = true; autoUpdater.quitAndInstall();
});
ipcMain.handle("config:get", async () => loadConfig());
ipcMain.handle("config:save", async (_e, cfg) => { await saveConfig(cfg); restartBot().catch(() => {}); return true; }); // бот стартует в фоне — не подвешиваем окно
ipcMain.handle("telegram:validate", async (_e, token) => {
  try { const me = await validateToken(token); return { ok: true, username: me.username }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("video:create", async (_e, script) => {
  toRenderer("job:start", { source: "app", text: script });
  try {
    const r = await makeVideo(script, (p) => toRenderer("job:progress", p));
    // отправляем готовое и в Telegram (если бот настроен и есть чат)
    const cfg = await loadConfig();
    if (cfg.telegramToken && cfg.telegramChatId) {
      sendDocument(cfg.telegramToken, cfg.telegramChatId, r.outPath, "Готово ✅").catch(() => {});
    }
    toRenderer("job:done", { outPath: r.outPath, source: "app" });
    return { ok: true, outPath: r.outPath, sentToTg: !!(cfg.telegramToken && cfg.telegramChatId) };
  } catch (e) { toRenderer("job:error", { error: e.message }); return { ok: false, error: e.message }; }
});
// режим «своё видео»: выбрать готовый файл → титры+музыка+перебивки
ipcMain.handle("video:createOwn", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: [{ name: "Видео", extensions: ["mp4", "mov", "m4v", "webm", "mkv"] }] });
  if (r.canceled || !r.filePaths[0]) return { ok: true, canceled: true };
  toRenderer("job:start", { source: "app", text: "своё видео: " + r.filePaths[0].split("/").pop() });
  try {
    const cfg = await loadConfig();
    const rr = await generateVideo({ script: "", config: { ...cfg, videoMode: "ownvideo", sourceVideo: r.filePaths[0] }, onProgress: (p) => toRenderer("job:progress", p) });
    if (cfg.telegramToken && cfg.telegramChatId) sendDocument(cfg.telegramToken, cfg.telegramChatId, rr.outPath, "Готово ✅").catch(() => {});
    toRenderer("job:done", { outPath: rr.outPath, source: "app" });
    return { ok: true, outPath: rr.outPath, sentToTg: !!(cfg.telegramToken && cfg.telegramChatId) };
  } catch (e) { toRenderer("job:error", { error: e.message }); return { ok: false, error: e.message }; }
});
ipcMain.handle("video:reveal", async (_e, p) => { shell.showItemInFolder(p); });
ipcMain.handle("video:delete", async (_e, p) => {
  try { await fs.rm(p, { force: true }); await fs.rm(p.replace(/\.mp4$/, ".json"), { force: true }); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
// открыть папки контента (чтобы кидать свои клипы/музыку/звуки)
ipcMain.handle("content:open", async (_e, which) => {
  await ensureFolders(P);
  const map = { content: P.content, videos: P.videos, music: P.music, sounds: P.sounds, output: P.output };
  shell.openPath(map[which] || P.content);
});
// --- навигация по папкам «Мой контент» (как в Finder, с проектами) ---
const VID_EXT = /\.(mp4|mov|m4v|webm|mkv)$/i;
const AUD_EXT = /\.(mp3|wav|m4a|aac|ogg)$/i;
const FILTERS = {
  videos: [{ name: "Видео", extensions: ["mp4", "mov", "m4v", "webm", "mkv"] }],
  music: [{ name: "Аудио", extensions: ["mp3", "wav", "m4a", "aac", "ogg"] }],
  sounds: [{ name: "Аудио", extensions: ["mp3", "wav", "m4a", "aac", "ogg"] }],
};
// rel — путь относительно «Мой контент»; не даём выйти за пределы
const safeJoin = (rel) => {
  const full = path.resolve(P.content, rel || "");
  if (full !== P.content && !full.startsWith(P.content + path.sep)) return P.content;
  return full;
};
const catOf = (rel) => { const top = String(rel || "").split(path.sep)[0]; return top === "Видео" ? "videos" : top === "Музыка" ? "music" : top === "Звуки" ? "sounds" : null; };

ipcMain.handle("content:browse", async (_e, rel = "") => {
  await ensureFolders(P);
  const dir = safeJoin(rel);
  const cat = catOf(rel);
  const ext = cat === "videos" ? VID_EXT : (cat ? AUD_EXT : null);
  let entries = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch {}
  const folders = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => ({ name: e.name, rel: path.join(rel, e.name) }));
  const meta = cat === "videos" ? await readMeta(dir) : {};
  const fileEnts = entries.filter((e) => e.isFile() && !e.name.startsWith(".") && (!ext || ext.test(e.name)));
  const files = await Promise.all(fileEnts.map(async (e) => {
    const full = path.join(dir, e.name); const st = await fs.stat(full).catch(() => ({ size: 0 }));
    const thumb = cat === "videos" ? await thumbDataUrl(full, path.join(dir, `.${e.name}.thumb.jpg`), 1) : null;
    const m = meta[e.name] || {};
    return { name: e.name, path: full, size: st.size, thumb, kind: cat, title: m.title || "", description: m.description || "" };
  }));
  return { rel, category: cat, folders, files };
});
ipcMain.handle("content:mkdir", async (_e, rel, name) => {
  const clean = String(name || "").replace(/[\/\\:*?"<>|]/g, "").trim();
  if (!clean) return { ok: false, error: "Пустое имя" };
  try { await fs.mkdir(path.join(safeJoin(rel), clean), { recursive: true }); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("content:addTo", async (_e, rel) => {
  const cat = catOf(rel);
  if (!cat) return { ok: false, error: "Сначала зайди в Видео, Музыка или Звуки" };
  const r = await dialog.showOpenDialog(win, { properties: ["openFile", "multiSelections"], filters: FILTERS[cat] || [] });
  if (r.canceled) return { ok: true, added: 0 };
  const dir = safeJoin(rel); let added = 0;
  for (const src of r.filePaths) { try { await fs.copyFile(src, path.join(dir, path.basename(src))); added += 1; } catch {} }
  return { ok: true, added };
});
ipcMain.handle("content:setClipMeta", async (_e, filePath, patch) => {
  const dir = path.dirname(filePath); const name = path.basename(filePath);
  const meta = await readMeta(dir); meta[name] = { ...(meta[name] || {}), ...patch };
  await writeMeta(dir, meta);
  return { ok: true };
});
ipcMain.handle("content:removeFile", async (_e, p) => { try { await fs.rm(p, { force: true }); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } });

// --- проекты (у каждого свои Видео/Музыка/Звуки) ---
ipcMain.handle("projects:list", async () => {
  await ensureFolders(P);
  const cfg = await loadConfig();
  return { projects: await listProjects(P), active: cfg.activeProject || "" };
});
ipcMain.handle("projects:create", async (_e, name) => {
  try {
    const clean = await createProject(name, P);
    const cfg = await loadConfig(); cfg.activeProject = clean; await saveConfig(cfg);
    return { ok: true, name: clean };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("projects:setActive", async (_e, name) => {
  const cfg = await loadConfig(); cfg.activeProject = name || ""; await saveConfig(cfg);
  return { ok: true };
});

// брендбук: загрузить свой шрифт для титров
ipcMain.handle("brand:setFont", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: [{ name: "Шрифты", extensions: ["ttf", "otf"] }] });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  const src = r.filePaths[0];
  try {
    await fs.copyFile(src, FONT_PATH);
    const cfg = await loadConfig();
    cfg.fontPath = FONT_PATH; cfg.fontName = path.basename(src);
    await saveConfig(cfg);
    return { ok: true, fontName: cfg.fontName };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("brand:clearFont", async () => {
  const cfg = await loadConfig(); cfg.fontPath = ""; cfg.fontName = ""; await saveConfig(cfg);
  await fs.rm(FONT_PATH, { force: true }).catch(() => {});
  return { ok: true };
});
ipcMain.handle("video:list", async () => {
  await ensureFolders(P);
  const out = [];
  const walk = async (dir) => {
    let ents = [];
    try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith(".mp4")) {
        const st = await fs.stat(full).catch(() => ({ size: 0, mtimeMs: 0 }));
        let meta = {};
        try { meta = JSON.parse(await fs.readFile(full.replace(/\.mp4$/, ".json"), "utf8")); } catch {}
        const thumb = await thumbDataUrl(full, full.replace(/\.mp4$/, ".jpg"), 1);
        const created = meta.created || new Date(st.mtimeMs).toISOString();
        out.push({ path: full, name: e.name, size: st.size, mtime: st.mtimeMs, thumb, title: meta.title || null, description: meta.description || "", duration: meta.duration || null, created, date: created.slice(0, 10) });
      }
    }
  };
  await walk(P.output);
  return out.sort((a, b) => b.mtime - a.mtime);
});
// редактирование названия/описания готового видео
ipcMain.handle("video:meta:set", async (_e, p, patch) => {
  const jsonPath = p.replace(/\.mp4$/, ".json");
  let meta = {}; try { meta = JSON.parse(await fs.readFile(jsonPath, "utf8")); } catch {}
  meta = { ...meta, ...patch };
  await fs.writeFile(jsonPath, JSON.stringify(meta, null, 2)).catch(() => {});
  return { ok: true };
});

app.whenReady().then(async () => {
  await ensureFolders(P);
  createWindow();
  createTray();
  setupAutoUpdate();
  await restartBot();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else win.show(); });
});
app.on("window-all-closed", () => { /* живём в трее */ });
