// Локальный контент: пользователь сам кладёт клипы/музыку/звуки в папки.
// Никакого Google Drive. Чего нет локально — добирается из Pexels (в match.js).
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { ffprobeDuration, ffmpegPath } from "./render-core.js";

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg)$/i;

export const paths = (root = path.join(os.homedir(), "ReelsFactory")) => ({
  root,
  content: path.join(root, "Мои видео"),
  videos: path.join(root, "Мои видео", "Видео"),
  music: path.join(root, "Мои видео", "Музыка"),
  sounds: path.join(root, "Мои видео", "Звуки"),
  output: path.join(root, "Готовые видео"),
  catalogCache: path.join(root, ".catalog-cache.json"),
});

export const ensureFolders = async (p = paths()) => {
  for (const dir of [p.videos, p.music, p.sounds, p.output]) await fs.mkdir(dir, { recursive: true });
  return p;
};

const listFiles = async (dir, re) => {
  try { return (await fs.readdir(dir)).filter((f) => re.test(f) && !f.startsWith(".")).map((f) => path.join(dir, f)); }
  catch { return []; }
};

// рекурсивный обход (включая вложенные папки-проекты)
const walk = async (dir, re, acc = []) => {
  let entries = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, re, acc);
    else if (re.test(e.name)) acc.push(full);
  }
  return acc;
};

const grabFrame = (videoPath, outJpg, at = 1) =>
  new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ["-y", "-ss", String(at), "-i", videoPath, "-frames:v", "1", "-q:v", "3", "-vf", "scale=480:-1", outJpg], { stdio: "ignore" });
    proc.on("close", () => resolve());
    proc.on("error", () => resolve());
  });

const SCREEN_RE = /(screen|скрин|экран|record|запис|дашборд|кабинет|интерфейс|сервис|приложени)/i;
const PEOPLE_RE = /(я |лицо|камер|говор|спикер|селфи|человек|эксперт|интервью)/i;
const LIFE_RE = /(природ|океан|море|путешеств|отдых|свобод|лайфстайл|город|небо)/i;
const classify = (text) => {
  if (SCREEN_RE.test(text)) return { type: "screen", fit: true };
  if (PEOPLE_RE.test(text)) return { type: "people", fit: false };
  if (LIFE_RE.test(text)) return { type: "lifestyle", fit: false };
  return { type: "work", fit: false };
};

// метаданные клипов (название/описание, заданные пользователем) — .content-meta.json в папке
export const metaPath = (dir) => path.join(dir, ".content-meta.json");
export const readMeta = async (dir) => { try { return JSON.parse(await fs.readFile(metaPath(dir), "utf8")); } catch { return {}; } };
export const writeMeta = async (dir, map) => { await fs.writeFile(metaPath(dir), JSON.stringify(map, null, 2)).catch(() => {}); };

const visionTag = async (jpgPath, openaiKey) => {
  const b64 = (await fs.readFile(jpgPath)).toString("base64");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o", temperature: 0, response_format: { type: "json_object" },
      messages: [{ role: "user", content: [
        { type: "text", text: 'Классифицируй кадр для вертикального маркетингового Reels. JSON: {"type":"screen|work|people|lifestyle","fit":bool(true для записи экрана/интерфейса),"tags":["3 русских слова"]}.' },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
      ] }],
    }),
  });
  if (!res.ok) throw new Error("vision");
  const j = JSON.parse((await res.json()).choices[0].message.content);
  return { type: j.type || "work", fit: !!j.fit, tags: Array.isArray(j.tags) ? j.tags.slice(0, 3) : [] };
};

// список проектов = подпапки в «Видео» (по ним же есть Музыка/Звуки)
export const listProjects = async (p = paths()) => {
  try {
    const ents = await fs.readdir(p.videos, { withFileTypes: true });
    return ents.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
  } catch { return []; }
};
export const createProject = async (name, p = paths(), brief = null) => {
  const clean = String(name || "").replace(/[\/\\:*?"<>|]/g, "").trim();
  if (!clean) throw new Error("Пустое имя");
  for (const d of [p.videos, p.music, p.sounds]) await fs.mkdir(path.join(d, clean), { recursive: true });
  if (brief && (brief.niche || brief.cta)) await writeProjectBrief(clean, brief, p);
  return clean;
};

// бриф проекта: ниша/направление + призыв. Лежит в .project.json внутри папки проекта.
// Ниша рулит подбором биролов (GPT-промпт) и текстом CTA — ролик затачивается под нишу.
export const projectBriefPath = (project, p = paths()) => path.join(p.videos, project, ".project.json");
export const readProjectBrief = async (project, p = paths()) => {
  if (!project) return {};
  try { return JSON.parse(await fs.readFile(projectBriefPath(project, p), "utf8")); } catch { return {}; }
};
export const writeProjectBrief = async (project, brief = {}, p = paths()) => {
  if (!project) return {};
  const dir = path.join(p.videos, project);
  await fs.mkdir(dir, { recursive: true });
  const clean = { niche: String(brief.niche || "").trim(), cta: String(brief.cta || "").trim() };
  await fs.writeFile(projectBriefPath(project, p), JSON.stringify(clean, null, 2)).catch(() => {});
  return clean;
};
const subOrRoot = (root, project) => (project ? path.join(root, project) : root);

// каталог из «Видео/<проект>» (или всё, если проект не задан)
export const buildLocalCatalog = async ({ p = paths(), project = "", openaiKey = null, onProgress = () => {} } = {}) => {
  const files = await walk(subOrRoot(p.videos, project), VIDEO_EXT); // рекурсивно внутри проекта
  // мета читаем по папке каждого файла
  const metaByDir = {};
  const getMeta = async (dir) => { if (!metaByDir[dir]) metaByDir[dir] = await readMeta(dir); return metaByDir[dir]; };
  // сигнатура (пути+размеры+описания) → если совпала, берём кэш
  const stats = await Promise.all(files.map((f) => fs.stat(f).then((s) => `${f}:${s.size}`).catch(() => "")));
  await Promise.all([...new Set(files.map((f) => path.dirname(f)))].map(getMeta));
  // vision-флаг в подписи: появился OpenAI-ключ → кэш без Vision-тегов инвалидируется, клипы
  // распознаются заново (иначе на «безымянных» клипах подбор идёт вслепую → биролы не в тему).
  const sig = stats.sort().join("|") + "##" + JSON.stringify(metaByDir) + "##vision:" + (openaiKey ? "1" : "0");
  const cacheFile = path.join(p.root, `.catalog-${project || "all"}.json`);
  try {
    const cache = JSON.parse(await fs.readFile(cacheFile, "utf8"));
    if (cache.sig === sig) return cache.catalog;
  } catch {}

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cat-"));
  const catalog = [];
  for (let i = 0; i < files.length; i += 1) {
    const f = files[i];
    const base = path.basename(f);
    onProgress({ done: i, total: files.length, name: base });
    try {
      const dur = await ffprobeDuration(f);
      const m = (metaByDir[path.dirname(f)] || {})[base] || {};
      const desc = (m.description || "").trim();
      const title = (m.title || "").trim() || base;
      let type, fit, tags;
      if (desc) {
        // ОПИСАНИЕ ПОЛЬЗОВАТЕЛЯ — приоритет (система понимает, что в клипе)
        const cl = classify(`${desc} ${title}`);
        type = cl.type; fit = cl.fit;
        tags = desc.split(/[\s,.;]+/).map((w) => w.toLowerCase()).filter((w) => w.length > 2).slice(0, 8);
      } else if (openaiKey) {
        const jpg = path.join(tmp, `f${i}.jpg`);
        await grabFrame(f, jpg, Math.min(1, dur / 2));
        const t = await visionTag(jpg, openaiKey).catch(() => null);
        if (t) { type = t.type; fit = t.fit; tags = t.tags; } else { const cl = classify(base); type = cl.type; fit = cl.fit; tags = []; }
      } else {
        const cl = classify(base); type = cl.type; fit = cl.fit;
        tags = base.replace(/\.[^.]+$/, "").split(/[\s_\-]+/).filter(Boolean).slice(0, 3);
      }
      catalog.push({ id: "loc" + i, name: title, file: base, path: f, dur: +dur.toFixed(2), type, fit, tags, desc });
    } catch {}
  }
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  await fs.writeFile(cacheFile, JSON.stringify({ sig, catalog })).catch(() => {});
  onProgress({ done: files.length, total: files.length });
  return catalog;
};

// длительности аудио с кэшем (чтобы не ffprobe-ить каждый раз)
const audioDurations = async (files, root) => {
  const cacheFile = path.join(root, ".audio-dur.json");
  let cache = {}; try { cache = JSON.parse(await fs.readFile(cacheFile, "utf8")); } catch {}
  const out = [];
  for (const f of files) {
    const st = await fs.stat(f).catch(() => null); if (!st) continue;
    const key = `${path.basename(f)}:${st.size}`;
    if (cache[key] === undefined) cache[key] = await ffprobeDuration(f);
    out.push({ f, dur: cache[key] });
  }
  await fs.writeFile(cacheFile, JSON.stringify(cache)).catch(() => {});
  return out;
};

// НЕ музыка, а звуковые эффекты/шумы — по названию файла (часы, тиканье, взрыв, riser,
// шестерёнки, сирена и т.п.). Такие давали «непонятный шум на фоне» вместо музыки.
const SFX_NAME = /(clock|tick|tik[\s_.-]?tak|tikay|chasy|час(ы|ик|о)|шестерен|shesteren|gear|riser|взрыв|vzryiv|bomb|explos|whoosh|свист|siren|alarm|beep|ding|unknown|noise|ambient|rain|wind|thunder)/i;

// фоновая музыка — полноценные треки (≥18с), БЕЗ звуковых эффектов/шумов.
// FALLBACK: если у активного проекта музыки нет — берём из ОБЩЕЙ библиотеки (все папки).
export const pickMusic = async (p = paths(), project = "") => {
  let files = await walk(subOrRoot(p.music, project), AUDIO_EXT);
  if (!files.length && project) files = await walk(p.music, AUDIO_EXT); // ← из всех папок
  files = files.filter((f) => !SFX_NAME.test(path.basename(f))); // выкинуть SFX/шумы
  if (!files.length) return null;
  const durs = await audioDurations(files, p.root);
  const tracks = durs.filter((d) => d.dur >= 18).map((d) => d.f);
  let pool = tracks.length ? tracks : files;
  // ПРИОРИТЕТ ЭНЕРГИЧНЫМ: сначала треки без пометок «медленный/chill» (slowed/reverb/lofi/…),
  // чтобы фон был бодрый и вовлекающий, а не убаюкивающий.
  const SLOW_NAME = /(slow|reverb|chill|lo[\s_-]?fi|ambient|calm|relax|sleep|acoustic|piano|медленн|спокойн)/i;
  const energetic = pool.filter((f) => !SLOW_NAME.test(path.basename(f)));
  if (energetic.length) pool = energetic;
  return pool[Math.floor((Date.now() / 1000) % pool.length)];
};

// звуки переходов — только короткие (≤8с). Тоже с fallback на общую библиотеку.
export const listSounds = async (p = paths(), project = "") => {
  let files = await walk(subOrRoot(p.sounds, project), AUDIO_EXT);
  if (!files.length && project) files = await walk(p.sounds, AUDIO_EXT);
  if (!files.length) return [];
  const durs = await audioDurations(files, p.root);
  const sfx = durs.filter((d) => d.dur > 0 && d.dur <= 8).map((d) => d.f);
  return sfx.length ? sfx : files;
};
