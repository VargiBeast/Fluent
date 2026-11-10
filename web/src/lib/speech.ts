import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice dictation with the browser's Web Speech API. FLUENT never records, uploads or stores audio: recognition
 * happens in the browser (which may use its own speech service), and only the resulting text is used.
 */
interface SpeechAlternative { transcript: string }
interface SpeechResult { isFinal: boolean; length: number; [i: number]: SpeechAlternative }
interface SpeechResultEvent { resultIndex: number; results: { length: number; [i: number]: SpeechResult } }
interface SpeechErrorEvent { error: string }
export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = (new () => Recognition) & {
  /** Chrome's on-device check; absent elsewhere. */
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string>;
};

export function getRecognitionCtor(w: unknown = typeof window === "undefined" ? undefined : window): RecognitionCtor | null {
  const g = w as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor } | undefined;
  return g?.SpeechRecognition ?? g?.webkitSpeechRecognition ?? null;
}

export function speechErrorMessage(code: string): string | null {
  switch (code) {
    case "aborted": return null;
    case "no-speech": return "Didn't catch that. Tap the mic and try again.";
    case "not-allowed":
    case "service-not-allowed": return "Microphone access is blocked. Allow it for this site in your browser settings.";
    case "audio-capture": return "No microphone was found.";
    case "network": return "Voice dictation in this browser needs an internet connection.";
    case "language-not-supported": return "Voice dictation doesn't support this language in your browser.";
    default: return "Voice dictation stopped unexpectedly.";
  }
}

/** Join dictated chunks with sensible spacing. */
export function joinTranscript(existing: string, chunk: string): string {
  const c = chunk.trim();
  if (!c) return existing;
  if (!existing.trim()) return c;
  return /\s$/.test(existing) ? existing + c : `${existing} ${c}`;
}

export function useDictation(opts: { onFinal: (text: string) => void; lang?: string; continuous?: boolean }) {
  const Ctor = getRecognitionCtor();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const onFinal = useRef(opts.onFinal);
  onFinal.current = opts.onFinal;

  const stop = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    try {
      r.stop();
    } catch {
      // Not started yet (still checking on-device support): just reset.
      rec.current = null;
      setListening(false);
    }
  }, []);

  const start = useCallback(() => {
    if (!Ctor || rec.current) return;
    setError(null);
    setInterim("");
    const r = new Ctor();
    const lang = opts.lang ?? (typeof navigator !== "undefined" ? navigator.language : "en-US");
    r.lang = lang;
    r.continuous = opts.continuous ?? false;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        const text = res[0]?.transcript ?? "";
        if (res.isFinal) onFinal.current(text.trim());
        else live += text;
      }
      setInterim(live.trim());
    };
    r.onerror = (e) => {
      const msg = speechErrorMessage(e.error);
      if (msg) setError(msg);
      // processLocally can be refused for a language: the next tap falls back to the browser default.
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
      setInterim("");
    };
    rec.current = r;
    setListening(true);
    const begin = () => {
      if (rec.current !== r) return; // stopped before it started
      try {
        r.start();
      } catch {
        rec.current = null;
        setListening(false);
        setError("Couldn't start voice dictation.");
      }
    };
    // Prefer on-device recognition when the browser has the language model installed; otherwise the browser default.
    if (typeof Ctor.available === "function" && "processLocally" in r) {
      Ctor.available({ langs: [lang], processLocally: true })
        .then((a) => { if (a === "available") r.processLocally = true; })
        .catch(() => undefined)
        .finally(begin);
    } else begin();
  }, [Ctor, opts.lang, opts.continuous]);

  useEffect(() => () => rec.current?.abort(), []);

  return { supported: Boolean(Ctor), listening, interim, error, start, stop, toggle: listening ? stop : start, clearError: () => setError(null) };
}
