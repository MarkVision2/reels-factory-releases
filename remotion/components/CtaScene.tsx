import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { Cta } from "../types";

type Props = { cta: Cta; accent: string };

// CTA: крупный заголовок + пульсирующая кнопка + строка дефицита. Прозрачный фон.
export const CtaScene: React.FC<Props> = ({ cta, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pop = spring({ frame, fps, config: { damping: 200, stiffness: 120 } });
  const scale = interpolate(pop, [0, 1], [0.8, 1]);
  const opacity = interpolate(frame, [0, 6], [0, 1], { extrapolateRight: "clamp" });
  const pulse = 1 + Math.sin(frame / 6) * 0.035;
  const lastLine = cta.lines.length - 1;

  return (
    <AbsoluteFill style={{ opacity, fontFamily: "Montserrat, sans-serif" }}>
      {/* плотная полноэкранная подложка — CTA читается поверх любого кадра */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 50% 42%, rgba(10,10,18,0.88) 0%, rgba(6,6,12,0.96) 70%)",
        }}
      />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: "0 80px" }}>
      <div style={{ transform: `scale(${scale})`, textAlign: "center" }}>
        <div
          style={{
            fontWeight: 900,
            fontSize: 112,
            color: "#ffffff",
            lineHeight: 1.0,
            textTransform: "uppercase",
            letterSpacing: "-2px",
            textShadow: "0 10px 44px rgba(0,0,0,0.65)",
          }}
        >
          {cta.lines.map((line, i) => (
            <React.Fragment key={i}>
              <span style={i === lastLine ? { color: accent } : undefined}>{line}</span>
              {i < lastLine && <br />}
            </React.Fragment>
          ))}
        </div>

        <div
          style={{
            marginTop: 72,
            display: "inline-block",
            transform: `scale(${pulse})`,
            background: accent,
            color: "#0a0a0f",
            fontWeight: 900,
            fontSize: 60,
            padding: "32px 68px",
            borderRadius: 120,
            textTransform: "uppercase",
            boxShadow: `0 0 64px ${accent}8c`,
          }}
        >
          {cta.button}
        </div>

        {cta.urgency ? (
          <div style={{ marginTop: 46, fontWeight: 800, fontSize: 44, color: "#ffffff" }}>
            {cta.urgency}
          </div>
        ) : null}
      </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
