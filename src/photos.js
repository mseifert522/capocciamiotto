const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const { v4: uuidv4 } = require("uuid");

const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(__dirname, "..", "public", "uploads");
const ORIG = path.join(UPLOAD_ROOT, "originals");
const WEB = path.join(UPLOAD_ROOT, "web");
const THUMB = path.join(UPLOAD_ROOT, "thumbs");

[ORIG, WEB, THUMB].forEach((d) => fs.mkdirSync(d, { recursive: true }));

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);

function isAllowedMime(mime) {
  return ALLOWED.has(mime) || (mime && mime.startsWith("image/"));
}

async function processUpload(file) {
  const id = uuidv4();
  const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
  const safeExt = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext) ? ext : ".jpg";
  const base = `${id}${safeExt}`;
  const originalPath = path.join(ORIG, base);
  const webName = `${id}.jpg`;
  const thumbName = `${id}.jpg`;
  const webPath = path.join(WEB, webName);
  const thumbPath = path.join(THUMB, thumbName);

  // Preserve original bytes
  fs.writeFileSync(originalPath, file.buffer);

  let meta = { width: null, height: null };
  try {
    const pipeline = sharp(file.buffer, { failOn: "none" }).rotate();
    meta = await pipeline.metadata();
    await pipeline
      .clone()
      .resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toFile(webPath);
    await sharp(file.buffer, { failOn: "none" })
      .rotate()
      .resize({ width: 480, height: 480, fit: "cover" })
      .jpeg({ quality: 80 })
      .toFile(thumbPath);
  } catch (err) {
    // If sharp fails, still keep original and copy as web
    fs.copyFileSync(originalPath, webPath);
    fs.copyFileSync(originalPath, thumbPath);
  }

  return {
    original_filename: file.originalname,
    original_path: `/uploads/originals/${base}`,
    web_path: `/uploads/web/${webName}`,
    thumb_path: `/uploads/thumbs/${thumbName}`,
    file_size: file.size,
    mime_type: file.mimetype,
    width: meta.width || null,
    height: meta.height || null,
  };
}

module.exports = { processUpload, isAllowedMime, UPLOAD_ROOT };
