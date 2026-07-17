/**
 * Force recompute family member order: roots → Anna → Tony → George.
 */
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const { recomputeFamilyMemberSortOrders } = require("../src/familyTree");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const candidates = [
  process.env.DB_PATH,
  path.join(DATA_DIR, "archive.db"),
  path.join(DATA_DIR, "tribute.db"),
].filter(Boolean);
const dbPath = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).size > 0) || candidates[0];
const db = new Database(dbPath);

// Explicit lineage fixes for known family groups
const fixes = [
  // Anna / Miotto line
  { like: "%Patricia%McLaren%", lineage: "anna", generation: 2 },
  { like: "%Carol%Maconochie%", lineage: "anna", generation: 2 },
  { like: "%John%Miotto%", lineage: "anna", generation: 2 },
  { like: "%Michael%Miotto%", lineage: "anna", generation: 2 },
  { like: "%MaryAnn%Sellers%", lineage: "anna", generation: 2 },
  { like: "%Anna%Miotto%", lineage: "anna", generation: 1 },
  { like: "%Mickey%Miotto%", lineage: "anna", generation: 1 },
  { like: "%Amerigo%Miotto%", lineage: "anna", generation: 1 },
  // Tony line
  { like: "%Lori%Irwin%", lineage: "tony", generation: 2 },
  { like: "%Lori%Capoccia%", lineage: "tony", generation: 2 },
  { like: "%Wayne%Irwin%", lineage: "tony", generation: 2 },
  { like: "%Lauren%Martin%", lineage: "tony", generation: 3 },
  { like: "%Grant%Martin%", lineage: "tony", generation: 3 },
  // George line
  { like: "%David%Capoccia%", lineage: "george", generation: 2 },
  { like: "%Debbie%Falluc%", lineage: "george", generation: 2 },
  { like: "%Ron%Falluc%", lineage: "george", generation: 2 },
  { like: "%Mario%Falluc%", lineage: "george", generation: 3 },
  { like: "%Jaclyn%Donovan%", lineage: "george", generation: 3 },
  { like: "%Joe%Donovan%", lineage: "george", generation: 3 },
  { like: "%Jeanette%Seifert%", lineage: "george", generation: 2 },
  { like: "%Michael%Seifert%", lineage: "george", generation: 2 },
  { like: "%Andrew%Fallon%", lineage: "george", generation: 3 },
  { like: "%Heather%Fallon%", lineage: "george", generation: 3 },
  { like: "%Michael%Capoccia%", lineage: "george", generation: 3 },
  { like: "%Anthony%Capoccia%", lineage: "george", generation: 3 }, // son of David only if role matches
  // Roots
  { like: "%Costanzo%Capoccia%", lineage: "roots", generation: 0 },
  { like: "%Maddalena%Capoccia%", lineage: "roots", generation: 0 },
  { like: "%Madeline%Capoccia%", lineage: "roots", generation: 0 },
];

for (const f of fixes) {
  if (f.like === "%Anthony%Capoccia%") {
    db.prepare(
      `
      UPDATE family_members
      SET tree_lineage = ?, generation = ?, updated_at = datetime('now')
      WHERE (full_name LIKE ? OR preferred_name LIKE ?)
        AND role_in_family LIKE '%Son of David%'
    `
    ).run(f.lineage, f.generation, f.like, f.like);
    continue;
  }
  if (f.like === "%Michael%Capoccia%") {
    db.prepare(
      `
      UPDATE family_members
      SET tree_lineage = ?, generation = ?, updated_at = datetime('now')
      WHERE (full_name LIKE ? OR preferred_name LIKE ?)
        AND full_name NOT LIKE '%Seifert%'
        AND full_name NOT LIKE '%Miotto%'
    `
    ).run(f.lineage, f.generation, f.like, f.like);
    continue;
  }
  db.prepare(
    `
    UPDATE family_members
    SET tree_lineage = ?, generation = COALESCE(generation, ?), updated_at = datetime('now')
    WHERE full_name LIKE ? OR preferred_name LIKE ?
  `
  ).run(f.lineage, f.generation, f.like, f.like);
}

// Spouses: generation matches partner when spouse_of
db.prepare(
  `
  UPDATE family_members
  SET generation = (
    SELECT p.generation FROM family_members p WHERE p.id = family_members.spouse_member_id
  )
  WHERE relation_type = 'spouse_of'
    AND spouse_member_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM family_members p WHERE p.id = family_members.spouse_member_id AND p.generation IS NOT NULL)
`
).run();

const result = recomputeFamilyMemberSortOrders(db);
console.log("recompute", result);

const list = db
  .prepare(
    `
  SELECT sort_order, full_name, tree_lineage, generation, role_in_family
  FROM family_members
  WHERE visibility = 'public' OR visibility IS NULL
  ORDER BY sort_order ASC
`
  )
  .all();
console.log(list.map((m) => `${m.sort_order}\t${m.tree_lineage || "-"}\tg${m.generation}\t${m.full_name}`).join("\n"));
db.close();
console.log("DONE");
