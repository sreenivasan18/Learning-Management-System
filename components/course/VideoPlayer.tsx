// FILE PATH: components/course/VideoPlayer.tsx
//
// SECURE VIDEO PLAYER WITH ANTI-SKIP ENFORCEMENT
//
// FIXES IN THIS VERSION:
// 1. Added video error state — when the <video> element fires onerror (e.g. stream
//    returns 404 because the file is missing on disk), a clear error message is shown
//    instead of a broken black rectangle.
// 2. External URL detection — if videoUrl is not a /api/video/... stream URL (e.g. a
//    seeded YouTube link that reached this component), a fallback message is shown
//    instead of attempting to play an unplayable URL in an HTML <video> element.
// 3. Audio bug: video starts explicitly unmuted with volume=1.
// 4. video.play() wrapped in try/catch to suppress autoplay rejections.
// 5. handleSeeked is the sole seek restrictor; handleTimeUpdate only advances
//    lastAllowedTimeRef — no double-snap jitter on mobile.
// 6. onEnded sends video.duration as currentTime to ensure completion is recorded
//    even when currentTime resets to 0 after 'ended' on some browsers.
// 7. isMuted state reads from video.muted directly (avoids stale closure).

"use client";
import { useRef, useEffect, useCallback, useState } from "react";
import {
  CheckCircle, Play, Pause, Volume2, VolumeX, Maximize, AlertCircle,
} from "lucide-react";

interface VideoPlayerProps {
  moduleId: string;
  videoUrl: string;
  initialWatchedSecs: number;
  totalSecs: number;
  onCompleted?: () => void;
}

const HEARTBEAT_INTERVAL_SECS = 5;
// Allow seek of up to MAX_SEEK_JUMP_SECS ahead of the furthest-watched position.
const MAX_SEEK_JUMP_SECS = 3;

// Detect if a videoUrl is a secure internal stream URL or an external/unsupported URL.
function isInternalStreamUrl(url: string): boolean {
  if (!url) return false;
  // Internal stream URLs always start with /api/video/
  return url.startsWith("/api/video/");
}

export default function VideoPlayer({
  moduleId,
  videoUrl,
  initialWatchedSecs,
  totalSecs: initialTotalSecs,
  onCompleted,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // lastAllowedTimeRef tracks the furthest legitimate position the student has watched.
  const lastAllowedTimeRef = useRef<number>(initialWatchedSecs);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedRef = useRef<boolean>(false);
  const [completed, setCompleted] = useState(false);
  const [percentWatched, setPercentWatched] = useState(
    initialTotalSecs > 0
      ? Math.round((initialWatchedSecs / initialTotalSecs) * 100)
      : 0
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  // FIX: Track video load errors explicitly
  const [videoError, setVideoError] = useState<string | null>(null);

  // FIX: Detect external/unsupported URLs before rendering the video element
  const isStreamUrl = isInternalStreamUrl(videoUrl);

  // ── Ensure audio plays correctly on mount ──────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    video.volume = 1;
    setIsMuted(false);
  }, []);

  // ── Send heartbeat ─────────────────────────────────────────────────────────
  const sendHeartbeat = useCallback(async (overrideCurrentTime?: number) => {
    const video = videoRef.current;
    if (!video) return;

    const currentTime = overrideCurrentTime ?? video.currentTime;
    const totalDuration = video.duration || initialTotalSecs;
    if (!totalDuration || totalDuration <= 0) return;

    try {
      const res = await fetch(`/api/video/${moduleId}/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentTime, totalDuration }),
        keepalive: true,
      });
      const data = await res.json();
      if (data.completed && !completedRef.current) {
        completedRef.current = true;
        setCompleted(true);
        setPercentWatched(100);
        onCompleted?.();
      } else if (data.percentWatched !== undefined) {
        setPercentWatched(data.percentWatched);
      }
      // Snap back if backend rejected a fast-forward attempt (>5s difference).
      if (typeof data.watchedSecs === "number" && data.watchedSecs < currentTime - 5) {
        video.currentTime = data.watchedSecs;
        lastAllowedTimeRef.current = data.watchedSecs;
      }
    } catch {
      // Network error — retry on next interval
    }
  }, [moduleId, onCompleted, initialTotalSecs]);

  // ── Seek restriction ───────────────────────────────────────────────────────
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const current = video.currentTime;
    const lastAllowed = lastAllowedTimeRef.current;
    if (current > lastAllowed) {
      lastAllowedTimeRef.current = current;
    }
  }, []);

  const handleSeeked = useCallback(() => {
    const video = videoRef.current;
    if (!video || completedRef.current) return;
    const current = video.currentTime;
    const lastAllowed = lastAllowedTimeRef.current;
    if (current > lastAllowed + MAX_SEEK_JUMP_SECS + 0.5) {
      video.currentTime = lastAllowed;
    }
  }, []);

  // ── Start/stop heartbeat with play/pause/ended ─────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => {
      setIsPlaying(true);
      if (!heartbeatTimerRef.current) {
        heartbeatTimerRef.current = setInterval(
          () => sendHeartbeat(),
          HEARTBEAT_INTERVAL_SECS * 1000
        );
      }
    };

    const onPause = () => {
      setIsPlaying(false);
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
      sendHeartbeat();
    };

    const onEnded = () => {
      setIsPlaying(false);
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
      const finalTime = video.duration || initialTotalSecs;
      sendHeartbeat(finalTime);
    };

    // FIX: Detect video load/playback errors and surface them to the user
    const onError = () => {
      // Map common MediaError codes to actionable messages
      const code = video.error?.code;
      if (code === MediaError.MEDIA_ERR_NETWORK) {
        setVideoError("Network error: could not load the video. Please check your connection and try refreshing.");
      } else if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        setVideoError("Video format not supported by your browser. Please try a different browser.");
      } else if (code === MediaError.MEDIA_ERR_DECODE) {
        setVideoError("Video file appears to be corrupted. Please contact support.");
      } else {
        // This typically means the stream endpoint returned 404 (file missing on disk)
        // or 403 (access denied). The <video> element surfaces these as MEDIA_ERR_NETWORK.
        setVideoError(
          "This video is temporarily unavailable. The file may not have been fully processed. " +
          "Please try again later or contact your instructor."
        );
      }
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("seeked", handleSeeked);
    video.addEventListener("error", onError);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("error", onError);
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
      }
    };
  }, [sendHeartbeat, handleTimeUpdate, handleSeeked, initialTotalSecs]);

  // ── Resume from last watched position ─────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video || initialWatchedSecs <= 0) return;
    const onLoadedMetadata = () => {
      if (video.duration > 0) {
        const resumeAt = Math.min(initialWatchedSecs, video.duration * 0.99);
        video.currentTime = resumeAt;
        lastAllowedTimeRef.current = resumeAt;
      }
    };
    if (video.readyState >= 1) {
      if (video.duration > 0) {
        const resumeAt = Math.min(initialWatchedSecs, video.duration * 0.99);
        video.currentTime = resumeAt;
        lastAllowedTimeRef.current = resumeAt;
      }
    } else {
      video.addEventListener("loadedmetadata", onLoadedMetadata);
      return () => video.removeEventListener("loadedmetadata", onLoadedMetadata);
    }
  }, [initialWatchedSecs]);

  // ── Final heartbeat on page unload via sendBeacon ─────────────────────────
  useEffect(() => {
    const handleUnload = () => {
      const video = videoRef.current;
      if (!video) return;
      const payload = JSON.stringify({
        currentTime: video.currentTime,
        totalDuration: video.duration || initialTotalSecs,
      });
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon(`/api/video/${moduleId}/heartbeat`, blob);
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [moduleId, initialTotalSecs]);

  // ── Controls ───────────────────────────────────────────────────────────────

  const togglePlay = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      try {
        await video.play();
      } catch {
        // Autoplay blocked by browser policy
      }
    } else {
      video.pause();
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    if (!video.muted) {
      if (video.volume === 0) video.volume = 1;
    }
    setIsMuted(video.muted);
  };

  const toggleFullscreen = () => {
    const video = videoRef.current;
    if (!video) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      video.requestFullscreen().catch(() => {/* fullscreen not supported */});
    }
  };

  // ── FIX: Render error state for unsupported/external URLs ─────────────────
  if (!isStreamUrl) {
    return (
      <div className="relative rounded-2xl overflow-hidden bg-black aspect-video flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <AlertCircle className="w-10 h-10 text-amber-400" />
          <p className="text-amber-300 font-semibold text-sm">Video Not Available</p>
          <p className="text-text-muted text-xs max-w-xs">
            This module&apos;s video link is not a streamable file. 
            The instructor needs to upload an MP4 video file to replace the existing link.
          </p>
        </div>
      </div>
    );
  }

  // ── FIX: Render persistent error state when video element fires onerror ────
  if (videoError) {
    return (
      <div className="relative rounded-2xl overflow-hidden bg-black aspect-video flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <AlertCircle className="w-10 h-10 text-red-400" />
          <p className="text-red-300 font-semibold text-sm">Video Unavailable</p>
          <p className="text-text-muted text-xs max-w-xs leading-relaxed">{videoError}</p>
          <button
            onClick={() => {
              setVideoError(null);
              const v = videoRef.current;
              if (v) { v.load(); }
            }}
            className="mt-2 px-4 py-1.5 rounded-xl bg-white/10 border border-white/20 text-white text-xs hover:bg-white/20 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative rounded-2xl overflow-hidden bg-black group">
      {/* AUDIO NOTE: no 'muted' attribute — audio plays by default. */}
      <video
        ref={videoRef}
        src={videoUrl}
        className="w-full aspect-video"
        controlsList="nodownload noremoteplayback"
        disablePictureInPicture
        playsInline
        preload="metadata"
      />

      {/* Custom controls overlay */}
      <div className="absolute inset-0 flex flex-col justify-end opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-gradient-to-t from-black/80 via-transparent to-transparent">
        {/* Progress bar */}
        <div className="px-4 pb-1">
          <div className="h-1 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-cyan-400 rounded-full transition-all duration-300"
              style={{ width: `${percentWatched}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-white/60 text-xs">{percentWatched}% watched</span>
            {completed && (
              <span className="flex items-center gap-1 text-emerald-400 text-xs font-medium">
                <CheckCircle className="w-3.5 h-3.5" /> Completed
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 px-4 pb-3 pt-1">
          <button
            onClick={togglePlay}
            className="text-white hover:text-cyan-400 transition-colors"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
          </button>
          <button
            onClick={toggleMute}
            className="text-white hover:text-cyan-400 transition-colors"
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
          <div className="flex-1" />
          {!completed && (
            <span className="text-white/50 text-xs">Watch to unlock quiz</span>
          )}
          <button
            onClick={toggleFullscreen}
            className="text-white hover:text-cyan-400 transition-colors"
            aria-label="Fullscreen"
          >
            <Maximize className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Completion badge */}
      {completed && (
        <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-emerald-500/90 text-white text-xs font-bold px-2.5 py-1 rounded-full">
          <CheckCircle className="w-3.5 h-3.5" />
          Video Complete
        </div>
      )}
    </div>
  );
}