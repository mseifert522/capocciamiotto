/**
 * Set Ron Fallucca portrait from a local image path.
 * Usage: node scripts/set-ron-fallucca-portrait.js /path/to/image.jpg
 */
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const { processUpload } = require("../src/photos");

async function main() {
  const imagePath = process.argv[2];
  if (!imagePath || !fs.existsSync(imagePath)) {
    console.error("Usage: node scripts/set-ron-fallucca-portrait.js <image>");
    process.exit(1);
  }

  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
  const candidates = [
    process.env.DB_PATH,
    path.join(DATA_DIR, "archive.db"),
    path.join(DATA_DIR, "tribute.db"),
  ].filter(Boolean);
  const dbPath = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).size > 0) || candidates[0];
  const db = new Database(dbPath);

  let member = db
    .prepare(
      `
    SELECT id, full_name, preferred_name, portrait_path FROM family_members
    WHERE full_name LIKE '%Ron%Falluc%'
       OR preferred_name LIKE '%Ron%Falluc%'
       OR full_name LIKE '%Ronald%Falluc%'
       OR preferred_name LIKE '%Ronald%Falluc%'
    ORDER BY id ASC LIMIT 1
  `
    )
    .get();

  if (!member) {
    console.error("Ron Fallucca not found in family_members");
    process.exit(1);
  }

  const buf = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase() || ".jpg";
  const mime =
    ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  const processed = await processUpload({
    buffer: buf,
    originalname: "ron-fallucca" + (ext === ".png" ? ".png" : ".jpg"),
    mimetype: mime,
    size: buf.length,
  });

  const portraitUrl = processed.web_path || processed.original_path;
  db.prepare(
    `
    UPDATE family_members
    SET portrait_path = ?,
        full_name = 'Ron Fallucca',
        preferred_name = 'Ron Fallucca',
        visibility = 'public',
        updated_at = datetime('now')
    WHERE id = ?
  `
  ).run(portraitUrl, member.id);

  let photoId = null;
  try {
    const existing = db
      .prepare(
        `
      SELECT id FROM photos
      WHERE web_path = ? OR original_path = ? OR thumb_path = ?
      LIMIT 1
    `
      )
      .get(portraitUrl, processed.original_path, processed.thumb_path);

    if (existing) {
      photoId = existing.id;
      db.prepare(
        `
        UPDATE photos SET
          title = 'Ron Fallucca',
          status = 'approved',
          may_display_public = 1,
          related_member_id = COALESCE(related_member_id, ?),
          web_path = COALESCE(web_path, ?),
          thumb_path = COALESCE(thumb_path, ?),
          original_path = COALESCE(original_path, ?)
        WHERE id = ?
      `
      ).run(member.id, processed.web_path, processed.thumb_path, processed.original_path, photoId);
    } else {
      const info = db
        .prepare(
          `
        INSERT INTO photos (
          original_filename, original_path, web_path, thumb_path,
          title, description, reunion_year, family_branch,
          contributor_name, permission_confirmed, may_display_public,
          status, featured, file_size, mime_type, width, height, reviewed_at,
          related_member_id
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'Capoccia', ?, 1, 1, 'approved', 0, ?, ?, ?, ?, datetime('now'), ?)
      `
        )
        .run(
          processed.original_filename,
          processed.original_path,
          processed.web_path,
          processed.thumb_path,
          "Ron Fallucca",
          "Portrait of Ron Fallucca",
          "Family archive",
          processed.file_size,
          processed.mime_type,
          processed.width,
          processed.height,
          member.id
        );
      photoId = info.lastInsertRowid;
    }
  } catch (e) {
    console.warn("photo catalog note:", e.message);
  }

  const row = db
    .prepare("SELECT id, full_name, preferred_name, portrait_path FROM family_members WHERE id = ?")
    .get(member.id);
  console.log(JSON.stringify({ ok: true, member: row, photoId, paths: processed }, null, 2));
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
