import { useState, useRef, useEffect, useCallback } from "react";

interface UseSpeechToTextOptions {
  onTranscript: (finalText: string) => void;
  onInterim?: (partialText: string) => void;
}

const isSupported =
  typeof window !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia;

export function useSpeechToText({
  onTranscript,
}: UseSpeechToTextOptions) {
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const onTranscriptRef = useRef(onTranscript);

  onTranscriptRef.current = onTranscript;

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      mediaRecorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startListening = useCallback(async () => {
    if (!isSupported) return;

    setError(null);
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
        // Stop all tracks to release mic
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
  }, []);

  const stopListening = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    setIsListening(false);
  }, []);

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
