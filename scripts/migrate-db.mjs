import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Configure it in the server environment.");
}

const migrationsDirectory = fileURLToPath(new URL("../database/migrations/", import.meta.url));
const migrations = (await readdir(migrationsDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5_000 });
const client = await pool.connect();
let lockAcquired = false;

try {
  await client.query("SELECT pg_advisory_lock(177009, 1)");
  lockAcquired = true;
  await client.query(`
    CREATE TABLE IF NOT EXISTS bookili_schema_migrations (
      migration_name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const { rows } = await client.query("SELECT migration_name FROM bookili_schema_migrations");
  const appliedMigrations = new Set(rows.map((row) => row.migration_name));

  for (const migrationName of migrations) {
    if (appliedMigrations.has(migrationName)) continue;

    const migrationPath = path.join(migrationsDirectory, migrationName);
    const sql = await readFile(migrationPath, "utf8");

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO bookili_schema_migrations (migration_name) VALUES ($1)",
        [migrationName],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    console.log(`Applied migration: ${migrationName}`);
  }
} finally {
  if (lockAcquired) {
    await client.query("SELECT pg_advisory_unlock(177009, 1)");
  }
  client.release();
  await pool.end();
}
