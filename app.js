// Логика окна: вкладки, настройка, создание видео, статус бота.
const $ = (id) => document.getElementById(id);
const FIELDS = ["telegramToken", "elevenKey", "voiceProvider", "freedomKey", "freedomVoice", "freedomEmotion", "voiceId", "openaiKey", "pexelsKey", "genProvider", "falKey", "falModel", "genMax", "kieKey", "musicUrl", "accentColor", "heygenKey", "heygenAvatarId", "heygenVoiceId"];

// вкладки
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    $("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "library") refreshLibrary();
    if (btn.dataset.tab === "content") browseTo("");
  });
});

// загрузка конфига
const VOICE_PRESETS = ["IKne3meq5aSn9XLyUdCD", "TX3LPaxmHKxFdv7VOQHJ", "pNInz6obpgDQGcFmaJgB"];
async function loadCfg() {
  const cfg = await window.api.getConfig();
  FIELDS.forEach((f) => { if ($(f)) $(f).value = cfg[f] || ""; });
  // тема
  const theme = cfg.theme || "dark";
  document.documentElement.dataset.theme = theme;
  if ($("themeSel")) $("themeSel").value = theme;
  // звуки переходов
  if ($("transitionSfx")) $("transitionSfx").checked = !!cfg.transitionSfx;
  // анимированные титры + CTA (Remotion)
  if ($("remotionOverlay")) $("remotionOverlay").checked = !!cfg.remotionOverlay;
  if ($("remotionCaptions")) $("remotionCaptions").checked = cfg.remotionCaptions !== false;
  if ($("ctaLines")) $("ctaLines").value = Array.isArray(cfg.ctaLines) ? cfg.ctaLines.join(" | ") : (cfg.ctaLines || "");
  if ($("ctaButton")) $("ctaButton").value = cfg.ctaButton || "";
  if ($("ctaUrgency")) $("ctaUrgency").value = cfg.ctaUrgency != null ? cfg.ctaUrgency : "";
  applyRemotionToggle();
  // провайдер ИИ-генерации → показать нужные поля
  applyGenProvider();
  // движок озвучки: ElevenLabs/Freedom → показать нужные поля
  applyVoiceProvider();
  // счётчики баланса по заданным ключам — сразу
  refreshAllQuotas();
  // голос: пресет/кастом
  const vid = cfg.voiceId || VOICE_PRESETS[0];
  if (VOICE_PRESETS.includes(vid)) { $("voicePreset").value = vid; $("voiceId").style.display = "none"; }
  else { $("voicePreset").value = "custom"; $("voiceId").value = vid; $("voiceId").style.display = ""; }
  const st = Number(cfg.voiceStability ?? 0.35);
  $("voiceDyn").value = st >= 0.55 ? "calm" : (st <= 0.34 ? "energetic" : "balanced");
  // первый запуск → визард
  if (!cfg.telegramToken || !cfg.elevenKey) startWizard();
}
loadCfg();

$("voicePreset").addEventListener("change", () => {
  if ($("voicePreset").value === "custom") { $("voiceId").style.display = ""; $("voiceId").focus(); }
  else { $("voiceId").style.display = "none"; $("voiceId").value = $("voicePreset").value; }
});

// --- ВИЗАРД ПЕРВОГО ЗАПУСКА ---
let wizStep = 1; let wizTgOk = false;
function showWizStep(n) {
  wizStep = n;
  document.querySelectorAll(".wiz-step").forEach((s) => s.classList.toggle("active", +s.dataset.step === n));
  document.querySelectorAll(".wiz-steps .dot").forEach((d) => d.classList.toggle("active", +d.dataset.s <= n));
  $("wBack").hidden = n === 1;
  $("wNext").textContent = n === 4 ? "Открыть приложение" : "Дальше";
}
function startWizard() { $("wizard").hidden = false; showWizStep(1); }

$("wCheckTg").addEventListener("click", async () => {
  const b = $("wTgBadge"); b.textContent = "проверяю…"; b.className = "badge";
  const r = await window.api.validateTelegram($("wTelegram").value.trim());
  if (r.ok) { b.textContent = "✓ @" + r.username; b.className = "badge ok"; wizTgOk = true; }
  else { b.textContent = "✗ " + r.error; b.className = "badge err"; wizTgOk = false; }
});
$("wBack").addEventListener("click", () => showWizStep(Math.max(1, wizStep - 1)));
$("wNext").addEventListener("click", async () => {
  if (wizStep === 1) {
    if (!wizTgOk) { const b = $("wTgBadge"); b.textContent = "сначала проверь токен"; b.className = "badge err"; return; }
    showWizStep(2);
  } else if (wizStep === 2) {
    if (!$("wEleven").value.trim()) { return; }
    showWizStep(3);
  } else if (wizStep === 3) {
    showWizStep(4);
  } else {
    // сохранить и закрыть
    const cfg = await window.api.getConfig();
    cfg.telegramToken = $("wTelegram").value.trim();
    cfg.elevenKey = $("wEleven").value.trim();
    cfg.pexelsKey = $("wPexels").value.trim();
    await window.api.saveConfig(cfg);
    $("telegramToken").value = cfg.telegramToken; $("elevenKey").value = cfg.elevenKey; $("pexelsKey").value = cfg.pexelsKey;
    $("wizard").hidden = true;
  }
});

// проверка токена ТГ
$("checkTg").addEventListener("click", async () => {
  const badge = $("tgBadge"); badge.textContent = "проверяю…"; badge.className = "badge";
  const r = await window.api.validateTelegram($("telegramToken").value.trim());
  if (r.ok) { badge.textContent = "✓ @" + r.username; badge.className = "badge ok"; }
  else { badge.textContent = "✗ " + r.error; badge.className = "badge err"; }
});

// сохранить настройки
$("saveBtn").addEventListener("click", async () => {
  const cfg = await window.api.getConfig();
  FIELDS.forEach((f) => { if ($(f)) cfg[f] = $(f).value.trim(); });
  // голос: voiceId из пресета или кастома; динамичность → stability/style
  cfg.voiceId = $("voicePreset").value === "custom" ? $("voiceId").value.trim() : $("voicePreset").value;
  const dynMap = { calm: { s: 0.6, st: 0.15 }, balanced: { s: 0.45, st: 0.4 }, energetic: { s: 0.3, st: 0.6 } };
  const dm = dynMap[$("voiceDyn").value] || dynMap.balanced;
  cfg.voiceStability = dm.s; cfg.voiceStyle = dm.st;
  if ($("themeSel")) cfg.theme = $("themeSel").value;
  if ($("transitionSfx")) cfg.transitionSfx = $("transitionSfx").checked;
  if ($("remotionOverlay")) cfg.remotionOverlay = $("remotionOverlay").checked;
  if ($("remotionCaptions")) cfg.remotionCaptions = $("remotionCaptions").checked;
  if ($("ctaLines")) cfg.ctaLines = $("ctaLines").value.split("|").map((s) => s.trim()).filter(Boolean);
  if ($("ctaButton")) cfg.ctaButton = $("ctaButton").value.trim();
  if ($("ctaUrgency")) cfg.ctaUrgency = $("ctaUrgency").value.trim();
  await window.api.saveConfig(cfg);
  const b = $("saveBadge"); b.textContent = "✓ сохранено"; b.className = "badge ok";
  setTimeout(() => { b.textContent = ""; }, 2500);
});

// показ/скрытие под-полей анимированного оверлея (Remotion)
function applyRemotionToggle() {
  const on = !!($("remotionOverlay") && $("remotionOverlay").checked);
  const caps = $("remotionCapsRow"), fields = $("ctaFields");
  if (caps) caps.style.opacity = on ? "1" : "0.4";
  if (fields) fields.style.opacity = on ? "1" : "0.4";
  [$("remotionCaptions"), $("ctaLines"), $("ctaButton"), $("ctaUrgency")].forEach((el) => { if (el) el.disabled = !on; });
}
if ($("remotionOverlay")) $("remotionOverlay").addEventListener("change", applyRemotionToggle);

// ИИ-генерация: показать поля выбранного провайдера
function applyGenProvider() {
  const p = $("genProvider") ? $("genProvider").value : "none";
  if ($("genKie")) $("genKie").hidden = p !== "kie";
  if ($("genFal")) $("genFal").hidden = p !== "fal";
  if ($("genMaxRow")) $("genMaxRow").hidden = p === "none";
}
if ($("genProvider")) $("genProvider").addEventListener("change", applyGenProvider);

// переключатель движка озвучки: ElevenLabs ↔ Freedom Speech
function applyVoiceProvider() {
  const p = $("voiceProvider") ? $("voiceProvider").value : "elevenlabs";
  if ($("elevenFields")) $("elevenFields").hidden = p === "freedom";
  if ($("freedomFields")) $("freedomFields").hidden = p !== "freedom";
}
if ($("voiceProvider")) $("voiceProvider").addEventListener("change", applyVoiceProvider);

// единый счётчик баланса по ключу (ElevenLabs / kie.ai / HeyGen / Pexels)
async function showQuota(service, keyId, badgeId, manual = false) {
  const badge = $(badgeId); if (!badge) return;
  const key = $(keyId) ? $(keyId).value.trim() : "";
  if (!key) { if (manual) { badge.textContent = "вставь ключ"; badge.className = "badge err"; } else { badge.textContent = ""; badge.className = "badge quota"; } return; }
  badge.textContent = "…"; badge.className = "badge quota";
  const r = await window.api.checkQuota(service, key);
  if (r.ok) {
    badge.textContent = "💰 " + r.text; badge.className = "badge quota ok";
    // сразу сохраняем рабочий ключ в конфиг (чтобы не терялся до «Сохранить» и был виден референсу и т.п.)
    try { const cfg = await window.api.getConfig(); if (cfg[keyId] !== key) { cfg[keyId] = key; await window.api.saveConfig(cfg); } } catch {}
  } else { badge.textContent = "✕ " + r.error; badge.className = "badge quota err"; }
}
const QUOTAS = [
  ["elevenlabs", "elevenKey", "elevenQuota", "elevenCheck"],
  ["kie", "kieKey", "kieBalance", "kieBalanceBtn"],
  ["heygen", "heygenKey", "heygenQuota", "heygenCheck"],
  ["pexels", "pexelsKey", "pexelsQuota", "pexelsCheck"],
  ["openai", "openaiKey", "openaiQuota", "openaiCheck"],
];
QUOTAS.forEach(([service, keyId, badgeId, btnId]) => {
  if ($(btnId)) $(btnId).addEventListener("click", () => showQuota(service, keyId, badgeId, true));
});
// автопоказ всех счётчиков (по ключам, которые уже заданы)
function refreshAllQuotas() { QUOTAS.forEach(([s, k, b]) => showQuota(s, k, b, false)); }

// --- СТИЛЬ ПО РЕФЕРЕНСУ ---
let refProfile = null;
window.api.on("ref:progress", (p) => { if (p?.label) setRefStatus("busy", p.label); });
function setRefStatus(cls, text) { const j = $("refStatus"); if (j) { j.className = "job " + cls; j.textContent = text; } }
const POS_RU = { bottom: "снизу", center: "по центру", top: "сверху" };
const ENERGY_RU = { calm: "спокойная", medium: "средняя", energetic: "энергичная" };
const INT_RU = { calm: "спокойный", dynamic: "динамичный", fast: "быстрый" };

function renderFindings(p) {
  refProfile = p;
  const c = p.captions || {}, pa = p.pacing || {}, br = p.broll || {};
  const cards = [
    ...(p.topic ? [["Тема ролика", p.topic]] : []),
    ["Титры", c.present === false ? "нет" : `${POS_RU[c.position] || c.position}, ${c.style || ""}`],
    ["Цвет титров", `<span class="ref-swatch" style="background:${c.color}"></span>${c.color}`],
    ["Размер титров", `${c.sizePct}% высоты`],
    ["Анимация", c.animation],
    ["Ритм", `средний план ${pa.avgShotSec}с · ${INT_RU[pa.intensity] || pa.intensity} (${pa.cutsPerMin}/мин)`],
    ["Переходы", p.transitions],
    ["Темы биролов (для подбора похожих)", (br.themes || []).join(", ") || "—"],
    ["Музыка", ENERGY_RU[p.music?.energy] || p.music?.energy || "—"],
    ["Вайб", p.vibe || "—"],
  ];
  $("refCards").innerHTML = cards.map(([k, v]) => `<div class="ref-card"><div class="rc-k">${k}</div><div class="rc-v">${v || "—"}</div></div>`).join("");
  // конкретные биролы-вставки, которые ИИ увидел в видео
  if (Array.isArray(br.shots) && br.shots.length) {
    const items = br.shots.map((s) => `<li>${s}</li>`).join("");
    $("refCards").innerHTML += `<div class="ref-card" style="grid-column:1/-1"><div class="rc-k">Биролы-вставки в видео</div><ul class="ref-shots">${items}</ul></div>`;
  }
  if (p.notes) $("refCards").innerHTML += `<div class="ref-card" style="grid-column:1/-1"><div class="rc-k">Совет</div><div class="rc-v" style="font-weight:400">${p.notes}</div></div>`;
  // кадры из видео — выбираемые: можно вырезать выбранные куски в свой контент (биролы)
  if (Array.isArray(p.frames) && p.frames.length) {
    const thumbs = p.frames.map((f, i) => `<div class="ref-frame-wrap" data-t="${f.t}" data-i="${i}"><img class="ref-frame" src="${f.src}" /><span class="ref-pick">✓</span></div>`).join("");
    $("refCards").innerHTML += `<div class="ref-card" style="grid-column:1/-1"><div class="rc-k">Кадры из референса — отметь, какие вырезать в свой контент (биролы)</div><div class="ref-frames">${thumbs}</div><div class="inline" style="margin-top:12px"><button class="primary" id="refExtract">✂️ Вырезать выбранные в «Мой контент»</button><span class="badge" id="refExtractBadge"></span></div></div>`;
  }
  if (!p.aiUsed) $("refCards").innerHTML += `<div class="ref-card" style="grid-column:1/-1"><div class="rc-v" style="font-weight:400;color:var(--mut)">⚠️ Без ключа OpenAI разобран только ритм. Добавь ключ в «Настройке» для полного разбора стиля.</div></div>`;
  $("refName").value = p.createdFrom ? p.createdFrom.replace(/\.[^.]+$/, "") : "Мой стиль";
  $("refFindings").hidden = false;
  // выбор кадров + вырезка в контент
  document.querySelectorAll(".ref-frame-wrap").forEach((el) => el.addEventListener("click", () => el.classList.toggle("sel")));
  const ex = document.getElementById("refExtract");
  if (ex) ex.addEventListener("click", async () => {
    const sel = [...document.querySelectorAll(".ref-frame-wrap.sel")].map((el) => Number(el.dataset.t));
    const badge = document.getElementById("refExtractBadge");
    if (!sel.length) { badge.textContent = "отметь хотя бы один кадр"; badge.className = "badge err"; return; }
    if (!refProfile?.sourcePath) { badge.textContent = "нет исходного видео"; badge.className = "badge err"; return; }
    badge.textContent = `вырезаю ${sel.length}…`; badge.className = "badge"; ex.disabled = true;
    const cfg = await window.api.getConfig();
    const r = await window.api.extractRefClips({ sourcePath: refProfile.sourcePath, times: sel, project: cfg.activeProject || "" });
    ex.disabled = false;
    if (r.ok) { badge.textContent = `✅ добавлено ${r.added} в «Мой контент»`; badge.className = "badge ok"; }
    else { badge.textContent = "✕ " + r.error; badge.className = "badge err"; }
  });
}

if ($("refBtn")) $("refBtn").addEventListener("click", async () => {
  setRefStatus("busy", "Выбери видео…");
  $("refBtn").disabled = true;
  const r = await window.api.analyzeReference();
  $("refBtn").disabled = false;
  if (r.canceled) { setRefStatus("", ""); return; }
  if (r.ok) { setRefStatus("ok", "✅ Разобрано"); renderFindings(r.profile); }
  else setRefStatus("err", "❌ " + r.error);
});

if ($("refSave")) $("refSave").addEventListener("click", async () => {
  if (!refProfile) return;
  const name = $("refName").value.trim() || "Мой стиль";
  const { frames, ...slim } = refProfile; // кадры не сохраняем в шаблон (тяжёлые)
  await window.api.saveTemplate({ ...slim, name });
  $("refFindings").hidden = true; refProfile = null; setRefStatus("", "");
  refreshTemplates();
});

async function refreshTemplates() {
  const list = await window.api.listTemplates();
  const cfg = await window.api.getConfig();
  const active = cfg.activeTemplate || "";
  $("tplEmpty").style.display = list.length ? "none" : "";
  $("tplList").innerHTML = list.map((t) => {
    const on = t.id === active;
    const meta = `титры ${POS_RU[t.captions?.position] || ""} · ${t.captions?.color || ""} · план ${t.pacing?.avgShotSec || "?"}с`;
    return `<div class="tpl-row${on ? " active" : ""}">
      <div class="tpl-info"><div class="tpl-name">${t.name || t.id}</div><div class="tpl-meta">${meta}</div></div>
      <button class="tpl-apply${on ? " on" : ""}" data-id="${t.id}">${on ? "✓ Активен" : "Применить"}</button>
      <button class="tpl-del" data-id="${t.id}">✕</button>
    </div>`;
  }).join("");
  $("tplList").querySelectorAll(".tpl-apply").forEach((b) => b.addEventListener("click", async () => {
    const id = b.dataset.id; const cur = (await window.api.getConfig()).activeTemplate;
    await window.api.setActiveTemplate(cur === id ? "" : id); // повторное нажатие — снять
    refreshTemplates();
  }));
  $("tplList").querySelectorAll(".tpl-del").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Удалить шаблон?")) return;
    await window.api.deleteTemplate(b.dataset.id); refreshTemplates();
  }));
}
refreshTemplates();

// смена темы — мгновенно применяем и сохраняем
if ($("themeSel")) $("themeSel").addEventListener("change", async () => {
  const theme = $("themeSel").value;
  document.documentElement.dataset.theme = theme;
  const cfg = await window.api.getConfig();
  cfg.theme = theme;
  await window.api.saveConfig(cfg);
});

// мой контент — навигатор по папкам (как в Finder, с проектами)
let cbRel = "";
const sep = "/";
async function browseTo(rel) {
  cbRel = rel || "";
  const data = await window.api.browseContent(cbRel);
  // хлебные крошки
  const crumb = $("cbCrumb"); crumb.innerHTML = "";
  const root = document.createElement("span"); root.className = "crumb-seg"; root.textContent = "Мой контент";
  root.addEventListener("click", () => browseTo("")); crumb.appendChild(root);
  let acc = "";
  (cbRel ? cbRel.split(sep) : []).forEach((seg) => {
    acc = acc ? acc + sep + seg : seg;
    const a = acc;
    crumb.appendChild(document.createTextNode(" › "));
    const s = document.createElement("span"); s.className = "crumb-seg"; s.textContent = seg;
    s.addEventListener("click", () => browseTo(a)); crumb.appendChild(s);
  });
  $("cbBack").style.visibility = cbRel ? "visible" : "hidden";
  $("cbAdd").style.display = data.category ? "" : "none";
  $("cbHint").textContent = !cbRel
    ? "Зайди в Видео, Музыка или Звуки. Внутри можешь создавать папки-проекты."
    : (data.category ? "«＋ Папка» — создать проект. «＋ Добавить файлы» — положить сюда." : "");
  // вид
  const view = $("cbView"); view.innerHTML = "";
  data.folders.forEach((f) => view.appendChild(folderTile(f)));
  data.files.forEach((f) => view.appendChild(data.category === "videos" ? clipTile(f) : audioTile(f)));
  if (!data.folders.length && !data.files.length) {
    const e = document.createElement("div"); e.className = "empty"; e.textContent = "Пусто";
    view.appendChild(e);
  }
}
function folderTile(f) {
  const t = document.createElement("div"); t.className = "fld-tile";
  t.innerHTML = `<div class="fld-ico">📁</div><div class="fld-name">${esc(f.name)}</div>`;
  t.addEventListener("click", () => browseTo(f.rel));
  return t;
}
function clipTile(f) {
  const t = document.createElement("div"); t.className = "fv-item";
  const name = esc(f.title) || esc(f.name);
  const thumb = f.thumb ? `<img src="${f.thumb}" />` : `<div class="fv-noimg">🎞️</div>`;
  t.innerHTML = `
    <div class="fv-thumb">${thumb}
      <div class="fv-hover"><button class="fv-edit" title="Описание">✎</button><button class="fv-del" title="Удалить">✕</button></div>
    </div>
    <div class="fv-name" title="${esc(f.description) || name}">${name}</div>`;
  t.querySelector(".fv-del").addEventListener("click", async () => { if (confirm("Удалить файл?")) { await window.api.removeContent(f.path); browseTo(cbRel); } });
  t.querySelector(".fv-edit").addEventListener("click", () => openClipEditor(f));
  return t;
}
function audioTile(f) {
  const t = document.createElement("div"); t.className = "fv-item";
  const mb = (f.size / 1048576).toFixed(1);
  t.innerHTML = `
    <div class="fv-thumb audio"><div class="fv-noimg">${f.kind === "music" ? "🎵" : "🔊"}</div>
      <div class="fv-hover"><button class="fv-del" title="Удалить">✕</button></div>
    </div>
    <div class="fv-name" title="${esc(f.name)}">${esc(f.name)}</div>`;
  t.querySelector(".fv-del").addEventListener("click", async () => { if (confirm("Удалить файл?")) { await window.api.removeContent(f.path); browseTo(cbRel); } });
  return t;
}
function openClipEditor(f) {
  $("emTitle").value = f.title || "";
  $("emDesc").value = f.description || "";
  $("editModal").hidden = false;
  $("emSave").onclick = async () => {
    await window.api.setClipMeta(f.path, { title: $("emTitle").value.trim(), description: $("emDesc").value.trim() });
    $("editModal").hidden = true; browseTo(cbRel);
  };
  $("emCancel").onclick = () => { $("editModal").hidden = true; };
}
$("cbBack").addEventListener("click", () => browseTo(cbRel.split(sep).slice(0, -1).join(sep)));
$("cbMkdir").addEventListener("click", async () => {
  const name = prompt("Название папки (проекта):"); if (!name) return;
  await window.api.mkdirContent(cbRel, name); browseTo(cbRel);
});
$("cbAdd").addEventListener("click", async () => { await window.api.addContentTo(cbRel); browseTo(cbRel); });

// брендбук — шрифт и цвет
async function refreshFont() {
  const cfg = await window.api.getConfig();
  const b = $("fontBadge"), clr = $("clearFontBtn");
  if (cfg.fontName) { b.textContent = "✓ " + cfg.fontName; b.className = "badge ok"; clr.style.display = ""; }
  else { b.textContent = "стандартный (Montserrat)"; b.className = "badge"; clr.style.display = "none"; }
}
$("setFontBtn").addEventListener("click", async () => {
  const r = await window.api.setFont();
  if (r.ok) refreshFont();
});
$("clearFontBtn").addEventListener("click", async () => { await window.api.clearFont(); refreshFont(); });
refreshFont();

// проекты
async function refreshProjects() {
  const { projects, active } = await window.api.listProjects();
  const sel = $("projSel");
  sel.innerHTML = "";
  const optAll = document.createElement("option"); optAll.value = ""; optAll.textContent = "Все папки";
  sel.appendChild(optAll);
  projects.forEach((p) => { const o = document.createElement("option"); o.value = p; o.textContent = p; sel.appendChild(o); });
  sel.value = active || "";
}
refreshProjects();
$("projSel").addEventListener("change", () => window.api.setActiveProject($("projSel").value));
// режим видео (faceless / avatar) — сохраняем сразу
function applyMode(m) {
  const own = m === "ownvideo" || m === "dynamic";
  $("scriptInput").hidden = own;
  $("ownHint").hidden = !own;
  $("createBtn").hidden = own;
  $("createOwnBtn").hidden = !own;
  // блок «своя озвучка» — только в режиме «С озвучкой» (faceless)
  if ($("voiceOwnBox")) $("voiceOwnBox").hidden = (m !== "faceless");
  $("videoMode").classList.toggle("mode-hot", m === "dynamic"); // акцент на «горячем» режиме
  if (own) {
    const dyn = m === "dynamic";
    $("createOwnBtn").textContent = dyn ? "🔥 Сделать бешеный монтаж" : "Выбрать своё видео";
    $("ownHint").textContent = dyn
      ? "Режим «Бешеный монтаж»: выбери готовый ролик — система сделает динамичный монтаж: караоке-титры, моушн-врезки на числах и списках, CTA-карточка и «дышащий» зум. Без папочных перебивок."
      : "Режим «Своё видео»: выбери готовый ролик — система распознает речь, добавит титры, музыку и биролы-перебивки.";
  }
}
window.api.getConfig().then((c) => { $("videoMode").value = c.videoMode || "faceless"; applyMode(c.videoMode || "faceless"); });
$("videoMode").addEventListener("change", async () => {
  const m = $("videoMode").value;
  applyMode(m);
  const cfg = await window.api.getConfig(); cfg.videoMode = m; await window.api.saveConfig(cfg);
});
$("createOwnBtn").addEventListener("click", async () => {
  setJob("busy", "Выбери видео…");
  $("createOwnBtn").disabled = true;
  const r = await window.api.createOwnVideo();
  $("createOwnBtn").disabled = false;
  if (r.canceled) { setJob("", ""); return; }
  if (r.ok) setJob("ok", "✅ Готово — во вкладке «Готовые видео»" + (r.sentToTg ? " + Telegram" : ""));
  else setJob("err", "❌ " + r.error);
});
$("projNew").addEventListener("click", async () => {
  const name = prompt("Название нового проекта:");
  if (!name) return;
  const r = await window.api.createProject(name);
  if (r.ok) { await refreshProjects(); $("projSel").value = r.name; }
  else alert(r.error || "Не удалось создать");
});

// --- своя озвучка: загрузка файла или запись с микрофона ---
let voiceAudioPath = null;
let mediaRec = null, recChunks = [], recTimer = null, recSec = 0, voUrl = null;
const mmss = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
function voSet(path, label, previewUrl) {
  voiceAudioPath = path;
  const s = $("voStatus");
  if (path) { s.textContent = label; s.className = "vo-status ok"; $("voClear").hidden = false; }
  else { s.textContent = ""; s.className = "vo-status"; $("voClear").hidden = true; }
  // плеер прослушивания
  const pl = $("voPlayer");
  if (voUrl) { URL.revokeObjectURL(voUrl); voUrl = null; }
  if (previewUrl) { voUrl = previewUrl; pl.src = previewUrl; pl.hidden = false; }
  else { pl.removeAttribute("src"); pl.hidden = true; }
}
if ($("voUpload")) {
  $("voUpload").addEventListener("click", () => $("voFile").click());
  $("voFile").addEventListener("change", () => {
    const f = $("voFile").files[0];
    if (f && f.path) voSet(f.path, "📁 " + f.name, URL.createObjectURL(f));
  });
  $("voClear").addEventListener("click", () => { voSet(null); $("voFile").value = ""; });
  $("voRecord").addEventListener("click", async () => {
    const btn = $("voRecord");
    if (mediaRec && mediaRec.state === "recording") { mediaRec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      recChunks = [];
      mediaRec = new MediaRecorder(stream, { audioBitsPerSecond: 128000 });
      mediaRec.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
      mediaRec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(recTimer); $("voTimer").hidden = true;
        btn.textContent = "⏺ Записать"; btn.classList.remove("rec");
        const blob = new Blob(recChunks, { type: "audio/webm" });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        voSet(null);
        const s = $("voStatus"); s.textContent = "сохраняю запись…"; s.className = "vo-status";
        const p = await window.api.saveRecording(Array.from(bytes));
        if (p) voSet(p, "🎙 запись " + mmss(recSec), URL.createObjectURL(blob));
        else { s.textContent = "не удалось сохранить запись"; s.className = "vo-status err"; }
      };
      mediaRec.start();
      recSec = 0; $("voTimer").textContent = "0:00"; $("voTimer").hidden = false;
      recTimer = setInterval(() => { recSec++; $("voTimer").textContent = mmss(recSec); }, 1000);
      btn.textContent = "⏹ Стоп"; btn.classList.add("rec");
    } catch (e) {
      const s = $("voStatus"); s.textContent = "нет доступа к микрофону"; s.className = "vo-status err";
    }
  });
}

// создать видео из окна
$("createBtn").addEventListener("click", async () => {
  const script = $("scriptInput").value.trim();
  if (!script && !voiceAudioPath) { setJob("err", "Вставь сценарий или добавь свою озвучку"); return; }
  setJob("busy", "Запускаю…");
  $("createBtn").disabled = true;
  const r = await window.api.createVideo(script, { voiceAudioPath, voiceEnhance: voiceAudioPath ? $("voEnhance").checked : false });
  $("createBtn").disabled = false;
  if (r.ok) setJob("ok", "✅ Готово — во вкладке «Готовые видео»" + (r.sentToTg ? " + отправлено в Telegram" : ""));
  else setJob("err", "❌ " + r.error);
});

function setJob(cls, text) { const j = $("jobStatus"); j.className = "job " + cls; j.textContent = text; }

// готовые видео — карточки
const esc = (s) => String(s || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
function fmtDate(d) {
  const today = new Date().toISOString().slice(0, 10);
  const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (d === today) return "Сегодня";
  if (d === yest) return "Вчера";
  try { return new Date(d + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }); } catch { return d; }
}
function makeVideoCard(v) {
  const card = document.createElement("div");
  card.className = "fv-item";
  const dur = v.duration ? `${Math.round(v.duration)}с` : "";
  const title = esc(v.title) || esc(v.name);
  const preview = v.thumb ? `<img src="${v.thumb}" />` : `<div class="fv-noimg">🎬</div>`;
  card.innerHTML = `
    <div class="fv-thumb">
      ${preview}
      ${dur ? `<span class="fv-dur">${dur}</span>` : ""}
      <div class="fv-hover">
        <button class="fv-edit" title="Название и описание">✎</button>
        <button class="fv-del" title="Удалить">✕</button>
      </div>
    </div>
    <div class="fv-name" title="${esc(v.description) || title}">${title}</div>`;
  card.querySelector(".fv-thumb img, .fv-noimg")?.addEventListener("click", () => window.api.revealVideo(v.path));
  card.querySelector(".fv-del").addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!confirm("Удалить это видео?")) return;
    await window.api.deleteVideo(v.path); refreshLibrary();
  });
  card.querySelector(".fv-edit").addEventListener("click", (e) => { e.stopPropagation(); openEditor(v); });
  return card;
}
async function refreshLibrary() {
  const list = await window.api.listVideos();
  const el = $("videoList");
  el.className = "";
  if (!list.length) { el.innerHTML = '<div class="empty">Пока нет видео. Создай первое на вкладке «Создать видео».</div>'; return; }
  const groups = {};
  list.forEach((v) => { (groups[v.date] = groups[v.date] || []).push(v); });
  const dates = Object.keys(groups).sort().reverse();
  el.innerHTML = "";
  dates.forEach((d) => {
    const h = document.createElement("div"); h.className = "date-header"; h.textContent = fmtDate(d) + ` · ${groups[d].length}`;
    el.appendChild(h);
    const grid = document.createElement("div"); grid.className = "video-grid";
    groups[d].forEach((v) => grid.appendChild(makeVideoCard(v)));
    el.appendChild(grid);
  });
}

// модалка редактирования названия/описания
function openEditor(v) {
  $("emTitle").value = v.title || "";
  $("emDesc").value = v.description || "";
  $("editModal").hidden = false;
  $("emSave").onclick = async () => {
    await window.api.setVideoMeta(v.path, { title: $("emTitle").value.trim(), description: $("emDesc").value.trim() });
    $("editModal").hidden = true; refreshLibrary();
  };
  $("emCancel").onclick = () => { $("editModal").hidden = true; };
}

// события от main
window.api.on("bot:status", (s) => {
  const el = $("botStatus");
  if (s.running) { el.textContent = "Бот: @" + s.username + " ✓ работает"; el.className = "bot-status on"; }
  else { el.textContent = "Бот выключен" + (s.error ? " (" + s.error + ")" : ""); el.className = "bot-status off"; }
});
window.api.on("job:start", (p) => setJob("busy", (p.source === "telegram" ? "ТГ: " : "") + "получил сценарий…"));
window.api.on("job:progress", (p) => setJob("busy", p.label));
window.api.on("job:done", () => { setJob("ok", "✅ Готово"); refreshLibrary(); });
window.api.on("job:error", (p) => setJob("err", "❌ " + p.error));

// авто-обновление
window.api.on("update:status", (s) => {
  const banner = $("updateBanner"), text = $("updateText"), btn = $("updateBtn");
  banner.hidden = false; btn.hidden = true;
  if (s.state === "available") text.textContent = `Загружаю обновление v${s.version}…`;
  else if (s.state === "downloading") text.textContent = `Загружаю обновление… ${s.percent}%`;
  else if (s.state === "ready") {
    text.textContent = `Доступно обновление v${s.version}.`;
    btn.hidden = false;
    btn.textContent = window.api.platform === "darwin" ? "Скачать обновление" : "Перезапустить и обновить";
  }
  else if (s.state === "error") { banner.hidden = true; }
});
$("updateBtn").addEventListener("click", () => window.api.installUpdate());
