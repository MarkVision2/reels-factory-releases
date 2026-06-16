// Миниатюры (превью) видео через ffmpeg → base64 data URL для показа в окне.
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { ffmpegPath } from "./render-core.js";

const makeThumb = (videoPath, outJpg, at = 1) =>
  new Promise((resolve) => {
    const p = spawn(ffmpegPath, ["-y", "-ss", String(at), "-i", videoPath, "-frames:v", "1", "-vf", "scale=320:-1", "-q:v", "4", outJpg], { stdio: "ignore" });
    p.on("close", () => resolve());
    p.on("error", () => resolve());
  });

// вернуть data:URL миниатюры (с кэшем в cacheJpg)
export const thumbDataUrl = async (videoPath, cacheJpg, at = 1) => {
  try {
    const fresh = await fs.stat(cacheJpg).then((s) => s.size > 500).catch(() => false);
    if (!fresh) await makeThumb(videoPath, cacheJpg, at);
    const buf = await fs.readFile(cacheJpg);
    if (buf.length < 500) return null;
    return "data:image/jpeg;base64," + buf.toString("base64");
  } catch { return null; }
};
