/**
 * Clear portrait_path when file is missing so cards don't show broken-image alt text.
 */
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(__dirname, "..", "public", "uploads");
const PUBLIC_ROOT = path.join(__dirname, "..", "public");
const candidates = [
  process.env.DB_PATH,
  path.join(DATA_DIR, "archive.db"),
  path.join(DATA_DIR, "tribute.db"),
].filter(Boolean);
const dbPath = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).size > 0) || candidates[0];
const db = new Database(dbPath);

function resolvePublic(urlPath) {
  if (!urlPath) return null;
  if (urlPath.startsWith("/uploads/")) {
    return path.join(UPLOAD_ROOT, urlPath.replace(/^\/uploads\//, ""));
  }
  if (urlPath.startsWith("/portraits/")) {
    return path.join(PUBLIC_ROOT, urlPath.replace(/^\//, ""));
  }
  if (urlPath.startsWith("/")) {
    return path.join(PUBLIC_ROOT, urlPath.replace(/^\//, ""));
  }
  return null;
}

const rows = db
  .prepare(`SELECT id, full_name, preferred_name, portrait_path FROM family_members WHERE portrait_path IS NOT NULL AND trim(portrait_path) != ''`)
  .all();

let cleared = 0;
for (const m of rows) {
  const fp = resolvePublic(m.portrait_path);
  const exists = fp && fs.existsSync(fp);
  if (!exists) {
    console.log("CLEAR broken portrait", m.id, m.full_name, m.portrait_path, "->", fp);
    db.prepare(`UPDATE family_members SET portrait_path = NULL, updated_at = datetime('now') WHERE id = ?`).run(m.id);
    cleared += 1;
  }
}

// Also list Anthony Capoccia specifically
const anthony = db
  .prepare(
    `SELECT id, full_name, preferred_name, portrait_path, role_in_family FROM family_members
     WHERE full_name = 'Anthony Capoccia' OR (full_name LIKE '%Anthony%Capoccia%' AND role_in_family LIKE '%David%')`
  )
  .all();
console.log("Anthony rows:", anthony);
console.log("cleared", cleared);
db.close();
