/**
 * Community board photo + video attachments.
 */
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const { v4: uuidv4 } = require("uuid");

const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(__dirname, "..", "public", "uploads");
const BOARD_IMG = path.join(UPLOAD_ROOT, "board", "images");
const BOARD_THUMB = path.join(UPLOAD_ROOT, "board", "thumbs");
const BOARD_VID = path.join(UPLOAD_ROOT, "board", "videos");

[BOARD_IMG, BOARD_THUMB, BOARD_VID].forEach((d) => fs.mkdirSync(d, { recursive: true }));

const IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const VIDEO_MIMES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
]);

function isBoardImageMime(mime) {
  return IMAGE_MIMES.has(mime) || (mime && mime.startsWith("image/"));
}

function isBoardVideoMime(mime) {
  return VIDEO_MIMES.has(mime) || (mime && mime.startsWith("video/"));
}

function isBoardMediaMime(mime) {
  return isBoardImageMime(mime) || isBoardVideoMime(mime);
}

function safeExt(originalName, fallback) {
  const ext = path.extname(originalName || "").toLowerCase();
  if (ext && ext.length <= 8 && /^\.[a-z0-9.]+$/i.test(ext)) return ext;
  return fallback;
}

async function processBoardImage(file) {
  const id = uuidv4();
  const ext = safeExt(file.originalname, ".jpg");
  const safe = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext) ? ext : ".jpg";
  const base = `${id}${safe}`;
  const originalPath = path.join(BOARD_IMG, base);
  const webName = `${id}.jpg`;
  const thumbName = `${id}.jpg`;
  const webPath = path.join(BOARD_IMG, webName);
  const thumbPath = path.join(BOARD_THUMB, thumbName);

  fs.writeFileSync(originalPath, file.buffer);

  try {
    const pipeline = sharp(file.buffer, { failOn: "none" }).rotate();
    await pipeline
      .clone()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toFile(webPath);
    await sharp(file.buffer, { failOn: "none" })
      .rotate()
      .resize({ width: 480, height: 480, fit: "cover" })
      .jpeg({ quality: 80 })
      .toFile(thumbPath);
  } catch (_) {
    fs.copyFileSync(originalPath, webPath);
    fs.copyFileSync(originalPath, thumbPath);
  }

  // Prefer web jpg path for display when different from original
  const displayPath = fs.existsSync(webPath)
    ? `/uploads/board/images/${webName}`
    : `/uploads/board/images/${base}`;

  return {
    media_type: "image",
    original_filename: file.originalname || base,
    file_path: displayPath,
    thumb_path: `/uploads/board/thumbs/${thumbName}`,
    mime_type: file.mimetype || "image/jpeg",
    file_size: file.size || null,
  };
}

function processBoardVideo(file) {
  const id = uuidv4();
  const ext = safeExt(file.originalname, ".mp4");
  const allowed = [".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"];
  const safe = allowed.includes(ext) ? ext : ".mp4";
  const base = `${id}${safe}`;
  const dest = path.join(BOARD_VID, base);
  fs.writeFileSync(dest, file.buffer);

  return {
    media_type: "video",
    original_filename: file.originalname || base,
    file_path: `/uploads/board/videos/${base}`,
    thumb_path: null,
    mime_type: file.mimetype || "video/mp4",
    file_size: file.size || null,
  };
}

async function processBoardFile(file) {
  if (!file) throw new Error("No file");
  if (isBoardVideoMime(file.mimetype)) return processBoardVideo(file);
  if (isBoardImageMime(file.mimetype)) return processBoardImage(file);
  throw new Error("Unsupported media type");
}

function ensureBoardMediaTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS board_post_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_post_id INTEGER NOT NULL,
      media_type TEXT NOT NULL DEFAULT 'image',
      original_filename TEXT,
      file_path TEXT NOT NULL,
      thumb_path TEXT,
      mime_type TEXT,
      file_size INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (board_post_id) REFERENCES board_posts(id)
    );
    CREATE INDEX IF NOT EXISTS idx_board_media_post ON board_post_media(board_post_id);
  `);
  // Allow posts that are media-first (empty body still stored as '')
  try {
    db.prepare("UPDATE board_posts SET body = '' WHERE body IS NULL").run();
  } catch (_) { /* ignore */ }
}

function mediaForPosts(db, postIds) {
  if (!postIds || !postIds.length) return {};
  ensureBoardMediaTable(db);
  const placeholders = postIds.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT * FROM board_post_media
    WHERE board_post_id IN (${placeholders})
    ORDER BY sort_order ASC, id ASC
  `).all(...postIds);
  const map = {};
  for (const row of rows) {
    if (!map[row.board_post_id]) map[row.board_post_id] = [];
    map[row.board_post_id].push(row);
  }
  return map;
}

module.exports = {
  processBoardFile,
  isBoardMediaMime,
  isBoardImageMime,
  isBoardVideoMime,
  ensureBoardMediaTable,
  mediaForPosts,
};
