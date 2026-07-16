#!/bin/bash
# Run ON the production VM (or: ssh vm-main 'bash -s' < scripts/purge-test-photos-remote.sh)
set -euo pipefail

echo "=== Purge Capoccia–Miotto automated test photos ==="

if ! sudo docker ps --format '{{.Names}}' | grep -q '^prod-capocciamiotto$'; then
  echo "Container prod-capocciamiotto not running"
  exit 1
fi

# 1) Pull latest code that includes purge + archive filters
if [ -d /opt/production/repos/capocciamiotto/.git ]; then
  cd /opt/production/repos/capocciamiotto
  sudo git fetch origin
  sudo git reset --hard origin/master
  cd /opt/production
  sudo docker compose build prod-capocciamiotto
  sudo docker compose up -d prod-capocciamiotto
  sleep 5
fi

# 2) Delete test rows directly in the SQLite DB on the volume (works even before rebuild)
DB=""
for candidate in \
  /opt/production/data/capocciamiotto/archive.db \
  /opt/production/data/capocciamiotto/tribute.db
do
  if [ -f "$candidate" ]; then DB="$candidate"; break; fi
done

if [ -n "$DB" ]; then
  echo "Using database: $DB"
  sudo docker run --rm -v "$(dirname "$DB"):/data" keinos/sqlite3 sqlite3 "/data/$(basename "$DB")" "
    DELETE FROM photo_people WHERE photo_id IN (
      SELECT id FROM photos WHERE
        lower(coalesce(title,'')) LIKE '%auto-approve%'
        OR lower(coalesce(title,'')) LIKE '%auto approve%'
        OR lower(coalesce(title,'')) LIKE '%bulk multi%'
        OR lower(coalesce(title,'')) LIKE '%second automated%'
        OR lower(coalesce(title,'')) LIKE '%automated functionality%'
        OR lower(coalesce(title,'')) LIKE '%cmfr test%'
        OR lower(coalesce(contributor_name,'')) LIKE '%automated health%'
        OR lower(coalesce(contributor_email,'')) = 'healthcheck@example.com'
        OR lower(coalesce(description,'')) LIKE '%functionality test%'
        OR lower(coalesce(description,'')) LIKE '%safe to delete%'
    );
    DELETE FROM photos WHERE
      lower(coalesce(title,'')) LIKE '%auto-approve%'
      OR lower(coalesce(title,'')) LIKE '%auto approve%'
      OR lower(coalesce(title,'')) LIKE '%bulk multi%'
      OR lower(coalesce(title,'')) LIKE '%second automated%'
      OR lower(coalesce(title,'')) LIKE '%automated functionality%'
      OR lower(coalesce(title,'')) LIKE '%cmfr test%'
      OR lower(coalesce(contributor_name,'')) LIKE '%automated health%'
      OR lower(coalesce(contributor_email,'')) = 'healthcheck@example.com'
      OR lower(coalesce(description,'')) LIKE '%functionality test%'
      OR lower(coalesce(description,'')) LIKE '%safe to delete%';
    SELECT changes();
  " || {
    # Fallback: exec sqlite inside app container if present
    sudo docker exec prod-capocciamiotto sh -c '
      node -e "
        const Database=require(\"better-sqlite3\");
        const path=require(\"path\");
        const fs=require(\"fs\");
        const dir=process.env.DATA_DIR||\"/app/data\";
        const p=fs.existsSync(path.join(dir,\"archive.db\"))?path.join(dir,\"archive.db\"):path.join(dir,\"tribute.db\");
        const db=new Database(p);
        const where=\`
          lower(coalesce(title,\"\")) LIKE \"%auto-approve%\"
          OR lower(coalesce(title,\"\")) LIKE \"%auto approve%\"
          OR lower(coalesce(title,\"\")) LIKE \"%bulk multi%\"
          OR lower(coalesce(title,\"\")) LIKE \"%second automated%\"
          OR lower(coalesce(title,\"\")) LIKE \"%automated functionality%\"
          OR lower(coalesce(title,\"\")) LIKE \"%cmfr test%\"
          OR lower(coalesce(contributor_name,\"\")) LIKE \"%automated health%\"
          OR lower(coalesce(contributor_email,\"\")) = \"healthcheck@example.com\"
          OR lower(coalesce(description,\"\")) LIKE \"%functionality test%\"
          OR lower(coalesce(description,\"\")) LIKE \"%safe to delete%\"
        \`;
        const ids=db.prepare(\"SELECT id FROM photos WHERE \"+where).all().map(r=>r.id);
        const delP=db.prepare(\"DELETE FROM photo_people WHERE photo_id=?\");
        const del=db.prepare(\"DELETE FROM photos WHERE id=?\");
        const tx=db.transaction(()=>{ ids.forEach(id=>{ delP.run(id); del.run(id); }); });
        tx();
        console.log(\"deleted\", ids.length, \"test photos\");
      "
    '
  }
else
  echo "DB path not found on host; purging inside container only"
  sudo docker exec prod-capocciamiotto node -e "
    const Database=require('better-sqlite3');
    const path=require('path');
    const fs=require('fs');
    const dir=process.env.DATA_DIR||'/app/data';
    const p=fs.existsSync(path.join(dir,'archive.db'))?path.join(dir,'archive.db'):path.join(dir,'tribute.db');
    const db=new Database(p);
    const where=\`
      lower(coalesce(title,'')) LIKE '%auto-approve%'
      OR lower(coalesce(title,'')) LIKE '%auto approve%'
      OR lower(coalesce(title,'')) LIKE '%bulk multi%'
      OR lower(coalesce(title,'')) LIKE '%second automated%'
      OR lower(coalesce(title,'')) LIKE '%automated functionality%'
      OR lower(coalesce(title,'')) LIKE '%cmfr test%'
      OR lower(coalesce(contributor_name,'')) LIKE '%automated health%'
      OR lower(coalesce(contributor_email,'')) = 'healthcheck@example.com'
      OR lower(coalesce(description,'')) LIKE '%functionality test%'
      OR lower(coalesce(description,'')) LIKE '%safe to delete%'
    \`;
    const ids=db.prepare('SELECT id FROM photos WHERE '+where).all().map(r=>r.id);
    const delP=db.prepare('DELETE FROM photo_people WHERE photo_id=?');
    const del=db.prepare('DELETE FROM photos WHERE id=?');
    const tx=db.transaction(()=>{ ids.forEach(id=>{ delP.run(id); del.run(id); }); });
    tx();
    console.log('deleted', ids.length, 'test photos');
  "
fi

sudo docker restart prod-capocciamiotto
sleep 4
echo "Health:"
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080/healthz || true
echo "DONE — open https://capocciamiotto.com/photo-archive and confirm colored test tiles are gone."
