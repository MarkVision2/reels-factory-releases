// Подбор клипов под смысловые блоки. Работает в 2 режимах:
//  - с ключом OpenAI: GPT раскладывает скрины/свои клипы/европейский Pexels-сток;
//  - без ключа: эвристика по ключевым словам (только каталог) — для теста и офлайна.
import { pickPexelsVideo } from "./render-core.js";
import { generateBroll } from "./broll-gen.js";

export const loadCatalog = async (url) => {
  if (!url) return [];
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Каталог ${res.status}`);
  const j = await res.json();
  return j.clips || j;
};

const PRODUCT_RE = /(инструмент|автоматиз|запуск|реклам|отчёт|отчет|метрик|дашборд|кампани|клик|сервис|кнопк|систем|платформ)/i;
const FREEDOM_RE = /(свобод|успех|деньг|больше|меньше|результат|лайфстайл|отдых|путешеств|чек)/i;
const TEAM_RE = /(команд|эксперт|стратег|спикер|клиент|опыт|кейс)/i;

// Эвристическая раскладка ТОЛЬКО по каталогу (никакого внешнего стока).
const heuristicPicks = (blocks, cat) => {
  const screens = cat.filter((c) => c.type === "screen");
  const work = cat.filter((c) => c.type === "work");
  const people = cat.filter((c) => c.type === "people");
  const life = cat.filter((c) => c.type === "lifestyle");
  const pool = (arr, i) => arr.length ? arr[i % arr.length] : null;
  const picks = [];
  let si = 0, wi = 0, li = 0, pi = 0;
  blocks.forEach((b, i) => {
    const t = b.text;
    let c = null;
    if (PRODUCT_RE.test(t)) c = pool(screens, si++) || pool(work, wi++);
    else if (FREEDOM_RE.test(t)) c = pool(life, li++) || pool(work, wi++);
    else if (TEAM_RE.test(t)) c = pool(people, pi++) || pool(work, wi++);
    else c = pool(work, wi++) || pool(screens, si++);
    if (!c) c = cat[i % cat.length];
    picks.push({ i, id: c.id });
  });
  return picks;
};

// GPT-раскладка (если есть ключ OpenAI) — скрин / свой клип / европейский Pexels / ИИ-генерация.
const gptPicks = async (blocks, cat, openaiKey, genOn = false) => {
  const screens = cat.filter((c) => c.type === "screen").map((c) => `${c.id} (${(c.tags || []).join(", ")})`).join("; ");
  const own = cat.filter((c) => c.type !== "screen").map((c) => `${c.id} [${c.type}] ${(c.tags || []).slice(0, 3).join(", ")}`).join("; ");
  const segList = blocks.map((b, i) => `${i}: "${b.text}"`).join("\n");
  const prompt =
    'Ты монтажёр вертикальных Reels для маркетологов в Казахстане. Для КАЖДОГО сегмента выбери ОДИН источник. ВАРИАНТЫ:\n' +
    `- {"i":N,"screen":"screenX","in":сек} — продуктовая строка (инструмент/автоматизация/запуск/метрики/в один клик). Скрины: ${screens}\n` +
    `- {"i":N,"clip":"vX","in":сек} — наш безопасный клип: ${own}\n` +
    '- {"i":N,"query":"english stock search","must":["word"]} — свежий Pexels.\n' +
    (genOn ? '- {"i":N,"gen":"detailed english visual prompt"} — СГЕНЕРИРОВАТЬ кадр ИИ (для уникальных «геройских» планов, которых нет в стоке). Используй экономно, 1-2 на ролик.\n' : "") +
    'ЖЁСТКО ПО СТОКУ/ГЕНЕРАЦИИ: тема всегда маркетинг/бизнес. Если в кадре ЛЮДИ — query ОБЯЗАН начинаться с "young european caucasian" и описывать маркетолога/предпринимателя. Запрещены african/black/asian/indian/middle eastern. Примеры: "young european caucasian marketer laptop office", "european caucasian woman marketing meeting".\n' +
    'Микс источников, не повторяй соседние, скрины на продуктовые строки. Верни СТРОГО JSON {"picks":[...]} длиной как число сегментов.\n\nСЕГМЕНТЫ:\n' + segList;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o", temperature: 0.7, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content).picks || [];
};

// blocks -> segments[{start,end,text, clip_url|clip_path|broll, fit, in}]
// gen = {provider,key,model,max} — опциональная ИИ-генерация биролов (Kling/Veo через FAL).
export const buildSegments = async ({ blocks, vdur, catalog, openaiKey, pexelsKey, gen = null, onProgress = () => {} }) => {
  const byId = {}; for (const c of catalog) byId[c.id] = c;
  const genOn = !!(gen && gen.key);
  let picks;
  if (openaiKey && catalog.length) {
    try { picks = await gptPicks(blocks, catalog, openaiKey, genOn); }
    catch { picks = heuristicPicks(blocks, catalog); }
  } else {
    picks = heuristicPicks(blocks, catalog);
  }
  let genCount = 0; const genMax = gen?.max ?? 2;
  const pBy = {}; for (const p of picks) pBy[p.i] = p;
  const used = new Set();
  const segments = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i]; const p = pBy[i] || {};
    const start = b.start;
    const end = (i + 1 < blocks.length) ? blocks[i + 1].start : vdur;
    const segdur = end - start;
    const base = { start: +start.toFixed(2), end: +end.toFixed(2), text: b.text };
    const sc = p.screen && byId[p.screen] ? byId[p.screen] : null;
    const own = (!sc && p.clip && byId[p.clip]) ? byId[p.clip] : null;
    const cat = sc || own;
    if (cat) {
      let inp = Number(p.in) || 0; const maxin = Math.max(0, (cat.dur || 10) - segdur - 0.2); if (inp > maxin) inp = maxin;
      const srcKey = cat.path ? "clip_path" : "clip_url";
      segments.push({ ...base, [srcKey]: cat.path || cat.url, in: +inp.toFixed(2), fit: !!cat.fit });
      continue;
    }
    // ИИ-генерация бирола (Kling/Veo через FAL), под лимит бюджета
    if (p.gen && genOn && genCount < genMax) {
      onProgress({ step: "gen", label: `Генерирую кадр ИИ (${genCount + 1}/${genMax})…` });
      const url = await generateBroll({ prompt: p.gen, gen }).catch(() => null);
      if (url) { genCount += 1; segments.push({ ...base, clip_url: url, in: 0, fit: false }); continue; }
    }
    // свежий Pexels (европейцы), иначе безопасный каталожный клип
    if ((p.query || p.gen) && pexelsKey) {
      let q = p.query || p.gen;
      if (/(person|people|man|woman|men|women|marketer|businessman|entrepreneur|team|client|speaker)/i.test(q) && !/european|caucasian/i.test(q)) q = "young european caucasian " + q;
      const pex = await pickPexelsVideo(q, pexelsKey, used, p.must || []).catch(() => null);
      if (pex) { used.add(pex.id); segments.push({ ...base, clip_url: pex.url, in: 0, fit: false }); continue; }
    }
    // безопасный фолбэк: любой каталожный клип (предпочтительно не-скрин)
    const safePool = catalog.filter((c) => c.type !== "screen");
    const pool = safePool.length ? safePool : catalog;
    const fb = pool.length ? pool[i % pool.length] : null;
    if (fb) {
      const srcKey = fb.path ? "clip_path" : "clip_url";
      segments.push({ ...base, [srcKey]: fb.path || fb.url, in: 0, fit: !!fb.fit });
    } else {
      segments.push({ ...base, broll_query: "young european caucasian marketer office", broll_must: [] });
    }
  }
  return segments;
};
