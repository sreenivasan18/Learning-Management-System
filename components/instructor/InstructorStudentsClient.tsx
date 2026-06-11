// components/instructor/InstructorStudentsClient.tsx
"use client";
import { useState, useEffect, useCallback } from "react";
import {
  Users, Search, ChevronLeft, ChevronRight, BookOpen,
  Mail, Calendar, BarChart3, BadgeCheck, Clock, AlertCircle,
} from "lucide-react";

interface CourseOption {
  id: string;
  title: string;
}

interface StudentEnrollment {
  enrollmentId: string;
  enrolledAt: string;
  status: string;
  pricePaid: number;
  completedAt: string | null;
  progressPct: number;
  completedModules: number;
  totalModules: number;
  course: { id: string; title: string; slug: string };
  student: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    createdAt: string;
    profile: {
      avatarUrl: string | null;
      college: string | null;
      education: string | null;
      bio: string | null;
    } | null;
  };
}

interface Pagination {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

interface Props {
  courses: CourseOption[];
}

export default function InstructorStudentsClient({ courses }: Props) {
  const [students, setStudents] = useState<StudentEnrollment[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [courseFilter, setCourseFilter] = useState("");
  const [page, setPage] = useState(1);

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (courseFilter) params.set("courseId", courseFilter);
      params.set("page", String(page));
      params.set("pageSize", "20");

      const res = await fetch(`/api/instructor/students?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load students.");
        return;
      }
      setStudents(data.students);
      setPagination(data.pagination);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [search, courseFilter, page]);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const handleCourseFilter = (val: string) => {
    setCourseFilter(val);
    setPage(1);
  };

  const avatar = (s: StudentEnrollment["student"]) =>
    s.profile?.avatarUrl || s.image || null;

  const initials = (name: string | null, email: string) => {
    if (name) return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
    return email[0].toUpperCase();
  };

  const statusColor = (status: string) => {
    if (status === "COMPLETED") return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
    if (status === "SUSPENDED") return "bg-red-500/20 text-red-300 border-red-500/30";
    return "bg-cyan-500/20 text-cyan-300 border-cyan-500/30";
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex flex-1 items-center gap-2 glass-bright border border-border rounded-xl px-4 py-2.5">
          <Search className="w-4 h-4 text-text-muted flex-shrink-0" />
          <input
            type="text"
            placeholder="Search by name or email…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="flex-1 bg-transparent text-white text-sm placeholder:text-text-muted outline-none"
          />
          <button
            type="button"
            onClick={handleSearch}
            className="text-xs px-3 py-1 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25 transition-all"
          >
            Search
          </button>
        </div>
        <select
          value={courseFilter}
          onChange={(e) => handleCourseFilter(e.target.value)}
          className="glass-bright border border-border rounded-xl px-4 py-2.5 text-sm text-white bg-transparent outline-none"
        >
          <option value="" className="bg-gray-900">All Courses</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id} className="bg-gray-900">
              {c.title}
            </option>
          ))}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="glass-bright rounded-2xl border border-border p-5 animate-pulse h-20" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && students.length === 0 && (
        <div className="glass-bright rounded-2xl border border-border p-12 text-center">
          <Users className="w-16 h-16 text-text-muted/30 mx-auto mb-4" />
          <p className="text-text-muted text-lg">No students found</p>
          <p className="text-text-muted/60 text-sm mt-1">
            {search || courseFilter
              ? "Try adjusting your filters."
              : "Students will appear here once they enroll in your courses."}
          </p>
        </div>
      )}

      {/* Student list */}
      {!loading && students.length > 0 && (
        <div className="space-y-3">
          {students.map((enrollment) => {
            const s = enrollment.student;
            const av = avatar(s);
            return (
              <div
                key={enrollment.enrollmentId}
                className="glass-bright rounded-2xl border border-border p-5"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  {/* Avatar + identity */}
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full overflow-hidden flex-shrink-0 bg-gradient-to-br from-cyan-500/30 to-violet-500/30 flex items-center justify-center text-white font-bold text-sm">
                      {av ? (
                        <img src={av} alt={s.name ?? s.email} className="w-full h-full object-cover" />
                      ) : (
                        initials(s.name, s.email)
                      )}
                    </div>
                    <div>
                      <p className="text-white font-semibold">{s.name ?? "—"}</p>
                      <div className="flex items-center gap-1.5 text-text-muted text-xs mt-0.5">
                        <Mail className="w-3 h-3" /> {s.email}
                      </div>
                      {s.profile?.college && (
                        <p className="text-text-muted text-xs mt-0.5">{s.profile.college}</p>
                      )}
                    </div>
                  </div>

                  {/* Status badge */}
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full border font-mono ${statusColor(enrollment.status)}`}
                  >
                    {enrollment.status}
                  </span>
                </div>

                {/* Details row */}
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="glass rounded-xl p-3 border border-border/50">
                    <div className="flex items-center gap-1.5 text-text-muted text-xs mb-1">
                      <BookOpen className="w-3.5 h-3.5" /> Course
                    </div>
                    <p className="text-white text-xs font-medium truncate">{enrollment.course.title}</p>
                  </div>

                  <div className="glass rounded-xl p-3 border border-border/50">
                    <div className="flex items-center gap-1.5 text-text-muted text-xs mb-1">
                      <Calendar className="w-3.5 h-3.5" /> Enrolled
                    </div>
                    <p className="text-white text-xs font-medium">
                      {new Date(enrollment.enrolledAt).toLocaleDateString()}
                    </p>
                  </div>

                  <div className="glass rounded-xl p-3 border border-border/50">
                    <div className="flex items-center gap-1.5 text-text-muted text-xs mb-1">
                      <BarChart3 className="w-3.5 h-3.5" /> Progress
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-violet-500"
                          style={{ width: `${enrollment.progressPct}%` }}
                        />
                      </div>
                      <span className="text-white text-xs font-medium">{enrollment.progressPct}%</span>
                    </div>
                    <p className="text-text-muted text-xs mt-0.5">
                      {enrollment.completedModules}/{enrollment.totalModules} modules
                    </p>
                  </div>

                  <div className="glass rounded-xl p-3 border border-border/50">
                    <div className="flex items-center gap-1.5 text-text-muted text-xs mb-1">
                      {enrollment.completedAt ? (
                        <><BadgeCheck className="w-3.5 h-3.5 text-emerald-400" /> Completed</>
                      ) : (
                        <><Clock className="w-3.5 h-3.5" /> Payment</>
                      )}
                    </div>
                    {enrollment.completedAt ? (
                      <p className="text-emerald-300 text-xs font-medium">
                        {new Date(enrollment.completedAt).toLocaleDateString()}
                      </p>
                    ) : (
                      <p className="text-white text-xs font-medium">
                        {enrollment.pricePaid === 0 ? "Free" : `₹${enrollment.pricePaid}`}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-text-muted text-sm">
            {((pagination.page - 1) * pagination.pageSize) + 1}–
            {Math.min(pagination.page * pagination.pageSize, pagination.totalCount)} of{" "}
            {pagination.totalCount} students
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => p - 1)}
              disabled={pagination.page <= 1}
              className="p-2 rounded-lg glass-bright border border-border text-text-muted hover:text-white disabled:opacity-40 transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-white text-sm font-mono">
              {pagination.page} / {pagination.totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="p-2 rounded-lg glass-bright border border-border text-text-muted hover:text-white disabled:opacity-40 transition-all"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}