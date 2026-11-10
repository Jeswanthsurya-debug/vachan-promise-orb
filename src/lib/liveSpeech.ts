/**
 * liveSpeech.ts — live "words appearing as you speak" preview, using the browser's
 * Web Speech API (SpeechRecognition). This is ONLY a preview:
 *   • in Live mode it is replaced by the final Prisma transcript,
 *   • it never replaces the real recording that goes to /api/stt,
 *   • browsers without SpeechRecognition (e.g. Firefox) simply show no preview.
 */

interface RecAlternative {
  transcript: string;
}
interface RecResult {
  isFinal: boolean;
  0: RecAlternative;
}
interface RecEvent {
  results: ArrayLike<RecResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function previewSupported(): boolean {
  return getCtor() !== null;
}

export class LivePreview {
  private rec: Recognition | null = null;
  private active = false;
  private committed = ""; // text from earlier recognition rounds (the browser restarts it now and then)
  private current = ""; // text of the current round
  private fatal = false;

  constructor(
    private locale: string,
    private onText: (text: string) => void,
  ) {}

  private get text(): string {
    return `${this.committed} ${this.current}`.replace(/\s+/g, " ").trim();
  }

  start() {
    const Ctor = getCtor();
    if (!Ctor) return;
    this.active = true;
    this.spawn(Ctor);
  }

  private spawn(Ctor: RecognitionCtor) {
    const rec = new Ctor();
    rec.lang = this.locale;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let s = "";
      for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript + " ";
      this.current = s.trim();
      this.onText(this.text);
    };
    rec.onerror = (e) => {
      // "not-allowed" / "service-not-allowed" → give up quietly (the real recording still works)
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "language-not-supported") this.fatal = true;
    };
    rec.onend = () => {
      // Chrome ends the session after a pause: bank the text and start again while still recording.
      this.committed = this.text;
      this.current = "";
      if (this.active && !this.fatal) {
        try {
          this.spawn(Ctor);
        } catch {
          /* ignore */
        }
      }
    };
    this.rec = rec;
    try {
      rec.start();
    } catch {
      this.fatal = true;
    }
  }

  /** Stops listening and returns everything heard. */
  stop(): string {
    this.active = false;
    const text = this.text;
    try {
      this.rec?.stop();
    } catch {
      /* ignore */
    }
    this.rec = null;
    return text;
  }
}
