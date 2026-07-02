import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Insert } from "../../types";
import { CrossSwap } from "./CrossSwap";
import { HookCard } from "./HookCard";
import { ListStack } from "./ListStack";
import { StatCard } from "./StatCard";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// Поверх видео: активная врезка влетает зум-блюром (без вспышек). Непрозрачная — перекрывает кадр.
export const InsertRenderer: React.FC<{ inserts: Insert[]; accent: string }> = ({ inserts, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sec = frame / fps;

  const active = inserts.find((i) => sec >= i.start && sec < i.end);
  if (!active) return null;

  const local = sec - active.start;
  const dur = active.end - active.start;
  const op = Math.min(
    interpolate(local, [0, 0.1], [0, 1], clamp),
    interpolate(dur - local, [0, 0.1], [0, 1], clamp),
  );
  const scale = interpolate(local, [0, 0.2], [1.12, 1], clamp);
  const blur = interpolate(local, [0, 0.2], [16, 0], clamp);

  const d = active.data || {};
  let scene: React.ReactNode = null;
  if (active.kind === "hook") scene = <HookCard start={active.start} accent={accent} lines={d.lines || []} />;
  else if (active.kind === "stat") scene = <StatCard start={active.start} accent={accent} value={d.value || ""} label={d.label} sub={d.sub} />;
  else if (active.kind === "list") scene = <ListStack start={active.start} accent={accent} title={d.title} items={d.items || []} footer={d.footer} />;
  else if (active.kind === "cross") scene = <CrossSwap start={active.start} accent={accent} oldItems={d.oldItems || []} newItems={d.newItems} stamp={d.stamp} />;
  if (!scene) return null;

  return (
    <AbsoluteFill style={{ opacity: op, transform: `scale(${scale})`, filter: `blur(${blur}px)` }}>
      {scene}
    </AbsoluteFill>
  );
};
