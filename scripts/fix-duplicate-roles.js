/**
 * Remove duplicated "Child of X · Daughter of X" style roles.
 * Prefer Daughter/Son over Child when both appear.
 */
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const candidates = [
  process.env.DB_PATH,
  path.join(DATA_DIR, "archive.db"),
  path.join(DATA_DIR, "tribute.db"),
].filter(Boolean);
const dbPath = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).size > 0) || candidates[0];
const db = new Database(dbPath);

function cleanRole(role) {
  if (!role) return role;
  let r = String(role).trim();

  // Split on middle-dot separators and dedupe similar phrases
  const parts = r
    .split(/\s*[·|]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length > 1) {
    const kept = [];
    for (const p of parts) {
      const lower = p.toLowerCase();
      // Drop generic "Child of X" when a more specific Son/Daughter of same parents exists
      if (/^child of\b/i.test(p)) {
        const rest = p.replace(/^child of\s+/i, "").toLowerCase();
        const hasBetter = parts.some((other) => {
          if (other === p) return false;
          return /^(son|daughter) of\s+/i.test(other) && other.toLowerCase().includes(rest.slice(0, 20));
        });
        if (hasBetter) continue;
      }
      // Exact duplicate
      if (kept.some((k) => k.toLowerCase() === lower)) continue;
      // Near-duplicate ignoring Child vs Daughter/Son
      const normalized = lower.replace(/^child of\b/, "of").replace(/^(son|daughter) of\b/, "of");
      if (kept.some((k) => k.toLowerCase().replace(/^child of\b/, "of").replace(/^(son|daughter) of\b/, "of") === normalized)) {
        // Prefer son/daughter over child
        if (/^child of\b/i.test(p)) continue;
        const idx = kept.findIndex(
          (k) =>
            k.toLowerCase().replace(/^child of\b/, "of").replace(/^(son|daughter) of\b/, "of") === normalized
        );
        if (idx >= 0 && /^child of\b/i.test(kept[idx])) {
          kept[idx] = p;
          continue;
        }
        continue;
      }
      kept.push(p);
    }
    r = kept.join(" · ");
  }

  // Known cleanups
  r = r.replace(
    /Child of Tony and Fran Capoccia\s*[·|]\s*Daughter of Tony and Fran Capoccia/gi,
    "Daughter of Tony and Fran Capoccia"
  );
  r = r.replace(
    /Child of Tony and Fran Capoccia\s*[·|]\s*Son of Tony and Fran Capoccia/gi,
    "Son of Tony and Fran Capoccia"
  );

  return r.trim();
}

const rows = db.prepare(`SELECT id, full_name, role_in_family FROM family_members WHERE role_in_family IS NOT NULL`).all();
let n = 0;
for (const row of rows) {
  const next = cleanRole(row.role_in_family);
  if (next && next !== row.role_in_family) {
    db.prepare(`UPDATE family_members SET role_in_family = ?, updated_at = datetime('now') WHERE id = ?`).run(
      next,
      row.id
    );
    console.log(row.id, row.full_name);
    console.log("  was:", row.role_in_family);
    console.log("  now:", next);
    n += 1;
  }
}

// Explicit Lori fix if still needed
db.prepare(
  `
  UPDATE family_members
  SET role_in_family = 'Daughter of Tony and Fran Capoccia',
      updated_at = datetime('now')
  WHERE (full_name LIKE '%Lori%Irwin%' OR preferred_name LIKE '%Lori%Irwin%' OR full_name LIKE '%Lori%Capoccia%')
    AND (role_in_family LIKE '%Child of%' OR role_in_family LIKE '% · %')
`
).run();

console.log("fixed", n);
console.log(
  db
    .prepare(
      `SELECT id, full_name, role_in_family FROM family_members
       WHERE full_name LIKE '%Lori%' OR role_in_family LIKE '%Child of%'`
    )
    .all()
);
db.close();
console.log("DONE");
