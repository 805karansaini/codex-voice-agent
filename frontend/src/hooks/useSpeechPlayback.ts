import { useCallback, useEffect, useRef, useState } from "react";

const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0YQAAAAA=";

const PREFERRED_VOICE_NAMES = [
  "Samantha",
  "Karen",
  "Moira",
  "Tessa",
  "Google UK English Female",
  "Google US English",
  "Microsoft Aria",
  "Microsoft Jenny",
  "Zira",
];

interface UseSpeechPlaybackOptions {
  setError: (message: string) => void;
}

export function useSpeechPlayback({ setError }: UseSpeechPlaybackOptions) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState("");
  const [pendingAudioUrl, setPendingAudioUrl] = useState("");
  const responseAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const loadVoices = () => {
      const browserVoices = window.speechSynthesis.getVoices();
      setVoices(browserVoices);
      setSelectedVoiceURI((current) => {
        if (current || browserVoices.length === 0) return current;
        const preferred =
          PREFERRED_VOICE_NAMES.map((n) =>
            browserVoices.find((v) => v.name.toLowerCase().includes(n.toLowerCase())),
          ).find(Boolean) ||
          browserVoices.find((v) => v.lang.toLowerCase().startsWith("en")) ||
          browserVoices[0];
        return preferred?.voiceURI || "";
      });
    };
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!text || !("speechSynthesis" in window)) return;
      let spokenText = text.trim();
      if (spokenText.length > 500) {
        const preview = spokenText.slice(0, 500);
        const sentenceEnd = Math.max(
          preview.lastIndexOf("."),
          preview.lastIndexOf("!"),
          preview.lastIndexOf("?"),
        );
        const wordEnd = preview.lastIndexOf(" ");
        const cutAt =
          sentenceEnd > 240 ? sentenceEnd + 1 : wordEnd > 240 ? wordEnd : preview.length;
        spokenText = preview.slice(0, cutAt).trim();
      }
      const utterance = new SpeechSynthesisUtterance(spokenText);
      const voice = voices.find((x) => x.voiceURI === selectedVoiceURI);
      if (voice) utterance.voice = voice;
      utterance.rate = 0.94;
      utterance.pitch = 1.05;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    },
    [selectedVoiceURI, voices],
  );

  const primeAudioPlayback = useCallback(() => {
    const audio = new Audio(SILENT_WAV);
    audio.volume = 0;
    audio.play().catch(() => undefined);
  }, []);

  const playResponseAudio = useCallback(
    async (audioUrl: string) => {
      window.speechSynthesis?.cancel();
      responseAudioRef.current?.pause();
      const audio = new Audio(audioUrl);
      responseAudioRef.current = audio;
      try {
        await audio.play();
        setPendingAudioUrl("");
      } catch {
        setPendingAudioUrl(audioUrl);
        setError("Audio is ready, but the browser blocked autoplay. Tap Play response.");
      }
    },
    [setError],
  );

  return {
    voices,
    selectedVoiceURI,
    setSelectedVoiceURI,
    pendingAudioUrl,
    speak,
    primeAudioPlayback,
    playResponseAudio,
  };
}
