// Логика окна: вкладки, настройка, создание видео, статус бота.
const $ = (id) => document.getElementById(id);
const FIELDS = ["telegramToken", "elevenKey", "voiceId", "openaiKey", "pexelsKey", "driveFolderUrl", "googleApiKey", "genProvider", "falKey", "falModel", "genMax", "catalogUrl", "musicUrl"];

// вкладки
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    $("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "library") refreshLibrary();
  });
});

// загрузка конфига
async function loadCfg() {
  const cfg = await window.api.getConfig();
  FIELDS.forEach((f) => { if ($(f)) $(f).value = cfg[f] || ""; });
  // первый запуск → визард
  if (!cfg.telegramToken || !cfg.elevenKey) startWizard();
}
loadCfg();

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
  await window.api.saveConfig(cfg);
  const b = $("saveBadge"); b.textContent = "✓ сохранено"; b.className = "badge ok";
  setTimeout(() => { b.textContent = ""; }, 2500);
});

// собрать каталог из Google Drive
async function showCatInfo() {
  const info = await window.api.catalogInfo();
  const b = $("catBadge");
  if (info.count) { b.textContent = `✓ в каталоге ${info.count} клипов (${Object.entries(info.byType).map(([k, v]) => k + ":" + v).join(", ")})`; b.className = "badge ok"; }
  else { b.textContent = "каталог пуст"; b.className = "badge"; }
}
showCatInfo();

$("buildCatBtn").addEventListener("click", async () => {
  const cfg = await window.api.getConfig();
  FIELDS.forEach((f) => { if ($(f)) cfg[f] = $(f).value.trim(); });
  await window.api.saveConfig(cfg); // сохранить ссылку/ключ перед сборкой
  $("buildCatBtn").disabled = true;
  $("catBadge").textContent = "сканирую папку…"; $("catBadge").className = "badge";
  const r = await window.api.buildCatalog();
  $("buildCatBtn").disabled = false;
  $("catProg").textContent = "";
  if (r.ok) { $("catBadge").textContent = `✓ собрано ${r.count} клипов (${Object.entries(r.byType || {}).map(([k, v]) => k + ":" + v).join(", ")})`; $("catBadge").className = "badge ok"; }
  else { $("catBadge").textContent = "✗ " + r.error; $("catBadge").className = "badge err"; }
});

window.api.on("catalog:progress", (p) => {
  if (p.total) $("catProg").textContent = `${p.done}/${p.total}` + (p.name ? ` — ${p.name}` : "") + (p.error ? ` (ошибка: ${p.error})` : "");
});

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

// библиотека
async function refreshLibrary() {
  const list = await window.api.listVideos();
  const el = $("videoList");
  if (!list.length) { el.innerHTML = '<div class="empty">Пока нет видео. Создай первое на вкладке «Создать видео».</div>'; return; }
  el.innerHTML = "";
  list.forEach((v) => {
    const row = document.createElement("div");
    row.className = "video-item";
    const mb = (v.size / 1048576).toFixed(1);
    const when = new Date(v.mtime).toLocaleString("ru-RU");
    row.innerHTML = `<div><div class="name">${v.name}</div><div class="meta">${mb} МБ · ${when}</div></div>`;
    const btn = document.createElement("button");
    btn.textContent = "Показать в папке";
    btn.addEventListener("click", () => window.api.revealVideo(v.path));
    row.appendChild(btn);
    el.appendChild(row);
  });
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
