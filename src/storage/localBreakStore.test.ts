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

  it("ignores sessions with unknown activities or invalid dates", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      active: { ...activeSession, activityId: "unknown", endedAt: null },
      history: [{ ...activeSession, endedAt: "not-a-date" }],
    }));
    const store = createLocalBreakStore(localStorage, testNow);
    expect(store.getActive()).toBeNull();
    expect(store.getHistory()).toEqual([]);
  });

  it("only keeps history from the most recent seven calendar days by start date", () => {
    const store = createLocalBreakStore(localStorage, testNow);
    store.archive({ ...activeSession, id: "today", endedAt: "2026-09-08T09:40:00.000Z" });
    store.archive({ ...activeSession, id: "recent", startedAt: "2026-09-02T23:59:00+08:00", endedAt: "2026-09-03T00:05:00+08:00" });
    store.archive({ ...activeSession, id: "old", startedAt: "2026-09-01T23:59:00+08:00", endedAt: "2026-09-02T00:05:00+08:00" });
    expect(store.getHistory().map((item) => item.id)).toEqual(["today", "recent"]);
  });

  it("clears history and active data while preserving animation setting", () => {
    const store = createLocalBreakStore(localStorage, testNow, false);
    store.saveActive(activeSession);
    store.setAnimationEnabled(true);
    store.archive({ ...activeSession, endedAt: "2026-09-08T09:40:00.000Z" });
    store.saveActive({ ...activeSession, id: "active-again" });

    store.clear();

    const reopened = createLocalBreakStore(localStorage, testNow, false);
    expect(reopened.getActive()).toBeNull();
    expect(reopened.getHistory()).toEqual([]);
    expect(reopened.getAnimationEnabled()).toBe(true);
  });
});
