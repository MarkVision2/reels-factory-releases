// Полный пайплайн «ТЗ -> видео» (локально, без облака):
//   текст -> озвучка -> блоки -> подбор (локальные клипы + Pexels) -> ffmpeg -> mp4 в «Готовые видео».
import { promises as fs } from "node:fs";
import path from "node:path";
import { synthesize, blocksFromWords } from "./tts.js";
import { buildSegments } from "./match.js";
import { renderFaceless, renderAvatar, downloadTo } from "./render-core.js";
import { paths, ensureFolders, buildLocalCatalog, pickMusic, listSounds } from "./local-content.js";
import { generateAvatarVideo, uploadAudio } from "./heygen.js";
import { transcribeWithWords } from "./stt.js";

export const generateVideo = async ({ script, config = {}, onProgress = () => {} }) => {
  const {
    elevenKey, voiceId = "IKne3meq5aSn9XLyUdCD",
    voiceModel = "eleven_multilingual_v2", voiceStability, voiceStyle, voiceSimilarity, voiceSpeakerBoost,
    openaiKey = null, pexelsKey = null,
    musicUrl = null, musicVolume = 0.05,
    genProvider = "none", falKey = "", falModel = "kling", genMax = 2,
    fontPath = null, accentColor = null, activeProject = "",
    videoMode = "faceless", heygenKey = "", heygenAvatarId = "", heygenVoiceId = "",
  } = config;
  const gen = (genProvider === "fal" && falKey) ? { provider: "fal", key: falKey, model: falModel, max: Number(genMax) || 2 } : null;

  const P = paths();
  await ensureFolders(P);
  const workDir = await fs.mkdtemp(path.join((await import("node:os")).tmpdir(), "reel-"));
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const dateFolder = now.toISOString().slice(0, 10); // ГГГГ-ММ-ДД
  const outDir = path.join(P.output, dateFolder);
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `reel-${stamp}.mp4`);

  // --- РЕЖИМ АВАТАР (HeyGen) / СВОЁ ВИДЕО — монтаж поверх готового говорящего видео ---
  const isAvatar = videoMode === "avatar" && heygenKey && heygenAvatarId;
  const isOwnVideo = videoMode === "ownvideo" && config.sourceVideo;
  if (isAvatar || isOwnVideo) {
    try {
      let avatarPath; let words = [];
      if (isAvatar) {
        // 1. живая озвучка ElevenLabs (динамичная) — даёт и голос, и точные таймкоды титров
        onProgress({ step: "tts", label: "Озвучка ElevenLabs…" });
        const tts = await synthesize({
          text: script, apiKey: elevenKey, voiceId, model: voiceModel,
          voiceSettings: { stability: Number(voiceStability), similarity: Number(voiceSimilarity), style: Number(voiceStyle), speakerBoost: voiceSpeakerBoost },
          outPath: path.join(workDir, "voice.mp3"),
        });
        words = tts.words;
        // 2. отдаём наш голос HeyGen — аватар синхронит губы (фолбэк: HeyGen озвучит сам)
        onProgress({ label: "HeyGen: загружаю голос…" });
        let url;
        try {
          const assetId = await uploadAudio(heygenKey, await fs.readFile(tts.voicePath));
          url = await generateAvatarVideo({ apiKey: heygenKey, avatarId: heygenAvatarId, audioAssetId: assetId, onProgress });
        } catch (e) {
          url = await generateAvatarVideo({ apiKey: heygenKey, avatarId: heygenAvatarId, voiceId: heygenVoiceId, text: script, onProgress });
        }
        onProgress({ step: "download", label: "Скачиваю аватара…" });
        avatarPath = path.join(workDir, "avatar.mp4");
        await downloadTo(url, avatarPath);
      } else {
        avatarPath = config.sourceVideo; // твоё загруженное видео
        onProgress({ step: "captions", label: "Распознаю речь…" });
        try { const buf = await fs.readFile(avatarPath); words = (await transcribeWithWords({ audioBuffer: buf, apiKey: elevenKey })).words; } catch {}
      }
      // биролы-перебивки: каждый 2-й смысловой блок перекрываем клипом
      const inserts = [];
      try {
        const blocks = blocksFromWords(words);
        const vdur = words.length ? words[words.length - 1].t + words[words.length - 1].d : 0;
        // перебивки на каждом блоке (кроме первого) — короткие (≤2.2с), аватар проглядывает между ними
        const insBlocks = blocks.filter((b, i) => i > 0).slice(0, 6);
        if (insBlocks.length) {
          onProgress({ step: "broll", label: "Подбираю перебивки…" });
          const catalog = await buildLocalCatalog({ p: P, project: activeProject, openaiKey }).catch(() => []);
          const segs = await buildSegments({ blocks: insBlocks, vdur, catalog, openaiKey, pexelsKey, gen });
          for (const s of segs) {
            let cp = s.clip_path;
            if (!cp && s.clip_url) { cp = path.join(workDir, `ins${inserts.length}.mp4`); try { await downloadTo(s.clip_url, cp); } catch { cp = null; } }
            if (cp) {
              const st = Number(s.start);
              const en = Math.min(Number(s.end) - 0.2, st + 2.2); // короткая перебивка
              if (en > st + 0.6) inserts.push({ start: st, end: en, path: cp });
            }
          }
        }
      } catch {}
      const musicPath = await pickMusic(P, activeProject);
      onProgress({ step: "render", label: "Монтирую видео…" });
      const r = await renderAvatar({ workDir, avatarPath, words, inserts, musicPath, musicVolume, fontPath, accentColor, outPath });
      const transcript = words.map((w) => w.w).join(" ");
      const title = (script || transcript).split("\n").map((s) => s.trim()).filter(Boolean)[0]?.slice(0, 60) || (isAvatar ? "Аватар" : "Своё видео");
      await fs.writeFile(outPath.replace(/\.mp4$/, ".json"), JSON.stringify({ title, script: script || transcript, created: new Date().toISOString(), duration: r.duration, mode: videoMode }, null, 2)).catch(() => {});
      onProgress({ step: "done", label: "Готово", outPath });
      return { ...r, outPath };
    } finally {
      fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  try {
    onProgress({ step: "tts", label: "Озвучиваю сценарий…" });
    const { voicePath, words, blocks, vdur } = await synthesize({
      text: script, apiKey: elevenKey, voiceId, model: voiceModel,
      voiceSettings: {
        stability: Number(voiceStability), similarity: Number(voiceSimilarity),
        style: Number(voiceStyle), speakerBoost: voiceSpeakerBoost,
      },
      outPath: path.join(workDir, "voice.mp3"),
    });

    onProgress({ step: "match", label: "Подбираю кадры…" });
    const catalog = await buildLocalCatalog({ p: P, project: activeProject, openaiKey, onProgress }).catch(() => []);
    const segments = await buildSegments({ blocks, vdur, catalog, openaiKey, pexelsKey, gen, onProgress });
    if (!segments.some((s) => s.clip_path || s.clip_url)) {
      throw new Error("Нет кадров. Добавь свои клипы в папку «Мои видео/Видео» или вставь ключ Pexels в «Настройке».");
    }

    // музыка: своя из папки, иначе по URL, иначе без музыки
    let musicPath = await pickMusic(P, activeProject);
    if (!musicPath && musicUrl) {
      musicPath = path.join(workDir, "music.mp3");
      try { await downloadTo(musicUrl, musicPath); } catch { musicPath = null; }
    }
    const sfxPaths = await listSounds(P, activeProject);

    onProgress({ step: "render", label: "Монтирую видео…" });
    const r = await renderFaceless({ workDir, segments, voicePath, words, musicPath, musicVolume, sfxPaths, fontPath, accentColor, outPath });

    // описание ролика рядом с видео (для вкладки «Готовые видео»)
    const title = script.split("\n").map((s) => s.trim()).filter(Boolean)[0] || "Без названия";
    await fs.writeFile(outPath.replace(/\.mp4$/, ".json"),
      JSON.stringify({ title, script, created: new Date().toISOString(), duration: r.duration, clips: r.clips }, null, 2)).catch(() => {});

    onProgress({ step: "done", label: "Готово", outPath });
    return { ...r, outPath, words: words.length, segments: segments.length };
  } finally {
    fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
};
