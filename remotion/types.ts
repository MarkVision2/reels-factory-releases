// Пропсы оверлея — данные приходят из приложения (pipeline.js).
// Все тайм-коды в СЕКУНДАХ. Конвертация в кадры: Math.round(sec * fps).

export type Chunk = {
  text: string;       // фраза-блок субтитра
  start: number;      // сек, абсолютный тайм-код начала
  end: number;        // сек, конец
  hl?: string[];      // слова для акцентной подсветки
  big?: boolean;      // крупный кегль — смысловой удар
  words?: { w: string; start: number; end: number; hl?: boolean }[]; // пословно — для караоке
};

export type Cta = {
  start: number;      // сек, когда появляется CTA
  lines: string[];    // строки заголовка (по строке = перенос)
  button: string;     // текст кнопки
  urgency: string;    // строка дефицита («места ограничены»)
};

// Моушн-графика-врезка (b-roll) поверх видео в окне [start,end].
export type InsertKind = "hook" | "stat" | "list" | "cross";
export type Insert = {
  kind: InsertKind;
  start: number;      // сек
  end: number;        // сек
  data: {
    lines?: string[];          // hook
    value?: string;            // stat: крупное значение
    label?: string;            // stat/верхняя подпись
    sub?: string;              // stat: нижняя подпись
    title?: string;            // list: заголовок
    items?: string[];          // list: пункты
    footer?: string;           // list: итоговый штамп
    oldItems?: string[];       // cross: перечёркиваемое
    newItems?: string[];       // cross: новое (опц.)
    stamp?: string;            // cross: штамп (если без newItems)
  };
};

export type OverlayProps = {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  accent: string;            // акцентный цвет (#facc15 по умолчанию)
  capPosition: "top" | "center" | "bottom";
  chunks: Chunk[];           // анимированные титры (пусто = без титров)
  cta: Cta | null;           // CTA-карточка (null = без CTA)
  inserts: Insert[];         // моушн-графика-врезки (пусто = без врезок)
};

export const OVERLAY_DEFAULTS: OverlayProps = {
  fps: 30,
  width: 1080,
  height: 1920,
  durationInFrames: 30 * 10,
  accent: "#facc15",
  capPosition: "center",
  chunks: [],
  cta: null,
  inserts: [],
};
