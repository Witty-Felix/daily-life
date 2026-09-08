import { describe, expect, it } from "vitest";
import {
  ACTIVITIES,
  createBreakSession,
  drawRelaxation,
  getActivityById,
  type ActivityId,
} from "./relaxation";
import { finishActivity, endBreakSession, type BreakSession } from "./breakSession";

describe("课间核心领域流程", () => {
  it("uses the prescribed weighted order and picks by a random threshold", () => {
    expect(ACTIVITIES.map((activity) => activity.weight)).toEqual([18, 18, 15, 15, 11, 11, 11]);
    expect(drawRelaxation(() => 0).id).toBe("water");
    expect(drawRelaxation(() => 17.999 / 99).id).toBe("water");
    expect(drawRelaxation(() => 18 / 99).id).toBe("walk");
    expect(drawRelaxation(() => 98.999 / 99).id).toBe("ball");
  });

  it("re-draws from remaining weighted activities without the current activity", () => {
    const replacement = drawRelaxation(() => 0.99, "water");
    expect(replacement.id).toBe("ball");
    expect(replacement.id).not.toBe("water");
  });

  it("creates a single session with one formal draw and a persisted activity", () => {
    const session = createBreakSession({
      id: "break-1",
      startedAt: "2026-09-08T09:30:00.000Z",
      random: () => 0,
    });

    expect(session).toMatchObject({
      id: "break-1",
      startedAt: "2026-09-08T09:30:00.000Z",
      activityId: "water",
      completed: false,
      endedAt: null,
    });
  });

  it("locks completion and keeps completion separate from ending", () => {
    const session: BreakSession = {
      id: "break-1",
      startedAt: "2026-09-08T09:30:00.000Z",
      activityId: "book",
      completed: false,
      endedAt: null,
    };

    const completed = finishActivity(session);
    expect(completed.completed).toBe(true);
    expect(finishActivity(completed)).toBe(completed);
    expect(completed.endedAt).toBeNull();

    const ended = endBreakSession(completed, "2026-09-08T09:40:00.000Z");
    expect(ended.endedAt).toBe("2026-09-08T09:40:00.000Z");
    expect(ended.completed).toBe(true);
  });

  it("keeps an ended, not-completed session marked as incomplete", () => {
    const session = createBreakSession({
      id: "break-2",
      startedAt: "2026-09-08T10:00:00.000Z",
      random: () => 0.5,
    });

    expect(endBreakSession(session, "2026-09-08T10:02:00.000Z")).toMatchObject({
      endedAt: "2026-09-08T10:02:00.000Z",
      completed: false,
    });
  });

  it("returns fixed guidance for every relaxation activity", () => {
    const ids: ActivityId[] = ["water", "walk", "abstinence", "book", "sing", "snake", "ball"];
    for (const id of ids) {
      const activity = getActivityById(id);
      expect(activity.name).toBeTruthy();
      expect(activity.guidance).toBeTruthy();
      expect(activity.duration).toBeTruthy();
    }
  });
});
