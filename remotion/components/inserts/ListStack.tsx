import React from "react";
import { AbsoluteFill, interpolate, spring } from "remotion";
import { Chip, DOTS, InsertBg, useLocal } from "./kit";

// Перечисление → карточки влетают стопкой, опц. итоговый штамп.
export const ListStack: React.FC<{
  start: number;
  accent: string;
  title?: string;
  items: string[];
  footer?: string;
}> = ({ start, accent, title, items, footer }) => {
  const { t, fps } = useLocal(start);
  const list = items.slice(0, 5);

  return (
    <InsertBg accent={accent}>
      {title ? (
        <div style={{ position: "absolute", top: 250, left: 0, right: 0, textAlign: "center", fontWeight: 900, fontSize: 46, color: "rgba(255,255,255,0.55)", letterSpacing: 6, textTransform: "uppercase" }}>
          {title}
        </div>
      ) : null}

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: 24 }}>
        {list.map((label, i) => {
          const sp = spring({ frame: (t - (0.2 + i * 0.4)) * fps, fps, config: { damping: 13, stiffness: 120, mass: 0.8 } });
          const x = interpolate(sp, [0, 1], [i % 2 ? 640 : -640, 0]);
          const op = interpolate(sp, [0, 0.5], [0, 1], { extrapolateRight: "clamp" });
          return (
            <div key={i} style={{ transform: `translateX(${x}px)`, opacity: op }}>
              <Chip label={label.toUpperCase()} dot={DOTS[i % DOTS.length]} />
            </div>
          );
        })}
      </AbsoluteFill>

      {footer && t >= 0.2 + list.length * 0.4 ? (
        (() => {
          const d = 0.2 + list.length * 0.4;
          const sp = spring({ frame: (t - d) * fps, fps, config: { damping: 9, stiffness: 150 } });
          return (
            <div
              style={{
                position: "absolute",
                bottom: 290,
                left: 0,
                right: 0,
                textAlign: "center",
                transform: `scale(${interpolate(sp, [0, 1], [1.6, 1])})`,
                opacity: interpolate(sp, [0, 0.35], [0, 1], { extrapolateRight: "clamp" }),
              }}
            >
              <span style={{ display: "inline-block", background: accent, color: "#0a0a0f", fontWeight: 900, fontSize: 80, padding: "18px 44px", borderRadius: 20, transform: "rotate(-3deg)", boxShadow: `0 0 60px ${accent}8c`, textTransform: "uppercase" }}>
                {footer}
              </span>
            </div>
          );
        })()
      ) : null}
    </InsertBg>
  );
};
