import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { Chunk } from "../types";

const norm = (w: string) => w.toLowerCase().trim().replace(/[.,!?:;»«"'—-]/g, "");

const justify = (pos: "top" | "center" | "bottom") =>
  pos === "top" ? "flex-start" : pos === "bottom" ? "flex-end" : "center";

type Props = { chunks: Chunk[]; accent: string; position: "top" | "center" | "bottom" };

// Анимированные титры на прозрачном фоне (поверх видео).
export const Captions: React.FC<Props> = ({ chunks, accent, position }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sec = frame / fps;
  // нижняя безопасная зона Reels: текст в нижней трети, но выше интерфейса (подпись/кнопки ~280px)
  const padBottom = position === "bottom" ? 340 : 0;
  const padTop = position === "top" ? 300 : 0;

  return (
    <AbsoluteFill
      style={{
        justifyContent: justify(position),
        alignItems: "center",
        padding: `${padTop}px 50px ${padBottom}px`,
        boxSizing: "border-box",
      }}
    >
      {chunks.map((c, i) => {
        if (sec < c.start || sec >= c.end) return null;

        const startF = c.start * fps;
        const endF = c.end * fps;
        const local = frame - startF;
        const span = endF - startF;

        const enter = spring({ frame: local, fps, config: { damping: 200, stiffness: 120 } });
        const appear = interpolate(local, [0, 5], [0, 1], { extrapolateRight: "clamp" });
        const exit = interpolate(local, [span - 4, span], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const opacity = Math.min(appear, exit);
        const scale = interpolate(enter, [0, 1], [0.82, 1]);
        const y = interpolate(enter, [0, 1], [44, 0]);

        const hl = new Set((c.hl ?? []).map(norm));
        const tokens = c.text.split(/\s+/).filter(Boolean);
        // авто-подгонка кегля: самое длинное слово должно влезть в строку целиком (без разрыва)
        const baseSize = c.big ? 104 : 80;
        const glyph = c.big ? 0.62 : 0.58; // прибл. ширина символа Montserrat Black (доля от кегля)
        const longest = Math.max(1, ...tokens.map((t) => t.length));
        const fitCap = Math.floor(940 / (longest * glyph));
        const fontSize = Math.min(baseSize, Math.max(52, fitCap));

        return (
          <div
            key={i}
            style={{
              transform: `translateY(${y}px) scale(${scale})`,
              opacity,
              textAlign: "center",
              fontFamily: "Montserrat, sans-serif",
              fontWeight: 900,
              fontSize,
              lineHeight: 1.06,
              color: "#ffffff",
              textShadow: "0 8px 38px rgba(0,0,0,0.85), 0 2px 6px rgba(0,0,0,0.9)",
              textTransform: c.big ? "uppercase" : "none",
              letterSpacing: c.big ? "-1px" : "0",
              width: "100%",
              maxWidth: 980,
              marginLeft: "auto",
              marginRight: "auto",
              boxSizing: "border-box",
              whiteSpace: "normal",
              overflowWrap: "normal",  // НЕ рвём слова посреди (никаких «таргетолог»+«а»)
              wordBreak: "normal",
              hyphens: "none",
            }}
          >
            {c.words && c.words.length ? (
              // караоке: слова всплывают по мере произнесения, ударные — «поп» + жёлтое свечение
              c.words.map((wd, j) => {
                const since = sec - wd.start;
                const spoken = since >= 0;
                const pop = wd.hl && since >= 0 && since < 0.3 ? 1 + Math.sin(Math.min(since / 0.16, 1) * Math.PI) * 0.14 : 1;
                const color = wd.hl ? accent : spoken ? "#ffffff" : "rgba(255,255,255,0.5)";
                const glow = wd.hl ? ", 0 0 26px rgba(250,204,21,0.7)" : "";
                return (
                  <React.Fragment key={j}>
                    <span style={{ display: "inline-block", color, transform: `scale(${pop})`, textShadow: `0 8px 38px rgba(0,0,0,0.85), 0 2px 6px rgba(0,0,0,0.9)${glow}` }}>{wd.w}</span>
                    {j < (c.words?.length ?? 0) - 1 ? " " : ""}
                  </React.Fragment>
                );
              })
            ) : (
              tokens.map((tok, j) => (
                <React.Fragment key={j}>
                  <span style={{ color: hl.has(norm(tok)) ? accent : "#ffffff" }}>{tok}</span>
                  {j < tokens.length - 1 ? " " : ""}
                </React.Fragment>
              ))
            )}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
