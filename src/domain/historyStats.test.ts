import { describe, expect, it } from "vitest";
import { getCompletedActivityCounts, getHistoryDayStats } from "./historyStats";
import type { BreakSession } from "./relaxation";

const session = (overrides: Partial<BreakSession>): BreakSession => ({
  id: "id",
  startedAt: "2026-09-08T23:59:00+08:00",
  activityId: "water",
  completed: false,
  endedAt: "2026-09-09T00:03:00+08:00",
  ...overrides,
});

describe("历史统计", () => {
  it("按开始时间归档跨午夜课间，并保留最近七个日期", () => {
    const stats = getHistoryDayStats([
      session({ id: "midnight", completed: true }),
      session({ id: "old", startedAt: "2026-09-01T12:00:00+08:00", endedAt: "2026-09-01T12:05:00+08:00" }),
    ], new Date("2026-09-09T12:00:00.000Z"));

    expect(stats).toHaveLength(7);
    expect(stats.find((day) => day.date === "2026-09-08")).toMatchObject({ drawn: 1, completed: 1 });
    expect(stats.find((day) => day.date === "2026-09-09")).toMatchObject({ drawn: 0 });
  });

  it("只统计最终活动的完成数量", () => {
    const counts = getCompletedActivityCounts([
      session({ id: "water", activityId: "water", completed: true }),
      session({ id: "walk", activityId: "walk", completed: true }),
      session({ id: "incomplete", activityId: "water", completed: false }),
    ]);
    expect(counts).toEqual({ water: 1, walk: 1 });
  });
});
