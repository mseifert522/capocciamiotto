/**
 * Update George & Joseph Capoccia twins photo title + heartwarming description.
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

const title = "George and Joseph Capoccia, Twin Brothers";
const description =
  "George and Joseph Capoccia as little twin brothers — two hearts side by side. " +
  "Joseph was taken from us far too soon, still a toddler, and his life was brief but deeply loved. " +
  "He lives on in this photograph and in the family who still holds him close. " +
  "We will always remember Joseph.";

// Find twins photo by title / special memory content
const rows = db
  .prepare(
    `
  SELECT id, title, description, special_memory, web_path
  FROM photos
  WHERE lower(coalesce(title,'')) LIKE '%george%joseph%'
     OR lower(coalesce(title,'')) LIKE '%joseph%george%'
     OR lower(coalesce(title,'')) LIKE '%twin%'
     OR lower(coalesce(description,'')) LIKE '%twin%'
  ORDER BY id DESC
`
  )
  .all();

console.log("Candidates:", JSON.stringify(rows, null, 2));

let updated = 0;
const stmt = db.prepare(`
  UPDATE photos
  SET title = ?,
      description = ?,
      status = 'approved',
      may_display_public = 1
  WHERE id = ?
`);

for (const r of rows) {
  const blob = `${r.title || ""} ${r.description || ""}`.toLowerCase();
  if (
    (blob.includes("george") && (blob.includes("joseph") || blob.includes("josef"))) ||
    (blob.includes("twin") && blob.includes("capoccia"))
  ) {
    stmt.run(title, description, r.id);
    updated += 1;
    console.log("Updated photo id", r.id);
  }
}

// Also update if only one special memory with Capoccia twins path pattern
if (!updated) {
  const special = db
    .prepare(
      `
    SELECT id, title FROM photos
    WHERE COALESCE(special_memory, 0) = 1
    ORDER BY special_sort ASC, id DESC
  `
    )
    .all();
  console.log("Special memories:", special);
  // Prefer first special memory that looks like twins / has no better match
  const twinish = special.find((p) => /george|joseph|twin|brother/i.test(p.title || ""));
  if (twinish) {
    stmt.run(title, description, twinish.id);
    updated += 1;
    console.log("Updated special memory id", twinish.id);
  }
}

const check = db
  .prepare(
    `
  SELECT id, title, description, special_memory, special_sort
  FROM photos
  WHERE title LIKE '%George and Joseph%'
`
  )
  .all();
console.log("Result:", JSON.stringify(check, null, 2));
console.log("updated", updated);
db.close();
