import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

export const DARK = "#07070d";
export const BLUE = "#38bdf8";
export const RED = "#ef4444";

// Локальное время сцены (секунды от её начала).
export const useLocal = (start: number) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return { t: frame / fps - start, fps, frame };
};

// Непрозрачный «техно»-фон врезки. Без filter:blur (дорого при рендере) —
// мягкость даёт сам radial-gradient. Перекрывает видео под собой.
export const InsertBg: React.FC<{ accent: string; children: React.ReactNode }> = ({ accent, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const dx = Math.sin(t * 0.5) * 4;
  const dy = Math.cos(t * 0.4) * 4;
  return (
    <AbsoluteFill
      style={{
        background:
          `radial-gradient(60% 40% at ${28 + dx}% ${26 + dy}%, #1d4ed855 0%, transparent 60%),` +
          `radial-gradient(55% 38% at ${76 - dx}% ${72 - dy}%, #7c3aed55 0%, transparent 60%),` +
          `radial-gradient(70% 50% at 50% 120%, ${accent}22 0%, transparent 55%),` +
          DARK,
        overflow: "hidden",
        fontFamily: "Montserrat, sans-serif",
      }}
    >
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "90px 90px",
          WebkitMaskImage: "radial-gradient(circle at 50% 45%, #000 30%, transparent 78%)",
          maskImage: "radial-gradient(circle at 50% 45%, #000 30%, transparent 78%)",
        }}
      />
      {children}
      <AbsoluteFill style={{ boxShadow: "inset 0 0 360px 110px #000", pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};

// Пилюля с цветной точкой (роли / преимущества / фичи).
export const Chip: React.FC<{ label: string; dot: string; big?: boolean }> = ({ label, dot, big }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 22,
      background: "rgba(255,255,255,0.07)",
      border: "2px solid rgba(255,255,255,0.14)",
      borderRadius: 999,
      padding: big ? "24px 44px" : "18px 38px",
    }}
  >
    <div style={{ width: big ? 24 : 20, height: big ? 24 : 20, borderRadius: 999, background: dot, boxShadow: `0 0 18px ${dot}` }} />
    <span style={{ color: "#fff", fontWeight: 900, fontSize: big ? 56 : 48, letterSpacing: "-1px" }}>{label}</span>
  </div>
);

export const DOTS = ["#facc15", BLUE, "#22c55e", "#f97316", "#e879f9"];
