const SPEECH_SAMPLE_THRESHOLD = 0.015;

export const RECENT_SPEECH_WINDOW_MS = 900;

export function audioContainsSpeech(samples: Float32Array): boolean {
  for (let index = 0; index < samples.length; index += 1) {
    if (Math.abs(samples[index]) >= SPEECH_SAMPLE_THRESHOLD) return true;
  }
  return false;
}

export function hasRecentSpeechActivity(lastSpeechAt: number, now: number): boolean {
  return lastSpeechAt > 0 && now - lastSpeechAt < RECENT_SPEECH_WINDOW_MS;
}

export function isClearToReadCompletedResult({
  voiceTurnActive,
  lastSpeechAt,
  now,
}: {
  voiceTurnActive: boolean;
  lastSpeechAt: number;
  now: number;
}): boolean {
  return !voiceTurnActive && !hasRecentSpeechActivity(lastSpeechAt, now);
}
