import { describe, expect, it, vi } from "vitest";
import { createMemoryVirtueApi, createIsolatedVirtueBackend } from "../api/virtueApi";
import { createVirtueRequestHandler } from "./virtueServer";
import { createSqliteVirtueAuth } from "./virtueAuth";

async function call(handler: ReturnType<typeof createVirtueRequestHandler>, path: string, init: RequestInit = {}) {
  const request = new Request(`http://localhost${path}`, init);
  const headers = new Headers(request.headers); const chunks: Uint8Array[] = [];
  const response = { statusCode: 200, setHeader: vi.fn(), end: vi.fn((value?: string | Uint8Array) => { if (value) chunks.push(typeof value === "string" ? new TextEncoder().encode(value) : value); }) } as never;
  await handler({ method: init.method ?? "GET", url: path, headers: Object.fromEntries(headers.entries()), [Symbol.asyncIterator]: async function* () { if (init.body) yield Buffer.from(String(init.body)); } } as never, response);
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString();
  return { status: (response as { statusCode: number }).statusCode, body: body ? JSON.parse(body) : undefined };
}

describe("virtue HTTP server", () => {
  it("requires auth and isolates the resolved account", async () => {
    const backend = createIsolatedVirtueBackend();
    const handler = createVirtueRequestHandler({ resolveApi: (accountId) => createMemoryVirtueApi({ accountId, backend }) });
    expect((await call(handler, "/api/virtue/records")).status).toBe(401);
    const added = await call(handler, "/api/virtue/records", { method: "POST", headers: { authorization: "Bearer alice" }, body: JSON.stringify({ id: "a", type: "good", description: "完成工作" }) });
    expect(added.status).toBe(201);
    const bob = await call(handler, "/api/virtue/records", { headers: { authorization: "Bearer bob" } });
    expect(bob.body).toEqual([]);
  });

  it("maps validation and conflict errors to stable HTTP responses", async () => {
    const backend = createIsolatedVirtueBackend();
    const handler = createVirtueRequestHandler({ resolveApi: (accountId) => createMemoryVirtueApi({ accountId, backend }) });
    const invalid = await call(handler, "/api/virtue/records", { method: "POST", headers: { authorization: "Bearer alice" }, body: JSON.stringify({ id: "x", type: "good", description: "" }) });
    expect(invalid.status).toBe(400); expect(invalid.body.error.code).toBe("validation");
    await call(handler, "/api/virtue/records", { method: "POST", headers: { authorization: "Bearer alice" }, body: JSON.stringify({ id: "x", type: "good", description: "原始" }) });
    const conflict = await call(handler, "/api/virtue/records/x", { method: "POST", headers: { authorization: "Bearer alice" }, body: JSON.stringify({ description: "旧修改", expectedVersion: 0 }) });
    expect(conflict.status).toBe(409); expect(conflict.body.error.code).toBe("conflict");
  });
  it("supports recovery login and session revocation at the HTTP boundary", async () => {
    const authDb = createSqliteVirtueAuth();
    authDb.auth.inviteAccount("alice");
    const code = authDb.auth.issueRecoveryCode("alice");
    const handler = createVirtueRequestHandler({
      auth: authDb.auth,
      resolveApi: (accountId) => createMemoryVirtueApi({ accountId, backend: createIsolatedVirtueBackend() }),
    });
    const login = await call(handler, "/api/virtue/auth/recovery/login", { method: "POST", body: JSON.stringify({ accountId: "alice", code, deviceName: "phone" }) });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const sessions = await call(handler, "/api/virtue/auth/sessions", { headers: { authorization: `Bearer ${token}` } });
    expect(sessions.status).toBe(200);
    expect(sessions.body).toHaveLength(1);
    const records = await call(handler, "/api/virtue/records", { headers: { authorization: `Bearer ${token}` } });
    expect(records.status).toBe(200);
    const sessionId = sessions.body[0].id as string;
    const revoked = await call(handler, `/api/virtue/auth/sessions/${sessionId}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    expect(revoked.status).toBe(204);
    expect((await call(handler, "/api/virtue/records", { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
    expect((await call(handler, "/api/virtue/auth/passkeys/options/registration", { method: "POST", body: JSON.stringify({ accountId: "alice" }) })).status).toBe(401);
    authDb.close();
  });

  it("requires reauthentication for recovery rotation and permanent account deletion", async () => {
    const authDb = createSqliteVirtueAuth();
    authDb.auth.inviteAccount("alice");
    const login = authDb.auth.authenticateRecovery("alice", authDb.auth.issueRecoveryCode("alice"));
    const handler = createVirtueRequestHandler({ auth: authDb.auth, resolveApi: (accountId) => createMemoryVirtueApi({ accountId, backend: createIsolatedVirtueBackend() }) });
    const noProof = await call(handler, "/api/virtue/auth/recovery/rotate", { method: "POST", headers: { authorization: `Bearer ${login.token}` }, body: "{}" });
    expect(noProof.status).toBe(403);
    const reauth = await call(handler, "/api/virtue/auth/reauthenticate", { method: "POST", headers: { authorization: `Bearer ${login.token}` }, body: "{}" });
    expect(reauth.status).toBe(200);
    const rotated = await call(handler, "/api/virtue/auth/recovery/rotate", { method: "POST", headers: { authorization: `Bearer ${login.token}`, "x-reauth-proof": reauth.body.proof }, body: "{}" });
    expect(rotated.status).toBe(200);
    const second = await call(handler, "/api/virtue/auth/recovery/rotate", { method: "POST", headers: { authorization: `Bearer ${login.token}`, "x-reauth-proof": reauth.body.proof }, body: "{}" });
    expect(second.status).toBe(403);
    const reauth2 = await call(handler, "/api/virtue/auth/reauthenticate", { method: "POST", headers: { authorization: `Bearer ${login.token}` }, body: "{}" });
    const deleted = await call(handler, "/api/virtue/auth/account", { method: "DELETE", headers: { authorization: `Bearer ${login.token}`, "x-reauth-proof": reauth2.body.proof }, body: JSON.stringify({ confirmation: "永久删除账户" }) });
    expect(deleted.status).toBe(204);
    authDb.close();
  });

});
