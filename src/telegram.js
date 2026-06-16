// Telegram-бот через long-polling (getUpdates) — НЕ webhook.
// Работает за любым домашним роутером без публичного URL. Пока приложение запущено — бот отвечает.
import { promises as fs } from "node:fs";

const api = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

export const validateToken = async (token) => {
  const res = await fetch(api(token, "getMe"), { signal: AbortSignal.timeout(12000) });
  const d = await res.json();
  if (!d.ok) throw new Error(d.description || "неверный токен");
  return d.result; // {id, username, first_name}
};

export const sendMessage = async (token, chatId, text) => {
  const res = await fetch(api(token, "sendMessage"), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  return res.json();
};

// ссылка на скачивание файла Telegram (для голосовых)
export const getFileLink = async (token, fileId) => {
  const res = await fetch(api(token, "getFile") + `?file_id=${fileId}`);
  const d = await res.json();
  if (!d.ok) throw new Error(d.description || "getFile failed");
  return `https://api.telegram.org/file/bot${token}/${d.result.file_path}`;
};

export const sendDocument = async (token, chatId, filePath, caption = "") => {
  const buf = await fs.readFile(filePath);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption.slice(0, 1000));
  form.append("document", new Blob([buf], { type: "video/mp4" }), "reel.mp4");
  const res = await fetch(api(token, "sendDocument"), { method: "POST", body: form });
  const d = await res.json();
  if (!d.ok) throw new Error(`Telegram: ${d.description}`);
  return d.result;
};

// Бесконечный цикл polling. onMessage({chatId, text}) вызывается на каждое текстовое сообщение.
export class TelegramBot {
  constructor(token, onMessage, onLog = () => {}) {
    this.token = token; this.onMessage = onMessage; this.onLog = onLog;
    this.offset = 0; this.running = false;
  }
  start() { if (this.running) return; this.running = true; this._loop(); this.onLog("Бот запущен (polling)"); }
  stop() { this.running = false; this.onLog("Бот остановлен"); }
  async _loop() {
    while (this.running) {
      try {
        const res = await fetch(api(this.token, "getUpdates") + `?timeout=25&offset=${this.offset}`, { signal: AbortSignal.timeout(30000) });
        const d = await res.json();
        if (d.ok) {
          for (const u of d.result) {
            this.offset = u.update_id + 1;
            const msg = u.message;
            if (!msg) continue;
            if (msg.text && !msg.text.startsWith("/")) {
              this.onMessage({ chatId: msg.chat.id, text: msg.text, from: msg.from });
            } else if (msg.voice || msg.audio) {
              this.onMessage({ chatId: msg.chat.id, voiceFileId: (msg.voice || msg.audio).file_id, from: msg.from });
            }
          }
        }
      } catch (e) { this.onLog("polling err: " + e.message); await new Promise((r) => setTimeout(r, 3000)); }
    }
  }
}
