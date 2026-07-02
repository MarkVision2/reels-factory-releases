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

// Эвристическая раскладка: каталог если есть, иначе — европейский Pexels-запрос (без краша на пустом каталоге).
const heuristicQuery = (t) =>
  PRODUCT_RE.test(t) ? "modern office laptop screen marketing dashboard"
  : FREEDOM_RE.test(t) ? "young european caucasian success lifestyle freedom"
  : TEAM_RE.test(t) ? "young european caucasian business team meeting office"
  : "young european caucasian marketer working laptop office";

const words = (s) => String(s || "").toLowerCase().replace(/[^a-zа-яё0-9\s]/gi, " ").split(/\s+/).filter((w) => w.length > 3);

// --- рандомизация выбора (чтобы клипы шли по смыслу, а НЕ в порядке папки) ---
const shuffle = (arr) => {
  const a = arr.slice();
  for (let k = a.length - 1; k > 0; k -= 1) { const j = Math.floor(Math.random() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; }
  return a;
};
const sample = (arr) => (arr.length ? arr[Math.floor(Math.random() * arr.length)] : null);
// случайный по весу: чем выше релевантность, тем вероятнее, но не всегда один и тот же
const weightedPick = (items, weightFn) => {
  const total = items.reduce((s, it) => s + weightFn(it), 0);
  if (total <= 0) return sample(items);
  let r = Math.random() * total;
  for (const it of items) { r -= weightFn(it); if (r <= 0) return it; }
  return items[items.length - 1];
};

const heuristicPicks = (blocks, cat) => {
  const used = new Set();
  // пул нужного типа — ПЕРЕМЕШАН, чтобы не брать всегда первый клип папки
  const byType = (t) => shuffle(cat.filter((c) => c.type === t && !used.has(c.id)));
  const picks = [];
  blocks.forEach((b, i) => {
    const bw = new Set(words(b.text));
    // 1) клип по совпадению ОПИСАНИЯ/тегов: собираем всех со счётом > 0
    const scored = [];
    for (const c of cat) {
      if (used.has(c.id)) continue;
      let score = 0;
      for (const w of words(`${c.desc} ${(c.tags || []).join(" ")} ${c.name}`)) if (bw.has(w)) score += 1;
      if (score > 0) scored.push({ c, score });
    }
    // среди релевантных выбираем СЛУЧАЙНО (вес = score², релевантные чаще, но начало варьируется)
    let best = scored.length ? weightedPick(scored, (s) => s.score * s.score).c : null;
    // 2) иначе по смыслу фразы (тип) — случайный из пула, 3) иначе Pexels
    if (!best) {
      const t = b.text;
      const cand = PRODUCT_RE.test(t) ? (byType("screen")[0] || byType("work")[0])
        : FREEDOM_RE.test(t) ? (byType("lifestyle")[0] || byType("work")[0])
        : TEAM_RE.test(t) ? (byType("people")[0] || byType("work")[0])
        : (byType("work")[0] || byType("screen")[0]);
      best = cand || null;
    }
    if (best) { used.add(best.id); picks.push(best.type === "screen" ? { i, screen: best.id } : { i, clip: best.id }); }
    else picks.push({ i, query: heuristicQuery(b.text), must: [] }); // нет подходящего локального → Pexels
  });
  return picks;
};

// GPT-раскладка (если есть ключ OpenAI) — скрин / свой клип / европейский Pexels / ИИ-генерация.
const gptPicks = async (blocks, cat, openaiKey, genOn = false, themeBias = [], brief = {}) => {
  // порядок перемешан, чтобы GPT не «якорился» на первый клип папки → начало роликов разное
  const shuffled = shuffle(cat);
  const screens = shuffled.filter((c) => c.type === "screen").map((c) => `${c.id} (${(c.tags || []).join(", ")})`).join("; ");
  const own = shuffled.filter((c) => c.type !== "screen").map((c) => `${c.id} [${c.type}] ${c.name}: ${c.desc || (c.tags || []).join(", ")}`).join("; ");
  const segList = blocks.map((b, i) => `${i}: "${b.text}"`).join("\n");
  const niche = String(brief?.niche || "").trim();
  // роль монтажёра и тема кадров задаются нишей проекта (если задана) — ролик под поиск клиентов этого направления
  const roleLine = niche
    ? `Ты монтажёр вертикальных Reels. НАПРАВЛЕНИЕ ПРОЕКТА: «${niche}». Цель ролика — привлечь клиентов в этом направлении. Для КАЖДОГО сегмента выбери ОДИН источник. ВАРИАНТЫ:\n`
    : 'Ты монтажёр вертикальных Reels для маркетологов в Казахстане. Для КАЖДОГО сегмента выбери ОДИН источник. ВАРИАНТЫ:\n';
  const themeLine = niche
    ? `ЖЁСТКО ПО СТОКУ/ГЕНЕРАЦИИ: тема кадров — «${niche}» (подбирай визуал строго под это направление, а не абстрактный офис). Если в кадре ЛЮДИ — query ОБЯЗАН начинаться с "young european caucasian" и описывать человека/сцену из этой ниши. Запрещены african/black/asian/indian/middle eastern.\n`
    : 'ЖЁСТКО ПО СТОКУ/ГЕНЕРАЦИИ: тема всегда маркетинг/бизнес. Если в кадре ЛЮДИ — query ОБЯЗАН начинаться с "young european caucasian" и описывать маркетолога/предпринимателя. Запрещены african/black/asian/indian/middle eastern. Примеры: "young european caucasian marketer laptop office", "european caucasian woman marketing meeting".\n';
  const prompt =
    roleLine +
    `- {"i":N,"screen":"screenX","in":сек} — продуктовая строка (инструмент/автоматизация/запуск/метрики/в один клик). Скрины: ${screens}\n` +
    `- {"i":N,"clip":"vX","in":сек} — наш безопасный клип: ${own}\n` +
    '- {"i":N,"query":"english stock query","must":["word"]} — свежий Pexels. query = КОНКРЕТНЫЙ предмет/действие ИМЕННО этих слов сегмента (что визуально показать под фразу), 2-5 слов в теме направления. У РАЗНЫХ сегментов — РАЗНЫЕ query (не повторяй один и тот же кадр).\n' +
    (genOn ? '- {"i":N,"gen":"detailed english visual prompt"} — СГЕНЕРИРОВАТЬ кадр ИИ (для уникальных «геройских» планов, которых нет в стоке). Используй экономно, 1-2 на ролик.\n' : "") +
    themeLine +
    (niche ? `РЕЛЕВАНТНОСТЬ ВАЖНЕЕ НАЛИЧИЯ: НЕ ставь локальный клип/скрин, если он НЕ подходит по смыслу сегмента и направлению «${niche}» — лучше поставь Pexels "query" в теме направления. Локальный клип — только когда он реально в тему. Абстрактные офис/компьютер/ноутбук НЕ годятся, если направление про другое (напр. медицина, стройка, авто).\n` : "") +
    (themeBias.length ? `ПРЕДПОЧТИТЕЛЬНЫЕ ТЕМЫ БИРОЛОВ (из референса пользователя): ${themeBias.join(", ")}. Старайся подбирать кадры в этих темах.\n` : "") +
    'СМЫСЛОВОЙ ПОДБОР (САМОЕ ВАЖНОЕ): каждый query — это ВИЗУАЛЬНАЯ МЕТАФОРА смысла фразы, а не общий кадр. Показывай ИМЕННО то, о чём говорят. Примеры мышления:\n' +
    '  • «маркетинговая воронка / система привлечения / поток заявок» → "sales funnel diagram animation", "marketing analytics dashboard rising graph", "business growth chart arrow up".\n' +
    '  • «пустые кабинеты / нет записи / простаивают» → "empty clinic hallway", "empty waiting room chairs", "empty office chair".\n' +
    '  • «мало пациентов / теряете деньги / сливаете бюджет» → "empty wallet no money", "empty clinic corridor", "money burning".\n' +
    '  • «поток пациентов / забиты записи / очередь» → "busy clinic reception patients queue", "full waiting room".\n' +
    '  • «сильные врачи / экспертность» → "confident doctor portrait", "surgeon team operating".\n' +
    '  • «реклама / таргет / креативы» → "social media ads on phone", "facebook ads manager screen".\n' +
    'Разложи КАЖДУЮ фразу на её образ и подбери кадр-иллюстрацию. Абстрактный офис — только если фраза реально про офис.\n' +
    (niche ? '"fallback": общий english сток-запрос В ТЕМЕ НАПРАВЛЕНИЯ (на случай если точечный query не найдёт видео) — напр. для медицины "modern medical clinic doctor patient".\n' : "") +
    'Микс источников, не повторяй соседние, скрины на продуктовые строки. ВАЖНО: варьируй ОТКРЫВАЮЩИЙ кадр — не начинай ролики одинаково, для первого сегмента выбирай разные подходящие по смыслу клипы. Верни СТРОГО JSON {"picks":[...]' + (niche ? ',"fallback":"..."' : "") + '} , picks длиной как число сегментов.\n\nСЕГМЕНТЫ:\n' + segList;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o", temperature: 0.7, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  return { picks: parsed.picks || [], fallback: String(parsed.fallback || "").trim() };
};

// blocks -> segments[{start,end,text, clip_url|clip_path|broll, fit, in}]
// gen = {provider,key,model,max} — опциональная ИИ-генерация биролов (Kling/Veo через FAL).
export const buildSegments = async ({ blocks, vdur, catalog, openaiKey, pexelsKey, gen = null, themeBias = [], brief = {}, onProgress = () => {} }) => {
  const byId = {}; for (const c of catalog) byId[c.id] = c;
  const genOn = !!(gen && gen.key);
  const hasNiche = !!String(brief?.niche || "").trim();
  let picks, nicheFallback = "";
  // gptPicks запускаем, если есть каталог ЛИБО задана ниша (тогда GPT сам сгенерит
  // сток-запросы в теме ниши — работает даже на ПУСТОМ проекте, только Pexels).
  if (openaiKey && (catalog.length || hasNiche)) {
    try { const g = await gptPicks(blocks, catalog, openaiKey, genOn, themeBias, brief); picks = g.picks; nicheFallback = g.fallback; }
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
      used.add(cat.id);
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
    // свежий Pexels (европейцы): точечный query → ретрай без must → niche-фолбэк
    const euroize = (q) => (/(person|people|man|woman|men|women|marketer|businessman|entrepreneur|team|client|speaker|doctor|patient|nurse)/i.test(q) && !/european|caucasian/i.test(q)) ? "young european caucasian " + q : q;
    if ((p.query || p.gen || nicheFallback) && pexelsKey) {
      const q0 = euroize(p.query || p.gen || nicheFallback);
      let pex = await pickPexelsVideo(q0, pexelsKey, used, p.must || [], openaiKey).catch(() => null);
      // не нашёл с must-словами → пробуем тот же запрос без ограничений
      if (!pex && (p.must || []).length) pex = await pickPexelsVideo(q0, pexelsKey, used, [], openaiKey).catch(() => null);
      // всё ещё пусто → общий запрос в теме ниши
      if (!pex && nicheFallback && q0 !== euroize(nicheFallback)) pex = await pickPexelsVideo(euroize(nicheFallback), pexelsKey, used, [], openaiKey).catch(() => null);
      if (pex) { used.add(pex.id); segments.push({ ...base, clip_url: pex.url, in: 0, fit: !!pex.fit }); continue; }
    }
    // безопасный фолбэк: СЛУЧАЙНЫЙ каталожный клип (предпочтительно не-скрин и не использованный)
    const freshSafe = catalog.filter((c) => c.type !== "screen" && !used.has(c.id));
    const freshAny = catalog.filter((c) => !used.has(c.id));
    const pool = freshSafe.length ? freshSafe
      : freshAny.length ? freshAny
      : (catalog.filter((c) => c.type !== "screen").length ? catalog.filter((c) => c.type !== "screen") : catalog);
    const fb = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    if (fb) {
      used.add(fb.id);
      const srcKey = fb.path ? "clip_path" : "clip_url";
      segments.push({ ...base, [srcKey]: fb.path || fb.url, in: 0, fit: !!fb.fit });
    } else {
      // клипа нет вообще: заглушка-запрос В ТЕМЕ НИШИ (не маркетинг), чтобы след. попытка была по теме
      segments.push({ ...base, broll_query: nicheFallback || "young european caucasian marketer office", broll_must: [] });
    }
  }
  return segments;
};
