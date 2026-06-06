import React from "react";
import { SpeakerHigh } from "@phosphor-icons/react";
import AudioPlayer from "../common/AudioPlayer";

interface VoiceTabProps {
  voices: SpeechSynthesisVoice[];
  selectedVoiceURI: string;
  onSelectVoice: (uri: string) => void;
  pendingAudioUrl: string;
  playResponseAudio: (url: string) => void;
}

export const VoiceTab: React.FC<VoiceTabProps> = ({
  voices,
  selectedVoiceURI,
  onSelectVoice,
  pendingAudioUrl,
  playResponseAudio,
}) => {
  return (
    <div className="tabContentScroll voiceTab">
      <div className="contentSectionHeader">
        <h4>Voice Output Settings</h4>
        <p>Configure text-to-speech fallback and audio controls</p>
      </div>
      
      <div className="voiceSettingsCard">
        <label className="settingsLabel">
          <SpeakerHigh size={14} /> Fallback Voice Synthesis
        </label>
        <select
          className="select"
          value={selectedVoiceURI}
          onChange={(e) => onSelectVoice(e.target.value)}
          disabled={voices.length === 0}
        >
          {voices.length === 0 && <option value="">Browser default</option>}
          {voices.map((v) => (
            <option value={v.voiceURI} key={v.voiceURI}>
              {v.name} ({v.lang})
            </option>
          ))}
        </select>
        <p className="settingsHint">
          When Gemini doesn't output live audio stream, the browser will use this text-to-speech engine.
        </p>
      </div>

      {pendingAudioUrl && (
        <div className="audioBlockedContainer">
          <p className="audioBlockedHint">Autoplay was blocked by your browser. Play the audio reply below:</p>
          <AudioPlayer audioUrl={pendingAudioUrl} onPlayTriggered={playResponseAudio} />
        </div>
      )}
    </div>
  );
};
export default VoiceTab;
