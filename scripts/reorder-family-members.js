/**
 * Reorder family members for home page display and fix Jeanette Capoccia Seifert naming.
 * Order: leaders (Anna+Mickey, Tony+Fran, George+Christine), then descendants
 * with Jeanette Capoccia Seifert and Michael Seifert as a couple pair.
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

function blob(m) {
  return `${m.full_name || ""} ${m.preferred_name || ""} ${m.role_in_family || ""}`.toLowerCase();
}

function findOne(list, tests) {
  return list.find((m) => tests.every((t) => t.test(blob(m)))) || null;
}

function findAll(list, tests) {
  return list.filter((m) => tests.every((t) => t.test(blob(m))));
}

const members = db
  .prepare("SELECT id, full_name, preferred_name, role_in_family, family_branch, sort_order FROM family_members")
  .all();

console.log("DB:", dbPath);
console.log("Count:", members.length);
console.log(
  "Before:",
  members
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.full_name.localeCompare(b.full_name))
    .map((m) => `${m.sort_order}\t${m.id}\t${m.full_name} | ${m.preferred_name || ""}`)
    .join("\n")
);

// Fix Jeanette name → Jeanette Capoccia Seifert
const jeanetteCandidates = members.filter((m) => /jeanette/i.test(blob(m)) && /seifert|capoccia/i.test(blob(m)));
for (const j of jeanetteCandidates) {
  db.prepare(
    `
    UPDATE family_members SET
      full_name = 'Jeanette Capoccia Seifert',
      preferred_name = 'Jeanette Capoccia Seifert',
      updated_at = datetime('now')
    WHERE id = ?
  `
  ).run(j.id);
  j.full_name = "Jeanette Capoccia Seifert";
  j.preferred_name = "Jeanette Capoccia Seifert";
  console.log("Renamed Jeanette id", j.id);
}

// Ensure Michael Seifert exists (Jeanette's husband)
let michael = findOne(members, [/michael|mike/, /seifert/]);
if (!michael) {
  // Avoid Michael Miotto
  michael = members.find((m) => /michael|mike/i.test(blob(m)) && /seifert/i.test(blob(m)));
}
if (!michael) {
  const info = db
    .prepare(
      `
    INSERT INTO family_members (
      full_name, preferred_name, family_branch, role_in_family,
      is_patriarch, is_matriarch, is_memorial, is_placeholder, sort_order,
      visibility, biography
    ) VALUES (?, ?, 'Capoccia', ?, 0, 0, 0, 0, 0, 'public', ?)
  `
    )
    .run(
      "Michael Seifert",
      "Michael Seifert",
      "Spouse of Jeanette Capoccia Seifert",
      "Husband of Jeanette Capoccia Seifert. Family archive entry."
    );
  michael = {
    id: Number(info.lastInsertRowid),
    full_name: "Michael Seifert",
    preferred_name: "Michael Seifert",
  };
  members.push(michael);
  console.log("Created Michael Seifert id", michael.id);
} else {
  db.prepare(
    `
    UPDATE family_members SET
      full_name = CASE WHEN full_name LIKE '%Miotto%' THEN full_name ELSE 'Michael Seifert' END,
      preferred_name = CASE WHEN full_name LIKE '%Miotto%' THEN preferred_name ELSE 'Michael Seifert' END,
      role_in_family = COALESCE(NULLIF(role_in_family, ''), 'Spouse of Jeanette Capoccia Seifert'),
      updated_at = datetime('now')
    WHERE id = ?
  `
  ).run(michael.id);
  // Only normalize if this is Seifert not Miotto
  if (!/miotto/i.test(blob(michael))) {
    michael.full_name = "Michael Seifert";
    michael.preferred_name = "Michael Seifert";
  }
  console.log("Updated Michael Seifert id", michael.id);
}

// Link Jeanette ↔ Michael as spouses when both are Seifert line
const jeanette = findOne(members, [/jeanette/, /capoccia|seifert/]);
if (jeanette && michael && !/miotto/i.test(blob(michael))) {
  try {
    db.prepare("UPDATE family_members SET spouse_member_id = ? WHERE id = ?").run(michael.id, jeanette.id);
    db.prepare("UPDATE family_members SET spouse_member_id = ? WHERE id = ?").run(jeanette.id, michael.id);
  } catch (e) {
    console.warn("spouse link note:", e.message);
  }
}

// Reload
const all = db
  .prepare("SELECT id, full_name, preferred_name, role_in_family, family_branch, sort_order FROM family_members")
  .all();

const ordered = [];
const used = new Set();

function take(m) {
  if (!m || used.has(m.id)) return;
  ordered.push(m);
  used.add(m.id);
}

// Leader couples in home-page tribute order
const leaders = [
  findOne(all, [/anna/, /miotto/]),
  findOne(all, [/mickey|amerigo/, /miotto/]) || findOne(all, [/mickey|amerigo/]),
  findOne(all, [/tony|anthony/, /capoccia/]),
  findOne(all, [/fran|frances/, /capoccia/]),
  findOne(all, [/george/, /capoccia/]),
  findOne(all, [/christine/, /capoccia/]),
];
leaders.forEach(take);

// Foundational Capoccia parents if present
findAll(all, [/costanzo/, /capoccia/]).forEach(take);
findAll(all, [/maddalena|madeline|lena/, /capoccia|cervi/]).forEach(take);

// George's children before Seifert pair: David, Debbie, then Jeanette + Michael
findAll(all, [/david/, /capoccia/]).forEach(take);
findAll(all, [/debbie|deborah/, /fallucca|capoccia/]).forEach(take);

// Jeanette Capoccia Seifert then Michael Seifert (husband)
const j2 = findOne(all, [/jeanette/, /capoccia|seifert/]);
const m2 = all.find((m) => /seifert/i.test(blob(m)) && /michael|mike/i.test(blob(m)) && !/miotto/i.test(blob(m)));
take(j2);
take(m2);

// Remaining Capoccia-ish then Miotto then everyone else by name
const rest = all
  .filter((m) => !used.has(m.id))
  .sort((a, b) => {
    const ab = (a.family_branch || "").localeCompare(b.family_branch || "");
    if (ab) return ab;
    return (a.full_name || "").localeCompare(b.full_name || "");
  });
rest.forEach(take);

const upd = db.prepare("UPDATE family_members SET sort_order = ?, updated_at = datetime('now') WHERE id = ?");
const tx = db.transaction((list) => {
  list.forEach((m, i) => {
    // leave gaps of 10 for future inserts
    upd.run((i + 1) * 10, m.id);
  });
});
tx(ordered);

const after = db
  .prepare("SELECT id, full_name, preferred_name, sort_order FROM family_members ORDER BY sort_order ASC, full_name ASC")
  .all();
console.log(
  "After:",
  after.map((m) => `${m.sort_order}\t${m.id}\t${m.full_name} | ${m.preferred_name || ""}`).join("\n")
);
db.close();
console.log("DONE");
