// Локальный движок рендера — перенос проверенной логики api/ai-montage-direct.js (faceless),
// но БЕЗ облака: ffmpeg вшит (ffmpeg-static), рендер на машине пользователя, файл пишется на диск.
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegStatic from "ffmpeg-static";

// В упакованном приложении бинарь лежит в app.asar.unpacked (asarUnpack), иначе — обычный путь.
export const ffmpegPath = String(ffmpegStatic || "").replace("app.asar", "app.asar.unpacked");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = (...a) => console.log("[render]", ...a);

export const downloadTo = async (url, destPath) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download ${url} failed: ${res.status}`);
  await fs.writeFile(destPath, Buffer.from(await res.arrayBuffer()));
  return (await fs.stat(destPath)).size;
};

export const runFfmpeg = (args, { label = "ffmpeg", env } = {}) =>
  new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
      env: env ? { ...process.env, ...env } : process.env,
    });
    let stderr = "";
    proc.stderr.on("data", (c) => { stderr += c.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${label} exited ${code}: ${stderr.slice(-900)}`)),
    );
  });

export const ffprobeDuration = (filePath) =>
  new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ["-i", filePath], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (c) => { stderr += c.toString(); });
    proc.on("close", () => {
      const m = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
      if (!m) return resolve(0);
      resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 100);
    });
  });

// --- Pexels (фильтр демографии по слагу: НЕ темнокожие/пожилые/дети и т.п.) ---
export const AVOID_SLUG = [
  "african", "afro", "afro-american", "black-man", "black-woman", "dark-skinned",
  "elderly", "old-woman", "old-man", "senior", "grandmother", "grandfather", "grandma", "grandpa",
  "disabled", "disability", "amputee", "wheelchair", "prosthetic",
  "child", "children", "kid", "baby", "toddler",
  "stock-market", "stock-exchange", "trading", "trader", "crypto", "cryptocurrency",
  "bitcoin", "forex", "candlestick", "investment", "robot-toy", "toy", "drone",
];

export const pickPexelsVideo = async (query, key, used = new Set(), mustWords = []) => {
  if (!key) return null;
  const must = (mustWords || []).map((w) => String(w).toLowerCase()).filter(Boolean);
  const url = `https://api.pexels.com/videos/search?per_page=20&orientation=portrait&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) return null;
  const data = await res.json();
  const pickFile = (v) => {
    const files = (v.video_files || [])
      .filter((f) => f.height >= 1280 && f.width <= 1080)
      .sort((a, b) => a.width - b.width);
    return files[0] || null;
  };
  for (const v of data.videos || []) {
    if (used.has(v.id)) continue;
    const slug = String(v.url || "").toLowerCase();
    if (AVOID_SLUG.some((w) => slug.includes(w))) continue;
    if (must.length && !must.some((w) => slug.includes(w))) continue;
    const f = pickFile(v);
    if (f) return { id: v.id, url: f.link, slug };
  }
  return null;
};

// --- ASS-титры со вшитым шрифтом (libass без fontconfig) ---
const assEncodeFont = (data) => {
  const out = []; let written = 0;
  for (let pos = 0; pos < data.length; pos += 3) {
    const rem = data.length - pos;
    const b0 = data[pos], b1 = rem > 1 ? data[pos + 1] : 0, b2 = rem > 2 ? data[pos + 2] : 0;
    const groups = [b0 >> 2, ((b0 & 3) << 4) | (b1 >> 4), ((b1 & 15) << 2) | (b2 >> 6), b2 & 63];
    const n = rem >= 3 ? 4 : rem + 1;
    for (let i = 0; i < n; i += 1) { out.push(String.fromCharCode(groups[i] + 33)); written += 1; if (written % 80 === 0) out.push("\n"); }
  }
  return out.join("");
};
const tcAss = (sec) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60), cs = Math.floor((sec - Math.floor(sec)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
};
const clean = (s) => String(s || "").toUpperCase().replace(/[{}\r\n]/g, "").replace(/\\/g, "").trim();

// hex #RRGGBB -> ASS &HBBGGRR
const hexToAss = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return null;
  const r = m[1].slice(0, 2), g = m[1].slice(2, 4), b = m[1].slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
};

const buildAss = (words, { outH = 1920, fontEncoded, chunkWords = 2, accentColor = null } = {}) => {
  const accent = hexToAss(accentColor) || "&H0057C8FF"; // янтарь BGR по умолчанию
  const fontSize = Math.round(outH * 0.05); // влезает по 2 слова в строку, не обрезается
  const marginV = Math.round(outH * 0.24);
  const pop = `{\\1c${accent}\\fscx108\\fscy108\\t(0,90,\\fscx102\\fscy102)}`; // мягче «поп», не вылезает за края
  const dlg = [];
  // ПО СЛОВАМ глобально: каждое слово показывается строго до начала следующего (без наложений)
  for (let k = 0; k < words.length; k += 1) {
    const w = words[k];
    const st = w.t || 0;
    let en = (k + 1 < words.length) ? (words[k + 1].t || st + (w.d || 0.3)) : st + (w.d || 0.3);
    if (en <= st) continue;
    if (en - st > 1.6) en = st + 1.6; // не держать титр слишком долго на паузах
    const chunkStart = Math.floor(k / chunkWords) * chunkWords;
    const lineWords = words.slice(chunkStart, chunkStart + chunkWords);
    const parts = []; let activeOk = false;
    lineWords.forEach((ww, idx) => {
      const txt = clean(ww.w);
      if (!txt) return;
      if (chunkStart + idx === k) { parts.push(`${pop}${txt}{\\r}`); activeOk = true; }
      else parts.push(txt);
    });
    if (!activeOk || !parts.length) continue;
    const fade = (k === chunkStart) ? "{\\fad(90,0)}" : "";
    dlg.push(`Dialogue: 0,${tcAss(st)},${tcAss(en)},Default,,0,0,0,,${fade}${parts.join(" ")}`);
  }
  const header = [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920",
    "ScaledBorderAndShadow: yes", "WrapStyle: 1", "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    `Style: Default,Montserrat,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&HB0000000,1,0,0,0,100,100,0.4,0,1,5,3,2,40,40,${marginV},1`,
    "", "[Fonts]", "fontname: Montserrat0.ttf", fontEncoded, "",
    "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");
  return `${header}\n${dlg.join("\n")}\n`;
};

const loadFont = async (workDir, customPath = null) => {
  // свой шрифт пользователя (брендбук) — приоритет
  if (customPath) {
    const sz = await fs.stat(customPath).then((s) => s.size).catch(() => 0);
    if (sz > 10000) return { path: customPath, buf: await fs.readFile(customPath) };
  }
  const local = path.resolve(__dirname, "../assets/Montserrat.ttf");
  const sz = await fs.stat(local).then((s) => s.size).catch(() => 0);
  if (sz > 50000) return { path: local, buf: await fs.readFile(local) };
  const p = path.join(workDir, "Montserrat.ttf");
  for (const u of [
    "https://github.com/google/fonts/raw/main/ofl/montserrat/static/Montserrat-Bold.ttf",
    "https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/static/Montserrat-Bold.ttf",
  ]) {
    try { await downloadTo(u, p); if ((await fs.stat(p)).size > 50000) return { path: p, buf: await fs.readFile(p) }; } catch {}
  }
  return null;
};

// --- ЛОКАЛЬНАЯ faceless-склейка: клипы по сегментам + голос + музыка + титры ---
// segments: [{start,end,text, clip_path | clip_url, fit?, in?}], voicePath, words[], musicPath?
export const renderFaceless = async ({ workDir, segments, voicePath, words = [], musicPath = null, musicVolume = 0.05, sfxPaths = [], fontPath = null, accentColor = null, outPath }) => {
  const D = await ffprobeDuration(voicePath);
  if (!segments.length) throw new Error("нет сегментов");

  // подготовка клипов (скачать url -> локальный файл)
  const clips = [];
  for (let i = 0; i < segments.length; i += 1) {
    const s = segments[i];
    let p = s.clip_path;
    if (!p && s.clip_url) {
      p = path.join(workDir, `c${i}.mp4`);
      try { await downloadTo(s.clip_url, p); } catch (e) { log("clip dl fail", e.message); p = null; }
    }
    if (p) clips.push({ path: p, dur: Math.max(1.2, Number(s.end) - Number(s.start)), fit: !!s.fit, in: Number(s.in) || 0 });
  }
  if (!clips.length) throw new Error("не удалось скачать ни одного клипа");

  // титры (ASS + вшитый шрифт)
  const font = await loadFont(workDir, fontPath);
  const assPath = path.join(workDir, "cap.ass");
  let hasCaps = false;
  let fcEnv = { HOME: workDir, XDG_CACHE_HOME: workDir };
  if (font && words.length) {
    await fs.writeFile(assPath, buildAss(words, { outH: 1920, fontEncoded: assEncodeFont(font.buf), accentColor }));
    const fontDir = path.dirname(font.path);
    const fontsConf = path.join(workDir, "fonts.conf");
    await fs.writeFile(fontsConf, `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n<dir>${fontDir}</dir>\n<cachedir>${path.join(workDir, "fc-cache")}</cachedir>\n</fontconfig>\n`);
    fcEnv = { HOME: workDir, XDG_CACHE_HOME: workDir, FONTCONFIG_FILE: fontsConf, FONTCONFIG_PATH: fontDir };
    hasCaps = true;
  }

  // ffmpeg args
  const args = ["-y"];
  for (const c of clips) {
    if (c.in > 0) args.push("-stream_loop", "-1", "-ss", c.in.toFixed(2), "-i", c.path);
    else args.push("-stream_loop", "-1", "-i", c.path);
  }
  const voiceIdx = clips.length;
  args.push("-i", voicePath);
  let musicIdx = -1;
  if (musicPath) { args.push("-stream_loop", "-1", "-i", musicPath); musicIdx = voiceIdx + 1; }

  // звуки переходов: на каждом стыке клипов — короткий SFX из папки «Звуки»
  const sfx = (sfxPaths || []).filter(Boolean);
  const sfxInputs = [];
  if (sfx.length && clips.length > 1) {
    let acc = 0;
    for (let k = 0; k < clips.length - 1; k += 1) {
      acc += clips[k].dur;
      const file = sfx[k % sfx.length];
      const idx = (musicIdx >= 0 ? musicIdx : voiceIdx) + 1 + sfxInputs.length;
      args.push("-i", file);
      sfxInputs.push({ idx, tMs: Math.max(0, Math.round((acc - 0.12) * 1000)) });
    }
  }

  const filter = [];
  clips.forEach((c, i) => {
    const L = c.dur.toFixed(2);
    if (c.fit) {
      filter.push(
        `[${i}:v]split=2[bg${i}][fg${i}];` +
        `[bg${i}]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:3,eq=brightness=-0.12[bgb${i}];` +
        `[fg${i}]scale=1080:1920:force_original_aspect_ratio=decrease[fgs${i}];` +
        `[bgb${i}][fgs${i}]overlay=(W-w)/2:(H-h)/2,fps=30,setsar=1,trim=0:${L},setpts=PTS-STARTPTS[c${i}]`,
      );
    } else {
      const rate = (0.20 / Math.max(1, Math.round(c.dur * 30))).toFixed(6);
      const z = i % 2 === 0 ? `min(1.0+${rate}*on,1.20)` : `max(1.20-${rate}*on,1.0)`;
      filter.push(
        `[${i}:v]scale=1296:2304:force_original_aspect_ratio=increase,crop=1296:2304,setsar=1,` +
        `zoompan=z='${z}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30,` +
        `trim=0:${L},setpts=PTS-STARTPTS[c${i}]`,
      );
    }
  });
  // склейка (БЕЗ xfade — он ломает рендер на ffmpeg 7.1)
  filter.push(`${clips.map((_, i) => `[c${i}]`).join("")}concat=n=${clips.length}:v=1:a=0[cat]`);
  filter.push(`[cat]unsharp=3:3:0.5:3:3:0.0[gr]`);
  let vlabel = "gr";
  if (hasCaps) {
    const escAss = assPath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
    filter.push(`[gr]ass='${escAss}'[vout]`); vlabel = "vout";
  }
  const aBase = sfxInputs.length ? "amain" : "aout";
  if (musicIdx >= 0) {
    filter.push(`[${voiceIdx}:a]aresample=44100,asplit=2[va][vsc]`);
    filter.push(`[${musicIdx}:a]aresample=44100,volume=${musicVolume}[mraw]`);
    filter.push(`[mraw][vsc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300[mduck]`);
    filter.push(`[va][mduck]amix=inputs=2:normalize=0:dropout_transition=0,alimiter=limit=0.95[${aBase}]`);
  } else {
    filter.push(`[${voiceIdx}:a]aresample=44100[${aBase}]`);
  }
  if (sfxInputs.length) {
    sfxInputs.forEach((s, i) => filter.push(`[${s.idx}:a]aresample=44100,adelay=${s.tMs}|${s.tMs},volume=0.6[sfx${i}]`));
    const mixIns = ["[amain]", ...sfxInputs.map((_, i) => `[sfx${i}]`)].join("");
    filter.push(`${mixIns}amix=inputs=${sfxInputs.length + 1}:normalize=0:dropout_transition=0[aout]`);
  }
  args.push("-filter_complex", filter.join(";"), "-map", `[${vlabel}]`, "-map", "[aout]");
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-t", String(D), outPath);

  await runFfmpeg(args, { label: "faceless", env: fcEnv });
  return { outPath, duration: D, clips: clips.length, captions: hasCaps };
};
