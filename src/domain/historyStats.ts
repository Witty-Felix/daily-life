import type { ActivityId, BreakSession } from "./relaxation";

export type HistoryDayStat = {
  date: string;
  drawn: number;
  completed: number;
  incomplete: number;
};

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function shiftDate(date: Date, days: number): Date {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

export function getHistoryDayStats(history: readonly BreakSession[], now = new Date()): HistoryDayStat[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const stats = new Map<string, HistoryDayStat>();

  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = localDateKey(shiftDate(today, -offset));
    stats.set(date, { date, drawn: 0, completed: 0, incomplete: 0 });
  }

  for (const session of history) {
    const date = localDateKey(new Date(session.startedAt));
    const day = stats.get(date);
    if (!day) continue;
    day.drawn += 1;
    if (session.completed) {
      day.completed += 1;
    } else {
      day.incomplete += 1;
    }
  }

  return [...stats.values()];
}

export function getCompletedActivityCounts(history: readonly BreakSession[]): Partial<Record<ActivityId, number>> {
  return history.reduce<Partial<Record<ActivityId, number>>>((counts, session) => {
    if (session.completed) counts[session.activityId] = (counts[session.activityId] ?? 0) + 1;
    return counts;
  }, {});
}

export function formatHistoryDate(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function formatHistoryDay(key: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", weekday: "short" }).format(dateFromKey(key));
}
