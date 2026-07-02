import React from "react";
import { Composition, type CalculateMetadataFunction } from "remotion";
import { Overlay } from "./Overlay";
import { OVERLAY_DEFAULTS, type OverlayProps } from "./types";

// Размер/длительность/fps берём из пропсов (их задаёт приложение под конкретный ролик).
const calcMeta: CalculateMetadataFunction<OverlayProps> = ({ props }) => ({
  durationInFrames: props.durationInFrames,
  fps: props.fps,
  width: props.width,
  height: props.height,
});

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Overlay"
    component={Overlay}
    durationInFrames={OVERLAY_DEFAULTS.durationInFrames}
    fps={OVERLAY_DEFAULTS.fps}
    width={OVERLAY_DEFAULTS.width}
    height={OVERLAY_DEFAULTS.height}
    defaultProps={OVERLAY_DEFAULTS}
    calculateMetadata={calcMeta}
  />
);
