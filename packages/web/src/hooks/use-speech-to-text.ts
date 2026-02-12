import { useState, useRef, useEffect, useCallback } from "react";

interface UseSpeechToTextOptions {
  onTranscript: (finalText: string) => void;
  onInterim?: (partialText: string) => void;
}

const isSupported =
  typeof window !== "undefined" &&
  ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

function errorMessage(error: string): string {
  switch (error) {
    case "not-allowed":
      return "Microphone access denied. Check browser permissions.";
    case "no-speech":
      return "No speech detected. Try again.";
    case "network":
      return "Network error during speech recognition.";
    case "audio-capture":
      return "No microphone found.";
    case "aborted":
      return "";
    default:
      return "Speech recognition error. Try again.";
  }
}

export function useSpeechToText({
  onTranscript,
  onInterim,
}: UseSpeechToTextOptions) {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const onInterimRef = useRef(onInterim);

  onTranscriptRef.current = onTranscript;
  onInterimRef.current = onInterim;

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  const startListening = useCallback(() => {
    if (!isSupported) return;

    setError(null);

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (final) {
        onTranscriptRef.current(final);
      }
      if (interim) {
        onInterimRef.current?.(interim);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const msg = errorMessage(event.error);
      if (msg) setError(msg);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  }, []);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  return { isListening, isSupported, error, setError, startListening, stopListening };
}
