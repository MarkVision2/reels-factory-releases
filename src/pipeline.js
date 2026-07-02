// Полный пайплайн «ТЗ -> видео» (локально, без облака):
//   текст -> озвучка -> блоки -> подбор (локальные клипы + Pexels) -> ffmpeg -> mp4 в «Готовые видео».
import { promises as fs } from "node:fs";
import path from "node:path";
import { synthesize, blocksFromWords, sanitizeWords, cleanCaptionText } from "./tts.js";
import { buildSegments } from "./match.js";
import { renderFaceless, renderAvatar, downloadTo, enhanceVoice, ffprobeDuration } from "./render-core.js";
import { paths, ensureFolders, buildLocalCatalog, pickMusic, listSounds, readProjectBrief } from "./local-content.js";
import { generateAvatarVideo, uploadAudio } from "./heygen.js";
import { transcribeWithWords } from "./stt.js";
import { synthesizeFreedom, synthesizeFreedomClone, evenWords } from "./freedom-tts.js";

export const generateVideo = async ({ script, config = {}, onProgress = () => {} }) => {
  const {
    elevenKey, voiceId = "IKne3meq5aSn9XLyUdCD",
    voiceProvider = "elevenlabs", freedomKey = "", freedomVoice = "tomiris", freedomEmotion = "neutral", freedomLanguage = "",
    freedomClone = false, freedomCloneRef = "",
    voiceModel = "eleven_multilingual_v2", voiceStability, voiceStyle, voiceSimilarity, voiceSpeakerBoost,
    openaiKey = null, pexelsKey = null,
    musicUrl = null, musicVolume = 0.12, // энергичнее; под голосом music дакается сайдчейном
    genProvider = "none", falKey = "", falModel = "kling", genMax = 2, kieKey = "", kieModel = "veo3_fast",
    fontPath = null, accentColor = null, activeProject = "",
    videoMode = "faceless", heygenKey = "", heygenAvatarId = "", heygenVoiceId = "",
    voiceAudioPath = null, voiceEnhance = false, transitionSfx = false,
    template = null,
  } = config;
  // стиль-шаблон с референса (если выбран активный): титры/темы биролов
  const capPosition = template?.captions?.position || "bottom";
  const capSize = template?.captions?.sizePct || 6.0; // крупнее = «панч» под reels
  const accent = (template?.captions?.color) || accentColor;
  const themeBias = Array.isArray(template?.broll?.themes) ? template.broll.themes : [];
  let gen = null;
  if (genProvider === "fal" && falKey) gen = { provider: "fal", key: falKey, model: falModel, max: Number(genMax) || 2 };
  else if (genProvider === "kie" && kieKey) gen = { provider: "kie", key: kieKey, model: kieModel, max: Number(genMax) || 2 };

  const P = paths();
  await ensureFolders(P);
  // бриф активного проекта: ниша рулит подбором биролов, cta — текстом плашки-призыва
  const brief = await readProjectBrief(activeProject, P);
  // конфиг оверлея: если призыв проекта задан и юзер не переопределил CTA-кнопку — берём его
  const overlayConfig = (brief.cta && !config.ctaButton) ? { ...config, ctaButton: brief.cta } : config;
  const workDir = await fs.mkdtemp(path.join((await import("node:os")).tmpdir(), "reel-"));
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const dateFolder = now.toISOString().slice(0, 10); // ГГГГ-ММ-ДД
  const outDir = path.join(P.output, dateFolder);
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `reel-${stamp}.mp4`);

  // Озвучка сценария выбранным провайдером → { voicePath, words, blocks, vdur }.
  // ElevenLabs отдаёт таймкоды слов сразу; Freedom Speech — нет, поэтому слова достаём
  // распознаванием (STT), а если ключа ElevenLabs нет — раскладываем равномерно.
  const useFreedom = voiceProvider === "freedom" && freedomKey;
  const ttsScript = async (text) => {
    if (useFreedom) {
      const outMp3 = path.join(workDir, "voice.mp3");
      const fr = (freedomClone && freedomCloneRef)
        ? await synthesizeFreedomClone({ text, apiKey: freedomKey, refPath: freedomCloneRef, language: freedomLanguage, outPath: outMp3, onProgress })
        : await synthesizeFreedom({ text, apiKey: freedomKey, voice: freedomVoice, emotion: freedomEmotion, language: freedomLanguage, outPath: outMp3, onProgress });
      let words = [];
      if (elevenKey) {
        try {
          const buf = await fs.readFile(fr.voicePath);
          const lang = /[әғқңөұүһі]/i.test(text) ? "kaz" : "rus"; // казахский ↔ русский для титров
          words = sanitizeWords((await transcribeWithWords({ audioBuffer: buf, apiKey: elevenKey, language: lang })).words);
        } catch { /* STT не вышло — ниже равномерный фолбэк */ }
      }
      if (!words.length) words = evenWords(text, fr.vdur);
      const vdur = words.length ? words[words.length - 1].t + words[words.length - 1].d : fr.vdur;
      return { voicePath: fr.voicePath, words, blocks: blocksFromWords(words), vdur };
    }
    return synthesize({
      text, apiKey: elevenKey, voiceId, model: voiceModel,
      voiceSettings: { stability: Number(voiceStability), similarity: Number(voiceSimilarity), style: Number(voiceStyle), speakerBoost: voiceSpeakerBoost },
      outPath: path.join(workDir, "voice.mp3"),
    });
  };

  // --- РЕЖИМ АВАТАР (HeyGen) / СВОЁ ВИДЕО — монтаж поверх готового говорящего видео ---
  const isAvatar = videoMode === "avatar" && heygenKey && heygenAvatarId;
  // «Бешеный монтаж»: своё видео + Remotion-движок (караоке-титры, моушн-врезки, CTA), без ASS.
  const isDynamic = videoMode === "dynamic" && config.sourceVideo;
  const isOwnVideo = (videoMode === "ownvideo" || isDynamic) && config.sourceVideo;
  if (isAvatar || isOwnVideo) {
    try {
      let avatarPath; let words = [];
      if (isAvatar) {
        // 1. озвучка выбранным провайдером — даёт и голос, и таймкоды титров
        onProgress({ step: "tts", label: useFreedom ? "Озвучка Freedom Speech…" : "Озвучка ElevenLabs…" });
        const tts = await ttsScript(script);
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
      // биролы-перебивки из папок: каждый 2-й блок перекрываем клипом.
      // В «Бешеном монтаже» (dynamic) НЕ используем — там весь монтаж через Remotion.
      const inserts = [];
      if (!isDynamic) try {
        const blocks = blocksFromWords(words);
        const vdur = words.length ? words[words.length - 1].t + words[words.length - 1].d : 0;
        // ЭКСПЕРТНЫЙ МОНТАЖ: биролы-перебивки на БОЛЬШИНСТВЕ блоков (кроме первого — там аватар
        // «представляется»), распределены по всей длине, до 14 шт; между ними аватар проглядывает.
        const insBlocks = blocks.filter((b, i) => i > 0).slice(0, 14);
        if (insBlocks.length) {
          onProgress({ step: "broll", label: "Подбираю биролы по смыслу…" });
          const catalog = await buildLocalCatalog({ p: P, project: activeProject, openaiKey }).catch(() => []);
          const segs = await buildSegments({ blocks: insBlocks, vdur, catalog, openaiKey, pexelsKey, gen, themeBias, brief });
          for (const s of segs) {
            let cp = s.clip_path;
            if (!cp && s.clip_url) { cp = path.join(workDir, `ins${inserts.length}.mp4`); try { await downloadTo(s.clip_url, cp); } catch { cp = null; } }
            if (cp) {
              const st = Number(s.start);
              // перебивка ~2.8с (но не длиннее блока) — покрывает мысль, аватар возвращается между
              const en = Math.min(Number(s.end) - 0.15, st + 2.8);
              if (en > st + 0.6) inserts.push({ start: st, end: en, path: cp });
            }
          }
        }
      } catch {}
      const musicPath = await pickMusic(P, activeProject);
      onProgress({ step: "render", label: "Монтирую видео…" });
      // Титры: в «Бешеном монтаже» — Remotion-караоке (красиво, в оверлее); в обычном «своём видео» — ASS.
      const r = await renderAvatar({ workDir, avatarPath, words, inserts, musicPath, musicVolume, fontPath, accentColor: accent, capPosition, capSize, captionMode: isDynamic ? "none" : "ass", outPath });

      // --- Анимированный оверлей: моушн-графика-врезки (числа/списки) + CTA поверх монтажа ---
      // Титры уже вшиты ASS в renderAvatar → в оверлее их не дублируем (chunks: []).
      if (isDynamic || config.remotionOverlay !== false) {
        try {
          const { renderOverlay, compositeOverlay } = await import("./remotion-overlay.js");
          const { buildOverlaySpec } = await import("./overlay-spec.js");
          const oBlocks = blocksFromWords(words);
          const oVdur = words.length ? words[words.length - 1].t + words[words.length - 1].d : r.duration;
          const spec = buildOverlaySpec({ words, blocks: oBlocks, vdur: oVdur, config: overlayConfig });
          // в «Бешеном монтаже» титры рисует Remotion (караоке); в «своём видео» — ASS, тут пусто
          const oChunks = isDynamic ? spec.chunks : [];
          if (spec.inserts.length || spec.cta || oChunks.length) {
            const overlayWebm = path.join(workDir, "overlay.webm");
            const oParts = await renderOverlay({
              chunks: oChunks, cta: spec.cta, inserts: spec.inserts,
              fps: 30, width: 1080, height: 1920, scale: 0.7,
              durationSec: r.duration, accent: accent || "#facc15",
              capPosition: config.remotionCapPosition || "bottom",
              outPath: overlayWebm, onProgress,
            });
            const tmpFinal = path.join(workDir, "final.mp4");
            await compositeOverlay({ basePath: outPath, parts: oParts, outPath: tmpFinal });
            await fs.copyFile(tmpFinal, outPath);
          }
        } catch (e) {
          console.error("[overlay-fail]", e?.stack || e?.message || e); // в stdout — для диагностики
          onProgress({ step: "remotion", label: "Оверлей пропущен: " + (e?.message || e) });
        }
      }

      const transcript = words.map((w) => w.w).join(" ");
      const cleanScript = cleanCaptionText(script) || transcript; // без разметки озвучки
      const title = cleanScript.split("\n").map((s) => s.trim()).filter(Boolean)[0]?.slice(0, 60) || (isAvatar ? "Аватар" : "Своё видео");
      await fs.writeFile(outPath.replace(/\.mp4$/, ".json"), JSON.stringify({ title, script: cleanScript, created: new Date().toISOString(), duration: r.duration, mode: videoMode }, null, 2)).catch(() => {});
      onProgress({ step: "done", label: "Готово", outPath });
      return { ...r, outPath };
    } finally {
      fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  try {
    let voicePath, words, blocks, vdur;
    if (voiceAudioPath) {
      // СВОЯ ОЗВУЧКА: берём аудио пользователя, распознаём слова для титров и таймингов перебивок
      voicePath = voiceAudioPath;
      if (voiceEnhance) {
        // «студийный звук»: шумодав + нормализация громкости
        onProgress({ step: "enhance", label: "Чищу звук (студийный)…" });
        const clean = path.join(workDir, "voice-clean.wav");
        try { await enhanceVoice(voiceAudioPath, clean); voicePath = clean; } catch {}
      }
      onProgress({ step: "captions", label: "Распознаю вашу озвучку…" });
      const buf = await fs.readFile(voicePath);
      const tr = await transcribeWithWords({ audioBuffer: buf, apiKey: elevenKey });
      words = tr.words || [];
      if (!words.length) throw new Error("Не разобрал озвучку. Проверь ключ ElevenLabs и качество записи.");
      blocks = blocksFromWords(words);
      vdur = words[words.length - 1].t + words[words.length - 1].d;
    } else {
      onProgress({ step: "tts", label: useFreedom ? "Озвучка Freedom Speech…" : "Озвучиваю сценарий…" });
      ({ voicePath, words, blocks, vdur } = await ttsScript(script));
    }

    // ЗАЩИТА ОТ ОБРЫВА БИРОЛОВ/ТИТРОВ: таймкоды слов бывают короче реального аудио
    // (усечённый alignment ElevenLabs на длинном тексте) → vdur занижен, видеоряд и титры
    // обрываются на середине, а голос идёт дальше. Если аудио заметно длиннее таймкодов —
    // перезабираем ПОЛНЫЕ слова распознаванием всего голоса (титры на весь ролик); если STT
    // недоступно — хотя бы тянем vdur до реальной длины (последний бирол доигрывает хвост).
    try {
      const realDur = await ffprobeDuration(voicePath);
      if (realDur > vdur + 1.5) {
        onProgress({ step: "match", label: `Таймкоды короче аудио (${vdur.toFixed(0)}с/${realDur.toFixed(0)}с) — выравниваю титры` });
        if (elevenKey) {
          try {
            const buf = await fs.readFile(voicePath);
            const lang = /[әғқңөұүһі]/i.test(script || "") ? "kaz" : "rus";
            const full = sanitizeWords((await transcribeWithWords({ audioBuffer: buf, apiKey: elevenKey, language: lang })).words);
            const fullEnd = full.length ? full[full.length - 1].t + full[full.length - 1].d : 0;
            if (full.length && fullEnd > vdur + 1) { words = full; blocks = blocksFromWords(full); vdur = +fullEnd.toFixed(2); }
          } catch { /* STT не вышло — ниже фолбэк по длине */ }
        }
        if (realDur > vdur + 0.3) vdur = +realDur.toFixed(2);
      }
    } catch {}

    onProgress({ step: "match", label: "Подбираю кадры…" });
    const catalog = await buildLocalCatalog({ p: P, project: activeProject, openaiKey, onProgress }).catch(() => []);
    const segments = await buildSegments({ blocks, vdur, catalog, openaiKey, pexelsKey, gen, themeBias, brief, onProgress });
    if (!segments.some((s) => s.clip_path || s.clip_url)) {
      throw new Error("Нет кадров. Добавь свои клипы в папку «Мои видео/Видео» или вставь ключ Pexels в «Настройке».");
    }

    // музыка: своя из папки, иначе по URL, иначе без музыки
    let musicPath = await pickMusic(P, activeProject);
    if (!musicPath && musicUrl) {
      musicPath = path.join(workDir, "music.mp3");
      try { await downloadTo(musicUrl, musicPath); } catch { musicPath = null; }
    }
    // звуки-переходы по умолчанию ВЫКЛ (risers лепились не по теме) — включается флагом в настройках
    const sfxPaths = transitionSfx ? await listSounds(P, activeProject) : [];

    // гибрид Remotion: если титры рисует Remotion — в базовом монтаже ASS не жжём
    const remotionOn = config.remotionOverlay !== false;
    const wantRemotionCaps = remotionOn && config.remotionCaptions === true;
    onProgress({ step: "render", label: "Монтирую видео…" });
    const r = await renderFaceless({ workDir, segments, voicePath, words, musicPath, musicVolume, sfxPaths, fontPath, accentColor: accent, capPosition, capSize, captionMode: wantRemotionCaps ? "none" : "ass", outPath });

    // --- Гибрид: анимированный оверлей Remotion (титры + CTA) поверх монтажа ---
    if (remotionOn) {
      try {
        const { renderOverlay, compositeOverlay } = await import("./remotion-overlay.js");
        const { buildOverlaySpec } = await import("./overlay-spec.js");
        const spec = buildOverlaySpec({ words, blocks, vdur, config: overlayConfig });
        const overlayWebm = path.join(workDir, "overlay.webm");
        // титры Remotion — в нижней БЕЗОПАСНОЙ зоне Reels (не центр, но и не у самого низа под интерфейсом)
        const overlayCapPosition = config.remotionCapPosition || "bottom";
        const oParts = await renderOverlay({
          chunks: wantRemotionCaps ? spec.chunks : [],
          cta: spec.cta,
          inserts: spec.inserts,
          fps: 30, width: 1080, height: 1920, scale: 0.7,
          durationSec: r.duration, accent: accent || "#facc15", capPosition: overlayCapPosition,
          outPath: overlayWebm, onProgress,
        });
        const tmpFinal = path.join(workDir, "final.mp4");
        await compositeOverlay({ basePath: outPath, parts: oParts, outPath: tmpFinal });
        await fs.copyFile(tmpFinal, outPath);
      } catch (e) {
        // мягкий откат: оставляем базовое видео без оверлея
        onProgress({ step: "remotion", label: "Remotion-оверлей пропущен: " + (e?.message || e) });
      }
    }

    // описание ролика рядом с видео (для вкладки «Готовые видео»)
    const transcript = words.map((w) => w.w).join(" ");
    const srcText = (script && script.trim()) ? cleanCaptionText(script) : transcript; // титры/заголовок — без разметки
    const title = srcText.split("\n").map((s) => s.trim()).filter(Boolean)[0]?.slice(0, 60) || "Без названия";
    await fs.writeFile(outPath.replace(/\.mp4$/, ".json"),
      JSON.stringify({ title, script: srcText, created: new Date().toISOString(), duration: r.duration, clips: r.clips, mode: voiceAudioPath ? "faceless+voice" : "faceless" }, null, 2)).catch(() => {});

    onProgress({ step: "done", label: "Готово", outPath });
    return { ...r, outPath, words: words.length, segments: segments.length };
  } finally {
    fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
};
