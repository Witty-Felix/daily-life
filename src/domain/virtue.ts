export type VirtueType = "good" | "fault";
export type VirtueRecordType = VirtueType;
export type VirtueDate = string;

export const VIRTUE_POINTS: Readonly<Record<VirtueType, number>> = {
  good: 1,
  fault: -2,
};

export type VirtueFields = {
  type: VirtueType;
  description: string;
  reflection: string | null;
};

export type VirtueCorrection = {
  id: string;
  correctedOn: VirtueDate;
  before: VirtueFields;
  after: VirtueFields;
  note: string | null;
};

export type VirtueRecord = VirtueFields & {
  id: string;
  date: VirtueDate;
  corrections: VirtueCorrection[];
};

export type CreateVirtueRecordInput = {
  id: string;
  date: VirtueDate;
  type: VirtueType;
  description: string;
  reflection?: string | null;
};

export type UpdateVirtueRecordInput = Partial<Pick<VirtueFields, "type" | "description" | "reflection">>;

export type VirtueCorrectionInput = UpdateVirtueRecordInput & {
  id?: string;
  correctedOn: VirtueDate;
  note?: string | null;
};

export type VirtueStats = {
  date?: VirtueDate;
  total: number;
  goodCount: number;
  faultCount: number;
  netScore: number;
};

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeRequiredText(value: string, fieldName: string): string {
  if (!hasText(value)) throw new Error(`${fieldName}不能为空`);
  return value.trim();
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value == null || value.trim() === "") return null;
  return value.trim();
}

export function isVirtueType(value: unknown): value is VirtueType {
  return value === "good" || value === "fault";
}

export function isVirtueDate(value: unknown): value is VirtueDate {
  if (typeof value !== "string" || !DATE_KEY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function localDateKey(date: Date): VirtueDate {
  if (Number.isNaN(date.getTime())) throw new RangeError("日期无效");
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayVirtueDate(now: Date = new Date()): VirtueDate {
  return localDateKey(now);
}

export function getVirtueScore(type: VirtueType): number {
  if (!isVirtueType(type)) throw new Error("功过记录类型无效");
  return VIRTUE_POINTS[type];
}

export const scoreVirtueType = getVirtueScore;

function normalizeFields(input: { type: VirtueType; description: string; reflection?: string | null }): VirtueFields {
  if (!isVirtueType(input.type)) throw new Error("功过记录类型无效");
  return {
    type: input.type,
    description: normalizeRequiredText(input.description, "行为描述"),
    reflection: normalizeOptionalText(input.reflection),
  };
}

export function createVirtueRecord(input: CreateVirtueRecordInput): VirtueRecord {
  if (!hasText(input.id)) throw new Error("功过记录标识不能为空");
  if (!isVirtueDate(input.date)) throw new Error("功过记录日期必须是有效的 YYYY-MM-DD 自然日");
  return {
    id: input.id.trim(),
    date: input.date,
    ...normalizeFields(input),
    corrections: [],
  };
}

function isVirtueFields(value: unknown): value is VirtueFields {
  if (!value || typeof value !== "object") return false;
  const fields = value as Partial<VirtueFields>;
  return isVirtueType(fields.type) && hasText(fields.description) && (fields.reflection === null || typeof fields.reflection === "string");
}

function isVirtueCorrection(value: unknown): value is VirtueCorrection {
  if (!value || typeof value !== "object") return false;
  const correction = value as Partial<VirtueCorrection>;
  return (
    hasText(correction.id) &&
    isVirtueDate(correction.correctedOn) &&
    isVirtueFields(correction.before) &&
    isVirtueFields(correction.after) &&
    (correction.note === null || typeof correction.note === "string")
  );
}

export function isVirtueRecord(value: unknown): value is VirtueRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<VirtueRecord>;
  const corrections: unknown = record.corrections;
  const fieldsValid = isVirtueType(record.type) && hasText(record.description) && (record.reflection === null || typeof record.reflection === "string");
  return (
    hasText(record.id) &&
    isVirtueDate(record.date) &&
    fieldsValid &&
    Array.isArray(corrections) &&
    corrections.every(isVirtueCorrection)
  );
}

export function getEffectiveVirtueFields(record: VirtueRecord): VirtueFields {
  const lastCorrection = record.corrections[record.corrections.length - 1];
  return lastCorrection ? { ...lastCorrection.after } : {
    type: record.type,
    description: record.description,
    reflection: record.reflection,
  };
}

export function getEffectiveVirtueRecord(record: VirtueRecord): VirtueRecord {
  return { ...record, ...getEffectiveVirtueFields(record), corrections: record.corrections.map((correction) => ({ ...correction, before: { ...correction.before }, after: { ...correction.after } })) };
}

export function getVirtueRecordScore(record: VirtueRecord): number {
  return getVirtueScore(getEffectiveVirtueFields(record).type);
}

export function updateVirtueRecord(record: VirtueRecord, changes: UpdateVirtueRecordInput): VirtueRecord {
  const current = getEffectiveVirtueFields(record);
  const next = normalizeFields({
    type: changes.type ?? current.type,
    description: changes.description ?? current.description,
    reflection: changes.reflection === undefined ? current.reflection : changes.reflection,
  });
  return { ...record, ...next };
}

export function appendVirtueCorrection(record: VirtueRecord, input: VirtueCorrectionInput): VirtueRecord {
  if (!isVirtueDate(input.correctedOn)) throw new Error("修正日期必须是有效的 YYYY-MM-DD 自然日");
  if (input.correctedOn <= record.date) throw new Error("只能对过往功过记录追加修正");
  const before = getEffectiveVirtueFields(record);
  const after = normalizeFields({
    type: input.type ?? before.type,
    description: input.description ?? before.description,
    reflection: input.reflection === undefined ? before.reflection : input.reflection,
  });
  const correction: VirtueCorrection = {
    id: hasText(input.id) ? input.id.trim() : `${record.id}-correction-${record.corrections.length + 1}`,
    correctedOn: input.correctedOn,
    before,
    after,
    note: normalizeOptionalText(input.note),
  };
  return { ...record, corrections: [...record.corrections, correction] };
}

export const applyVirtueCorrection = appendVirtueCorrection;

export function getVirtueRecordsForDate(records: readonly VirtueRecord[], date: VirtueDate): VirtueRecord[] {
  if (!isVirtueDate(date)) throw new Error("查询日期必须是有效的 YYYY-MM-DD 自然日");
  return records.filter((record) => record.date === date).map(getEffectiveVirtueRecord);
}

export function getVirtueStats(records: readonly VirtueRecord[], date?: VirtueDate): VirtueStats {
  if (date !== undefined && !isVirtueDate(date)) throw new Error("统计日期必须是有效的 YYYY-MM-DD 自然日");
  const selected = date === undefined ? records : records.filter((record) => record.date === date);
  let goodCount = 0;
  let faultCount = 0;
  for (const record of selected) {
    if (getEffectiveVirtueFields(record).type === "good") goodCount += 1;
    else faultCount += 1;
  }
  return {
    ...(date === undefined ? {} : { date }),
    total: goodCount + faultCount,
    goodCount,
    faultCount,
    netScore: goodCount * VIRTUE_POINTS.good + faultCount * VIRTUE_POINTS.fault,
  };
}

export const getVirtueDayStats = getVirtueStats;




