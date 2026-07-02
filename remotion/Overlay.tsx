import "@fontsource/montserrat/700.css";
import "@fontsource/montserrat/800.css";
import "@fontsource/montserrat/900.css";

import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Sequence,
  continueRender,
  delayRender,
  useVideoConfig,
} from "remotion";
import { Captions } from "./components/Captions";
import { CtaScene } from "./components/CtaScene";
import { InsertRenderer } from "./components/inserts/InsertRenderer";
import type { OverlayProps } from "./types";

// Прозрачный оверлей: титры + моушн-графика-врезки + CTA-карточка.
// Фон НЕ заливаем — поверх него ffmpeg положит b-roll-монтаж.
// Врезки рисуем НАД титрами (непрозрачные, перекрывают кадр в своём окне).
export const Overlay: React.FC<OverlayProps> = ({ chunks, cta, accent, capPosition, inserts }) => {
  const { fps } = useVideoConfig();
  const [handle] = useState(() => delayRender("Загрузка шрифта Montserrat"));

  useEffect(() => {
    Promise.all([
      document.fonts.load("700 100px Montserrat"),
      document.fonts.load("800 100px Montserrat"),
      document.fonts.load("900 100px Montserrat"),
    ])
      .then(() => continueRender(handle))
      .catch(() => continueRender(handle));
  }, [handle]);

  return (
    <AbsoluteFill>
      {chunks.length > 0 && <Captions chunks={chunks} accent={accent} position={capPosition} />}
      {inserts && inserts.length > 0 && <InsertRenderer inserts={inserts} accent={accent} />}
      {cta && (
        <Sequence from={Math.round(cta.start * fps)}>
          <CtaScene cta={cta} accent={accent} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
