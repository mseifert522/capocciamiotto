const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "archive.db");

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      name TEXT,
      phone TEXT,
      role TEXT NOT NULL DEFAULT 'public_visitor',
      email_verified INTEGER NOT NULL DEFAULT 0,
      two_factor_secret TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS family_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      preferred_name TEXT,
      maiden_name TEXT,
      nickname TEXT,
      family_branch TEXT,
      is_patriarch INTEGER NOT NULL DEFAULT 0,
      is_matriarch INTEGER NOT NULL DEFAULT 0,
      birth_date TEXT,
      birth_date_display TEXT,
      death_date TEXT,
      death_date_display TEXT,
      role_in_family TEXT,
      biography TEXT,
      favorite_memories TEXT,
      quotes TEXT,
      portrait_path TEXT,
      is_placeholder INTEGER NOT NULL DEFAULT 1,
      is_memorial INTEGER NOT NULL DEFAULT 0,
      visibility TEXT NOT NULL DEFAULT 'public',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reunions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER UNIQUE NOT NULL,
      title TEXT,
      date_text TEXT,
      location TEXT,
      host_family TEXT,
      cover_photo_path TEXT,
      summary TEXT,
      no_reunion INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_filename TEXT,
      original_path TEXT NOT NULL,
      web_path TEXT,
      thumb_path TEXT,
      title TEXT,
      description TEXT,
      reunion_year INTEGER,
      year_approximate INTEGER NOT NULL DEFAULT 0,
      year_unknown INTEGER NOT NULL DEFAULT 0,
      family_branch TEXT,
      location TEXT,
      photo_date TEXT,
      original_owner TEXT,
      photographer TEXT,
      contributor_name TEXT,
      contributor_email TEXT,
      contributor_phone TEXT,
      permission_confirmed INTEGER NOT NULL DEFAULT 0,
      may_display_public INTEGER NOT NULL DEFAULT 1,
      visibility TEXT NOT NULL DEFAULT 'public',
      status TEXT NOT NULL DEFAULT 'pending',
      copyright_note TEXT,
      admin_notes TEXT,
      featured INTEGER NOT NULL DEFAULT 0,
      file_size INTEGER,
      mime_type TEXT,
      width INTEGER,
      height INTEGER,
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      reviewed_at TEXT,
      reviewed_by INTEGER,
      FOREIGN KEY (reunion_year) REFERENCES reunions(year),
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS photo_people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_id INTEGER NOT NULL,
      person_name TEXT NOT NULL,
      family_member_id INTEGER,
      is_identified INTEGER NOT NULL DEFAULT 1,
      is_suggestion INTEGER NOT NULL DEFAULT 0,
      suggested_by TEXT,
      status TEXT NOT NULL DEFAULT 'approved',
      FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
      FOREIGN KEY (family_member_id) REFERENCES family_members(id)
    );

    CREATE TABLE IF NOT EXISTS stories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reunion_year INTEGER,
      family_member_id INTEGER,
      title TEXT,
      body TEXT NOT NULL,
      contributor_name TEXT,
      contributor_email TEXT,
      story_type TEXT NOT NULL DEFAULT 'memory',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (reunion_year) REFERENCES reunions(year),
      FOREIGN KEY (family_member_id) REFERENCES family_members(id)
    );

    CREATE TABLE IF NOT EXISTS board_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      author_name TEXT,
      author_email TEXT,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memorials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      family_member_id INTEGER,
      full_name TEXT NOT NULL,
      portrait_path TEXT,
      dates_text TEXT,
      relationship TEXT,
      biography TEXT,
      favorite_memories TEXT,
      quotes TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (family_member_id) REFERENCES family_members(id)
    );

    CREATE TABLE IF NOT EXISTS contributions_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      ref_id INTEGER,
      payload_json TEXT,
      contributor_name TEXT,
      contributor_email TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_photos_status ON photos(status);
    CREATE INDEX IF NOT EXISTS idx_photos_year ON photos(reunion_year);
    CREATE INDEX IF NOT EXISTS idx_reunions_year ON reunions(year);
    CREATE INDEX IF NOT EXISTS idx_board_status ON board_posts(status);
  `);

  // Seed reunions 1977 → current year
  const currentYear = new Date().getFullYear();
  const insertReunion = db.prepare(`
    INSERT OR IGNORE INTO reunions (year, title) VALUES (?, ?)
  `);
  const seedReunions = db.transaction(() => {
    for (let y = 1977; y <= currentYear + 1; y++) {
      insertReunion.run(y, `${y} Capocia–Miotto Family Reunion`);
    }
  });
  seedReunions();

  // Seed patriarch / matriarch placeholders
  const countMembers = db.prepare("SELECT COUNT(*) AS c FROM family_members").get().c;
  if (countMembers === 0) {
    db.prepare(`
      INSERT INTO family_members
        (full_name, preferred_name, family_branch, is_patriarch, is_matriarch, role_in_family, biography, is_placeholder, sort_order)
      VALUES
        ('George Capocia', 'George Capocia', 'Capocia', 1, 0, 'Capocia patriarch', NULL, 1, 1),
        ('Christine Capocia', 'Christine Capocia', 'Capocia', 0, 1, 'Capocia matriarch', NULL, 1, 2),
        ('Miotto Patriarch (placeholder)', NULL, 'Miotto', 1, 0, 'Miotto patriarch — name to be confirmed by family', NULL, 1, 10),
        ('Miotto Matriarch (placeholder)', NULL, 'Miotto', 0, 1, 'Miotto matriarch — name to be confirmed by family', NULL, 1, 11)
    `).run();
  }

  // Super admin
  const adminEmail = process.env.ADMIN_EMAIL || "info@seifertcapital.com";
  const adminPass = process.env.ADMIN_PASSWORD || "ChangeMe-Capocia2026!";
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(adminEmail);
  if (!existing) {
    const hash = bcrypt.hashSync(adminPass, 12);
    db.prepare(`
      INSERT INTO users (email, password_hash, name, role, email_verified)
      VALUES (?, ?, ?, 'super_admin', 1)
    `).run(adminEmail, hash, "Family Administrator");
  }

  // Welcome board post
  const boardCount = db.prepare("SELECT COUNT(*) AS c FROM board_posts").get().c;
  if (boardCount === 0) {
    db.prepare(`
      INSERT INTO board_posts (title, body, category, author_name, is_pinned, status)
      VALUES (?, ?, 'announcement', 'Family Administrators', 1, 'approved')
    `).run(
      "Welcome to Our Family Community Board",
      "This is a safe gathering place for Capocia and Miotto family news, reunion planning, photo requests, and messages. Posts are moderated so our tribute remains respectful for every generation. Please help us collect photographs and memories from reunions since 1977."
    );
  }

  // Settings
  const set = db.prepare("INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)");
  set.run("site_name", "The Capocia–Miotto Family Reunion Tribute");
  set.run("founded_year", "1977");
  set.run("matriarch_name_capocia", "Christine Capocia");
}

migrate();

module.exports = db;
