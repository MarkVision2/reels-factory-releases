import React from "react";
import { AbsoluteFill, interpolate, spring } from "remotion";
import { InsertBg, useLocal } from "./kit";

// Холодный хук-крючок: 1-3 строки крупно, последняя — акцентом.
export const HookCard: React.FC<{ start: number; accent: string; lines: string[] }> = ({ start, accent, lines }) => {
  const { t, fps } = useLocal(start);
  const last = lines.length - 1;
  const sizeFor = (s: string) => Math.min(150, Math.max(64, Math.floor(940 / (Math.max(1, s.length) * 0.6))));

  return (
    <InsertBg accent={accent}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", padding: "0 60px", textAlign: "center" }}>
        {lines.map((line, i) => {
          const sp = spring({ frame: (t - i * 0.12) * fps, fps, config: { damping: 12, stiffness: 170 } });
          return (
            <div
              key={i}
              style={{
                transform: `scale(${interpolate(sp, [0, 1], [0.6, 1])})`,
                opacity: interpolate(sp, [0, 0.5], [0, 1], { extrapolateRight: "clamp" }),
                fontWeight: 900,
                fontSize: sizeFor(line),
                lineHeight: 1.0,
                marginTop: i ? 8 : 0,
                textTransform: "uppercase",
                letterSpacing: "-2px",
                color: i === last ? accent : "#fff",
                textShadow: i === last ? `0 0 60px ${accent}99` : "0 8px 38px rgba(0,0,0,0.6)",
              }}
            >
              {line}
            </div>
          );
        })}
      </AbsoluteFill>
    </InsertBg>
  );
};
