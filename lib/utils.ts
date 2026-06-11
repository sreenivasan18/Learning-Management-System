// lib/utils.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { randomInt } from "crypto";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Generates a cryptographically secure 6-digit OTP string.
 * Uses Node's built-in randomInt (CSPRNG) — never Math.random().
 */
export function generateOTP(): string {
  // randomInt(min, max) is inclusive of min, exclusive of max
  return String(randomInt(100000, 1000000)).padStart(6, "0");
}

/**
 * Converts a string to a URL-safe slug.
 * e.g. "Hello World! 101" → "hello-world-101"
 *
 * Steps:
 *  1. Lowercase and trim
 *  2. Replace accented / unicode chars with ASCII equivalent (NFD decomposition)
 *  3. Strip non-alphanumeric characters (except spaces and hyphens)
 *  4. Collapse runs of spaces/hyphens into a single hyphen
 *  5. Strip leading/trailing hyphens
 */
export function slugify(text: string): string {
  return text
    .normalize("NFD")                         // decompose accented chars
    .replace(/[\u0300-\u036f]/g, "")          // strip combining diacritics
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")            // keep alphanum, spaces, hyphens
    .replace(/[\s_-]+/g, "-")                 // collapse whitespace/underscore/hyphen → single hyphen
    .replace(/^-+|-+$/g, "");                 // strip leading/trailing hyphens
}