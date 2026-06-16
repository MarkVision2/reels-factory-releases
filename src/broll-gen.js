// Генерация биролов ИИ-моделями. Провайдер FAL.ai = один ключ, много моделей
// (Kling / Veo / Runway / Luma и т.д. — выбираются model id). 9:16, ~5 сек.
// Десктоп = нет лимита 300с, поэтому генерим инлайн (медленно ~1-3 мин/клип, платно → есть лимит genMax).

const FAL_QUEUE = "https://queue.fal.run";

// готовые пресеты моделей (можно вписать любой свой model id)
export const FAL_MODELS = {
  "kling": "fal-ai/kling-video/v1.6/standard/text-to-video",
  "kling-pro": "fal-ai/kling-video/v2.1/master/text-to-video",
  "veo": "fal-ai/veo3/fast",
  "runway": "fal-ai/runway-gen3/turbo/text-to-video",
  "luma": "fal-ai/luma-dream-machine",
};

// единый стиль + защита ЦА (европейцы/среднеазиаты, маркетинг, без текста на экране)
const STYLE_SUFFIX =
  ", young european or central asian person, modern bright office, marketing context, cinematic, vertical 9:16, no on-screen text, no captions";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// FAL queue: submit -> poll -> result video url
const falGenerate = async ({ prompt, key, model, signal }) => {
  const modelId = FAL_MODELS[model] || model || FAL_MODELS.kling;
  const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };
  const submit = await fetch(`${FAL_QUEUE}/${modelId}`, {
    method: "POST", headers, signal,
    body: JSON.stringify({ prompt: prompt + STYLE_SUFFIX, aspect_ratio: "9:16", duration: "5" }),
  });
  if (!submit.ok) throw new Error(`FAL submit ${submit.status}: ${(await submit.text()).slice(0, 160)}`);
  const sub = await submit.json();
  const request_id = sub.request_id;
  const statusUrl = sub.status_url || `${FAL_QUEUE}/${modelId}/requests/${request_id}/status`;
  const resultUrl = sub.response_url || `${FAL_QUEUE}/${modelId}/requests/${request_id}`;
  // poll до 4 минут
  for (let i = 0; i < 80; i += 1) {
    await sleep(3000);
    const st = await fetch(statusUrl, { headers, signal });
    if (!st.ok) continue;
    const sd = await st.json();
    if (sd.status === "COMPLETED") {
      const r = await fetch(resultUrl, { headers, signal });
      const data = await r.json();
      const url = data.video?.url || data.videos?.[0]?.url || data.output?.video?.url;
      if (!url) throw new Error("FAL: нет видео в ответе");
      return url;
    }
    if (sd.status === "FAILED" || sd.status === "ERROR") throw new Error("FAL генерация упала");
  }
  throw new Error("FAL: таймаут генерации");
};

// единая точка: gen = {provider, key, model}. prompt — англ. визуальное описание.
export const generateBroll = async ({ prompt, gen, signal }) => {
  if (!gen || !gen.key) return null;
  if (gen.provider === "fal") return falGenerate({ prompt, key: gen.key, model: gen.model, signal });
  // место под другие провайдеры (прямой Veo/Runway API) — добавляется здесь
  return null;
};
