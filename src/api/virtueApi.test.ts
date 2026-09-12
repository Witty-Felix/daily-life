import { describe, expect, it } from "vitest";
import { createVirtueRecord } from "../domain/virtue";
import { createIsolatedVirtueBackend, createMemoryVirtueApi, VirtueApiError } from "./virtueApi";

const clock = { value: new Date(2026, 8, 12, 10, 0) };
const now = () => new Date(clock.value);
const backend = () => createIsolatedVirtueBackend();
const record = (id: string, date = "2026-09-11") => createVirtueRecord({ id, date, type: "good", description: `${id} 原始记录`, reflection: null });

describe("provider-neutral VirtueApi", () => {
  it("isolates accounts and derives fixed scores on the server", () => {
    const shared = backend();
    const first = createMemoryVirtueApi({ accountId: "alice", now, backend: shared });
    const second = createMemoryVirtueApi({ accountId: "bob", now, backend: shared });
    first.add({ id: "today", type: "fault", description: "没有按计划行动" });

    expect(first.getHome().todayStats).toMatchObject({ goodCount: 0, faultCount: 1, netScore: -2 });
    expect(second.getRecords()).toEqual([]);
    expect(() => second.updateToday("today", { description: "越权" })).toThrowError(VirtueApiError);
  });

  it("makes duplicate writes idempotent and rejects conflicting UUID reuse", () => {
    const api = createMemoryVirtueApi({ accountId: "alice", now, backend: backend() });
    const first = api.add({ id: "same", type: "good", description: "完成重要工作" });
    expect(api.add({ id: "same", type: "good", description: "完成重要工作" })).toEqual(first);
    expect(() => api.add({ id: "same", type: "fault", description: "另一件事" })).toThrowError(/内容不同/);
    expect(api.getRecords()).toHaveLength(1);
  });

  it("uses optimistic versions and does not silently overwrite concurrent edits", () => {
    const api = createMemoryVirtueApi({ accountId: "alice", now, backend: backend() });
    const created = api.add({ id: "today", type: "good", description: "原始" });
    const clientA = api.getByDate("2026-09-12")[0];
    const clientB = api.getByDate("2026-09-12")[0];
    const updated = api.updateToday("today", { description: "先提交的修改" }, clientA.version);
    expect(updated.version).toBe(clientA.version + 1);
    expect(() => api.updateToday("today", { description: "旧客户端修改" }, clientB.version)).toThrowError(expect.objectContaining({ code: "conflict" }));
    expect(api.getRecords()[0].description).toBe("先提交的修改");
    expect(created.version).toBe(1);
  });

  it("keeps historical corrections separate and recycles today's deletes", () => {
    const api = createMemoryVirtueApi({ accountId: "alice", now, backend: backend() });
    api.commitMigration({ version: 1, records: [record("past")] }, "batch-1");
    const past = api.getByDate("2026-09-11")[0];
    const corrected = api.correctHistorical("past", { type: "fault", description: "复盘后的记录" }, past.version);
    expect(corrected.type).toBe("good");
    expect(corrected.corrections[0].after.type).toBe("fault");
    const today = api.add({ id: "today", type: "good", description: "今日" });
    api.deleteToday("today", today.version);
    expect(api.getRecords().map((item) => item.id)).toEqual(["past"]);
    expect(api.restore("today").id).toBe("today");
  });

  it("previews and commits migrations idempotently, and preserves purged IDs", () => {
    const api = createMemoryVirtueApi({ accountId: "alice", now, backend: backend() });
    const payload = { version: 1, records: [record("one"), record("two")] };
    expect(api.previewMigration(payload)).toMatchObject({ accepted: 2, skipped: 0, errors: [] });
    const committed = api.commitMigration(payload, "batch-1");
    expect(committed.accepted).toBe(2);
    expect(api.commitMigration(payload, "batch-1")).toEqual(committed);
    expect(api.getRecords()).toHaveLength(2);
    api.permanentlyDelete("one", "永久删除");
    expect(() => api.commitMigration({ version: 1, records: [record("one")] }, "batch-2")).not.toThrow();
    expect(api.getRecords().map((item) => item.id)).toEqual(["two"]);
  });
});
