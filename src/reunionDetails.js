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
 * Seed / refresh 2026 details from the family organizer email (Lori).
 * Only fills empty structured fields unless force=true.
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

  // Skip overwrite if already fully seeded and not forced
  if (!force && row.details_source === "family-email-lori-2026" && row.place_name) {
    return { ok: true, skipped: true, year };
  }

  const pricing = [
    { label: "Adults", price: "$42", note: "Sunday lunch" },
    { label: "Ages 6–12", price: "$10", note: "Sunday lunch" },
    { label: "Ages 5 and under", price: "$6", note: "Sunday lunch" },
  ];

  const activities = [
    {
      day_label: "Friday",
      activity_date: "2026-07-17",
      time_text: "8:00 PM",
      title: "1st generation cousin get-together",
      location: "Lorelie Lounge, Bavarian Inn",
      price_info: null,
      notes: "Casual gathering for first-generation cousins.",
      reservation_required: 0,
      sort_order: 10,
    },
    {
      day_label: "Saturday",
      activity_date: "2026-07-18",
      time_text: "10:00 AM",
      title: "Golf",
      location: null,
      price_info: null,
      notes: "First tee time at 10:00 AM.",
      reservation_required: 0,
      sort_order: 20,
    },
    {
      day_label: "Saturday",
      activity_date: "2026-07-18",
      time_text: "10:00 AM",
      title: "Pretzel making at Bavarian Inn",
      location: "Bavarian Inn",
      price_info: "$20 per person · 1 hour",
      notes: "Need 10 people. Reservation required.",
      reservation_required: 1,
      sort_order: 30,
    },
    {
      day_label: "Saturday",
      activity_date: "2026-07-18",
      time_text: "3:30 PM",
      title: "Bavarian Belle river boat tour",
      location: "Frankenmuth",
      price_info: "$18 adult · $7 ages 12 & under · free ages 4 & under · 1 hour",
      notes: "No reservation needed.",
      reservation_required: 0,
      sort_order: 40,
    },
    {
      day_label: "Saturday",
      activity_date: "2026-07-18",
      time_text: "5:00 PM",
      title: "German beer tasting",
      location: "Bavarian Inn area",
      price_info: "$20 · ½ hour",
      notes: "Need 10 people. Reservation required.",
      reservation_required: 1,
      sort_order: 50,
    },
    {
      day_label: "Saturday",
      activity_date: "2026-07-18",
      time_text: "5:00 PM",
      title: "German wine tasting",
      location: "Bavarian Inn area",
      price_info: "$20 · ½ hour",
      notes: "Need 10 people. Reservation required.",
      reservation_required: 1,
      sort_order: 60,
    },
    {
      day_label: "Saturday",
      activity_date: "2026-07-18",
      time_text: "8:00 PM",
      title: "2nd generation cousin get-together",
      location: "Lorelie Lounge, Bavarian Inn",
      price_info: null,
      notes: "Casual gathering for second-generation cousins.",
      reservation_required: 0,
      sort_order: 70,
    },
    {
      day_label: "Weekend",
      activity_date: null,
      time_text: null,
      title: "Water park",
      location: "Bavarian Inn",
      price_info: null,
      notes: "Great for kids throughout the weekend.",
      reservation_required: 0,
      sort_order: 80,
    },
    {
      day_label: "Sunday",
      activity_date: "2026-07-19",
      time_text: "12:00 PM (noon)",
      title: "Family lunch & bocce",
      location: "Austrian Room, Bavarian Inn",
      price_info: "Adults $42 · Ages 6–12 $10 · Ages 5 & under $6",
      notes: "Final lunch count requested by July 5. Payment at lunch, by mail, or Venmo to Lori.",
      reservation_required: 0,
      sort_order: 90,
    },
  ];

  const attending =
    "Lori, Wayne, Linda, Ron, Lisa, Joe, Lauren, Grant (4 kids), Steve, Sam, Kelly, Shaun (3 kids), Debbie, Jaclyn, Joe (3 kids), Cindy, Mike, Meghan, Rick (2 kids), Carol, Trisha, Terry, Rachel, Ryan (2 kids), Jen, Ryan (3 kids), Kerri, Mia, Kelly, Adam";

  const notAttending = "Mary Ann, Jack, Michelle, Nick, Tony, Kelly";

  const summary =
    "Weekend reunion at Bavarian Inn in Frankenmuth, Michigan (July 17–19, 2026). " +
    "Sunday lunch and bocce at noon in the Austrian Room. " +
    "Optional Friday and Saturday cousin gatherings, golf, pretzel making, river boat tour, tastings, and water park. " +
    "Contact Lori by email reply or text 817-313-8087. Final lunch count requested by July 5.";

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
    "July 17–19, 2026",
    "Bavarian Inn Lodge, Frankenmuth, MI",
    "Lori",
    summary,
    "2026-07-17",
    "2026-07-19",
    "Weekend schedule — Sunday lunch at noon",
    "Bavarian Inn Lodge",
    "One Covered Bridge Lane",
    "Frankenmuth",
    "MI 48734",
    "Austrian Room",
    "817-313-8087",
    "2026-07-05",
    "Please RSVP for Sunday lunch and bocce if your name is not already on the list, or send any changes. Reply by email or text Lori.",
    "Sunday lunch & bocce",
    "Sunday, July 19, 2026 at noon",
    JSON.stringify(pricing),
    "Payment at the lunch, by mail, or Venmo to Lori.",
    "https://venmo.com/u/Lori-Irwin-13",
    "Venmo: Lori-Irwin-13",
    JSON.stringify(activities),
    attending,
    notAttending,
    "family-email-lori-2026",
    "Lori (family organizer email)",
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
  apply2026FamilyEmailDetails,
  formatDisplayDateRange,
  REUNION_DETAIL_COLUMNS,
};
