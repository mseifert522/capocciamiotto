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

    CREATE TABLE IF NOT EXISTS family_pins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pin_code TEXT NOT NULL UNIQUE,
      assigned_name TEXT NOT NULL,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      use_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by INTEGER,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_family_pins_code ON family_pins(pin_code);
    CREATE INDEX IF NOT EXISTS idx_photos_status ON photos(status);
    CREATE INDEX IF NOT EXISTS idx_photos_year ON photos(reunion_year);
    CREATE INDEX IF NOT EXISTS idx_reunions_year ON reunions(year);
    CREATE INDEX IF NOT EXISTS idx_board_status ON board_posts(status);

    CREATE TABLE IF NOT EXISTS family_member_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      preferred_name TEXT,
      maiden_name TEXT,
      family_branch TEXT NOT NULL DEFAULT 'both',
      role_in_family TEXT,
      relation_to_family TEXT,
      generation_note TEXT,
      short_bio TEXT,
      contributor_name TEXT,
      contributor_email TEXT,
      contributor_phone TEXT,
      pin_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      family_member_id INTEGER,
      admin_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      reviewed_at TEXT,
      reviewed_by INTEGER,
      FOREIGN KEY (pin_id) REFERENCES family_pins(id),
      FOREIGN KEY (family_member_id) REFERENCES family_members(id),
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_member_submissions_status ON family_member_submissions(status);

    CREATE TABLE IF NOT EXISTS voice_recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      speaker_name TEXT NOT NULL,
      family_member_id INTEGER,
      family_branch TEXT,
      recording_type TEXT NOT NULL DEFAULT 'story',
      original_filename TEXT,
      file_path TEXT NOT NULL,
      mime_type TEXT,
      file_size INTEGER,
      duration_seconds INTEGER,
      recorded_year INTEGER,
      contributor_name TEXT,
      contributor_email TEXT,
      contributor_phone TEXT,
      pin_id INTEGER,
      permission_confirmed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      featured INTEGER NOT NULL DEFAULT 0,
      admin_notes TEXT,
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      reviewed_at TEXT,
      reviewed_by INTEGER,
      FOREIGN KEY (family_member_id) REFERENCES family_members(id),
      FOREIGN KEY (pin_id) REFERENCES family_pins(id),
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_voice_status ON voice_recordings(status);
    CREATE INDEX IF NOT EXISTS idx_voice_member ON voice_recordings(family_member_id);
  `);

  // Seed reunions 1977 → current year only (no future years)
  const currentYear = new Date().getFullYear();
  const insertReunion = db.prepare(`
    INSERT OR IGNORE INTO reunions (year, title) VALUES (?, ?)
  `);
  const seedReunions = db.transaction(() => {
    for (let y = 1977; y <= currentYear; y++) {
      insertReunion.run(y, `${y} Capoccia–Miotto Family Reunion`);
    }
  });
  seedReunions();
  // Drop any future-year placeholder reunions that were seeded earlier
  db.prepare("DELETE FROM reunions WHERE year > ?").run(currentYear);

  // Seed / refresh patriarch & matriarch tributes (idempotent)
  seedFamilyTributes();

  // Living family tree columns + patriarch/matriarch lineage anchors
  try {
    const { ensureTreeColumns, seedLeaderTreeMeta } = require("./familyTree");
    ensureTreeColumns(db);
    seedLeaderTreeMeta(db);
  } catch (e) {
    console.warn("family tree migration note:", e.message);
  }

  // Super admin
  const adminEmail = process.env.ADMIN_EMAIL || "info@seifertcapital.com";
  const adminPass = process.env.ADMIN_PASSWORD || "ChangeMe-Capoccia2026!";
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
      "This is a safe gathering place for Capoccia and Miotto family news, reunion planning, photo requests, and messages. Posts are moderated so our tribute remains respectful for every generation. Please help us collect photographs and memories from reunions since 1977."
    );
  }

  // Settings
  const set = db.prepare("INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)");
  set.run("site_name", "The Capoccia–Miotto Family Reunion Tribute");
  set.run("founded_year", "1977");
  set.run("matriarch_name_capoccia", "Christine Capoccia");

  // Spelling corrections (Capocia → Capoccia) for existing data
  try {
    db.prepare(`UPDATE family_members SET full_name = REPLACE(full_name, 'Capocia', 'Capoccia') WHERE full_name LIKE '%Capocia%'`).run();
    db.prepare(`UPDATE family_members SET preferred_name = REPLACE(preferred_name, 'Capocia', 'Capoccia') WHERE preferred_name LIKE '%Capocia%'`).run();
    db.prepare(`UPDATE family_members SET family_branch = 'Capoccia' WHERE family_branch = 'Capocia'`).run();
    db.prepare(`UPDATE family_members SET role_in_family = REPLACE(role_in_family, 'Capocia', 'Capoccia') WHERE role_in_family LIKE '%Capocia%'`).run();
    db.prepare(`UPDATE reunions SET title = REPLACE(title, 'Capocia', 'Capoccia') WHERE title LIKE '%Capocia%'`).run();
    db.prepare(`UPDATE photos SET family_branch = 'Capoccia' WHERE family_branch = 'Capocia'`).run();
    db.prepare(`UPDATE board_posts SET body = REPLACE(body, 'Capocia', 'Capoccia') WHERE body LIKE '%Capocia%'`).run();
    db.prepare(`UPDATE site_settings SET value = REPLACE(value, 'Capocia', 'Capoccia') WHERE value LIKE '%Capocia%'`).run();
    // migrate old setting key
    const oldKey = db.prepare("SELECT value FROM site_settings WHERE key = 'matriarch_name_capocia'").get();
    const midKey = db.prepare("SELECT value FROM site_settings WHERE key = 'matriarch_name_Capoccia'").get();
    if (oldKey && !db.prepare("SELECT 1 FROM site_settings WHERE key = 'matriarch_name_capoccia'").get()) {
      db.prepare("INSERT OR REPLACE INTO site_settings (key, value) VALUES ('matriarch_name_capoccia', ?)").run(
        String(oldKey.value).replace(/Capocia/g, "Capoccia")
      );
    }
    if (midKey) {
      db.prepare("INSERT OR REPLACE INTO site_settings (key, value) VALUES ('matriarch_name_capoccia', ?)").run(
        String(midKey.value).replace(/Capocia/g, "Capoccia")
      );
      db.prepare("DELETE FROM site_settings WHERE key = 'matriarch_name_Capoccia'").run();
    }
    db.prepare("UPDATE site_settings SET key = 'matriarch_name_capoccia' WHERE key = 'matriarch_name_capocia'").run();
  } catch (e) {
    console.warn("spelling migration note:", e.message);
  }
}

function seedFamilyTributes() {
  const tributes = [
    {
      full_name: "George Capoccia",
      preferred_name: "George G. Capoccia",
      nickname: "George G. Capoccia",
      family_branch: "Capoccia",
      is_patriarch: 1,
      is_matriarch: 0,
      is_memorial: 0,
      is_placeholder: 0,
      sort_order: 1,
      birth_date: "1933-01-25",
      birth_date_display: "January 25, 1933 · Detroit, Michigan",
      death_date: null,
      death_date_display: null,
      role_in_family: "Capoccia Patriarch",
      biography:
        "Born January 25, 1933, in Detroit, Michigan, George G. Capoccia is the beloved living patriarch of the Capoccia family — a man whose quiet strength, unwavering faith, and deep love have guided our family for nearly a century.\n\n" +
        "Son of Costanzo and Madeline Capoccia, George grew up in the warm Italian neighborhoods of Detroit with his brother Tony and sister Anna. Married for decades to his cherished wife Christine, George has been the steady heart of the Capoccia–Miotto reunions since they began in 1977. From the bustling streets of Detroit to the welcoming homes of Warren and Farmington Hills, he has carried forward the proud heritage of Alvito and Frosinone with grace and devotion.\n\n" +
        "Today, George continues to be the living link that holds us all together. His presence is a blessing, his wisdom a gift, and his love the foundation upon which our family stands. We are forever grateful to call him our patriarch.",
      favorite_memories:
        "Share your favorite memories and stories of George — family contributions welcome.",
      quotes: null,
    },
    {
      full_name: "Christine Capoccia",
      preferred_name: "Christine E. Capoccia",
      nickname: "Christine E. Capoccia",
      family_branch: "Capoccia",
      is_patriarch: 0,
      is_matriarch: 1,
      is_memorial: 0,
      is_placeholder: 0,
      sort_order: 2,
      birth_date: null,
      birth_date_display: null,
      death_date: null,
      death_date_display: null,
      role_in_family: "Capoccia Matriarch",
      biography:
        "Christine E. Capoccia is the beloved matriarch of the Capoccia family — a woman of grace, warmth, and boundless love whose gentle spirit has been the heart of our family for generations.\n\n" +
        "Married to George, Christine has stood faithfully beside him, creating a home filled with Italian tradition, faith, and joy. Together they have nurtured the Capoccia–Miotto reunions since 1977, opening their hearts to every branch of the family. Her kindness and devotion reflect the beautiful heritage our ancestors brought from Italy to Detroit and later to the suburbs of Farmington Hills.\n\n" +
        "Christine’s elegant presence and loving embrace continue to inspire us all. She is more than our matriarch — she is the soul of the Capoccia family we cherish so deeply.",
      favorite_memories:
        "Share your favorite memories and stories of Christine — family contributions welcome.",
      quotes: null,
    },
    {
      full_name: "Amerigo “Mickey” Miotto",
      preferred_name: "Amerigo “Mickey” Miotto",
      nickname: "Mickey",
      family_branch: "Miotto",
      is_patriarch: 1,
      is_matriarch: 0,
      is_memorial: 1,
      is_placeholder: 0,
      sort_order: 5,
      birth_date: null,
      birth_date_display: null,
      death_date: null,
      death_date_display: null,
      role_in_family: "Miotto Patriarch",
      biography:
        "Amerigo “Mickey” Miotto was the beloved patriarch of the Miotto family and the loving husband of Anna M. Capoccia Miotto for 65 beautiful years. Through his marriage to Anna — sister of Tony and George Capoccia — Mickey became the warm bridge that forever united the Capoccia and Miotto families.\n\n" +
        "Together, Mickey and Anna built a home rich in faith, laughter, and Italian tradition. They raised five wonderful children and left a legacy of 14 grandchildren and 14 great-grandchildren who continue the family reunions with joy. Mickey’s kindness and steadfast spirit live on in every gathering, reminding us that love is the true foundation of our shared heritage.\n\n" +
        "His memory is a cherished blessing that strengthens the Capoccia–Miotto bond with every passing year.",
      favorite_memories:
        "Share your favorite memories and stories of Mickey — family contributions welcome.",
      quotes: null,
    },
    {
      full_name: "Anna M. Miotto",
      preferred_name: "Anna M. Miotto",
      maiden_name: "Capoccia",
      nickname: "Anna M. Capoccia Miotto",
      family_branch: "Miotto",
      is_patriarch: 0,
      is_matriarch: 1,
      is_memorial: 1,
      is_placeholder: 0,
      sort_order: 6,
      birth_date: null,
      birth_date_display: "circa 1929",
      death_date: "2017-01-08",
      death_date_display: "January 8, 2017",
      role_in_family: "Miotto Matriarch",
      biography:
        "Anna M. Capoccia Miotto (born circa 1929; passed January 8, 2017, age 88) was the beloved sister of Tony and George Capoccia, and the gentle matriarch of the Miotto family who wove the Capoccia and Miotto families into one. Anna married Amerigo “Mickey” Miotto and spent 65 joyful years creating a home filled with love, faith, and Italian warmth.\n\n" +
        "Her 2017 obituary captured the family’s closeness, naming her brothers “Tony (Fran) Capoccia and George (Christine) Capoccia.” Together with Mickey, Anna raised five children and left a legacy of 14 grandchildren and 14 great-grandchildren who keep the reunions alive and full of joy. Anna’s grace and devotion turned two families into one beautiful legacy — the very heart of capocciamiotto.com.\n\n" +
        "Her memory shines brightly at every reunion, reminding us that family is the greatest treasure of all.",
      favorite_memories:
        "Share your favorite memories and stories of Anna — family contributions welcome.",
      quotes: null,
    },
    {
      full_name: "Anthony “Tony” Joseph Capoccia",
      preferred_name: "Anthony “Tony” Capoccia",
      nickname: "Tony",
      family_branch: "Capoccia",
      is_patriarch: 0,
      is_matriarch: 0,
      is_memorial: 1,
      is_placeholder: 0,
      sort_order: 3,
      birth_date: "1931-07-18",
      birth_date_display: "July 18, 1931 · Detroit",
      death_date: "2019-06-25",
      death_date_display: "June 25, 2019",
      role_in_family: "Honored Elder",
      biography:
        "Anthony “Tony” Joseph Capoccia (born July 18, 1931, Detroit; passed June 25, 2019, age 87) and his devoted wife Frances “Fran” Lee Babich Capoccia are remembered with deepest love as cherished elders of the Capoccia family.\n\n" +
        "Tony was the beloved brother of George and Anna Miotto. He and Fran shared more than 60 years of marriage filled with faith, laughter, and quiet strength. They lived in the Farmington Hills and Southfield area and now rest together at Holy Sepulchre Catholic Cemetery in Southfield — a peaceful symbol of their lifelong bond.\n\n" +
        "Tony and Fran’s story is woven into the very heart of the Capoccia–Miotto reunions. Their love helped strengthen the family ties that bring us together year after year, reminding us that family is the most beautiful legacy of all.",
      favorite_memories:
        "Share your favorite memories and stories of Tony and Fran — family contributions welcome.",
      quotes: null,
    },
    {
      full_name: "Frances “Fran” Lee Capoccia",
      preferred_name: "Frances “Fran” Capoccia",
      maiden_name: "Babich",
      nickname: "Fran",
      family_branch: "Capoccia",
      is_patriarch: 0,
      is_matriarch: 0,
      is_memorial: 1,
      is_placeholder: 0,
      sort_order: 4,
      birth_date: "1932-10-23",
      birth_date_display: "October 23, 1932 · Dowell, Illinois",
      death_date: "2024-10-27",
      death_date_display: "October 27, 2024",
      role_in_family: "Honored Elder",
      biography:
        "Frances “Fran” Lee Babich Capoccia (born October 23, 1932, Dowell, Illinois; passed October 27, 2024, age 92) is remembered with deepest love as a cherished elder of the Capoccia family.\n\n" +
        "Married to Anthony “Tony” Joseph Capoccia for more than 60 years, Fran shared a life filled with faith, laughter, and quiet strength. They lived in the Farmington Hills and Southfield area and now rest together at Holy Sepulchre Catholic Cemetery in Southfield — a peaceful symbol of their lifelong bond.\n\n" +
        "Tony and Fran’s story is woven into the very heart of the Capoccia–Miotto reunions. Their love helped strengthen the family ties that bring us together year after year, reminding us that family is the most beautiful legacy of all.",
      favorite_memories:
        "Share your favorite memories and stories of Tony and Fran — family contributions welcome.",
      quotes: null,
    },
  ];

  const findByName = db.prepare(
    "SELECT id FROM family_members WHERE full_name = ? OR preferred_name = ? OR full_name LIKE ?"
  );
  const findSlot = db.prepare(`
    SELECT id FROM family_members
    WHERE family_branch = ? AND is_patriarch = ? AND is_matriarch = ?
    ORDER BY sort_order ASC, id ASC LIMIT 1
  `);
  const findPlaceholder = db.prepare(`
    SELECT id FROM family_members
    WHERE family_branch = ? AND (full_name LIKE '%placeholder%' OR is_placeholder = 1)
      AND is_patriarch = ? AND is_matriarch = ?
    ORDER BY id ASC LIMIT 1
  `);

  const update = db.prepare(`
    UPDATE family_members SET
      full_name = @full_name,
      preferred_name = @preferred_name,
      maiden_name = @maiden_name,
      nickname = @nickname,
      family_branch = @family_branch,
      is_patriarch = @is_patriarch,
      is_matriarch = @is_matriarch,
      is_memorial = @is_memorial,
      is_placeholder = @is_placeholder,
      sort_order = @sort_order,
      birth_date = @birth_date,
      birth_date_display = @birth_date_display,
      death_date = @death_date,
      death_date_display = @death_date_display,
      role_in_family = @role_in_family,
      biography = @biography,
      favorite_memories = @favorite_memories,
      quotes = @quotes,
      updated_at = datetime('now')
    WHERE id = @id
  `);

  const insert = db.prepare(`
    INSERT INTO family_members (
      full_name, preferred_name, maiden_name, nickname, family_branch,
      is_patriarch, is_matriarch, is_memorial, is_placeholder, sort_order,
      birth_date, birth_date_display, death_date, death_date_display,
      role_in_family, biography, favorite_memories, quotes
    ) VALUES (
      @full_name, @preferred_name, @maiden_name, @nickname, @family_branch,
      @is_patriarch, @is_matriarch, @is_memorial, @is_placeholder, @sort_order,
      @birth_date, @birth_date_display, @death_date, @death_date_display,
      @role_in_family, @biography, @favorite_memories, @quotes
    )
  `);

  const upsertMemorial = db.prepare(`
    INSERT INTO memorials (family_member_id, full_name, dates_text, relationship, biography, favorite_memories, status)
    VALUES (@family_member_id, @full_name, @dates_text, @relationship, @biography, @favorite_memories, 'approved')
  `);
  const findMemorial = db.prepare("SELECT id FROM memorials WHERE family_member_id = ? OR full_name = ?");
  const updateMemorial = db.prepare(`
    UPDATE memorials SET
      full_name = @full_name,
      dates_text = @dates_text,
      relationship = @relationship,
      biography = @biography,
      favorite_memories = @favorite_memories,
      status = 'approved'
    WHERE id = @id
  `);

  for (const t of tributes) {
    const row = {
      maiden_name: t.maiden_name || null,
      nickname: t.nickname || null,
      quotes: t.quotes || null,
      ...t,
    };

    let existing =
      findByName.get(t.full_name, t.preferred_name || t.full_name, `%${t.full_name.split(" ")[0]}%${t.full_name.split(" ").slice(-1)[0]}%`);

    // Map patriarch/matriarch slots (including old placeholders)
    if (!existing && (t.is_patriarch || t.is_matriarch)) {
      existing =
        findPlaceholder.get(t.family_branch, t.is_patriarch, t.is_matriarch) ||
        findSlot.get(t.family_branch, t.is_patriarch, t.is_matriarch);
    }

    // Tony / Fran by partial name
    if (!existing && t.full_name.includes("Tony")) {
      existing = db.prepare("SELECT id FROM family_members WHERE full_name LIKE '%Tony%Capoccia%' OR preferred_name LIKE '%Tony%Capoccia%'").get();
    }
    if (!existing && t.full_name.includes("Fran")) {
      existing = db.prepare("SELECT id FROM family_members WHERE full_name LIKE '%Fran%Capoccia%' OR preferred_name LIKE '%Fran%Capoccia%' OR full_name LIKE '%Frances%Capoccia%'").get();
    }
    // Mickey / Anna placeholders
    if (!existing && t.full_name.includes("Mickey")) {
      existing = db.prepare("SELECT id FROM family_members WHERE full_name LIKE '%Mickey%' OR full_name LIKE '%Miotto Patriarch%' OR (family_branch='Miotto' AND is_patriarch=1)").get();
    }
    if (!existing && t.full_name.includes("Anna M.")) {
      existing = db.prepare("SELECT id FROM family_members WHERE full_name LIKE '%Anna%Miotto%' OR full_name LIKE '%Miotto Matriarch%' OR (family_branch='Miotto' AND is_matriarch=1)").get();
    }

    let memberId;
    if (existing && existing.id) {
      update.run({ ...row, id: existing.id });
      memberId = existing.id;
    } else {
      const info = insert.run(row);
      memberId = info.lastInsertRowid;
    }

    if (t.is_memorial) {
      const dates = [t.birth_date_display, t.death_date_display].filter(Boolean).join(" – ");
      const mem = findMemorial.get(memberId, t.full_name);
      const memRow = {
        family_member_id: memberId,
        full_name: t.full_name,
        dates_text: dates || null,
        relationship: t.role_in_family,
        biography: t.biography,
        favorite_memories: t.favorite_memories,
      };
      if (mem) updateMemorial.run({ ...memRow, id: mem.id });
      else upsertMemorial.run(memRow);
    }
  }

  // Ensure site matriarch display name
  db.prepare(`
    INSERT INTO site_settings (key, value) VALUES ('matriarch_name_capoccia', 'Christine Capoccia')
    ON CONFLICT(key) DO UPDATE SET value = 'Christine Capoccia'
  `).run();

  // Family tree note in settings for Our Family Story page
  db.prepare(`
    INSERT INTO site_settings (key, value) VALUES ('family_tree_snippet', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(
    "Capoccia Parents → Costanzo & Madeline\n├── Tony (m. Fran Babich) – honored elder\n├── George (m. Christine) – Capoccia Patriarch & Matriarch\n└── Anna (m. Mickey Miotto) – Miotto Matriarch (link to Miotto branch)"
  );

  // Portrait photos (bundled under /portraits — not under uploads volume)
  db.prepare(`
    UPDATE family_members
    SET portrait_path = '/portraits/george-capoccia-army.jpg',
        updated_at = datetime('now')
    WHERE full_name LIKE 'George%Capoccia%'
       OR preferred_name LIKE 'George%Capoccia%'
  `).run();
}

migrate();

module.exports = db;
