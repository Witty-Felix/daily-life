import type { BreakSession } from "../domain/relaxation";

export const STORAGE_KEY = "class-break-draw.v1";
const RETENTION_DAYS = 7;

type PersistedBreakData = {
  active: BreakSession | null;
  history: BreakSession[];
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const emptyData = (): PersistedBreakData => ({ active: null, history: [] });

function isBreakSession(value: unknown): value is BreakSession {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<BreakSession>;
  return (
    typeof item.id === "string" &&
    typeof item.startedAt === "string" &&
    typeof item.activityId === "string" &&
    typeof item.completed === "boolean" &&
    (item.endedAt === null || typeof item.endedAt === "string")
  );
}

function load(storage: StorageLike): PersistedBreakData {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    const parsed = JSON.parse(raw) as Partial<PersistedBreakData>;
    return {
      active: isBreakSession(parsed.active) && parsed.active.endedAt === null ? parsed.active : null,
      history: Array.isArray(parsed.history) ? parsed.history.filter(isBreakSession) : [],
    };
  } catch {
    return emptyData();
  }
}

function save(storage: StorageLike, data: PersistedBreakData) {
  storage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function isWithinRetention(session: BreakSession, now: Date): boolean {
  const reference = session.endedAt ?? session.startedAt;
  const age = now.getTime() - new Date(reference).getTime();
  return age >= 0 && age < RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

export function createLocalBreakStore(storage: StorageLike, now: () => Date = () => new Date()) {
  const read = () => {
    const data = load(storage);
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
      save(storage, { active: null, history: [...data.history, session].filter((item) => isWithinRetention(item, now())) });
    },
    getHistory(): BreakSession[] {
      return read().history;
    },
    clear() {
      storage.removeItem(STORAGE_KEY);
    },
  };
}
