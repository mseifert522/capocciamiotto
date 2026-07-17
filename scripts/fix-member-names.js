/** Fix placeholder full_names and re-apply home-page sort order. */
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

// Prefer preferred_name when full_name is a generic site placeholder
const bad = db
  .prepare(
    `SELECT id, full_name, preferred_name FROM family_members
     WHERE full_name LIKE '%Family%' OR full_name LIKE '%Healthcheck%' OR full_name LIKE 'Test %'`
  )
  .all();
for (const m of bad) {
  if (m.preferred_name && m.preferred_name.trim() && m.preferred_name !== m.full_name) {
    db.prepare(
      `UPDATE family_members SET full_name = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(m.preferred_name.trim(), m.id);
    console.log("fixed name", m.id, m.full_name, "->", m.preferred_name);
  }
}

// Force Jeanette + Michael naming/order
db.prepare(
  `UPDATE family_members SET full_name = 'Jeanette Capoccia Seifert', preferred_name = 'Jeanette Capoccia Seifert', sort_order = 110, updated_at = datetime('now')
   WHERE full_name LIKE '%Jeanette%Seifert%' OR preferred_name LIKE '%Jeanette%Seifert%' OR full_name LIKE '%Jeanette%Capoccia%'`
).run();
db.prepare(
  `UPDATE family_members SET full_name = 'Michael Seifert', preferred_name = 'Michael Seifert', sort_order = 120,
     role_in_family = COALESCE(NULLIF(role_in_family,''), 'Spouse of Jeanette Capoccia Seifert'),
     updated_at = datetime('now')
   WHERE (full_name LIKE '%Michael%Seifert%' OR preferred_name LIKE '%Michael%Seifert%' OR full_name LIKE '%Mike%Seifert%')
     AND full_name NOT LIKE '%Miotto%' AND COALESCE(preferred_name,'') NOT LIKE '%Miotto%'`
).run();

// Leader sort (home tribute order)
const leaderRules = [
  [10, ["%Anna%Miotto%", "%Anna%Capoccia%Miotto%"]],
  [20, ["%Mickey%Miotto%", "%Amerigo%Miotto%"]],
  [30, ["%Tony%Capoccia%", "%Anthony%Capoccia%"]],
  [40, ["%Fran%Capoccia%", "%Frances%Capoccia%"]],
  [50, ["%George%Capoccia%"]],
  [60, ["%Christine%Capoccia%"]],
  [70, ["%Costanzo%Capoccia%"]],
  [80, ["%Maddalena%Capoccia%", "%Madeline%Capoccia%"]],
  [90, ["%David%Capoccia%"]],
  [100, ["%Debbie%Falluc%", "%Debbie%Capoccia%"]],
];
for (const [sort, likes] of leaderRules) {
  for (const like of likes) {
    db.prepare(
      `UPDATE family_members SET sort_order = ?, updated_at = datetime('now')
       WHERE full_name LIKE ? OR preferred_name LIKE ?`
    ).run(sort, like, like);
  }
}

// Hide automated healthcheck from public home if present
db.prepare(
  `UPDATE family_members SET visibility = 'private', updated_at = datetime('now')
   WHERE full_name LIKE '%Healthcheck%' OR preferred_name LIKE '%Healthcheck%' OR full_name LIKE 'Test %'`
).run();

const rows = db
  .prepare(
    `SELECT sort_order, id, full_name, preferred_name, visibility FROM family_members
     WHERE visibility = 'public' OR visibility IS NULL
     ORDER BY sort_order ASC, full_name ASC`
  )
  .all();
console.log(rows.map((r) => `${r.sort_order}\t${r.full_name}`).join("\n"));
db.close();
console.log("OK");
