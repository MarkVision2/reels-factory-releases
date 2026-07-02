import React from "react";
import { AbsoluteFill, interpolate, spring } from "remotion";
import { BLUE, InsertBg, useLocal } from "./kit";

// Крупная цифра/стат с поп-анимацией: подпись сверху, значение, подпись снизу.
export const StatCard: React.FC<{
  start: number;
  accent: string;
  value: string;
  label?: string;
  sub?: string;
}> = ({ start, accent, value, label, sub }) => {
  const { t, fps } = useLocal(start);
  const sp = spring({ frame: t * fps, fps, config: { damping: 11, stiffness: 150 } });
  const scale = interpolate(sp, [0, 1], [0.4, 1]);
  const op = interpolate(t, [0, 0.2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const vSize = Math.min(300, Math.max(120, Math.floor(960 / (Math.max(1, value.length) * 0.62))));

  return (
    <InsertBg accent={accent}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", padding: "0 60px", textAlign: "center", opacity: op }}>
        {label ? (
          <div style={{ fontWeight: 900, fontSize: 48, color: "rgba(255,255,255,0.6)", letterSpacing: 5, marginBottom: 24, textTransform: "uppercase" }}>
            {label}
          </div>
        ) : null}
        <div style={{ transform: `scale(${scale})`, fontWeight: 900, fontSize: vSize, lineHeight: 0.9, color: accent, textShadow: `0 0 60px ${accent}99` }}>
          {value}
        </div>
        {sub ? (
          <div style={{ marginTop: 18, fontWeight: 800, fontSize: 46, color: BLUE, textTransform: "uppercase" }}>{sub}</div>
        ) : null}
      </AbsoluteFill>
    </InsertBg>
  );
};
