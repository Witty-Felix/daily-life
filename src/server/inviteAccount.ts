import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createSqliteVirtueAuth } from "./virtueAuth";

const accountId = process.argv[2]?.trim();
if (!accountId) {
  console.error("Usage: npm run invite:account -- <account-id>");
  process.exitCode = 1;
} else {
  const filename = process.env.VIRTUE_DB_PATH ?? "data/virtue.sqlite";
  mkdirSync(dirname(filename), { recursive: true });
  const authDb = createSqliteVirtueAuth({ filename });
  authDb.auth.inviteAccount(accountId);
  const recoveryCode = authDb.auth.issueRecoveryCode(accountId);
  console.log(`Account invited: ${accountId}`);
  console.log(`One-time recovery code: ${recoveryCode}`);
  authDb.close();
}
