/** Remove test healthcheck members and fix placeholder display names. */
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

const tests = db
  .prepare(
    `SELECT id, full_name, preferred_name, portrait_path FROM family_members
     WHERE lower(coalesce(full_name,'')) LIKE '%healthcheck%'
        OR lower(coalesce(preferred_name,'')) LIKE '%healthcheck%'
        OR lower(coalesce(full_name,'')) LIKE '%safe to reject%'
        OR lower(coalesce(role_in_family,'')) LIKE '%safe to reject%'
        OR lower(coalesce(full_name,'')) LIKE 'test %'
        OR lower(coalesce(preferred_name,'')) LIKE 'test %'`
  )
  .all();

for (const m of tests) {
  // Only delete pure test rows — never real portrait uploads
  const hasRealPhoto =
    m.portrait_path &&
    !String(m.portrait_path).includes("healthcheck") &&
    !String(m.portrait_path).includes("cmfr-test");
  if (hasRealPhoto) {
    console.log("SKIP (has photo path):", m.id, m.full_name, m.portrait_path);
    continue;
  }
  db.prepare("DELETE FROM family_members WHERE id = ?").run(m.id);
  console.log("DELETED test member", m.id, m.full_name, m.preferred_name);
}

// Fix generic full_name when preferred_name is a real person name
const generics = db
  .prepare(
    `SELECT id, full_name, preferred_name FROM family_members
     WHERE full_name LIKE '%Family%'
        OR full_name = 'Capoccia–Miotto Family'
        OR full_name = 'Capoccia-Miotto Family'
        OR full_name LIKE 'Capoccia%Miotto%Family%'`
  )
  .all();
for (const m of generics) {
  if (m.preferred_name && m.preferred_name.trim() && !/family/i.test(m.preferred_name)) {
    db.prepare(
      `UPDATE family_members SET full_name = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(m.preferred_name.trim(), m.id);
    console.log("fixed name", m.id, m.full_name, "->", m.preferred_name);
  }
}

// Hide any leftover tests
db.prepare(
  `UPDATE family_members SET visibility = 'private', updated_at = datetime('now')
   WHERE lower(coalesce(full_name,'')) LIKE '%healthcheck%'
      OR lower(coalesce(preferred_name,'')) LIKE '%healthcheck%'`
).run();

const publicRows = db
  .prepare(
    `SELECT id, full_name, preferred_name FROM family_members
     WHERE visibility = 'public' OR visibility IS NULL
     ORDER BY sort_order, full_name`
  )
  .all();
console.log(
  "Public members:",
  publicRows.map((r) => `${r.id}: ${r.full_name} | ${r.preferred_name || ""}`).join("\n")
);
db.close();
console.log("DONE");
