// Пред-сборка Remotion-композиции в remotion-bundle/ (один раз на этапе сборки приложения).
// Рантайм берёт готовый бандл → первый ролик не ждёт webpack.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entryPoint = path.resolve(__dirname, "../remotion/index.ts");
const outDir = path.resolve(__dirname, "../remotion-bundle");

console.log("▶ Remotion: пред-сборка бандла → remotion-bundle/ …");
const out = await bundle({ entryPoint, outDir });
console.log("✅ Готово:", out);
