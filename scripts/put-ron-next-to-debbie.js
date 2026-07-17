/**
 * Ensure Ron Fallucca is listed immediately after Debbie Capoccia Fallucca.
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

const debbie = db
  .prepare(
    `
  SELECT id, full_name, preferred_name, sort_order, spouse_member_id FROM family_members
  WHERE full_name LIKE '%Debbie%Falluc%'
     OR preferred_name LIKE '%Debbie%Falluc%'
     OR full_name LIKE '%Debbie%Capoccia%'
  ORDER BY id ASC LIMIT 1
`
  )
  .get();

const ron = db
  .prepare(
    `
  SELECT id, full_name, preferred_name, sort_order, spouse_member_id FROM family_members
  WHERE full_name LIKE '%Ron%Falluc%'
     OR preferred_name LIKE '%Ron%Falluc%'
     OR full_name LIKE '%Ronald%Falluc%'
  ORDER BY id ASC LIMIT 1
`
  )
  .get();

if (!debbie) {
  console.error("Debbie not found");
  process.exit(1);
}
if (!ron) {
  console.error("Ron not found");
  process.exit(1);
}

// Normalize names
db.prepare(
  `
  UPDATE family_members SET
    full_name = 'Debbie Capoccia Fallucca',
    preferred_name = 'Debbie Capoccia Fallucca',
    maiden_name = COALESCE(maiden_name, 'Capoccia'),
    role_in_family = COALESCE(NULLIF(role_in_family, ''), 'Daughter of George & Christine Capoccia'),
    visibility = 'public',
    updated_at = datetime('now')
  WHERE id = ?
`
).run(debbie.id);

db.prepare(
  `
  UPDATE family_members SET
    full_name = 'Ron Fallucca',
    preferred_name = 'Ron Fallucca',
    role_in_family = 'Spouse of Debbie Capoccia Fallucca',
    visibility = 'public',
    updated_at = datetime('now')
  WHERE id = ?
`
).run(ron.id);

// Link spouses
db.prepare("UPDATE family_members SET spouse_member_id = ? WHERE id = ?").run(ron.id, debbie.id);
db.prepare("UPDATE family_members SET spouse_member_id = ? WHERE id = ?").run(debbie.id, ron.id);

// Place Debbie at 100, Ron at 101; shift anyone currently in between / on 101
const debbieSort = 100;
const ronSort = 101;

// Move others off 100/101 first
db.prepare(
  `
  UPDATE family_members
  SET sort_order = sort_order + 20,
      updated_at = datetime('now')
  WHERE sort_order IN (?, ?)
    AND id NOT IN (?, ?)
`
).run(debbieSort, ronSort, debbie.id, ron.id);

db.prepare("UPDATE family_members SET sort_order = ?, updated_at = datetime('now') WHERE id = ?").run(
  debbieSort,
  debbie.id
);
db.prepare("UPDATE family_members SET sort_order = ?, updated_at = datetime('now') WHERE id = ?").run(
  ronSort,
  ron.id
);

// Children after the couple if present
const kids = [
  { like: "%Mario%Falluc%", sort: 102 },
  { like: "%Jaclyn%Donovan%", sort: 103 },
  { like: "%Joe%Donovan%", sort: 104 },
];
for (const k of kids) {
  db.prepare(
    `
    UPDATE family_members
    SET sort_order = ?, updated_at = datetime('now')
    WHERE full_name LIKE ? OR preferred_name LIKE ?
  `
  ).run(k.sort, k.like, k.like);
}

const nearby = db
  .prepare(
    `
  SELECT id, sort_order, full_name, preferred_name, role_in_family, spouse_member_id
  FROM family_members
  WHERE sort_order BETWEEN 90 AND 125
     OR id IN (?, ?)
  ORDER BY sort_order ASC, full_name ASC
`
  )
  .all(debbie.id, ron.id);

console.log(JSON.stringify(nearby, null, 2));
db.close();
console.log("DONE");
