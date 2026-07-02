// Рендер прозрачного оверлея (анимированные титры + CTA) через Remotion.
// Выход — webm с альфа-каналом (vp8/yuva420p), который ffmpeg кладёт поверх монтажа.
// Бандл кэшируется в памяти процесса: первый рендер дольше, последующие быстрее.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ffmpegPath } from "./render-core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// concurrency зависит от СВОБОДНОЙ RAM, а не только от ядер: каждый headless-Chrome ~1.5-2 ГБ.
// Слишком много потоков на машине с малой RAM → своп-трэшинг и рендер становится МЕДЛЕННЕЕ.
const pickConcurrency = () => {
  const cores = os.cpus()?.length || 4;
  const totalGiB = (os.totalmem() || 0) / (1024 ** 3); // 8 ГБ → ровно 8.0 (а не 8.59 при /1e9)
  // Опираемся на ЯДРА и ОБЪЁМ RAM (стабильно). НЕ на os.freemem(): на macOS он
  // почти всегда крошечный из-за файлового кэша → рендер ошибочно падал в 1 поток.
  // Рендер идёт в scale 0.7 (меньше RAM/кадр) — потоков можно чуть больше.
  let c = Math.max(1, Math.min(cores - 2, 6));
  if (totalGiB <= 8.5) c = Math.min(c, 3); // ≤8 ГБ → до 3 потоков (баланс скорость/стабильность)
  if (totalGiB <= 4.5) c = 1;
  return c;
};
const CONCURRENCY = pickConcurrency();
// в собранном app.asar исполняемые бинарники Remotion лежат в распакованной части
const unasar = (p) => p.replace("app.asar", "app.asar.unpacked");

let bundlePromise = null;

const getBundle = async (onProgress) => {
  if (!bundlePromise) {
    bundlePromise = (async () => {
      // готовый бандл из сборки приложения (scripts/bundle-remotion.mjs) → без webpack на рантайме
      const prebuilt = unasar(path.resolve(__dirname, "../remotion-bundle"));
      if (existsSync(path.join(prebuilt, "index.html"))) return prebuilt;
      // дев / нет пред-сборки — собираем на лету (медленнее, один раз за сессию)
      const { bundle } = await import("@remotion/bundler");
      const entry = path.resolve(__dirname, "../remotion/index.ts");
      onProgress({ step: "remotion", label: "Remotion: сборка композиции…" });
      return bundle({ entryPoint: entry });
    })();
  }
  return bundlePromise;
};

// chunks[{text,start,end,hl?,big?}], cta{start,lines,button,urgency}|null, inserts, fps, width, height, durationSec, accent, capPosition, scale
// ВАЖНО: рендерим КУСКАМИ по ~8с. На 8 ГБ один сплошной рендер длинного ролика
// (>~700 кадров) накапливает память и виснет на ~70%. Кусками — Chrome
// перезапускается между ними, память освобождается; потом склеиваем (concat -c copy).
export const renderOverlay = async ({
  chunks = [], cta = null, inserts = [], fps = 30, width = 1080, height = 1920,
  durationSec, accent = "#facc15", capPosition = "center", scale = 1, outPath, onProgress = () => {},
}) => {
  const { selectComposition, renderMedia } = await import("@remotion/renderer");
  const { promises: fsp } = await import("node:fs");
  const serveUrl = await getBundle(onProgress);

  const durationInFrames = Math.max(1, Math.ceil(durationSec * fps));
  const inputProps = { fps, width, height, durationInFrames, accent, capPosition, chunks, cta, inserts };
  const composition = await selectComposition({ serveUrl, id: "Overlay", inputProps });

  const CHUNK_FRAMES = 8 * fps; // ~8 c на кусок — гарантированно проходит на 8 ГБ
  const nChunks = Math.ceil(durationInFrames / CHUNK_FRAMES);
  onProgress({ step: "remotion", label: `Remotion: титры (${CONCURRENCY} потоков, ${nChunks} частей)…` });

  const parts = [];
  for (let i = 0; i < nChunks; i += 1) {
    const from = i * CHUNK_FRAMES;
    const to = Math.min(from + CHUNK_FRAMES, durationInFrames) - 1;
    const partPath = outPath.replace(/\.webm$/i, `.part${i}.webm`);
    await renderMedia({
      composition, serveUrl, codec: "vp8", pixelFormat: "yuva420p", imageFormat: "png",
      outputLocation: partPath, inputProps, concurrency: CONCURRENCY, scale,
      frameRange: [from, to], chromiumOptions: { gl: "angle" }, logLevel: "error",
    });
    parts.push({ path: partPath, startSec: from / fps });
    onProgress({ step: "remotion", label: `Remotion: титры ${Math.round(((i + 1) / nChunks) * 100)}%` });
  }

  // НЕ склеиваем: concat у vp8/alpha рвёт либо таймстемпы (-c copy → играл только 1-й
  // кусок), либо альфу (перекодирование → чёрный фон поверх видео). Возвращаем куски —
  // compositeOverlay наложит каждый в своё временно́е окно прямо на видео, сохраняя альфу.
  return parts; // [{ path, startSec }]
};

// Накладываем альфа-КУСКИ оверлея поверх видео — каждый в своё временно́е окно.
// Куски в масштабе <1 → апскейлим до базы. Альфа сохраняется (нет склейки/перекода прозрачности).
// parts: [{ path, startSec }]. Аудио берём из базового видео без перекодирования.
export const compositeOverlay = ({ basePath, parts = [], overlayPath = null, width = 1080, height = 1920, outPath }) =>
  new Promise((resolve, reject) => {
    // обратная совместимость: одиночный overlayPath → один кусок с 0с
    const list = parts.length ? parts : (overlayPath ? [{ path: overlayPath, startSec: 0 }] : []);
    if (!list.length) return reject(new Error("нет частей оверлея"));

    const args = ["-y", "-i", basePath];
    list.forEach((p) => args.push("-c:v", "libvpx", "-i", p.path));

    const f = [];
    let prev = "0:v";
    list.forEach((p, i) => {
      const st = Number(p.startSec || 0).toFixed(3);
      f.push(`[${i + 1}:v]scale=${width}:${height}:flags=bicubic,setpts=PTS+${st}/TB[p${i}]`);
      f.push(`[${prev}][p${i}]overlay=0:0:format=auto:enable='gte(t,${st})':eof_action=pass[v${i}]`);
      prev = `v${i}`;
    });

    const ff = spawn(unasar(ffmpegPath), [
      ...args, "-filter_complex", f.join(";"), "-map", `[${prev}]`, "-map", "0:a?",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "fast",
      "-c:a", "copy", "-movflags", "+faststart", outPath,
    ]);
    let err = "";
    ff.stderr.on("data", (d) => { err += d.toString(); });
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve(outPath) : reject(new Error("composite " + code + ": " + err.slice(-400)))));
  });

export { unasar };
