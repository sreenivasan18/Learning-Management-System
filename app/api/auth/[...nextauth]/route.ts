import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;

export const runtime = "nodejs"; // Force Node.js runtime — avoids edge JSON parsing issues