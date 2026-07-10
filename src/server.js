const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const db = require("./db");
const { processUpload, isAllowedMime } = require("./photos");

const app = express();
const PORT = process.env.PORT || 3080;
const CURRENT_YEAR = new Date().getFullYear();
const SECRET = process.env.SESSION_SECRET || "capocia-Miotto-tribute-change-in-production";

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(express.json({ limit: "2mb" }));
app.use(session({
  name: "cmfr.sid",
  secret: SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 12,
  },
}));

app.use("/uploads", express.static(path.join(__dirname, "..", "public", "uploads"), {
  maxAge: "7d",
  fallthrough: true,
}));
app.use(express.static(path.join(__dirname, "..", "public"), { maxAge: "1d" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedMime(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed."));
  },
});

const contributeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many submissions. Please try again in a few minutes.",
});

function getSetting(key, fallback = "") {
  const row = db.prepare("SELECT value FROM site_settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

function matriarchName() {
  return getSetting("matriarch_name_capocia", "Christine Capocia");
}

function localsBase(req) {
  return {
    siteName: getSetting("site_name", "The Capocia–Miotto Family Reunion Tribute"),
    foundedYear: 1977,
    currentYear: CURRENT_YEAR,
    user: req.session.user || null,
    path: req.path,
    flash: req.session.flash || null,
    matriarchName: matriarchName(),
    contributeCta: "Please help us preserve the history of the Capocia and Miotto families. We are asking every family member to look through old photo albums, boxes, phones, computers, and family collections for photographs from past reunions. Even if you do not know the exact year or everyone shown in the photograph, please share it. Other family members may be able to help identify the people, place, or occasion.",
    contributeCta2: "Every photograph, name, story, recipe, invitation, and memory helps complete our family history.",
  };
}

function clearFlash(req) {
  delete req.session.flash;
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role)) {
      setFlash(req, "error", "Please sign in with an administrator account.");
      return res.redirect("/admin/login");
    }
    next();
  };
}

function logActivity(userId, action, details) {
  db.prepare("INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)").run(
    userId || null,
    action,
    details || null
  );
}

const ADMIN_ROLES = ["super_admin", "family_admin", "photo_moderator", "content_moderator", "reunion_organizer"];

// ---------- Public pages ----------
app.get("/", (req, res) => {
  const members = db.prepare(`
    SELECT * FROM family_members
    WHERE is_placeholder = 1 OR is_patriarch = 1 OR is_matriarch = 1
    ORDER BY sort_order ASC, full_name ASC
  `).all();
  // Apply editable matriarch display name
  members.forEach((m) => {
    if (m.is_matriarch && m.family_branch === "Capocia") {
      m.display_name = matriarchName();
    } else {
      m.display_name = m.preferred_name || m.full_name;
    }
  });
  const recentPhotos = db.prepare(`
    SELECT * FROM photos WHERE status = 'approved' AND may_display_public = 1
    ORDER BY featured DESC, submitted_at DESC LIMIT 8
  `).all();
  const pinned = db.prepare(`
    SELECT * FROM board_posts WHERE status = 'approved' AND is_pinned = 1
    ORDER BY created_at DESC LIMIT 3
  `).all();
  const data = localsBase(req);
  clearFlash(req);
  res.render("home", { ...data, members, recentPhotos, pinned });
});

app.get("/our-family-story", (req, res) => {
  const data = localsBase(req);
  clearFlash(req);
  res.render("family-story", data);
});

app.get("/reunion-timeline", (req, res) => {
  const reunions = db.prepare("SELECT * FROM reunions ORDER BY year DESC").all();
  const counts = db.prepare(`
    SELECT reunion_year AS year, COUNT(*) AS c FROM photos
    WHERE status = 'approved' GROUP BY reunion_year
  `).all();
  const countMap = Object.fromEntries(counts.map((r) => [r.year, r.c]));
  reunions.forEach((r) => { r.photo_count = countMap[r.year] || 0; });
  const data = localsBase(req);
  clearFlash(req);
  res.render("timeline", { ...data, reunions });
});

app.get("/reunion/:year", (req, res) => {
  const year = parseInt(req.params.year, 10);
  if (Number.isNaN(year) || year < 1977) return res.status(404).render("404", localsBase(req));
  let reunion = db.prepare("SELECT * FROM reunions WHERE year = ?").get(year);
  if (!reunion) {
    db.prepare("INSERT INTO reunions (year, title) VALUES (?, ?)").run(year, `${year} Capocia–Miotto Family Reunion`);
    reunion = db.prepare("SELECT * FROM reunions WHERE year = ?").get(year);
  }
  const photos = db.prepare(`
    SELECT * FROM photos WHERE reunion_year = ? AND status = 'approved' AND may_display_public = 1
    ORDER BY featured DESC, submitted_at DESC
  `).all(year);
  const stories = db.prepare(`
    SELECT * FROM stories WHERE reunion_year = ? AND status = 'approved' ORDER BY created_at DESC
  `).all(year);
  const peopleByPhoto = {};
  photos.forEach((p) => {
    peopleByPhoto[p.id] = db.prepare(
      "SELECT * FROM photo_people WHERE photo_id = ? AND status = 'approved' ORDER BY id"
    ).all(p.id);
  });
  const data = localsBase(req);
  clearFlash(req);
  res.render("reunion-year", { ...data, reunion, photos, stories, peopleByPhoto });
});

app.get("/photo-archive", (req, res) => {
  const q = (req.query.q || "").trim();
  const year = req.query.year ? parseInt(req.query.year, 10) : null;
  const branch = (req.query.branch || "").trim();
  let sql = `SELECT * FROM photos WHERE status = 'approved' AND may_display_public = 1`;
  const params = [];
  if (year) { sql += " AND reunion_year = ?"; params.push(year); }
  if (branch) { sql += " AND (family_branch = ? OR family_branch = 'both')"; params.push(branch); }
  if (q) {
    sql += ` AND (
      title LIKE ? OR description LIKE ? OR location LIKE ? OR contributor_name LIKE ?
      OR id IN (SELECT photo_id FROM photo_people WHERE person_name LIKE ?)
    )`;
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  sql += " ORDER BY reunion_year DESC, featured DESC, submitted_at DESC LIMIT 120";
  const photos = db.prepare(sql).all(...params);
  const years = db.prepare("SELECT year FROM reunions ORDER BY year DESC").all();
  const data = localsBase(req);
  clearFlash(req);
  res.render("photo-archive", { ...data, photos, years, q, year, branch });
});

app.get("/family-members", (req, res) => {
  const members = db.prepare(`
    SELECT * FROM family_members ORDER BY family_branch ASC, sort_order ASC, full_name ASC
  `).all();
  members.forEach((m) => {
    if (m.is_matriarch && m.family_branch === "Capocia") m.display_name = matriarchName();
    else m.display_name = m.preferred_name || m.full_name;
  });
  const data = localsBase(req);
  clearFlash(req);
  res.render("family-members", { ...data, members });
});

app.get("/family-members/:id", (req, res) => {
  const member = db.prepare("SELECT * FROM family_members WHERE id = ?").get(req.params.id);
  if (!member) return res.status(404).render("404", localsBase(req));
  if (member.is_matriarch && member.family_branch === "Capocia") {
    member.display_name = matriarchName();
  } else {
    member.display_name = member.preferred_name || member.full_name;
  }
  const data = localsBase(req);
  clearFlash(req);
  res.render("family-member", { ...data, member });
});

app.get("/community-board", (req, res) => {
  const posts = db.prepare(`
    SELECT * FROM board_posts WHERE status = 'approved'
    ORDER BY is_pinned DESC, created_at DESC LIMIT 100
  `).all();
  const data = localsBase(req);
  clearFlash(req);
  res.render("community-board", { ...data, posts });
});

app.post("/community-board", contributeLimiter, (req, res) => {
  const title = (req.body.title || "").trim();
  const body = (req.body.body || "").trim();
  const author_name = (req.body.author_name || "").trim();
  const author_email = (req.body.author_email || "").trim();
  const category = (req.body.category || "general").trim();
  if (!title || !body || !author_name) {
    setFlash(req, "error", "Please include your name, a title, and a message.");
    return res.redirect("/community-board");
  }
  db.prepare(`
    INSERT INTO board_posts (title, body, category, author_name, author_email, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(title, body, category, author_name, author_email || null);
  setFlash(req, "success", "Thank you. Your message was submitted for family administrator review.");
  res.redirect("/community-board");
});

app.get("/in-loving-memory", (req, res) => {
  const memorials = db.prepare(`
    SELECT * FROM memorials WHERE status = 'approved' ORDER BY full_name ASC
  `).all();
  const data = localsBase(req);
  clearFlash(req);
  res.render("memorials", { ...data, memorials });
});

app.get("/family-tree", (req, res) => {
  const data = localsBase(req);
  clearFlash(req);
  res.render("family-tree", data);
});

app.get("/upcoming-reunion", (req, res) => {
  const data = localsBase(req);
  clearFlash(req);
  res.render("upcoming", data);
});

app.get("/about", (req, res) => {
  const data = localsBase(req);
  clearFlash(req);
  res.render("about", data);
});

app.get("/privacy", (req, res) => {
  res.render("privacy", localsBase(req));
});

app.get("/guidelines", (req, res) => {
  res.render("guidelines", localsBase(req));
});

app.get("/contribute", (req, res) => {
  const years = db.prepare("SELECT year FROM reunions ORDER BY year DESC").all();
  const data = localsBase(req);
  clearFlash(req);
  res.render("contribute", { ...data, years, prefillYear: req.query.year || "" });
});

app.get("/contribute/photos", (req, res) => res.redirect(`/contribute${req.query.year ? `?year=${req.query.year}` : ""}`));

app.post("/contribute/photos", contributeLimiter, upload.array("photos", 20), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) {
      setFlash(req, "error", "Please choose at least one photograph to upload.");
      return res.redirect("/contribute");
    }
    if (!req.body.permission_confirmed) {
      setFlash(req, "error", "Please confirm you have permission to share these photographs.");
      return res.redirect("/contribute");
    }
    const contributor_name = (req.body.contributor_name || "").trim();
    if (!contributor_name) {
      setFlash(req, "error", "Please include your name so we can credit the contribution.");
      return res.redirect("/contribute");
    }

    let reunion_year = req.body.reunion_year ? parseInt(req.body.reunion_year, 10) : null;
    const year_unknown = req.body.year_unknown === "1" ? 1 : 0;
    const year_approximate = req.body.year_approximate === "1" ? 1 : 0;
    if (year_unknown) reunion_year = null;
    if (reunion_year && !db.prepare("SELECT year FROM reunions WHERE year = ?").get(reunion_year)) {
      db.prepare("INSERT INTO reunions (year, title) VALUES (?, ?)").run(
        reunion_year,
        `${reunion_year} Capocia–Miotto Family Reunion`
      );
    }

    const peopleNames = []
      .concat(req.body.person_name || [])
      .map((n) => String(n).trim())
      .filter(Boolean);

    const insertPhoto = db.prepare(`
      INSERT INTO photos (
        original_filename, original_path, web_path, thumb_path, title, description,
        reunion_year, year_approximate, year_unknown, family_branch, location, photo_date,
        original_owner, photographer, contributor_name, contributor_email, contributor_phone,
        permission_confirmed, may_display_public, status, file_size, mime_type, width, height
      ) VALUES (
        @original_filename, @original_path, @web_path, @thumb_path, @title, @description,
        @reunion_year, @year_approximate, @year_unknown, @family_branch, @location, @photo_date,
        @original_owner, @photographer, @contributor_name, @contributor_email, @contributor_phone,
        1, @may_display_public, 'pending', @file_size, @mime_type, @width, @height
      )
    `);
    const insertPerson = db.prepare(`
      INSERT INTO photo_people (photo_id, person_name, is_identified, status)
      VALUES (?, ?, 1, 'pending')
    `);

    const tx = db.transaction(() => {
      for (const file of files) {
        // processUpload is async - handle outside
      }
    });

    for (const file of files) {
      const processed = await processUpload(file);
      const info = insertPhoto.run({
        ...processed,
        title: (req.body.title || "").trim() || null,
        description: (req.body.description || "").trim() || null,
        reunion_year,
        year_approximate,
        year_unknown,
        family_branch: (req.body.family_branch || "both").trim(),
        location: (req.body.location || "").trim() || null,
        photo_date: (req.body.photo_date || "").trim() || null,
        original_owner: (req.body.original_owner || "").trim() || null,
        photographer: (req.body.photographer || "").trim() || null,
        contributor_name,
        contributor_email: (req.body.contributor_email || "").trim() || null,
        contributor_phone: (req.body.contributor_phone || "").trim() || null,
        may_display_public: req.body.may_display_public === "0" ? 0 : 1,
      });
      peopleNames.forEach((name) => insertPerson.run(info.lastInsertRowid, name));
    }

    setFlash(req, "success", "Thank you. Your photographs were received and will appear after a family administrator reviews them.");
    res.redirect("/contribute/thanks");
  } catch (err) {
    console.error(err);
    setFlash(req, "error", err.message || "Upload failed. Please try again with smaller image files.");
    res.redirect("/contribute");
  }
});

app.get("/contribute/thanks", (req, res) => {
  const data = localsBase(req);
  clearFlash(req);
  res.render("contribute-thanks", data);
});

app.get("/contribute/story", (req, res) => {
  const years = db.prepare("SELECT year FROM reunions ORDER BY year DESC").all();
  const data = localsBase(req);
  clearFlash(req);
  res.render("contribute-story", { ...data, years });
});

app.post("/contribute/story", contributeLimiter, (req, res) => {
  const body = (req.body.body || "").trim();
  const contributor_name = (req.body.contributor_name || "").trim();
  if (!body || !contributor_name) {
    setFlash(req, "error", "Please include your name and the story or family information.");
    return res.redirect("/contribute/story");
  }
  const year = req.body.reunion_year ? parseInt(req.body.reunion_year, 10) : null;
  db.prepare(`
    INSERT INTO stories (reunion_year, title, body, contributor_name, contributor_email, story_type, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    year || null,
    (req.body.title || "").trim() || null,
    body,
    contributor_name,
    (req.body.contributor_email || "").trim() || null,
    (req.body.story_type || "memory").trim()
  );
  setFlash(req, "success", "Thank you. Your story was submitted for review.");
  res.redirect("/contribute/thanks");
});

app.get("/corrections", (req, res) => {
  res.render("corrections", localsBase(req));
});

app.post("/corrections", contributeLimiter, (req, res) => {
  db.prepare(`
    INSERT INTO contributions_log (kind, payload_json, contributor_name, contributor_email, status)
    VALUES ('correction', ?, ?, ?, 'pending')
  `).run(
    JSON.stringify(req.body),
    (req.body.contributor_name || "").trim() || null,
    (req.body.contributor_email || "").trim() || null
  );
  setFlash(req, "success", "Your correction request was sent to the family administrators.");
  res.redirect("/contribute/thanks");
});

app.get("/request-removal", (req, res) => {
  res.render("request-removal", localsBase(req));
});

app.post("/request-removal", contributeLimiter, (req, res) => {
  db.prepare(`
    INSERT INTO contributions_log (kind, payload_json, contributor_name, contributor_email, status)
    VALUES ('removal_request', ?, ?, ?, 'pending')
  `).run(
    JSON.stringify(req.body),
    (req.body.contributor_name || "").trim() || null,
    (req.body.contributor_email || "").trim() || null
  );
  setFlash(req, "success", "Your removal request was submitted for review.");
  res.redirect("/contribute/thanks");
});

app.get("/contact", (req, res) => {
  res.render("contact", localsBase(req));
});

// ---------- Admin ----------
app.get("/admin/login", (req, res) => {
  if (req.session.user && ADMIN_ROLES.includes(req.session.user.role)) {
    return res.redirect("/admin");
  }
  const data = localsBase(req);
  clearFlash(req);
  res.render("admin/login", data);
});

app.post("/admin/login", rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }), (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    setFlash(req, "error", "Invalid email or password.");
    return res.redirect("/admin/login");
  }
  if (!ADMIN_ROLES.includes(user.role)) {
    setFlash(req, "error", "This account does not have administrator access.");
    return res.redirect("/admin/login");
  }
  req.session.user = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
  logActivity(user.id, "login", "Administrator signed in");
  res.redirect("/admin");
});

app.post("/admin/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

app.get("/admin", requireRole(...ADMIN_ROLES), (req, res) => {
  const stats = {
    pendingPhotos: db.prepare("SELECT COUNT(*) AS c FROM photos WHERE status = 'pending'").get().c,
    pendingStories: db.prepare("SELECT COUNT(*) AS c FROM stories WHERE status = 'pending'").get().c,
    pendingBoard: db.prepare("SELECT COUNT(*) AS c FROM board_posts WHERE status = 'pending'").get().c,
    approvedPhotos: db.prepare("SELECT COUNT(*) AS c FROM photos WHERE status = 'approved'").get().c,
    members: db.prepare("SELECT COUNT(*) AS c FROM family_members").get().c,
    reunions: db.prepare("SELECT COUNT(*) AS c FROM reunions").get().c,
  };
  const pendingPhotos = db.prepare(`
    SELECT * FROM photos WHERE status = 'pending' ORDER BY submitted_at DESC LIMIT 20
  `).all();
  const data = localsBase(req);
  clearFlash(req);
  res.render("admin/dashboard", { ...data, stats, pendingPhotos });
});

app.get("/admin/photos", requireRole(...ADMIN_ROLES), (req, res) => {
  const status = req.query.status || "pending";
  const photos = db.prepare(`
    SELECT * FROM photos WHERE status = ? ORDER BY submitted_at DESC LIMIT 200
  `).all(status);
  const people = {};
  photos.forEach((p) => {
    people[p.id] = db.prepare("SELECT * FROM photo_people WHERE photo_id = ?").all(p.id);
  });
  const data = localsBase(req);
  clearFlash(req);
  res.render("admin/photos", { ...data, photos, people, status });
});

app.post("/admin/photos/:id/approve", requireRole(...ADMIN_ROLES), (req, res) => {
  db.prepare(`
    UPDATE photos SET status = 'approved', reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?
  `).run(req.session.user.id, req.params.id);
  db.prepare(`UPDATE photo_people SET status = 'approved' WHERE photo_id = ?`).run(req.params.id);
  logActivity(req.session.user.id, "approve_photo", `photo ${req.params.id}`);
  setFlash(req, "success", "Photograph approved.");
  res.redirect("/admin/photos?status=pending");
});

app.post("/admin/photos/:id/reject", requireRole(...ADMIN_ROLES), (req, res) => {
  db.prepare(`
    UPDATE photos SET status = 'rejected', reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?
  `).run(req.session.user.id, req.params.id);
  logActivity(req.session.user.id, "reject_photo", `photo ${req.params.id}`);
  setFlash(req, "success", "Photograph rejected.");
  res.redirect("/admin/photos?status=pending");
});

app.post("/admin/photos/:id/update", requireRole(...ADMIN_ROLES), (req, res) => {
  const year = req.body.reunion_year ? parseInt(req.body.reunion_year, 10) : null;
  db.prepare(`
    UPDATE photos SET
      title = ?, description = ?, reunion_year = ?, family_branch = ?, location = ?,
      admin_notes = ?, featured = ?, visibility = ?
    WHERE id = ?
  `).run(
    (req.body.title || "").trim() || null,
    (req.body.description || "").trim() || null,
    year,
    (req.body.family_branch || "both").trim(),
    (req.body.location || "").trim() || null,
    (req.body.admin_notes || "").trim() || null,
    req.body.featured === "1" ? 1 : 0,
    (req.body.visibility || "public").trim(),
    req.params.id
  );
  setFlash(req, "success", "Photograph updated.");
  res.redirect(`/admin/photos?status=${req.body.return_status || "pending"}`);
});

app.get("/admin/members", requireRole(...ADMIN_ROLES), (req, res) => {
  const members = db.prepare("SELECT * FROM family_members ORDER BY sort_order, full_name").all();
  const data = localsBase(req);
  clearFlash(req);
  res.render("admin/members", { ...data, members });
});

app.post("/admin/members", requireRole("super_admin", "family_admin"), (req, res) => {
  db.prepare(`
    INSERT INTO family_members
      (full_name, preferred_name, family_branch, is_patriarch, is_matriarch, role_in_family, biography, is_placeholder, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    (req.body.full_name || "").trim(),
    (req.body.preferred_name || "").trim() || null,
    (req.body.family_branch || "both").trim(),
    req.body.is_patriarch === "1" ? 1 : 0,
    req.body.is_matriarch === "1" ? 1 : 0,
    (req.body.role_in_family || "").trim() || null,
    (req.body.biography || "").trim() || null,
    req.body.is_placeholder === "0" ? 0 : 1,
    parseInt(req.body.sort_order || "50", 10)
  );
  setFlash(req, "success", "Family member added.");
  res.redirect("/admin/members");
});

app.post("/admin/members/:id", requireRole("super_admin", "family_admin"), (req, res) => {
  const id = req.params.id;
  db.prepare(`
    UPDATE family_members SET
      full_name = ?, preferred_name = ?, family_branch = ?, is_patriarch = ?, is_matriarch = ?,
      role_in_family = ?, biography = ?, favorite_memories = ?, quotes = ?, is_placeholder = ?,
      sort_order = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    (req.body.full_name || "").trim(),
    (req.body.preferred_name || "").trim() || null,
    (req.body.family_branch || "").trim(),
    req.body.is_patriarch === "1" ? 1 : 0,
    req.body.is_matriarch === "1" ? 1 : 0,
    (req.body.role_in_family || "").trim() || null,
    (req.body.biography || "").trim() || null,
    (req.body.favorite_memories || "").trim() || null,
    (req.body.quotes || "").trim() || null,
    req.body.is_placeholder === "1" ? 1 : 0,
    parseInt(req.body.sort_order || "50", 10),
    id
  );
  // Editable Capocia matriarch display name
  if (req.body.update_matriarch_setting === "1") {
    const name = (req.body.preferred_name || req.body.full_name || "").trim();
    db.prepare(`
      INSERT INTO site_settings (key, value) VALUES ('matriarch_name_capocia', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(name);
  }
  setFlash(req, "success", "Family member updated.");
  res.redirect("/admin/members");
});

app.get("/admin/reunions", requireRole(...ADMIN_ROLES), (req, res) => {
  const reunions = db.prepare("SELECT * FROM reunions ORDER BY year DESC").all();
  const data = localsBase(req);
  clearFlash(req);
  res.render("admin/reunions", { ...data, reunions });
});

app.post("/admin/reunions/:year", requireRole(...ADMIN_ROLES), (req, res) => {
  const year = parseInt(req.params.year, 10);
  db.prepare(`
    UPDATE reunions SET
      title = ?, date_text = ?, location = ?, host_family = ?, summary = ?,
      no_reunion = ?, updated_at = datetime('now')
    WHERE year = ?
  `).run(
    (req.body.title || "").trim() || `${year} Capocia–Miotto Family Reunion`,
    (req.body.date_text || "").trim() || null,
    (req.body.location || "").trim() || null,
    (req.body.host_family || "").trim() || null,
    (req.body.summary || "").trim() || null,
    req.body.no_reunion === "1" ? 1 : 0,
    year
  );
  setFlash(req, "success", `Reunion ${year} updated.`);
  res.redirect("/admin/reunions");
});

app.get("/admin/board", requireRole(...ADMIN_ROLES), (req, res) => {
  const posts = db.prepare("SELECT * FROM board_posts ORDER BY created_at DESC LIMIT 200").all();
  const data = localsBase(req);
  clearFlash(req);
  res.render("admin/board", { ...data, posts });
});

app.post("/admin/board/:id/approve", requireRole(...ADMIN_ROLES), (req, res) => {
  db.prepare("UPDATE board_posts SET status = 'approved' WHERE id = ?").run(req.params.id);
  setFlash(req, "success", "Post approved.");
  res.redirect("/admin/board");
});

app.post("/admin/board/:id/reject", requireRole(...ADMIN_ROLES), (req, res) => {
  db.prepare("UPDATE board_posts SET status = 'rejected' WHERE id = ?").run(req.params.id);
  setFlash(req, "success", "Post rejected.");
  res.redirect("/admin/board");
});

app.post("/admin/board/:id/pin", requireRole(...ADMIN_ROLES), (req, res) => {
  db.prepare("UPDATE board_posts SET is_pinned = CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END WHERE id = ?").run(req.params.id);
  res.redirect("/admin/board");
});

app.get("/admin/stories", requireRole(...ADMIN_ROLES), (req, res) => {
  const stories = db.prepare("SELECT * FROM stories ORDER BY created_at DESC LIMIT 200").all();
  const data = localsBase(req);
  clearFlash(req);
  res.render("admin/stories", { ...data, stories });
});

app.post("/admin/stories/:id/approve", requireRole(...ADMIN_ROLES), (req, res) => {
  db.prepare("UPDATE stories SET status = 'approved' WHERE id = ?").run(req.params.id);
  setFlash(req, "success", "Story approved.");
  res.redirect("/admin/stories");
});

app.post("/admin/stories/:id/reject", requireRole(...ADMIN_ROLES), (req, res) => {
  db.prepare("UPDATE stories SET status = 'rejected' WHERE id = ?").run(req.params.id);
  setFlash(req, "success", "Story rejected.");
  res.redirect("/admin/stories");
});

app.get("/healthz", (_req, res) => res.type("text").send("ok"));

app.use((err, req, res, _next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    setFlash(req, "error", "Upload error: " + err.message);
    return res.redirect("/contribute");
  }
  res.status(500).render("error", { ...localsBase(req), message: "Something went wrong. Please try again." });
});

app.use((req, res) => {
  res.status(404).render("404", localsBase(req));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Capocia–Miotto tribute listening on :${PORT}`);
});
