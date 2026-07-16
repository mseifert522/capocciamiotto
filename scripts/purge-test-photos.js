/**
 * Delete automation/health-check photos from the live SQLite archive.
 * Run: node scripts/purge-test-photos.js
 * Or: docker exec prod-capocciamiotto node /app/scripts/purge-test-photos.js
 */
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const dir = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const p = fs.existsSync(path.join(dir, "archive.db"))
  ? path.join(dir, "archive.db")
  : path.join(dir, "tribute.db");

console.log("db", p);
if (!fs.existsSync(p)) {
  console.error("database not found");
  process.exit(1);
}

const db = new Database(p);
const where = `
  lower(coalesce(title,'')) LIKE '%auto-approve%'
  OR lower(coalesce(title,'')) LIKE '%auto approve%'
  OR lower(coalesce(title,'')) LIKE '%bulk multi%'
  OR lower(coalesce(title,'')) LIKE '%second automated%'
  OR lower(coalesce(title,'')) LIKE '%automated functionality%'
  OR lower(coalesce(title,'')) LIKE '%cmfr test%'
  OR lower(coalesce(contributor_name,'')) LIKE '%automated health%'
  OR lower(coalesce(contributor_name,'')) LIKE '%auto approve%'
  OR lower(coalesce(contributor_email,'')) = 'healthcheck@example.com'
  OR lower(coalesce(description,'')) LIKE '%functionality test%'
  OR lower(coalesce(description,'')) LIKE '%safe to delete%'
  OR lower(coalesce(description,'')) LIKE '%automated health test%'
`;

const ids = db.prepare("SELECT id, title FROM photos WHERE " + where).all();
const delP = db.prepare("DELETE FROM photo_people WHERE photo_id = ?");
const del = db.prepare("DELETE FROM photos WHERE id = ?");
const tx = db.transaction(() => {
  for (const r of ids) {
    delP.run(r.id);
    del.run(r.id);
  }
});
tx();
console.log("purged_photos", ids.length);
ids.forEach((r) => console.log(" -", r.id, r.title));

try {
  const posts = db.prepare("SELECT id, title, author_name FROM board_posts").all();
  let n = 0;
  for (const post of posts) {
    const blob = `${post.title || ""} ${post.author_name || ""}`.toLowerCase();
    if (/automated health|open publish|board photo health|family auto-publish|auto-approve|bulk multi/.test(blob)) {
      try {
        db.prepare("DELETE FROM board_post_media WHERE board_post_id = ?").run(post.id);
      } catch (_) { /* ignore */ }
      db.prepare("DELETE FROM board_posts WHERE id = ?").run(post.id);
      n += 1;
      console.log(" purged board", post.id, post.title);
    }
  }
  console.log("purged_board_posts", n);
} catch (e) {
  console.warn("board purge note", e.message);
}

try {
  const r = db.prepare(`
    UPDATE family_members
    SET portrait_path = '/portraits/george-capoccia-army.jpg', updated_at = datetime('now')
    WHERE full_name LIKE '%George%Capoccia%' OR preferred_name LIKE '%George%Capoccia%'
  `).run();
  console.log("george_portrait_rows", r.changes);
} catch (e) {
  console.warn("george restore", e.message);
}

console.log("done");
