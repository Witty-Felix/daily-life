import {
  appendVirtueCorrection,
  createVirtueRecord,
  getEffectiveVirtueFields,
  getEffectiveVirtueRecord,
  getVirtueRecordScore,
  isVirtueRecord,
  localDateKey,
  todayVirtueDate,
  type CreateVirtueRecordInput,
  type UpdateVirtueRecordInput,
  type VirtueDate,
  type VirtueRecord,
  type VirtueCorrectionInput,
} from "../domain/virtue";

export const VIRTUE_STORAGE_KEY = "virtue-grid.v1";
export const STORAGE_KEY = VIRTUE_STORAGE_KEY;

type PersistedVirtueData = {
  records: VirtueRecord[];
};

export type VirtueStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type AddVirtueRecordInput = Omit<CreateVirtueRecordInput, "date">;
export type HistoricalVirtueCorrectionInput = Omit<VirtueCorrectionInput, "correctedOn">;

const emptyData = (): PersistedVirtueData => ({ records: [] });

function load(storage: VirtueStorageLike): PersistedVirtueData {
  try {
    const raw = storage.getItem(VIRTUE_STORAGE_KEY);
    if (!raw) return emptyData();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyData();
    const records = (parsed as Partial<PersistedVirtueData>).records;
    return { records: Array.isArray(records) ? deduplicate(records.filter(isVirtueRecord)) : [] };
  } catch {
    return emptyData();
  }
}

function deduplicate(records: VirtueRecord[]): VirtueRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (seen.has(record.id)) return false;
    seen.add(record.id);
    return true;
  });
}

function save(storage: VirtueStorageLike, data: PersistedVirtueData): void {
  storage.setItem(VIRTUE_STORAGE_KEY, JSON.stringify(data));
}

function cloneRecord(record: VirtueRecord): VirtueRecord {
  return {
    ...record,
    corrections: record.corrections.map((correction) => ({
      ...correction,
      before: { ...correction.before },
      after: { ...correction.after },
    })),
  };
}

export function exportVirtueJson(records: readonly VirtueRecord[]): string {
  return JSON.stringify({ version: 1, records }, null, 2);
}

export const serializeVirtueJson = exportVirtueJson;

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function exportVirtueCsv(records: readonly VirtueRecord[]): string {
  const headers = ["id", "date", "type", "score", "description", "reflection", "correctionCount", "originalType", "originalDescription", "originalReflection", "corrections"];
  const rows = records.map((record) => {
    const effective = getEffectiveVirtueFields(record);
    return [
      record.id,
      record.date,
      effective.type,
      getVirtueRecordScore(record),
      effective.description,
      effective.reflection,
      record.corrections.length,
      record.type,
      record.description,
      record.reflection,
      JSON.stringify(record.corrections),
    ].map(csvCell).join(",");
  });
  return `\uFEFF${headers.join(",")}\r\n${rows.join("\r\n")}${rows.length ? "\r\n" : ""}`;
}

export const serializeVirtueCsv = exportVirtueCsv;

export function createLocalVirtueStore(storage: VirtueStorageLike, now: () => Date = () => new Date()) {
  const read = (): VirtueRecord[] => load(storage).records;
  const today = (): VirtueDate => todayVirtueDate(now());

  const findRecord = (records: readonly VirtueRecord[], id: string): VirtueRecord => {
    const record = records.find((item) => item.id === id);
    if (!record) throw new Error("功过记录不存在");
    return record;
  };

  return {
    getRecords(): VirtueRecord[] {
      return read().map(cloneRecord);
    },

    getByDate(date: VirtueDate): VirtueRecord[] {
      return read().filter((record) => record.date === date).map(cloneRecord);
    },

    add(input: AddVirtueRecordInput): VirtueRecord {
      const records = read();
      if (records.some((record) => record.id === input.id)) throw new Error("功过记录标识已存在");
      const record = createVirtueRecord({ ...input, date: today() });
      save(storage, { records: [...records, record] });
      return cloneRecord(record);
    },

    save(record: VirtueRecord): void {
      if (!isVirtueRecord(record)) throw new Error("功过记录数据无效");
      const records = read();
      if (records.some((item) => item.id === record.id)) {
        save(storage, { records: records.map((item) => item.id === record.id ? cloneRecord(record) : item) });
      } else {
        save(storage, { records: [...records, cloneRecord(record)] });
      }
    },

    getEffectiveRecords(): VirtueRecord[] {
      return read().map(getEffectiveVirtueRecord).map(cloneRecord);
    },

    getEffectiveByDate(date: VirtueDate): VirtueRecord[] {
      return read().filter((record) => record.date === date).map(getEffectiveVirtueRecord).map(cloneRecord);
    },

    updateToday(id: string, changes: UpdateVirtueRecordInput): VirtueRecord {
      const records = read();
      const record = findRecord(records, id);
      if (record.date !== today()) throw new Error("过往功过记录不能直接编辑，请追加修正");
      const updated = { ...record, ...changes };
      const next = {
        ...record,
        type: updated.type,
        description: updated.description.trim(),
        reflection: updated.reflection == null || updated.reflection.trim() === "" ? null : updated.reflection.trim(),
      };
      if (!isVirtueRecord(next)) throw new Error("功过记录数据无效");
      save(storage, { records: records.map((item) => item.id === id ? next : item) });
      return cloneRecord(next);
    },

    deleteToday(id: string): void {
      const records = read();
      const record = findRecord(records, id);
      if (record.date !== today()) throw new Error("过往功过记录不能删除");
      save(storage, { records: records.filter((item) => item.id !== id) });
    },

    correctHistorical(id: string, input: HistoricalVirtueCorrectionInput): VirtueRecord {
      const records = read();
      const record = findRecord(records, id);
      if (record.date >= today()) throw new Error("只能对过往功过记录追加修正");
      const corrected = appendVirtueCorrection(record, { ...input, correctedOn: today() });
      save(storage, { records: records.map((item) => item.id === id ? corrected : item) });
      return cloneRecord(corrected);
    },

    clear(): void {
      storage.removeItem(VIRTUE_STORAGE_KEY);
    },

    exportJSON(): string {
      return exportVirtueJson(read());
    },

    exportCSV(): string {
      return exportVirtueCsv(read());
    },
  };
}

export type LocalVirtueStore = ReturnType<typeof createLocalVirtueStore>;

export function getVirtueRecordDate(record: VirtueRecord): VirtueDate {
  return record.date;
}

export function isVirtueRecordFromDate(record: VirtueRecord, date: Date): boolean {
  return record.date === localDateKey(date);
}
