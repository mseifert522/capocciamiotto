/**
 * Family Members list: Costanzo & Maddalena first, then everyone else.
 * Does not change Family Leaders couple section (separate template).
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

const costanzo = db
  .prepare(
    `SELECT id FROM family_members WHERE full_name LIKE '%Costanzo%Capoccia%' OR preferred_name LIKE '%Costanzo%Capoccia%' ORDER BY id LIMIT 1`
  )
  .get();
const maddalena = db
  .prepare(
    `SELECT id FROM family_members
     WHERE full_name LIKE '%Maddalena%Capoccia%' OR preferred_name LIKE '%Maddalena%Capoccia%'
        OR full_name LIKE '%Madeline%Capoccia%' OR preferred_name LIKE '%Madeline%Capoccia%'
     ORDER BY id LIMIT 1`
  )
  .get();

if (costanzo) {
  db.prepare(
    `UPDATE family_members SET sort_order = 1, updated_at = datetime('now') WHERE id = ?`
  ).run(costanzo.id);
  console.log("Costanzo sort=1", costanzo.id);
}
if (maddalena) {
  db.prepare(
    `UPDATE family_members SET sort_order = 2, updated_at = datetime('now') WHERE id = ?`
  ).run(maddalena.id);
  console.log("Maddalena sort=2", maddalena.id);
}

// Ensure no one else sits at 1–2
db.prepare(
  `UPDATE family_members SET sort_order = sort_order + 10, updated_at = datetime('now')
   WHERE sort_order BETWEEN 1 AND 2
     AND id NOT IN (?, ?)`
).run(costanzo ? costanzo.id : -1, maddalena ? maddalena.id : -1);

// Re-assert parents
if (costanzo) db.prepare(`UPDATE family_members SET sort_order = 1 WHERE id = ?`).run(costanzo.id);
if (maddalena) db.prepare(`UPDATE family_members SET sort_order = 2 WHERE id = ?`).run(maddalena.id);

const top = db
  .prepare(
    `SELECT sort_order, full_name, role_in_family FROM family_members
     WHERE visibility = 'public' OR visibility IS NULL
     ORDER BY sort_order ASC, full_name ASC LIMIT 12`
  )
  .all();
console.log(top.map((r) => `${r.sort_order}\t${r.full_name}`).join("\n"));
db.close();
console.log("DONE");
