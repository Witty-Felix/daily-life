import { ACTIVITIES, type BreakSession } from "../domain/relaxation";

export const STORAGE_KEY = "class-break-draw.v1";
const RETENTION_DAYS = 7;

type PersistedBreakData = {
  active: BreakSession | null;
  history: BreakSession[];
  animationEnabled: boolean;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const emptyData = (animationEnabled: boolean): PersistedBreakData => ({ active: null, history: [], animationEnabled });

function isBreakSession(value: unknown): value is BreakSession {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<BreakSession>;
  return (
    typeof item.id === "string" &&
    typeof item.startedAt === "string" &&
    !Number.isNaN(new Date(item.startedAt).getTime()) &&
    typeof item.activityId === "string" &&
    ACTIVITIES.some((activity) => activity.id === item.activityId) &&
    (item.replacedActivityId === undefined || item.replacedActivityId === null || typeof item.replacedActivityId === "string") &&
    typeof item.completed === "boolean" &&
    (item.snakeGamesStarted === undefined || (Number.isInteger(item.snakeGamesStarted) && item.snakeGamesStarted >= 0)) &&
    (item.endedAt === null || (typeof item.endedAt === "string" && !Number.isNaN(new Date(item.endedAt).getTime())))
  );
}

function load(storage: StorageLike, defaultAnimationEnabled: boolean): PersistedBreakData {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyData(defaultAnimationEnabled);
    const parsed = JSON.parse(raw) as Partial<PersistedBreakData>;
    return {
      active: isBreakSession(parsed.active) && parsed.active.endedAt === null ? parsed.active : null,
      history: Array.isArray(parsed.history) ? parsed.history.filter(isBreakSession) : [],
      animationEnabled: typeof parsed.animationEnabled === "boolean" ? parsed.animationEnabled : defaultAnimationEnabled,
    };
  } catch {
    return emptyData(defaultAnimationEnabled);
  }
}

function save(storage: StorageLike, data: PersistedBreakData) {
  storage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function calendarDayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / (24 * 60 * 60 * 1000);
}

function isWithinRetention(session: BreakSession, now: Date): boolean {
  const ageInDays = calendarDayNumber(now) - calendarDayNumber(new Date(session.startedAt));
  return ageInDays >= 0 && ageInDays < RETENTION_DAYS;
}

export function createLocalBreakStore(
  storage: StorageLike,
  now: () => Date = () => new Date(),
  defaultAnimationEnabled = true,
) {
  const read = () => {
    const data = load(storage, defaultAnimationEnabled);
    const history = data.history.filter((session) => isWithinRetention(session, now()));
    if (history.length !== data.history.length) save(storage, { ...data, history });
    return { ...data, history };
  };

  return {
    getActive(): BreakSession | null {
      return read().active;
    },
    saveActive(session: BreakSession) {
      if (session.endedAt !== null) throw new Error("进行中的课间不能保存结束状态");
      const data = read();
      save(storage, { ...data, active: session });
    },
    archive(session: BreakSession) {
      if (session.endedAt === null) throw new Error("只有已结束的课间才能归档");
      const data = read();
      save(storage, { ...data, active: null, history: [...data.history, session].filter((item) => isWithinRetention(item, now())) });
    },
    getHistory(): BreakSession[] {
      return read().history;
    },
    getAnimationEnabled(): boolean {
      return read().animationEnabled;
    },
    setAnimationEnabled(enabled: boolean) {
      const data = read();
      save(storage, { ...data, animationEnabled: enabled });
    },
    clear() {
      const data = read();
      save(storage, { ...emptyData(data.animationEnabled), animationEnabled: data.animationEnabled });
    },
  };
}
