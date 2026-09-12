import {
  appendVirtueCorrection,
  createVirtueRecord,
  getVirtueStats,
  isVirtueDate,
  isVirtueRecord,
  todayVirtueDate,
  type CreateVirtueRecordInput,
  type UpdateVirtueRecordInput,
  type VirtueDate,
  type VirtueFields,
  type VirtueRecord,
  type VirtueStats,
  type VirtueCorrectionInput,
} from "../domain/virtue";
import { createLocalVirtueStore, exportVirtueJson, type LocalVirtueStore, type VirtueStorageLike } from "../storage/virtueStore";

export type VirtuePageApi = Pick<LocalVirtueStore, "getRecords" | "add" | "updateToday" | "correctHistorical" | "deleteToday" | "clear" | "exportJSON" | "exportCSV">;

export type VirtueApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "validation"
  | "not_found"
  | "conflict"
  | "gone"
  | "unavailable";

export class VirtueApiError extends Error {
  readonly name = "VirtueApiError";
  constructor(readonly code: VirtueApiErrorCode, message: string) {
    super(message);
  }
}

export type VersionedVirtueRecord = VirtueRecord & { version: number };
export type VirtueHome = {
  accountId: string;
  today: VirtueDate;
  todayRecords: VersionedVirtueRecord[];
  todayStats: VirtueStats;
  recentDates: VirtueDate[];
};

export type MigrationPayload = {
  version: number;
  records: VirtueRecord[];
};

export type MigrationPreview = {
  batchId: string;
  accepted: number;
  skipped: number;
  errors: Array<{ id?: string; message: string }>;
  stats: VirtueStats;
};

export type VirtueApi = {
  getRecords(): VersionedVirtueRecord[];
  getByDate(date: VirtueDate): VersionedVirtueRecord[];
  getByRange(from: VirtueDate, to: VirtueDate): VersionedVirtueRecord[];
  getHome(): VirtueHome;
  getStats(from?: VirtueDate, to?: VirtueDate): VirtueStats;
  add(input: Omit<CreateVirtueRecordInput, "date"> & { expectedVersion?: number }): VersionedVirtueRecord;
  updateToday(id: string, changes: UpdateVirtueRecordInput, expectedVersion?: number): VersionedVirtueRecord;
  correctHistorical(id: string, input: Omit<VirtueCorrectionInput, "correctedOn">, expectedVersion?: number): VersionedVirtueRecord;
  deleteToday(id: string, expectedVersion?: number): void;
  restore(id: string): VersionedVirtueRecord;
  permanentlyDelete(id: string, confirmation: string): void;
  exportJSON(): string;
  previewMigration(payload: MigrationPayload, batchId?: string): MigrationPreview;
  commitMigration(payload: MigrationPayload, batchId?: string): MigrationPreview;
};

type StoredRecord = { record: VirtueRecord; version: number; deletedAt: string | null };
type BackendState = { accounts: Map<string, Map<string, StoredRecord>>; purged: Map<string, Set<string>>; batches: Map<string, MigrationPreview> };

const RECOVERY_DAYS = 30;
const defaultBackend: BackendState = { accounts: new Map(), purged: new Map(), batches: new Map() };

function cloneFields(fields: VirtueFields): VirtueFields { return { ...fields }; }
function cloneRecord(record: VirtueRecord): VirtueRecord {
  return { ...record, corrections: record.corrections.map((correction) => ({ ...correction, before: cloneFields(correction.before), after: cloneFields(correction.after) })) };
}
function versioned(item: StoredRecord): VersionedVirtueRecord { return { ...cloneRecord(item.record), version: item.version }; }
function fail(code: VirtueApiErrorCode, message: string): never { throw new VirtueApiError(code, message); }
function assertDate(date: string): void { if (!isVirtueDate(date)) fail("validation", "日期必须是有效的 YYYY-MM-DD 自然日"); }
function assertVersion(item: StoredRecord, expected?: number): void { if (expected !== undefined && expected !== item.version) fail("conflict", "记录已被其他设备修改，请刷新后重试"); }
function stats(records: VirtueRecord[], from?: VirtueDate, to?: VirtueDate): VirtueStats {
  if (from) assertDate(from); if (to) assertDate(to); if (from && to && from > to) fail("validation", "日期范围无效");
  return getVirtueStats(records.filter((record) => (!from || record.date >= from) && (!to || record.date <= to)));
}
function dayDiff(from: VirtueDate, to: VirtueDate): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/**
 * A provider-neutral server adapter. It is intentionally synchronous so the current
 * browser UI can use it today; an HTTP/Supabase adapter can implement the same contract.
 */
export function createMemoryVirtueApi(options: { accountId: string; now?: () => Date; backend?: BackendState } ): VirtueApi {
  if (!options.accountId.trim()) fail("unauthorized", "缺少功过格账户");
  const now = options.now ?? (() => new Date());
  const backend = options.backend ?? defaultBackend;
  const records = backend.accounts.get(options.accountId) ?? new Map<string, StoredRecord>();
  backend.accounts.set(options.accountId, records);
  const purged = backend.purged.get(options.accountId) ?? new Set<string>();
  backend.purged.set(options.accountId, purged);
  const today = () => todayVirtueDate(now());
  const visible = () => [...records.values()].filter((item) => !item.deletedAt).sort((a, b) => a.record.date.localeCompare(b.record.date) || a.record.id.localeCompare(b.record.id));
  const find = (id: string, includeDeleted = false): StoredRecord => {
    const item = records.get(id);
    if (!item) { if (purged.has(id)) fail("gone", "功过记录已永久删除"); fail("not_found", "功过记录不存在"); }
    if (!includeDeleted && item.deletedAt) fail("gone", "功过记录已进入回收期");
    return item;
  };
  const preview = (payload: MigrationPayload, batchId: string = crypto.randomUUID()): MigrationPreview => {
    if (payload.version !== 1 || !Array.isArray(payload.records)) fail("validation", "迁移文件版本不支持");
    const errors: MigrationPreview["errors"] = []; let accepted = 0; let skipped = 0;
    const seen = new Set<string>();
    for (const candidate of payload.records) {
      if (!isVirtueRecord(candidate)) { errors.push({ message: "记录数据无效" }); continue; }
      if (seen.has(candidate.id) || purged.has(candidate.id) || records.has(candidate.id)) { skipped++; continue; }
      seen.add(candidate.id); accepted++;
    }
    const imported = payload.records.filter((record) => isVirtueRecord(record) && seen.has(record.id) && !records.has(record.id) && !purged.has(record.id)).filter((record, index, list) => list.findIndex((candidate) => candidate.id === record.id) === index).map(cloneRecord);
    const effective = [...visible().map((item) => item.record), ...imported];
    return { batchId, accepted, skipped, errors, stats: stats(effective) };
  };
  return {
    getRecords: () => visible().map(versioned),
    getByDate: (date) => { assertDate(date); return visible().filter((item) => item.record.date === date).map(versioned); },
    getByRange: (from, to) => { assertDate(from); assertDate(to); if (from > to) fail("validation", "日期范围无效"); return visible().filter((item) => item.record.date >= from && item.record.date <= to).map(versioned); },
    getHome: () => {
      const date = today(); const all = visible().map((item) => item.record); const todayRecords = visible().filter((item) => item.record.date === date).map(versioned);
      const recentDates = [...new Set(all.map((record) => record.date))].sort().reverse().slice(0, 7);
      return { accountId: options.accountId, today: date, todayRecords, todayStats: stats(all, date, date), recentDates };
    },
    getStats: (from, to) => stats(visible().map((item) => item.record), from, to),
    add: (input) => {
      const date = today(); const existing = records.get(input.id);
      if (existing && !existing.deletedAt) {
        const same = existing.record.type === input.type && existing.record.description.trim() === input.description.trim() && (existing.record.reflection ?? null) === (input.reflection?.trim() || null);
        if (same) return versioned(existing);
        fail("conflict", "功过记录标识已存在且内容不同");
      }
      if (existing || purged.has(input.id)) fail("gone", "功过记录标识不可复用");
      const record = createVirtueRecord({ ...input, date }); const stored = { record, version: 1, deletedAt: null };
      records.set(record.id, stored); return versioned(stored);
    },
    updateToday: (id, changes, expectedVersion) => {
      const item = find(id); assertVersion(item, expectedVersion); if (item.record.date !== today()) fail("forbidden", "过往功过记录不能直接编辑，请追加修正");
      const next = createVirtueRecord({ id, date: item.record.date, type: changes.type ?? item.record.type, description: changes.description ?? item.record.description, reflection: changes.reflection ?? item.record.reflection });
      item.record = { ...next, corrections: item.record.corrections.map((correction) => ({ ...correction, before: cloneFields(correction.before), after: cloneFields(correction.after) })) }; item.version++;
      return versioned(item);
    },
    correctHistorical: (id, input, expectedVersion) => {
      const item = find(id); assertVersion(item, expectedVersion); if (item.record.date >= today()) fail("forbidden", "只能对过往功过记录追加修正");
      item.record = appendVirtueCorrection(item.record, { ...input, correctedOn: today() }); item.version++; return versioned(item);
    },
    deleteToday: (id, expectedVersion) => { const item = find(id); assertVersion(item, expectedVersion); if (item.record.date !== today()) fail("forbidden", "过往功过记录不能删除"); item.deletedAt = now().toISOString(); },
    restore: (id) => { const item = find(id, true); if (!item.deletedAt) return versioned(item); if (dayDiff(item.deletedAt.slice(0, 10), today()) > RECOVERY_DAYS) fail("gone", "回收期已结束"); item.deletedAt = null; item.version++; return versioned(item); },
    permanentlyDelete: (id, confirmation) => { if (confirmation !== "永久删除") fail("validation", "请输入“永久删除”确认操作"); const item = find(id, true); records.delete(id); purged.add(id); },
    exportJSON: () => exportVirtueJson(visible().map((item) => ({ ...item.record, version: item.version } as VirtueRecord))),
    previewMigration: preview,
    commitMigration: (payload, batchId = crypto.randomUUID()) => {
      const prior = backend.batches.get(`${options.accountId}:${batchId}`); if (prior) return prior;
      const result = preview(payload, batchId); if (result.errors.length) fail("validation", "迁移文件包含无效记录");
      for (const record of payload.records) if (isVirtueRecord(record) && !records.has(record.id) && !purged.has(record.id)) records.set(record.id, { record: cloneRecord(record), version: 1, deletedAt: null });
      backend.batches.set(`${options.accountId}:${batchId}`, result); return result;
    },
  };
}

export function createIsolatedVirtueBackend(): BackendState { return { accounts: new Map(), purged: new Map(), batches: new Map() }; }





export function createLocalVirtueApi(storage: VirtueStorageLike, now: () => Date = () => new Date()): VirtuePageApi {
  return createLocalVirtueStore(storage, now);
}
