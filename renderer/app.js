// Логика окна: вкладки, настройка, создание видео, статус бота.
const $ = (id) => document.getElementById(id);
const FIELDS = ["telegramToken", "elevenKey", "voiceId", "openaiKey", "pexelsKey", "genProvider", "falKey", "falModel", "genMax", "musicUrl", "accentColor"];

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
  await window.api.saveConfig(cfg);
  const b = $("saveBadge"); b.textContent = "✓ сохранено"; b.className = "badge ok";
  setTimeout(() => { b.textContent = ""; }, 2500);
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

// создать видео из окна
$("createBtn").addEventListener("click", async () => {
  const script = $("scriptInput").value.trim();
  if (!script) return;
  setJob("busy", "Запускаю…");
  $("createBtn").disabled = true;
  const r = await window.api.createVideo(script);
  $("createBtn").disabled = false;
  if (r.ok) setJob("ok", "✅ Готово — смотри во вкладке «Мои видео»");
  else setJob("err", "❌ " + r.error);
});

function setJob(cls, text) { const j = $("jobStatus"); j.className = "job " + cls; j.textContent = text; }

// готовые видео — карточки
const esc = (s) => String(s || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
async function refreshLibrary() {
  const list = await window.api.listVideos();
  const el = $("videoList");
  if (!list.length) { el.innerHTML = '<div class="empty">Пока нет видео. Создай первое на вкладке «Создать видео».</div>'; return; }
  el.innerHTML = "";
  list.forEach((v) => {
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
    el.appendChild(card);
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
  else if (s.state === "ready") { text.textContent = `Обновление v${s.version} готово.`; btn.hidden = false; }
  else if (s.state === "error") { banner.hidden = true; }
});
$("updateBtn").addEventListener("click", () => window.api.installUpdate());
