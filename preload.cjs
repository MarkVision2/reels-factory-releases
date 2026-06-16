// Мост между окном и main-процессом (безопасный contextBridge).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (cfg) => ipcRenderer.invoke("config:save", cfg),
  validateTelegram: (token) => ipcRenderer.invoke("telegram:validate", token),
  createVideo: (script) => ipcRenderer.invoke("video:create", script),
  listVideos: () => ipcRenderer.invoke("video:list"),
  revealVideo: (p) => ipcRenderer.invoke("video:reveal", p),
  buildCatalog: () => ipcRenderer.invoke("catalog:build"),
  catalogInfo: () => ipcRenderer.invoke("catalog:info"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  on: (channel, cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload)),
});
