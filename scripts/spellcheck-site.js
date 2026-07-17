/**
 * Extract words from view templates and flag common English misspellings.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const dirs = ["views", "src"].map((d) => path.join(ROOT, d));

const knownOk = new Set([
  "capoccia",
  "miotto",
  "seifert",
  "fallucca",
  "maconochie",
  "mclaren",
  "babich",
  "cervi",
  "maddalena",
  "amerigo",
  "costanzo",
  "jaclyn",
  "pinckney",
  "macomb",
  "isidore",
  "ejs",
  "csrf",
  "uuid",
  "webp",
  "heic",
  "heif",
  "mozjpeg",
  "lightbox",
  "dropdown",
  "dropzone",
  "navbar",
  "btn",
  "href",
  "src",
  "alt",
  "aria",
  "srcset",
  "checkbox",
  "fieldset",
  "textarea",
  "optgroup",
  "readonly",
  "noopener",
  "noopener",
  "noopener",
  "noopener",
  "noopener",
]);

// Common misspellings → correct
const misspell = {
  memeber: "member",
  memebr: "member",
  memebers: "members",
  memebrs: "members",
  memroy: "memory",
  memeory: "memory",
  memery: "memory",
  memmory: "memory",
  memoreis: "memories",
  memeries: "memories",
  memmories: "memories",
  memorise: "memories", // UK is memorise for verb but for family site "memories" noun is intended
  seperate: "separate",
  seperat: "separate",
  recieve: "receive",
  recieved: "received",
  definately: "definitely",
  occassion: "occasion",
  occassional: "occasional",
  neccessary: "necessary",
  begining: "beginning",
  sucess: "success",
  sucessful: "successful",
  happend: "happened",
  untill: "until",
  priviledge: "privilege",
  mispell: "misspell",
  mispelled: "misspelled",
  realy: "really",
  freind: "friend",
  beacuse: "because",
  becuase: "because",
  thier: "their",
  wich: "which",
  wierd: "weird",
  adress: "address",
  buisness: "business",
  calender: "calendar",
  carefull: "careful",
  comming: "coming",
  completly: "completely",
  diffrent: "different",
  expecially: "especially",
  finaly: "finally",
  foriegn: "foreign",
  foward: "forward",
  gaurd: "guard",
  grammer: "grammar",
  knowlege: "knowledge",
  liason: "liaison",
  libary: "library",
  lisence: "license",
  maintainance: "maintenance",
  noticable: "noticeable",
  oppurtunity: "opportunity",
  origional: "original",
  persistant: "persistent",
  posession: "possession",
  posible: "possible",
  prefered: "preferred",
  probaly: "probably",
  reccomend: "recommend",
  recomend: "recommend",
  refered: "referred",
  religous: "religious",
  remeber: "remember",
  restaraunt: "restaurant",
  seige: "siege",
  sieze: "seize",
  similiar: "similar",
  sincerly: "sincerely",
  speach: "speech",
  suprise: "surprise",
  temperture: "temperature",
  tommorrow: "tomorrow",
  tounge: "tongue",
  truely: "truly",
  unfortunatly: "unfortunately",
  useable: "usable",
  usefull: "useful",
  vaccuum: "vacuum",
  visable: "visible",
  wether: "whether",
  writting: "writing",
  arguement: "argument",
  beleive: "believe",
  independant: "independent",
  enviroment: "environment",
  goverment: "government",
  accomodate: "accommodate",
  accomodation: "accommodation",
  occured: "occurred",
  harrass: "harass",
  embarass: "embarrass",
  disapoint: "disappoint",
  exagerrate: "exaggerate",
  excellant: "excellent",
  familar: "familiar",
  fourty: "forty",
  hieght: "height",
  interupt: "interrupt",
  occassionally: "occasionally",
  occurence: "occurrence",
  peice: "piece",
  personel: "personnel",
  publically: "publicly",
  rythm: "rhythm",
  tommorow: "tomorrow",
  vehical: "vehicle",
  yatch: "yacht",
  patriach: "patriarch",
  matriach: "matriarch",
  reuinion: "reunion",
  reuinon: "reunion",
  specail: "special",
  speical: "special",
  capocia: "capoccia",
  photgraph: "photograph",
  photgraphs: "photographs",
  photograhs: "photographs",
  biograpy: "biography",
  biographys: "biographies",
  tribut: "tribute",
  triubte: "tribute",
  archiv: "archive",
  archivve: "archive",
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ejs|js|css|md|html|txt)$/i.test(name)) out.push(p);
  }
  return out;
}

const files = dirs.flatMap((d) => walk(d));
const hits = [];

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  // Strip code-ish chunks lightly for ejs: keep string content
  const words = text.match(/[A-Za-z']+/g) || [];
  for (const w of words) {
    const lower = w.toLowerCase();
    if (knownOk.has(lower)) continue;
    if (misspell[lower]) {
      hits.push({ file: path.relative(ROOT, file), word: w, suggest: misspell[lower] });
    }
  }
}

// Also scan for "memory" letter-distance typos near "memory"
const memoryLike = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const re = /\b[Mm][eE][mM][a-zA-Z]{1,8}\b/g;
  let m;
  while ((m = re.exec(text))) {
    const w = m[0];
    const ok = /^(memory|memories|memorial|memorials|memoriam|memorable|memorialize|memorialized|memoir|memoirs|memo|memos|member|members|membership|membrane|memento|mementos)$/i.test(
      w
    );
    if (!ok) memoryLike.push({ file: path.relative(ROOT, file), word: w });
  }
}

console.log("=== Dictionary misspell hits ===");
if (!hits.length) console.log("(none)");
else {
  const uniq = new Map();
  for (const h of hits) {
    const k = `${h.file}|${h.word}`;
    if (!uniq.has(k)) uniq.set(k, h);
  }
  for (const h of uniq.values()) console.log(`${h.file}: "${h.word}" → ${h.suggest}`);
}

console.log("\n=== Unusual mem* words (review) ===");
const um = new Map();
for (const h of memoryLike) {
  const k = h.word.toLowerCase();
  um.set(k, (um.get(k) || 0) + 1);
}
for (const [w, c] of [...um.entries()].sort()) console.log(`${w} (${c})`);
