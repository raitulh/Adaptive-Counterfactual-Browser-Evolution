"use client";

import { useEffect, useState } from "react";
import { createTelemetryRecorder, type TelemetryRecorder } from "@/lib/verification/telemetry";

/**
 * A telemetry recorder bound to the document while the calling component is
 * mounted. Mount it with the challenge so timing starts when the challenge appears.
 */
export function useInteractionTelemetry(): TelemetryRecorder {
  const [recorder] = useState(() => createTelemetryRecorder());

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) =>
      recorder.pointerMove(event.clientX, event.clientY, event.isTrusted);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") recorder.visibilityChange();
    };
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [recorder]);

  return recorder;
}
