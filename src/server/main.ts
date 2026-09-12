import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createSqliteVirtueApiResolver } from "../api/sqliteVirtueApi";
import { createVirtueServer } from "./virtueServer";
import { createSqliteVirtueAuth } from "./virtueAuth";

const port = Number(process.env.PORT ?? 8787);
const filename = process.env.VIRTUE_DB_PATH ?? "data/virtue.sqlite";
mkdirSync(dirname(filename), { recursive: true });
const rpID = process.env.VIRTUE_RP_ID;
const origin = process.env.VIRTUE_WEB_ORIGIN;
const authDb = createSqliteVirtueAuth({ filename, webAuthn: rpID && origin ? { rpName: process.env.VIRTUE_RP_NAME ?? "功过格", rpID, origin } : undefined });
const resolver = createSqliteVirtueApiResolver({ filename });
const server = createVirtueServer({ auth: authDb.auth, resolveApi: resolver.resolveApi });
server.listen(port, "0.0.0.0", () => console.log(`virtue server listening on ${port}`));
const close = () => { server.close(); resolver.close(); authDb.close(); };
process.once("SIGINT", close);
process.once("SIGTERM", close);
