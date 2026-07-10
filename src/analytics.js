/**
 * Site analytics for admin dashboard — page views, visit sessions, time on site.
 */
const crypto = require("crypto");

function ensureAnalyticsTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS page_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      path TEXT NOT NULL,
      referrer TEXT,
      ip TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views(created_at);
    CREATE INDEX IF NOT EXISTS idx_page_views_path ON page_views(path);
    CREATE INDEX IF NOT EXISTS idx_page_views_session ON page_views(session_id);

    CREATE TABLE IF NOT EXISTS visit_sessions (
      session_id TEXT PRIMARY KEY,
      first_path TEXT,
      last_path TEXT,
      page_views INTEGER NOT NULL DEFAULT 0,
      active_seconds INTEGER NOT NULL DEFAULT 0,
      ip TEXT,
      user_agent TEXT,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_visit_sessions_last ON visit_sessions(last_seen);
    CREATE INDEX IF NOT EXISTS idx_visit_sessions_first ON visit_sessions(first_seen);
  `);
}

function normalizePath(raw) {
  let p = String(raw || "/").trim() || "/";
  if (!p.startsWith("/")) p = `/${p}`;
  // strip query/hash, cap length
  p = p.split("?")[0].split("#")[0].slice(0, 300);
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p || "/";
}

function isTrackablePath(p) {
  if (!p) return false;
  if (p.startsWith("/admin")) return false;
  if (p.startsWith("/api/")) return false;
  if (p === "/healthz") return false;
  if (p.startsWith("/uploads/")) return false;
  if (/\.(css|js|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|mp3|mp4|webm|m4a|wav)$/i.test(p)) {
    return false;
  }
  return true;
}

function sanitizeSessionId(raw) {
  const s = String(raw || "").trim().slice(0, 64);
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(s)) {
    return crypto.randomBytes(16).toString("hex");
  }
  return s;
}

function recordPageView(db, { sessionId, path, referrer, ip, userAgent }) {
  ensureAnalyticsTables(db);
  const sid = sanitizeSessionId(sessionId);
  const p = normalizePath(path);
  if (!isTrackablePath(p)) return { ok: false, reason: "skip" };

  const ua = (userAgent || "").toString().slice(0, 400) || null;
  const ref = (referrer || "").toString().slice(0, 500) || null;

  db.prepare(`
    INSERT INTO page_views (session_id, path, referrer, ip, user_agent)
    VALUES (?, ?, ?, ?, ?)
  `).run(sid, p, ref, ip || null, ua);

  const existing = db.prepare("SELECT session_id FROM visit_sessions WHERE session_id = ?").get(sid);
  if (!existing) {
    db.prepare(`
      INSERT INTO visit_sessions (session_id, first_path, last_path, page_views, active_seconds, ip, user_agent)
      VALUES (?, ?, ?, 1, 0, ?, ?)
    `).run(sid, p, p, ip || null, ua);
  } else {
    db.prepare(`
      UPDATE visit_sessions
      SET last_path = ?,
          page_views = page_views + 1,
          last_seen = datetime('now'),
          ip = COALESCE(?, ip),
          user_agent = COALESCE(?, user_agent)
      WHERE session_id = ?
    `).run(p, ip || null, ua, sid);
  }
  return { ok: true, sessionId: sid };
}

function recordHeartbeat(db, { sessionId, seconds, path, ip, userAgent }) {
  ensureAnalyticsTables(db);
  const sid = sanitizeSessionId(sessionId);
  let sec = parseInt(seconds, 10);
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  // Cap single heartbeat so bad clients cannot inflate
  if (sec > 120) sec = 120;
  if (sec === 0) return { ok: true, sessionId: sid, added: 0 };

  const ua = (userAgent || "").toString().slice(0, 400) || null;
  const p = path ? normalizePath(path) : null;
  const existing = db.prepare("SELECT session_id FROM visit_sessions WHERE session_id = ?").get(sid);
  if (!existing) {
    db.prepare(`
      INSERT INTO visit_sessions (session_id, first_path, last_path, page_views, active_seconds, ip, user_agent)
      VALUES (?, ?, ?, 0, ?, ?, ?)
    `).run(sid, p || "/", p || "/", sec, ip || null, ua);
  } else {
    db.prepare(`
      UPDATE visit_sessions
      SET active_seconds = active_seconds + ?,
          last_seen = datetime('now'),
          last_path = COALESCE(?, last_path),
          ip = COALESCE(?, ip),
          user_agent = COALESCE(?, user_agent)
      WHERE session_id = ?
    `).run(sec, p, ip || null, ua, sid);
  }
  return { ok: true, sessionId: sid, added: sec };
}

function countWhere(db, sql, params = []) {
  try {
    return db.prepare(sql).get(...params).c || 0;
  } catch (_) {
    return 0;
  }
}

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0 && sec > 0) return `${m}m ${sec}s`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

function getDashboardAnalytics(db) {
  ensureAnalyticsTables(db);

  const viewsToday = countWhere(db, `SELECT COUNT(*) AS c FROM page_views WHERE date(created_at) = date('now')`);
  const views7d = countWhere(db, `SELECT COUNT(*) AS c FROM page_views WHERE datetime(created_at) >= datetime('now', '-7 days')`);
  const views30d = countWhere(db, `SELECT COUNT(*) AS c FROM page_views WHERE datetime(created_at) >= datetime('now', '-30 days')`);
  const viewsAll = countWhere(db, `SELECT COUNT(*) AS c FROM page_views`);

  const sessionsToday = countWhere(db, `SELECT COUNT(*) AS c FROM visit_sessions WHERE date(first_seen) = date('now')`);
  const sessions7d = countWhere(db, `SELECT COUNT(*) AS c FROM visit_sessions WHERE datetime(first_seen) >= datetime('now', '-7 days')`);
  const sessionsAll = countWhere(db, `SELECT COUNT(*) AS c FROM visit_sessions`);

  const timeToday = countWhere(db, `SELECT COALESCE(SUM(active_seconds),0) AS c FROM visit_sessions WHERE date(last_seen) = date('now')`);
  const time7d = countWhere(db, `SELECT COALESCE(SUM(active_seconds),0) AS c FROM visit_sessions WHERE datetime(last_seen) >= datetime('now', '-7 days')`);
  const timeAll = countWhere(db, `SELECT COALESCE(SUM(active_seconds),0) AS c FROM visit_sessions`);

  const avgSession7dRow = db.prepare(`
    SELECT AVG(active_seconds) AS a, AVG(page_views) AS p
    FROM visit_sessions
    WHERE datetime(first_seen) >= datetime('now', '-7 days') AND page_views > 0
  `).get();
  const avgSessionSeconds7d = Math.round(avgSession7dRow && avgSession7dRow.a ? avgSession7dRow.a : 0);
  const avgPagesPerSession7d = avgSession7dRow && avgSession7dRow.p
    ? Math.round(avgSession7dRow.p * 10) / 10
    : 0;

  const pinLoginsToday = countWhere(db, `SELECT COUNT(*) AS c FROM site_activity WHERE kind = 'pin_login' AND date(created_at) = date('now')`);
  const pinLogins7d = countWhere(db, `SELECT COUNT(*) AS c FROM site_activity WHERE kind = 'pin_login' AND datetime(created_at) >= datetime('now', '-7 days')`);
  const pinLoginsAll = countWhere(db, `SELECT COUNT(*) AS c FROM site_activity WHERE kind = 'pin_login'`);
  const adminLoginsAll = countWhere(db, `SELECT COUNT(*) AS c FROM site_activity WHERE kind = 'admin_login'`);
  const pinRequestsAll = countWhere(db, `SELECT COUNT(*) AS c FROM pin_email_requests`);
  const pinRequests7d = countWhere(db, `SELECT COUNT(*) AS c FROM pin_email_requests WHERE datetime(created_at) >= datetime('now', '-7 days')`);

  const photosAll = countWhere(db, `SELECT COUNT(*) AS c FROM photos`);
  const photos7d = countWhere(db, `SELECT COUNT(*) AS c FROM photos WHERE datetime(submitted_at) >= datetime('now', '-7 days')`);
  const storiesAll = countWhere(db, `SELECT COUNT(*) AS c FROM stories`);
  const stories7d = countWhere(db, `SELECT COUNT(*) AS c FROM stories WHERE datetime(created_at) >= datetime('now', '-7 days')`);
  const boardAll = countWhere(db, `SELECT COUNT(*) AS c FROM board_posts`);
  const board7d = countWhere(db, `SELECT COUNT(*) AS c FROM board_posts WHERE datetime(created_at) >= datetime('now', '-7 days')`);
  const membersSubAll = countWhere(db, `SELECT COUNT(*) AS c FROM family_member_submissions`);
  const membersSub7d = countWhere(db, `SELECT COUNT(*) AS c FROM family_member_submissions WHERE datetime(created_at) >= datetime('now', '-7 days')`);
  const portraitsAll = countWhere(db, `SELECT COUNT(*) AS c FROM site_activity WHERE kind = 'portrait_upload'`);

  let topPages = [];
  try {
    topPages = db.prepare(`
      SELECT path, COUNT(*) AS views
      FROM page_views
      WHERE datetime(created_at) >= datetime('now', '-30 days')
      GROUP BY path
      ORDER BY views DESC
      LIMIT 12
    `).all();
  } catch (_) {
    topPages = [];
  }

  let recentSessions = [];
  try {
    recentSessions = db.prepare(`
      SELECT session_id, first_path, last_path, page_views, active_seconds, first_seen, last_seen, ip
      FROM visit_sessions
      ORDER BY datetime(last_seen) DESC
      LIMIT 25
    `).all();
  } catch (_) {
    recentSessions = [];
  }

  let recentLogins = [];
  try {
    recentLogins = db.prepare(`
      SELECT kind, actor_name, actor_email, details, created_at, ip
      FROM site_activity
      WHERE kind IN ('pin_login', 'admin_login', 'pin_login_failed')
      ORDER BY datetime(created_at) DESC
      LIMIT 30
    `).all();
  } catch (_) {
    recentLogins = [];
  }

  let recentPinRequests = [];
  try {
    recentPinRequests = db.prepare(`
      SELECT requester_name, requester_email, status, method, created_at
      FROM pin_email_requests
      ORDER BY datetime(created_at) DESC
      LIMIT 20
    `).all();
  } catch (_) {
    recentPinRequests = [];
  }

  // Unified family content timeline (column names differ by table)
  let recentContent = [];
  try {
    recentContent = db.prepare(`
      SELECT * FROM (
        SELECT 'photo' AS kind,
          COALESCE(title, original_filename, 'Photo') AS title,
          contributor_name AS who,
          contributor_email AS email,
          status,
          submitted_at AS occurred_at,
          CAST(id AS TEXT) AS ref_id
        FROM photos
        UNION ALL
        SELECT 'story' AS kind,
          COALESCE(title, 'Story') AS title,
          contributor_name AS who,
          contributor_email AS email,
          status,
          created_at AS occurred_at,
          CAST(id AS TEXT) AS ref_id
        FROM stories
        UNION ALL
        SELECT 'board' AS kind,
          COALESCE(title, 'Board post') AS title,
          author_name AS who,
          author_email AS email,
          status,
          created_at AS occurred_at,
          CAST(id AS TEXT) AS ref_id
        FROM board_posts
        UNION ALL
        SELECT 'member' AS kind,
          full_name AS title,
          contributor_name AS who,
          contributor_email AS email,
          status,
          created_at AS occurred_at,
          CAST(id AS TEXT) AS ref_id
        FROM family_member_submissions
        UNION ALL
        SELECT kind AS kind,
          COALESCE(details, kind) AS title,
          actor_name AS who,
          actor_email AS email,
          'logged' AS status,
          created_at AS occurred_at,
          CAST(id AS TEXT) AS ref_id
        FROM site_activity
        WHERE kind IN ('portrait_upload', 'photo_upload', 'board_post', 'member_submit', 'story_submit')
      )
      ORDER BY datetime(occurred_at) DESC
      LIMIT 50
    `).all();
  } catch (e) {
    console.warn("recent content query note:", e.message);
    recentContent = [];
  }

  let viewsByDay = [];
  try {
    viewsByDay = db.prepare(`
      SELECT date(created_at) AS day, COUNT(*) AS views
      FROM page_views
      WHERE datetime(created_at) >= datetime('now', '-14 days')
      GROUP BY date(created_at)
      ORDER BY day ASC
    `).all();
  } catch (_) {
    viewsByDay = [];
  }

  return {
    views: { today: viewsToday, d7: views7d, d30: views30d, all: viewsAll },
    sessions: { today: sessionsToday, d7: sessions7d, all: sessionsAll },
    time: {
      todaySeconds: timeToday,
      d7Seconds: time7d,
      allSeconds: timeAll,
      todayLabel: formatDuration(timeToday),
      d7Label: formatDuration(time7d),
      allLabel: formatDuration(timeAll),
      avgSession7dSeconds: avgSessionSeconds7d,
      avgSession7dLabel: formatDuration(avgSessionSeconds7d),
      avgPagesPerSession7d,
    },
    logins: {
      pinToday: pinLoginsToday,
      pin7d: pinLogins7d,
      pinAll: pinLoginsAll,
      adminAll: adminLoginsAll,
      pinRequestsAll,
      pinRequests7d,
    },
    content: {
      photosAll,
      photos7d,
      storiesAll,
      stories7d,
      boardAll,
      board7d,
      membersSubAll,
      membersSub7d,
      portraitsAll,
    },
    topPages,
    recentSessions,
    recentLogins,
    recentPinRequests,
    recentContent,
    viewsByDay,
    formatDuration,
  };
}

module.exports = {
  ensureAnalyticsTables,
  recordPageView,
  recordHeartbeat,
  getDashboardAnalytics,
  formatDuration,
  isTrackablePath,
  normalizePath,
};
