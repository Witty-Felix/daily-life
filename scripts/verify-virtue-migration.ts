import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { getEffectiveVirtueRecord, getVirtueStats, type VirtueRecord } from "../src/domain/virtue";

type Snapshot = { version: 1; records: VirtueRecord[]; purgedIds?: string[]; accountId?: string };
const input = process.argv[2]; const output = process.argv[3];
if (!input || !output) { console.error("Usage: tsx scripts/verify-virtue-migration.ts <source.json> <target.json>"); process.exit(1); }
const load = (file: string): Snapshot => { const value = JSON.parse(readFileSync(file, "utf8")) as Snapshot; if (value.version !== 1 || !Array.isArray(value.records)) throw new Error(`invalid snapshot: ${file}`); return value; };
const canonicalRecord = (record: VirtueRecord) => JSON.stringify({ id: record.id, date: record.date, current: getEffectiveVirtueRecord(record), corrections: record.corrections });
const digest = (record: VirtueRecord) => createHash("sha256").update(canonicalRecord(record)).digest("hex");
const normalize = (snapshot: Snapshot) => ({
  ids: snapshot.records.map((record) => record.id).sort(),
  digests: snapshot.records.map(digest).sort(),
  stats: getVirtueStats(snapshot.records.map(getEffectiveVirtueRecord)),
  dates: [...new Set(snapshot.records.map((record) => record.date))].sort(),
  purgedIds: [...(snapshot.purgedIds ?? [])].sort(),
});
const source = normalize(load(input)); const target = normalize(load(output));
const checks: Array<[string, boolean]> = [
  ["record IDs", JSON.stringify(source.ids) === JSON.stringify(target.ids)],
  ["record content and corrections", JSON.stringify(source.digests) === JSON.stringify(target.digests)],
  ["statistics", JSON.stringify(source.stats) === JSON.stringify(target.stats)],
  ["date range", JSON.stringify(source.dates) === JSON.stringify(target.dates)],
  ["permanent deletion list", JSON.stringify(source.purgedIds) === JSON.stringify(target.purgedIds)],
];
for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
if (checks.some(([, passed]) => !passed)) process.exit(2);
console.log("Migration verification passed.");
