const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const candidates = [
  process.env.DB_PATH,
  path.join(DATA_DIR, "archive.db"),
  path.join(DATA_DIR, "tribute.db"),
].filter(Boolean);
const dbPath = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).size > 0) || candidates[0];
const db = new Database(dbPath, { readonly: true });

const patterns = [
  /memeber/i,
  /memebr/i,
  /memebers/i,
  /memroy/i,
  /memeory/i,
  /memery/i,
  /memmory/i,
  /memoreis/i,
  /memeries/i,
  /memmories/i,
  /capocia/i,
  /seperate/i,
  /recieve/i,
  /patriach/i,
  /matriach/i,
  /reuinion/i,
  /specail/i,
  /speical/i,
  /photgraph/i,
  /tribut[^eia]/i,
  /definately/i,
  /occassion/i,
  /neccessary/i,
  /begining/i,
  /sucess/i,
  /happend/i,
  /untill/i,
  /priviledge/i,
  /mispell/i,
  /beleive/i,
  /seperat/i,
  /independant/i,
  /enviroment/i,
  /goverment/i,
  /accomodat/i,
  /occured/i,
  /prefered/i,
  /publically/i,
  /reccomend/i,
  /refered/i,
  /suprise/i,
  /tommorrow/i,
  /truely/i,
  /useable/i,
  /usefull/i,
  /visable/i,
  /wether\b/i,
  /writting/i,
  /arguement/i,
  /beacuse/i,
  /becuase/i,
  /freind/i,
  /thier\b/i,
  /wich\b/i,
  /wierd/i,
  /adress/i,
  /buisness/i,
  /calender/i,
  /comming/i,
  /completly/i,
  /diffrent/i,
  /expecially/i,
  /finaly/i,
  /foriegn/i,
  /foward/i,
  /gaurd/i,
  /grammer/i,
  /knowlege/i,
  /liason/i,
  /libary/i,
  /maintainance/i,
  /noticable/i,
  /oppurtunity/i,
  /origional/i,
  /persistant/i,
  /posession/i,
  /posible/i,
  /probaly/i,
  /religous/i,
  /remeber/i,
  /restaraunt/i,
  /similiar/i,
  /sincerly/i,
  /speach/i,
  /temperture/i,
  /tounge/i,
  /unfortunatly/i,
  /vehical/i,
];

function scanValue(table, id, col, val) {
  if (val == null) return;
  const s = String(val);
  for (const re of patterns) {
    if (re.test(s)) {
      console.log(`HIT ${table}.${col} id=${id}: ${s.slice(0, 200)}`);
      break;
    }
  }
}

const jobs = [
  ["family_members", "id", ["full_name", "preferred_name", "role_in_family", "biography", "favorite_memories", "quotes", "maiden_name"]],
  ["photos", "id", ["title", "description", "location", "admin_notes", "contributor_name"]],
  ["board_posts", "id", ["title", "body", "author_name"]],
  ["stories", "id", ["title", "body", "contributor_name"]],
  ["site_settings", "key", ["key", "value"]],
  ["reunions", "year", ["title", "summary", "location_name", "location_address", "notes"]],
  ["family_member_submissions", "id", ["full_name", "preferred_name", "role_in_family", "relation_to_family", "short_bio"]],
  ["memorials", "id", ["full_name", "relationship", "biography", "favorite_memories", "dates_text"]],
];

console.log("DB", dbPath);
for (const [table, idCol, cols] of jobs) {
  try {
    const rows = db.prepare(`SELECT * FROM ${table}`).all();
    for (const r of rows) {
      for (const c of cols) {
        if (c in r) scanValue(table, r[idCol], c, r[c]);
      }
    }
  } catch (e) {
    console.log("skip", table, e.message);
  }
}
db.close();
console.log("DONE");
