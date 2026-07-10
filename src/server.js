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
const { saveAudioUpload, isAllowedAudioMime } = require("./audio");
const {
  listTreeAnchors,
  buildLivingTree,
  lineageFromMember,
  generationFromParent,
} = require("./familyTree");
const { sendFamilyPinEmail, CONTACT_EMAIL } = require("./mail");

const app = express();
const PORT = process.env.PORT || 3080;
const CURRENT_YEAR = new Date().getFullYear();
const SECRET = process.env.SESSION_SECRET || "Capoccia-Miotto-tribute-change-in-production";

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

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedAudioMime(file.mimetype)) cb(null, true);
    else cb(new Error("Only audio recordings are allowed (MP3, M4A, WAV, OGG, WebM)."));
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
  return getSetting("matriarch_name_capoccia", "Christine Capoccia");
}

function localsBase(req) {
  return {
    siteName: getSetting("site_name", "The Capoccia–Miotto Family Reunion Tribute"),
    foundedYear: 1977,
    currentYear: CURRENT_YEAR,
    user: req.session.user || null,
    path: req.path,
    flash: req.session.flash || null,
    matriarchName: matriarchName(),
    contributeCta: "Please help us preserve the history of the Capoccia and Miotto families. We are asking every family member to look through old photo albums, boxes, phones, computers, and family collections for photographs from past reunions. Even if you do not know the exact year or everyone shown in the photograph, please share it. Other family members may be able to help identify the people, place, or occasion.",
    contributeCta2: "Every photograph, name, story, recipe, invitation, and memory helps complete our family history.",
    contactEmail: CONTACT_EMAIL || "info@capocciamiotto.com",
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

/** Family contributor PIN — required before contribute forms */
function hasValidContributorPin(req) {
  return !!(req.session.contributorPin && req.session.contributorPin.pinId);
}

function requireContributorPin(req, res, next) {
  // Admins can contribute without a family PIN
  if (req.session.user && ADMIN_ROLES.includes(req.session.user.role)) {
    return next();
  }
  if (hasValidContributorPin(req)) return next();
  const nextUrl = req.originalUrl || "/contribute";
  // Avoid loop if already on pin page
  if (nextUrl.startsWith("/contribute/pin")) return next();
  const qs = nextUrl.includes("?") ? nextUrl.slice(nextUrl.indexOf("?")) : "";
  const year = req.query.year ? `?year=${encodeURIComponent(req.query.year)}` : qs.includes("year=") ? qs : "";
  let pinQs = year;
  if (!pinQs) {
    if (nextUrl.includes("/community-board") || nextUrl.includes("next=board")) pinQs = "?next=board";
    else if (nextUrl.includes("/contribute/member") || nextUrl.includes("next=member")) pinQs = "?next=member";
    else if (nextUrl.includes("/contribute/recording") || nextUrl.includes("next=recording")) pinQs = "?next=recording";
    else if (nextUrl.includes("/contribute/story") || nextUrl.includes("next=story")) pinQs = "?next=story";
  } else if (nextUrl.includes("/contribute/member")) {
    pinQs = year.includes("?") ? `${year}&next=member` : `?year=${encodeURIComponent(req.query.year)}&next=member`;
  } else if (nextUrl.includes("/contribute/recording")) {
    pinQs = year.includes("?") ? `${year}&next=recording` : `?year=${encodeURIComponent(req.query.year)}&next=recording`;
  }
  return res.redirect(`/contribute/pin${pinQs}`);
}

function normalizePin(raw) {
  return String(raw || "").replace(/\s+/g, "").trim();
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
    ORDER BY sort_order ASC, full_name ASC
  `).all();
  members.forEach((m) => {
    m.display_name = m.preferred_name || m.full_name;
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
  const members = db.prepare("SELECT id, full_name, preferred_name FROM family_members").all();
  const tree = buildLivingTree(db);
  const data = localsBase(req);
  clearFlash(req);
  res.render("family-story", { ...data, members, tree });
});

app.get("/reunion-timeline", (req, res) => {
  const reunions = db.prepare("SELECT * FROM reunions WHERE year <= ? ORDER BY year DESC").all(CURRENT_YEAR);
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
  if (Number.isNaN(year) || year < 1977 || year > CURRENT_YEAR) return res.status(404).render("404", localsBase(req));
  let reunion = db.prepare("SELECT * FROM reunions WHERE year = ?").get(year);
  if (!reunion) {
    db.prepare("INSERT INTO reunions (year, title) VALUES (?, ?)").run(year, `${year} Capoccia–Miotto Family Reunion`);
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
  const years = db.prepare("SELECT year FROM reunions WHERE year <= ? ORDER BY year DESC").all(CURRENT_YEAR);
  const data = localsBase(req);
  clearFlash(req);
  res.render("photo-archive", { ...data, photos, years, q, year, branch });
});

app.get("/family-members", (req, res) => {
  const members = db.prepare(`
    SELECT * FROM family_members
    WHERE visibility = 'public' OR visibility IS NULL
    ORDER BY sort_order ASC, full_name ASC
  `).all();
  members.forEach((m) => {
    m.display_name = m.preferred_name || m.full_name;
  });
  // Community family members = everyone not in the six patriarch/matriarch leader set
  function isLeader(m) {
    const full = m.full_name || "";
    const n = (full + " " + (m.preferred_name || "")).trim();
    if (/George/i.test(n) && /Capoccia/i.test(n)) return true;
    if (/Christine/i.test(n) && /Capoccia/i.test(n)) return true;
    if (/Tony|Anthony/i.test(full) && /Capoccia/i.test(full)) return true;
    if (/Frances|^Fran\b/i.test(full) && /Capoccia/i.test(full)) return true;
    if (/Mickey|Amerigo/i.test(n)) return true;
    if (/Anna/i.test(n) && /Miotto/i.test(n)) return true;
    return false;
  }
  const communityMembers = members.filter((m) => !isLeader(m));
  const data = localsBase(req);
  clearFlash(req);
  res.render("family-members", { ...data, members, communityMembers });
});

app.get("/family-members/:id", (req, res) => {
  const member = db.prepare("SELECT * FROM family_members WHERE id = ?").get(req.params.id);
  if (!member) return res.status(404).render("404", localsBase(req));
  if (member.is_matriarch && member.family_branch === "Capoccia") {
    member.display_name = matriarchName();
  } else {
    member.display_name = member.preferred_name || member.full_name;
  }
  const recordings = db.prepare(`
    SELECT * FROM voice_recordings
    WHERE status = 'approved' AND family_member_id = ?
    ORDER BY featured DESC, submitted_at DESC
  `).all(member.id);
  const data = localsBase(req);
  clearFlash(req);
  res.render("family-member", { ...data, member, recordings });
});

app.get("/voice-recordings", (req, res) => {
  const recordings = db.prepare(`
    SELECT v.*,
      COALESCE(fm.preferred_name, fm.full_name) AS member_name
    FROM voice_recordings v
    LEFT JOIN family_members fm ON fm.id = v.family_member_id
    WHERE v.status = 'approved'
    ORDER BY v.featured DESC, v.submitted_at DESC
    LIMIT 200
  `).all();
  const data = localsBase(req);
  clearFlash(req);
  res.render("voice-recordings", { ...data, recordings });
});

app.get("/community-board", requireContributorPin, (req, res) => {
  const posts = db.prepare(`
    SELECT * FROM board_posts WHERE status = 'approved'
    ORDER BY is_pinned DESC, created_at DESC LIMIT 100
  `).all();
  const data = localsBase(req);
  clearFlash(req);
  res.render("community-board", {
    ...data,
    posts,
    pinHolder: req.session.contributorPin || null,
  });
});

app.post("/community-board", contributeLimiter, requireContributorPin, (req, res) => {
  const title = (req.body.title || "").trim();
  const body = (req.body.body || "").trim();
  const author_name = (req.body.author_name || "").trim()
    || (req.session.contributorPin && req.session.contributorPin.assignedName)
    || "";
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
  // Deceased family members — same equal tribute cards as living leaders
  const members = db.prepare(`
    SELECT * FROM family_members
    WHERE is_memorial = 1
    ORDER BY sort_order ASC, full_name ASC
  `).all();
  members.forEach((m) => {
    m.display_name = m.preferred_name || m.full_name;
  });
  const data = localsBase(req);
  clearFlash(req);
  res.render("memorials", { ...data, members });
});

app.get("/family-tree", (req, res) => {
  const members = db.prepare("SELECT id, full_name, preferred_name FROM family_members").all();
  const tree = buildLivingTree(db);
  const data = localsBase(req);
  clearFlash(req);
  res.render("family-tree", { ...data, members, tree });
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

app.get("/contribute/pin", (req, res) => {
  if (hasValidContributorPin(req) || (req.session.user && ADMIN_ROLES.includes(req.session.user.role))) {
    const nextMap = {
      story: "/contribute/story",
      member: "/contribute/member",
      recording: "/voice-recordings",
      board: "/community-board",
      photos: "/contribute",
    };
    const nextKey = req.query.next || "photos";
    const next = nextMap[nextKey] || "/contribute";
    const year = req.query.year ? `?year=${encodeURIComponent(req.query.year)}` : "";
    if (next === "/contribute") return res.redirect(`${next}${year}`);
    return res.redirect(next);
  }
  const data = localsBase(req);
  clearFlash(req);
  res.render("contribute-pin", {
    ...data,
    prefillYear: req.query.year || "",
    next: req.query.next || "photos",
    prefillMember: req.query.member || "",
  });
});

app.get("/contribute/request-pin", (req, res) => {
  const data = localsBase(req);
  clearFlash(req);
  res.render("request-pin", data);
});

const pinRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many PIN requests from this device. Please try again later.",
});

app.post("/contribute/request-pin", pinRequestLimiter, async (req, res) => {
  const name = (req.body.name || "").trim();
  const email = (req.body.email || "").trim().toLowerCase();

  if (!name || !email) {
    setFlash(req, "error", "Please enter your name and email address.");
    return res.redirect("/contribute/request-pin");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setFlash(req, "error", "Please enter a valid email address.");
    return res.redirect("/contribute/request-pin");
  }

  // Light throttle: same email at most once every 10 minutes
  try {
    const recent = db.prepare(`
      SELECT id FROM pin_email_requests
      WHERE requester_email = ?
        AND created_at >= datetime('now', '-10 minutes')
        AND status = 'sent'
      LIMIT 1
    `).get(email);
    if (recent) {
      setFlash(req, "success", "If that email is correct, the family PIN was already sent recently. Please check your inbox and spam folder.");
      return res.redirect("/contribute/pin");
    }
  } catch (_) { /* table may not exist on first boot race */ }

  try {
    const result = await sendFamilyPinEmail({ toEmail: email, requesterName: name });
    db.prepare(`
      INSERT INTO pin_email_requests (requester_name, requester_email, status, method, details)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      name,
      email,
      result.ok ? "sent" : "failed",
      result.method || null,
      result.ok ? (result.id || "ok") : (result.error || "failed")
    );

    if (!result.ok) {
      console.error("PIN email failed:", result);
      setFlash(
        req,
        "error",
        `We could not send the PIN email right now. Please email ${CONTACT_EMAIL} and we will help you.`
      );
      return res.redirect("/contribute/request-pin");
    }

    setFlash(
      req,
      "success",
      `Your family PIN was emailed to ${email}. Please check your inbox (and spam folder), then enter the PIN below.`
    );
    return res.redirect("/contribute/pin");
  } catch (err) {
    console.error(err);
    setFlash(req, "error", `We could not send the PIN email. Please contact ${CONTACT_EMAIL}.`);
    return res.redirect("/contribute/request-pin");
  }
});

app.post("/contribute/pin", contributeLimiter, (req, res) => {
  const pin = normalizePin(req.body.pin);
  const year = (req.body.year || "").trim();
  const next = (req.body.next || "photos").trim();
  const backQs = [];
  if (year) backQs.push(`year=${encodeURIComponent(year)}`);
  if (next === "story" || next === "member" || next === "recording" || next === "board") {
    backQs.push(`next=${encodeURIComponent(next)}`);
  }
  if (req.body.member) backQs.push(`member=${encodeURIComponent(req.body.member)}`);
  const back = `/contribute/pin${backQs.length ? "?" + backQs.join("&") : ""}`;

  if (!pin || pin.length < 4) {
    setFlash(req, "error", "Please enter the family PIN you were given (at least 4 digits).");
    return res.redirect(back);
  }

  const row = db.prepare(`
    SELECT * FROM family_pins WHERE pin_code = ? AND active = 1
  `).get(pin);

  if (!row) {
    setFlash(req, "error", "That PIN was not recognized. Please check the number you were assigned and try again.");
    return res.redirect(back);
  }

  db.prepare(`
    UPDATE family_pins SET use_count = use_count + 1, last_used_at = datetime('now') WHERE id = ?
  `).run(row.id);

  req.session.contributorPin = {
    pinId: row.id,
    assignedName: row.assigned_name,
    verifiedAt: Date.now(),
  };

  setFlash(req, "success", `Welcome, ${row.assigned_name}. Your PIN was accepted.`);
  if (next === "story") return res.redirect("/contribute/story");
  if (next === "member") return res.redirect("/contribute/member");
  if (next === "board") return res.redirect("/community-board");
  if (next === "recording") return res.redirect("/voice-recordings");
  return res.redirect(year ? `/contribute?year=${encodeURIComponent(year)}` : "/contribute");
});

app.post("/contribute/pin/clear", (req, res) => {
  delete req.session.contributorPin;
  setFlash(req, "success", "Contributor PIN cleared on this device.");
  res.redirect("/contribute/pin");
});

app.get("/contribute", requireContributorPin, (req, res) => {
  const years = db.prepare("SELECT year FROM reunions WHERE year <= ? ORDER BY year DESC").all(CURRENT_YEAR);
  const data = localsBase(req);
  clearFlash(req);
  res.render("contribute", {
    ...data,
    years,
    prefillYear: req.query.year || "",
    pinHolder: req.session.contributorPin || null,
  });
});

app.get("/contribute/photos", (req, res) => res.redirect(`/contribute${req.query.year ? `?year=${req.query.year}` : ""}`));

app.post("/contribute/photos", contributeLimiter, requireContributorPin, upload.array("photos", 20), async (req, res) => {
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
    const contributor_name = (req.body.contributor_name || "").trim()
      || (req.session.contributorPin && req.session.contributorPin.assignedName)
      || "";
    if (!contributor_name) {
      setFlash(req, "error", "Please include your name so we can credit the contribution.");
      return res.redirect("/contribute");
    }

    let reunion_year = req.body.reunion_year ? parseInt(req.body.reunion_year, 10) : null;
    const year_unknown = req.body.year_unknown === "1" ? 1 : 0;
    const year_approximate = req.body.year_approximate === "1" ? 1 : 0;
    if (year_unknown) reunion_year = null;
    if (reunion_year && (reunion_year < 1977 || reunion_year > CURRENT_YEAR)) {
      reunion_year = null;
    }
    if (reunion_year && !db.prepare("SELECT year FROM reunions WHERE year = ?").get(reunion_year)) {
      db.prepare("INSERT INTO reunions (year, title) VALUES (?, ?)").run(
        reunion_year,
        `${reunion_year} Capoccia–Miotto Family Reunion`
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

app.get("/contribute/member", requireContributorPin, (req, res) => {
  const treeAnchors = listTreeAnchors(db);
  const data = localsBase(req);
  clearFlash(req);
  res.render("contribute-member", {
    ...data,
    treeAnchors,
    pinHolder: req.session.contributorPin || null,
  });
});

// Public voice recording is disabled — only administrators may upload recordings.
app.get("/contribute/recording", (req, res) => {
  setFlash(req, "success", "Family voice recordings are shared by administrators. You can listen below.");
  return res.redirect("/voice-recordings");
});
app.post("/contribute/recording", (req, res) => {
  setFlash(req, "error", "Public voice recording is not available. Only administrators can share family voices.");
  return res.redirect("/voice-recordings");
});

app.post("/contribute/member", contributeLimiter, requireContributorPin, (req, res) => {
  const full_name = (req.body.full_name || "").trim();
  const preferred_name = (req.body.preferred_name || "").trim() || null;
  const maiden_name = (req.body.maiden_name || "").trim() || null;
  const family_branch = (req.body.family_branch || "both").trim();
  const role_in_family = (req.body.role_in_family || "").trim() || null;
  const relation_to_family = (req.body.relation_to_family || "").trim();
  const short_bio = (req.body.short_bio || "").trim() || null;
  const relation_type = (req.body.relation_type || "child_of").trim();
  let parent_member_id = req.body.parent_member_id ? parseInt(req.body.parent_member_id, 10) : null;
  if (parent_member_id && Number.isNaN(parent_member_id)) parent_member_id = null;
  const contributor_name = (req.body.contributor_name || "").trim()
    || (req.session.contributorPin && req.session.contributorPin.assignedName)
    || "";
  const contributor_email = (req.body.contributor_email || "").trim() || null;
  const contributor_phone = (req.body.contributor_phone || "").trim() || null;
  const pinId = req.session.contributorPin && req.session.contributorPin.pinId
    ? req.session.contributorPin.pinId
    : null;

  if (!full_name || !relation_to_family || !contributor_name || !parent_member_id) {
    setFlash(req, "error", "Please include your name, relationship, and which family member to place you under on the tree.");
    return res.redirect("/contribute/member");
  }

  const parent = db.prepare("SELECT id FROM family_members WHERE id = ?").get(parent_member_id);
  if (!parent) {
    setFlash(req, "error", "Please choose a valid family member for your place on the tree.");
    return res.redirect("/contribute/member");
  }

  const allowedBranches = ["Capoccia", "Miotto", "both"];
  const branch = allowedBranches.includes(family_branch) ? family_branch : "both";
  const allowedRelations = ["child_of", "grandchild_of", "great_grandchild_of", "spouse_of", "other"];
  const relType = allowedRelations.includes(relation_type) ? relation_type : "child_of";
  const tree_lineage = lineageFromMember(db, parent_member_id);

  const info = db.prepare(`
    INSERT INTO family_member_submissions (
      full_name, preferred_name, maiden_name, family_branch, role_in_family,
      relation_to_family, short_bio, contributor_name, contributor_email, contributor_phone,
      pin_id, parent_member_id, tree_lineage, relation_type, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    full_name,
    preferred_name,
    maiden_name,
    branch,
    role_in_family,
    relation_to_family,
    short_bio,
    contributor_name,
    contributor_email,
    contributor_phone,
    pinId,
    parent_member_id,
    tree_lineage,
    relType
  );

  db.prepare(`
    INSERT INTO contributions_log (kind, ref_id, payload_json, contributor_name, contributor_email, status)
    VALUES ('family_member', ?, ?, ?, ?, 'pending')
  `).run(
    info.lastInsertRowid,
    JSON.stringify({ full_name, family_branch: branch, relation_to_family, parent_member_id, tree_lineage, relType }),
    contributor_name,
    contributor_email
  );

  setFlash(req, "success", "Thank you. Your name was submitted and will appear on the family tree after a family administrator reviews it.");
  res.redirect("/contribute/thanks");
});

app.get("/contribute/story", requireContributorPin, (req, res) => {
  const years = db.prepare("SELECT year FROM reunions WHERE year <= ? ORDER BY year DESC").all(CURRENT_YEAR);
  const data = localsBase(req);
  clearFlash(req);
  res.render("contribute-story", {
    ...data,
    years,
    pinHolder: req.session.contributorPin || null,
  });
});

app.post("/contribute/story", contributeLimiter, requireContributorPin, (req, res) => {
  const body = (req.body.body || "").trim();
  const contributor_name = (req.body.contributor_name || "").trim()
    || (req.session.contributorPin && req.session.contributorPin.assignedName)
    || "";
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
    pendingMembers: db.prepare("SELECT COUNT(*) AS c FROM family_member_submissions WHERE status = 'pending'").get().c,
    pendingRecordings: db.prepare("SELECT COUNT(*) AS c FROM voice_recordings WHERE status = 'pending'").get().c,
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
  const submissions = db.prepare(`
    SELECT * FROM family_member_submissions
    ORDER BY
      CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
      created_at DESC
    LIMIT 100
  `).all();
  const data = localsBase(req);
  clearFlash(req);
  res.render("admin/members", { ...data, members, submissions });
});

app.post("/admin/member-submissions/:id/approve", requireRole("super_admin", "family_admin", "content_moderator"), (req, res) => {
  const sub = db.prepare("SELECT * FROM family_member_submissions WHERE id = ?").get(req.params.id);
  if (!sub) {
    setFlash(req, "error", "Submission not found.");
    return res.redirect("/admin/members");
  }
  if (sub.status === "approved" && sub.family_member_id) {
    setFlash(req, "success", "This name was already approved.");
    return res.redirect("/admin/members");
  }

  const role = [sub.role_in_family, sub.relation_to_family].filter(Boolean).join(" · ") || null;
  const bio = sub.short_bio || null;
  const maxSort = db.prepare("SELECT COALESCE(MAX(sort_order), 50) AS m FROM family_members").get().m;
  const sortOrder = Math.max(100, (maxSort || 50) + 1);
  const parentId = sub.parent_member_id || null;
  const tree_lineage = sub.tree_lineage || (parentId ? lineageFromMember(db, parentId) : null);
  const generation = generationFromParent(db, parentId, sub.relation_type || "child_of");
  const spouseId = sub.relation_type === "spouse_of" ? parentId : null;
  const parentForTree = sub.relation_type === "spouse_of" ? null : parentId;

  const insert = db.prepare(`
    INSERT INTO family_members (
      full_name, preferred_name, maiden_name, family_branch,
      is_patriarch, is_matriarch, is_memorial, is_placeholder,
      role_in_family, biography, visibility, sort_order,
      parent_member_id, spouse_member_id, tree_lineage, generation, relation_type
    ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?, 'public', ?, ?, ?, ?, ?, ?)
  `).run(
    sub.full_name,
    sub.preferred_name || sub.full_name,
    sub.maiden_name || null,
    sub.family_branch || "both",
    role,
    bio,
    sortOrder,
    parentForTree,
    spouseId,
    tree_lineage,
    generation,
    sub.relation_type || "child_of"
  );

  db.prepare(`
    UPDATE family_member_submissions
    SET status = 'approved',
        family_member_id = ?,
        reviewed_at = datetime('now'),
        reviewed_by = ?
    WHERE id = ?
  `).run(insert.lastInsertRowid, req.session.user.id, sub.id);

  db.prepare(`
    UPDATE contributions_log SET status = 'approved'
    WHERE kind = 'family_member' AND ref_id = ?
  `).run(sub.id);

  logActivity(req.session.user.id, "approve_member_submission", `Approved family member submission #${sub.id}: ${sub.full_name}`);
  setFlash(req, "success", `${sub.full_name} was approved, added to Family Members, and placed on the living family tree.`);
  res.redirect("/admin/members");
});

app.post("/admin/member-submissions/:id/reject", requireRole("super_admin", "family_admin", "content_moderator"), (req, res) => {
  const sub = db.prepare("SELECT * FROM family_member_submissions WHERE id = ?").get(req.params.id);
  if (!sub) {
    setFlash(req, "error", "Submission not found.");
    return res.redirect("/admin/members");
  }
  db.prepare(`
    UPDATE family_member_submissions
    SET status = 'rejected',
        reviewed_at = datetime('now'),
        reviewed_by = ?
    WHERE id = ?
  `).run(req.session.user.id, sub.id);
  db.prepare(`
    UPDATE contributions_log SET status = 'rejected'
    WHERE kind = 'family_member' AND ref_id = ?
  `).run(sub.id);
  logActivity(req.session.user.id, "reject_member_submission", `Rejected family member submission #${sub.id}: ${sub.full_name}`);
  setFlash(req, "success", "Submission rejected.");
  res.redirect("/admin/members");
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
  // Editable Capoccia matriarch display name
  if (req.body.update_matriarch_setting === "1") {
    const name = (req.body.preferred_name || req.body.full_name || "").trim();
    db.prepare(`
      INSERT INTO site_settings (key, value) VALUES ('matriarch_name_capoccia', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(name);
  }
  setFlash(req, "success", "Family member updated.");
  res.redirect("/admin/members");
});

app.get("/admin/reunions", requireRole(...ADMIN_ROLES), (req, res) => {
  const reunions = db.prepare("SELECT * FROM reunions WHERE year <= ? ORDER BY year DESC").all(CURRENT_YEAR);
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
    (req.body.title || "").trim() || `${year} Capoccia–Miotto Family Reunion`,
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

app.get("/admin/pins", requireRole("super_admin", "family_admin"), (req, res) => {
  const pins = db.prepare(`
    SELECT * FROM family_pins ORDER BY active DESC, assigned_name ASC, created_at DESC
  `).all();
  const data = localsBase(req);
  clearFlash(req);
  res.render("admin/pins", { ...data, pins });
});

app.post("/admin/pins", requireRole("super_admin", "family_admin"), (req, res) => {
  const pin_code = normalizePin(req.body.pin_code);
  const assigned_name = (req.body.assigned_name || "").trim();
  const notes = (req.body.notes || "").trim() || null;

  if (!assigned_name) {
    setFlash(req, "error", "Please enter the family member’s name for this PIN.");
    return res.redirect("/admin/pins");
  }
  if (!/^\d{4,12}$/.test(pin_code)) {
    setFlash(req, "error", "PIN must be 4–12 digits (numbers only).");
    return res.redirect("/admin/pins");
  }
  const exists = db.prepare("SELECT id FROM family_pins WHERE pin_code = ?").get(pin_code);
  if (exists) {
    setFlash(req, "error", "That PIN is already assigned. Choose a different number.");
    return res.redirect("/admin/pins");
  }
  db.prepare(`
    INSERT INTO family_pins (pin_code, assigned_name, notes, created_by)
    VALUES (?, ?, ?, ?)
  `).run(pin_code, assigned_name, notes, req.session.user.id);
  logActivity(req.session.user.id, "create_pin", `${assigned_name} / ${pin_code}`);
  setFlash(req, "success", `PIN created for ${assigned_name}.`);
  res.redirect("/admin/pins");
});

app.post("/admin/pins/:id/toggle", requireRole("super_admin", "family_admin"), (req, res) => {
  db.prepare(`
    UPDATE family_pins SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?
  `).run(req.params.id);
  setFlash(req, "success", "PIN status updated.");
  res.redirect("/admin/pins");
});

app.post("/admin/pins/:id/delete", requireRole("super_admin", "family_admin"), (req, res) => {
  db.prepare("DELETE FROM family_pins WHERE id = ?").run(req.params.id);
  setFlash(req, "success", "PIN removed.");
  res.redirect("/admin/pins");
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

app.get("/admin/recordings", requireRole(...ADMIN_ROLES), (req, res) => {
  const recordings = db.prepare(`
    SELECT v.*,
      COALESCE(fm.preferred_name, fm.full_name) AS member_name
    FROM voice_recordings v
    LEFT JOIN family_members fm ON fm.id = v.family_member_id
    ORDER BY
      CASE v.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
      v.submitted_at DESC
    LIMIT 200
  `).all();
  const members = db.prepare(`
    SELECT id, full_name, preferred_name, role_in_family
    FROM family_members
    ORDER BY sort_order ASC, full_name ASC
  `).all();
  const data = localsBase(req);
  clearFlash(req);
  res.render("admin/recordings", { ...data, recordings, members });
});

app.post("/admin/recordings/upload", requireRole(...ADMIN_ROLES), audioUpload.single("recording"), (req, res) => {
  try {
    if (!req.file) {
      setFlash(req, "error", "Please choose an audio file to upload.");
      return res.redirect("/admin/recordings");
    }
    const speaker_name = (req.body.speaker_name || "").trim();
    if (!speaker_name) {
      setFlash(req, "error", "Please include whose voice this is.");
      return res.redirect("/admin/recordings");
    }
    let family_member_id = req.body.family_member_id ? parseInt(req.body.family_member_id, 10) : null;
    if (family_member_id && Number.isNaN(family_member_id)) family_member_id = null;
    if (family_member_id) {
      const exists = db.prepare("SELECT id FROM family_members WHERE id = ?").get(family_member_id);
      if (!exists) family_member_id = null;
    }
    const saved = saveAudioUpload(req.file);
    let recorded_year = req.body.recorded_year ? parseInt(req.body.recorded_year, 10) : null;
    if (recorded_year && (recorded_year < 1977 || recorded_year > CURRENT_YEAR)) recorded_year = null;
    const allowedTypes = ["story", "memory", "blessing", "tradition", "interview", "other"];
    const recording_type = allowedTypes.includes(req.body.recording_type) ? req.body.recording_type : "story";
    const publish = req.body.publish === "1";

    db.prepare(`
      INSERT INTO voice_recordings (
        title, description, speaker_name, family_member_id, recording_type,
        original_filename, file_path, mime_type, file_size, recorded_year,
        contributor_name, permission_confirmed, status, reviewed_at, reviewed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      (req.body.title || "").trim() || null,
      (req.body.description || "").trim() || null,
      speaker_name,
      family_member_id,
      recording_type,
      saved.original_filename,
      saved.file_path,
      saved.mime_type,
      saved.file_size,
      recorded_year,
      req.session.user.name || req.session.user.email || "Administrator",
      publish ? "approved" : "pending",
      publish ? new Date().toISOString().slice(0, 19).replace("T", " ") : null,
      publish ? req.session.user.id : null
    );

    logActivity(req.session.user.id, "upload_recording", `Admin uploaded voice for ${speaker_name}`);
    setFlash(req, "success", publish ? "Recording uploaded and published for listening." : "Recording uploaded (pending). Approve to publish.");
    res.redirect("/admin/recordings");
  } catch (err) {
    console.error(err);
    setFlash(req, "error", "Could not upload that recording.");
    res.redirect("/admin/recordings");
  }
});

app.post("/admin/recordings/:id/approve", requireRole(...ADMIN_ROLES), (req, res) => {
  db.prepare(`
    UPDATE voice_recordings
    SET status = 'approved', reviewed_at = datetime('now'), reviewed_by = ?
    WHERE id = ?
  `).run(req.session.user.id, req.params.id);
  db.prepare(`
    UPDATE contributions_log SET status = 'approved'
    WHERE kind = 'voice_recording' AND ref_id = ?
  `).run(req.params.id);
  logActivity(req.session.user.id, "approve_recording", `Approved voice recording #${req.params.id}`);
  setFlash(req, "success", "Recording approved.");
  res.redirect("/admin/recordings");
});

app.post("/admin/recordings/:id/reject", requireRole(...ADMIN_ROLES), (req, res) => {
  db.prepare(`
    UPDATE voice_recordings
    SET status = 'rejected', reviewed_at = datetime('now'), reviewed_by = ?
    WHERE id = ?
  `).run(req.session.user.id, req.params.id);
  db.prepare(`
    UPDATE contributions_log SET status = 'rejected'
    WHERE kind = 'voice_recording' AND ref_id = ?
  `).run(req.params.id);
  logActivity(req.session.user.id, "reject_recording", `Rejected voice recording #${req.params.id}`);
  setFlash(req, "success", "Recording rejected.");
  res.redirect("/admin/recordings");
});

app.post("/admin/recordings/:id/feature", requireRole(...ADMIN_ROLES), (req, res) => {
  const featured = req.body.featured === "1" ? 1 : 0;
  db.prepare("UPDATE voice_recordings SET featured = ? WHERE id = ?").run(featured, req.params.id);
  setFlash(req, "success", featured ? "Recording featured." : "Recording unfeatured.");
  res.redirect("/admin/recordings");
});

app.get("/healthz", (_req, res) => res.type("text").send("ok"));

app.use((err, req, res, _next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    setFlash(req, "error", "Upload error: " + err.message);
    const dest = (req.originalUrl || "").includes("recording") ? "/contribute/recording" : "/contribute";
    return res.redirect(dest);
  }
  if (err && /audio|image files are allowed/i.test(err.message || "")) {
    setFlash(req, "error", err.message);
    const dest = /audio/i.test(err.message) ? "/contribute/recording" : "/contribute";
    return res.redirect(dest);
  }
  res.status(500).render("error", { ...localsBase(req), message: "Something went wrong. Please try again." });
});

app.use((req, res) => {
  res.status(404).render("404", localsBase(req));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Capoccia–Miotto tribute listening on :${PORT}`);
});
