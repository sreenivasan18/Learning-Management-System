// FILE PATH: lib/activity.ts
//
// Centralized platform activity logger.
// Import this in any API route that performs an important action.
//
// Usage:
//   import { logActivity } from "@/lib/activity";
//   await logActivity({ activityType: "ENROLLMENT", actorId: userId, ... });
//
// FIX: Added COURSE_APPROVED, COURSE_REJECTED, COURSE_PUBLISHED, COURSE_UNPUBLISHED
// to the ActivityPayload union so that admin approval and publication actions are
// logged with distinct, human-readable type strings instead of the generic
// COURSE_UPDATED. The admin monitoring dashboard already has display labels for
// COURSE_APPROVED and COURSE_REJECTED; this aligns the code with those labels.

import { prisma } from "@/lib/prisma";

export interface ActivityPayload {
  activityType:
    | "ENROLLMENT"
    | "PROGRESS_UPDATE"
    | "COURSE_COMPLETED"
    | "CERTIFICATE_ISSUED"
    | "VIDEO_UPLOADED"
    | "MODULE_UPDATED"
    | "COURSE_CREATED"
    | "COURSE_UPDATED"
    | "COURSE_APPROVED"
    | "COURSE_REJECTED"
    | "COURSE_PUBLISHED"
    | "COURSE_UNPUBLISHED"
    | "REVIEW_SUBMITTED"
    | "ADMIN_MESSAGE_SENT"
    | "QUIZ_ATTEMPTED";
  actorId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  targetId?: string | null;
  targetType?: string | null;
  targetTitle?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logActivity(payload: ActivityPayload): Promise<void> {
  try {
    await prisma.platformActivity.create({
      data: {
        activityType: payload.activityType,
        actorId:      payload.actorId ?? null,
        actorName:    payload.actorName ?? null,
        actorRole:    payload.actorRole ?? null,
        targetId:     payload.targetId ?? null,
        targetType:   payload.targetType ?? null,
        targetTitle:  payload.targetTitle ?? null,
        metadata:     JSON.stringify(payload.metadata ?? {}),
      },
    });
  } catch (err) {
    // Activity logging must never crash the main request
    console.error("[activity] Failed to log activity:", payload.activityType, err);
  }
}