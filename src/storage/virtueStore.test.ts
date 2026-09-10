import { beforeEach, describe, expect, it } from "vitest";
import { createVirtueRecord } from "../domain/virtue";
import { createLocalVirtueStore, VIRTUE_STORAGE_KEY, exportVirtueCsv, exportVirtueJson } from "./virtueStore";

const now = () => new Date(2026, 8, 9, 10, 0);
const pastNow = () => new Date(2026, 8, 10, 10, 0);
const storageKeyForBreaks = "class-break-draw.v1";

const record = (id: string, date: string, type: "good" | "fault" = "good") => createVirtueRecord({
  id,
  date,
  type,
  description: `${id} 的行为`,
  reflection: null,
});

describe("本地功过格存储", () => {
  beforeEach(() => localStorage.clear());

  it("按当天自然日新增并可刷新恢复", () => {
    const first = createLocalVirtueStore(localStorage, now);
    const added = first.add({ id: "today", type: "good", description: "按计划完成任务" });

    expect(added.date).toBe("2026-09-09");
    expect(added).not.toHaveProperty("createdAt");
    expect(createLocalVirtueStore(localStorage, now).getByDate("2026-09-09")).toEqual([added]);
  });

  it("当天可以编辑和删除，过往记录只能追加修正", () => {
    const store = createLocalVirtueStore(localStorage, pastNow);
    store.save(record("today", "2026-09-10"));
    store.save(record("past", "2026-09-09", "fault"));

    const updated = store.updateToday("today", { type: "fault", description: "当天改正" });
    expect(updated.type).toBe("fault");
    expect(() => store.deleteToday("past")).toThrow("过往功过记录不能删除");
    expect(() => store.updateToday("past", { description: "不应直接编辑" })).toThrow("过往功过记录不能直接编辑");

    const corrected = store.correctHistorical("past", { type: "good", note: "补充核对" });
    expect(corrected.corrections).toHaveLength(1);
    expect(store.getByDate("2026-09-09")[0]).toMatchObject({ type: "fault", description: "past 的行为" });
    expect(store.getEffectiveByDate("2026-09-09")[0]).toMatchObject({ type: "good", description: "past 的行为" });

    store.deleteToday("today");
    expect(store.getRecords().map((item) => item.id)).toEqual(["past"]);
  });

  it("安全忽略非法、缺失、重复数据", () => {
    localStorage.setItem(VIRTUE_STORAGE_KEY, JSON.stringify({
      records: [
        record("valid", "2026-09-09"),
        record("valid", "2026-09-09", "fault"),
        { id: "bad", date: "2026-09-09", type: "unknown", description: "坏数据", reflection: null, corrections: [] },
        { id: "missing" },
      ],
    }));

    expect(createLocalVirtueStore(localStorage, now).getRecords().map((item) => item.id)).toEqual(["valid"]);
    localStorage.setItem(VIRTUE_STORAGE_KEY, "not-json");
    expect(createLocalVirtueStore(localStorage, now).getRecords()).toEqual([]);
  });

  it("清空只隔离功过格存储，不影响课间数据", () => {
    localStorage.setItem(storageKeyForBreaks, "break-data");
    const store = createLocalVirtueStore(localStorage, now);
    store.save(record("one", "2026-09-09"));

    store.clear();

    expect(localStorage.getItem(VIRTUE_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(storageKeyForBreaks)).toBe("break-data");
  });

  it("JSON 和 CSV 导出包含完整、可对应的有效数据", () => {
    const original = record("past", "2026-09-08", "fault");
    const store = createLocalVirtueStore(localStorage, pastNow);
    store.save(original);
    store.correctHistorical("past", { type: "good", description: "修正后的行为" });

    const json = JSON.parse(store.exportJSON()) as { version: number; records: typeof original[] };
    const csv = store.exportCSV();

    expect(json.version).toBe(1);
    expect(json.records[0].id).toBe("past");
    expect(json.records[0].corrections).toHaveLength(1);
    expect(csv).toContain("id,date,type,score,description");
    expect(csv).toContain("past,2026-09-08,good,1,修正后的行为");
    expect(csv).toContain("修正后的行为");
    expect(exportVirtueJson(json.records)).toContain('"records"');
    expect(exportVirtueCsv(json.records)).toContain("correctionCount");
  });
});

