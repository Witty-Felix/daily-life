import type {
  CreateVirtueRecordInput,
  UpdateVirtueRecordInput,
  VirtueDate,
  VirtueRecord,
  VirtueStats,
  VirtueCorrectionInput,
} from "../domain/virtue";
import {
  type MigrationPayload,
  type MigrationPreview,
  type VersionedVirtueRecord,
  type VirtueApiErrorCode,
  type VirtueHome,
  VirtueApiError,
} from "./virtueApi";

export type HttpVirtueApiOptions = {
  baseUrl: string;
  fetcher?: typeof fetch;
  getAccessToken?: () => string | null;
};

export type HttpVirtueAuthApi = {
  loginWithRecovery(accountId: string, code: string, deviceName?: string): Promise<{ accountId: string; token: string; session: { id: string } }>;
  reauthenticate(): Promise<{ proof: string; expiresInSeconds: number }>;
  listSessions(): Promise<unknown[]>;
  revokeSession(id: string): Promise<void>;
  revokeOtherSessions(): Promise<void>;
  rotateRecovery(proof: string): Promise<string>;
  deleteAccount(proof: string): Promise<void>;
  beginPasskeyLogin(accountId: string): Promise<unknown>;
  finishPasskeyLogin(accountId: string, response: unknown, deviceName?: string): Promise<{ accountId: string; token: string; session: { id: string } }>;
  beginPasskeyRegistration(): Promise<unknown>;
  finishPasskeyRegistration(response: unknown): Promise<void>;
};

export type HttpVirtueApi = {
  getRecords(): Promise<VersionedVirtueRecord[]>;
  getByDate(date: VirtueDate): Promise<VersionedVirtueRecord[]>;
  getByRange(from: VirtueDate, to: VirtueDate): Promise<VersionedVirtueRecord[]>;
  getHome(): Promise<VirtueHome>;
  getStats(from?: VirtueDate, to?: VirtueDate): Promise<VirtueStats>;
  add(input: Omit<CreateVirtueRecordInput, "date"> & { expectedVersion?: number }): Promise<VersionedVirtueRecord>;
  updateToday(id: string, changes: UpdateVirtueRecordInput, expectedVersion?: number): Promise<VersionedVirtueRecord>;
  correctHistorical(id: string, input: Omit<VirtueCorrectionInput, "correctedOn">, expectedVersion?: number): Promise<VersionedVirtueRecord>;
  deleteToday(id: string, expectedVersion?: number): Promise<void>;
  restore(id: string): Promise<VersionedVirtueRecord>;
  permanentlyDelete(id: string, confirmation: string): Promise<void>;
  exportJSON(): Promise<string>;
  previewMigration(payload: MigrationPayload, batchId?: string): Promise<MigrationPreview>;
  commitMigration(payload: MigrationPayload, batchId?: string): Promise<MigrationPreview>;
};

export type HttpVirtueClient = HttpVirtueApi & { auth: HttpVirtueAuthApi };

type ErrorBody = { error?: { code?: VirtueApiErrorCode; message?: string } };

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

export function createHttpVirtueApi(options: HttpVirtueApiOptions): HttpVirtueClient {
  const fetcher = options.fetcher ?? fetch;
  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body) headers.set("content-type", "application/json");
    const token = options.getAccessToken?.();
    if (token) headers.set("authorization", `Bearer ${token}`);
    let response: Response;
    try {
      response = await fetcher(joinUrl(options.baseUrl, path), { ...init, headers });
    } catch {
      throw new VirtueApiError("unavailable", "功过格服务暂时不可用");
    }
    if (!response.ok) {
      let body: ErrorBody = {};
      try { body = await response.json() as ErrorBody; } catch { /* keep generic error */ }
      const code = body.error?.code ?? (response.status === 401 ? "unauthorized" : response.status === 403 ? "forbidden" : response.status === 404 ? "not_found" : response.status === 409 ? "conflict" : response.status >= 500 ? "unavailable" : "validation");
      throw new VirtueApiError(code, body.error?.message ?? `功过格请求失败（${response.status}）`);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  };
  const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
  return {
    getRecords: () => request("/api/virtue/records"),
    getByDate: (date) => request(`/api/virtue/records?date=${encodeURIComponent(date)}`),
    getByRange: (from, to) => request(`/api/virtue/records?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    getHome: () => request("/api/virtue/home"),
    getStats: (from, to) => {
      const query = new URLSearchParams(); if (from) query.set("from", from); if (to) query.set("to", to);
      return request(`/api/virtue/stats${query.size ? `?${query}` : ""}`);
    },
    add: (input) => request("/api/virtue/records", json(input)),
    updateToday: (id, changes, expectedVersion) => request(`/api/virtue/records/${encodeURIComponent(id)}`, json({ ...changes, expectedVersion })),
    correctHistorical: (id, input, expectedVersion) => request(`/api/virtue/records/${encodeURIComponent(id)}/corrections`, json({ ...input, expectedVersion })),
    deleteToday: async (id, expectedVersion) => { await request(`/api/virtue/records/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "if-match": expectedVersion === undefined ? "" : String(expectedVersion) } }); },
    restore: (id) => request(`/api/virtue/records/${encodeURIComponent(id)}/restore`, json({})),
    permanentlyDelete: async (id, confirmation) => { await request(`/api/virtue/records/${encodeURIComponent(id)}/permanent`, json({ confirmation })); },
    exportJSON: async () => JSON.stringify(await request("/api/virtue/export"), null, 2),
    previewMigration: (payload, batchId) => request("/api/virtue/migrations/preview", json({ ...payload, batchId })),
    commitMigration: (payload, batchId) => request("/api/virtue/migrations", json({ ...payload, batchId })),
    auth: {
      loginWithRecovery: (accountId, code, deviceName) => request("/api/virtue/auth/recovery/login", json({ accountId, code, deviceName })),
      reauthenticate: () => request("/api/virtue/auth/reauthenticate", json({})),
      listSessions: () => request("/api/virtue/auth/sessions"),
      revokeSession: async (id) => { await request(`/api/virtue/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }); },
      revokeOtherSessions: async () => { await request("/api/virtue/auth/sessions/revoke-others", json({})); },
      rotateRecovery: async (proof) => (await request<{ recoveryCode: string }>("/api/virtue/auth/recovery/rotate", { ...json({}), headers: { "x-reauth-proof": proof } })).recoveryCode,
      deleteAccount: async (proof) => { await request("/api/virtue/auth/account", { method: "DELETE", headers: { "x-reauth-proof": proof }, body: JSON.stringify({ confirmation: "永久删除账户" }) }); },
      beginPasskeyLogin: (accountId) => request("/api/virtue/auth/passkeys/options/authentication", json({ accountId })),
      finishPasskeyLogin: (accountId, response, deviceName) => request("/api/virtue/auth/passkeys/login", json({ accountId, ...(response as object), deviceName })),
      beginPasskeyRegistration: () => request("/api/virtue/auth/passkeys/options/registration", json({})),
      finishPasskeyRegistration: async (response) => { await request("/api/virtue/auth/passkeys/registration", json(response)); },
    },
  };
}
