/**
 * audio.ts — records the microphone AND measures loudness for the 3D rings.
 *
 *  • MediaRecorder  → produces the audio file we send to /api/stt
 *  • WebAudio AnalyserNode → gives live loudness (`level`) + spectrum (`spectrum`)
 *
 * If the microphone is blocked, `simulated` becomes true: we fake a gentle voice
 * waveform so the demo still looks alive (and demo mode needs no real audio).
 */

export interface AudioSource {
  /** Loudness 0..1 */
  level(): number;
  /** `n` frequency-bar values, each 0..1 */
  spectrum(n: number): Float32Array;
}

export class Recorder implements AudioSource {
  simulated = false;
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private time = new Uint8Array(1024);
  private freq = new Uint8Array(512);
  private smooth = 0;
  private t0 = performance.now();

  async start(): Promise<void> {
    this.t0 = performance.now();
    try {
      // Noise suppression helps a lot with noisy phone-style audio.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      this.simulated = true;
      return;
    }

    const AC: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    void this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.75;
    src.connect(this.analyser);

    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
      (m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m),
    );
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.rec.start(250);
  }

  level(): number {
    if (this.simulated || !this.analyser) {
      const t = (performance.now() - this.t0) / 1000;
      const v = 0.3 + 0.22 * Math.sin(t * 7.3) * Math.sin(t * 2.1) + 0.12 * Math.sin(t * 17.0);
      this.smooth = Math.min(1, Math.max(0, v));
      return this.smooth;
    }
    this.analyser.getByteTimeDomainData(this.time);
    let sum = 0;
    for (let i = 0; i < this.time.length; i++) {
      const v = (this.time[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.time.length);
    const target = Math.min(1, rms * 4.5);
    this.smooth += (target - this.smooth) * 0.5;
    return this.smooth;
  }

  spectrum(n: number): Float32Array {
    const out = new Float32Array(n);
    if (this.simulated || !this.analyser) {
      const t = (performance.now() - this.t0) / 1000;
      for (let i = 0; i < n; i++) {
        out[i] = Math.max(0, 0.35 + 0.35 * Math.sin(t * 5 + i * 0.7) * Math.sin(t * 1.7 + i * 0.2));
      }
      return out;
    }
    this.analyser.getByteFrequencyData(this.freq);
    // Voice lives in the low bins; use the first ~40% of the spectrum.
    const usable = Math.floor(this.freq.length * 0.4);
    const per = Math.max(1, Math.floor(usable / n));
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < per; j++) s += this.freq[i * per + j];
      out[i] = s / per / 255;
    }
    return out;
  }

  /** Stops recording and returns the audio (or null when simulated). */
  stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const finish = () => {
        this.stream?.getTracks().forEach((t) => t.stop());
        void this.ctx?.close();
        this.stream = null;
        this.ctx = null;
        this.analyser = null;
        const type = this.rec?.mimeType || "audio/webm";
        resolve(this.chunks.length ? new Blob(this.chunks, { type }) : null);
      };
      if (this.rec && this.rec.state !== "inactive") {
        this.rec.onstop = finish;
        this.rec.stop();
      } else {
        finish();
      }
    });
  }
}

/**
 * SimulatedVoice — a fake "someone is talking" signal used by Play Demo.
 * It needs no microphone, but drives the same audio-reactive orb + rings.
 */
export class SimulatedVoice implements AudioSource {
  private t0 = performance.now();

  private env(t: number): number {
    const syllables = 0.45 + 0.4 * Math.sin(t * 5.1) * Math.sin(t * 1.3 + 0.5) + 0.2 * Math.sin(t * 11.7);
    const phrase = 0.6 + 0.4 * Math.sin(t * 0.9);
    return Math.min(1, Math.max(0, syllables * phrase));
  }

  level(): number {
    return this.env((performance.now() - this.t0) / 1000);
  }

  spectrum(n: number): Float32Array {
    const t = (performance.now() - this.t0) / 1000;
    const e = this.env(t);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = e * (0.35 + 0.65 * Math.abs(Math.sin(t * 3 + i * 0.45))) * (1 - (i / n) * 0.55);
      out[i] = Math.min(1, Math.max(0, v));
    }
    return out;
  }
}
