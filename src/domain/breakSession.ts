import type { BreakSession } from "./relaxation";

export { type BreakSession } from "./relaxation";

export function finishActivity(session: BreakSession): BreakSession {
  if (session.completed) return session;
  return { ...session, completed: true };
}

export function endBreakSession(session: BreakSession, endedAt: string): BreakSession {
  if (session.endedAt) return session;
  return { ...session, endedAt };
}
