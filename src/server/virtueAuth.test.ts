import { describe, expect, it } from "vitest";
import { createSqliteVirtueAuth } from "./virtueAuth";

describe("SQLite virtue authentication", () => {
  it("keeps public registration closed and consumes recovery codes once", () => {
    const authDb = createSqliteVirtueAuth();
    const { auth } = authDb;
    auth.inviteAccount("alice");
    const code = auth.issueRecoveryCode("alice");
    const login = auth.authenticateRecovery("alice", code, "phone");
    expect(login.accountId).toBe("alice");
    expect(auth.authenticateBearer(login.token)?.accountId).toBe("alice");
    expect(() => auth.authenticateRecovery("alice", code)).toThrow(/recovery code/);
    expect(() => auth.inviteAccount("" )).toThrow();
    authDb.close();
  });

  it("revokes individual and other device sessions and disables accounts", () => {
    const authDb = createSqliteVirtueAuth();
    const { auth } = authDb;
    auth.inviteAccount("alice");
    const a = auth.authenticateRecovery("alice", auth.issueRecoveryCode("alice"), "laptop");
    const b = auth.authenticateRecovery("alice", auth.issueRecoveryCode("alice"), "phone");
    expect(auth.listSessions("alice")).toHaveLength(2);
    auth.revokeOtherSessions("alice", a.session.id);
    expect(auth.authenticateBearer(a.token)).not.toBeNull();
    expect(auth.authenticateBearer(b.token)).toBeNull();
    auth.revokeSession("alice", a.session.id);
    expect(auth.authenticateBearer(a.token)).toBeNull();
    const c = auth.authenticateRecovery("alice", auth.issueRecoveryCode("alice"), "tablet");
    auth.disableAccount("alice");
    expect(auth.authenticateBearer(c.token)).toBeNull();
    expect(() => auth.issueRecoveryCode("alice")).toThrow(/disabled/);
    authDb.close();
  });
  it("requires a short-lived reauthentication proof before account deletion", () => {
    const authDb = createSqliteVirtueAuth();
    const { auth } = authDb;
    auth.inviteAccount("alice");
    const login = auth.authenticateRecovery("alice", auth.issueRecoveryCode("alice"));
    expect(() => auth.deleteAccount("alice", "bad-proof", "永久删除账户")).toThrow();
    const proof = auth.reauthenticate(login.token);
    expect(auth.consumeReauthentication("alice", proof)).toBe(true);
    expect(auth.consumeReauthentication("alice", proof)).toBe(false);
    const proof2 = auth.reauthenticate(login.token);
    auth.deleteAccount("alice", proof2, "永久删除账户");
    expect(auth.authenticateBearer(login.token)).toBeNull();
    expect(() => auth.listSessions("alice")).toThrow(/not found/);
    authDb.close();
  });

});
