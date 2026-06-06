import React, { useState, useEffect, useRef } from "react";
import { Play, Pause, SpeakerHigh } from "@phosphor-icons/react";

interface AudioPlayerProps {
  audioUrl: string;
  onPlayTriggered: (url: string) => void;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ audioUrl, onPlayTriggered }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Reset player states when a new audio URL is provided
    setIsPlaying(false);
    setProgress(0);
    setCurrentTime(0);
    
    if (audioRef.current) {
      audioRef.current.pause();
    }
    
    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    const handleLoadedMetadata = () => {
      setDuration(audio.duration || 0);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration) {
        setProgress((audio.currentTime / audio.duration) * 100);
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setProgress(100);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.pause();
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [audioUrl]);

  const togglePlay = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      // Notify parent to stop other synthesizer voice tasks
      onPlayTriggered(audioUrl);
      audioRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch((err) => {
        console.error("Playback blocked:", err);
      });
    }
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) return;
    const value = parseFloat(e.target.value);
    setProgress(value);
    audioRef.current.currentTime = (value / 100) * duration;
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  return (
    <div className={`audio-player-card ${isPlaying ? "playing" : ""}`}>
      <div className="audio-player-row">
        <button className="audio-player-play-btn" onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
          {isPlaying ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
        </button>

        <div className="audio-player-info">
          <div className="audio-player-title-row">
            <span className="audio-player-title">
              <SpeakerHigh size={12} weight="bold" /> Voice Response Ready
            </span>
            <span className="audio-player-timer">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="audio-player-slider-container">
            <input
              type="range"
              min="0"
              max="100"
              value={progress}
              onChange={handleProgressChange}
              className="audio-player-slider"
            />
            <div className="audio-player-slider-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      {isPlaying && (
        <div className="audio-player-equalizer">
          <span className="eq-bar"><i /></span>
          <span className="eq-bar"><i /></span>
          <span className="eq-bar"><i /></span>
          <span className="eq-bar"><i /></span>
          <span className="eq-bar"><i /></span>
        </div>
      )}
    </div>
  );
};
export default AudioPlayer;
