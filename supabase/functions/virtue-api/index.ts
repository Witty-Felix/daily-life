import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RecordBody = { id?: string; type?: "good" | "fault"; description?: string; reflection?: string | null; expectedVersion?: number; note?: string | null; confirmation?: string };
type VirtueRecord = { id: string; date: string; type: "good" | "fault"; description: string; reflection: string | null; corrections: unknown[] };
const corsHeaders = { "access-control-allow-origin": Deno.env.get("VIRTUE_WEB_ORIGIN") ?? "*", "access-control-allow-headers": "authorization, content-type, if-match, x-reauth-proof", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json", "cache-control": "no-store" } });
const error = (code: string, message: string, status: number) => json({ error: { code, message } }, status);
const empty = (status = 204) => new Response(null, { status, headers: corsHeaders });
const today = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
const localDate = (instant: string, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(instant));
const dateAge = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
const sha256 = async (value: string) => { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join(""); };
const randomProof = () => `${crypto.randomUUID()}-${crypto.randomUUID()}`;
const validDate = (value: unknown): value is string => { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const date = new Date(`${value}T00:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; };
const normalize = (body: RecordBody, date: string, corrections: unknown[] = []): VirtueRecord => {
  if (!body.id?.trim() || (body.type !== "good" && body.type !== "fault") || !body.description?.trim() || !validDate(date)) throw new Error("invalid record");
  return { id: body.id.trim(), date, type: body.type, description: body.description.trim(), reflection: body.reflection?.trim() || null, corrections };
};
const normalizeImported = (candidate: unknown): VirtueRecord => {
  if (!candidate || typeof candidate !== "object") throw new Error("invalid record");
  const value = candidate as RecordBody & { date?: unknown; corrections?: unknown };
  if (!Array.isArray(value.corrections)) throw new Error("invalid correction chain");
  return normalize(value, typeof value.date === "string" ? value.date : "", value.corrections);
};
const stats = (rows: Array<{ type: string; date: string }>, from?: string, to?: string) => { const selected = rows.filter((r) => (!from || r.date >= from) && (!to || r.date <= to)); const goodCount = selected.filter((r) => r.type === "good").length; const faultCount = selected.filter((r) => r.type === "fault").length; return { total: selected.length, goodCount, faultCount, netScore: goodCount + faultCount * -2 }; };

Deno.serve(async (request) => {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return empty(204);
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return error("unauthorized", "请先登录功过格账户", 401);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const admin = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ? createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!) : null;
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return error("unauthorized", "登录状态已失效，请重新登录", 401);
  const accountId = user.id;
  const accountResult = await supabase.from("virtue_accounts").select("time_zone").eq("account_id", accountId).maybeSingle();
  if (accountResult.error) return error("unavailable", "功过格账户配置读取失败", 503);
  let timeZone = accountResult.data?.time_zone ?? "UTC";
  try { new Intl.DateTimeFormat("en-CA", { timeZone }).format(); } catch { timeZone = "UTC"; }
  if (!accountResult.data) {
    const created = await supabase.from("virtue_accounts").insert({ account_id: accountId, time_zone: timeZone });
    if (created.error && created.error.code !== "23505") return error("unavailable", "功过格账户配置初始化失败", 503);
  }
  const path = url.pathname.replace(/^\/functions\/v1\/virtue-api/, "").replace(/^\/api\/virtue/, "");
  const method = request.method;
  const recordId = path.match(/^\/records\/([^/]+)$/)?.[1];
  const correctionId = path.match(/^\/records\/([^/]+)\/corrections$/)?.[1];
  const restoreId = path.match(/^\/records\/([^/]+)\/restore$/)?.[1];
  const permanentId = path.match(/^\/records\/([^/]+)\/permanent$/)?.[1];
  const parseBody = async () => await request.json() as RecordBody & { records?: unknown[]; version?: number; batchId?: string };
  const consumeReauth = async () => {
    const proof = request.headers.get("x-reauth-proof") ?? "";
    if (!proof) return false;
    const result = await supabase.from("virtue_auth_reauth").select("proof_hash,expires_at").eq("account_id", accountId).eq("proof_hash", await sha256(proof)).maybeSingle();
    if (result.error || !result.data || new Date(result.data.expires_at).getTime() <= Date.now()) return false;
    const removed = await supabase.from("virtue_auth_reauth").delete().eq("account_id", accountId).eq("proof_hash", result.data.proof_hash);
    return !removed.error;
  };
  const read = async (date?: string, from?: string, to?: string) => { let query = supabase.from("virtue_records").select("id,date,type,description,reflection,corrections,version").eq("account_id", accountId).is("deleted_at", null); if (date) query = query.eq("date", date); if (from) query = query.gte("date", from); if (to) query = query.lte("date", to); const result = await query.order("date").order("id"); if (result.error) throw result.error; return result.data ?? []; };
  try {
    if (method === "POST" && path === "/auth/reauthenticate") {
      const proof = randomProof();
      const saved = await supabase.from("virtue_auth_reauth").insert({ account_id: accountId, proof_hash: await sha256(proof), expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() });
      if (saved.error) throw saved.error;
      return json({ proof, expiresInSeconds: 300 });
    }
    if (method === "POST" && path === "/auth/recovery/rotate") {
      if (!(await consumeReauth())) return error("forbidden", "请先重新验证身份", 403);
      return error("unavailable", "Supabase 云端恢复码轮换尚未配置", 503);
    }
    if (method === "DELETE" && path === "/auth/account") {
      if ((await request.json() as { confirmation?: string }).confirmation !== "永久删除账户") return error("validation", "请输入永久删除账户确认", 400);
      if (!(await consumeReauth())) return error("forbidden", "请先重新验证身份", 403);
      if (!admin) return error("unavailable", "账户删除需要配置服务端密钥", 503);
      const deleted = await admin.auth.admin.deleteUser(accountId);
      if (deleted.error) throw deleted.error;
      return empty(204);
    }
    if (method === "GET" && path === "/records") { const date = url.searchParams.get("date") ?? undefined; const from = url.searchParams.get("from") ?? undefined; const to = url.searchParams.get("to") ?? undefined; if ((date && !validDate(date)) || (from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) return error("validation", "日期范围无效", 400); return json(await read(date, from, to)); }
    if (method === "GET" && path === "/home") { const records = await read(); const date = today(timeZone); return json({ accountId, today: date, todayRecords: records.filter((r) => r.date === date), todayStats: stats(records, date, date), recentDates: [...new Set(records.map((r) => r.date))].sort().reverse().slice(0, 7) }); }
    if (method === "GET" && path === "/stats") { const records = await read(); const from = url.searchParams.get("from") ?? undefined; const to = url.searchParams.get("to") ?? undefined; if ((from && !validDate(from)) || (to && !validDate(to))) return error("validation", "日期无效", 400); return json(stats(records, from, to)); }
    if (method === "GET" && path === "/export") { const records = await read(); const purged = await supabase.from("virtue_purged_records").select("id").eq("account_id", accountId).order("id"); if (purged.error) throw purged.error; return json({ version: 1, accountId, records, purgedIds: (purged.data ?? []).map((row) => row.id) }); }
    if (method === "POST" && path === "/records") { const body = await parseBody(); const record = normalize(body, today(timeZone)); const existing = await supabase.from("virtue_records").select("id,date,type,description,reflection,corrections,version,deleted_at").eq("account_id", accountId).eq("id", record.id).maybeSingle(); if (existing.error) throw existing.error; if (existing.data) { const same = existing.data.type === record.type && existing.data.description === record.description && (existing.data.reflection ?? null) === record.reflection; return same && !existing.data.deleted_at ? json({ ...existing.data }, 200) : error("conflict", "功过记录标识已存在且内容不同", 409); } const inserted = await supabase.from("virtue_records").insert({ account_id: accountId, ...record }).select("id,date,type,description,reflection,corrections,version").single(); if (inserted.error) throw inserted.error; return json(inserted.data, 201); }
    if (method === "POST" && recordId) { const body = await parseBody(); const current = await supabase.from("virtue_records").select("*").eq("account_id", accountId).eq("id", decodeURIComponent(recordId)).maybeSingle(); if (current.error) throw current.error; if (!current.data) return error("not_found", "功过记录不存在", 404); if (body.expectedVersion !== undefined && body.expectedVersion !== current.data.version) return error("conflict", "记录已被其他设备修改，请刷新后重试", 409); if (current.data.date !== today(timeZone)) return error("forbidden", "过往功过记录不能直接编辑，请追加修正", 403); if (body.type !== undefined && body.type !== "good" && body.type !== "fault") return error("validation", "记录类型无效", 400); if (body.description !== undefined && !body.description.trim()) return error("validation", "行为描述不能为空", 400); const update = { type: body.type ?? current.data.type, description: body.description?.trim() ?? current.data.description, reflection: body.reflection === undefined ? current.data.reflection : body.reflection?.trim() || null, version: current.data.version + 1, updated_at: new Date().toISOString() }; const changed = await supabase.from("virtue_records").update(update).eq("account_id", accountId).eq("id", current.data.id).eq("version", current.data.version).select("id,date,type,description,reflection,corrections,version").single(); if (changed.error) return error("conflict", "记录已被其他设备修改，请刷新后重试", 409); return json(changed.data); }
    if (method === "POST" && correctionId) { const body = await parseBody(); const current = await supabase.from("virtue_records").select("*").eq("account_id", accountId).eq("id", decodeURIComponent(correctionId)).maybeSingle(); if (current.error) throw current.error; if (!current.data) return error("not_found", "功过记录不存在", 404); if (current.data.date >= today(timeZone)) return error("forbidden", "只能对过往功过记录追加修正", 403); if (body.expectedVersion !== undefined && body.expectedVersion !== current.data.version) return error("conflict", "记录已被其他设备修改，请刷新后重试", 409); const before = { type: current.data.type, description: current.data.description, reflection: current.data.reflection }; const after = { type: body.type ?? before.type, description: body.description?.trim() ?? before.description, reflection: body.reflection === undefined ? before.reflection : body.reflection?.trim() || null }; if ((after.type !== "good" && after.type !== "fault") || !after.description) return error("validation", "修正数据无效", 400); const corrections = [...(current.data.corrections ?? []), { id: crypto.randomUUID(), correctedOn: today(timeZone), before, after, note: body.note?.trim() || null }]; const changed = await supabase.from("virtue_records").update({ type: after.type, description: after.description, reflection: after.reflection, corrections, version: current.data.version + 1, updated_at: new Date().toISOString() }).eq("account_id", accountId).eq("id", current.data.id).eq("version", current.data.version).select("id,date,type,description,reflection,corrections,version").single(); if (changed.error) return error("conflict", "记录已被其他设备修改，请刷新后重试", 409); return json(changed.data); }
    if (method === "DELETE" && recordId) { const current = await supabase.from("virtue_records").select("date,version").eq("account_id", accountId).eq("id", decodeURIComponent(recordId)).maybeSingle(); if (current.error) throw current.error; if (!current.data) return error("not_found", "功过记录不存在", 404); if (current.data.date !== today(timeZone)) return error("forbidden", "过往功过记录不能删除", 403); const expected = Number(request.headers.get("if-match")); if (Number.isFinite(expected) && expected !== current.data.version) return error("conflict", "记录已被其他设备修改，请刷新后重试", 409); const removed = await supabase.from("virtue_records").update({ deleted_at: new Date().toISOString(), version: current.data.version + 1, updated_at: new Date().toISOString() }).eq("account_id", accountId).eq("id", decodeURIComponent(recordId)).eq("version", current.data.version); if (removed.error) return error("conflict", "记录已被其他设备修改，请刷新后重试", 409); return empty(204); }
    if (method === "POST" && restoreId) { const current = await supabase.from("virtue_records").select("*").eq("account_id", accountId).eq("id", decodeURIComponent(restoreId)).maybeSingle(); if (current.error) throw current.error; if (!current.data) return error("not_found", "功过记录不存在", 404); if (!current.data.deleted_at) return json(current.data); if (dateAge(localDate(String(current.data.deleted_at), timeZone), today(timeZone)) > 30) return error("gone", "回收期已结束", 410); const restored = await supabase.from("virtue_records").update({ deleted_at: null, version: current.data.version + 1, updated_at: new Date().toISOString() }).eq("account_id", accountId).eq("id", decodeURIComponent(restoreId)).eq("version", current.data.version).select("id,date,type,description,reflection,corrections,version").single(); if (restored.error) return error("conflict", "记录已被其他设备修改，请刷新后重试", 409); return json(restored.data); }
    if (method === "POST" && permanentId) { const body = await parseBody(); if ((body as { confirmation?: string }).confirmation !== "永久删除") return error("validation", "请输入永久删除确认", 400); if (!(await consumeReauth())) return error("forbidden", "请先重新验证身份", 403); const current = await supabase.from("virtue_records").select("id").eq("account_id", accountId).eq("id", decodeURIComponent(permanentId)).maybeSingle(); if (current.error) throw current.error; if (!current.data) return error("not_found", "功过记录不存在", 404); const purged = await supabase.from("virtue_purged_records").upsert({ account_id: accountId, id: decodeURIComponent(permanentId) }); if (purged.error) throw purged.error; const removed = await supabase.from("virtue_records").delete().eq("account_id", accountId).eq("id", decodeURIComponent(permanentId)); if (removed.error) throw removed.error; return empty(204); }
    if (method === "POST" && (path === "/migrations/preview" || path === "/migrations")) {
      const body = await parseBody();
      if (body.version !== 1 || !Array.isArray(body.records)) return error("validation", "迁移文件版本不支持", 400);
      const batchId = typeof body.batchId === "string" && body.batchId ? body.batchId : crypto.randomUUID();
      if (path === "/migrations") { const prior = await supabase.from("virtue_migration_batches").select("result").eq("account_id", accountId).eq("batch_id", batchId).maybeSingle(); if (prior.error) throw prior.error; if (prior.data) return json(prior.data.result); }
      const existing = await supabase.from("virtue_records").select("id").eq("account_id", accountId); if (existing.error) throw existing.error;
      const purged = await supabase.from("virtue_purged_records").select("id").eq("account_id", accountId); if (purged.error) throw purged.error;
      const occupied = new Set([...(existing.data ?? []).map((r) => r.id), ...(purged.data ?? []).map((r) => r.id)]); const seen = new Set<string>(); const errors: Array<{ id?: string; message: string }> = []; const accepted: VirtueRecord[] = []; let skipped = 0;
      for (const candidate of body.records) { try { const record = normalizeImported(candidate); if (seen.has(record.id) || occupied.has(record.id)) { skipped++; continue; } seen.add(record.id); accepted.push(record); } catch { errors.push({ message: "记录数据无效" }); } }
      const current = await read(); const result = { batchId, accepted: accepted.length, skipped, errors, stats: stats([...current, ...accepted]) };
      if (path === "/migrations") { if (errors.length) return error("validation", "迁移文件包含无效记录", 400); const inserted = await supabase.from("virtue_records").insert(accepted.map((record) => ({ account_id: accountId, ...record }))); if (inserted.error) throw inserted.error; const saved = await supabase.from("virtue_migration_batches").insert({ account_id: accountId, batch_id: batchId, result }); if (saved.error) throw saved.error; }
      return json(result);
    }
    return error("not_found", "接口不存在", 404);
  } catch { return error("unavailable", "功过格服务暂时不可用", 503); }
});
