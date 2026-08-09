import type { CodingHarnessInfo, DoctorCheck } from "../../types";
import { cn } from "../../utils";
import type { VoiceInputMode } from "../../hooks/useVoiceInputMode";

const VOICE_INPUT_MODES: { id: VoiceInputMode; label: string }[] = [
  { id: "open", label: "Open mic" },
  { id: "push", label: "Push to talk" },
];

type ConsoleVoicePanelProps = {
  isMobile: boolean;
  codingHarnesses: CodingHarnessInfo[];
  doctorChecks: DoctorCheck[];
  voices: SpeechSynthesisVoice[];
  selectedVoiceURI: string;
  voiceInputMode: VoiceInputMode;
  pendingAudioUrl: string;
  onRefreshDoctor: () => void;
  onSelectedVoiceChange: (voiceURI: string) => void;
  onVoiceInputModeChange: (mode: VoiceInputMode) => void;
  onPlayResponseAudio: (audioUrl: string) => void;
};

export default function ConsoleVoicePanel({
  isMobile,
  codingHarnesses,
  doctorChecks,
  voices,
  selectedVoiceURI,
  voiceInputMode,
  pendingAudioUrl,
  onRefreshDoctor,
  onSelectedVoiceChange,
  onVoiceInputModeChange,
  onPlayResponseAudio,
}: ConsoleVoicePanelProps) {
  return (
    <div
      id="console-panel-voice"
      role="tabpanel"
      aria-labelledby="console-tab-voice"
      className="space-y-4 text-xs"
    >
      <div className="panel border border-line bg-surface-2 p-3">
        <div className="mb-2">
          <span className="label font-semibold">Coding agents</span>
          <p className="mt-1 text-[11.5px] leading-relaxed text-fg-muted">
            Vodex uses the login configured for each local coding agent. Provider usage policies and
            subscription limits still apply.
          </p>
        </div>
        <div className="space-y-2">
          {codingHarnesses.map((agent) => {
            const ready = agent.available && agent.authenticated;
            return (
              <div
                key={agent.id}
                className="rounded-md border border-line-soft bg-surface-1 px-2.5 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", ready ? "bg-success" : "bg-warn")} />
                  <span className="font-semibold text-fg">{agent.displayName}</span>
                  <span className="ml-auto text-[10.5px] font-medium text-fg-muted">
                    {ready ? "Connected" : agent.available ? "Sign in needed" : "Unavailable"}
                  </span>
                </div>
                {agent.subscriptionType && (
                  <p className="mt-1 text-[11.5px] text-fg-muted">
                    Account: {agent.subscriptionType}
                  </p>
                )}
                {agent.usagePolicy && (
                  <p className="mt-1 text-[11.5px] leading-relaxed text-fg-muted">
                    {agent.usagePolicy}
                  </p>
                )}
                {agent.error && <p className="mt-1 text-[11.5px] text-warn">{agent.error}</p>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel p-3 bg-surface-2 border border-line">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="label font-semibold">Setup doctor</span>
          <button
            type="button"
            onClick={onRefreshDoctor}
            className={cn(
              "rounded border border-line bg-surface-3 px-2 font-mono text-[10.5px] uppercase text-fg-dim hover:text-fg",
              isMobile ? "min-h-11" : "py-1",
            )}
          >
            Refresh
          </button>
        </div>
        <div className="space-y-2">
          {doctorChecks.length === 0 ? (
            <p className="text-[11.5px] text-fg-dim">No setup report available.</p>
          ) : (
            doctorChecks.map((check) => (
              <div
                key={check.name}
                className="rounded border border-line-soft bg-surface-1 px-2.5 py-2"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn("h-2 w-2 rounded-full", check.ok ? "bg-success" : "bg-danger")}
                  />
                  <span className="font-semibold text-fg">{check.name}</span>
                  <span className="ml-auto text-[10px] font-mono uppercase text-fg-dim">
                    {check.ok ? "ready" : "needs setup"}
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] text-fg-muted">{check.message}</p>
                {!check.ok && check.fix && (
                  <p className="mt-1 text-[11px] text-accent">{check.fix}</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="panel p-3 bg-surface-2 border border-line">
        <label className="label mb-2 block font-semibold">Microphone mode</label>
        <div className="grid grid-cols-2 gap-1 rounded-md border border-line bg-surface-1 p-1">
          {VOICE_INPUT_MODES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onVoiceInputModeChange(option.id)}
              aria-pressed={voiceInputMode === option.id}
              className={cn(
                "rounded px-2 py-1.5 text-[11.5px] font-semibold transition-colors",
                isMobile && "min-h-11",
                voiceInputMode === option.id
                  ? "bg-surface-3 text-fg shadow-sm"
                  : "text-fg-dim hover:text-fg",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel p-3 bg-surface-2 border border-line">
        <label htmlFor="fallback-tts-voice" className="label mb-2 block font-semibold">
          Fallback TTS Voice
        </label>
        <select
          id="fallback-tts-voice"
          className={cn(
            "w-full rounded-md border border-line bg-surface-3 px-2 py-1.5 text-[12.5px] text-fg focus:border-accent focus:outline-none",
            isMobile && "min-h-11",
          )}
          value={selectedVoiceURI}
          onChange={(e) => onSelectedVoiceChange(e.target.value)}
          disabled={voices.length === 0}
        >
          {voices.length === 0 && <option value="">Browser default</option>}
          {voices.map((voice) => (
            <option value={voice.voiceURI} key={voice.voiceURI}>
              {voice.name} ({voice.lang})
            </option>
          ))}
        </select>
        <p className="mt-2 text-[10.5px] text-fg-dim leading-relaxed">
          Used if Gemini Gateway doesn't return direct audio chunks, synthesized on this browser.
        </p>
      </div>

      {pendingAudioUrl && (
        <div className="panel p-3 bg-danger/5 border border-danger/20 rounded-md">
          <p className="text-danger font-semibold text-[11px] mb-2">
            Browser autoplay was blocked.
          </p>
          <button
            type="button"
            onClick={() => onPlayResponseAudio(pendingAudioUrl)}
            className={cn(
              "w-full rounded bg-danger px-3 py-1 text-[11.5px] font-semibold text-white hover:brightness-110",
              isMobile && "min-h-11",
            )}
          >
            Play Response Audio
          </button>
        </div>
      )}
    </div>
  );
}
