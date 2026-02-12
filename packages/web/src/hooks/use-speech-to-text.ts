import { useState, useRef, useEffect, useCallback } from "react";

interface UseSpeechToTextOptions {
  provider: string | null;
  onTranscript: (finalText: string) => void;
  onInterim?: (partialText: string) => void;
}

const hasBrowserSTT =
  typeof window !== "undefined" &&
  !!(window.SpeechRecognition || window.webkitSpeechRecognition);

const hasMediaRecorder =
  typeof window !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia;

export function useSpeechToText({
  provider,
  onTranscript,
  onInterim,
}: UseSpeechToTextOptions) {
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const onInterimRef = useRef(onInterim);

  onTranscriptRef.current = onTranscript;
  onInterimRef.current = onInterim;

  const isBrowser = provider === "browser";
  const isSupported = isBrowser ? hasBrowserSTT : hasMediaRecorder;

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      recognitionRef.current?.abort();
    };
  }, []);

  const startListening = useCallback(async () => {
    if (!isSupported) return;

    setError(null);

    if (isBrowser) {
      // --- Browser SpeechRecognition path ---
      try {
        const SpeechRecognitionCtor =
          window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognitionCtor();
        recognitionRef.current = recognition;

        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "";

        recognition.onresult = (event: SpeechRecognitionEvent) => {
          let interim = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
              onTranscriptRef.current(result[0].transcript);
              onInterimRef.current?.("");
            } else {
              interim += result[0].transcript;
            }
          }
          if (interim) {
            onInterimRef.current?.(interim);
          }
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
          if (event.error === "not-allowed") {
            setError(
              "Microphone access denied. Click the lock icon in your address bar to allow it.",
            );
          } else if (event.error === "no-speech") {
            // Ignore — just silence
          } else {
            setError(`Speech recognition error: ${event.error}`);
          }
          setIsListening(false);
        };

        recognition.onend = () => {
          recognitionRef.current = null;
          setIsListening(false);
        };

        recognition.start();
        setIsListening(true);
      } catch {
        setError("Browser speech recognition is not available.");
      }
    } else {
      // --- MediaRecorder + server POST path ---
      chunksRef.current = [];

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;

        const recorder = new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunksRef.current.push(e.data);
          }
        };

        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          streamRef.current = null;

          const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
          chunksRef.current = [];

          if (blob.size === 0) {
            setIsTranscribing(false);
            return;
          }

          setIsTranscribing(true);

          try {
            const formData = new FormData();
            formData.append("audio", blob, "audio.webm");

            const res = await fetch("/api/stt/transcribe", {
              method: "POST",
              body: formData,
            });

            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              throw new Error(data.error || `Transcription failed (${res.status})`);
            }

            const data = await res.json();
            if (data.text) {
              onTranscriptRef.current(data.text);
            }
          } catch (err) {
            setError(
              err instanceof Error ? err.message : "Transcription failed",
            );
          } finally {
            setIsTranscribing(false);
          }
        };

        recorder.start();
        setIsListening(true);
      } catch (err) {
        if (err instanceof DOMException && err.name === "NotAllowedError") {
          setError(
            "Microphone access denied. Click the lock icon in your address bar to allow it.",
          );
        } else if (err instanceof DOMException && err.name === "NotFoundError") {
          setError("No microphone found.");
        } else {
          setError("Could not access microphone.");
        }
      }
    }
  }, [isBrowser, isSupported]);

  const stopListening = useCallback(() => {
    if (isBrowser) {
      const recognition = recognitionRef.current;
      if (recognition) {
        recognition.stop();
      }
    } else {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
    }
    setIsListening(false);
  }, [isBrowser]);

  return {
    isListening,
    isTranscribing,
    isSupported,
    error,
    setError,
    startListening,
    stopListening,
  };
}
