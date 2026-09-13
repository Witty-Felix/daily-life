import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { VirtueApi, MigrationPayload } from "../api/virtueApi";
import { VirtueApiError } from "../api/virtueApi";
import type { VirtueDate } from "../domain/virtue";
import type { VirtueAuthService } from "./virtueAuth";

export type VirtueApiResolver = (accountId: string) => VirtueApi;
export type VirtueServerOptions = {
  resolveAccountId?: (authorization: string | undefined) => string | null;
  resolveApi: VirtueApiResolver;
  auth?: VirtueAuthService;
  maxBodyBytes?: number;
};

function json(res: ServerResponse, status: number, body?: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(body === undefined ? undefined : JSON.stringify(body));
}
function errorStatus(error: VirtueApiError): number {
  return ({ unauthorized: 401, forbidden: 403, validation: 400, not_found: 404, conflict: 409, gone: 410, unavailable: 503 } as const)[error.code];
}
function parseId(pathname: string, suffix: string): string | null {
  if (!pathname.startsWith("/api/virtue/records/") || !pathname.endsWith(suffix)) return null;
  const raw = pathname.slice("/api/virtue/records/".length, pathname.length - suffix.length).replace(/\/$/, "");
  return raw ? decodeURIComponent(raw) : null;
}
async function body(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.length; if (size > maxBytes) throw new VirtueApiError("validation", "请求体过大"); chunks.push(buffer); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new VirtueApiError("validation", "请求体不是有效 JSON"); }
}
function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new VirtueApiError("validation", "请求体格式无效");
  return value as Record<string, unknown>;
}

export function createVirtueRequestHandler(options: VirtueServerOptions) {
  const resolveAccountId = options.resolveAccountId ?? ((authorization) => {
    if (!authorization?.startsWith("Bearer ")) return null;
    const token = authorization.slice(7).trim();
    if (!token) return null;
    if (options.auth) return options.auth.authenticateBearer(token)?.accountId ?? null;
    return token;
  });
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const method = req.method ?? "GET";
      if (options.auth && method === "POST" && url.pathname === "/api/virtue/auth/recovery/login") {
        const input = asObject(await body(req, maxBodyBytes));
        const accountId = typeof input.accountId === "string" ? input.accountId : "";
        const code = typeof input.code === "string" ? input.code : "";
        const deviceName = typeof input.deviceName === "string" ? input.deviceName : undefined;
        const login = options.auth.authenticateRecovery(accountId, code, deviceName);
        json(res, 200, login); return;
      }
      if (options.auth && method === "POST" && url.pathname === "/api/virtue/auth/passkeys/login") { const input = asObject(await body(req, maxBodyBytes)); const login = await options.auth.finishPasskeyLogin(String(input.accountId ?? ""), input as never, typeof input.deviceName === "string" ? input.deviceName : undefined); json(res, 200, login); return; }
                  const accountId = resolveAccountId(req.headers.authorization);
      if (!accountId) throw new VirtueApiError("unauthorized", "请先登录功过格账户");
      const api = options.resolveApi(accountId);
      const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7).trim() : undefined;
      const session = options.auth && token ? options.auth.authenticateBearer(token)?.session : undefined;
      if (options.auth && !session) throw new VirtueApiError("unauthorized", "登录状态已失效，请重新登录");
      if (options.auth && method === "GET" && url.pathname === "/api/virtue/auth/sessions") { json(res, 200, options.auth.listSessions(accountId)); return; }
      if (options.auth && method === "DELETE" && url.pathname.startsWith("/api/virtue/auth/sessions/")) { options.auth.revokeSession(accountId, decodeURIComponent(url.pathname.slice("/api/virtue/auth/sessions/".length))); json(res, 204); return; }
      if (options.auth && method === "POST" && url.pathname === "/api/virtue/auth/sessions/revoke-others") { options.auth.revokeOtherSessions(accountId, session!.id); json(res, 204); return; }
      if (options.auth && method === "GET" && url.pathname === "/api/virtue/auth/passkeys") { json(res, 200, options.auth.listPasskeys(accountId).map(({ credentialId, createdAt, lastUsedAt, signCount }) => ({ credentialId, createdAt, lastUsedAt, signCount }))); return; }
      if (options.auth && method === "POST" && url.pathname === "/api/virtue/auth/passkeys") { const input = asObject(await body(req, maxBodyBytes)); options.auth.registerPasskey(accountId, input as never); json(res, 204); return; }
      if (options.auth && method === "POST" && url.pathname === "/api/virtue/auth/passkeys/options/registration") { json(res, 200, await options.auth.beginPasskeyRegistration(accountId)); return; }
      if (options.auth && method === "POST" && url.pathname === "/api/virtue/auth/passkeys/registration") { const input = asObject(await body(req, maxBodyBytes)); await options.auth.finishPasskeyRegistration(accountId, input as never); json(res, 204); return; }
      if (options.auth && method === "POST" && url.pathname === "/api/virtue/auth/reauthenticate") { const proof = options.auth.reauthenticate(token!); json(res, 200, { proof, expiresInSeconds: 300 }); return; }
      if (options.auth && method === "POST" && url.pathname === "/api/virtue/auth/recovery/rotate") { const proof = typeof req.headers["x-reauth-proof"] === "string" ? req.headers["x-reauth-proof"] : ""; if (!options.auth.consumeReauthentication(accountId, proof)) throw new VirtueApiError("forbidden", "请先重新验证身份"); json(res, 200, { recoveryCode: options.auth.issueRecoveryCode(accountId) }); return; }
      if (options.auth && method === "DELETE" && url.pathname === "/api/virtue/auth/account") { const input = asObject(await body(req, maxBodyBytes)); const proof = typeof req.headers["x-reauth-proof"] === "string" ? req.headers["x-reauth-proof"] : ""; options.auth.deleteAccount(accountId, proof, String(input.confirmation ?? "")); json(res, 204); return; }
      const id = parseId(url.pathname, "/restore") ?? parseId(url.pathname, "/permanent") ?? parseId(url.pathname, "/corrections") ?? parseId(url.pathname, "");
      if (method === "GET" && url.pathname === "/api/virtue/records") {
        const date = url.searchParams.get("date"); const from = url.searchParams.get("from"); const to = url.searchParams.get("to");
        json(res, 200, date ? api.getByDate(date as VirtueDate) : from && to ? api.getByRange(from as VirtueDate, to as VirtueDate) : api.getRecords()); return;
      }
      if (method === "GET" && url.pathname === "/api/virtue/home") { json(res, 200, api.getHome()); return; }
      if (method === "GET" && url.pathname === "/api/virtue/stats") { json(res, 200, api.getStats((url.searchParams.get("from") ?? undefined) as VirtueDate | undefined, (url.searchParams.get("to") ?? undefined) as VirtueDate | undefined)); return; }
      if (method === "GET" && url.pathname === "/api/virtue/export") { json(res, 200, JSON.parse(api.exportJSON())); return; }
      if (method === "POST" && url.pathname === "/api/virtue/records") { json(res, 201, api.add(asObject(await body(req, maxBodyBytes)) as never)); return; }
      if (method === "POST" && id && url.pathname.endsWith("/corrections")) { const input = asObject(await body(req, maxBodyBytes)); const expected = typeof input.expectedVersion === "number" ? input.expectedVersion : undefined; delete input.expectedVersion; json(res, 200, api.correctHistorical(id, input as never, expected)); return; }
      if (method === "POST" && id && url.pathname.endsWith("/restore")) { json(res, 200, api.restore(id)); return; }
      if (method === "POST" && id && url.pathname.endsWith("/permanent")) { const input = asObject(await body(req, maxBodyBytes)); if (options.auth) { const proof = typeof req.headers["x-reauth-proof"] === "string" ? req.headers["x-reauth-proof"] : ""; if (!options.auth.consumeReauthentication(accountId, proof)) throw new VirtueApiError("forbidden", "请先重新验证身份"); } api.permanentlyDelete(id, String(input.confirmation ?? "")); json(res, 204); return; }
      if (method === "POST" && id) { const input = asObject(await body(req, maxBodyBytes)); const expected = typeof input.expectedVersion === "number" ? input.expectedVersion : undefined; delete input.expectedVersion; json(res, 200, api.updateToday(id, input as never, expected)); return; }
      if (method === "DELETE" && id) { const header = req.headers["if-match"]; const expected = header && !Array.isArray(header) && header !== "" ? Number(header) : undefined; api.deleteToday(id, Number.isFinite(expected) ? expected : undefined); json(res, 204); return; }
      if (method === "POST" && url.pathname === "/api/virtue/migrations/preview") { const input = asObject(await body(req, maxBodyBytes)); json(res, 200, api.previewMigration(input as unknown as MigrationPayload, typeof input.batchId === "string" ? input.batchId : undefined)); return; }
      if (method === "POST" && url.pathname === "/api/virtue/migrations") { const input = asObject(await body(req, maxBodyBytes)); json(res, 200, api.commitMigration(input as unknown as MigrationPayload, typeof input.batchId === "string" ? input.batchId : undefined)); return; }
      json(res, 404, { error: { code: "not_found", message: "接口不存在" } });
    } catch (error) {
      if (error instanceof VirtueApiError) { json(res, errorStatus(error), { error: { code: error.code, message: error.message } }); return; }
      if (error instanceof Error) { json(res, 400, { error: { code: "validation", message: error.message } }); return; }
      json(res, 500, { error: { code: "unavailable", message: "功过格服务暂时不可用" } });
    }
  };
}

export function createVirtueServer(options: VirtueServerOptions) { return createServer((req, res) => { void createVirtueRequestHandler(options)(req, res); }); }
