const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const db = require("./db");
const { processUpload, isAllowedMime } = require("./photos");
const { saveAudioUpload, isAllowedAudioMime } = require("./audio");
const {
  processBoardFile,
  isBoardMediaMime,
  ensureBoardMediaTable,
  mediaForPosts,
} = require("./boardMedia");
const {
  listTreeAnchors,
  buildLivingTree,
  lineageFromMember,
  generationFromParent,
} = require("./familyTree");
const { sendFamilyPinEmail, sendActivityReportEmail, sendGenericEmail, CONTACT_EMAIL } = require("./mail");
const {
  ensureAnalyticsTables,
  recordPageView,
  recordHeartbeat,
  getDashboardAnalytics,
  formatDuration,
} = require("./analytics");
const {
  ensureReunionDetailSchema,
  enrichReunion,
  reunionHasPublicDetails,
  apply2025FamilyEmailDetails,
  apply2026FamilyEmailDetails,
} = require("./reunionDetails");

const app = express();
const PORT = process.env.PORT || 3080;
const CURRENT_YEAR = new Date().getFullYear();
const SECRET = process.env.SESSION_SECRET || "Capoccia-Miotto-tribute-change-in-production";

/**
 * Family contributions publish immediately until further notice.
 * To re-enable admin review: set MODERATION_ENABLED=true in secrets and redeploy.
 */
const MODERATION_ENABLED = process.env.MODERATION_ENABLED === "true";
const CONTENT_STATUS = MODERATION_ENABLED ? "pending" : "approved";

/** Remember family PIN in this browser for up to 90 days (signed cookie). */
const PIN_COOKIE_NAME = "cmfr.family";
const PIN_REMEMBER_DAYS = 90;
const PIN_REMEMBER_MS = PIN_REMEMBER_DAYS * 24 * 60 * 60 * 1000;

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
app.use(cookieParser());
app.use(session({
  name: "cmfr.sid",
  secret: SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: PIN_REMEMBER_MS, // keep session aligned with PIN remember window
  },
}));

app.use("/uploads", express.static(path.join(__dirname, "..", "public", "uploads"), {
  maxAge: "7d",
  fallthrough: true,
}));
app.use(express.static(path.join(__dirname, "..", "public"), { maxAge: "1d" }));

const BULK_PHOTO_MAX = 50;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: BULK_PHOTO_MAX },
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

/** Community board: photos + videos with a message */
const boardUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 40 },
  fileFilter: (_req, file, cb) => {
    if (isBoardMediaMime(file.mimetype)) cb(null, true);
    else cb(new Error("Only photo and video files are allowed on the community board."));
  },
});

const contributeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many submissions. Please try again in a few minutes.",
});

const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 90,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "rate_limited" },
});

// Ensure analytics tables at boot
try {
  ensureAnalyticsTables(db);
} catch (e) {
  console.warn("analytics boot note:", e.message);
}

/** Lightweight analytics beacon (page views + time on site) */
app.post("/api/analytics/beacon", analyticsLimiter, (req, res) => {
  try {
    const body = req.body || {};
    const type = String(body.type || "pageview").toLowerCase();
    const sessionId = body.sessionId || body.session_id || "";
    const path = body.path || "/";
    const ip = clientIp(req);
    const userAgent = req.headers["user-agent"] || "";

    if (type === "heartbeat") {
      const result = recordHeartbeat(db, {
        sessionId,
        seconds: body.seconds,
        path,
        ip,
        userAgent,
      });
      return res.json({ ok: true, ...result });
    }

    const result = recordPageView(db, {
      sessionId,
      path,
      referrer: body.referrer || req.headers.referer || null,
      ip,
      userAgent,
    });
    return res.json({ ok: true, ...result });
  } catch (e) {
    console.warn("analytics beacon:", e.message);
    return res.status(200).json({ ok: false });
  }
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

function signPinRememberToken(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyPinRememberToken(token) {
  try {
    if (!token || typeof token !== "string" || !token.includes(".")) return null;
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expected = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!data || !data.pinId || !data.exp || Date.now() > Number(data.exp)) return null;
    const row = db.prepare(`
      SELECT id, assigned_name, active FROM family_pins WHERE id = ? AND active = 1
    `).get(data.pinId);
    if (!row) return null;
    return {
      pinId: row.id,
      assignedName: row.assigned_name || data.assignedName || "Family member",
      verifiedAt: data.verifiedAt || Date.now(),
      rememberUntil: Number(data.exp),
      fromRememberCookie: true,
    };
  } catch (_) {
    return null;
  }
}

function setPinRememberCookie(res, pinRow) {
  const exp = Date.now() + PIN_REMEMBER_MS;
  const token = signPinRememberToken({
    pinId: pinRow.id,
    assignedName: pinRow.assigned_name,
    verifiedAt: Date.now(),
    exp,
  });
  res.cookie(PIN_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: PIN_REMEMBER_MS,
    path: "/",
  });
  return exp;
}

function clearPinRememberCookie(res) {
  res.clearCookie(PIN_COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

/** Restore contributor PIN from 90-day browser cookie when session is empty. */
function restorePinFromCookie(req, res, next) {
  if (req.session.contributorPin && req.session.contributorPin.pinId) {
    return next();
  }
  const remembered = verifyPinRememberToken(req.cookies && req.cookies[PIN_COOKIE_NAME]);
  if (remembered) {
    req.session.contributorPin = remembered;
  } else if (req.cookies && req.cookies[PIN_COOKIE_NAME]) {
    // Invalid / expired / revoked PIN cookie
    clearPinRememberCookie(res);
  }
  return next();
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
  // Portrait upload on a member page
  const portraitMatch = nextUrl.match(/\/family-members\/(\d+)\/portrait/);
  if (portraitMatch) {
    return res.redirect(`/contribute/pin?next=portrait&member=${portraitMatch[1]}`);
  }
  const qs = nextUrl.includes("?") ? nextUrl.slice(nextUrl.indexOf("?")) : "";
  const year = req.query.year ? `?year=${encodeURIComponent(req.query.year)}` : qs.includes("year=") ? qs : "";
  let pinQs = year;
  if (!pinQs) {
    if (nextUrl.includes("/community-board") || nextUrl.includes("next=board")) pinQs = "?next=board";
    else if (nextUrl.includes("/upcoming-reunion") || nextUrl.includes("next=upcoming")) pinQs = "?next=upcoming";
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

/** Accept PIN with spaces/dashes (e.g. 2976-5240) — store/match digits only. */
function normalizePin(raw) {
  return String(raw || "").replace(/\D+/g, "");
}

/** 303 See Other — proper POST → GET redirect so browsers and clients never re-POST. */
function redirectAfterPost(res, location) {
  return res.redirect(303, location);
}

function logActivity(userId, action, details) {
  db.prepare("INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)").run(
    userId || null,
    action,
    details || null
  );
}

function clientIp(req) {
  const xf = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim();
  return xf || req.ip || req.socket?.remoteAddress || null;
}

function logSiteActivity(req, kind, { actorName, actorEmail, details } = {}) {
  try {
    db.prepare(`
      INSERT INTO site_activity (kind, actor_name, actor_email, details, ip, user_agent)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      kind,
      actorName || null,
      actorEmail || null,
      details || null,
      clientIp(req),
      (req.headers["user-agent"] || "").toString().slice(0, 400) || null
    );
  } catch (e) {
    console.warn("site_activity log note:", e.message);
  }
}

function ensureSiteActivityTable() {
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
  } catch (_) { /* ignore */ }
}

function formatActivityWhen(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-US", {
      timeZone: "America/Detroit",
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch (_) {
    return iso;
  }
}

function buildActivityReportText() {
  ensureSiteActivityTable();
  const pinLogins = db.prepare(`
    SELECT * FROM site_activity WHERE kind = 'pin_login'
    ORDER BY datetime(created_at) DESC LIMIT 100
  `).all();
  const pinRequests = db.prepare(`
    SELECT * FROM pin_email_requests
    ORDER BY datetime(created_at) DESC LIMIT 100
  `).all();
  const recentActivity = db.prepare(`
    SELECT * FROM site_activity
    ORDER BY datetime(created_at) DESC LIMIT 150
  `).all();
  const photoUploads = db.prepare(`
    SELECT id, title, contributor_name, contributor_email, status, reunion_year, submitted_at
    FROM photos ORDER BY datetime(submitted_at) DESC LIMIT 50
  `).all();

  const lines = [];
  lines.push("Capoccia–Miotto Family Tribute — Site Activity Report");
  lines.push(`Generated: ${formatActivityWhen(new Date().toISOString())} (Eastern)`);
  lines.push(`Site: https://capocciamiotto.com`);
  lines.push("");
  lines.push("══════════════════════════════════════");
  lines.push("FAMILY PIN LOGINS (who entered PIN)");
  lines.push("══════════════════════════════════════");
  if (!pinLogins.length) {
    lines.push("(none recorded yet)");
  } else {
    pinLogins.forEach((r) => {
      lines.push(
        `• ${formatActivityWhen(r.created_at)} — ${r.actor_name || "Family member"}` +
          (r.details ? ` · ${r.details}` : "") +
          (r.ip ? ` · IP ${r.ip}` : "")
      );
    });
  }
  lines.push("");
  lines.push("══════════════════════════════════════");
  lines.push("PIN # REQUESTS (name + email)");
  lines.push("══════════════════════════════════════");
  if (!pinRequests.length) {
    lines.push("(none recorded yet)");
  } else {
    pinRequests.forEach((r) => {
      lines.push(
        `• ${formatActivityWhen(r.created_at)} — ${r.requester_name || "—"} <${r.requester_email || "—"}>` +
          ` · status: ${r.status || "—"}` +
          (r.method ? ` via ${r.method}` : "")
      );
    });
  }
  lines.push("");
  lines.push("══════════════════════════════════════");
  lines.push("RECENT PHOTO UPLOADS");
  lines.push("══════════════════════════════════════");
  if (!photoUploads.length) {
    lines.push("(none)");
  } else {
    photoUploads.forEach((p) => {
      lines.push(
        `• ${formatActivityWhen(p.submitted_at)} — ${p.contributor_name || "—"}` +
          (p.contributor_email ? ` <${p.contributor_email}>` : "") +
          ` · ${p.title || "photo"} · year ${p.reunion_year || "?"} · ${p.status}`
      );
    });
  }
  lines.push("");
  lines.push("══════════════════════════════════════");
  lines.push("ALL RECENT ACTIVITY");
  lines.push("══════════════════════════════════════");
  if (!recentActivity.length) {
    lines.push("(none recorded yet)");
  } else {
    recentActivity.forEach((r) => {
      lines.push(
        `• ${formatActivityWhen(r.created_at)} [${r.kind}]` +
          ` ${r.actor_name || "—"}` +
          (r.actor_email ? ` <${r.actor_email}>` : "") +
          (r.details ? ` — ${r.details}` : "")
      );
    });
  }
  lines.push("");
  lines.push("— End of report —");
  lines.push("Dashboard: https://capocciamiotto.com/admin/activity");
  return lines.join("\n");
}

const ADMIN_ROLES = ["super_admin", "family_admin", "photo_moderator", "content_moderator", "reunion_organizer"];

/**
 * Publish a family-member submission onto the living tree (and optional spouse).
 * Used by admin approve and by open publishing when moderation is off.
 */
function publishMemberSubmission(sub, reviewedByUserId) {
  if (!sub) return { ok: false, error: "not_found" };
  if (sub.status === "approved" && sub.family_member_id) {
    return { ok: true, already: true, mainId: sub.family_member_id };
  }

  const role = [sub.role_in_family, sub.relation_to_family].filter(Boolean).join(" · ") || null;
  const bio = sub.short_bio || null;
  const maxSort = db.prepare("SELECT COALESCE(MAX(sort_order), 50) AS m FROM family_members").get().m;
  const sortOrder = Math.max(100, (maxSort || 50) + 1);
  const parentId = sub.parent_member_id || null;
  const tree_lineage = sub.tree_lineage || (parentId ? lineageFromMember(db, parentId) : null);
  const generation = generationFromParent(db, parentId, sub.relation_type || "child_of");
  const isSpouseOf = sub.relation_type === "spouse_of";
  const linkedSpouseId = isSpouseOf ? parentId : null;
  const parentForTree = isSpouseOf ? null : parentId;
  const spouseFull = (sub.spouse_full_name || "").trim();

  const insertMember = db.prepare(`
    INSERT INTO family_members (
      full_name, preferred_name, maiden_name, family_branch,
      is_patriarch, is_matriarch, is_memorial, is_placeholder,
      role_in_family, biography, visibility, sort_order,
      parent_member_id, spouse_member_id, tree_lineage, generation, relation_type
    ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?, 'public', ?, ?, ?, ?, ?, ?)
  `);

  const insert = insertMember.run(
    sub.full_name,
    sub.preferred_name || sub.full_name,
    sub.maiden_name || null,
    sub.family_branch || "both",
    role,
    bio,
    sortOrder,
    parentForTree,
    linkedSpouseId,
    tree_lineage,
    generation,
    sub.relation_type || "child_of"
  );
  const mainId = insert.lastInsertRowid;

  let createdSpouseId = null;
  if (spouseFull) {
    const spouseRole = `Spouse of ${sub.preferred_name || sub.full_name}`;
    const spouseInsert = insertMember.run(
      spouseFull,
      sub.spouse_preferred_name || spouseFull,
      sub.spouse_maiden_name || null,
      sub.family_branch || "both",
      spouseRole,
      null,
      sortOrder + 1,
      parentForTree,
      mainId,
      tree_lineage,
      generation,
      "spouse_of"
    );
    createdSpouseId = spouseInsert.lastInsertRowid;
    db.prepare("UPDATE family_members SET spouse_member_id = ? WHERE id = ?").run(createdSpouseId, mainId);
    if (isSpouseOf && parentId) {
      db.prepare(`
        UPDATE family_members
        SET spouse_member_id = COALESCE(spouse_member_id, ?)
        WHERE id = ?
      `).run(mainId, parentId);
    }
  } else if (isSpouseOf && parentId) {
    db.prepare(`
      UPDATE family_members
      SET spouse_member_id = COALESCE(spouse_member_id, ?)
      WHERE id = ?
    `).run(mainId, parentId);
  }

  db.prepare(`
    UPDATE family_member_submissions
    SET status = 'approved',
        family_member_id = ?,
        spouse_member_id = ?,
        reviewed_at = datetime('now'),
        reviewed_by = ?
    WHERE id = ?
  `).run(mainId, createdSpouseId, reviewedByUserId || null, sub.id);

  db.prepare(`
    UPDATE contributions_log SET status = 'approved'
    WHERE kind = 'family_member' AND ref_id = ?
  `).run(sub.id);

  return { ok: true, mainId, createdSpouseId, spouseFull };
}

/** When moderation is off, publish any backlog still sitting in pending. */
function publishPendingBacklog() {
  if (MODERATION_ENABLED) return;
  try {
    const photos = db.prepare("UPDATE photos SET status = 'approved' WHERE status = 'pending'").run();
    db.prepare("UPDATE photo_people SET status = 'approved' WHERE status = 'pending'").run();
    const board = db.prepare("UPDATE board_posts SET status = 'approved' WHERE status = 'pending'").run();
    const stories = db.prepare("UPDATE stories SET status = 'approved' WHERE status = 'pending'").run();
    const pendingMembers = db.prepare(`
      SELECT * FROM family_member_submissions WHERE status = 'pending' ORDER BY id ASC
    `).all();
    let membersPublished = 0;
    for (const sub of pendingMembers) {
      const result = publishMemberSubmission(sub, null);
      if (result.ok && !result.already) membersPublished += 1;
    }
    console.log(
      `[open-publish] backlog photos=${photos.changes} board=${board.changes} stories=${stories.changes} members=${membersPublished}`
    );
  } catch (err) {
    console.warn("publishPendingBacklog note:", err.message);
  }
}

publishPendingBacklog();

// Restore family PIN from 90-day browser cookie on every request
app.use(restorePinFromCookie);

// ---------- Public pages ----------
app.get("/", (req, res) => {
  const members = db.prepare(`
    SELECT * FROM family_members
    ORDER BY sort_order ASC, full_name ASC
  `).all();
  members.forEach((m) => {
    m.display_name = m.preferred_name || m.full_name;
  });
  // Home gallery: only photos you (admin) have explicitly approved for the home page
  ensureHomePhotoColumns();
  const recentPhotos = db.prepare(`
    SELECT * FROM photos
    WHERE status = 'approved'
      AND may_display_public = 1
      AND COALESCE(show_on_home, 0) = 1
      AND COALESCE(home_status, '') = 'approved'
    ORDER BY home_sort ASC, submitted_at DESC
    LIMIT 24
  `).all();
  const pinned = db.prepare(`
    SELECT * FROM board_posts WHERE status = 'approved' AND is_pinned = 1
    ORDER BY created_at DESC LIMIT 3
  `).all();
  const data = localsBase(req);
  clearFlash(req);
  res.render("home", { ...data, members, recentPhotos, pinned });
});

function ensureHomePhotoColumns() {
  try {
    const cols = db.prepare("PRAGMA table_info(photos)").all().map((c) => c.name);
    if (!cols.includes("show_on_home")) {
      db.exec("ALTER TABLE photos ADD COLUMN show_on_home INTEGER NOT NULL DEFAULT 0");
    }
    if (!cols.includes("home_sort")) {
      db.exec("ALTER TABLE photos ADD COLUMN home_sort INTEGER NOT NULL DEFAULT 0");
    }
    if (!cols.includes("home_status")) {
      db.exec("ALTER TABLE photos ADD COLUMN home_status TEXT");
    }
    // One-time: anything previously live without status → treat as pending (requires your approval)
    // Only run migration flag once via site_settings
    const migrated = db.prepare("SELECT value FROM site_settings WHERE key = 'home_photo_approval_v1'").get();
    if (!migrated) {
      db.prepare(`
        UPDATE photos
        SET show_on_home = 0,
            home_status = CASE
              WHEN COALESCE(show_on_home, 0) = 1 THEN 'pending'
              ELSE home_status
            END
        WHERE COALESCE(show_on_home, 0) = 1
           OR home_status = 'approved'
      `).run();
      // Force all off home until approved
      db.prepare(`
        UPDATE photos SET show_on_home = 0, home_status = 'pending'
        WHERE COALESCE(home_status, '') = 'pending'
           OR title LIKE '%Miotto Patriarch%'
           OR title LIKE '%Miotto Matriarch%'
           OR title LIKE '%Home gallery%'
      `).run();
      db.prepare(`
        INSERT INTO site_settings (key, value) VALUES ('home_photo_approval_v1', '1')
        ON CONFLICT(key) DO UPDATE SET value = '1'
      `).run();
    }
  } catch (_) { /* ignore */ }
}

app.get("/our-family-story", (req, res) => {
  const members = db.prepare(`
    SELECT id, full_name, preferred_name, role_in_family, portrait_path,
           is_patriarch, is_matriarch, is_memorial, family_branch, tree_lineage, biography
    FROM family_members
    WHERE visibility = 'public' OR visibility IS NULL
    ORDER BY sort_order ASC, full_name ASC
  `).all();
  members.forEach((m) => {
    m.display_name = m.preferred_name || m.full_name;
  });
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
  reunions.forEach((r) => {
    r.photo_count = countMap[r.year] || 0;
    // Always resolve cover for timeline: stored path, else featured/first approved photo
    const coverRow = db.prepare(`
      SELECT web_path, thumb_path, original_path FROM photos
      WHERE reunion_year = ? AND status = 'approved' AND may_display_public = 1
      ORDER BY
        CASE WHEN web_path = ? OR thumb_path = ? OR original_path = ? THEN 0 ELSE 1 END,
        featured DESC,
        submitted_at DESC,
        id DESC
      LIMIT 1
    `).get(
      r.year,
      r.cover_photo_path || "",
      r.cover_photo_path || "",
      r.cover_photo_path || ""
    );
    if (coverRow) {
      r.cover_photo_path = coverRow.web_path || coverRow.thumb_path || r.cover_photo_path;
      r.cover_thumb_path = coverRow.thumb_path || coverRow.web_path || r.cover_photo_path;
    } else if (r.cover_photo_path) {
      r.cover_thumb_path = r.cover_photo_path;
    }
  });
  const data = localsBase(req);
  clearFlash(req);
  res.render("timeline", { ...data, reunions });
});

/**
 * Cover photo for a reunion year: explicit cover_photo_path, else featured photo, else first photo.
 * Remaining approved photos form the year gallery (cover not duplicated).
 */
function resolveYearCoverAndGallery(reunion, photos) {
  const list = photos || [];
  let cover = null;
  if (reunion && reunion.cover_photo_path) {
    cover =
      list.find(
        (p) =>
          p.web_path === reunion.cover_photo_path ||
          p.original_path === reunion.cover_photo_path ||
          p.thumb_path === reunion.cover_photo_path
      ) || null;
    if (!cover) {
      cover = {
        id: null,
        web_path: reunion.cover_photo_path,
        thumb_path: reunion.cover_photo_path,
        title: `${reunion.year} Capoccia–Miotto Family Reunion`,
        is_cover_only: true,
      };
    }
  }
  if (!cover) {
    cover = list.find((p) => p.featured) || list[0] || null;
  }
  const gallery = cover && cover.id
    ? list.filter((p) => p.id !== cover.id)
    : list.filter((p) => !cover || p.web_path !== (cover && cover.web_path));
  return { coverPhoto: cover, galleryPhotos: gallery };
}

app.get("/reunion/:year", (req, res) => {
  const year = parseInt(req.params.year, 10);
  if (Number.isNaN(year) || year < 1977 || year > CURRENT_YEAR + 1) {
    return res.status(404).render("404", localsBase(req));
  }
  let reunion = db.prepare("SELECT * FROM reunions WHERE year = ?").get(year);
  if (!reunion) {
    db.prepare("INSERT INTO reunions (year, title) VALUES (?, ?)").run(year, `${year} Capoccia–Miotto Family Reunion`);
    reunion = db.prepare("SELECT * FROM reunions WHERE year = ?").get(year);
  }
  const photos = db.prepare(`
    SELECT * FROM photos WHERE reunion_year = ? AND status = 'approved' AND may_display_public = 1
    ORDER BY featured DESC, submitted_at DESC, id DESC
  `).all(year);
  const { coverPhoto, galleryPhotos } = resolveYearCoverAndGallery(reunion, photos);
  // If we have a photo cover but reunion.cover_photo_path empty, keep UI consistent
  if (coverPhoto && coverPhoto.web_path && !reunion.cover_photo_path) {
    reunion.cover_photo_path = coverPhoto.web_path;
  }
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
  res.render("reunion-year", {
    ...data,
    reunion,
    photos,
    coverPhoto,
    galleryPhotos,
    stories,
    peopleByPhoto,
  });
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
  res.render("family-member", {
    ...data,
    member,
    recordings,
    pinHolder: req.session.contributorPin || null,
    canUploadPhoto: hasValidContributorPin(req) || !!(req.session.user && ADMIN_ROLES.includes(req.session.user.role)),
  });
});

/** Family PIN required: set / replace a member portrait photo */
app.post(
  "/family-members/:id/portrait",
  contributeLimiter,
  requireContributorPin,
  upload.single("portrait"),
  async (req, res) => {
    const memberId = parseInt(req.params.id, 10);
    const member = db.prepare("SELECT * FROM family_members WHERE id = ?").get(memberId);
    if (!member || Number.isNaN(memberId)) {
      setFlash(req, "error", "Family member not found.");
      return res.redirect("/family-members");
    }
    if (!req.file) {
      setFlash(req, "error", "Please choose a photo to upload.");
      return res.redirect(`/family-members/${memberId}`);
    }
    try {
      const processed = await processUpload(req.file);
      db.prepare(`
        UPDATE family_members
        SET portrait_path = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(processed.web_path || processed.original_path, memberId);

      const actor =
        (req.session.contributorPin && req.session.contributorPin.assignedName) ||
        (req.session.user && (req.session.user.name || req.session.user.email)) ||
        "Family member";
      logSiteActivity(req, "portrait_upload", {
        actorName: actor,
        details: `Portrait for ${member.preferred_name || member.full_name} (id ${memberId})`,
      });

      setFlash(req, "success", `Photo added for ${member.preferred_name || member.full_name}. Thank you!`);
      return redirectAfterPost(res, `/family-members/${memberId}`);
    } catch (err) {
      console.error(err);
      setFlash(req, "error", err.message || "Could not upload that photo.");
      return redirectAfterPost(res, `/family-members/${memberId}`);
    }
  }
);

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
  ensureBoardMediaTable(db);
  const posts = db.prepare(`
    SELECT * FROM board_posts WHERE status = 'approved'
    ORDER BY is_pinned DESC, created_at DESC LIMIT 100
  `).all();
  const mediaMap = mediaForPosts(db, posts.map((p) => p.id));
  posts.forEach((p) => {
    p.media = mediaMap[p.id] || [];
  });
  const data = localsBase(req);
  clearFlash(req);
  res.render("community-board", {
    ...data,
    posts,
    pinHolder: req.session.contributorPin || null,
  });
});

app.post(
  "/community-board",
  contributeLimiter,
  requireContributorPin,
  boardUpload.fields([
    { name: "photos", maxCount: 30 },
    { name: "videos", maxCount: 5 },
  ]),
  async (req, res) => {
    try {
      ensureBoardMediaTable(db);
      const title = (req.body.title || "").trim();
      const body = (req.body.body || "").trim();
      const author_name = (req.body.author_name || "").trim()
        || (req.session.contributorPin && req.session.contributorPin.assignedName)
        || "";
      const author_email = (req.body.author_email || "").trim();
      const category = (req.body.category || "general").trim();
      const photoFiles = (req.files && req.files.photos) || [];
      const videoFiles = (req.files && req.files.videos) || [];
      const allFiles = photoFiles.concat(videoFiles);

      if (!title || !author_name) {
        setFlash(req, "error", "Please include a title and your name.");
        return res.redirect("/community-board");
      }
      if (!body && !allFiles.length) {
        setFlash(req, "error", "Please write a message and/or attach at least one photo or video.");
        return res.redirect("/community-board");
      }

      const info = db.prepare(`
        INSERT INTO board_posts (title, body, category, author_name, author_email, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(title, body || "", category, author_name, author_email || null, CONTENT_STATUS);
      const postId = info.lastInsertRowid;

      const insertMedia = db.prepare(`
        INSERT INTO board_post_media (
          board_post_id, media_type, original_filename, file_path, thumb_path, mime_type, file_size, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let sort = 0;
      for (const file of allFiles) {
        const processed = await processBoardFile(file);
        insertMedia.run(
          postId,
          processed.media_type,
          processed.original_filename,
          processed.file_path,
          processed.thumb_path,
          processed.mime_type,
          processed.file_size,
          sort++
        );
      }

      const mediaNote = allFiles.length
        ? ` with ${photoFiles.length ? `${photoFiles.length} photo${photoFiles.length === 1 ? "" : "s"}` : ""}${photoFiles.length && videoFiles.length ? " and " : ""}${videoFiles.length ? `${videoFiles.length} video${videoFiles.length === 1 ? "" : "s"}` : ""}`
        : "";

      logSiteActivity(req, "board_post", {
        actorName: author_name,
        actorEmail: author_email || null,
        details: `Board: ${title.slice(0, 80)}${mediaNote} · ${CONTENT_STATUS}`,
      });

      setFlash(
        req,
        "success",
        MODERATION_ENABLED
          ? "Thank you. Your message was submitted for family administrator review."
          : `Thank you. Your message${mediaNote} is now live on the community board.`
      );
      return redirectAfterPost(res, "/community-board");
    } catch (err) {
      console.error("Board post failed:", err);
      setFlash(req, "error", err.message || "Could not publish your message. Please try again.");
      return redirectAfterPost(res, "/community-board");
    }
  }
);

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

function ensureUpcomingReunionColumns() {
  try {
    ensureReunionDetailSchema(db);
  } catch (_) { /* ignore */ }
}

/** Prefer flagged upcoming, else soonest future/today event_date, else current/next year row with details */
function getUpcomingReunion() {
  ensureUpcomingReunionColumns();
  const flagged = db.prepare(`
    SELECT * FROM reunions
    WHERE is_upcoming = 1 AND COALESCE(no_reunion, 0) = 0
    ORDER BY year DESC LIMIT 1
  `).get();
  if (flagged && (flagged.event_date || flagged.place_name || flagged.address || flagged.date_text || flagged.location)) {
    return flagged;
  }
  const byDate = db.prepare(`
    SELECT * FROM reunions
    WHERE COALESCE(no_reunion, 0) = 0
      AND event_date IS NOT NULL AND trim(event_date) != ''
      AND date(event_date) >= date('now')
    ORDER BY date(event_date) ASC
    LIMIT 1
  `).get();
  if (byDate) return byDate;
  const recent = db.prepare(`
    SELECT * FROM reunions
    WHERE year >= ? AND COALESCE(no_reunion, 0) = 0
      AND (
        (event_date IS NOT NULL AND trim(event_date) != '')
        OR (place_name IS NOT NULL AND trim(place_name) != '')
        OR (address IS NOT NULL AND trim(address) != '')
        OR (date_text IS NOT NULL AND trim(date_text) != '')
        OR (location IS NOT NULL AND trim(location) != '')
      )
    ORDER BY year DESC
    LIMIT 1
  `).get(CURRENT_YEAR);
  return recent || null;
}

function formatReunionDisplayDate(isoDate) {
  if (!isoDate) return null;
  try {
    const d = new Date(isoDate.includes("T") ? isoDate : `${isoDate}T12:00:00`);
    if (Number.isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch (_) {
    return isoDate;
  }
}

app.get("/upcoming-reunion", (req, res) => {
  ensureUpcomingReunionColumns();
  try {
    apply2025FamilyEmailDetails(db, { force: false });
    apply2026FamilyEmailDetails(db, { force: false });
  } catch (e) {
    console.warn("reunion seed note:", e.message);
  }

  // Ensure current + next year rows exist for navigation
  for (const y of [CURRENT_YEAR, CURRENT_YEAR + 1]) {
    if (!db.prepare("SELECT year FROM reunions WHERE year = ?").get(y)) {
      db.prepare("INSERT INTO reunions (year, title, is_upcoming) VALUES (?, ?, ?)").run(
        y,
        `${y} Capoccia–Miotto Family Reunion`,
        y === CURRENT_YEAR ? 1 : 0
      );
    }
  }

  const primary = enrichReunion(db, getUpcomingReunion());
  const primaryYear = (primary && primary.year) || CURRENT_YEAR;

  // Year archive tabs: recent past through next few years (newest first)
  const tabFrom = CURRENT_YEAR - 12;
  const tabTo = CURRENT_YEAR + 3;
  const yearRows = db.prepare(`
    SELECT * FROM reunions
    WHERE year >= ? AND year <= ?
    ORDER BY year DESC
  `).all(tabFrom, tabTo);

  // Include any older years that have structured details archived
  const olderWithDetails = db.prepare(`
    SELECT * FROM reunions
    WHERE year < ?
      AND COALESCE(no_reunion, 0) = 0
      AND (
        (place_name IS NOT NULL AND trim(place_name) != '')
        OR (event_date IS NOT NULL AND trim(event_date) != '')
        OR (date_text IS NOT NULL AND trim(date_text) != '')
        OR (summary IS NOT NULL AND trim(summary) != '')
        OR (pricing_json IS NOT NULL AND trim(pricing_json) != '')
        OR (schedule_json IS NOT NULL AND trim(schedule_json) != '')
      )
    ORDER BY year DESC
    LIMIT 20
  `).all(tabFrom);

  const byYear = new Map();
  [...yearRows, ...olderWithDetails].forEach((row) => {
    if (!byYear.has(row.year)) byYear.set(row.year, row);
  });
  const yearTabs = Array.from(byYear.values())
    .sort((a, b) => b.year - a.year)
    .map((row) => {
      const enriched = enrichReunion(db, row);
      const has = reunionHasPublicDetails(enriched);
      return {
        year: enriched.year,
        title: enriched.title || `${enriched.year} Capoccia–Miotto Family Reunion`,
        place: enriched.place_name || enriched.location || null,
        date_text: enriched.display_date || enriched.date_text || null,
        hasDetails: has,
        isCurrent: enriched.year === primaryYear || !!enriched.is_upcoming,
        isPast: enriched.year < CURRENT_YEAR,
        isFuture: enriched.year > CURRENT_YEAR,
        cover_photo_path: enriched.cover_photo_path || null,
      };
    });

  // Selected year from ?year= — default to primary upcoming/current
  let selectedYear = parseInt(req.query.year, 10);
  if (Number.isNaN(selectedYear) || !byYear.has(selectedYear)) {
    // Prefer tab that matches primary, else current year, else first tab
    if (byYear.has(primaryYear)) selectedYear = primaryYear;
    else if (byYear.has(CURRENT_YEAR)) selectedYear = CURRENT_YEAR;
    else selectedYear = yearTabs.length ? yearTabs[0].year : CURRENT_YEAR;
  }

  const selected = enrichReunion(
    db,
    byYear.get(selectedYear) || db.prepare("SELECT * FROM reunions WHERE year = ?").get(selectedYear)
  );
  const hasDetails = reunionHasPublicDetails(selected);
  const isViewingCurrent =
    selected && (selected.year === primaryYear || selected.year === CURRENT_YEAR || !!selected.is_upcoming);

  const data = localsBase(req);
  clearFlash(req);
  res.render("upcoming", {
    ...data,
    upcoming: selected,
    focusYear: selectedYear,
    focusTitle: (selected && selected.title) || `${selectedYear} Capoccia–Miotto Family Reunion`,
    hasDetails,
    isViewingCurrent: !!isViewingCurrent,
    primaryYear,
    yearTabs,
    showAdminForm: req.query.email === "1" || req.query.email === "admin",
  });
});

/**
 * Public: email proposed reunion details to site admin (does not publish on the page).
 * Admin posts official details from the admin reunions screen.
 */
app.post("/upcoming-reunion/email-admin", contributeLimiter, async (req, res) => {
  const year = parseInt(req.body.year, 10) || CURRENT_YEAR;
  const organizer_name = (req.body.organizer_name || "").trim();
  const organizer_email = (req.body.organizer_email || "").trim().toLowerCase();
  const event_date = (req.body.event_date || "").trim();
  const event_time = (req.body.event_time || "").trim();
  const place_name = (req.body.place_name || "").trim();
  const address = (req.body.address || "").trim();
  const notes = (req.body.notes || "").trim();
  const phone = (req.body.phone || "").trim();

  const yearBack = `/upcoming-reunion?year=${encodeURIComponent(year)}&email=1#email-admin`;
  if (!organizer_name || !organizer_email) {
    setFlash(req, "error", "Please include your name and email so the website administrator can reply.");
    return res.redirect(yearBack);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(organizer_email)) {
    setFlash(req, "error", "Please enter a valid email address.");
    return res.redirect(yearBack);
  }
  if (!event_date && !event_time && !place_name && !address) {
    setFlash(req, "error", "Please include the reunion date, time, place name, and/or address to email the administrator.");
    return res.redirect(yearBack);
  }

  const escapeHtmlLite = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const displayDate = event_date ? (formatReunionDisplayDate(event_date) || event_date) : "(not provided)";
  const subject = `${year} Capoccia–Miotto reunion details from ${organizer_name}`;
  const text =
    `Family reunion details submitted for the website administrator.\n\n` +
    `Year: ${year}\n` +
    `Organizer: ${organizer_name}\n` +
    `Organizer email: ${organizer_email}\n` +
    (phone ? `Phone: ${phone}\n` : "") +
    `\n` +
    `Date: ${displayDate}\n` +
    `Time: ${event_time || "(not provided)"}\n` +
    `Place name: ${place_name || "(not provided)"}\n` +
    `Address: ${address || "(not provided)"}\n` +
    `\nNotes:\n${notes || "(none)"}\n\n` +
    `Please review and post official details in Admin → Reunions if approved.\n` +
    `https://capocciamiotto.com/admin/reunions\n`;

  const html =
    `<div style="font-family:Georgia,serif;color:#2b211c;line-height:1.6;max-width:560px">` +
    `<h2 style="color:#6b1f2a;margin:0 0 0.75rem">${year} Capoccia–Miotto Family Reunion</h2>` +
    `<p>A family member submitted reunion details for the website administrator.</p>` +
    `<table style="border-collapse:collapse;width:100%;font-size:15px">` +
    `<tr><td style="padding:6px 0;color:#7a675c">Organizer</td><td style="padding:6px 0"><strong>${escapeHtmlLite(organizer_name)}</strong></td></tr>` +
    `<tr><td style="padding:6px 0;color:#7a675c">Email</td><td style="padding:6px 0"><a href="mailto:${escapeHtmlLite(organizer_email)}">${escapeHtmlLite(organizer_email)}</a></td></tr>` +
    (phone ? `<tr><td style="padding:6px 0;color:#7a675c">Phone</td><td style="padding:6px 0">${escapeHtmlLite(phone)}</td></tr>` : "") +
    `<tr><td style="padding:6px 0;color:#7a675c">Date</td><td style="padding:6px 0"><strong>${escapeHtmlLite(displayDate)}</strong></td></tr>` +
    `<tr><td style="padding:6px 0;color:#7a675c">Time</td><td style="padding:6px 0">${escapeHtmlLite(event_time || "(not provided)")}</td></tr>` +
    `<tr><td style="padding:6px 0;color:#7a675c">Place</td><td style="padding:6px 0">${escapeHtmlLite(place_name || "(not provided)")}</td></tr>` +
    `<tr><td style="padding:6px 0;color:#7a675c">Address</td><td style="padding:6px 0">${escapeHtmlLite(address || "(not provided)")}</td></tr>` +
    `</table>` +
    (notes ? `<p style="margin-top:1rem"><strong>Notes</strong><br/>${escapeHtmlLite(notes).replace(/\n/g, "<br/>")}</p>` : "") +
    `<p style="margin-top:1.25rem;font-size:14px;color:#7a675c">Post official details: <a href="https://capocciamiotto.com/admin/reunions">Admin → Reunions</a></p>` +
    `</div>`;

  const adminTo = CONTACT_EMAIL || "info@capocciamiotto.com";
  try {
    const sent = await sendGenericEmail({
      toEmail: adminTo,
      subject,
      text,
      html,
    });
    // Also notify Mike when admin inbox is the family address
    if (sent.ok && adminTo.toLowerCase() !== "mike@seifertcapital.com") {
      try {
        await sendGenericEmail({
          toEmail: "mike@seifertcapital.com",
          subject: `[Copy] ${subject}`,
          text,
          html,
        });
      } catch (_) { /* non-fatal */ }
    }

    if (!sent.ok) {
      console.error("Reunion details email failed:", sent);
      setFlash(
        req,
        "error",
        `We could not send the email right now. Please write ${adminTo} directly with the reunion details.`
      );
      return res.redirect("/upcoming-reunion?email=1#email-admin");
    }

    logSiteActivity(req, "reunion_details_email", {
      actorName: organizer_name,
      actorEmail: organizer_email,
      details: `${year}: ${[displayDate, event_time, place_name, address].filter(Boolean).join(" · ")}`,
    });

    setFlash(
      req,
      "success",
      `Thank you, ${organizer_name}. Your ${year} reunion details were emailed to the website administrator for review.`
    );
    return res.redirect(`/upcoming-reunion?year=${encodeURIComponent(year)}`);
  } catch (err) {
    console.error(err);
    setFlash(req, "error", `Could not send email. Please contact ${adminTo}.`);
    return res.redirect(`/upcoming-reunion?year=${encodeURIComponent(year)}&email=1#email-admin`);
  }
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
    const nextKey = req.query.next || "photos";
    if (nextKey === "portrait" && req.query.member) {
      return res.redirect(`/family-members/${encodeURIComponent(req.query.member)}`);
    }
    if (nextKey === "upcoming") {
      return res.redirect("/upcoming-reunion#reunion-details-form");
    }
    const nextMap = {
      story: "/contribute/story",
      member: "/contribute/member",
      recording: "/voice-recordings",
      board: "/community-board",
      photos: "/contribute",
    };
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

    ensureSiteActivityTable();
    logSiteActivity(req, result.ok ? "pin_request" : "pin_request_failed", {
      actorName: name,
      actorEmail: email,
      details: result.ok
        ? `PIN emailed via ${result.method || "resend"} (${result.id || "ok"})`
        : `PIN email failed: ${result.error || "unknown"}`,
    });

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
  const memberId = (req.body.member || "").trim();
  const backQs = [];
  if (year) backQs.push(`year=${encodeURIComponent(year)}`);
  if (next === "story" || next === "member" || next === "recording" || next === "board" || next === "portrait" || next === "upcoming") {
    backQs.push(`next=${encodeURIComponent(next)}`);
  }
  if (memberId) backQs.push(`member=${encodeURIComponent(memberId)}`);
  const back = `/contribute/pin${backQs.length ? "?" + backQs.join("&") : ""}`;

  if (!pin || pin.length < 4) {
    setFlash(req, "error", "Please enter the family PIN you were given (at least 4 digits).");
    return redirectAfterPost(res, back);
  }

  // Match stored PIN either as-entered or digits-only (legacy rows may include separators)
  const row = db.prepare(`
    SELECT * FROM family_pins
    WHERE active = 1
      AND (
        pin_code = ?
        OR REPLACE(REPLACE(REPLACE(pin_code, ' ', ''), '-', ''), '.', '') = ?
      )
    LIMIT 1
  `).get(pin, pin);

  if (!row) {
    ensureSiteActivityTable();
    logSiteActivity(req, "pin_login_failed", {
      details: "Unrecognized PIN attempt",
    });
    setFlash(req, "error", "That PIN was not recognized. Please check the number you were assigned and try again.");
    return redirectAfterPost(res, back);
  }

  db.prepare(`
    UPDATE family_pins SET use_count = use_count + 1, last_used_at = datetime('now') WHERE id = ?
  `).run(row.id);

  const rememberUntil = setPinRememberCookie(res, row);
  req.session.contributorPin = {
    pinId: row.id,
    assignedName: row.assigned_name,
    verifiedAt: Date.now(),
    rememberUntil,
    fromRememberCookie: false,
  };
  // Touch session so cookie maxAge is issued with the longer remember window
  req.session.cookie.maxAge = PIN_REMEMBER_MS;

  ensureSiteActivityTable();
  logSiteActivity(req, "pin_login", {
    actorName: row.assigned_name || "Family member",
    details: `Family PIN accepted (pin id ${row.id})${next && next !== "photos" ? ` · next=${next}` : ""}${memberId ? ` · member=${memberId}` : ""}`,
  });

  setFlash(
    req,
    "success",
    `Welcome, ${row.assigned_name}. Your PIN was accepted. ` +
      `This browser is remembered — you will not have to enter the family PIN again for up to ${PIN_REMEMBER_DAYS} days.`
  );
  if (next === "story") return redirectAfterPost(res, "/contribute/story");
  if (next === "member") return redirectAfterPost(res, "/contribute/member");
  if (next === "board") return redirectAfterPost(res, "/community-board");
  if (next === "recording") return redirectAfterPost(res, "/voice-recordings");
  if (next === "upcoming") return redirectAfterPost(res, "/upcoming-reunion#reunion-details-form");
  if (next === "portrait" && memberId) return redirectAfterPost(res, `/family-members/${encodeURIComponent(memberId)}`);
  return redirectAfterPost(res, year ? `/contribute?year=${encodeURIComponent(year)}` : "/contribute");
});

app.post("/contribute/pin/clear", (req, res) => {
  delete req.session.contributorPin;
  clearPinRememberCookie(res);
  setFlash(req, "success", "This browser will no longer remember your family PIN. You can enter it again anytime.");
  redirectAfterPost(res, "/contribute/pin");
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

app.post("/contribute/photos", contributeLimiter, requireContributorPin, upload.array("photos", BULK_PHOTO_MAX), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) {
      setFlash(req, "error", "Please choose at least one photograph to upload.");
      return redirectAfterPost(res, "/contribute");
    }
    if (!req.body.permission_confirmed) {
      setFlash(req, "error", "Please confirm you have permission to share these photographs.");
      return redirectAfterPost(res, "/contribute");
    }
    const pinName = (req.session.contributorPin && req.session.contributorPin.assignedName) || "";
    // Prefer a real personal name over the shared "Capoccia–Miotto Family" label
    const sharedLabel = /^capoccia/i.test(pinName) && /family/i.test(pinName);
    const contributor_name = (req.body.contributor_name || "").trim()
      || (!sharedLabel ? pinName : "")
      || "";
    if (!contributor_name) {
      setFlash(req, "error", "Please include your name so we can credit the contribution.");
      return redirectAfterPost(res, "/contribute");
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
        1, @may_display_public, @status, @file_size, @mime_type, @width, @height
      )
    `);
    const insertPerson = db.prepare(`
      INSERT INTO photo_people (photo_id, person_name, is_identified, status)
      VALUES (?, ?, 1, ?)
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
        status: CONTENT_STATUS,
      });
      peopleNames.forEach((name) => insertPerson.run(info.lastInsertRowid, name, CONTENT_STATUS));
    }

    const actor =
      contributor_name ||
      (req.session.contributorPin && req.session.contributorPin.assignedName) ||
      "Family member";
    logSiteActivity(req, "photo_upload", {
      actorName: actor,
      actorEmail: (req.body.contributor_email || "").trim() || null,
      details: `${files.length} photo(s) uploaded · year ${reunion_year || "unknown"} · ${CONTENT_STATUS}`,
    });

    setFlash(
      req,
      "success",
      MODERATION_ENABLED
        ? "Thank you. Your photographs were received and will appear after a family administrator reviews them."
        : "Thank you. Your photographs are live in the family archive."
    );
    redirectAfterPost(res, "/contribute/thanks");
  } catch (err) {
    console.error(err);
    setFlash(req, "error", err.message || "Upload failed. Please try again with smaller image files.");
    redirectAfterPost(res, "/contribute");
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
  const spouse_full_name = (req.body.spouse_full_name || "").trim() || null;
  const spouse_preferred_name = (req.body.spouse_preferred_name || "").trim() || null;
  const spouse_maiden_name = (req.body.spouse_maiden_name || "").trim() || null;
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
      pin_id, parent_member_id, tree_lineage, relation_type,
      spouse_full_name, spouse_preferred_name, spouse_maiden_name, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    relType,
    spouse_full_name,
    spouse_preferred_name,
    spouse_maiden_name,
    CONTENT_STATUS
  );

  const subId = info.lastInsertRowid;
  db.prepare(`
    INSERT INTO contributions_log (kind, ref_id, payload_json, contributor_name, contributor_email, status)
    VALUES ('family_member', ?, ?, ?, ?, ?)
  `).run(
    subId,
    JSON.stringify({
      full_name,
      family_branch: branch,
      relation_to_family,
      parent_member_id,
      tree_lineage,
      relType,
      spouse_full_name,
      spouse_preferred_name,
      spouse_maiden_name,
    }),
    contributor_name,
    contributor_email,
    CONTENT_STATUS
  );

  const spouseNote = spouse_full_name ? " (with spouse)" : "";
  logSiteActivity(req, "member_submit", {
    actorName: contributor_name,
    actorEmail: contributor_email,
    details: `Member: ${full_name}${spouseNote} · ${CONTENT_STATUS}`,
  });
  if (!MODERATION_ENABLED) {
    const sub = db.prepare("SELECT * FROM family_member_submissions WHERE id = ?").get(subId);
    publishMemberSubmission(sub, null);
    setFlash(
      req,
      "success",
      `Thank you. Your name${spouseNote} is now on the family tree and Family Members list.`
    );
  } else {
    setFlash(
      req,
      "success",
      `Thank you. Your name${spouseNote} was submitted and will appear on the family tree after a family administrator reviews it.`
    );
  }
  return redirectAfterPost(res, "/contribute/thanks");
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
  const storyTitle = (req.body.title || "").trim() || null;
  db.prepare(`
    INSERT INTO stories (reunion_year, title, body, contributor_name, contributor_email, story_type, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    year || null,
    storyTitle,
    body,
    contributor_name,
    (req.body.contributor_email || "").trim() || null,
    (req.body.story_type || "memory").trim(),
    CONTENT_STATUS
  );
  logSiteActivity(req, "story_submit", {
    actorName: contributor_name,
    actorEmail: (req.body.contributor_email || "").trim() || null,
    details: `Story: ${(storyTitle || body).slice(0, 80)} · ${CONTENT_STATUS}`,
  });
  setFlash(
    req,
    "success",
    MODERATION_ENABLED
      ? "Thank you. Your story was submitted for review."
      : "Thank you. Your story is now published for the family."
  );
  return redirectAfterPost(res, "/contribute/thanks");
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
  return redirectAfterPost(res, "/contribute/thanks");
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
  return redirectAfterPost(res, "/contribute/thanks");
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
  ensureSiteActivityTable();
  logSiteActivity(req, "admin_login", {
    actorName: user.name || user.email,
    actorEmail: user.email,
    details: `Admin role: ${user.role}`,
  });
  res.redirect("/admin");
});

app.post("/admin/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

app.get("/admin/activity", requireRole(...ADMIN_ROLES), (req, res) => {
  ensureSiteActivityTable();
  const pinLogins = db.prepare(`
    SELECT * FROM site_activity WHERE kind = 'pin_login'
    ORDER BY datetime(created_at) DESC LIMIT 100
  `).all();
  const pinRequests = db.prepare(`
    SELECT * FROM pin_email_requests
    ORDER BY datetime(created_at) DESC LIMIT 100
  `).all();
  const recentActivity = db.prepare(`
    SELECT * FROM site_activity
    ORDER BY datetime(created_at) DESC LIMIT 150
  `).all();
  const photoUploads = db.prepare(`
    SELECT id, title, contributor_name, contributor_email, status, reunion_year, submitted_at
    FROM photos ORDER BY datetime(submitted_at) DESC LIMIT 50
  `).all();
  const data = localsBase(req);
  clearFlash(req);
  res.render("admin/activity", {
    ...data,
    pinLogins,
    pinRequests,
    recentActivity,
    photoUploads,
  });
});

app.post("/admin/activity/email-report", requireRole(...ADMIN_ROLES), async (req, res) => {
  ensureSiteActivityTable();
  const to = (req.body.to_email || "mike@seifertcapital.com").trim().toLowerCase();
  try {
    const report = buildActivityReportText();
    const sent = await sendActivityReportEmail(to, report);
    if (!sent.ok) {
      setFlash(req, "error", `Could not send report: ${sent.error || "unknown error"}`);
    } else {
      logSiteActivity(req, "activity_report_email", {
        actorName: req.session.user.name || req.session.user.email,
        actorEmail: req.session.user.email,
        details: `Report emailed to ${to}`,
      });
      setFlash(req, "success", `Activity report emailed to ${to}.`);
    }
  } catch (e) {
    console.error(e);
    setFlash(req, "error", e.message || "Could not send report.");
  }
  res.redirect("/admin/activity");
});

app.get("/admin", requireRole(...ADMIN_ROLES), (req, res) => {
  ensureAnalyticsTables(db);
  ensureSiteActivityTable();
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
  let analytics = null;
  try {
    analytics = getDashboardAnalytics(db);
  } catch (e) {
    console.warn("dashboard analytics:", e.message);
    analytics = null;
  }
  const data = localsBase(req);
  clearFlash(req);
  res.render("admin/dashboard", { ...data, stats, pendingPhotos, analytics, formatDuration });
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
  ensureHomePhotoColumns();
  const year = req.body.reunion_year ? parseInt(req.body.reunion_year, 10) : null;
  const homeSort = parseInt(req.body.home_sort || "0", 10);
  const wantHome = req.body.show_on_home === "1";
  const existing = db.prepare("SELECT home_status, show_on_home FROM photos WHERE id = ?").get(req.params.id);
  // Nominating for home does NOT publish until you Approve on Home Photos
  let homeStatus = existing && existing.home_status ? existing.home_status : null;
  let showOnHome = existing && existing.show_on_home ? 1 : 0;
  if (wantHome) {
    if (homeStatus !== "approved") {
      homeStatus = "pending";
      showOnHome = 0;
    }
  } else {
    homeStatus = null;
    showOnHome = 0;
  }
  db.prepare(`
    UPDATE photos SET
      title = ?, description = ?, reunion_year = ?, family_branch = ?, location = ?,
      admin_notes = ?, featured = ?, show_on_home = ?, home_sort = ?, home_status = ?, visibility = ?
    WHERE id = ?
  `).run(
    (req.body.title || "").trim() || null,
    (req.body.description || "").trim() || null,
    year,
    (req.body.family_branch || "both").trim(),
    (req.body.location || "").trim() || null,
    (req.body.admin_notes || "").trim() || null,
    req.body.featured === "1" ? 1 : 0,
    showOnHome,
    Number.isFinite(homeSort) ? homeSort : 0,
    homeStatus,
    (req.body.visibility || "public").trim(),
    req.params.id
  );
  setFlash(
    req,
    "success",
    wantHome && homeStatus === "pending"
      ? "Saved. Photo is waiting for home-page approval (Admin → Home Photos)."
      : "Photograph updated."
  );
  const back = req.body.return_to === "home"
    ? "/admin/home-photos"
    : `/admin/photos?status=${req.body.return_status || "pending"}`;
  res.redirect(back);
});

/** Admin-only homepage photo gallery — uploads wait for your approval before going live */
app.get("/admin/home-photos", requireRole(...ADMIN_ROLES), (req, res) => {
  ensureHomePhotoColumns();
  const pendingPhotos = db.prepare(`
    SELECT * FROM photos
    WHERE COALESCE(home_status, '') = 'pending'
    ORDER BY home_sort ASC, submitted_at DESC
  `).all();
  const livePhotos = db.prepare(`
    SELECT * FROM photos
    WHERE COALESCE(show_on_home, 0) = 1
      AND COALESCE(home_status, '') = 'approved'
    ORDER BY home_sort ASC, submitted_at DESC
  `).all();
  const data = localsBase(req);
  clearFlash(req);
  res.render("admin/home-photos", { ...data, pendingPhotos, livePhotos });
});

app.post(
  "/admin/home-photos/upload",
  requireRole(...ADMIN_ROLES),
  upload.array("photos", BULK_PHOTO_MAX),
  async (req, res) => {
    ensureHomePhotoColumns();
    const files = req.files || [];
    if (!files.length) {
      setFlash(req, "error", "Please choose at least one photograph for the home page.");
      return res.redirect("/admin/home-photos");
    }
    const titleBase = (req.body.title || "").trim() || "Home gallery";
    const maxSort = db.prepare(`
      SELECT COALESCE(MAX(home_sort), 0) AS m FROM photos
      WHERE COALESCE(home_status, '') IN ('pending', 'approved')
    `).get().m;
    let sort = maxSort + 10;
    let count = 0;
    try {
      for (const file of files) {
        const processed = await processUpload(file);
        db.prepare(`
          INSERT INTO photos (
            original_filename, original_path, web_path, thumb_path,
            title, description, reunion_year, family_branch,
            contributor_name, permission_confirmed, may_display_public,
            status, featured, show_on_home, home_sort, home_status,
            file_size, mime_type, width, height, reviewed_at, reviewed_by
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'both', ?, 1, 1, 'approved', 0, 0, ?, 'pending', ?, ?, ?, ?, datetime('now'), ?)
        `).run(
          processed.original_filename,
          processed.original_path,
          processed.web_path,
          processed.thumb_path,
          files.length === 1 ? titleBase : `${titleBase} (${count + 1})`,
          (req.body.description || "").trim() || "Homepage gallery photograph (awaiting approval).",
          req.session.user.name || req.session.user.email || "Administrator",
          sort,
          processed.file_size,
          processed.mime_type,
          processed.width,
          processed.height,
          req.session.user.id
        );
        sort += 10;
        count += 1;
      }
      logActivity(req.session.user.id, "home_photo_upload", `${count} home photo(s) pending approval`);
      setFlash(
        req,
        "success",
        `${count} photograph${count === 1 ? "" : "s"} uploaded and waiting for your approval. Nothing is live on the home page until you click Approve.`
      );
    } catch (err) {
      console.error(err);
      setFlash(req, "error", err.message || "Could not upload homepage photographs.");
    }
    res.redirect("/admin/home-photos");
  }
);

app.post("/admin/home-photos/:id/approve", requireRole(...ADMIN_ROLES), (req, res) => {
  ensureHomePhotoColumns();
  db.prepare(`
    UPDATE photos
    SET home_status = 'approved', show_on_home = 1, status = 'approved', may_display_public = 1
    WHERE id = ?
  `).run(req.params.id);
  logActivity(req.session.user.id, "home_photo_approve", `photo ${req.params.id}`);
  setFlash(req, "success", "Photograph approved and now live on the home page.");
  res.redirect("/admin/home-photos");
});

app.post("/admin/home-photos/:id/remove", requireRole(...ADMIN_ROLES), (req, res) => {
  ensureHomePhotoColumns();
  db.prepare(`
    UPDATE photos SET show_on_home = 0, home_status = NULL, home_sort = 0 WHERE id = ?
  `).run(req.params.id);
  logActivity(req.session.user.id, "home_photo_remove", `photo ${req.params.id}`);
  setFlash(req, "success", "Photograph removed from the home page queue (file stays in archive if needed).");
  res.redirect("/admin/home-photos");
});

app.post("/admin/home-photos/:id/sort", requireRole(...ADMIN_ROLES), (req, res) => {
  ensureHomePhotoColumns();
  const sort = parseInt(req.body.home_sort || "0", 10);
  db.prepare("UPDATE photos SET home_sort = ? WHERE id = ?").run(
    Number.isFinite(sort) ? sort : 0,
    req.params.id
  );
  setFlash(req, "success", "Home page order updated.");
  res.redirect("/admin/home-photos");
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

  const result = publishMemberSubmission(sub, req.session.user.id);
  if (!result.ok) {
    setFlash(req, "error", "Could not publish this submission.");
    return res.redirect("/admin/members");
  }

  logActivity(
    req.session.user.id,
    "approve_member_submission",
    `Approved family member submission #${sub.id}: ${sub.full_name}` +
      (result.createdSpouseId ? ` + spouse ${result.spouseFull}` : "")
  );
  const successMsg = result.createdSpouseId
    ? `${sub.full_name} and ${result.spouseFull} were approved and placed together on the living family tree.`
    : `${sub.full_name} was approved, added to Family Members, and placed on the living family tree.`;
  setFlash(req, "success", successMsg);
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
  const full_name = (req.body.full_name || "").trim();
  const preferred_name = (req.body.preferred_name || "").trim() || null;
  const family_branch = (req.body.family_branch || "both").trim();
  const role_in_family = (req.body.role_in_family || "").trim() || null;
  const biography = (req.body.biography || "").trim() || null;
  const sort_order = parseInt(req.body.sort_order || "50", 10);
  let parent_member_id = req.body.parent_member_id ? parseInt(req.body.parent_member_id, 10) : null;
  if (parent_member_id && Number.isNaN(parent_member_id)) parent_member_id = null;
  const spouse_full_name = (req.body.spouse_full_name || "").trim();
  const spouse_preferred_name = (req.body.spouse_preferred_name || "").trim() || null;
  const spouse_maiden_name = (req.body.spouse_maiden_name || "").trim() || null;
  const tree_lineage = parent_member_id ? lineageFromMember(db, parent_member_id) : null;
  const generation = parent_member_id
    ? generationFromParent(db, parent_member_id, "child_of")
    : null;

  const insert = db.prepare(`
    INSERT INTO family_members
      (full_name, preferred_name, family_branch, is_patriarch, is_matriarch, role_in_family, biography,
       is_placeholder, sort_order, parent_member_id, tree_lineage, generation, relation_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    full_name,
    preferred_name,
    family_branch,
    req.body.is_patriarch === "1" ? 1 : 0,
    req.body.is_matriarch === "1" ? 1 : 0,
    role_in_family,
    biography,
    req.body.is_placeholder === "0" ? 0 : 1,
    sort_order,
    parent_member_id,
    tree_lineage,
    generation,
    parent_member_id ? "child_of" : null
  );
  const mainId = insert.lastInsertRowid;

  if (spouse_full_name) {
    const sp = db.prepare(`
      INSERT INTO family_members
        (full_name, preferred_name, maiden_name, family_branch, is_patriarch, is_matriarch,
         role_in_family, is_placeholder, sort_order, parent_member_id, spouse_member_id,
         tree_lineage, generation, relation_type)
      VALUES (?, ?, ?, ?, 0, 0, ?, 0, ?, ?, ?, ?, ?, 'spouse_of')
    `).run(
      spouse_full_name,
      spouse_preferred_name || spouse_full_name,
      spouse_maiden_name,
      family_branch,
      `Spouse of ${preferred_name || full_name}`,
      sort_order + 1,
      parent_member_id,
      mainId,
      tree_lineage,
      generation
    );
    db.prepare("UPDATE family_members SET spouse_member_id = ? WHERE id = ?").run(sp.lastInsertRowid, mainId);
    setFlash(req, "success", `Family member and spouse added (${full_name} & ${spouse_full_name}).`);
  } else {
    setFlash(req, "success", "Family member added.");
  }
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
  ensureUpcomingReunionColumns();
  const reunions = db.prepare("SELECT * FROM reunions ORDER BY year DESC LIMIT 80").all();
  const data = localsBase(req);
  clearFlash(req);
  res.render("admin/reunions", { ...data, reunions });
});

app.post("/admin/reunions/:year", requireRole(...ADMIN_ROLES), (req, res) => {
  ensureUpcomingReunionColumns();
  const year = parseInt(req.params.year, 10);
  if (!db.prepare("SELECT year FROM reunions WHERE year = ?").get(year)) {
    db.prepare("INSERT INTO reunions (year, title) VALUES (?, ?)").run(
      year,
      `${year} Capoccia–Miotto Family Reunion`
    );
  }
  const isUpcoming = req.body.is_upcoming === "1" ? 1 : 0;
  if (isUpcoming) {
    db.prepare("UPDATE reunions SET is_upcoming = 0 WHERE year != ?").run(year);
  }
  db.prepare(`
    UPDATE reunions SET
      title = ?, date_text = ?, location = ?, host_family = ?, summary = ?,
      event_date = ?, event_date_end = ?, event_time = ?,
      place_name = ?, address = ?, city = ?, state = ?, room_name = ?,
      organizer_phone = ?, rsvp_deadline = ?, rsvp_notes = ?,
      main_event_label = ?, main_event_when = ?,
      pricing_json = ?, payment_info = ?, venmo_url = ?, venmo_label = ?,
      schedule_json = ?, attending_list = ?, not_attending_list = ?,
      is_upcoming = ?, no_reunion = ?, updated_at = datetime('now')
    WHERE year = ?
  `).run(
    (req.body.title || "").trim() || `${year} Capoccia–Miotto Family Reunion`,
    (req.body.date_text || "").trim() || null,
    (req.body.location || "").trim() || null,
    (req.body.host_family || "").trim() || null,
    (req.body.summary || "").trim() || null,
    (req.body.event_date || "").trim() || null,
    (req.body.event_date_end || "").trim() || null,
    (req.body.event_time || "").trim() || null,
    (req.body.place_name || "").trim() || null,
    (req.body.address || "").trim() || null,
    (req.body.city || "").trim() || null,
    (req.body.state || "").trim() || null,
    (req.body.room_name || "").trim() || null,
    (req.body.organizer_phone || "").trim() || null,
    (req.body.rsvp_deadline || "").trim() || null,
    (req.body.rsvp_notes || "").trim() || null,
    (req.body.main_event_label || "").trim() || null,
    (req.body.main_event_when || "").trim() || null,
    (req.body.pricing_json || "").trim() || null,
    (req.body.payment_info || "").trim() || null,
    (req.body.venmo_url || "").trim() || null,
    (req.body.venmo_label || "").trim() || null,
    (req.body.schedule_json || "").trim() || null,
    (req.body.attending_list || "").trim() || null,
    (req.body.not_attending_list || "").trim() || null,
    isUpcoming,
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
    if ((req.originalUrl || "").includes("community-board")) return res.redirect("/community-board");
    const dest = (req.originalUrl || "").includes("recording") ? "/contribute/recording" : "/contribute";
    return res.redirect(dest);
  }
  if (err && /audio|image files are allowed|photo and video/i.test(err.message || "")) {
    setFlash(req, "error", err.message);
    if (/photo and video|community/i.test(err.message || "") || (req.originalUrl || "").includes("community-board")) {
      return res.redirect("/community-board");
    }
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
