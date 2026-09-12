import { describe, expect, it, vi } from "vitest";
import { createHttpVirtueApi } from "./httpVirtueApi";
import { VirtueApiError } from "./virtueApi";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("HTTP VirtueApi adapter", () => {
  it("sends auth, serializes requests, and maps successful responses", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("https://example.test/api/virtue/records");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token");
      expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
      expect(JSON.parse(String(init?.body))).toMatchObject({ id: "today", type: "good" });
      return response({ id: "today", version: 1 });
    });
    const api = createHttpVirtueApi({ baseUrl: "https://example.test/", getAccessToken: () => "token", fetcher });
    await expect(api.add({ id: "today", type: "good", description: "完成工作" })).resolves.toMatchObject({ id: "today", version: 1 });
  });

  it("maps structured business errors and network failures", async () => {
    const forbidden = createHttpVirtueApi({ baseUrl: "https://example.test", fetcher: vi.fn(async () => response({ error: { code: "conflict", message: "版本冲突" } }, 409)) });
    await expect(forbidden.getRecords()).rejects.toMatchObject({ name: "VirtueApiError", code: "conflict", message: "版本冲突" });
    const unavailable = createHttpVirtueApi({ baseUrl: "https://example.test", fetcher: vi.fn(async () => { throw new Error("offline"); }) });
    await expect(unavailable.getRecords()).rejects.toMatchObject({ name: "VirtueApiError", code: "unavailable" });
    expect(VirtueApiError).toBeDefined();
  });

  it("uses query parameters for date and range reads", async () => {
    const urls: string[] = [];
    const api = createHttpVirtueApi({ baseUrl: "https://example.test", fetcher: vi.fn(async (input) => { urls.push(String(input)); return response([]); }) });
    await api.getByDate("2026-09-12");
    await api.getByRange("2026-09-01", "2026-09-12");
    await api.getStats("2026-09-01", "2026-09-12");
    expect(urls).toEqual(["https://example.test/api/virtue/records?date=2026-09-12", "https://example.test/api/virtue/records?from=2026-09-01&to=2026-09-12", "https://example.test/api/virtue/stats?from=2026-09-01&to=2026-09-12"]);
  });
});
