// Озвучка через Freedom Speech (ALPS AI) — казахский / русский / др. TTS.
// POST https://freedomspeech.kz/v1/audio/speech  (header X-API-Key) → WAV 16-bit PCM mono.
// Особенности эндпоинта: нет таймкодов слов и лимит 1000 символов на запрос.
//   → текст режем на куски ≤900 симв. по границам предложений, синтезируем, склеиваем через ffmpeg в mp3.
//   → тайминги титров считаются отдельно (STT или равномерная раскладка) — см. pipeline.js.
import { promises as fs } from "node:fs";
import path from "node:path";
import { runFfmpeg } from "./render-core.js";
import { cleanCaptionText } from "./tts.js";

const FREEDOM_BASE = "https://freedomspeech.kz";
const MAX_CHARS = 900; // запас от лимита API в 1000 символов

// текст → массив кусков ≤max символов: режем по концам предложений, длинные — по словам.
export const chunkText = (text, max = MAX_CHARS) => {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];
  const out = [];
  let buf = "";
  const flush = () => { if (buf.trim()) out.push(buf.trim()); buf = ""; };
  const sentences = clean.match(/[^.!?…]+[.!?…]*\s*/g) || [clean];
  for (const s of sentences) {
    if (s.length > max) {
      flush();
      for (const w of s.split(" ")) {
        if ((buf + " " + w).trim().length > max) flush();
        buf = (buf ? buf + " " : "") + w;
      }
      flush();
      continue;
    }
    if ((buf + s).length > max) flush();
    buf += s;
  }
  flush();
  return out;
};

// один кусок текста → Buffer с WAV.
// Авто-фолбэк: taymas (и др. казах-онли голоса) не озвучивают русский → повтор с tomiris.
const synthChunk = async ({ text, apiKey, voice, emotion, language, _retried = false }) => {
  const body = { input: text, voice };
  if (emotion && emotion !== "neutral") body.emotion = emotion;
  if (language) body.language = language;
  const res = await fetch(`${FREEDOM_BASE}/v1/audio/speech`, {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    if (res.status === 400 && /Russian/i.test(t) && voice !== "tomiris" && !_retried) {
      return synthChunk({ text, apiKey, voice: "tomiris", emotion, language, _retried: true });
    }
    const hint = res.status === 401 ? " (проверь ключ Freedom Speech)" : res.status === 503 ? " (сервер озвучки недоступен)" : "";
    throw new Error(`Freedom Speech ${res.status}${hint}: ${t.slice(0, 160)}`);
  }
  return Buffer.from(await res.arrayBuffer());
};

// длительность WAV по заголовку: размер data-чанка / (sampleRate * каналы * байт-на-семпл)
const wavDuration = (buf) => {
  try {
    if (buf.slice(0, 4).toString("latin1") !== "RIFF") return 0;
    const channels = buf.readUInt16LE(22) || 1;
    const sampleRate = buf.readUInt32LE(24) || 24000;
    const bytesPerSample = (buf.readUInt16LE(34) || 16) / 8;
    let off = 12;
    while (off + 8 <= buf.length) {
      const id = buf.slice(off, off + 4).toString("latin1");
      const size = buf.readUInt32LE(off + 4);
      if (id === "data") return size / (sampleRate * channels * bytesPerSample);
      off += 8 + size + (size % 2);
    }
  } catch { /* битый заголовок — длительность посчитают по STT */ }
  return 0;
};

// несколько WAV → один mp3 (вшитый ffmpeg). Один кусок — транскод, несколько — concat.
const wavsToMp3 = async (wavs, outPath) => {
  const dir = path.dirname(outPath);
  if (wavs.length === 1) {
    await runFfmpeg(["-y", "-i", wavs[0], "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", "-q:a", "4", outPath], { label: "freedom-mp3" });
  } else {
    const listPath = path.join(dir, "freedom-list.txt");
    await fs.writeFile(listPath, wavs.map((w) => `file '${w.replace(/'/g, "'\\''")}'`).join("\n"));
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", "-q:a", "4", outPath], { label: "freedom-concat" });
  }
};

// text → { voicePath (mp3), vdur } — обычная озвучка пресет-голосом
export const synthesizeFreedom = async ({ text, apiKey, voice = "tomiris", emotion = "neutral", language = "", outPath, onProgress = () => {} }) => {
  if (!apiKey) throw new Error("Нет ключа Freedom Speech");
  const chunks = chunkText(text);
  if (!chunks.length) throw new Error("Пустой текст для озвучки");
  const dir = path.dirname(outPath);
  const wavs = [];
  let vdur = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    if (chunks.length > 1) onProgress({ step: "tts", label: `Озвучка Freedom Speech… (${i + 1}/${chunks.length})` });
    const buf = await synthChunk({ text: chunks[i], apiKey, voice, emotion, language });
    const wp = path.join(dir, `freedom-${i}.wav`);
    await fs.writeFile(wp, buf);
    wavs.push(wp);
    vdur += wavDuration(buf);
  }
  await wavsToMp3(wavs, outPath);
  return { voicePath: outPath, vdur: +vdur.toFixed(2) };
};

// Клонирование голоса: озвучка текста голосом из референс-аудио (refPath) или пресета (voiceId).
// text → { voicePath (mp3), vdur }. Эндпоинт /api/voice-clone (multipart), WAV на выходе.
export const synthesizeFreedomClone = async ({ text, apiKey, refPath = "", voiceId = "", language = "", outPath, onProgress = () => {} }) => {
  if (!apiKey) throw new Error("Нет ключа Freedom Speech");
  if (!refPath && !voiceId) throw new Error("Нет образца голоса для клонирования");
  const chunks = chunkText(text);
  if (!chunks.length) throw new Error("Пустой текст для озвучки");
  const dir = path.dirname(outPath);
  const refBuf = refPath ? await fs.readFile(refPath) : null;
  const refName = refPath ? path.basename(refPath) : "ref.wav";
  const wavs = [];
  let vdur = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    if (chunks.length > 1) onProgress({ step: "tts", label: `Озвучка (клон голоса)… (${i + 1}/${chunks.length})` });
    const form = new FormData();
    form.append("text", chunks[i]);
    if (language) form.append("language", language);
    if (refBuf) form.append("audio", new Blob([refBuf]), refName);
    else form.append("voice_id", voiceId);
    const res = await fetch(`${FREEDOM_BASE}/api/voice-clone`, {
      method: "POST", headers: { "X-API-Key": apiKey }, body: form,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Freedom клон ${res.status}: ${t.slice(0, 160)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const wp = path.join(dir, `clone-${i}.wav`);
    await fs.writeFile(wp, buf);
    wavs.push(wp);
    vdur += wavDuration(buf);
  }
  await wavsToMp3(wavs, outPath);
  return { voicePath: outPath, vdur: +vdur.toFixed(2) };
};

// Проверка ключа + предпрослушка: синтез короткой фразы → { ok, audio(base64 WAV), error }.
export const testFreedom = async ({ apiKey, voice = "tomiris", emotion = "neutral" }) => {
  if (!apiKey) return { ok: false, error: "нет ключа" };
  try {
    const body = { input: "Сәлеметсіз бе! Бұл — дауыс сынағы.", voice };
    if (emotion && emotion !== "neutral") body.emotion = emotion;
    const res = await fetch(`${FREEDOM_BASE}/v1/audio/speech`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      if (res.status === 401) return { ok: false, error: "неверный ключ" };
      if (res.status === 503) return { ok: false, error: "сервер озвучки временно недоступен" };
      return { ok: false, error: `ошибка ${res.status}${t ? ": " + t.slice(0, 80) : ""}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: true, audio: buf.toString("base64") };
  } catch (e) { return { ok: false, error: e.message }; }
};

// Живой список голосов с сервера (без авторизации): { ok, voices:[{id,name,type}] }.
export const listFreedomVoices = async () => {
  try {
    const res = await fetch(`${FREEDOM_BASE}/api/voices`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { ok: false, error: `ошибка ${res.status}` };
    const arr = await res.json();
    const voices = Array.isArray(arr)
      ? arr.filter((v) => v && v.id).map((v) => ({ id: v.id, name: v.name || v.id, type: v.type || "" }))
      : [];
    return { ok: true, voices };
  } catch (e) { return { ok: false, error: e.message }; }
};

// Фолбэк-тайминги без STT: равномерно размазать слова текста по длительности озвучки.
// Текст для титров чистим от разметки озвучки (+ ударение, теги).
export const evenWords = (text, vdur) => {
  const ws = cleanCaptionText(text).split(" ").filter(Boolean);
  if (!ws.length || !vdur) return [];
  const step = vdur / ws.length;
  return ws.map((w, i) => ({ w, t: +(i * step).toFixed(2), d: +(step * 0.95).toFixed(2) }));
};
