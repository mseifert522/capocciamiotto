/**
 * One-shot: process Christine Capoccia portrait and set family_members.id=2.
 * Run inside prod-capocciamiotto container with source image at /tmp/christine-capoccia.jpg
 */
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const Database = require("better-sqlite3");

const SRC = process.env.SRC || "/tmp/christine-capoccia.jpg";
const MEMBER_ID = parseInt(process.env.MEMBER_ID || "2", 10);
const DATA_DIR = process.env.DATA_DIR || "/app/data";
const UPLOAD_DIR = process.env.UPLOAD_DIR || "/app/public/uploads";
const PORTRAITS_DIR = path.join(UPLOAD_DIR, "portraits");
const PUBLIC_PORTRAITS = "/app/public/portraits";

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error("Source image missing:", SRC);
    process.exit(1);
  }

  fs.mkdirSync(PORTRAITS_DIR, { recursive: true });
  fs.mkdirSync(PUBLIC_PORTRAITS, { recursive: true });

  const webName = "christine-capoccia.jpg";
  const thumbName = "christine-capoccia-thumb.jpg";
  const webPathUploads = path.join(PORTRAITS_DIR, webName);
  const thumbPathUploads = path.join(PORTRAITS_DIR, thumbName);
  const webPathPublic = path.join(PUBLIC_PORTRAITS, webName);
  const thumbPathPublic = path.join(PUBLIC_PORTRAITS, thumbName);

  const buf = fs.readFileSync(SRC);

  await sharp(buf, { failOn: "none" })
    .rotate()
    .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(webPathUploads);

  await sharp(buf, { failOn: "none" })
    .rotate()
    .resize({ width: 480, height: 480, fit: "cover" })
    .jpeg({ quality: 82 })
    .toFile(thumbPathUploads);

  // Also copy into image public/portraits (matches George URL style)
  fs.copyFileSync(webPathUploads, webPathPublic);
  fs.copyFileSync(thumbPathUploads, thumbPathPublic);

  // Persist under uploads volume so rebuilds keep the file via uploads path fallback
  const portraitUrl = "/uploads/portraits/christine-capoccia.jpg";

  const dbPath = fs.existsSync(path.join(DATA_DIR, "archive.db"))
    ? path.join(DATA_DIR, "archive.db")
    : path.join(DATA_DIR, "tribute.db");

  const db = new Database(dbPath);
  const before = db
    .prepare("SELECT id, full_name, preferred_name, portrait_path FROM family_members WHERE id = ?")
    .get(MEMBER_ID);
  if (!before) {
    console.error("Member not found:", MEMBER_ID);
    process.exit(1);
  }

  db.prepare(
    `UPDATE family_members SET portrait_path = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(portraitUrl, MEMBER_ID);

  // Also match by name if id differs in some DBs
  db.prepare(
    `UPDATE family_members
     SET portrait_path = ?, updated_at = datetime('now')
     WHERE id != ?
       AND (full_name LIKE '%Christine%Capoccia%' OR preferred_name LIKE '%Christine%Capoccia%'
            OR (full_name LIKE 'Christine%' AND full_name LIKE '%Capoccia%'))`
  ).run(portraitUrl, MEMBER_ID);

  const after = db
    .prepare("SELECT id, full_name, preferred_name, portrait_path FROM family_members WHERE id = ?")
    .get(MEMBER_ID);

  console.log(JSON.stringify({ dbPath, before, after, files: { webPathUploads, webPathPublic } }, null, 2));
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
