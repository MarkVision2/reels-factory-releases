// Строим спецификацию оверлея (титры + CTA) из распознанной озвучки.
// words = [{w,t,d}] (слово, тайм-код сек, длительность сек). Всё в секундах.

const ENDS = /[.!?…]$/;
// слова-акценты для жёлтой подсветки (цифры + сильные слова)
const HL_RE = /(\d|втро|неделя|вечер|автоматиз|инструмент|систем|больше|меньше|дороже|бесплатн|ограничен|клиент)/i;

// группируем слова в короткие читаемые чанки (~3 слова / ~1.8с / по знаку препинания)
export const chunksFromWords = (words = []) => {
  const chunks = [];
  let cur = null;
  for (const w of words) {
    const we = +(w.t + w.d).toFixed(2);
    const tok = { w: w.w, start: w.t, end: we };
    if (!cur) cur = { text: w.w, start: w.t, end: we, n: 1, words: [tok] };
    else { cur.text += " " + w.w; cur.end = we; cur.n += 1; cur.words.push(tok); }
    const dur = cur.end - cur.start;
    if (cur.n >= 3 || dur >= 1.8 || ENDS.test(w.w)) {
      chunks.push(cur); cur = null;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.map((c) => {
    const hl = c.words.map((x) => x.w).filter((t) => HL_RE.test(t));
    return {
      text: c.text,
      start: c.start,
      end: c.end,
      hl,
      big: c.n <= 2 && ENDS.test(c.text), // короткий + конец фразы → крупный удар
      words: c.words.map((x) => ({ w: x.w, start: x.start, end: x.end, hl: HL_RE.test(x.w) })), // пословно для караоке
    };
  });
};

// ── Авто-врезки: числа → счётчик, перечисление → карточки, хук → из настроек ──
const STOP = new Set("и во в на со с по за о об что это то а но же я мы он она они уже как ко к у не для от до из их там тут вот бы ли или да".split(" "));
const stripP = (s) => String(s || "").replace(/[.,!?:;»«"'()…]/g, "").trim();
const isStop = (s) => { const w = stripP(s).toLowerCase(); return !w || w.length < 3 || STOP.has(w); };
const MULT = { вдвое: "×2", втрое: "×3", вчетверо: "×4", впятеро: "×5", вшестеро: "×6", вдесятеро: "×10" };
// Числа СЛОВАМИ — STT часто пишет «триста», «пять-семь», «десять», а не цифрами → без этого врезки не создавались.
const NUM_WORDS = {
  ноль: 0, один: 1, одна: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
  одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15, двадцать: 20, тридцать: 30, сорок: 40,
  пятьдесят: 50, шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90,
  сто: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500, шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900,
};

// число из слова: "300"/"100 000" → как есть; "5-7" → "5–7"; множитель → "×N"
const numValue = (raw0) => {
  const raw = stripP(raw0);
  const ml = MULT[raw.toLowerCase()];
  if (ml) return ml;
  if (/^\d{1,4}[–-]\d{1,4}$/.test(raw)) return raw.replace(/-/, "–");
  if (/\d/.test(raw) && /^[\d\s ]+$/.test(raw)) return raw.replace(/[\s ]+/g, " ").trim();
  const low = raw.toLowerCase();
  const rng = low.split(/[–-]/);
  if (rng.length === 2 && NUM_WORDS[rng[0]] != null && NUM_WORDS[rng[1]] != null) return `${NUM_WORDS[rng[0]]}–${NUM_WORDS[rng[1]]}`;
  if (NUM_WORDS[low] != null) return String(NUM_WORDS[low]);
  return null;
};

// 1-2 значимых слова после цифры → подпись («10 ТАРГЕТОЛОГОВ», «300 ТЫСЯЧ»)
const subAfter = (words, k) => {
  const out = [];
  for (let j = k + 1; j < words.length && out.length < 2; j += 1) {
    if (isStop(words[j].w)) { if (out.length) break; continue; }
    out.push(stripP(words[j].w));
    if (/[.,!?:;]$/.test(String(words[j].w))) break;
  }
  return out.join(" ").toUpperCase();
};

// без наложений, с минимальным зазором, не в окне CTA, кап по количеству
const clampInserts = (arr, ctaStart, vdur) => {
  const sorted = (arr || [])
    .filter((x) => x && x.end > x.start + 0.5 && x.start >= 0 && x.start < ctaStart - 0.2)
    .sort((a, b) => a.start - b.start);
  const out = []; let prevEnd = -10;
  for (const x of sorted) {
    if (x.start < prevEnd + 0.8) continue;
    out.push({ ...x, end: Math.min(x.end, vdur) });
    prevEnd = x.end;
    if (out.length >= 6) break;
  }
  return out;
};

// words[{w,t,d}], blocks[{text,start,end}] → inserts[{kind,start,end,data}]
export const buildInserts = ({ words = [], blocks = [], vdur = 0, ctaStart = Infinity, config = {} }) => {
  const manual = Array.isArray(config.inserts) ? config.inserts : [];
  if (config.autoInserts === false) return clampInserts(manual, ctaStart, vdur);

  const cands = [];
  // HOOK — из config.hookLines (массив или «a|b|c»); авто-нарезку слов не делаем (качество)
  const hl = Array.isArray(config.hookLines)
    ? config.hookLines
    : (config.hookLines ? String(config.hookLines).split("|") : null);
  let hookEnd = 0;
  if (hl) {
    const lines = hl.map((s) => String(s).trim().toUpperCase()).filter(Boolean).slice(0, 3);
    if (lines.length) { hookEnd = 2.1; cands.push({ kind: "hook", start: 0, end: hookEnd, data: { lines } }); }
  }
  // STAT — числа в речи (в т.ч. словами). Сливаем ПОДРЯД идущие числа:
  // «пять, семь» → «5–7»; «сто, двести, триста» → «300» (кульминация). Спейсинг — clampInserts.
  for (let k = 0; k < words.length; ) {
    const t = words[k].t || 0;
    if (t < hookEnd + 0.3) { k += 1; continue; }
    if (t >= ctaStart - 0.3) break;
    if (numValue(words[k].w) == null) { k += 1; continue; }
    let j = k;
    const nums = [];
    while (j < words.length) {
      const vj = numValue(words[j].w);
      if (vj == null) break;
      nums.push(vj);
      j += 1;
    }
    const ints = nums.map((x) => parseInt(String(x).replace("×", ""), 10)).filter((n) => !Number.isNaN(n));
    const rangeTok = nums.find((x) => x.includes("–"));
    let value;
    if (rangeTok) value = rangeTok;
    else if (nums.length >= 2 && Math.max(...ints) <= 9) value = `${Math.min(...ints)}–${Math.max(...ints)}`;
    else if (nums.length >= 2) value = String(Math.max(...ints));
    else value = nums[0];
    if (String(value).includes("–") || String(value).startsWith("×") || parseInt(value, 10) >= 5) {
      const sub = subAfter(words, j - 1);
      cands.push({ kind: "stat", start: +Math.max(0, t - 0.12).toFixed(2), end: +Math.min(vdur, t + 1.9).toFixed(2), data: { value: String(value), sub: sub || undefined } });
    }
    k = j;
  }
  // LIST — авто-детекцию ОТКЛЮЧИЛИ: split по запятым ловит filler-мусор
  // («да, понятно», «кто-то пишет, ну, например») → бессмысленные карточки.
  // Список можно задать вручную через config.inserts (kind:"list"). Шаблон ListStack остаётся.
  return clampInserts([...manual, ...cands], ctaStart, vdur);
};

// CTA: тайм-код = начало последнего смыслового блока (там голос проговаривает призыв).
// Тексты можно переопределить из config; иначе — дефолты под формат «жми на кнопку».
export const buildOverlaySpec = ({ words = [], blocks = [], vdur = 0, config = {} }) => {
  const chunks = chunksFromWords(words);

  const ctaWindow = Number(config.ctaWindow) || 4.0; // сек до конца, если нет блоков
  const lastBlock = blocks.length ? blocks[blocks.length - 1] : null;
  const ctaStart = Math.max(0, lastBlock ? lastBlock.start : vdur - ctaWindow);

  // ctaLines: массив или строка с разделителем «|»; пустые значения → дефолты
  const lines = (Array.isArray(config.ctaLines) ? config.ctaLines : String(config.ctaLines || "").split("|"))
    .map((s) => String(s).trim()).filter(Boolean);
  const button = (config.ctaButton || "").trim();
  const urgency = (config.ctaUrgency || "").trim();
  const cta = config.remotionCta === false ? null : {
    start: ctaStart,
    lines: lines.length ? lines : ["Узнай,", "как работает", "система"],
    button: button || "Жми на кнопку →",
    urgency: urgency || "🔥 Места ограничены",
  };

  const inserts = buildInserts({ words, blocks, vdur, ctaStart: cta ? cta.start : vdur + 1, config });
  const inIns = (t) => inserts.some((ins) => t >= ins.start - 0.1 && t < ins.end);

  // титры в окне CTA и внутри врезок убираем (врезка непрозрачная — перекрывает титры)
  let visibleChunks = cta ? chunks.filter((c) => c.start < cta.start - 0.1) : chunks;
  visibleChunks = visibleChunks.filter((c) => !inIns(c.start) && !inIns((c.start + c.end) / 2));

  return { chunks: visibleChunks, cta, inserts };
};
