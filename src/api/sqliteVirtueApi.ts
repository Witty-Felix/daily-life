import { DatabaseSync } from "node:sqlite";
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
import { exportVirtueJson } from "../storage/virtueStore";
import {
  VirtueApiError,
  type MigrationPayload,
  type MigrationPreview,
  type VersionedVirtueRecord,
  type VirtueApi,
} from "./virtueApi";

const RECOVERY_DAYS = 30;

type SqliteRow = Record<string, unknown>;
export type SqliteVirtueApiOptions = {
  accountId: string;
  filename?: string;
  database?: DatabaseSync;
  now?: () => Date;
};

export type SqliteVirtueResolver = {
  database: DatabaseSync;
  resolveApi(accountId: string): VirtueApi;
  close(): void;
};

export type SqliteVirtueDatabase = {
  database: DatabaseSync;
  api: VirtueApi;
  close(): void;
};
export type VirtueDataSnapshot = {
  version: 1;
  accountId: string;
  records: VersionedVirtueRecord[];
  purgedIds: string[];
};

function fail(code: ConstructorParameters<typeof VirtueApiError>[0], message: string): never {
  throw new VirtueApiError(code, message);
}
function cloneFields(fields: VirtueFields): VirtueFields { return { ...fields }; }
function cloneRecord(record: VirtueRecord): VirtueRecord {
  return {
    ...record,
    corrections: record.corrections.map((correction) => ({
      ...correction,
      before: cloneFields(correction.before),
      after: cloneFields(correction.after),
    })),
  };
}
function versioned(record: VirtueRecord, version: number): VersionedVirtueRecord {
  return { ...cloneRecord(record), version };
}
function assertDate(date: string): asserts date is VirtueDate {
  if (!isVirtueDate(date)) fail("validation", "invalid virtue date");
}
function assertRange(from: VirtueDate, to: VirtueDate): void {
  assertDate(from); assertDate(to);
  if (from > to) fail("validation", "invalid date range");
}
function dayDiff(from: VirtueDate, to: VirtueDate): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}
function stats(records: VirtueRecord[], from?: VirtueDate, to?: VirtueDate): VirtueStats {
  if (from) assertDate(from);
  if (to) assertDate(to);
  if (from && to && from > to) fail("validation", "invalid date range");
  return getVirtueStats(records.filter((record) => (!from || record.date >= from) && (!to || record.date <= to)));
}
function parseRecord(row: SqliteRow): { record: VirtueRecord; version: number; deletedAt: string | null } {
  const record: VirtueRecord = {
    id: String(row.id),
    date: String(row.date),
    type: row.type as VirtueRecord["type"],
    description: String(row.description),
    reflection: row.reflection == null ? null : String(row.reflection),
    corrections: JSON.parse(String(row.corrections_json)) as VirtueRecord["corrections"],
  };
  return { record, version: Number(row.version), deletedAt: row.deleted_at == null ? null : String(row.deleted_at) };
}
function serializeFields(fields: VirtueFields): string {
  return JSON.stringify({ type: fields.type, description: fields.description, reflection: fields.reflection });
}
function normalizeMigrationPayload(payload: MigrationPayload): void {
  if (payload.version !== 1 || !Array.isArray(payload.records)) fail("validation", "unsupported migration version");
}

function initialize(database: DatabaseSync, accountId: string): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS virtue_accounts (
      account_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS virtue_records (
      account_id TEXT NOT NULL,
      id TEXT NOT NULL,
      date TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('good', 'fault')),
      description TEXT NOT NULL,
      reflection TEXT,
      corrections_json TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version > 0),
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (account_id, id),
      FOREIGN KEY (account_id) REFERENCES virtue_accounts(account_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS virtue_records_visible_date
      ON virtue_records(account_id, deleted_at, date, id);
    CREATE TABLE IF NOT EXISTS virtue_purged_records (
      account_id TEXT NOT NULL,
      id TEXT NOT NULL,
      purged_at TEXT NOT NULL,
      PRIMARY KEY (account_id, id),
      FOREIGN KEY (account_id) REFERENCES virtue_accounts(account_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS virtue_migration_batches (
      account_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      result_json TEXT NOT NULL,
      committed_at TEXT NOT NULL,
      PRIMARY KEY (account_id, batch_id),
      FOREIGN KEY (account_id) REFERENCES virtue_accounts(account_id) ON DELETE CASCADE
    );
  `);
  database.prepare("INSERT OR IGNORE INTO virtue_accounts(account_id, created_at) VALUES (?, ?)").run(accountId, new Date().toISOString());
}

export function createSqliteVirtueApi(options: SqliteVirtueApiOptions): VirtueApi {
  return createSqliteVirtueDatabase(options).api;
}

/** Export active records and the tombstone IDs needed to prevent backup resurrection. */
export function exportSqliteVirtueSnapshot(options: SqliteVirtueApiOptions): VirtueDataSnapshot {
  const holder = createSqliteVirtueDatabase(options);
  try {
    const records = holder.api.getRecords();
    const rows = holder.database.prepare("SELECT id FROM virtue_purged_records WHERE account_id=? ORDER BY id").all(options.accountId) as Array<{ id: string }>;
    return { version: 1, accountId: options.accountId, records, purgedIds: rows.map((row) => String(row.id)) };
  } finally { holder.close(); }
}

/**
 * Creates the resolver used by the HTTP boundary. One SQLite connection is
 * shared by the account-scoped adapters, while every adapter still scopes all
 * queries by accountId.
 */
export function createSqliteVirtueApiResolver(options: Omit<SqliteVirtueApiOptions, "accountId">): SqliteVirtueResolver {
  const ownsDatabase = !options.database;
  const database = options.database ?? new DatabaseSync(options.filename ?? ":memory:");
  const cache = new Map<string, VirtueApi>();
  return {
    database,
    resolveApi: (accountId) => {
      const existing = cache.get(accountId);
      if (existing) return existing;
      const api = createSqliteVirtueApi({ ...options, database, accountId });
      cache.set(accountId, api);
      return api;
    },
    close: () => { if (ownsDatabase) database.close(); },
  };
}

export function createSqliteVirtueDatabase(options: SqliteVirtueApiOptions): SqliteVirtueDatabase {
  if (!options.accountId.trim()) fail("unauthorized", "missing virtue account");
  const ownsDatabase = !options.database;
  const database = options.database ?? new DatabaseSync(options.filename ?? ":memory:");
  const now = options.now ?? (() => new Date());
  initialize(database, options.accountId);
  const accountId = options.accountId;
  const today = () => todayVirtueDate(now());

  const queryRows = (sql: string, ...params: any[]): Array<SqliteRow> => database.prepare(sql).all(...params) as Array<SqliteRow>;
  const findRow = (id: string, includeDeleted = false): { record: VirtueRecord; version: number; deletedAt: string | null } => {
    const row = database.prepare("SELECT * FROM virtue_records WHERE account_id = ? AND id = ?").get(accountId, id) as SqliteRow | undefined;
    if (!row) {
      const purged = database.prepare("SELECT 1 FROM virtue_purged_records WHERE account_id = ? AND id = ?").get(accountId, id);
      if (purged) fail("gone", "virtue record id cannot be reused");
      fail("not_found", "virtue record not found");
    }
    const item = parseRecord(row);
    if (!includeDeleted && item.deletedAt) fail("gone", "virtue record is in recovery");
    return item;
  };
  const visible = (): Array<{ record: VirtueRecord; version: number; deletedAt: string | null }> => queryRows(
    "SELECT * FROM virtue_records WHERE account_id = ? AND deleted_at IS NULL ORDER BY date ASC, id ASC", accountId,
  ).map(parseRecord);
  const withTransaction = <T>(work: () => T): T => {
    database.exec("BEGIN IMMEDIATE");
    try { const result = work(); database.exec("COMMIT"); return result; }
    catch (error) { try { database.exec("ROLLBACK"); } catch { /* preserve original error */ } throw error; }
  };
  const assertVersion = (version: number, expected?: number): void => {
    if (expected !== undefined && expected !== version) fail("conflict", "record changed on another device");
  };
  const insertRecord = (record: VirtueRecord, version: number, deletedAt: string | null = null): void => {
    const timestamp = now().toISOString();
    database.prepare(`INSERT INTO virtue_records
      (account_id, id, date, type, description, reflection, corrections_json, version, deleted_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(accountId, record.id, record.date, record.type, record.description, record.reflection, JSON.stringify(record.corrections), version, deletedAt, timestamp, timestamp);
  };
  const updateRecord = (record: VirtueRecord, version: number, deletedAt: string | null): void => {
    database.prepare(`UPDATE virtue_records SET date = ?, type = ?, description = ?, reflection = ?, corrections_json = ?, version = ?, deleted_at = ?, updated_at = ? WHERE account_id = ? AND id = ?`)
      .run(record.date, record.type, record.description, record.reflection, JSON.stringify(record.corrections), version, deletedAt, now().toISOString(), accountId, record.id);
  };
  const preview = (payload: MigrationPayload, batchId: string = crypto.randomUUID()): MigrationPreview => {
    normalizeMigrationPayload(payload);
    const errors: MigrationPreview["errors"] = [];
    let accepted = 0; let skipped = 0;
    const seen = new Set<string>();
    const imported: VirtueRecord[] = [];
    for (const candidate of payload.records) {
      if (!isVirtueRecord(candidate)) { errors.push({ message: "invalid record" }); continue; }
      const existing = database.prepare("SELECT 1 FROM virtue_records WHERE account_id = ? AND id = ?").get(accountId, candidate.id);
      const purged = database.prepare("SELECT 1 FROM virtue_purged_records WHERE account_id = ? AND id = ?").get(accountId, candidate.id);
      if (seen.has(candidate.id) || existing || purged) { skipped++; continue; }
      seen.add(candidate.id); accepted++; imported.push(cloneRecord(candidate));
    }
    return { batchId, accepted, skipped, errors, stats: stats([...visible().map((item) => item.record), ...imported]) };
  };

  const api: VirtueApi = {
    getRecords: () => visible().map((item) => versioned(item.record, item.version)),
    getByDate: (date) => { assertDate(date); return visible().filter((item) => item.record.date === date).map((item) => versioned(item.record, item.version)); },
    getByRange: (from, to) => { assertRange(from, to); return visible().filter((item) => item.record.date >= from && item.record.date <= to).map((item) => versioned(item.record, item.version)); },
    getHome: () => {
      const date = today(); const all = visible().map((item) => item.record);
      const todayRecords = visible().filter((item) => item.record.date === date).map((item) => versioned(item.record, item.version));
      const recentDates = [...new Set(all.map((record) => record.date))].sort().reverse().slice(0, 7);
      return { accountId, today: date, todayRecords, todayStats: stats(all, date, date), recentDates };
    },
    getStats: (from, to) => stats(visible().map((item) => item.record), from, to),
    add: (input) => withTransaction(() => {
      const existingRow = database.prepare("SELECT * FROM virtue_records WHERE account_id = ? AND id = ?").get(accountId, input.id) as SqliteRow | undefined;
      if (existingRow) {
        const existing = parseRecord(existingRow);
        if (!existing.deletedAt && existing.record.type === input.type && existing.record.description === input.description.trim() && existing.record.reflection === (input.reflection?.trim() || null)) return versioned(existing.record, existing.version);
        fail(existing.deletedAt ? "gone" : "conflict", existing.deletedAt ? "virtue record id cannot be reused" : "virtue record id already exists with different content");
      }
      const purged = database.prepare("SELECT 1 FROM virtue_purged_records WHERE account_id = ? AND id = ?").get(accountId, input.id);
      if (purged) fail("gone", "virtue record id cannot be reused");
      let record: VirtueRecord;
      try { record = createVirtueRecord({ ...input, date: today() }); } catch (error) { fail("validation", error instanceof Error ? error.message : "invalid record"); }
      insertRecord(record, 1); return versioned(record, 1);
    }),
    updateToday: (id, changes, expectedVersion) => withTransaction(() => {
      const item = findRow(id); assertVersion(item.version, expectedVersion);
      if (item.record.date !== today()) fail("forbidden", "historical records require a correction");
      let next: VirtueRecord;
      try {
        next = createVirtueRecord({ id, date: item.record.date, type: changes.type ?? item.record.type, description: changes.description ?? item.record.description, reflection: changes.reflection ?? item.record.reflection });
      } catch (error) { fail("validation", error instanceof Error ? error.message : "invalid record"); }
      next = { ...next, corrections: item.record.corrections.map((correction) => ({ ...correction, before: cloneFields(correction.before), after: cloneFields(correction.after) })) };
      updateRecord(next, item.version + 1, null); return versioned(next, item.version + 1);
    }),
    correctHistorical: (id, input, expectedVersion) => withTransaction(() => {
      const item = findRow(id); assertVersion(item.version, expectedVersion);
      if (item.record.date >= today()) fail("forbidden", "only historical records can be corrected");
      let next: VirtueRecord;
      try { next = appendVirtueCorrection(item.record, { ...input, correctedOn: today() });
      } catch (error) { fail("validation", error instanceof Error ? error.message : "invalid record"); }
      updateRecord(next, item.version + 1, null); return versioned(next, item.version + 1);
    }),
    deleteToday: (id, expectedVersion) => withTransaction(() => {
      const item = findRow(id); assertVersion(item.version, expectedVersion);
      if (item.record.date !== today()) fail("forbidden", "historical records cannot be deleted");
      updateRecord(item.record, item.version, now().toISOString());
    }),
    restore: (id) => withTransaction(() => {
      const item = findRow(id, true);
      if (!item.deletedAt) return versioned(item.record, item.version);
      if (dayDiff(item.deletedAt.slice(0, 10), today()) > RECOVERY_DAYS) fail("gone", "recovery period has ended");
      updateRecord(item.record, item.version + 1, null); return versioned(item.record, item.version + 1);
    }),
    permanentlyDelete: (id, confirmation) => withTransaction(() => {
      if (confirmation !== "\u6c38\u4e45\u5220\u9664") fail("validation", "type the permanent deletion confirmation");
      findRow(id, true);
      database.prepare("DELETE FROM virtue_records WHERE account_id = ? AND id = ?").run(accountId, id);
      database.prepare("INSERT OR IGNORE INTO virtue_purged_records(account_id, id, purged_at) VALUES (?, ?, ?)").run(accountId, id, now().toISOString());
    }),
    exportJSON: () => exportVirtueJson(visible().map((item) => ({ ...item.record, version: item.version } as VirtueRecord))),
    previewMigration: preview,
    commitMigration: (payload, batchId = crypto.randomUUID()) => withTransaction(() => {
      const prior = database.prepare("SELECT result_json FROM virtue_migration_batches WHERE account_id = ? AND batch_id = ?").get(accountId, batchId) as SqliteRow | undefined;
      if (prior) return JSON.parse(String(prior.result_json)) as MigrationPreview;
      const result = preview(payload, batchId);
      if (result.errors.length) fail("validation", "migration contains invalid records");
      for (const record of payload.records) {
        const exists = database.prepare("SELECT 1 FROM virtue_records WHERE account_id = ? AND id = ?").get(accountId, record.id);
        const purged = database.prepare("SELECT 1 FROM virtue_purged_records WHERE account_id = ? AND id = ?").get(accountId, record.id);
        if (isVirtueRecord(record) && !exists && !purged) insertRecord(cloneRecord(record), 1);
      }
      database.prepare("INSERT INTO virtue_migration_batches(account_id, batch_id, result_json, committed_at) VALUES (?, ?, ?, ?)").run(accountId, batchId, JSON.stringify(result), now().toISOString());
      return result;
    }),
  };

  return {
    database,
    api,
    close: () => { if (ownsDatabase) database.close(); },
  };
}
