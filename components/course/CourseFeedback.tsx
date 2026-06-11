// FILE PATH: components/course/CourseFeedback.tsx
// Complete feedback/review UI for enrolled students.

"use client";
import { useState, useEffect, useCallback } from "react";
import { Star, Edit2, Trash2, CheckCircle, AlertCircle, MessageSquare } from "lucide-react";

interface FeedbackItem {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  user: { id: string; name: string | null; image: string | null };
}

interface Props {
  courseId: string;
  currentUserId: string | null;
  isEnrolled: boolean;
}

function StarRating({
  value,
  onChange,
  readonly = false,
  size = "md",
}: {
  value: number;
  onChange?: (v: number) => void;
  readonly?: boolean;
  size?: "sm" | "md";
}) {
  const [hovered, setHovered] = useState(0);
  const sz = size === "sm" ? "w-4 h-4" : "w-6 h-6";
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(i)}
          onMouseEnter={() => !readonly && setHovered(i)}
          onMouseLeave={() => setHovered(0)}
          className={`transition-colors ${readonly ? "cursor-default" : "cursor-pointer hover:scale-110"}`}
        >
          <Star
            className={`${sz} ${
              i <= (hovered || value)
                ? "fill-amber-400 text-amber-400"
                : "text-white/20"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function CourseFeedback({ courseId, currentUserId, isEnrolled }: Props) {
  const [feedbackList, setFeedbackList] = useState<FeedbackItem[]>([]);
  const [averageRating, setAverageRating] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Form state
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  const myFeedback = feedbackList.find((f) => f.user.id === currentUserId);

  const fetchFeedback = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/feedback?courseId=${courseId}`);
      const data = await res.json();
      if (res.ok) {
        setFeedbackList(data.feedback);
        // API returns "avgRating", not "averageRating"
        setAverageRating(typeof data.avgRating === "number" ? data.avgRating : null);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    fetchFeedback();
  }, [fetchFeedback]);

  useEffect(() => {
    if (myFeedback) {
      setRating(myFeedback.rating);
      setComment(myFeedback.comment ?? "");
    }
  }, [myFeedback]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0) { setError("Please select a rating."); return; }
    setSubmitting(true);
    setError("");
    setSuccessMsg("");

    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, rating, comment }),
    });
    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(data.error || "Failed to submit feedback.");
      return;
    }
    setSuccessMsg(myFeedback ? "Review updated!" : "Review submitted!");
    setIsEditing(false);
    fetchFeedback();
  };

  const handleDelete = async () => {
    if (!confirm("Delete your review?")) return;
    const res = await fetch(`/api/feedback?courseId=${courseId}`, { method: "DELETE" });
    if (res.ok) {
      setRating(0);
      setComment("");
      setSuccessMsg("Review deleted.");
      fetchFeedback();
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-cyan-400" />
          Student Reviews
        </h2>
        {averageRating !== null && (
          <div className="flex items-center gap-2">
            <StarRating value={Math.round(averageRating)} readonly size="sm" />
            <span className="text-white font-bold">{averageRating.toFixed(1)}</span>
            <span className="text-text-muted text-sm">({feedbackList.length})</span>
          </div>
        )}
      </div>

      {/* Submit / Edit form for enrolled student */}
      {isEnrolled && currentUserId && (!myFeedback || isEditing) && (
        <form onSubmit={handleSubmit} className="glass-bright rounded-2xl border border-border p-5 space-y-4">
          <h3 className="text-white font-semibold">{myFeedback ? "Edit Your Review" : "Leave a Review"}</h3>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4" />{error}
            </div>
          )}

          <div>
            <label className="block text-text-secondary text-sm mb-2">Your Rating</label>
            <StarRating value={rating} onChange={setRating} />
          </div>

          <div>
            <label className="block text-text-secondary text-sm mb-2">
              Comment <span className="text-text-muted">(optional, max 2000 chars)</span>
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, 2000))}
              rows={4}
              placeholder="Share your experience with this course..."
              className="w-full bg-white/5 border border-border rounded-xl px-4 py-3 text-white placeholder:text-text-muted text-sm resize-none focus:outline-none focus:border-cyan-500/50"
            />
            <p className="text-text-muted text-xs mt-1 text-right">{comment.length}/2000</p>
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting || rating === 0}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-all"
            >
              {submitting ? "Submitting…" : myFeedback ? "Update Review" : "Submit Review"}
            </button>
            {isEditing && (
              <button
                type="button"
                onClick={() => { setIsEditing(false); setError(""); }}
                className="px-5 py-2.5 rounded-xl border border-border text-text-secondary hover:text-white text-sm transition-all"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {/* Current user's review (non-edit state) */}
      {myFeedback && !isEditing && (
        <div className="glass-bright rounded-2xl border border-cyan-500/30 p-5 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-white text-sm font-semibold">Your Review</p>
              <StarRating value={myFeedback.rating} readonly size="sm" />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setIsEditing(true); setError(""); setSuccessMsg(""); }}
                className="p-2 rounded-lg hover:bg-white/5 text-text-muted hover:text-white transition-all"
              >
                <Edit2 className="w-4 h-4" />
              </button>
              <button
                onClick={handleDelete}
                className="p-2 rounded-lg hover:bg-red-500/10 text-text-muted hover:text-red-400 transition-all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          {myFeedback.comment && <p className="text-text-secondary text-sm">{myFeedback.comment}</p>}
          <p className="text-text-muted text-xs">{timeAgo(myFeedback.updatedAt)}</p>
        </div>
      )}

      {/* Success message */}
      {successMsg && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">
          <CheckCircle className="w-4 h-4" />{successMsg}
        </div>
      )}

      {/* All reviews */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl bg-white/3 animate-pulse" />
          ))}
        </div>
      ) : feedbackList.filter((f) => f.user.id !== currentUserId).length === 0 ? (
        <p className="text-text-muted text-sm text-center py-8">No reviews yet. Be the first!</p>
      ) : (
        <div className="space-y-4">
          {feedbackList
            .filter((f) => f.user.id !== currentUserId)
            .map((f) => (
              <div key={f.id} className="glass-bright rounded-2xl border border-border p-5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center text-white text-xs font-bold">
                      {(f.user.name || "U")[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-white text-sm font-medium">{f.user.name || "Student"}</p>
                      <StarRating value={f.rating} readonly size="sm" />
                    </div>
                  </div>
                  <span className="text-text-muted text-xs">{timeAgo(f.createdAt)}</span>
                </div>
                {f.comment && <p className="text-text-secondary text-sm leading-relaxed">{f.comment}</p>}
              </div>
            ))}
        </div>
      )}
    </section>
  );
}