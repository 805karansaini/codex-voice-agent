export const LIVE_AUDIO_RATE = 16000;
export const MAX_BUFFERED_AUDIO_CHUNKS = 360;

export function encodePcmChunk(input: Float32Array, sourceRate: number): string {
  const ratio = sourceRate / LIVE_AUDIO_RATE;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const pcm = new Int16Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let total = 0;
    let samples = 0;
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      total += input[sampleIndex];
      samples += 1;
    }
    const sample = Math.max(-1, Math.min(1, samples ? total / samples : input[start] || 0));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

export function base64ToFloat32Array(base64: string): Float32Array {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const int16Array = new Int16Array(bytes.buffer);
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768;
  }
  return float32Array;
}

export class AudioStreamPlayer {
  private ctx: AudioContext | null = null;
  private nextPlayTime: number = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private sampleRate: number = 24000;

  isPlaying(): boolean {
    return this.activeSources.length > 0;
  }

  init() {
    if (!this.ctx) {
      const audioWindow = window as Window &
        typeof globalThis & {
          webkitAudioContext?: typeof AudioContext;
        };
      const AudioCtx = audioWindow.AudioContext || audioWindow.webkitAudioContext;
      if (!AudioCtx) return;
      try {
        this.ctx = new AudioCtx({ sampleRate: 24000 });
      } catch {
        this.ctx = new AudioCtx();
      }
      this.nextPlayTime = 0;
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  playChunk(float32Data: Float32Array) {
    this.init();
    if (!this.ctx) return;

    const audioBuffer = this.ctx.createBuffer(1, float32Data.length, this.sampleRate);
    audioBuffer.getChannelData(0).set(float32Data);

    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.ctx.destination);

    const currentTime = this.ctx.currentTime;
    if (this.nextPlayTime < currentTime) {
      this.nextPlayTime = currentTime + 0.03;
    }

    source.start(this.nextPlayTime);
    this.activeSources.push(source);

    source.onended = () => {
      this.activeSources = this.activeSources.filter((s) => s !== source);
    };

    this.nextPlayTime += audioBuffer.duration;
  }

  stop() {
    this.activeSources.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Some browsers throw if a source already stopped.
      }
    });
    this.activeSources = [];
    this.nextPlayTime = 0;
  }
}
