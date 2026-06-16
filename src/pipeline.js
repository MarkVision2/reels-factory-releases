// Полный пайплайн «ТЗ -> видео» (локально, без облака):
//   текст -> озвучка(ElevenLabs) -> блоки -> подбор клипов -> ffmpeg склейка+титры+музыка -> mp4.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { synthesize } from "./tts.js";
import { loadCatalog, buildSegments } from "./match.js";
import { renderFaceless, downloadTo } from "./render-core.js";

export const generateVideo = async ({ script, config = {}, onProgress = () => {} }) => {
  const {
    elevenKey, voiceId = "IKne3meq5aSn9XLyUdCD",
    openaiKey = null, pexelsKey = null,
    catalog = null, catalogUrl = null, musicUrl = null, musicVolume = 0.05,
    genProvider = "none", falKey = "", falModel = "kling", genMax = 2,
    outDir = path.join(os.homedir(), "ReelsFactory", "videos"),
  } = config;
  const gen = (genProvider === "fal" && falKey) ? { provider: "fal", key: falKey, model: falModel, max: Number(genMax) || 2 } : null;

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "reel-"));
  await fs.mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `reel-${stamp}.mp4`);

  try {
    onProgress({ step: "tts", label: "Озвучиваю сценарий…" });
    const { voicePath, words, blocks, vdur } = await synthesize({
      text: script, apiKey: elevenKey, voiceId, outPath: path.join(workDir, "voice.mp3"),
    });

    onProgress({ step: "match", label: "Подбираю кадры…" });
    const cat = (Array.isArray(catalog) && catalog.length)
      ? catalog
      : (catalogUrl ? await loadCatalog(catalogUrl).catch(() => []) : []);
    const segments = await buildSegments({ blocks, vdur, catalog: cat, openaiKey, pexelsKey, gen, onProgress });
    // понятная ошибка вместо краша, если кадры брать неоткуда
    if (!segments.some((s) => s.clip_path || s.clip_url)) {
      throw new Error("Нет источников кадров. Добавь в «Настройке» ключ Pexels, папку Google Drive или ИИ-генерацию.");
    }

    let musicPath = null;
    if (musicUrl) {
      musicPath = path.join(workDir, "music.mp3");
      try { await downloadTo(musicUrl, musicPath); } catch { musicPath = null; }
    }

    onProgress({ step: "render", label: "Монтирую видео…" });
    const r = await renderFaceless({ workDir, segments, voicePath, words, musicPath, musicVolume, outPath });

    onProgress({ step: "done", label: "Готово", outPath });
    return { ...r, outPath, words: words.length, segments: segments.length };
  } finally {
    fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
};
