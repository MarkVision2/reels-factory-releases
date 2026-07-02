// Озвучка через ElevenLabs (with-timestamps) → mp3 + слова с таймкодами + смысловые блоки.
import { promises as fs } from "node:fs";

const ELEVEN_BASE = "https://api.elevenlabs.io/v1/text-to-speech";

// alignment (посимвольный) -> слова [{w,t,d}]
const wordsFromAlignment = (al) => {
  const chars = al.characters || [];
  const st = al.character_start_times_seconds || [];
  const en = al.character_end_times_seconds || [];
  const W = []; let cur = null;
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i];
    if (!c || !c.trim()) { if (cur) { W.push(cur); cur = null; } continue; }
    if (!cur) cur = { w: "", t: st[i], e: en[i] };
    cur.w += c; cur.e = en[i];
  }
  if (cur) W.push(cur);
  return W.map((w) => ({ w: w.w, t: +(w.t || 0).toFixed(2), d: +((w.e - w.t) || 0.3).toFixed(2) }));
};

// слова -> блоки (= склейки биролов). Короче блок → чаще смена кадра → динамичнее.
// ~4.5с на кадр (или по концу предложения от 3с) — живой темп reels, но без лавины загрузок.
export const blocksFromWords = (words) => {
  const ends = (t) => /[.!?:]$/.test(t);
  const blocks = []; let s = null;
  for (const w of words) {
    if (!s) { s = { start: w.t, end: +(w.t + w.d).toFixed(2), text: w.w }; continue; }
    const dur = (w.t + w.d) - s.start;
    if (dur >= 4.5 || (ends(s.text) && dur >= 3.0)) {
      blocks.push(s); s = { start: w.t, end: +(w.t + w.d).toFixed(2), text: w.w };
    } else { s.end = +(w.t + w.d).toFixed(2); s.text += " " + w.w; }
  }
  if (s) blocks.push(s);
  return blocks;
};

// Очистка текста для ТИТРОВ/заголовков: убираем управляющую разметку озвучки,
// которая не должна показываться на видео:
//   • знак ударения «+» перед буквой (+Юрий → Юрий)
//   • прозодийные/невербальные/брейк-теги (<pause>, <louder>…</louder>, <sigh>, <break …/>)
// ВНИМАНИЕ: применять ТОЛЬКО к титрам — в движок озвучки текст уходит с разметкой.
export const cleanCaptionText = (text) =>
  String(text || "")
    .replace(/<[^>]+>/g, " ")        // любые теги в угловых скобках
    .replace(/\+(?=\p{L})/gu, "")    // «+» как знак ударения перед буквой
    .replace(/\s+/g, " ")
    .trim();

// очистить слова титров (массив {w,t,d}) от разметки; пустые — выкинуть
export const sanitizeWords = (words) =>
  (words || []).map((x) => ({ ...x, w: cleanCaptionText(x.w) })).filter((x) => x.w);

// text -> { voicePath, words, blocks, vdur }
// voiceSettings: {stability, similarity, style, speakerBoost} — для живости/динамики.
export const synthesize = async ({ text, apiKey, voiceId = "IKne3meq5aSn9XLyUdCD", model = "eleven_multilingual_v2", voiceSettings = {}, outPath }) => {
  if (!apiKey) throw new Error("Нет ключа ElevenLabs");
  const vs = {
    stability: Number.isFinite(voiceSettings.stability) ? voiceSettings.stability : 0.4,
    similarity_boost: Number.isFinite(voiceSettings.similarity) ? voiceSettings.similarity : 0.75,
    style: Number.isFinite(voiceSettings.style) ? voiceSettings.style : 0.45,
    use_speaker_boost: voiceSettings.speakerBoost !== false,
  };
  const res = await fetch(`${ELEVEN_BASE}/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: model, voice_settings: vs }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  await fs.writeFile(outPath, Buffer.from(data.audio_base64, "base64"));
  // слова титров чистим от разметки (+ ударение, теги), таймкоды сохраняем
  const words = sanitizeWords(wordsFromAlignment(data.alignment || {}));
  const blocks = blocksFromWords(words);
  const vdur = words.length ? +(words[words.length - 1].t + words[words.length - 1].d).toFixed(2) : 0;
  return { voicePath: outPath, words, blocks, vdur };
};
