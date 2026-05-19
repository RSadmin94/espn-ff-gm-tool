import fs from "fs";
import path from "path";

const src = path.join(process.cwd(), "drizzle", "migrations");
const dest = path.join(process.cwd(), "dist", "drizzle", "migrations");

if (!fs.existsSync(src)) {
  console.warn("[build] No drizzle/migrations folder to copy.");
  process.exit(0);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`[build] Copied SQL migrations to ${dest}`);
