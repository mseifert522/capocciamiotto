/**
 * Rename Debbie → Debbie Capoccia Fallucca and add husband Ron Fallucca next to her.
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

console.log("DB", dbPath);

let debbie = db
  .prepare(
    `
  SELECT id, full_name, preferred_name, sort_order, parent_member_id, spouse_member_id, family_branch
  FROM family_members
  WHERE full_name LIKE '%Debbie%Falluc%'
     OR preferred_name LIKE '%Debbie%Falluc%'
     OR full_name LIKE '%Debbie%Capoccia%'
     OR preferred_name LIKE '%Debbie%Capoccia%'
  ORDER BY id ASC LIMIT 1
`
  )
  .get();

if (!debbie) {
  console.error("Debbie not found");
  process.exit(1);
}

const debbieSort = Number(debbie.sort_order) || 100;

db.prepare(
  `
  UPDATE family_members SET
    full_name = 'Debbie Capoccia Fallucca',
    preferred_name = 'Debbie Capoccia Fallucca',
    maiden_name = COALESCE(NULLIF(maiden_name, ''), 'Capoccia'),
    role_in_family = COALESCE(NULLIF(role_in_family, ''), 'Daughter of George & Christine Capoccia'),
    family_branch = 'Capoccia',
    visibility = 'public',
    sort_order = ?,
    updated_at = datetime('now')
  WHERE id = ?
`
).run(debbieSort, debbie.id);

console.log("Updated Debbie id", debbie.id, "sort", debbieSort);

let ron = db
  .prepare(
    `
  SELECT id, full_name, preferred_name, sort_order FROM family_members
  WHERE full_name LIKE '%Ron%Falluc%'
     OR preferred_name LIKE '%Ron%Falluc%'
     OR full_name LIKE '%Ronald%Falluc%'
     OR preferred_name LIKE '%Ronald%Falluc%'
  ORDER BY id ASC LIMIT 1
`
).get();

const ronSort = debbieSort + 1;

if (!ron) {
  const info = db
    .prepare(
      `
    INSERT INTO family_members (
      full_name, preferred_name, family_branch,
      is_patriarch, is_matriarch, is_memorial, is_placeholder,
      sort_order, role_in_family, biography, visibility,
      parent_member_id, spouse_member_id, tree_lineage, generation, relation_type
    ) VALUES (
      'Ron Fallucca', 'Ron Fallucca', 'Capoccia',
      0, 0, 0, 0,
      ?, 'Spouse of Debbie Capoccia Fallucca',
      'Ron Fallucca is the husband of Debbie Capoccia Fallucca.',
      'public',
      NULL, ?, 'george', 2, 'spouse_of'
    )
  `
    )
    .run(ronSort, debbie.id);
  ron = { id: Number(info.lastInsertRowid), full_name: "Ron Fallucca" };
  console.log("Created Ron Fallucca id", ron.id);
} else {
  db.prepare(
    `
    UPDATE family_members SET
      full_name = 'Ron Fallucca',
      preferred_name = 'Ron Fallucca',
      family_branch = 'Capoccia',
      role_in_family = 'Spouse of Debbie Capoccia Fallucca',
      visibility = 'public',
      sort_order = ?,
      spouse_member_id = ?,
      relation_type = 'spouse_of',
      tree_lineage = COALESCE(tree_lineage, 'george'),
      updated_at = datetime('now')
    WHERE id = ?
  `
  ).run(ronSort, debbie.id, ron.id);
  console.log("Updated Ron Fallucca id", ron.id);
}

// Link spouses both ways
db.prepare("UPDATE family_members SET spouse_member_id = ? WHERE id = ?").run(ron.id, debbie.id);
db.prepare("UPDATE family_members SET spouse_member_id = ? WHERE id = ?").run(debbie.id, ron.id);

// Shift anyone currently between debbie and ron if needed — keep consecutive
// Push anyone with sort_order == ronSort (except Ron) up by 1
db.prepare(
  `
  UPDATE family_members
  SET sort_order = sort_order + 1,
      updated_at = datetime('now')
  WHERE sort_order >= ?
    AND id NOT IN (?, ?)
`
).run(ronSort, debbie.id, ron.id);

// Re-assert exact order for Debbie then Ron
db.prepare("UPDATE family_members SET sort_order = ? WHERE id = ?").run(debbieSort, debbie.id);
db.prepare("UPDATE family_members SET sort_order = ? WHERE id = ?").run(debbieSort + 1, ron.id);

const nearby = db
  .prepare(
    `
  SELECT id, sort_order, full_name, preferred_name, role_in_family, spouse_member_id
  FROM family_members
  WHERE sort_order BETWEEN ? AND ?
     OR id IN (?, ?)
  ORDER BY sort_order ASC, full_name ASC
`
  )
  .all(debbieSort - 5, debbieSort + 10, debbie.id, ron.id);

console.log(JSON.stringify(nearby, null, 2));
db.close();
console.log("DONE");
