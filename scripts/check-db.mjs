import pg from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Configure it in the server environment.");
}

const pool = new pg.Pool({
  connectionString,
  connectionTimeoutMillis: 5_000,
});

try {
  await pool.query("SELECT 1");
  console.log("PostgreSQL connection successful.");
} finally {
  await pool.end();
}
