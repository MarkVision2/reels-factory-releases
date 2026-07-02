// Реальный прогон пайплайна в режиме «Бешеный монтаж» (dynamic) — как делает приложение.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateVideo } from "../src/pipeline.js";

const CFG_PATH = path.join(os.homedir(), "Library/Application Support/reels-factory-desktop/config.json");
const SRC = "/tmp/test-src.mp4";

const cfg = JSON.parse(await fs.readFile(CFG_PATH, "utf8"));
console.log("config: eleven=", cfg.elevenKey ? "ok" : "MISSING", "| project=", cfg.activeProject || "(none)", "| remotionOverlay=", cfg.remotionOverlay);

const r = await generateVideo({
  script: "",
  config: { ...cfg, videoMode: "dynamic", sourceVideo: SRC },
  onProgress: (p) => { if (p?.label) console.log("·", (p.step || "") + ":", p.label); },
});
console.log("DONE outPath:", r.outPath, "| duration:", r.duration);
