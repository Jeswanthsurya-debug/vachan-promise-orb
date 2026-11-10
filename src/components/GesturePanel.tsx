"use client";
/**
 * GesturePanel.tsx — the small camera preview (bottom-left) with the hand skeleton on top.
 * It owns the webcam + MediaPipe lifecycle: mounting starts it, unmounting stops it.
 * If the camera is denied, it calls `onFailed` and the app keeps working with mouse/touch.
 */
import { useEffect, useRef, useState } from "react";
import { GestureController, drawHand, type GestureHandlers, type GestureName } from "@/lib/gestures";

interface Props {
  getHandlers: () => GestureHandlers;
  onFailed: (message: string) => void;
}

const LABELS: Record<GestureName, string> = {
  none: "Show your hand 🖐️",
  palm: "✋ Rotating",
  pinch: "🤏 Zooming",
  fist: "✊ Hold to listen…",
};

export default function GesturePanel({ getHandlers, onFailed }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [label, setLabel] = useState<string>(LABELS.none);
  const handlersRef = useRef(getHandlers);
  const failedRef = useRef(onFailed);
  useEffect(() => {
    handlersRef.current = getHandlers;
    failedRef.current = onFailed;
  });

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");
    let cancelled = false;
    let lastLabel = "";

    const controller = new GestureController(
      video,
      () => handlersRef.current(),
      (f) => {
        if (ctx) drawHand(ctx, f.landmarks, canvas.width, canvas.height, f.gesture === "fist" ? "#FFC83D" : "#22E4FF");
        const next = f.gesture === "fist" ? `✊ Hold… ${Math.round(f.fistProgress * 100)}%` : LABELS[f.gesture];
        if (next !== lastLabel) {
          lastLabel = next;
          setLabel(next);
        }
      },
    );

    controller
      .start()
      .then(() => {
        if (!cancelled) setStatus("ready");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
        failedRef.current(
          denied
            ? "Camera is blocked. No problem — use your mouse or finger instead."
            : "Hand tracking could not start. You can still use your mouse or finger.",
        );
      });

    return () => {
      cancelled = true;
      controller.stop();
    };
  }, []);

  return (
    <div className="glass fixed left-3 top-[12.5rem] z-20 w-[116px] overflow-hidden sm:bottom-6 sm:left-5 sm:top-auto sm:w-[190px]">
      <div className="relative aspect-[4/3] bg-black/60">
        {/* mirrored like a selfie so left/right feel natural */}
        <video ref={videoRef} className="absolute inset-0 h-full w-full -scale-x-100 object-cover" playsInline muted />
        <canvas ref={canvasRef} width={320} height={240} className="absolute inset-0 h-full w-full -scale-x-100" />
        {status === "loading" && (
          <div className="absolute inset-0 grid place-items-center bg-black/50 text-[11px] text-slate-200">Starting camera…</div>
        )}
      </div>
      <div className="px-2 py-1.5 text-center text-[11px] font-semibold text-amber-100 sm:text-xs" aria-live="polite">
        {status === "ready" ? label : "Please allow camera"}
      </div>
    </div>
  );
}
