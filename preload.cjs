// Мост между окном и main-процессом (безопасный contextBridge).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (cfg) => ipcRenderer.invoke("config:save", cfg),
  validateTelegram: (token) => ipcRenderer.invoke("telegram:validate", token),
  createVideo: (script, opts) => ipcRenderer.invoke("video:create", script, opts),
  createOwnVideo: () => ipcRenderer.invoke("video:createOwn"),
  saveRecording: (bytes) => ipcRenderer.invoke("audio:saveRecording", bytes),
  checkQuota: (service, key) => ipcRenderer.invoke("quota:check", { service, key }),
  testFreedom: (opts) => ipcRenderer.invoke("freedom:test", opts),
  freedomVoices: () => ipcRenderer.invoke("freedom:voices"),
  pickFreedomClone: () => ipcRenderer.invoke("freedom:pickClone"),
  analyzeReference: () => ipcRenderer.invoke("reference:analyze"),
  extractRefClips: (opts) => ipcRenderer.invoke("reference:extractClips", opts),
  listTemplates: () => ipcRenderer.invoke("templates:list"),
  saveTemplate: (profile) => ipcRenderer.invoke("templates:save", profile),
  deleteTemplate: (id) => ipcRenderer.invoke("templates:delete", id),
  setActiveTemplate: (id) => ipcRenderer.invoke("templates:setActive", id),
  listVideos: () => ipcRenderer.invoke("video:list"),
  revealVideo: (p) => ipcRenderer.invoke("video:reveal", p),
  deleteVideo: (p) => ipcRenderer.invoke("video:delete", p),
  setVideoMeta: (p, patch) => ipcRenderer.invoke("video:meta:set", p, patch),
  openContent: (which) => ipcRenderer.invoke("content:open", which),
  browseContent: (rel) => ipcRenderer.invoke("content:browse", rel),
  mkdirContent: (rel, name) => ipcRenderer.invoke("content:mkdir", rel, name),
  addContentTo: (rel) => ipcRenderer.invoke("content:addTo", rel),
  removeContent: (p) => ipcRenderer.invoke("content:removeFile", p),
  setClipMeta: (filePath, patch) => ipcRenderer.invoke("content:setClipMeta", filePath, patch),
  listProjects: () => ipcRenderer.invoke("projects:list"),
  createProject: (name, brief) => ipcRenderer.invoke("projects:create", name, brief),
  setActiveProject: (name) => ipcRenderer.invoke("projects:setActive", name),
  getProjectBrief: (name) => ipcRenderer.invoke("projects:getBrief", name),
  setProjectBrief: (name, brief) => ipcRenderer.invoke("projects:setBrief", name, brief),
  setFont: () => ipcRenderer.invoke("brand:setFont"),
  clearFont: () => ipcRenderer.invoke("brand:clearFont"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  on: (channel, cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload)),
  platform: process.platform,
});

// сигнал «контент реально отрисован» — main покажет окно только после этого (нет пустого синего экрана)
window.addEventListener("DOMContentLoaded", () => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try { ipcRenderer.send("renderer-painted"); } catch {}
  }));
});
