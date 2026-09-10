import { describe, expect, it } from "vitest";
import {
  appendVirtueCorrection,
  createVirtueRecord,
  getEffectiveVirtueFields,
  getVirtueRecordScore,
  getVirtueStats,
  isVirtueDate,
  isVirtueRecord,
  localDateKey,
  updateVirtueRecord,
} from "./virtue";

const good = (overrides: Partial<ReturnType<typeof createVirtueRecord>> = {}) => createVirtueRecord({
  id: "good-1",
  date: "2026-09-09",
  type: "good",
  description: "认真完成工作",
  ...overrides,
});

describe("功过格领域模型", () => {
  it("固定善行 +1、过失 -2，并允许净分为负", () => {
    const records = [
      good(),
      createVirtueRecord({ id: "fault-1", date: "2026-09-09", type: "fault", description: "忘记回复消息" }),
      createVirtueRecord({ id: "fault-2", date: "2026-09-09", type: "fault", description: "拖延了重要事项" }),
    ];

    expect(getVirtueStats(records, "2026-09-09")).toEqual({
      date: "2026-09-09",
      total: 3,
      goodCount: 1,
      faultCount: 2,
      netScore: -3,
    });
    expect(getVirtueRecordScore(good())).toBe(1);
    expect(getVirtueRecordScore(records[1])).toBe(-2);
  });

  it("按自然日聚合，不混入其他日期", () => {
    const records = [
      good(),
      createVirtueRecord({ id: "other", date: "2026-09-08", type: "fault", description: "昨天的记录" }),
    ];

    expect(getVirtueStats(records, "2026-09-09")).toMatchObject({ total: 1, goodCount: 1, faultCount: 0, netScore: 1 });
    expect(getVirtueStats(records, "2026-09-08")).toMatchObject({ total: 1, goodCount: 0, faultCount: 1, netScore: -2 });
    expect(localDateKey(new Date(2026, 8, 9, 23, 59))).toBe("2026-09-09");
  });

  it("当天编辑会立即按新类型重新计算", () => {
    const updated = updateVirtueRecord(good(), { type: "fault", description: "重新认识这件事", reflection: "明天先做最小一步" });
    expect(updated).toMatchObject({ type: "fault", description: "重新认识这件事", reflection: "明天先做最小一步" });
    expect(getVirtueRecordScore(updated)).toBe(-2);
  });

  it("过往记录追加可追溯修正，统计使用最后一次有效结果", () => {
    const original = createVirtueRecord({ id: "past", date: "2026-09-08", type: "fault", description: "原始记录", reflection: null });
    const corrected = appendVirtueCorrection(original, {
      correctedOn: "2026-09-09",
      type: "good",
      description: "确认其实是一次帮助",
      note: "回看上下文后修正",
    });

    expect(corrected.type).toBe("fault");
    expect(corrected.corrections).toHaveLength(1);
    expect(corrected.corrections[0]).toMatchObject({
      before: { type: "fault", description: "原始记录" },
      after: { type: "good", description: "确认其实是一次帮助" },
      note: "回看上下文后修正",
    });
    expect(getEffectiveVirtueFields(corrected)).toMatchObject({ type: "good", description: "确认其实是一次帮助" });
    expect(getVirtueStats([corrected], "2026-09-08")).toMatchObject({ goodCount: 1, faultCount: 0, netScore: 1 });
  });

  it("拒绝非法日期、空描述和同日或未来记录", () => {
    expect(isVirtueDate("2026-02-29")).toBe(false);
    expect(() => createVirtueRecord({ id: "bad", date: "2026-02-29", type: "good", description: "无效日期" })).toThrow();
    expect(() => createVirtueRecord({ id: "bad", date: "2026-09-09", type: "good", description: "   " })).toThrow();
    expect(() => appendVirtueCorrection(good(), { correctedOn: "2026-09-09", description: "同日修正" })).toThrow();
    expect(() => appendVirtueCorrection(good(), { correctedOn: "2026-09-08", description: "早于记录的修正" })).toThrow();
    expect(isVirtueRecord({ ...good(), corrections: [{ nope: true }] })).toBe(false);
  });
});
