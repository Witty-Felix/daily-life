import { describe, expect, it, vi } from "vitest";
import { createMemoryVirtueApi, createIsolatedVirtueBackend } from "../api/virtueApi";
import { createVirtueRequestHandler } from "./virtueServer";

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
});
