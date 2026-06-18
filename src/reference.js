// Анализ видео-референса: ритм монтажа (ffmpeg) + «понимание» кадров (GPT-4o Vision) → стиль-профиль.
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { ffmpegPath, ffprobeDuration } from "./render-core.js";

// сцены: считаем склейки через детектор смены кадра → средняя длина плана, склеек/мин
const detectCuts = (filePath) =>
  new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ["-i", filePath, "-vf", "select='gt(scene,0.35)',showinfo", "-an", "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (c) => { err += c.toString(); });
    proc.on("close", () => {
      const times = [...err.matchAll(/pts_time:([0-9.]+)/g)].map((m) => Number(m[1])).filter((n) => !isNaN(n));
      resolve(times);
    });
    proc.on("error", () => resolve([]));
  });

// равномерно вытащить N кадров (512px) → [{b64, t}] (t — таймкод в видео, для последующей вырезки клипа)
const sampleFrames = async (filePath, duration, n, workDir) => {
  const frames = [];
  for (let i = 0; i < n; i += 1) {
    const t = duration * ((i + 0.5) / n);
    const out = path.join(workDir, `f${i}.jpg`);
    await new Promise((resolve) => {
      const proc = spawn(ffmpegPath, ["-y", "-ss", t.toFixed(2), "-i", filePath, "-frames:v", "1", "-vf", "scale=512:-1", "-q:v", "4", out], { stdio: "ignore" });
      proc.on("close", resolve); proc.on("error", resolve);
    });
    try { frames.push({ b64: (await fs.readFile(out)).toString("base64"), t: +t.toFixed(2) }); } catch {}
  }
  return frames;
};

const VISION_PROMPT = `Ты монтажёр коротких вертикальных видео (Reels/TikTok). Тебе дают кадры из видео-референса по порядку. Сначала определи ТЕМУ/НИШУ ролика по тому, что реально видишь. Опиши СТИЛЬ и КОНКРЕТНЫЕ биролы как JSON (только JSON, на русском в текстах):
{
 "topic": "ниша/тема ролика одной фразой (что это за видео)",
 "captions": {"present": true|false, "position": "bottom|center|top", "color": "#hex основного цвета титров", "style": "короткое описание (жирный гротеск, белый с чёрной обводкой и т.п.)", "animation": "pop|fade|karaoke|none", "sizePct": 4-9 (доля высоты экрана в %)},
 "transitions": "hard-cuts|fades|whip|zoom|mixed",
 "broll": {
   "shots": ["КОНКРЕТНО опиши КАЖДУЮ вставку/план который видишь на кадрах (5-10 шт), например: 'руки печатают на ноутбуке крупным планом', 'график роста на экране телефона', 'человек идёт по офису' — именно то что НА КАДРАХ, не абстрактно"],
   "themes": ["5-8 коротких ПОИСКОВЫХ тем под эту нишу для подбора похожих стоков, конкретно: не 'люди/город', а 'маркетолог за ноутбуком', 'реклама на смартфоне', 'команда в коворкинге'"],
   "style": "короткое описание визуала (цвета, свет, темп)"
 },
 "music": {"energy": "calm|medium|energetic"},
 "vibe": "1 фраза про общее впечатление",
 "notes": "1-2 совета как повторить этот стиль"
}
Если титров не видно — present:false. Цвет титров — hex доминирующего цвета текста. ВАЖНО: shots и themes — строго по тому что НА КАДРАХ и по нише, без общих слов.`;

const visionAnalyze = async ({ frames, pacingNote, apiKey, model = "gpt-4o" }) => {
  const content = [{ type: "text", text: VISION_PROMPT + "\n\nФакты по ритму: " + pacingNote }];
  for (const b64 of frames) content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}`, detail: "low" } });
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, response_format: { type: "json_object" }, max_tokens: 900, messages: [{ role: "user", content }] }),
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const d = await r.json();
  return JSON.parse(d.choices?.[0]?.message?.content || "{}");
};

// главный вход: видео → стиль-профиль (с ИИ если есть ключ, иначе только ритм)
export const analyzeReference = async ({ videoPath, openaiKey = null, onProgress = () => {} }) => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "ref-"));
  try {
    onProgress({ label: "Читаю видео…" });
    const duration = await ffprobeDuration(videoPath);
    onProgress({ label: "Считаю ритм монтажа…" });
    const cuts = await detectCuts(videoPath);
    const shots = cuts.length + 1;
    const avgShotSec = duration > 0 ? Number((duration / shots).toFixed(2)) : 0;
    const cutsPerMin = duration > 0 ? Math.round((cuts.length / duration) * 60) : 0;
    const intensity = avgShotSec && avgShotSec < 1.5 ? "fast" : avgShotSec < 2.8 ? "dynamic" : "calm";
    const pacing = { avgShotSec, cutsPerMin, shots, intensity };
    const pacingNote = `длительность ${duration.toFixed(1)}с, склеек ~${cuts.length} (≈${cutsPerMin}/мин), средний план ${avgShotSec}с, темп ${intensity}`;

    // кадры из референса (для показа пользователю — «вот что в видео») + для ИИ-анализа
    onProgress({ label: "Достаю кадры из видео…" });
    const nFrames = Math.min(12, Math.max(6, Math.round(duration / 1.5)));
    const frames = await sampleFrames(videoPath, duration, nFrames, workDir);

    let ai = null;
    if (openaiKey) {
      onProgress({ label: "Распознаю стиль (GPT-4o Vision)…" });
      try { ai = await visionAnalyze({ frames: frames.slice(0, 9).map((f) => f.b64), pacingNote, apiKey: openaiKey }); }
      catch (e) { ai = { _error: e.message }; }
    }

    // собираем профиль (значения ИИ + ритм; дефолты если ИИ не было)
    const cap = ai?.captions || {};
    const profile = {
      name: "",
      createdFrom: path.basename(videoPath),
      duration: Number(duration.toFixed(1)),
      pacing,
      captions: {
        present: cap.present !== false,
        position: ["bottom", "center", "top"].includes(cap.position) ? cap.position : "bottom",
        color: /^#?[0-9a-f]{6}$/i.test(String(cap.color || "").replace("#", "")) ? (cap.color.startsWith("#") ? cap.color : "#" + cap.color) : "#FFFFFF",
        style: cap.style || "жирный гротеск, белый",
        animation: ["pop", "fade", "karaoke", "none"].includes(cap.animation) ? cap.animation : "pop",
        sizePct: Number(cap.sizePct) >= 3 && Number(cap.sizePct) <= 10 ? Number(cap.sizePct) : 5.5,
      },
      transitions: ai?.transitions || (intensity === "fast" ? "hard-cuts" : "mixed"),
      topic: ai?.topic || "",
      broll: {
        shots: Array.isArray(ai?.broll?.shots) ? ai.broll.shots.slice(0, 10) : [],
        themes: Array.isArray(ai?.broll?.themes) ? ai.broll.themes.slice(0, 8) : [],
        style: ai?.broll?.style || "",
      },
      music: { energy: ai?.music?.energy || (intensity === "fast" ? "energetic" : "medium") },
      vibe: ai?.vibe || "",
      notes: ai?.notes || "",
      aiUsed: !!(openaiKey && ai && !ai._error),
      aiError: ai?._error || null,
      // кадры-превью из видео (с таймкодами) — показываем и даём выбрать для вырезки в свой контент
      frames: frames.map((f) => ({ src: `data:image/jpeg;base64,${f.b64}`, t: f.t })),
      sourcePath: videoPath, // исходник для последующей вырезки выбранных кусков
    };
    onProgress({ label: "Готово" });
    return profile;
  } finally {
    fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
};
