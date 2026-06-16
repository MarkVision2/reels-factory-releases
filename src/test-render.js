// CLI-проверка локального пайплайна (без облака): озвучка -> подбор по каталогу -> рендер -> mp4.
import { generateVideo } from "./pipeline.js";

const script = process.argv[2] || `Я упростил жизнь таргетологов и собрал решение, где денег больше, а работы меньше.

Система, где креативы создаёт контент-завод за 5–10 минут, а рекламу запускает за пару кликов.

20 июня, Павлодар, покажу, как это выглядит. Количество мест ограничено, жми «Подробнее» и регистрируйся.`;

const config = {
  elevenKey: process.env.ELEVEN_KEY,
  openaiKey: process.env.OPENAI_KEY || null,   // без него — эвристика по каталогу
  pexelsKey: process.env.PEXELS_KEY || null,
  catalogUrl: "https://szfgdruhlebfvcmlvxdk.supabase.co/storage/v1/object/public/renders/catalog/marketer/catalog.json",
  musicUrl: "https://szfgdruhlebfvcmlvxdk.supabase.co/storage/v1/object/public/renders/music/own1781400_mdb.mp3",
  musicVolume: 0.05,
};

const t0 = Date.now();
generateVideo({ script, config, onProgress: (p) => console.log("•", p.label) })
  .then((r) => console.log("\n✅ Готово:", r.outPath, `| ${r.duration?.toFixed(1)}с | ${r.clips} клипов | титры:${r.captions} | ${((Date.now() - t0) / 1000).toFixed(0)}с`))
  .catch((e) => { console.error("\n❌", e.message); process.exit(1); });
