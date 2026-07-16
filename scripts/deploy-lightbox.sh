#!/bin/bash
set -euo pipefail
rm -rf /tmp/capoccia-lightbox
mkdir -p /tmp/capoccia-lightbox

# Windows Compress-Archive may store paths with backslashes — normalize on extract
python3 <<'PY'
import zipfile, os
from pathlib import Path
root = Path("/tmp/capoccia-lightbox")
with zipfile.ZipFile("/tmp/capoccia-lightbox.zip") as zf:
    for info in zf.infolist():
        name = info.filename.replace("\\", "/").lstrip("/")
        if not name or name.endswith("/"):
            continue
        dest = root / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info) as src, open(dest, "wb") as out:
            out.write(src.read())
        print("wrote", dest)
PY

echo "Extracted tree:"
find /tmp/capoccia-lightbox -type f | sort

C=prod-capocciamiotto
BASE=/tmp/capoccia-lightbox
sudo docker cp "$BASE/public/js/site.js" "$C":/app/public/js/site.js
sudo docker cp "$BASE/public/css/site.css" "$C":/app/public/css/site.css
sudo docker cp "$BASE/views/photo-archive.ejs" "$C":/app/views/photo-archive.ejs
sudo docker cp "$BASE/views/reunion-year.ejs" "$C":/app/views/reunion-year.ejs
sudo docker cp "$BASE/views/family-member.ejs" "$C":/app/views/family-member.ejs
sudo docker cp "$BASE/views/family-members.ejs" "$C":/app/views/family-members.ejs
sudo docker cp "$BASE/views/memorials.ejs" "$C":/app/views/memorials.ejs
sudo docker cp "$BASE/views/family-story.ejs" "$C":/app/views/family-story.ejs
sudo docker cp "$BASE/views/timeline.ejs" "$C":/app/views/timeline.ejs
sudo docker cp "$BASE/views/partials/header.ejs" "$C":/app/views/partials/header.ejs
sudo docker cp "$BASE/views/partials/footer.ejs" "$C":/app/views/partials/footer.ejs
sudo docker cp "$BASE/views/partials/tree-branch-nodes.ejs" "$C":/app/views/partials/tree-branch-nodes.ejs
sudo docker cp "$BASE/views/partials/visual-tree-children.ejs" "$C":/app/views/partials/visual-tree-children.ejs

if [ -d /opt/production/repos/capocciamiotto ]; then
  R=/opt/production/repos/capocciamiotto
  sudo cp "$BASE/public/js/site.js" "$R/public/js/site.js"
  sudo cp "$BASE/public/css/site.css" "$R/public/css/site.css"
  sudo cp "$BASE/views/photo-archive.ejs" "$R/views/photo-archive.ejs"
  sudo cp "$BASE/views/reunion-year.ejs" "$R/views/reunion-year.ejs"
  sudo cp "$BASE/views/family-member.ejs" "$R/views/family-member.ejs"
  sudo cp "$BASE/views/family-members.ejs" "$R/views/family-members.ejs"
  sudo cp "$BASE/views/memorials.ejs" "$R/views/memorials.ejs"
  sudo cp "$BASE/views/family-story.ejs" "$R/views/family-story.ejs"
  sudo cp "$BASE/views/timeline.ejs" "$R/views/timeline.ejs"
  sudo cp "$BASE/views/partials/header.ejs" "$R/views/partials/header.ejs"
  sudo cp "$BASE/views/partials/footer.ejs" "$R/views/partials/footer.ejs"
  sudo cp "$BASE/views/partials/tree-branch-nodes.ejs" "$R/views/partials/tree-branch-nodes.ejs"
  sudo cp "$BASE/views/partials/visual-tree-children.ejs" "$R/views/partials/visual-tree-children.ejs"
  echo "Synced host repo $R"
fi

sudo docker restart "$C"
sleep 5
sudo docker ps --filter name="$C" --format '{{.Names}} {{.Status}}'
sudo docker exec "$C" node -e "require('http').get('http://127.0.0.1:3080/healthz',r=>{console.log('health',r.statusCode);process.exit(r.statusCode===200?0:1)}).on('error',e=>{console.error(e);process.exit(1)})"
sudo docker exec "$C" sh -c 'grep -q "lightbox-zoomable" /app/public/js/site.js && grep -q "20260711a" /app/views/partials/footer.ejs && echo ASSETS_OK'
echo DONE
