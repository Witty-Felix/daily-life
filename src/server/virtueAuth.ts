import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse, type AuthenticationResponseJSON, type RegistrationResponseJSON } from "@simplewebauthn/server";

export type PasskeyCredential = { credentialId: string; publicKey: string; signCount: number; createdAt: string; lastUsedAt: string | null };
export type PasskeyAssertion = { credentialId: string; clientDataJSON: string; authenticatorData: string; signature: string };
export type VirtuePasskeyVerifier = {
  verifyRegistration(input: { accountId: string; credentialId: string; publicKey: string; clientDataJSON: string; attestationObject: string }): boolean;
  verifyAuthentication(input: { accountId: string; credential: PasskeyCredential; assertion: PasskeyAssertion }): { valid: boolean; signCount: number };
};
export type AuthSession = { id: string; accountId: string; deviceName: string; createdAt: string; lastUsedAt: string; revokedAt: string | null };
export type VirtueAuthService = {
  inviteAccount(accountId: string): void;
  disableAccount(accountId: string): void;
  enableAccount(accountId: string): void;
  issueRecoveryCode(accountId: string): string;
  authenticateRecovery(accountId: string, code: string, deviceName?: string): { accountId: string; token: string; session: AuthSession };
  authenticateBearer(token: string): { accountId: string; session: AuthSession } | null;
  listSessions(accountId: string): AuthSession[];
  revokeSession(accountId: string, sessionId: string): void;
  revokeOtherSessions(accountId: string, currentSessionId: string): void;
  reauthenticate(token: string): string;
  registerPasskey(accountId: string, input: { credentialId: string; publicKey: string; clientDataJSON: string; attestationObject: string }): void;
  authenticatePasskey(accountId: string, input: PasskeyAssertion, deviceName?: string): { accountId: string; token: string; session: AuthSession };
  listPasskeys(accountId: string): PasskeyCredential[];
  consumeReauthentication(accountId: string, proof: string): boolean;
  deleteAccount(accountId: string, proof: string, confirmation: string): void;
  beginPasskeyRegistration(accountId: string): Promise<unknown>;
  finishPasskeyRegistration(accountId: string, response: RegistrationResponseJSON): Promise<void>;
  beginPasskeyLogin(accountId: string): Promise<unknown>;
  finishPasskeyLogin(accountId: string, response: AuthenticationResponseJSON, deviceName?: string): Promise<{ accountId: string; token: string; session: AuthSession }>;
};

export type SqliteAuthOptions = { database?: DatabaseSync; filename?: string; now?: () => Date; passkeyVerifier?: VirtuePasskeyVerifier; webAuthn?: { rpName: string; rpID: string; origin: string } };
export type SqliteAuthDatabase = { database: DatabaseSync; auth: VirtueAuthService; close(): void };

type Row = Record<string, unknown>;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const hashRecovery = (accountId: string, code: string) => scryptSync(code, accountId, 32).toString("hex");
const same = (a: string, b: string) => { const aa = Buffer.from(a, "hex"); const bb = Buffer.from(b, "hex"); return aa.length === bb.length && timingSafeEqual(aa, bb); };
const fail = (message: string): never => { throw new Error(message); };

function init(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS virtue_auth_accounts (account_id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('invited','active','disabled')), created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS virtue_auth_recovery (account_id TEXT PRIMARY KEY, code_hash TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL, FOREIGN KEY(account_id) REFERENCES virtue_auth_accounts(account_id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS virtue_auth_passkeys (credential_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, public_key TEXT NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_used_at TEXT, FOREIGN KEY(account_id) REFERENCES virtue_auth_accounts(account_id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS virtue_auth_challenges (account_id TEXT NOT NULL, kind TEXT NOT NULL, challenge TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY(account_id, kind), FOREIGN KEY(account_id) REFERENCES virtue_auth_accounts(account_id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS virtue_auth_reauth (proof_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires_at TEXT NOT NULL, FOREIGN KEY(account_id) REFERENCES virtue_auth_accounts(account_id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS virtue_auth_sessions (session_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, device_name TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT NOT NULL, revoked_at TEXT, FOREIGN KEY(account_id) REFERENCES virtue_auth_accounts(account_id) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS virtue_auth_sessions_account ON virtue_auth_sessions(account_id, revoked_at);
  `);
}

export function createSqliteVirtueAuth(options: SqliteAuthOptions = {}): SqliteAuthDatabase {
  const owns = !options.database;
  const db = options.database ?? new DatabaseSync(options.filename ?? ":memory:");
  const now = options.now ?? (() => new Date());
  init(db);
  const account = (id: string): Row | undefined => db.prepare("SELECT * FROM virtue_auth_accounts WHERE account_id = ?").get(id) as Row | undefined;
  const assertAccount = (id: string): Row => { const row = account(id); if (!row) return fail("account not found"); if (row.status === "disabled") fail("account disabled"); return row; };
  const service: VirtueAuthService = {
    inviteAccount: (accountId) => { if (!accountId.trim()) fail("account id required"); db.prepare("INSERT INTO virtue_auth_accounts(account_id,status,created_at) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET status='invited'").run(accountId.trim(), "invited", now().toISOString()); },
    disableAccount: (accountId) => { if (!account(accountId)) fail("account not found"); db.prepare("UPDATE virtue_auth_accounts SET status='disabled' WHERE account_id=?").run(accountId); db.prepare("UPDATE virtue_auth_sessions SET revoked_at=? WHERE account_id=? AND revoked_at IS NULL").run(now().toISOString(), accountId); },
    enableAccount: (accountId) => { if (!account(accountId)) fail("account not found"); db.prepare("UPDATE virtue_auth_accounts SET status='active' WHERE account_id=?").run(accountId); },
    issueRecoveryCode: (accountId) => { assertAccount(accountId); const code = Array.from(randomBytes(10)).map((v) => (v % 10).toString()).join(""); const timestamp = now().toISOString(); db.prepare("INSERT INTO virtue_auth_recovery(account_id,code_hash,used_at,created_at) VALUES(?,?,NULL,?) ON CONFLICT(account_id) DO UPDATE SET code_hash=excluded.code_hash, used_at=NULL, created_at=excluded.created_at").run(accountId, hashRecovery(accountId, code), timestamp); return code; },
    authenticateRecovery: (accountId, code, deviceName = "未命名设备") => {
      assertAccount(accountId);
      db.exec("BEGIN IMMEDIATE");
      try {
        const row = db.prepare("SELECT * FROM virtue_auth_recovery WHERE account_id=?").get(accountId) as Row | undefined;
        if (!row || row.used_at || !same(String(row.code_hash), hashRecovery(accountId, code))) fail("invalid recovery code");
        const timestamp = now().toISOString();
        const consumed = db.prepare("UPDATE virtue_auth_recovery SET used_at=? WHERE account_id=? AND used_at IS NULL").run(timestamp, accountId);
        if (consumed.changes !== 1) fail("invalid recovery code");
        db.prepare("UPDATE virtue_auth_accounts SET status='active' WHERE account_id=? AND status='invited'").run(accountId);
        const token = randomBytes(32).toString("base64url"); const id = randomBytes(16).toString("hex"); const normalizedDeviceName = deviceName.trim() || "未命名设备";
        db.prepare("INSERT INTO virtue_auth_sessions(session_id,account_id,token_hash,device_name,created_at,last_used_at,revoked_at) VALUES(?,?,?,?,?,?,NULL)").run(id, accountId, hashToken(token), normalizedDeviceName, timestamp, timestamp);
        db.exec("COMMIT");
        return { accountId, token, session: { id, accountId, deviceName: normalizedDeviceName, createdAt: timestamp, lastUsedAt: timestamp, revokedAt: null } };
      } catch (error) { try { db.exec("ROLLBACK"); } catch { /* preserve original */ } throw error; }
    },
    authenticateBearer: (token) => { const row = db.prepare("SELECT s.*, a.status FROM virtue_auth_sessions s JOIN virtue_auth_accounts a USING(account_id) WHERE s.token_hash=?").get(hashToken(token)) as Row | undefined; if (!row || row.revoked_at || row.status !== "active") return null; const timestamp = now().toISOString(); (db.prepare("UPDATE virtue_auth_sessions SET last_used_at=? WHERE session_id=?") as any).run(timestamp, row.session_id); return { accountId: String(row.account_id), session: { id: String(row.session_id), accountId: String(row.account_id), deviceName: String(row.device_name), createdAt: String(row.created_at), lastUsedAt: timestamp, revokedAt: null } }; },
    listSessions: (accountId) => { assertAccount(accountId); return (db.prepare("SELECT * FROM virtue_auth_sessions WHERE account_id=? ORDER BY created_at DESC").all(accountId) as Row[]).map((r) => ({ id: String(r.session_id), accountId, deviceName: String(r.device_name), createdAt: String(r.created_at), lastUsedAt: String(r.last_used_at), revokedAt: r.revoked_at == null ? null : String(r.revoked_at) })); },
    revokeSession: (accountId, sessionId) => { assertAccount(accountId); db.prepare("UPDATE virtue_auth_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE account_id=? AND session_id=?").run(now().toISOString(), accountId, sessionId); },
    revokeOtherSessions: (accountId, currentSessionId) => { assertAccount(accountId); db.prepare("UPDATE virtue_auth_sessions SET revoked_at=? WHERE account_id=? AND session_id<>? AND revoked_at IS NULL").run(now().toISOString(), accountId, currentSessionId); },
    reauthenticate: (token) => { const auth = service.authenticateBearer(token); if (!auth) return fail("reauthentication required"); const proof = randomBytes(24).toString("base64url"); db.prepare("INSERT INTO virtue_auth_reauth(proof_hash,account_id,expires_at) VALUES(?,?,?)").run(hashToken(proof), auth.accountId, new Date(now().getTime() + 5 * 60 * 1000).toISOString()); return proof; },
    registerPasskey: (accountId, input) => {
      assertAccount(accountId);
      if (!options.passkeyVerifier?.verifyRegistration({ accountId, ...input })) fail("invalid passkey registration");
      const timestamp = now().toISOString();
      db.prepare("INSERT INTO virtue_auth_passkeys(credential_id,account_id,public_key,sign_count,created_at,last_used_at) VALUES(?,?,?,0,?,NULL) ON CONFLICT(credential_id) DO UPDATE SET public_key=excluded.public_key").run(input.credentialId, accountId, input.publicKey, timestamp);
    },
    authenticatePasskey: (accountId, input, deviceName = "未命名设备") => {
      assertAccount(accountId);
      const row = db.prepare("SELECT * FROM virtue_auth_passkeys WHERE account_id=? AND credential_id=?").get(accountId, input.credentialId) as Row | undefined;
      if (!row) return fail("invalid passkey");
      const verifier = options.passkeyVerifier;
      if (!verifier) return fail("invalid passkey");
      const credential: PasskeyCredential = { credentialId: String(row.credential_id), publicKey: String(row.public_key), signCount: Number(row.sign_count), createdAt: String(row.created_at), lastUsedAt: row.last_used_at == null ? null : String(row.last_used_at) };
      const result = verifier.verifyAuthentication({ accountId, credential, assertion: input });
      if (!result.valid || result.signCount < credential.signCount) fail("invalid passkey");
      const timestamp = now().toISOString();
      db.prepare("UPDATE virtue_auth_passkeys SET sign_count=?, last_used_at=? WHERE credential_id=?").run(result.signCount, timestamp, input.credentialId);
      const token = randomBytes(32).toString("base64url"); const id = randomBytes(16).toString("hex");
      db.prepare("INSERT INTO virtue_auth_sessions(session_id,account_id,token_hash,device_name,created_at,last_used_at,revoked_at) VALUES(?,?,?,?,?,?,NULL)").run(id, accountId, hashToken(token), deviceName.trim() || "未命名设备", timestamp, timestamp);
      return { accountId, token, session: { id, accountId, deviceName: deviceName.trim() || "未命名设备", createdAt: timestamp, lastUsedAt: timestamp, revokedAt: null } };
    },
    listPasskeys: (accountId) => { assertAccount(accountId); return (db.prepare("SELECT * FROM virtue_auth_passkeys WHERE account_id=? ORDER BY created_at DESC").all(accountId) as Row[]).map((r) => ({ credentialId: String(r.credential_id), publicKey: String(r.public_key), signCount: Number(r.sign_count), createdAt: String(r.created_at), lastUsedAt: r.last_used_at == null ? null : String(r.last_used_at) })); },
    consumeReauthentication: (accountId, proof) => {
      assertAccount(accountId);
      const row = db.prepare("SELECT * FROM virtue_auth_reauth WHERE proof_hash=? AND account_id=?").get(hashToken(proof), accountId) as Row | undefined;
      if (!row || String(row.expires_at) <= now().toISOString()) return false;
      db.prepare("DELETE FROM virtue_auth_reauth WHERE proof_hash=?").run(hashToken(proof));
      return true;
    },
    beginPasskeyRegistration: async (accountId) => {
      assertAccount(accountId);
      if (!options.webAuthn) return fail("WebAuthn is not configured");
      const existing = (db.prepare("SELECT credential_id FROM virtue_auth_passkeys WHERE account_id=?").all(accountId) as Row[]).map((row) => ({ id: String(row.credential_id) }));
      const challenge = await generateRegistrationOptions({ rpName: options.webAuthn.rpName, rpID: options.webAuthn.rpID, userName: accountId, userID: Buffer.from(accountId), excludeCredentials: existing });
      db.prepare("INSERT INTO virtue_auth_challenges(account_id,kind,challenge,expires_at) VALUES(?,?,?,?) ON CONFLICT(account_id,kind) DO UPDATE SET challenge=excluded.challenge,expires_at=excluded.expires_at").run(accountId, "registration", challenge.challenge, new Date(now().getTime() + 5 * 60 * 1000).toISOString());
      return challenge;
    },
    finishPasskeyRegistration: async (accountId, response) => {
      assertAccount(accountId);
      if (!options.webAuthn) return fail("WebAuthn is not configured");
      const row = db.prepare("SELECT * FROM virtue_auth_challenges WHERE account_id=? AND kind='registration'").get(accountId) as Row | undefined;
      if (!row || String(row.expires_at) <= now().toISOString()) return fail("registration challenge expired");
      const result = await verifyRegistrationResponse({ response, expectedChallenge: String(row.challenge), expectedOrigin: options.webAuthn.origin, expectedRPID: options.webAuthn.rpID });
      db.prepare("DELETE FROM virtue_auth_challenges WHERE account_id=? AND kind='registration'").run(accountId);
      if (!result.verified) return fail("invalid passkey registration");
      const credential = result.registrationInfo.credential;
      const timestamp = now().toISOString();
      db.prepare("INSERT INTO virtue_auth_passkeys(credential_id,account_id,public_key,sign_count,created_at,last_used_at) VALUES(?,?,?, ?,?,NULL) ON CONFLICT(credential_id) DO UPDATE SET public_key=excluded.public_key,sign_count=excluded.sign_count").run(credential.id, accountId, Buffer.from(credential.publicKey).toString("base64url"), credential.counter, timestamp);
    },
    beginPasskeyLogin: async (accountId) => {
      assertAccount(accountId);
      if (!options.webAuthn) return fail("WebAuthn is not configured");
      const credentials = (db.prepare("SELECT credential_id FROM virtue_auth_passkeys WHERE account_id=?").all(accountId) as Row[]).map((row) => ({ id: String(row.credential_id) }));
      if (!credentials.length) return fail("no passkey registered");
      const challenge = await generateAuthenticationOptions({ rpID: options.webAuthn.rpID, allowCredentials: credentials, userVerification: "required" });
      db.prepare("INSERT INTO virtue_auth_challenges(account_id,kind,challenge,expires_at) VALUES(?,?,?,?) ON CONFLICT(account_id,kind) DO UPDATE SET challenge=excluded.challenge,expires_at=excluded.expires_at").run(accountId, "authentication", challenge.challenge, new Date(now().getTime() + 5 * 60 * 1000).toISOString());
      return challenge;
    },
    finishPasskeyLogin: async (accountId, response, deviceName = "未命名设备") => {
      assertAccount(accountId);
      if (!options.webAuthn) return fail("WebAuthn is not configured");
      const challengeRow = db.prepare("SELECT * FROM virtue_auth_challenges WHERE account_id=? AND kind='authentication'").get(accountId) as Row | undefined;
      const row = db.prepare("SELECT * FROM virtue_auth_passkeys WHERE account_id=? AND credential_id=?").get(accountId, response.id) as Row | undefined;
      if (!challengeRow || String(challengeRow.expires_at) <= now().toISOString() || !row) return fail("invalid passkey");
      const result = await verifyAuthenticationResponse({ response, expectedChallenge: String(challengeRow.challenge), expectedOrigin: options.webAuthn.origin, expectedRPID: options.webAuthn.rpID, credential: { id: String(row.credential_id), publicKey: Buffer.from(String(row.public_key), "base64url"), counter: Number(row.sign_count), transports: [] } });
      db.prepare("DELETE FROM virtue_auth_challenges WHERE account_id=? AND kind='authentication'").run(accountId);
      if (!result.verified) return fail("invalid passkey");
      const timestamp = now().toISOString();
      db.prepare("UPDATE virtue_auth_passkeys SET sign_count=?,last_used_at=? WHERE credential_id=?").run(result.authenticationInfo.newCounter, timestamp, response.id);
      const token = randomBytes(32).toString("base64url"); const id = randomBytes(16).toString("hex");
      db.prepare("INSERT INTO virtue_auth_sessions(session_id,account_id,token_hash,device_name,created_at,last_used_at,revoked_at) VALUES(?,?,?,?,?,?,NULL)").run(id, accountId, hashToken(token), deviceName.trim() || "未命名设备", timestamp, timestamp);
      return { accountId, token, session: { id, accountId, deviceName: deviceName.trim() || "未命名设备", createdAt: timestamp, lastUsedAt: timestamp, revokedAt: null } };
    },
    deleteAccount: (accountId, proof, confirmation) => {
      if (confirmation !== "永久删除账户" || !service.consumeReauthentication(accountId, proof)) fail("account deletion requires reauthentication");
      if (!account(accountId)) fail("account not found");
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const table of ["virtue_records", "virtue_purged_records", "virtue_migration_batches", "virtue_accounts"]) {
          const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
          if (exists) db.prepare(`DELETE FROM ${table} WHERE account_id=?`).run(accountId);
        }
        db.prepare("DELETE FROM virtue_auth_accounts WHERE account_id=?").run(accountId);
        db.exec("COMMIT");
      } catch (error) { try { db.exec("ROLLBACK"); } catch { /* preserve original */ } throw error; }
    },
  };
  return { database: db, auth: service, close: () => { if (owns) db.close(); } };
}
