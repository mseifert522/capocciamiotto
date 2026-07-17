/**
 * Fix common spelling errors in production archive content.
 */
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const candidates = [
  process.env.DB_PATH,
  path.join(DATA_DIR, "archive.db"),
  path.join(DATA_DIR, "tribute.db"),
].filter(Boolean);
const dbPath = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).size > 0) || candidates[0];
const db = new Database(dbPath);

const replacements = [
  ["Capocia", "Capoccia"],
  ["capocia", "capoccia"],
  ["memeber", "member"],
  ["Memeber", "Member"],
  ["memebr", "member"],
  ["memebers", "members"],
  ["Memebers", "Members"],
  ["memebrs", "members"],
  ["memroy", "memory"],
  ["Memroy", "Memory"],
  ["memeory", "memory"],
  ["Memeory", "Memory"],
  ["memery", "memory"],
  ["Memery", "Memory"],
  ["memmory", "memory"],
  ["Memmory", "Memory"],
  ["memoreis", "memories"],
  ["Memoreis", "Memories"],
  ["memeries", "memories"],
  ["Memeries", "Memories"],
  ["memmories", "memories"],
  ["Memmories", "Memories"],
  ["seperate", "separate"],
  ["recieve", "receive"],
  ["patriach", "patriarch"],
  ["matriach", "matriarch"],
  ["reuinion", "reunion"],
  ["specail", "special"],
  ["speical", "special"],
  ["photgraph", "photograph"],
  ["photographs", "photographs"], // no-op safeguard
  ["definately", "definitely"],
  ["occured", "occurred"],
  ["neccessary", "necessary"],
  ["begining", "beginning"],
  ["sucess", "success"],
  ["prefered", "preferred"],
  ["publically", "publicly"],
  ["beleive", "believe"],
  ["seperat", "separat"],
  ["independant", "independent"],
  ["enviroment", "environment"],
  ["goverment", "government"],
  ["accomodat", "accommodat"],
  ["happend", "happened"],
  ["untill", "until"],
  ["priviledge", "privilege"],
  ["mispell", "misspell"],
  ["thier ", "their "],
  ["wich ", "which "],
  ["wierd", "weird"],
  ["adress", "address"],
  ["buisness", "business"],
  ["calender", "calendar"],
  ["comming", "coming"],
  ["completly", "completely"],
  ["diffrent", "different"],
  ["expecially", "especially"],
  ["finaly", "finally"],
  ["foriegn", "foreign"],
  ["foward", "forward"],
  ["gaurd", "guard"],
  ["grammer", "grammar"],
  ["knowlege", "knowledge"],
  ["liason", "liaison"],
  ["libary", "library"],
  ["maintainance", "maintenance"],
  ["noticable", "noticeable"],
  ["oppurtunity", "opportunity"],
  ["origional", "original"],
  ["persistant", "persistent"],
  ["posession", "possession"],
  ["posible", "possible"],
  ["probaly", "probably"],
  ["reccomend", "recommend"],
  ["religous", "religious"],
  ["remeber", "remember"],
  ["restaraunt", "restaurant"],
  ["similiar", "similar"],
  ["sincerly", "sincerely"],
  ["speach", "speech"],
  ["suprise", "surprise"],
  ["temperture", "temperature"],
  ["tommorrow", "tomorrow"],
  ["tounge", "tongue"],
  ["truely", "truly"],
  ["unfortunatly", "unfortunately"],
  ["useable", "usable"],
  ["usefull", "useful"],
  ["visable", "visible"],
  ["writting", "writing"],
  ["arguement", "argument"],
];

const targets = [
  ["family_members", ["full_name", "preferred_name", "role_in_family", "biography", "favorite_memories", "quotes", "maiden_name"]],
  ["photos", ["title", "description", "location", "admin_notes", "contributor_name"]],
  ["board_posts", ["title", "body", "author_name"]],
  ["stories", ["title", "body", "contributor_name"]],
  ["site_settings", ["value"]],
  ["reunions", ["title", "summary", "location_name", "location_address", "notes"]],
  ["family_member_submissions", ["full_name", "preferred_name", "role_in_family", "relation_to_family", "short_bio"]],
  ["memorials", ["full_name", "relationship", "biography", "favorite_memories", "dates_text"]],
  ["voice_recordings", ["title", "description", "speaker_name"]],
];

let changes = 0;
console.log("DB", dbPath);

for (const [table, cols] of targets) {
  try {
    const rows = db.prepare(`SELECT rowid AS rid, * FROM ${table}`).all();
    for (const row of rows) {
      for (const col of cols) {
        if (!(col in row) || row[col] == null) continue;
        let val = String(row[col]);
        let next = val;
        for (const [bad, good] of replacements) {
          if (next.includes(bad)) next = next.split(bad).join(good);
        }
        if (next !== val) {
          db.prepare(`UPDATE ${table} SET ${col} = ? WHERE rowid = ?`).run(next, row.rid);
          changes += 1;
          console.log(`fixed ${table}.${col} rid=${row.rid}`);
          console.log(`  was: ${val.slice(0, 120)}`);
          console.log(`  now: ${next.slice(0, 120)}`);
        }
      }
    }
  } catch (e) {
    console.log("skip", table, e.message);
  }
}

// Rename legacy settings key Capocia → Capoccia
try {
  const old = db.prepare("SELECT value FROM site_settings WHERE key = 'matriarch_name_capocia'").get();
  if (old) {
    db.prepare(
      "INSERT OR REPLACE INTO site_settings (key, value) VALUES ('matriarch_name_capoccia', ?)"
    ).run(String(old.value).replace(/Capocia/g, "Capoccia"));
    db.prepare("DELETE FROM site_settings WHERE key = 'matriarch_name_capocia'").run();
    console.log("migrated matriarch_name_capocia key");
    changes += 1;
  }
} catch (e) {
  console.log("key migrate note", e.message);
}

console.log("changes", changes);
db.close();
