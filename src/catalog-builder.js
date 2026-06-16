// Сборка каталога из папки Google Drive: скачать клипы в кэш -> длительность -> теги -> catalog.json.
// Теги: GPT-4o Vision по кадру (если есть ключ OpenAI), иначе эвристика по имени файла.
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { listFolder, driveDownloadTo } from "./gdrive.js";
import { ffprobeDuration, ffmpegPath } from "./render-core.js";

const grabFrame = (videoPath, outJpg, at = 1) =>
  new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ["-y", "-ss", String(at), "-i", videoPath, "-frames:v", "1", "-q:v", "3", "-vf", "scale=480:-1", outJpg], { stdio: "ignore" });
    proc.on("close", () => resolve());
    proc.on("error", () => resolve());
  });

const SCREEN_RE = /(screen|скрин|экран|record|запис|дашборд|кабинет)/i;

const heuristicTag = (name) => {
  const base = name.replace(/\.[^.]+$/, "");
  if (SCREEN_RE.test(base)) return { type: "screen", fit: true, tags: ["скринкаст", "интерфейс"] };
  return { type: "work", fit: false, tags: base.split(/[\s_\-]+/).filter(Boolean).slice(0, 3) };
};

// GPT-4o Vision: классифицирует кадр
const visionTag = async (jpgPath, openaiKey) => {
  const b64 = (await fs.readFile(jpgPath)).toString("base64");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o", temperature: 0, response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content: [
          { type: "text", text: 'Классифицируй кадр для вертикального маркетингового Reels. JSON: {"type":"screen|work|people|lifestyle","fit":bool(true если это запись экрана/интерфейс),"tags":["3 русских слова по смыслу"],"dark_skinned_person":bool}. type=people если в кадре человек крупно, work если руки/ноутбук/рабочий стол, lifestyle если природа/успех/отдых, screen если интерфейс/дашборд.' },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI Vision ${res.status}`);
  const data = await res.json();
  const j = JSON.parse(data.choices[0].message.content);
  return { type: j.type || "work", fit: !!j.fit, tags: Array.isArray(j.tags) ? j.tags.slice(0, 3) : [], dark: !!j.dark_skinned_person };
};

// folderId -> catalog[] (+ локальный кэш клипов). onProgress({done,total,name}).
export const buildCatalog = async ({ folderId, googleApiKey, openaiKey = null, cacheDir, onProgress = () => {} }) => {
  await fs.mkdir(cacheDir, { recursive: true });
  const files = await listFolder(folderId, googleApiKey);
  const catalog = [];
  for (let i = 0; i < files.length; i += 1) {
    const f = files[i];
    onProgress({ done: i, total: files.length, name: f.name });
    const clipPath = path.join(cacheDir, `${f.id}.mp4`);
    try {
      const exists = await fs.stat(clipPath).then((s) => s.size > 1000).catch(() => false);
      if (!exists) await driveDownloadTo(f.id, clipPath);
      const dur = await ffprobeDuration(clipPath);
      let tag;
      if (openaiKey) {
        const jpg = path.join(cacheDir, `${f.id}.jpg`);
        await grabFrame(clipPath, jpg, Math.min(1, dur / 2));
        tag = await visionTag(jpg, openaiKey).catch(() => heuristicTag(f.name));
        fs.rm(jpg, { force: true }).catch(() => {});
      } else {
        tag = heuristicTag(f.name);
      }
      // помечаем темнокожих, чтобы matcher мог пропустить (правило ЦА)
      if (tag.dark) continue;
      catalog.push({ id: f.id.slice(0, 8), name: f.name, path: clipPath, dur: +dur.toFixed(2), type: tag.type, fit: tag.fit, tags: tag.tags });
    } catch (e) {
      onProgress({ done: i, total: files.length, name: f.name, error: e.message });
    }
  }
  onProgress({ done: files.length, total: files.length });
  return catalog;
};
