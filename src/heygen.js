// HeyGen — генерация видео с аватаром (говорящая голова) по тексту.
// API: /v2/voices (выбор голоса) → /v2/video/generate → /v1/video_status.get (поллинг).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// выбрать русский голос HeyGen (если voiceId не задан)
export const pickRussianVoice = async (apiKey) => {
  const res = await fetch("https://api.heygen.com/v2/voices", { headers: { "X-Api-Key": apiKey } });
  if (!res.ok) throw new Error(`HeyGen voices ${res.status}`);
  const data = await res.json();
  const voices = data?.data?.voices || [];
  const ru = voices.filter((v) => {
    const l = String(v.language || "").toLowerCase();
    return l.includes("russian") || l === "ru" || l.startsWith("ru-");
  });
  const pool = ru.length ? ru : voices;
  if (!pool.length) throw new Error("HeyGen: нет голосов");
  return pool[Math.floor((Date.now() / 1000) % pool.length)].voice_id;
};

// сгенерировать видео аватара → вернуть URL готового видео
export const generateAvatarVideo = async ({ apiKey, avatarId, voiceId, text, onProgress = () => {} }) => {
  if (!apiKey) throw new Error("Нет HeyGen API key");
  if (!avatarId) throw new Error("Нет HeyGen avatar_id");
  const vId = voiceId || await pickRussianVoice(apiKey);
  onProgress({ label: "HeyGen: создаю аватара…" });
  const gen = await fetch("https://api.heygen.com/v2/video/generate", {
    method: "POST",
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      video_inputs: [{
        character: { type: "avatar", avatar_id: avatarId, avatar_style: "normal" },
        voice: { type: "text", input_text: text, voice_id: vId },
      }],
      dimension: { width: 720, height: 1280 },
      quality: "high",
    }),
  });
  if (!gen.ok) throw new Error(`HeyGen generate ${gen.status}: ${(await gen.text()).slice(0, 200)}`);
  const videoId = (await gen.json())?.data?.video_id;
  if (!videoId) throw new Error("HeyGen: нет video_id");
  // поллинг до 10 минут
  for (let i = 0; i < 40; i += 1) {
    await sleep(15000);
    onProgress({ label: `HeyGen: рендерит аватара… (${i * 15}с)` });
    const st = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, { headers: { "X-Api-Key": apiKey } });
    if (!st.ok) continue;
    const sd = await st.json();
    const status = sd?.data?.status;
    if (status === "completed") return sd.data.video_url;
    if (status === "failed") throw new Error("HeyGen: рендер упал — " + JSON.stringify(sd?.data?.error || {}).slice(0, 160));
  }
  throw new Error("HeyGen: таймаут рендера");
};
