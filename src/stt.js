// Распознавание речи (голосовые сообщения боту) — ElevenLabs Speech-to-Text (scribe_v1).
export const transcribeAudio = async ({ audioBuffer, apiKey, language = "rus" }) => {
  if (!apiKey) throw new Error("Нет ключа ElevenLabs для распознавания");
  const form = new FormData();
  form.append("file", new Blob([audioBuffer]), "voice.ogg");
  form.append("model_id", "scribe_v1");
  if (language) form.append("language_code", language);
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST", headers: { "xi-api-key": apiKey }, body: form,
  });
  if (!res.ok) throw new Error(`STT ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  return (data.text || "").trim();
};

// распознать + вернуть слова с таймкодами (для титров на видео аватара)
export const transcribeWithWords = async ({ audioBuffer, apiKey, language = "rus" }) => {
  if (!apiKey) throw new Error("Нет ключа ElevenLabs для распознавания");
  const form = new FormData();
  form.append("file", new Blob([audioBuffer]), "voice.mp4");
  form.append("model_id", "scribe_v1");
  if (language) form.append("language_code", language);
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST", headers: { "xi-api-key": apiKey }, body: form,
  });
  if (!res.ok) throw new Error(`STT ${res.status}`);
  const data = await res.json();
  const words = (data.words || [])
    .filter((w) => w.type !== "spacing" && (w.text || "").trim())
    .map((w) => ({ w: w.text, t: +(w.start || 0).toFixed(2), d: +(((w.end || 0) - (w.start || 0)) || 0.3).toFixed(2) }));
  return { text: (data.text || "").trim(), words };
};
