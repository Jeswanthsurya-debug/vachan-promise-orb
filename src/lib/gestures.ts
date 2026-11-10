/**
 * gestures.ts — webcam hand gestures using MediaPipe Hands (loaded from a CDN).
 *
 *   ✋ Open palm, moving slowly  → rotate the camera around the orb
 *   🤏 Pinch + pull / push / lift → zoom in / out
 *   👋 Fast swipe left / right    → previous / next promise
 *   ✊ Closed fist held 0.5 s     → play the voice read-back
 *
 * This file does NOT touch 3D or the page. It only watches the camera and calls
 * the handler functions you give it, so it is easy to read and easy to replace.
 *
 * Coordinates: MediaPipe gives x,y in 0..1 of the *unmirrored* camera image.
 * We mirror x (mx = 1 - x) so "move your hand to your right" means "increase mx",
 * which feels natural in a selfie-style preview.
 */

const HANDS_VERSION = "0.4.1675469240";
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/hands@${HANDS_VERSION}/`;

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface GestureHandlers {
  /** Palm movement in screen-fraction units (dx: right is +, dy: down is +). */
  onRotate(dx: number, dy: number): void;
  onPinchStart(): void;
  /** scale > 1 means zoom in, < 1 means zoom out (relative to when the pinch began). */
  onPinchScale(scale: number): void;
  onPinchEnd(): void;
  /** +1 = swiped right (next), -1 = swiped left (previous). */
  onSwipe(dir: 1 | -1): void;
  onFist(): void;
}

export type GestureName = "none" | "palm" | "pinch" | "fist";

export interface GestureFrame {
  landmarks: Landmark[] | null;
  gesture: GestureName;
  /** 0..1 while holding a fist */
  fistProgress: number;
}

/* ── minimal typings for the MediaPipe global ── */
interface HandsResults {
  multiHandLandmarks?: Landmark[][];
}
interface HandsInstance {
  setOptions(o: Record<string, unknown>): void;
  onResults(cb: (r: HandsResults) => void): void;
  initialize(): Promise<void>;
  send(i: { image: HTMLVideoElement }): Promise<void>;
  close(): Promise<void>;
}
type HandsCtor = new (cfg: { locateFile: (file: string) => string }) => HandsInstance;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.crossOrigin = "anonymous";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load hand tracking"));
    document.head.appendChild(s);
  });
}

const dist = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);

const FIST_HOLD_MS = 500;
const SWIPE_WINDOW_MS = 320;
const SWIPE_MIN_DX = 0.24;
const SWIPE_COOLDOWN_MS = 900;
const ROTATE_MAX_SPEED = 1.6; // faster than this (screen widths/second) is a swipe, not a rotate

export class GestureController {
  private video: HTMLVideoElement;
  private getHandlers: () => GestureHandlers;
  private onFrame: (f: GestureFrame) => void;
  private stream: MediaStream | null = null;
  private hands: HandsInstance | null = null;
  private running = false;
  private raf = 0;
  private lastVideoTime = -1;

  // tracking state
  private prev: { x: number; y: number; t: number } | null = null;
  private history: { x: number; y: number; t: number }[] = [];
  private swipeCooldownUntil = 0;
  private fistStart = 0;
  private fistFired = false;
  private pinchSince = 0;
  private pinchActive = false;
  private pinchLostSince = 0;
  private pinchSize0 = 1;
  private pinchY0 = 0;
  private sizeSmooth = 0;

  constructor(video: HTMLVideoElement, getHandlers: () => GestureHandlers, onFrame: (f: GestureFrame) => void) {
    this.video = video;
    this.getHandlers = getHandlers;
    this.onFrame = onFrame;
  }

  /** Asks for the camera, loads MediaPipe, starts the loop. Throws if anything fails. */
  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();

    await loadScript(CDN_BASE + "hands.js");
    const Hands = (window as unknown as { Hands?: HandsCtor }).Hands;
    if (!Hands) throw new Error("Hand tracking did not load");
    this.hands = new Hands({ locateFile: (f) => CDN_BASE + f });
    this.hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.5 });
    this.hands.onResults((r) => this.handleResults(r));
    await this.hands.initialize();

    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      if (this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = this.video.currentTime;
        try {
          await this.hands!.send({ image: this.video });
        } catch {
          /* skip a bad frame */
        }
      }
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.pinchActive) this.getHandlers().onPinchEnd();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    void this.hands?.close().catch(() => undefined);
    this.hands = null;
  }

  /* ───────────── per-frame logic ───────────── */

  private handleResults(r: HandsResults) {
    const now = performance.now();
    const h = this.getHandlers();
    const lm = r.multiHandLandmarks?.[0];

    if (!lm) {
      if (this.pinchActive) {
        this.pinchActive = false;
        h.onPinchEnd();
      }
      this.prev = null;
      this.history = [];
      this.fistStart = 0;
      this.fistFired = false;
      this.pinchSince = 0;
      this.onFrame({ landmarks: null, gesture: "none", fistProgress: 0 });
      return;
    }

    /* finger extended? compare fingertip vs middle joint distance from the wrist
       (works whatever direction the hand is pointing) */
    const wrist = lm[0];
    const ext = (tip: number, pip: number) => dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.08;
    const idx = ext(8, 6);
    const mid = ext(12, 10);
    const ring = ext(16, 14);
    const pinky = ext(20, 18);
    const extCount = [idx, mid, ring, pinky].filter(Boolean).length;
    const size = dist(lm[0], lm[9]) || 0.1; // wrist → middle knuckle = hand size
    const pinchRatio = dist(lm[4], lm[8]) / size;
    const othersOpen = [mid, ring, pinky].filter(Boolean).length;

    let gesture: GestureName = "none";
    if (pinchRatio < 0.3 && othersOpen >= 2) gesture = "pinch";
    else if (extCount === 0) gesture = "fist";
    else if (extCount >= 4) gesture = "palm";

    const palm = { x: 1 - lm[9].x, y: lm[9].y, t: now };

    /* ── 🤏 pinch = zoom ── */
    const pinchPoint = { x: 1 - (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 };
    if (gesture === "pinch") {
      this.pinchLostSince = 0;
      this.sizeSmooth = this.sizeSmooth ? this.sizeSmooth * 0.7 + size * 0.3 : size;
      if (!this.pinchActive) {
        if (!this.pinchSince) this.pinchSince = now;
        if (now - this.pinchSince > 150) {
          this.pinchActive = true;
          this.pinchSize0 = this.sizeSmooth;
          this.pinchY0 = pinchPoint.y;
          h.onPinchStart();
        }
      } else {
        // pull the hand toward you (bigger) or lift it up → zoom in; push away / lower → zoom out
        const logZoom = Math.log(this.sizeSmooth / this.pinchSize0) * 2.2 + (this.pinchY0 - pinchPoint.y) * 2.6;
        h.onPinchScale(Math.min(3, Math.max(0.33, Math.exp(logZoom))));
      }
    } else {
      this.pinchSince = 0;
      if (this.pinchActive) {
        if (!this.pinchLostSince) this.pinchLostSince = now;
        if (now - this.pinchLostSince > 200) {
          this.pinchActive = false;
          this.sizeSmooth = 0;
          h.onPinchEnd();
        }
      }
    }

    /* ── ✊ fist hold = read aloud ── */
    let fistProgress = 0;
    if (gesture === "fist") {
      if (!this.fistStart) this.fistStart = now;
      fistProgress = Math.min(1, (now - this.fistStart) / FIST_HOLD_MS);
      if (fistProgress >= 1 && !this.fistFired) {
        this.fistFired = true;
        h.onFist();
      }
    } else {
      this.fistStart = 0;
      this.fistFired = false;
    }

    /* ── ✋ open palm: slow move = rotate, fast flick = swipe ── */
    if (gesture === "palm") {
      this.history.push(palm);
      while (this.history.length && now - this.history[0].t > SWIPE_WINDOW_MS) this.history.shift();

      let swiped = false;
      if (now > this.swipeCooldownUntil && this.history.length > 3) {
        const first = this.history[0];
        const dx = palm.x - first.x;
        const dy = palm.y - first.y;
        if (Math.abs(dx) > SWIPE_MIN_DX && Math.abs(dx) > Math.abs(dy) * 2) {
          swiped = true;
          this.swipeCooldownUntil = now + SWIPE_COOLDOWN_MS;
          this.history = [];
          h.onSwipe(dx > 0 ? 1 : -1);
        }
      }

      if (!swiped && this.prev && now > this.swipeCooldownUntil) {
        const dt = Math.max(1, now - this.prev.t) / 1000;
        const dx = palm.x - this.prev.x;
        const dy = palm.y - this.prev.y;
        const speed = Math.hypot(dx, dy) / dt;
        if (speed < ROTATE_MAX_SPEED && Math.hypot(dx, dy) > 0.002) h.onRotate(dx, dy);
      }
      this.prev = palm;
    } else {
      this.prev = null;
      this.history = [];
    }

    this.onFrame({ landmarks: lm, gesture, fistProgress });
  }
}

/* ── drawing the little skeleton over the camera preview ── */

const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export function drawHand(ctx: CanvasRenderingContext2D, lm: Landmark[] | null, w: number, h: number, color = "#22E4FF") {
  ctx.clearRect(0, 0, w, h);
  if (!lm) return;
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  for (const [a, b] of CONNECTIONS) {
    ctx.moveTo(lm[a].x * w, lm[a].y * h);
    ctx.lineTo(lm[b].x * w, lm[b].y * h);
  }
  ctx.stroke();
  ctx.fillStyle = "#fff";
  for (const p of lm) {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
