// Мост между окном и main-процессом (безопасный contextBridge).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (cfg) => ipcRenderer.invoke("config:save", cfg),
  validateTelegram: (token) => ipcRenderer.invoke("telegram:validate", token),
  createVideo: (script) => ipcRenderer.invoke("video:create", script),
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
  createProject: (name) => ipcRenderer.invoke("projects:create", name),
  setActiveProject: (name) => ipcRenderer.invoke("projects:setActive", name),
  setFont: () => ipcRenderer.invoke("brand:setFont"),
  clearFont: () => ipcRenderer.invoke("brand:clearFont"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  on: (channel, cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload)),
  platform: process.platform,
});
