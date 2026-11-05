import { createHash } from "node:crypto";

/*
 * The API's security trail: one JSON line per event, prefixed "[security]", so the hosting
 * panel's log search (Render, Docker) can filter and alert on them. Nothing secret goes in —
 * no passwords or tokens, and emails only as a short hash (enough to see that the same
 * account is being tried again, without putting addresses in the logs).
 *
 * On top of the individual events, failures are counted per IP and per account. Crossing a
 * threshold within the window logs one "suspicious_activity" line, once per window — the
 * line worth an alert. Counted in memory, like the rate limits (see middleware/rateLimit.ts).
 */
export type SecurityEvent =
  | "login_failed"
  | "token_rejected"
  | "access_denied"
  | "rate_limited"
  | "csrf_rejected"
  | "https_required"
  | "refresh_token_reuse"
  | "password_changed"
  | "all_sessions_ended"
  | "account_deleted"
  | "suspicious_activity";

export interface SecurityDetails {
  ip?: string;
  userId?: string;
  email?: string;
  method?: string;
  path?: string;
  reason?: string;
  count?: number;
}

// Events that say someone may be probing: these feed the per-IP / per-account counters.
const FAILURES: ReadonlySet<SecurityEvent> = new Set(["login_failed", "token_rejected", "access_denied", "rate_limited", "csrf_rejected"]);

const WINDOW_MS = 15 * 60_000;
export const SUSPICIOUS_THRESHOLD = 20;

interface Counter {
  count: number;
  resetAt: number;
  reported: boolean;
}

const counters = new Map<string, Counter>();

const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, counter] of counters) if (counter.resetAt <= now) counters.delete(key);
}, 60_000);
sweep.unref();

export function emailFingerprint(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 12);
}

type Sink = (line: string) => void;
let sink: Sink = (line) => console.warn(line);

function write(event: SecurityEvent, details: SecurityDetails): void {
  const { email, ...rest } = details;
  const entry = { at: new Date().toISOString(), event, ...rest, ...(email ? { account: emailFingerprint(email) } : {}) };
  sink(`[security] ${JSON.stringify(entry)}`);
}

function countFailure(subject: string, details: SecurityDetails): void {
  const now = Date.now();
  let counter = counters.get(subject);
  if (!counter || counter.resetAt <= now) {
    counter = { count: 0, resetAt: now + WINDOW_MS, reported: false };
    counters.set(subject, counter);
  }
  counter.count += 1;

  if (counter.count >= SUSPICIOUS_THRESHOLD && !counter.reported) {
    counter.reported = true;
    write("suspicious_activity", { ...details, reason: `${counter.count} falhas em 15 min (${subject.split(":")[0]})`, count: counter.count });
  }
}

export function logSecurityEvent(event: SecurityEvent, details: SecurityDetails = {}): void {
  write(event, details);
  if (!FAILURES.has(event)) return;

  if (details.ip) countFailure(`ip:${details.ip}`, details);
  if (details.userId) countFailure(`user:${details.userId}`, details);
  else if (details.email) countFailure(`account:${emailFingerprint(details.email)}`, details);
}

// Tests read what was logged instead of the console, and start from empty counters.
export function captureSecurityLog(capture: Sink | null): void {
  sink = capture ?? ((line) => console.warn(line));
  counters.clear();
}
