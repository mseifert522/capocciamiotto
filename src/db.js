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

  // Shared family contribution PIN (emailed to family members who request it)
  try {
    const familyPin = process.env.FAMILY_PIN || "29765240";
    const existingPin = db.prepare("SELECT id FROM family_pins WHERE pin_code = ?").get(familyPin);
    if (!existingPin) {
      db.prepare(`
        INSERT INTO family_pins (pin_code, assigned_name, notes, active)
        VALUES (?, 'Capoccia–Miotto Family', 'Shared family contribution PIN — emailed via Request Family PIN', 1)
      `).run(familyPin);
    } else {
      db.prepare("UPDATE family_pins SET active = 1, assigned_name = COALESCE(assigned_name, 'Capoccia–Miotto Family') WHERE pin_code = ?").run(familyPin);
    }
  } catch (e) {
    console.warn("family pin seed note:", e.message);
  }

  // Log PIN email requests
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pin_email_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requester_name TEXT,
        requester_email TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'sent',
        method TEXT,
        details TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pin_email_requests_email ON pin_email_requests(requester_email);
    `);
  } catch (e) {
    console.warn("pin email requests table note:", e.message);
  }

  // Site activity (PIN logins, PIN requests, uploads) for admin dashboard
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS site_activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        actor_name TEXT,
        actor_email TEXT,
        details TEXT,
        ip TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_site_activity_kind ON site_activity(kind);
      CREATE INDEX IF NOT EXISTS idx_site_activity_created ON site_activity(created_at);
    `);
  } catch (e) {
    console.warn("site_activity table note:", e.message);
  }

  // Page views + visit sessions (time on site) for admin analytics
  try {
    const { ensureAnalyticsTables } = require("./analytics");
    ensureAnalyticsTables(db);
  } catch (e) {
    console.warn("analytics tables note:", e.message);
  }

  // Community board photo/video attachments
  try {
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
  } catch (e) {
    console.warn("board media table note:", e.message);
  }

  // Super admin(s) — passwords only from env, never hardcode production secrets
  function ensureSuperAdmin(email, password, name) {
    if (!email || !password) return;
    const em = String(email).trim().toLowerCase();
    const hash = bcrypt.hashSync(password, 12);
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(em);
    if (!existing) {
      db.prepare(`
        INSERT INTO users (email, password_hash, name, role, email_verified)
        VALUES (?, ?, ?, 'super_admin', 1)
      `).run(em, hash, name || "Family Administrator");
    } else if (process.env.ADMIN_SYNC_PASSWORD === "true") {
      db.prepare(`
        UPDATE users SET password_hash = ?, role = 'super_admin', name = COALESCE(name, ?)
        WHERE email = ?
      `).run(hash, name || "Family Administrator", em);
    }
  }
  ensureSuperAdmin(
    process.env.ADMIN_EMAIL || "info@seifertcapital.com",
    process.env.ADMIN_PASSWORD || "ChangeMe-Capoccia2026!",
    "Family Administrator"
  );
  // Optional second admin (e.g. mike@) via ADMIN_EMAIL_2 / ADMIN_PASSWORD_2
  ensureSuperAdmin(
    process.env.ADMIN_EMAIL_2 || "",
    process.env.ADMIN_PASSWORD_2 || "",
    process.env.ADMIN_NAME_2 || "Mike Seifert"
  );

  // Welcome board post
  const boardCount = db.prepare("SELECT COUNT(*) AS c FROM board_posts").get().c;
  if (boardCount === 0) {
    db.prepare(`
      INSERT INTO board_posts (title, body, category, author_name, is_pinned, status)
      VALUES (?, ?, 'announcement', 'Family Administrators', 1, 'approved')
    `).run(
      "Welcome to Our Family Community Board",
      "This is a safe gathering place for Capoccia and Miotto family news, reunion planning, photo requests, and messages. Family members with the family PIN can post freely so our tribute grows together. Please help us collect photographs and memories from reunions since 1977."
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
  // Verified public research only (obits / vital records / family framework).
  // Do not invent immigration villages, twin siblings, or unverified cemetery claims.
  const tributes = [
    {
      full_name: "Costanzo Capoccia",
      preferred_name: "Costanzo Capoccia",
      nickname: null,
      family_branch: "Capoccia",
      is_patriarch: 0,
      is_matriarch: 0,
      is_memorial: 1,
      is_placeholder: 0,
      sort_order: 0,
      birth_date: "1895-11-30",
      birth_date_display: "November 30, 1895",
      death_date: "1967-08-01",
      death_date_display: "August 1967",
      role_in_family: "Capoccia parent · foundational generation",
      biography:
        "Costanzo Capoccia (November 30, 1895 – August 1967) and his wife Maddalena (Lena/Madeline) Cervi Capoccia are the parents of the Capoccia siblings honored on this tribute: Tony, George, and Anna Capoccia (Anna Miotto).\n\n" +
        "Public genealogy records place the family in the Detroit metropolitan area of Michigan. Their children built lives across Metro Detroit (Macomb, Wayne, and Oakland counties). Richer details of Costanzo’s life, immigration story, and Italian hometown — if known — are invited as family contributions so nothing is invented here.\n\n" +
        "This site honors Costanzo and Madeline as the foundation of the Capoccia–Miotto family tree.",
      favorite_memories:
        "Family: please share verified memories, documents, and photos of Costanzo and Madeline.",
      quotes: null,
    },
    {
      full_name: "Maddalena Capoccia",
      preferred_name: "Madeline Capoccia",
      maiden_name: "Cervi",
      nickname: "Lena",
      family_branch: "Capoccia",
      is_patriarch: 0,
      is_matriarch: 0,
      is_memorial: 1,
      is_placeholder: 0,
      sort_order: 0,
      birth_date: "1897-03-10",
      birth_date_display: "March 10, 1897",
      death_date: "1974-12-01",
      death_date_display: "December 1974 · Detroit / Wayne County area",
      role_in_family: "Capoccia parent · foundational generation",
      biography:
        "Maddalena (Lena/Madeline) Cervi Capoccia (March 10, 1897 – December 1974, Detroit/Wayne County area) was the wife of Costanzo Capoccia and mother of Tony Capoccia, George Capoccia, and Anna Capoccia Miotto.\n\n" +
        "Public records place the family in Metro Detroit. Personal stories of Madeline’s life, faith, and family traditions are welcome from relatives so this tribute remains accurate and complete.\n\n" +
        "She is remembered here with Costanzo as the parents of the Capoccia siblings whose families form the Capoccia–Miotto reunion community.",
      favorite_memories:
        "Family: please share verified memories, documents, and photos of Madeline (Maddalena Cervi) Capoccia.",
      quotes: null,
    },
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
      birth_date_display: "January 25, 1933 · Michigan",
      death_date: null,
      death_date_display: null,
      role_in_family: "Capoccia Patriarch",
      biography:
        "George Capoccia was born January 25, 1933. He is a son of Costanzo Capoccia and Maddalena (Madeline) Cervi Capoccia, and brother of Tony Capoccia and Anna Capoccia Miotto.\n\n" +
        "George is married to Christine Capoccia. Public records and family framework place them in the Warren, Michigan area of Metro Detroit. In Anna’s 2017 obituary he is named among her surviving brothers as George (Christine) Capoccia. On this tribute, George and Christine are honored as Capoccia patriarch and matriarch of the living reunion tradition that began in 1977.\n\n" +
        "Their descendants include David Capoccia, Debbie Capoccia Fallucca, and Jeanette Capoccia Seifert. Personal stories, photographs, and memories from family members are invited so George’s page remains a living tribute — nothing invented, only what the family confirms and shares.",
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
        "Christine Capoccia is the wife of George Capoccia and is honored on this site as Capoccia matriarch alongside George.\n\n" +
        "Anna Capoccia Miotto’s 2017 obituary names “George (Christine) Capoccia,” confirming Christine as George’s wife and part of the Capoccia sibling generation’s family circle. George and Christine live in the Warren, Michigan area and have helped sustain the Capoccia–Miotto reunions since 1977.\n\n" +
        "Their descendants include David Capoccia, Debbie Capoccia Fallucca, and Jeanette Capoccia Seifert. Additional dates, photographs, and personal memories are welcome from family so her tribute grows with verified contributions only.",
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
      birth_date: "1923-09-27",
      birth_date_display: "September 27, 1923 (circa)",
      death_date: "2015-02-28",
      death_date_display: "February 28, 2015 · age 91",
      role_in_family: "Miotto Patriarch",
      biography:
        "Amerigo “Mickey” Miotto (born circa September 27, 1923; passed February 28, 2015, age 91) was the beloved husband of Anna Capoccia Miotto for 65 years and the Miotto-side patriarch honored on this tribute.\n\n" +
        "Through his marriage to Anna — sister of Tony Capoccia and George Capoccia — Mickey became the bridge uniting the Capoccia and Miotto families. Together Mickey and Anna raised five children: Patricia (Terry) McLaren, Carol (Kent) Maconochie, John (Gretchen) Miotto, Michael (Cindy) Miotto, and MaryAnn (Jack) Sellers. At Anna’s passing the family counted 14 grandchildren and 14 great-grandchildren.\n\n" +
        "Mickey’s memory remains part of every Capoccia–Miotto reunion. Family members are invited to add photographs and stories so his page stays complete and accurate.",
      favorite_memories:
        "Share your favorite memories and stories of Mickey — family contributions welcome.",
      quotes: null,
    },
    {
      full_name: "Anna M. Miotto",
      preferred_name: "Anna M. Capoccia Miotto",
      maiden_name: "Capoccia",
      nickname: "Anna",
      family_branch: "Miotto",
      is_patriarch: 0,
      is_matriarch: 1,
      is_memorial: 1,
      is_placeholder: 0,
      sort_order: 6,
      birth_date: "1928-06-30",
      birth_date_display: "June 30, 1928 · Michigan",
      death_date: "2017-01-08",
      death_date_display: "January 8, 2017 · Clinton Township, Macomb County, Michigan · age 88",
      role_in_family: "Miotto Matriarch · Capoccia sister",
      biography:
        "Anna Capoccia Miotto was born June 30, 1928, in Michigan, a daughter of Costanzo Capoccia and Maddalena (Madeline) Cervi Capoccia, and sister of Tony Capoccia and George Capoccia. She passed January 8, 2017, at age 88 in Clinton Township, Macomb County, Michigan.\n\n" +
        "Anna married Amerigo “Mickey” Miotto; they shared 65 years of marriage. They raised five children: Patricia (Terry) McLaren, Carol (Kent) Maconochie, John (Gretchen) Miotto, Michael (Cindy) Miotto, and MaryAnn (Jack) Sellers. At the time of her passing she was a proud grandmother of 14 and great-grandmother of 14. She was survived by her brothers Tony (Fran) Capoccia and George (Christine) Capoccia.\n\n" +
        "Services were held at St. Isidore Catholic Church in Macomb County, with inurnment at Resurrection Cemetery. Anna is the living bridge between the Capoccia and Miotto names on this tribute — the matriarch of the Miotto branch and a Capoccia sister at the heart of the reunions that began in 1977.",
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
      birth_date_display: "July 18, 1931 · Detroit, Michigan",
      death_date: "2019-06-25",
      death_date_display: "June 25, 2019",
      role_in_family: "Capoccia Patriarch",
      biography:
        "Anthony “Tony” Joseph Capoccia is a son of Costanzo Capoccia and Maddalena (Madeline) Cervi Capoccia, and the beloved brother of George Capoccia and Anna Capoccia (Anna Miotto).\n\n" +
        "Tony was married to Frances “Fran” Capoccia (née Babich). Anna’s 2017 obituary names him among her surviving brothers as “Tony (Fran) Capoccia,” confirming the sibling bond and Fran as his wife. Public research places the Capoccia siblings’ families in Metro Detroit (including areas such as Warren, Clinton Township, Troy, and Sterling Heights).\n\n" +
        "Dates of birth and passing recorded on this tribute (born July 18, 1931, Detroit; passed June 25, 2019) come from the family archive on this site. Family members are invited to confirm documents, resting place, and additional memories so every detail remains accurate. Tony and Fran are honored as Capoccia Patriarch & Matriarch, equal with George & Christine and Anna & Mickey on this living reunion tribute.",
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
      role_in_family: "Capoccia Matriarch",
      biography:
        "Frances “Fran” Capoccia (née Babich) was the wife of Anthony “Tony” Capoccia. Anna Capoccia Miotto’s 2017 obituary names “Tony (Fran) Capoccia,” confirming Fran as Tony’s wife and part of the Capoccia sibling generation’s family circle.\n\n" +
        "Tony was the beloved brother of George Capoccia and Anna Capoccia (Anna Miotto). Together Tony and Fran are honored as Capoccia Patriarch & Matriarch, equal with George & Christine and Anna & Mickey on this tribute. Birth and passing dates shown here are from the family archive maintained on this site; family members may contribute documents and memories to refine any detail.\n\n" +
        "Their story is part of the Capoccia–Miotto reunions that have gathered the extended family since 1977 across Metro Detroit.",
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

  // Verified children of Anna & Mickey Miotto (from Anna’s public obituary framework)
  try {
    const { ensureTreeColumns } = require("./familyTree");
    ensureTreeColumns(db);

    const annaRow = db.prepare(`
      SELECT id FROM family_members
      WHERE is_matriarch = 1 AND family_branch = 'Miotto'
      ORDER BY id ASC LIMIT 1
    `).get() || db.prepare(`
      SELECT id FROM family_members
      WHERE full_name LIKE '%Anna%Miotto%' OR preferred_name LIKE '%Anna%Miotto%' OR preferred_name LIKE '%Anna%Capoccia%'
      ORDER BY id ASC LIMIT 1
    `).get();

    const annaId = annaRow ? annaRow.id : null;
    const miottoChildren = [
      {
        full_name: "Patricia McLaren",
        preferred_name: "Patricia (Terry) McLaren",
        role_in_family: "Daughter of Anna & Mickey Miotto · spouse Terry McLaren",
      },
      {
        full_name: "Carol Maconochie",
        preferred_name: "Carol (Kent) Maconochie",
        role_in_family: "Daughter of Anna & Mickey Miotto · spouse Kent Maconochie",
      },
      {
        full_name: "John Miotto",
        preferred_name: "John (Gretchen) Miotto",
        role_in_family: "Son of Anna & Mickey Miotto · spouse Gretchen Miotto",
      },
      {
        full_name: "Michael Miotto",
        preferred_name: "Michael (Cindy) Miotto",
        role_in_family: "Son of Anna & Mickey Miotto · spouse Cindy Miotto",
      },
      {
        full_name: "MaryAnn Sellers",
        preferred_name: "MaryAnn (Jack) Sellers",
        role_in_family: "Daughter of Anna & Mickey Miotto · spouse Jack Sellers",
      },
    ];

    let sortBase = 200;
    for (const child of miottoChildren) {
      let existing = db.prepare(`
        SELECT id FROM family_members WHERE full_name = ? OR preferred_name = ?
      `).get(child.full_name, child.preferred_name);
      if (!existing) {
        existing = db.prepare(`
          SELECT id FROM family_members WHERE full_name LIKE ? LIMIT 1
        `).get(`%${child.full_name.split(" ")[0]}%${child.full_name.split(" ").slice(-1)[0]}%`);
      }
      if (existing) {
        db.prepare(`
          UPDATE family_members SET
            preferred_name = ?,
            family_branch = 'Miotto',
            role_in_family = ?,
            parent_member_id = COALESCE(parent_member_id, ?),
            tree_lineage = 'anna',
            generation = COALESCE(generation, 2),
            relation_type = COALESCE(relation_type, 'child_of'),
            visibility = 'public',
            updated_at = datetime('now')
          WHERE id = ?
        `).run(child.preferred_name, child.role_in_family, annaId, existing.id);
      } else {
        db.prepare(`
          INSERT INTO family_members (
            full_name, preferred_name, family_branch, is_patriarch, is_matriarch, is_memorial, is_placeholder,
            sort_order, role_in_family, biography, visibility, parent_member_id, tree_lineage, generation, relation_type
          ) VALUES (?, ?, 'Miotto', 0, 0, 0, 0, ?, ?, ?, 'public', ?, 'anna', 2, 'child_of')
        `).run(
          child.full_name,
          child.preferred_name,
          sortBase++,
          child.role_in_family,
          "Child of Anna Capoccia Miotto and Amerigo “Mickey” Miotto, as named in Anna’s family obituary. Additional life details and photographs are invited from family members.",
          annaId
        );
      }
    }

    // Link Mickey and Anna as spouses when both exist
    const mickeyRow = db.prepare(`
      SELECT id FROM family_members WHERE full_name LIKE '%Mickey%Miotto%' OR preferred_name LIKE '%Mickey%Miotto%' OR (family_branch='Miotto' AND is_patriarch=1)
      ORDER BY id ASC LIMIT 1
    `).get();
    if (annaId && mickeyRow) {
      db.prepare("UPDATE family_members SET spouse_member_id = COALESCE(spouse_member_id, ?) WHERE id = ?").run(mickeyRow.id, annaId);
      db.prepare("UPDATE family_members SET spouse_member_id = COALESCE(spouse_member_id, ?) WHERE id = ?").run(annaId, mickeyRow.id);
    }

    // Descendants of George & Christine Capoccia (family-provided names)
    const georgeRow = db.prepare(`
      SELECT id FROM family_members
      WHERE is_patriarch = 1 AND family_branch = 'Capoccia' AND full_name LIKE '%George%'
      ORDER BY id ASC LIMIT 1
    `).get() || db.prepare(`
      SELECT id FROM family_members WHERE full_name LIKE 'George%Capoccia%' OR preferred_name LIKE 'George%Capoccia%'
      ORDER BY id ASC LIMIT 1
    `).get();
    const georgeId = georgeRow ? georgeRow.id : null;

    const georgeChildren = [
      {
        full_name: "David Capoccia",
        preferred_name: "David Capoccia",
        maiden_name: null,
        role_in_family: "Son of George & Christine Capoccia",
        biography:
          "David Capoccia is a descendant of George Capoccia and Christine Capoccia. Additional stories, dates, and photographs are invited from family members.",
      },
      {
        full_name: "Debbie Fallucca",
        preferred_name: "Debbie Capoccia Fallucca",
        maiden_name: "Capoccia",
        role_in_family: "Daughter of George & Christine Capoccia",
        biography:
          "Debbie Capoccia Fallucca is a descendant of George Capoccia and Christine Capoccia. Additional stories, dates, and photographs are invited from family members.",
      },
      {
        full_name: "Jeanette Seifert",
        preferred_name: "Jeanette Capoccia Seifert",
        maiden_name: "Capoccia",
        role_in_family: "Daughter of George & Christine Capoccia",
        biography:
          "Jeanette Capoccia Seifert is a descendant of George Capoccia and Christine Capoccia. Additional stories, dates, and photographs are invited from family members.",
      },
    ];

    let georgeSort = 150;
    for (const child of georgeChildren) {
      let existing = db.prepare(`
        SELECT id FROM family_members WHERE full_name = ? OR preferred_name = ?
      `).get(child.full_name, child.preferred_name);
      if (!existing && child.full_name.includes("Debbie")) {
        existing = db.prepare(`
          SELECT id FROM family_members
          WHERE full_name LIKE '%Debbie%Capoccia%' OR preferred_name LIKE '%Debbie%Capoccia%'
             OR full_name LIKE '%Debbie%Falluc%' OR preferred_name LIKE '%Debbie%Falluc%'
          LIMIT 1
        `).get();
      }
      if (!existing && child.full_name.includes("Jeanette")) {
        existing = db.prepare(`
          SELECT id FROM family_members
          WHERE full_name LIKE '%Jeanette%Capoccia%' OR preferred_name LIKE '%Jeanette%Capoccia%'
             OR full_name LIKE '%Jeanette%Seifert%' OR preferred_name LIKE '%Jeanette%Seifert%'
          LIMIT 1
        `).get();
      }
      if (!existing && child.full_name.includes("David")) {
        existing = db.prepare(`
          SELECT id FROM family_members
          WHERE full_name LIKE '%David%Capoccia%' OR preferred_name LIKE '%David%Capoccia%'
          LIMIT 1
        `).get();
      }
      if (existing) {
        db.prepare(`
          UPDATE family_members SET
            full_name = ?,
            preferred_name = ?,
            maiden_name = COALESCE(?, maiden_name),
            family_branch = 'Capoccia',
            role_in_family = ?,
            biography = COALESCE(NULLIF(biography, ''), ?),
            parent_member_id = COALESCE(parent_member_id, ?),
            tree_lineage = 'george',
            generation = COALESCE(generation, 2),
            relation_type = COALESCE(relation_type, 'child_of'),
            visibility = 'public',
            updated_at = datetime('now')
          WHERE id = ?
        `).run(
          child.full_name,
          child.preferred_name,
          child.maiden_name,
          child.role_in_family,
          child.biography,
          georgeId,
          existing.id
        );
      } else {
        db.prepare(`
          INSERT INTO family_members (
            full_name, preferred_name, maiden_name, family_branch, is_patriarch, is_matriarch, is_memorial, is_placeholder,
            sort_order, role_in_family, biography, visibility, parent_member_id, tree_lineage, generation, relation_type
          ) VALUES (?, ?, ?, 'Capoccia', 0, 0, 0, 0, ?, ?, ?, 'public', ?, 'george', 2, 'child_of')
        `).run(
          child.full_name,
          child.preferred_name,
          child.maiden_name,
          georgeSort++,
          child.role_in_family,
          child.biography,
          georgeId
        );
      }
    }

    // Link George & Christine, Tony & Fran if present
    const pairs = [
      ["%George%Capoccia%", "%Christine%Capoccia%"],
      ["%Tony%Capoccia%", "%Fran%Capoccia%"],
    ];
    for (const [aLike, bLike] of pairs) {
      const a = db.prepare("SELECT id FROM family_members WHERE full_name LIKE ? OR preferred_name LIKE ? LIMIT 1").get(aLike, aLike);
      const b = db.prepare("SELECT id FROM family_members WHERE full_name LIKE ? OR preferred_name LIKE ? LIMIT 1").get(bLike, bLike);
      if (a && b) {
        db.prepare("UPDATE family_members SET spouse_member_id = COALESCE(spouse_member_id, ?) WHERE id = ?").run(b.id, a.id);
        db.prepare("UPDATE family_members SET spouse_member_id = COALESCE(spouse_member_id, ?) WHERE id = ?").run(a.id, b.id);
      }
    }
  } catch (e) {
    console.warn("descendant seed note:", e.message);
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
    "Capoccia Parents → Costanzo Capoccia & Maddalena (Madeline) Cervi Capoccia\n" +
      "├── Tony Capoccia (m. Fran Babich) – Capoccia Patriarch & Matriarch\n" +
      "├── George Capoccia (m. Christine) – Capoccia Patriarch & Matriarch · Warren, MI\n" +
      "│   └── David Capoccia; Debbie Capoccia Fallucca; Jeanette Capoccia Seifert\n" +
      "└── Anna Capoccia Miotto (m. Amerigo “Mickey” Miotto) – Miotto Matriarch & Patriarch\n" +
      "    └── Patricia, Carol, John, Michael, MaryAnn (and families)"
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
