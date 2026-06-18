// Хранилище стиль-шаблонов (профилей монтажа), считанных с видео-референсов.
// Один шаблон = JSON-файл в userData/templates/<slug>.json. Активный шаблон применяется к рендеру.
import { promises as fs } from "node:fs";
import path from "node:path";

const slug = (name) =>
  (name || "template").toLowerCase().replace(/[^a-zа-я0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "template";

export const templatesDir = (userDataDir) => path.join(userDataDir, "templates");

export const listTemplates = async (userDataDir) => {
  const dir = templatesDir(userDataDir);
  try {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
    const out = [];
    for (const f of files) {
      try { out.push(JSON.parse(await fs.readFile(path.join(dir, f), "utf8"))); } catch {}
    }
    return out.sort((a, b) => (b.created || "").localeCompare(a.created || ""));
  } catch { return []; }
};

export const saveTemplate = async (userDataDir, profile) => {
  const dir = templatesDir(userDataDir);
  await fs.mkdir(dir, { recursive: true });
  const id = profile.id || slug(profile.name);
  const data = { ...profile, id, created: profile.created || new Date().toISOString() };
  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(data, null, 2));
  return data;
};

export const deleteTemplate = async (userDataDir, id) => {
  try { await fs.rm(path.join(templatesDir(userDataDir), `${id}.json`), { force: true }); return true; }
  catch { return false; }
};

export const getTemplate = async (userDataDir, id) => {
  if (!id) return null;
  try { return JSON.parse(await fs.readFile(path.join(templatesDir(userDataDir), `${id}.json`), "utf8")); }
  catch { return null; }
};
