/**
 * Living Capoccia–Miotto family tree builder.
 * Root: Costanzo & Madeline → Anna, Tony, George lines (oldest first) → descendants as they join.
 */

function displayName(m) {
  return (m && (m.preferred_name || m.full_name)) || "";
}

function nameBlob(m) {
  return `${m.full_name || ""} ${m.preferred_name || ""} ${m.nickname || ""}`.toLowerCase();
}

function classifyLeader(m) {
  const n = nameBlob(m);
  const full = (m.full_name || "").toLowerCase();
  const role = (m.role_in_family || "").toLowerCase();
  // Foundational Capoccia parents
  if (/costanzo/.test(n) && /capoccia/.test(n)) return "costanzo";
  if ((/maddalena|madeline/.test(n)) && /capoccia/.test(n)) return "maddalena";
  // Younger namesakes are not the patriarchs
  if (/son of david/i.test(role) || /daughter of david/i.test(role)) return null;
  if (/^michael capoccia$/i.test((m.full_name || "").trim())) return null;
  if (/^anthony capoccia$/i.test((m.full_name || "").trim()) && !/tony|joseph/i.test(m.full_name || "")) {
    return null;
  }
  if (/george/.test(n) && /capoccia/.test(n) && !/son of/i.test(role)) return "george";
  if (/christine/.test(n) && /capoccia/.test(n) && !/son of|daughter of/i.test(role)) return "christine";
  if (
    (/tony/.test(full) || /anthony/.test(full)) &&
    /capoccia/.test(full) &&
    (/tony|joseph|patriarch/i.test(`${m.full_name || ""} ${m.preferred_name || ""} ${role}`) || m.is_memorial)
  ) {
    return "tony";
  }
  if ((/^frances/.test(full) || /^fran\b/.test(full) || /\bfran\b/.test(full)) && /capoccia/.test(full) && !/tony|anthony/.test(full)) {
    return "fran";
  }
  if ((/mickey/.test(n) || /amerigo/.test(n)) && /miotto/.test(n)) return "mickey";
  if (/anna/.test(n) && /miotto/.test(n)) return "anna";
  return null;
}

/* Branch order by age of the sibling lines: Anna (oldest), then Tony, then George */
const LINEAGE_META = {
  anna: {
    key: "anna",
    title: "Anna & Mickey Miotto",
    role: "Miotto Matriarch & Patriarch",
    coupleKeys: ["anna", "mickey"],
  },
  tony: {
    key: "tony",
    title: "Tony & Fran Capoccia",
    role: "Capoccia Patriarch & Matriarch",
    coupleKeys: ["tony", "fran"],
  },
  george: {
    key: "george",
    title: "George & Christine Capoccia",
    role: "Capoccia Patriarch & Matriarch",
    coupleKeys: ["george", "christine"],
  },
};
const LINEAGE_ORDER = ["anna", "tony", "george"];

function ensureTreeColumns(db) {
  const memberCols = [
    ["parent_member_id", "INTEGER"],
    ["parent2_member_id", "INTEGER"],
    ["spouse_member_id", "INTEGER"],
    ["tree_lineage", "TEXT"],
    ["generation", "INTEGER DEFAULT 0"],
    ["relation_type", "TEXT"],
  ];
  const subCols = [
    ["parent_member_id", "INTEGER"],
    ["parent2_member_id", "INTEGER"],
    ["spouse_member_id", "INTEGER"],
    ["tree_lineage", "TEXT"],
    ["relation_type", "TEXT"],
    ["spouse_full_name", "TEXT"],
    ["spouse_preferred_name", "TEXT"],
    ["spouse_maiden_name", "TEXT"],
  ];
  for (const [col, type] of memberCols) {
    try {
      db.prepare(`ALTER TABLE family_members ADD COLUMN ${col} ${type}`).run();
    } catch (_) { /* already exists */ }
  }
  for (const [col, type] of subCols) {
    try {
      db.prepare(`ALTER TABLE family_member_submissions ADD COLUMN ${col} ${type}`).run();
    } catch (_) { /* already exists */ }
  }
}

function seedLeaderTreeMeta(db) {
  const members = db.prepare("SELECT * FROM family_members").all();
  const byKey = {};
  for (const m of members) {
    const key = classifyLeader(m);
    if (key) byKey[key] = m;
  }

  const updates = [
    { key: "tony", lineage: "tony", generation: 1, spouse: byKey.fran },
    { key: "fran", lineage: "tony", generation: 1, spouse: byKey.tony },
    { key: "george", lineage: "george", generation: 1, spouse: byKey.christine },
    { key: "christine", lineage: "george", generation: 1, spouse: byKey.george },
    { key: "anna", lineage: "anna", generation: 1, spouse: byKey.mickey },
    { key: "mickey", lineage: "anna", generation: 1, spouse: byKey.anna },
  ];

  const upd = db.prepare(`
    UPDATE family_members
    SET tree_lineage = COALESCE(NULLIF(tree_lineage, ''), ?),
        generation = CASE WHEN generation IS NULL OR generation = 0 THEN ? ELSE generation END,
        spouse_member_id = COALESCE(spouse_member_id, ?),
        updated_at = datetime('now')
    WHERE id = ?
  `);

  for (const u of updates) {
    const m = byKey[u.key];
    if (!m) continue;
    upd.run(u.lineage, u.generation, u.spouse ? u.spouse.id : null, m.id);
  }
}

function lineageFromMember(db, memberId, depth) {
  if (!memberId) return null;
  if (depth > 25) return null;
  const d = depth || 0;
  const m = db.prepare("SELECT * FROM family_members WHERE id = ?").get(memberId);
  if (!m) return null;
  if (m.tree_lineage && ["anna", "tony", "george", "roots"].includes(m.tree_lineage)) {
    return m.tree_lineage;
  }
  const leader = classifyLeader(m);
  if (leader === "costanzo" || leader === "maddalena") return "roots";
  if (leader === "tony" || leader === "fran") return "tony";
  if (leader === "george" || leader === "christine") return "george";
  if (leader === "anna" || leader === "mickey") return "anna";
  if (m.parent_member_id) return lineageFromMember(db, m.parent_member_id, d + 1);
  if (m.spouse_member_id) {
    const spouse = db.prepare("SELECT * FROM family_members WHERE id = ?").get(m.spouse_member_id);
    if (spouse && spouse.parent_member_id) {
      return lineageFromMember(db, spouse.parent_member_id, d + 1);
    }
    const sLead = spouse ? classifyLeader(spouse) : null;
    if (sLead === "tony" || sLead === "fran") return "tony";
    if (sLead === "george" || sLead === "christine") return "george";
    if (sLead === "anna" || sLead === "mickey") return "anna";
  }
  // Infer from role text when parent link is missing
  const role = `${m.role_in_family || ""} ${m.full_name || ""}`.toLowerCase();
  if (/anna|mickey|miotto/.test(role) && !/capoccia patriarch|capoccia matriarch/.test(role)) {
    if (/miotto|anna|mickey|patricia|carol|john|maryann|mclaren|maconochie|sellers/.test(role)) return "anna";
  }
  if (/tony|fran|lori|irwin|lauren|grant/.test(role)) return "tony";
  if (/george|christine|debbie|jeanette|david|falluc|seifert|fallon|donovan/.test(role)) return "george";
  return null;
}

/**
 * Recompute sort_order for every family member so the site always lists:
 * Costanzo & Maddalena → Anna's family → Tony's family → George's family.
 * Spouses stay immediately next to their partner. Called after new members join.
 */
function recomputeFamilyMemberSortOrders(db) {
  try {
    seedLeaderTreeMeta(db);
  } catch (_) { /* ignore */ }

  const members = db.prepare("SELECT * FROM family_members").all();
  if (!members.length) return { ok: true, count: 0 };

  const byId = new Map(members.map((m) => [m.id, m]));

  // Tag each member with lineage + leader rank
  for (const m of members) {
    const leader = classifyLeader(m);
    let lineage = null;
    if (leader === "costanzo" || leader === "maddalena") lineage = "roots";
    else if (leader === "anna" || leader === "mickey") lineage = "anna";
    else if (leader === "tony" || leader === "fran") lineage = "tony";
    else if (leader === "george" || leader === "christine") lineage = "george";
    else lineage = lineageFromMember(db, m.id) || "other";

    m._lineage = lineage || "other";
    m._leaderKey = leader;
    // Persist lineage for future parent-chain lookups
    if (lineage && lineage !== "other" && m.tree_lineage !== lineage) {
      try {
        db.prepare(
          `UPDATE family_members SET tree_lineage = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(lineage === "roots" ? "roots" : lineage, m.id);
        m.tree_lineage = lineage;
      } catch (_) { /* ignore */ }
    }
  }

  const lineageRank = { roots: 0, anna: 1, tony: 2, george: 3, other: 9 };
  const leaderRank = {
    costanzo: 0,
    maddalena: 1,
    anna: 2,
    mickey: 3,
    tony: 4,
    fran: 5,
    george: 6,
    christine: 7,
  };

  // Primary people first within a generation; spouses follow their partner
  function isSpouseRole(m) {
    return m.relation_type === "spouse_of" || /^spouse of\b/i.test(m.role_in_family || "");
  }

  members.sort((a, b) => {
    const la = lineageRank[a._lineage] != null ? lineageRank[a._lineage] : 9;
    const lb = lineageRank[b._lineage] != null ? lineageRank[b._lineage] : 9;
    if (la !== lb) return la - lb;

    // Leaders of the line first
    const lra = a._leaderKey && leaderRank[a._leaderKey] != null ? leaderRank[a._leaderKey] : 50;
    const lrb = b._leaderKey && leaderRank[b._leaderKey] != null ? leaderRank[b._leaderKey] : 50;
    if (lra !== lrb && (lra < 50 || lrb < 50)) return lra - lrb;

    const ga = a.generation != null ? a.generation : isSpouseRole(a) ? 50 : 40;
    const gb = b.generation != null ? b.generation : isSpouseRole(b) ? 50 : 40;
    if (ga !== gb) return ga - gb;

    // Keep nuclear families together by parent
    const pa = a.parent_member_id || (isSpouseRole(a) ? a.spouse_member_id : 0) || 0;
    const pb = b.parent_member_id || (isSpouseRole(b) ? b.spouse_member_id : 0) || 0;
    if (pa !== pb) return pa - pb;

    // Primary before spouse
    const sa = isSpouseRole(a) ? 1 : 0;
    const sb = isSpouseRole(b) ? 1 : 0;
    if (sa !== sb) return sa - sb;

    // If one is the other's spouse, primary (non-spouse) first
    if (a.spouse_member_id === b.id) return isSpouseRole(a) ? 1 : -1;
    if (b.spouse_member_id === a.id) return isSpouseRole(b) ? -1 : 1;

    return String(a.full_name || "").localeCompare(String(b.full_name || ""));
  });

  // Walk sorted list and emit person then their spouse so couples stay adjacent
  const ordered = [];
  const used = new Set();
  function emit(m) {
    if (!m || used.has(m.id)) return;
    used.add(m.id);
    ordered.push(m);
    if (m.spouse_member_id && byId.has(m.spouse_member_id)) {
      const spouse = byId.get(m.spouse_member_id);
      if (spouse && !used.has(spouse.id) && spouse._lineage === m._lineage) {
        used.add(spouse.id);
        ordered.push(spouse);
      }
    }
  }
  for (const m of members) emit(m);
  // Any leftovers
  for (const m of members) emit(m);

  const upd = db.prepare(
    `UPDATE family_members SET sort_order = ?, updated_at = datetime('now') WHERE id = ?`
  );
  const tx = db.transaction((list) => {
    list.forEach((m, i) => {
      upd.run((i + 1) * 10, m.id);
    });
  });
  tx(ordered);

  return { ok: true, count: ordered.length };
}

function generationFromParent(db, parentId, relationType) {
  if (!parentId) return 2;
  const parent = db.prepare("SELECT generation FROM family_members WHERE id = ?").get(parentId);
  const pGen = parent && parent.generation != null ? parent.generation : 1;
  if (relationType === "spouse_of") return pGen;
  if (relationType === "grandchild_of") return pGen + 2;
  if (relationType === "great_grandchild_of") return pGen + 3;
  // child_of, nephew_niece_of, cousin_of default one generation down from parent link
  return pGen + 1;
}

function listTreeAnchors(db) {
  return db.prepare(`
    SELECT id, full_name, preferred_name, role_in_family, family_branch,
           is_patriarch, is_matriarch, tree_lineage, generation, sort_order
    FROM family_members
    WHERE (visibility = 'public' OR visibility IS NULL)
    ORDER BY
      CASE WHEN is_patriarch = 1 OR is_matriarch = 1 THEN 0 ELSE 1 END,
      COALESCE(generation, 99) ASC,
      sort_order ASC,
      full_name ASC
  `).all();
}

function nodeFromMember(m) {
  return {
    id: m.id,
    name: displayName(m),
    full_name: m.full_name,
    role: m.role_in_family || "",
    branch: m.family_branch || "",
    lineage: m.tree_lineage || null,
    generation: m.generation != null ? m.generation : null,
    is_memorial: !!m.is_memorial,
    is_patriarch: !!m.is_patriarch,
    is_matriarch: !!m.is_matriarch,
    portrait_path: m.portrait_path || null,
    parent_member_id: m.parent_member_id || null,
    parent2_member_id: m.parent2_member_id || null,
    spouse_member_id: m.spouse_member_id || null,
    children: [],
  };
}

function buildLivingTree(db) {
  const members = db.prepare(`
    SELECT * FROM family_members
    WHERE visibility = 'public' OR visibility IS NULL
    ORDER BY COALESCE(generation, 99) ASC, sort_order ASC, full_name ASC
  `).all();

  const byId = new Map();
  const leaders = {};
  for (const m of members) {
    byId.set(m.id, nodeFromMember(m));
    const key = classifyLeader(m);
    if (key) leaders[key] = byId.get(m.id);
  }

  // Attach spouses into couple display pairs for gen-1 leaders
  const usedAsChild = new Set();
  const leaderIds = new Set(Object.values(leaders).map((n) => n.id));

  // Build parent→children from parent_member_id
  for (const m of members) {
    if (leaderIds.has(m.id)) continue; // leaders sit under virtual root, not as children of each other
    const node = byId.get(m.id);
    if (!node) continue;
    const parentId = m.parent_member_id || m.parent2_member_id;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId).children.push(node);
      usedAsChild.add(m.id);
    }
  }

  // Orphans with lineage: hang under primary leader of that lineage
  for (const m of members) {
    if (leaderIds.has(m.id) || usedAsChild.has(m.id)) continue;
    const node = byId.get(m.id);
    if (!node) continue;
    // Spouse-only nodes attach to their spouse later; skip if spouse is already placed
    if (m.spouse_member_id && usedAsChild.has(m.spouse_member_id) && !m.parent_member_id) {
      continue;
    }
    const lineage = m.tree_lineage || lineageFromMember(db, m.id);
    const primary =
      lineage === "tony" ? leaders.tony
        : lineage === "george" ? leaders.george
          : lineage === "anna" ? leaders.anna
            : null;
    if (primary) {
      primary.children.push(node);
      usedAsChild.add(m.id);
    }
  }

  // Pair spouses: show couples together; hide spouse from sibling list when linked
  function pairSpouses(list) {
    if (!list || !list.length) return list || [];
    const spouseOnly = new Set();
    for (const n of list) {
      if (!n.spouse_member_id || !byId.has(n.spouse_member_id)) continue;
      const sp = byId.get(n.spouse_member_id);
      if (!sp || spouseOnly.has(n.id)) continue;
      // Prefer lower id as the "primary" display so pairing is stable
      const a = n.id < sp.id ? n : sp;
      const b = n.id < sp.id ? sp : n;
      a.spouse = b;
      spouseOnly.add(b.id);
      usedAsChild.add(b.id);
    }
    const filtered = list.filter((n) => !spouseOnly.has(n.id));
    filtered.forEach((c) => {
      c.children = pairSpouses(c.children || []);
    });
    return filtered;
  }

  function sortKids(list) {
    list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    list.forEach((c) => sortKids(c.children || []));
  }
  Object.values(leaders).forEach((n) => {
    n.children = pairSpouses(n.children || []);
    sortKids(n.children || []);
  });

  const lines = LINEAGE_ORDER.map((key) => {
    const meta = LINEAGE_META[key];
    const primary = leaders[meta.coupleKeys[0]] || null;
    const spouse = leaders[meta.coupleKeys[1]] || null;
    const children = primary ? (primary.children || []) : [];
    // Merge spouse-only children if any
    if (spouse && spouse.children && spouse.children.length) {
      for (const c of spouse.children) {
        if (!children.find((x) => x.id === c.id)) children.push(c);
      }
      sortKids(children);
    }
    return {
      key,
      title: meta.title,
      role: meta.role,
      primary,
      spouse,
      children,
      count: countDescendants(children) + (primary ? 1 : 0) + (spouse ? 1 : 0),
    };
  });

  // Root parents are shown as the tree root only — never "awaiting branch placement"
  function isRootParent(m) {
    const n = nameBlob(m);
    const role = (m.role_in_family || "").toLowerCase();
    if (/foundational generation/.test(role)) return true;
    if (/costanzo/.test(n) && /capoccia/.test(n)) return true;
    if ((/madeline|maddalena|\blena\b/.test(n)) && /capoccia/.test(n) && !/christine|tony|fran|anna|george/.test(n)) return true;
    return false;
  }

  const unplaced = members
    .filter((m) => !leaderIds.has(m.id) && !usedAsChild.has(m.id) && !isRootParent(m))
    .map((m) => byId.get(m.id))
    .filter(Boolean);

  return {
    root: {
      title: "Capoccia Parents",
      names: "Costanzo & Maddalena (Madeline) Capoccia",
    },
    lines,
    leaders,
    memberCount: members.length,
    growingCount: members.filter((m) => !classifyLeader(m)).length,
    unplaced,
  };
}

function countDescendants(nodes) {
  let n = 0;
  for (const c of nodes || []) {
    n += 1 + countDescendants(c.children);
  }
  return n;
}

module.exports = {
  ensureTreeColumns,
  seedLeaderTreeMeta,
  lineageFromMember,
  generationFromParent,
  recomputeFamilyMemberSortOrders,
  listTreeAnchors,
  buildLivingTree,
  classifyLeader,
  displayName,
  LINEAGE_META,
  LINEAGE_ORDER,
};
