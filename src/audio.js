const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(__dirname, "..", "public", "uploads");
const AUDIO_DIR = path.join(UPLOAD_ROOT, "audio");

fs.mkdirSync(AUDIO_DIR, { recursive: true });

const ALLOWED_AUDIO = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "audio/aac",
  "video/webm", // some browsers record audio-only as webm
]);

const EXT_BY_MIME = {
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/mp4": ".m4a",
  "audio/m4a": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/wav": ".wav",
  "audio/wave": ".wav",
  "audio/x-wav": ".wav",
  "audio/webm": ".webm",
  "audio/ogg": ".ogg",
  "audio/aac": ".aac",
  "video/webm": ".webm",
};

function isAllowedAudioMime(mime) {
  if (!mime) return false;
  if (ALLOWED_AUDIO.has(mime)) return true;
  return mime.startsWith("audio/");
}

function extensionFor(file) {
  const fromName = path.extname(file.originalname || "").toLowerCase();
  if ([".mp3", ".m4a", ".wav", ".webm", ".ogg", ".aac", ".mp4"].includes(fromName)) {
    return fromName === ".mp4" ? ".m4a" : fromName;
  }
  return EXT_BY_MIME[file.mimetype] || ".webm";
}

function saveAudioUpload(file) {
  const id = uuidv4();
  const ext = extensionFor(file);
  const base = `${id}${ext}`;
  const abs = path.join(AUDIO_DIR, base);
  fs.writeFileSync(abs, file.buffer);
  return {
    original_filename: file.originalname || base,
    file_path: `/uploads/audio/${base}`,
    mime_type: file.mimetype || "audio/webm",
    file_size: file.size || (file.buffer && file.buffer.length) || 0,
  };
}

module.exports = {
  isAllowedAudioMime,
  saveAudioUpload,
  AUDIO_DIR,
  UPLOAD_ROOT,
};
