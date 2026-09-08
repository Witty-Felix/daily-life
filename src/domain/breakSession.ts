import { drawRelaxation, type BreakSession } from "./relaxation";

export { type BreakSession } from "./relaxation";

export function replaceActivity(session: BreakSession, random?: () => number): BreakSession {
  if (session.completed || session.replacedActivityId != null) return session;
  return {
    ...session,
    activityId: drawRelaxation(random, session.activityId).id,
    replacedActivityId: session.activityId,
  };
}

export function finishActivity(session: BreakSession): BreakSession {
  if (session.completed) return session;
  return { ...session, completed: true };
}

export function endBreakSession(session: BreakSession, endedAt: string): BreakSession {
  if (session.endedAt) return session;
  return { ...session, endedAt };
}
