import { describe, expect, it, beforeEach } from "vitest";
import { createLocalBreakStore, STORAGE_KEY } from "./localBreakStore";
import type { BreakSession } from "../domain/relaxation";

const activeSession: BreakSession = {
  id: "break-1",
  startedAt: "2026-09-08T09:30:00.000Z",
  activityId: "water",
  completed: false,
  endedAt: null,
};

const testNow = () => new Date("2026-09-08T12:00:00.000Z");

describe("本地课间记录", () => {
  beforeEach(() => localStorage.clear());

  it("saves and restores one active session", () => {
    const firstStore = createLocalBreakStore(localStorage, testNow);
    firstStore.saveActive(activeSession);

    const secondStore = createLocalBreakStore(localStorage, testNow);
    expect(secondStore.getActive()).toEqual(activeSession);
  });

  it("archives a session when ended and clears the active session", () => {
    const store = createLocalBreakStore(localStorage, testNow);
    store.saveActive(activeSession);
    const ended = { ...activeSession, endedAt: "2026-09-08T09:40:00.000Z" };

    store.archive(ended);

    expect(store.getActive()).toBeNull();
    expect(store.getHistory()).toEqual([ended]);
  });

  it("recovers safely from malformed local data", () => {
    localStorage.setItem(STORAGE_KEY, "not-json");
    const store = createLocalBreakStore(localStorage, testNow);
    expect(store.getActive()).toBeNull();
    expect(store.getHistory()).toEqual([]);
  });

  it("only keeps history from the most recent seven days", () => {
    const store = createLocalBreakStore(localStorage, testNow);
    store.archive({ ...activeSession, id: "recent", endedAt: "2026-09-02T09:40:00.000Z" });
    store.archive({ ...activeSession, id: "old", endedAt: "2026-09-01T09:40:00.000Z" });
    expect(store.getHistory().map((item) => item.id)).toEqual(["recent"]);
  });
});
