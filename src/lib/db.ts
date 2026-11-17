import "server-only";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL must be set before using the database.");
}

const globalForPostgres = globalThis as typeof globalThis & {
  bookiliPostgresPool?: Pool;
};

export const postgresPool =
  globalForPostgres.bookiliPostgresPool ??
  new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPostgres.bookiliPostgresPool = postgresPool;
}
