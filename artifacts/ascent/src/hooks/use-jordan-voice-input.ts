import { useCallback, useRef, useState } from "react";

/**
 * Thin wrapper around the browser's native SpeechRecognition API. This is
 * deliberately an additive layer on top of the text chat pipeline, not a
 * parallel voice architecture — a transcribed phrase is handed back as
 * plain text for the caller to feed through the same chat flow used for
 * typed messages. Per .agents/memory/jordan-interactive-coach.md: sequence
 * voice after the core grounded conversation works, and don't let it
 * change the underlying grounding/tool-calling behavior.
 *
 * Browser support varies (reliable in Chrome/Edge, absent in Firefox and
 * most non-Safari mobile browsers) — `isSupported` reflects that plainly
 * rather than pretending the capability exists everywhere.
 */

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useJordanVoiceInput(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const Ctor = getSpeechRecognitionCtor();
  const isSupported = Ctor !== null;

  const start = useCallback(() => {
    if (!Ctor || listening) return;
    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) onTranscript(transcript);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, [Ctor, listening, onTranscript]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  return { isSupported, listening, start, stop };
}
