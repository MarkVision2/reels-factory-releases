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

// слова -> блоки (смысловые сегменты ~6.5с / по концу предложения)
const blocksFromWords = (words) => {
  const ends = (t) => /[.!?:]$/.test(t);
  const blocks = []; let s = null;
  for (const w of words) {
    if (!s) { s = { start: w.t, end: +(w.t + w.d).toFixed(2), text: w.w }; continue; }
    const dur = (w.t + w.d) - s.start;
    if (dur >= 6.5 || (ends(s.text) && dur >= 4)) {
      blocks.push(s); s = { start: w.t, end: +(w.t + w.d).toFixed(2), text: w.w };
    } else { s.end = +(w.t + w.d).toFixed(2); s.text += " " + w.w; }
  }
  if (s) blocks.push(s);
  return blocks;
};

// text -> { voicePath, words, blocks, vdur }
export const synthesize = async ({ text, apiKey, voiceId = "IKne3meq5aSn9XLyUdCD", outPath }) => {
  if (!apiKey) throw new Error("Нет ключа ElevenLabs");
  const res = await fetch(`${ELEVEN_BASE}/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  await fs.writeFile(outPath, Buffer.from(data.audio_base64, "base64"));
  const words = wordsFromAlignment(data.alignment || {});
  const blocks = blocksFromWords(words);
  const vdur = words.length ? +(words[words.length - 1].t + words[words.length - 1].d).toFixed(2) : 0;
  return { voicePath: outPath, words, blocks, vdur };
};
