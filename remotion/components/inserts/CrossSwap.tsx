import React from "react";
import { AbsoluteFill, interpolate, spring } from "remotion";
import { Chip, DOTS, InsertBg, RED, useLocal } from "./kit";

// «Старое» перечёркивается красным → опц. «новое» влетает. Для «не X, а Y» / «заменяет».
export const CrossSwap: React.FC<{
  start: number;
  accent: string;
  oldItems: string[];
  newItems?: string[];
  stamp?: string;
}> = ({ start, accent, oldItems, newItems = [], stamp }) => {
  const { t, fps } = useLocal(start);
  const olds = oldItems.slice(0, 4);
  const hasNew = newItems.length > 0;
  const crossDone = 0.15 + olds.length * 0.2 + 0.3;

  return (
    <InsertBg accent={accent}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 26, marginTop: hasNew ? -120 : 0 }}>
        {olds.map((r, i) => {
          const d = 0.15 + i * 0.2;
          const strike = interpolate(t, [d, d + 0.28], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const up = hasNew ? interpolate(t, [crossDone, crossDone + 0.4], [0, -80], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
          return (
            <div key={i} style={{ position: "relative", transform: `translateY(${up}px)`, opacity: interpolate(t, [0, 0.3], [0, 1], { extrapolateRight: "clamp" }) }}>
              <span style={{ fontWeight: 900, fontSize: 72, color: "#fff", opacity: interpolate(strike, [0, 1], [1, 0.4]), letterSpacing: "-1px", textTransform: "uppercase" }}>{r}</span>
              <div style={{ position: "absolute", top: "52%", left: -10, height: 11, width: `calc(${strike * 100}% + 20px)`, background: RED, borderRadius: 8, boxShadow: `0 0 20px ${RED}` }} />
            </div>
          );
        })}
      </AbsoluteFill>

      {hasNew ? (
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 22, marginTop: 240 }}>
          {newItems.slice(0, 3).map((label, i) => {
            const d = crossDone + 0.2 + i * 0.26;
            const sp = spring({ frame: (t - d) * fps, fps, config: { damping: 13, stiffness: 130 } });
            return (
              <div key={i} style={{ transform: `translateY(${interpolate(sp, [0, 1], [70, 0])}px)`, opacity: interpolate(sp, [0, 0.5], [0, 1], { extrapolateRight: "clamp" }) }}>
                <Chip label={label.toUpperCase()} dot={DOTS[i % DOTS.length]} big />
              </div>
            );
          })}
        </AbsoluteFill>
      ) : null}

      {stamp && !hasNew && t >= crossDone ? (
        (() => {
          const sp = spring({ frame: (t - crossDone) * fps, fps, config: { damping: 9, stiffness: 150 } });
          return (
            <div style={{ position: "absolute", bottom: 320, left: 0, right: 0, textAlign: "center", transform: `scale(${interpolate(sp, [0, 1], [1.6, 1])})`, opacity: interpolate(sp, [0, 0.35], [0, 1], { extrapolateRight: "clamp" }) }}>
              <span style={{ display: "inline-block", background: accent, color: "#0a0a0f", fontWeight: 900, fontSize: 76, padding: "18px 44px", borderRadius: 20, transform: "rotate(-2deg)", boxShadow: `0 0 60px ${accent}8c`, textTransform: "uppercase" }}>
                {stamp}
              </span>
            </div>
          );
        })()
      ) : null}
    </InsertBg>
  );
};
