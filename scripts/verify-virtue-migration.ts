import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { VirtueDataSnapshot } from "../src/api/sqliteVirtueApi";
import { getEffectiveVirtueRecord, getVirtueStats, type VirtueRecord } from "../src/domain/virtue";

type SnapshotLike = { version: 1; accountId?: string; records: VirtueRecord[]; purgedIds?: string[] };
const sourcePath = process.argv[2];
const targetPath = process.argv[3];
if (!sourcePath || !targetPath) { console.error("Usage: tsx scripts/verify-virtue-migration.ts <source.json> <target.json>"); process.exit(1); }
const load = (path: string): SnapshotLike => JSON.parse(readFileSync(path, "utf8")) as SnapshotLike;
const digest = (record: VirtueRecord): string => createHash("sha256").update(JSON.stringify({ ...getEffectiveVirtueRecord(record), corrections: record.corrections })).digest("hex");
const normalize = (snapshot: SnapshotLike) => ({
  recordIds: snapshot.records.map((record) => record.id).sort(),
  recordDigests: snapshot.records.map(digest).sort(),
  stats: getVirtueStats(snapshot.records.map(getEffectiveVirtueRecord)),
  dates: [...new Set(snapshot.records.map((record) => record.date))].sort(),
  correctionCount: snapshot.records.reduce((sum, record) => sum + record.corrections.length, 0),
  purgedIds: [...(snapshot.purgedIds ?? [])].sort(),
});
const source = normalize(load(sourcePath));
const target = normalize(load(targetPath));
const checks = [
  ["record IDs", JSON.stringify(source.recordIds) === JSON.stringify(target.recordIds)],
  ["record content and correction chains", JSON.stringify(source.recordDigests) === JSON.stringify(target.recordDigests)],
  ["statistics", JSON.stringify(source.stats) === JSON.stringify(target.stats)],
  ["date range", JSON.stringify(source.dates) === JSON.stringify(target.dates)],
  ["correction count", source.correctionCount === target.correctionCount],
  ["permanent deletion list", JSON.stringify(source.purgedIds) === JSON.stringify(target.purgedIds)],
] as const;
for (const [label, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
if (checks.some(([, passed]) => !passed)) process.exit(2);
console.log("Migration verification passed.");
