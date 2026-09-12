import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const isServerless = process.env.VERCEL === "1";

// A Vercel invocation can be reused, but many parallel invocations must not
// each open a large pool. Keep one short-lived connection per warm instance;
// the external Postgres provider remains the owner of DATABASE_URL settings.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(isServerless
    ? {
        max: 1,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 5_000,
        allowExitOnIdle: true,
      }
    : {}),
});
export const db = drizzle(pool, { schema });

export * from "./schema";
