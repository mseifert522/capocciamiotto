/**
 * Fix Anna Capoccia Miotto portrait (broken /portraits/anna-miotto-portrait.jpg).
 * Run inside prod-capocciamiotto with SRC image available.
 */
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const Database = require("better-sqlite3");

const SRC = process.env.SRC || "/tmp/anna-miotto-source.jpg";
const DATA_DIR = process.env.DATA_DIR || "/app/data";
const UPLOAD_DIR = process.env.UPLOAD_DIR || "/app/public/uploads";
const PORTRAITS_UPLOAD = path.join(UPLOAD_DIR, "portraits");
const PUBLIC_PORTRAITS = "/app/public/portraits";

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error("Source image missing:", SRC);
    process.exit(1);
  }

  fs.mkdirSync(PORTRAITS_UPLOAD, { recursive: true });
  fs.mkdirSync(PUBLIC_PORTRAITS, { recursive: true });

  const webName = "anna-miotto-portrait.jpg";
  const thumbName = "anna-miotto-portrait-thumb.jpg";
  const webUploads = path.join(PORTRAITS_UPLOAD, webName);
  const thumbUploads = path.join(PORTRAITS_UPLOAD, thumbName);
  const webPublic = path.join(PUBLIC_PORTRAITS, webName);
  const thumbPublic = path.join(PUBLIC_PORTRAITS, thumbName);

  const buf = fs.readFileSync(SRC);

  await sharp(buf, { failOn: "none" })
    .rotate()
    .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(webUploads);

  await sharp(buf, { failOn: "none" })
    .rotate()
    .resize({ width: 480, height: 480, fit: "cover", position: "attention" })
    .jpeg({ quality: 82 })
    .toFile(thumbUploads);

  // Keep legacy /portraits/ URL working (DB may still point here)
  fs.copyFileSync(webUploads, webPublic);
  fs.copyFileSync(thumbUploads, thumbPublic);

  // Prefer durable uploads volume path
  const portraitUrl = "/uploads/portraits/anna-miotto-portrait.jpg";
  // Also keep public path copy for any hardcoded /portraits/ references
  const legacyUrl = "/portraits/anna-miotto-portrait.jpg";

  const dbPath = fs.existsSync(path.join(DATA_DIR, "archive.db"))
    ? path.join(DATA_DIR, "archive.db")
    : path.join(DATA_DIR, "tribute.db");

  const db = new Database(dbPath);

  const before = db
    .prepare(
      `SELECT id, full_name, preferred_name, portrait_path
       FROM family_members
       WHERE full_name LIKE '%Anna%' OR preferred_name LIKE '%Anna%'
          OR id = 4
       ORDER BY id`
    )
    .all();

  const result = db
    .prepare(
      `UPDATE family_members
       SET portrait_path = ?, updated_at = datetime('now')
       WHERE full_name LIKE '%Anna%Miotto%'
          OR preferred_name LIKE '%Anna%Miotto%'
          OR preferred_name LIKE '%Anna%Capoccia%'
          OR (full_name LIKE 'Anna%' AND (full_name LIKE '%Miotto%' OR full_name LIKE '%Capoccia%'))
          OR id = 4`
    )
    .run(portraitUrl);

  // If anything still points at the broken legacy path only, leave both files present
  const after = db
    .prepare(
      `SELECT id, full_name, preferred_name, portrait_path
       FROM family_members
       WHERE full_name LIKE '%Anna%' OR preferred_name LIKE '%Anna%' OR id = 4
       ORDER BY id`
    )
    .all();

  console.log(
    JSON.stringify(
      {
        dbPath,
        portraitUrl,
        legacyUrl,
        changes: result.changes,
        before,
        after,
        files: { webUploads, webPublic, size: fs.statSync(webUploads).size },
      },
      null,
      2
    )
  );
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
