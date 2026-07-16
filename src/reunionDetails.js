/**
 * Structured reunion detail fields for multi-day family reunions
 * (dates, venue, pricing, RSVP, schedule/activities, attendance notes).
 */

const REUNION_DETAIL_COLUMNS = [
  ["event_date_end", "TEXT"],
  ["city", "TEXT"],
  ["state", "TEXT"],
  ["room_name", "TEXT"],
  ["organizer_phone", "TEXT"],
  ["organizer_email", "TEXT"],
  ["rsvp_deadline", "TEXT"],
  ["rsvp_notes", "TEXT"],
  ["main_event_label", "TEXT"],
  ["main_event_when", "TEXT"],
  ["pricing_json", "TEXT"],
  ["payment_info", "TEXT"],
  ["venmo_url", "TEXT"],
  ["venmo_label", "TEXT"],
  ["schedule_json", "TEXT"],
  ["attending_list", "TEXT"],
  ["not_attending_list", "TEXT"],
  ["details_source", "TEXT"],
];

function ensureReunionDetailSchema(db) {
  const cols = db.prepare("PRAGMA table_info(reunions)").all().map((c) => c.name);
  const add = (name, def) => {
    if (!cols.includes(name)) {
      db.exec(`ALTER TABLE reunions ADD COLUMN ${name} ${def}`);
      cols.push(name);
    }
  };
  // Base upcoming fields
  add("event_date", "TEXT");
  add("event_time", "TEXT");
  add("place_name", "TEXT");
  add("address", "TEXT");
  add("is_upcoming", "INTEGER NOT NULL DEFAULT 0");
  add("details_updated_by", "TEXT");
  REUNION_DETAIL_COLUMNS.forEach(([name, def]) => add(name, def));

  db.exec(`
    CREATE TABLE IF NOT EXISTS reunion_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reunion_year INTEGER NOT NULL,
      activity_date TEXT,
      day_label TEXT,
      time_text TEXT,
      title TEXT NOT NULL,
      location TEXT,
      price_info TEXT,
      notes TEXT,
      reservation_required INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (reunion_year) REFERENCES reunions(year)
    );
    CREATE INDEX IF NOT EXISTS idx_reunion_activities_year ON reunion_activities(reunion_year);
  `);
}

function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch (_) {
    return fallback;
  }
}

function formatDisplayDateRange(startIso, endIso, dateText) {
  if (dateText) return dateText;
  if (!startIso && !endIso) return null;
  const fmt = (iso) => {
    try {
      const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch (_) {
      return iso;
    }
  };
  if (startIso && endIso && startIso !== endIso) {
    try {
      const a = new Date(`${startIso}T12:00:00`);
      const b = new Date(`${endIso}T12:00:00`);
      if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) {
        const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
        if (sameMonth) {
          return `${a.toLocaleDateString("en-US", { month: "long", day: "numeric" })}–${b.getDate()}, ${b.getFullYear()}`;
        }
      }
    } catch (_) { /* fall through */ }
    return `${fmt(startIso)} – ${fmt(endIso)}`;
  }
  return fmt(startIso || endIso);
}

function enrichReunion(db, row) {
  if (!row) return null;
  const r = { ...row };
  r.pricing = safeJsonParse(r.pricing_json, []);
  r.schedule = safeJsonParse(r.schedule_json, []);
  try {
    r.activities = db.prepare(`
      SELECT * FROM reunion_activities
      WHERE reunion_year = ?
      ORDER BY sort_order ASC, id ASC
    `).all(r.year);
  } catch (_) {
    r.activities = [];
  }
  if ((!r.activities || !r.activities.length) && r.schedule.length) {
    r.activities = r.schedule.map((s, i) => ({
      id: i,
      reunion_year: r.year,
      day_label: s.day || s.day_label || null,
      activity_date: s.date || s.activity_date || null,
      time_text: s.time || s.time_text || null,
      title: s.title || s.name || "Activity",
      location: s.location || null,
      price_info: s.price || s.price_info || null,
      notes: s.notes || null,
      reservation_required: s.reservation_required ? 1 : 0,
      sort_order: i,
    }));
  }
  r.display_date =
    formatDisplayDateRange(r.event_date, r.event_date_end, r.date_text) || null;
  r.full_address = [r.address, r.city && r.state ? `${r.city}, ${r.state}` : (r.city || r.state)]
    .filter(Boolean)
    .join(", ");
  if (!r.full_address && r.location) r.full_address = r.location;
  r.map_query = r.full_address || r.place_name || r.location || "";
  return r;
}

function reunionHasPublicDetails(row) {
  if (!row) return false;
  return !!(
    row.event_date ||
    row.event_date_end ||
    row.event_time ||
    row.place_name ||
    row.address ||
    row.date_text ||
    row.location ||
    row.room_name ||
    row.main_event_when ||
    row.schedule_json ||
    row.pricing_json ||
    row.summary
  );
}

/**
 * Seed / refresh 2025 archive details from the family save-the-date email.
 * Does not invent a street address — only Pinckney, MI as stated.
 * Preserves cover_photo_path if already set.
 */
function apply2025FamilyEmailDetails(db, { force = false } = {}) {
  ensureReunionDetailSchema(db);
  const year = 2025;
  let row = db.prepare("SELECT * FROM reunions WHERE year = ?").get(year);
  if (!row) {
    db.prepare(`
      INSERT INTO reunions (year, title, is_upcoming, status)
      VALUES (?, ?, 0, 'open')
    `).run(year, "2025 Capoccia–Miotto Family Reunion");
    row = db.prepare("SELECT * FROM reunions WHERE year = ?").get(year);
  }

  if (!force && row.details_source === "family-email-2025-save-the-date" && row.place_name) {
    return { ok: true, skipped: true, year };
  }

  const summary =
    "Save the date for the annual Capoccia–Miotto family reunion on Sunday, June 29, 2025. " +
    "Held at Jaclyn & Joe’s place in Pinckney, Michigan. Further details were to follow from the family invitation.";

  const mainWhen = "Sunday, June 29, 2025";
  const activities = [
    {
      day_label: "Sunday",
      activity_date: "2025-06-29",
      time_text: null,
      title: "Annual family reunion",
      location: "Jaclyn & Joe’s place, Pinckney, MI",
      price_info: null,
      notes: "Save-the-date announcement. Additional details were expected to follow.",
      reservation_required: 0,
      sort_order: 10,
    },
  ];

  db.prepare(`
    UPDATE reunions SET
      title = ?,
      date_text = ?,
      location = ?,
      host_family = ?,
      summary = ?,
      event_date = ?,
      event_date_end = ?,
      event_time = ?,
      place_name = ?,
      address = COALESCE(address, NULL),
      city = ?,
      state = ?,
      room_name = NULL,
      main_event_label = ?,
      main_event_when = ?,
      rsvp_notes = ?,
      schedule_json = ?,
      details_source = ?,
      details_updated_by = ?,
      no_reunion = 0,
      is_upcoming = 0,
      updated_at = datetime('now')
    WHERE year = ?
  `).run(
    "2025 Capoccia–Miotto Family Reunion",
    "Sunday, June 29, 2025",
    "Jaclyn & Joe’s place, Pinckney, MI",
    "Jaclyn & Joe",
    summary,
    "2025-06-29",
    "2025-06-29",
    "All day · details announced by hosts",
    "Jaclyn & Joe’s place",
    "Pinckney",
    "MI",
    "Annual family reunion",
    mainWhen,
    "Invitation asked that the notice be forwarded to anyone missing from the email list. Further details were to come soon.",
    JSON.stringify(activities),
    "family-email-2025-save-the-date",
    "Family save-the-date email",
    year
  );

  db.prepare("DELETE FROM reunion_activities WHERE reunion_year = ?").run(year);
  const insertAct = db.prepare(`
    INSERT INTO reunion_activities (
      reunion_year, activity_date, day_label, time_text, title, location,
      price_info, notes, reservation_required, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  activities.forEach((a) => {
    insertAct.run(
      year,
      a.activity_date,
      a.day_label,
      a.time_text,
      a.title,
      a.location,
      a.price_info,
      a.notes,
      a.reservation_required ? 1 : 0,
      a.sort_order
    );
  });

  return { ok: true, year, activities: activities.length };
}

/**
 * Seed / refresh 2026 details from the family submission (Gretchen Miotto).
 * Core public facts match the organizer form; optional weekend activities retained.
 */
function apply2026FamilyEmailDetails(db, { force = false } = {}) {
  ensureReunionDetailSchema(db);
  const year = 2026;
  let row = db.prepare("SELECT * FROM reunions WHERE year = ?").get(year);
  if (!row) {
    db.prepare(`
      INSERT INTO reunions (year, title, is_upcoming, status)
      VALUES (?, ?, 1, 'open')
    `).run(year, "2026 Capoccia–Miotto Family Reunion");
    row = db.prepare("SELECT * FROM reunions WHERE year = ?").get(year);
  }

  // Skip overwrite if this Gretchen submission is already applied (unless force)
  if (!force && row.details_source === "family-submit-gretchen-2026-07" && row.place_name) {
    return { ok: true, skipped: true, year };
  }

  // Pricing not provided in this submission — leave empty until organizer supplies it
  const pricing = [];

  const activities = [
    {
      day_label: "Friday",
      activity_date: "2026-07-17",
      time_text: null,
      title: "Reunion weekend begins",
      location: "Bavarian Inn Lodge",
      price_info: null,
      notes: "Friday, July 17, 2026 — start of the Capoccia–Miotto family reunion weekend.",
      reservation_required: 0,
      sort_order: 10,
    },
    {
      day_label: "Sunday",
      activity_date: "2026-07-19",
      time_text: "12:00 PM (noon)",
      title: "Family gathering",
      location: "Bavarian Inn Lodge",
      price_info: null,
      notes: "Sunday, July 19, 2026 at noon. Contact organizer Gretchen Miotto for details.",
      reservation_required: 0,
      sort_order: 90,
    },
  ];

  const attending = "Gretchen, John, Mark, Jamie (and Sloan) are attending.";

  const summary =
    "The 2026 Capoccia–Miotto Family Reunion is at Bavarian Inn Lodge in Frankenmuth, Michigan. " +
    "Weekend begins Friday, July 17, 2026. Main gathering Sunday, July 19, 2026 at noon. " +
    "Organizer: Gretchen Miotto (ghmiotto@yahoo.com). " +
    "Gretchen, John, Mark, Jamie (and Sloan) are attending.";

  db.prepare(`
    UPDATE reunions SET
      title = ?,
      date_text = ?,
      location = ?,
      host_family = ?,
      summary = ?,
      event_date = ?,
      event_date_end = ?,
      event_time = ?,
      place_name = ?,
      address = ?,
      city = ?,
      state = ?,
      room_name = ?,
      organizer_phone = ?,
      organizer_email = ?,
      rsvp_deadline = ?,
      rsvp_notes = ?,
      main_event_label = ?,
      main_event_when = ?,
      pricing_json = ?,
      payment_info = ?,
      venmo_url = ?,
      venmo_label = ?,
      schedule_json = ?,
      attending_list = ?,
      not_attending_list = ?,
      details_source = ?,
      details_updated_by = ?,
      is_upcoming = 1,
      no_reunion = 0,
      updated_at = datetime('now')
    WHERE year = ?
  `).run(
    "2026 Capoccia–Miotto Family Reunion",
    "Friday, July 17 – Sunday, July 19, 2026",
    "Bavarian Inn Lodge, Frankenmuth, MI",
    "Gretchen Miotto",
    summary,
    "2026-07-17",
    "2026-07-19",
    "Sunday, July 19, 2026 at noon",
    "Bavarian Inn Lodge",
    "One Covered Bridge Lane, Frankenmuth, MI 48734",
    "Frankenmuth",
    "MI",
    null,
    null,
    "ghmiotto@yahoo.com",
    null,
    "Questions or RSVP updates: email Gretchen Miotto at ghmiotto@yahoo.com.",
    "Main gathering",
    "Sunday, July 19, 2026 at noon",
    pricing.length ? JSON.stringify(pricing) : null,
    null,
    null,
    null,
    JSON.stringify(activities),
    attending,
    null,
    "family-submit-gretchen-2026-07",
    "Gretchen Miotto (family submission)",
    year
  );

  db.prepare("UPDATE reunions SET is_upcoming = 0 WHERE year != ?").run(year);
  db.prepare("DELETE FROM reunion_activities WHERE reunion_year = ?").run(year);

  const insertAct = db.prepare(`
    INSERT INTO reunion_activities (
      reunion_year, activity_date, day_label, time_text, title, location,
      price_info, notes, reservation_required, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  activities.forEach((a) => {
    insertAct.run(
      year,
      a.activity_date,
      a.day_label,
      a.time_text,
      a.title,
      a.location,
      a.price_info,
      a.notes,
      a.reservation_required ? 1 : 0,
      a.sort_order
    );
  });

  return { ok: true, year, activities: activities.length };
}

module.exports = {
  ensureReunionDetailSchema,
  enrichReunion,
  reunionHasPublicDetails,
  apply2025FamilyEmailDetails,
  apply2026FamilyEmailDetails,
  formatDisplayDateRange,
  REUNION_DETAIL_COLUMNS,
};
