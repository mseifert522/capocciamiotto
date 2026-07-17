const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const dbPath = [path.join(DATA_DIR, "archive.db"), path.join(DATA_DIR, "tribute.db")].find(
  (p) => fs.existsSync(p) && fs.statSync(p).size > 0
);
const db = new Database(dbPath);
db.prepare(
  `UPDATE family_members SET role_in_family = 'Capoccia Patriarch', is_patriarch = 1, updated_at = datetime('now')
   WHERE full_name LIKE '%Costanzo%Capoccia%'`
).run();
db.prepare(
  `UPDATE family_members SET role_in_family = 'Capoccia Matriarch', is_matriarch = 1, updated_at = datetime('now')
   WHERE full_name LIKE '%Maddalena%Capoccia%' OR preferred_name LIKE '%Madeline%Capoccia%' OR preferred_name LIKE '%Maddalena%'`
).run();
console.log(
  db
    .prepare(
      `SELECT full_name, role_in_family, is_patriarch, is_matriarch FROM family_members
       WHERE full_name LIKE '%Costanzo%' OR full_name LIKE '%Maddalena%' OR preferred_name LIKE '%Madeline%'`
    )
    .all()
);
db.close();
