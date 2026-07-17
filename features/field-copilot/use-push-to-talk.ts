"use client";

/**
 * features/field-copilot/use-push-to-talk.ts
 *
 * Push-to-talk voice input for the field copilot, built on the browser's
 * Web Speech API (webkitSpeechRecognition — Safari 14.5+ / Android Chrome).
 * Isolated + capability-detected: where the API is absent (older browsers,
 * some embedded webviews) `supported` is false and the caller simply hides
 * the mic — typing is always the primary path, never a degraded fallback.
 *
 * Keeping this a small standalone hook means a future swap to MediaRecorder +
 * server-side STT (if jobsite noise or iOS quirks make Web Speech unusable)
 * is a contained change — nothing outside this file knows how transcription
 * happens.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// Minimal structural types for the vendor-prefixed API (no DOM lib guarantee).
interface SpeechRecognitionResultLike {
  readonly 0: { readonly transcript: string };
  readonly isFinal: boolean;
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    webkitSpeechRecognition?: SpeechRecognitionCtor;
    SpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UsePushToTalk {
  /** Whether the browser supports speech recognition at all. */
  readonly supported: boolean;
  /** Whether the mic is currently listening. */
  readonly listening: boolean;
  /** A one-line, user-facing error (e.g. permission denied), or null. */
  readonly error: string | null;
  /** Begin listening. Interim + final transcripts are streamed to onTranscript. */
  readonly start: () => void;
  /** Stop listening (keeps whatever was captured). */
  readonly stop: () => void;
}

/**
 * @param onTranscript called with the running transcript (interim while speaking,
 *   final once a phrase settles). The caller sets its input value from this.
 */
export function usePushToTalk(onTranscript: (text: string) => void): UsePushToTalk {
  const [supported] = useState(() => getRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Keep the latest callback without re-creating the recognition instance.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    setError(null);

    // Recreate per session — recognition instances are single-use on some engines.
    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.continuous = false; // auto-ends on a natural pause (mobile-friendly)
    recognition.interimResults = true;

    recognition.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i]![0].transcript;
      }
      onTranscriptRef.current(text.trim());
    };
    recognition.onerror = (e) => {
      // "no-speech" / "aborted" are benign stops — don't nag the user.
      if (e.error !== "no-speech" && e.error !== "aborted") {
        setError(
          e.error === "not-allowed"
            ? "Microphone access is off — enable it in your browser settings."
            : "Voice input didn't work — try typing instead.",
        );
      }
      setListening(false);
    };
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      // start() throws if already started — treat as a no-op.
      setListening(false);
    }
  }, []);

  // Abort any in-flight recognition on unmount so no handle leaks past the modal.
  useEffect(() => {
    return () => recognitionRef.current?.abort();
  }, []);

  return { supported, listening, error, start, stop };
}
