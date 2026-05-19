import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";

const MIGRATIONS_TABLE = "_applied_migrations";

/** Skippable MySQL/TiDB errors for idempotent migrations */
const SKIPPABLE_CODES = new Set([
  "ER_CANT_DROP_FIELD_OR_KEY",
  "ER_BAD_FIELD_ERROR",
  "ER_DUP_KEYNAME",
  "ER_DUP_ENTRY",
  "ER_KEY_DOES_NOT_EXIST",
  "ER_CANT_DROP_FIELD_OR_KEY",
]);

function resolveMigrationsDir(): string | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(process.cwd(), "drizzle", "migrations"),
    path.join(process.cwd(), "dist", "drizzle", "migrations"),
    path.join(moduleDir, "..", "drizzle", "migrations"),
    path.join(moduleDir, "drizzle", "migrations"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

function isSkippable(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  if (code && SKIPPABLE_CODES.has(code)) return true;
  const msg = String((err as Error).message ?? err);
  return (
    msg.includes("check that column/key exists") ||
    msg.includes("Can't DROP") ||
    msg.includes("Duplicate key name") ||
    msg.includes("already exists")
  );
}

export async function runMigrations(): Promise<void> {
  console.log("[migrations] Starting migration check...");

  if (!process.env.DATABASE_URL) {
    console.log("[migrations] DATABASE_URL not set, skipping.");
    return;
  }

  const MIGRATIONS_DIR = resolveMigrationsDir();
  if (!MIGRATIONS_DIR) {
    console.warn("[migrations] No migrations directory found — checked cwd and dist paths.");
    return;
  }
  console.log(`[migrations] Using directory: ${MIGRATIONS_DIR}`);

  const connection = await mysql.createConnection(process.env.DATABASE_URL);

  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (
        \`name\` VARCHAR(255) NOT NULL PRIMARY KEY,
        \`applied_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT name FROM \`${MIGRATIONS_TABLE}\``
    );
    const applied = new Set(rows.map((r) => r.name as string));

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      const statements = sql
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);

      console.log(
        `[migrations] Applying: ${file} (${statements.length} statement${statements.length !== 1 ? "s" : ""})`
      );

      for (const stmt of statements) {
        try {
          await connection.execute(stmt);
        } catch (err: unknown) {
          if (isSkippable(err)) {
            console.log(`[migrations]   ↳ Already applied or not needed, skipping: ${(err as Error).message}`);
          } else {
            console.error(`[migrations]   ↳ Failed statement: ${stmt.slice(0, 120)}...`);
            throw err;
          }
        }
      }

      await connection.execute(
        `INSERT INTO \`${MIGRATIONS_TABLE}\` (name) VALUES (?)`,
        [file]
      );
      console.log(`[migrations] ✓ Applied: ${file}`);
      count++;
    }

    if (count === 0) {
      console.log("[migrations] Done. No new migrations.");
    } else {
      console.log(`[migrations] Done. Applied ${count} new migration(s).`);
    }
  } catch (err) {
    console.error("[migrations] Error during migration:", err);
  } finally {
    await connection.end();
  }
}
