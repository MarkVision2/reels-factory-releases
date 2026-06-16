// Google Drive — БЕЗ OAuth. Клиент делает папку «доступ по ссылке», вставляет ссылку.
// Список содержимого — через Drive API key (read-only). Скачивание — прямой usercontent URL.
import { promises as fs } from "node:fs";

const VIDEO_MIME = /^video\//;

export const extractFolderId = (input) => {
  const s = String(input || "").trim();
  const m = s.match(/folders\/([a-zA-Z0-9_-]{10,})/) || s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(s)) return s; // вставили голый ID
  return null;
};

// список видеофайлов публичной (по ссылке) папки
export const listFolder = async (folderId, apiKey) => {
  if (!apiKey) throw new Error("Нужен Google API key (Drive API) — см. подсказку в настройках");
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}` +
    `&key=${apiKey}&fields=files(id,name,mimeType,size)&pageSize=300&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Drive API ${res.status}: ${t.slice(0, 160)}`);
  }
  const data = await res.json();
  return (data.files || []).filter((f) => VIDEO_MIME.test(f.mimeType || ""));
};

// прямая ссылка на скачивание файла Drive (обходит вирус-предупреждение)
export const driveDownloadUrl = (id) =>
  `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;

// надёжное скачивание файла Drive в локальный путь (следует редиректам, гасит interstitial)
export const driveDownloadTo = async (id, destPath) => {
  const res = await fetch(driveDownloadUrl(id), { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Drive download ${id}: ${res.status}`);
  const ctype = res.headers.get("content-type") || "";
  if (ctype.includes("text/html")) throw new Error(`Drive отдал HTML (файл не публичный?) для ${id}`);
  await fs.writeFile(destPath, Buffer.from(await res.arrayBuffer()));
  return (await fs.stat(destPath)).size;
};
