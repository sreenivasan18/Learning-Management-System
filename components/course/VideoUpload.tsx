// FILE PATH: components/course/VideoUpload.tsx
//
// VIDEO UPLOAD COMPONENT — only rendered for ADMIN/INSTRUCTOR.
// Validates MP4 before sending to the backend.
// The backend performs a second, authoritative validation.

"use client";
import { useState, useRef } from "react";
import { Upload, CheckCircle, AlertCircle, Film, X } from "lucide-react";

interface VideoUploadProps {
  moduleId: string;
  currentVideoUrl?: string | null;
  onUploaded?: (videoUrl: string) => void;
}

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB

export default function VideoUpload({
  moduleId,
  currentVideoUrl,
  onUploaded,
}: VideoUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFile = (f: File): string | null => {
    // Extension check
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (ext !== "mp4") {
      return "Only .mp4 files are accepted.";
    }
    // MIME type check
    if (f.type !== "video/mp4" && f.type !== "video/x-m4v" && f.type !== "") {
      // Empty type can happen on some OS/browsers for mp4 — allow it and let backend decide
      if (f.type !== "") {
        return `Invalid file type "${f.type}". Only video/mp4 is accepted.`;
      }
    }
    // Size check
    if (f.size > MAX_FILE_SIZE) {
      return "File too large. Maximum size is 500 MB.";
    }
    if (f.size === 0) {
      return "File is empty.";
    }
    return null;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError("");
    setSuccess(false);
    const validationError = validateFile(f);
    if (validationError) {
      setError(validationError);
      setFile(null);
      return;
    }
    setFile(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError("");
    setProgress(0);

    const formData = new FormData();
    formData.append("video", file);

    try {
      // Use XMLHttpRequest for upload progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          }
        });
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            try {
              const data = JSON.parse(xhr.responseText);
              reject(new Error(data.error || "Upload failed."));
            } catch {
              reject(new Error("Upload failed."));
            }
          }
        });
        xhr.addEventListener("error", () => reject(new Error("Network error during upload.")));
        xhr.open("POST", `/api/video/${moduleId}/upload`);
        xhr.send(formData);
      });

      setSuccess(true);
      setFile(null);
      setProgress(100);
      if (inputRef.current) inputRef.current.value = "";
      onUploaded?.(`/api/video/${moduleId}/stream`);
    } catch (err: any) {
      setError(err.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const clearFile = () => {
    setFile(null);
    setError("");
    setSuccess(false);
    setProgress(0);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-3">
      {/* Current video indicator */}
      {currentVideoUrl && !success && (
        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">
          <Film className="w-4 h-4 flex-shrink-0" />
          <span className="truncate">Video uploaded — click below to replace</span>
        </div>
      )}

      {/* Drop zone */}
      <label
        className={`flex flex-col items-center justify-center gap-3 p-6 rounded-2xl border-2 border-dashed cursor-pointer transition-all
          ${file ? "border-cyan-500/60 bg-cyan-500/5" : "border-border hover:border-cyan-500/40 bg-white/2 hover:bg-white/3"}
          ${uploading ? "pointer-events-none opacity-70" : ""}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".mp4,video/mp4"
          className="hidden"
          onChange={handleFileChange}
          disabled={uploading}
        />
        <Upload className={`w-8 h-8 ${file ? "text-cyan-400" : "text-text-muted"}`} />
        {file ? (
          <div className="text-center">
            <p className="text-white text-sm font-medium truncate max-w-xs">{file.name}</p>
            <p className="text-text-muted text-xs mt-0.5">
              {(file.size / (1024 * 1024)).toFixed(1)} MB
            </p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-text-secondary text-sm">Click to select MP4 video</p>
            <p className="text-text-muted text-xs mt-0.5">Only .mp4 · max 500 MB</p>
          </div>
        )}
      </label>

      {/* Error message */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Success message */}
      {success && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">
          <CheckCircle className="w-4 h-4" />
          Video uploaded successfully!
        </div>
      )}

      {/* Upload progress */}
      {uploading && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-text-muted">
            <span>Uploading…</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-violet-600 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Action buttons */}
      {file && !uploading && (
        <div className="flex gap-2">
          <button
            onClick={handleUpload}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white text-sm font-bold hover:opacity-90 transition-all"
          >
            Upload Video
          </button>
          <button
            onClick={clearFile}
            className="px-3 rounded-xl border border-border text-text-muted hover:text-white hover:border-white/30 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}