import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createVirtueRecord } from "../domain/virtue";
import { VirtueApiError } from "./virtueApi";
import { createSqliteVirtueDatabase } from "./sqliteVirtueApi";

const clock = { value: new Date(2026, 8, 12, 10, 0) };
const now = () => new Date(clock.value);
const past = (id: string) => createVirtueRecord({ id, date: "2026-09-11", type: "good", description: `${id} 原始记录`, reflection: null });

function withDatabase(test: (filename: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "virtue-sqlite-"));
  const filename = join(directory, "virtue.db");
  try { test(filename); } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe("SQLite-backed VirtueApi", () => {
  it("persists records across API recreation and isolates accounts", () => {
    withDatabase((filename) => {
      const first = createSqliteVirtueDatabase({ filename, accountId: "alice", now });
      const created = first.api.add({ id: "today", type: "good", description: "完成工作" });
      first.api.commitMigration({ version: 1, records: [past("past")] }, "batch-1");
      first.close();

      const reopened = createSqliteVirtueDatabase({ filename, accountId: "alice", now });
      expect(reopened.api.getRecords().map((record) => record.id)).toEqual(["past", "today"]);
      expect(reopened.api.getRecords().find((record) => record.id === "today")?.version).toBe(created.version);
      expect(reopened.api.getStats()).toMatchObject({ total: 2, goodCount: 2, netScore: 2 });
      const bob = createSqliteVirtueDatabase({ filename, accountId: "bob", now });
      expect(bob.api.getRecords()).toEqual([]);
      bob.close();
      reopened.close();
    });
  });

  it("keeps optimistic concurrency, correction, deletion, and purge boundaries", () => {
    withDatabase((filename) => {
      const holder = createSqliteVirtueDatabase({ filename, accountId: "alice", now });
      const api = holder.api;
      const created = api.add({ id: "today", type: "good", description: "原始" });
      const a = api.getRecords()[0];
      const b = api.getRecords()[0];
      expect(api.updateToday("today", { description: "先提交" }, a.version).version).toBe(2);
      expect(() => api.updateToday("today", { description: "旧修改" }, b.version)).toThrowError(expect.objectContaining({ code: "conflict" }));
      api.deleteToday("today", 2);
      expect(api.getRecords()).toEqual([]);
      expect(api.restore("today").version).toBe(3);
      api.deleteToday("today", 3);
      api.permanentlyDelete("today", "永久删除");
      expect(() => api.restore("today")).toThrowError(expect.objectContaining({ code: "gone" }));
      expect(() => api.add({ id: created.id, type: "good", description: "复用" })).toThrowError(expect.objectContaining({ code: "gone" }));
      holder.close();
    });
  });

  it("commits migration atomically and makes batches idempotent", () => {
    withDatabase((filename) => {
      const holder = createSqliteVirtueDatabase({ filename, accountId: "alice", now });
      const api = holder.api;
      const payload = { version: 1, records: [past("one"), past("two")] };
      const committed = api.commitMigration(payload, "batch-1");
      expect(api.commitMigration(payload, "batch-1")).toEqual(committed);
      expect(api.getRecords()).toHaveLength(2);
      expect(() => api.commitMigration({ version: 1, records: [past("three"), { bad: true } as never] }, "batch-2")).toThrowError(VirtueApiError);
      expect(api.getRecords().map((record) => record.id)).toEqual(["one", "two"]);
      holder.close();
    });
  });
});
