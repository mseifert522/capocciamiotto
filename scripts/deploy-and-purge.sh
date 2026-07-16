#!/bin/bash
set -euo pipefail

echo "=== Capoccia–Miotto deploy + purge test photos ==="
echo "HOST=$(hostname)"
date -u

REPO=/opt/production/repos/capocciamiotto
COMPOSE_DIR=/opt/production

if [ ! -d "$REPO/.git" ]; then
  echo "ERROR: repo missing at $REPO"
  ls -la /opt/production || true
  exit 1
fi

cd "$REPO"
sudo git fetch origin
sudo git reset --hard origin/master
echo "GIT=$(sudo git rev-parse --short HEAD)"
sudo git log -5 --oneline

cd "$COMPOSE_DIR"
echo "=== docker compose build ==="
sudo docker compose build prod-capocciamiotto
echo "=== docker compose up ==="
sudo docker compose up -d prod-capocciamiotto
sleep 8
sudo docker ps --filter name=prod-capocciamiotto --format '{{.Names}} {{.Status}} {{.Image}}'
echo "=== container logs (tail) ==="
sudo docker logs prod-capocciamiotto --tail 40

echo "=== purge automated test photos ==="
# Script is in the image after rebuild; also available via mounted repo if present
if sudo docker exec prod-capocciamiotto test -f /app/scripts/purge-test-photos.js; then
  sudo docker exec prod-capocciamiotto node /app/scripts/purge-test-photos.js
else
  # Fallback: copy from host repo into container and run
  sudo docker cp "$REPO/scripts/purge-test-photos.js" prod-capocciamiotto:/tmp/purge-test-photos.js
  sudo docker exec prod-capocciamiotto node /tmp/purge-test-photos.js
fi

echo "=== health checks ==="
sudo docker exec prod-capocciamiotto node -e "require('http').get('http://127.0.0.1:3080/healthz',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{console.log('healthz',r.statusCode,d);process.exit(r.statusCode===200?0:1)});}).on('error',e=>{console.error(e);process.exit(1)})"

curl -sS -o /tmp/archive.html -w "archive_http=%{http_code}\n" http://127.0.0.1:3080/photo-archive || true
if grep -Eiq 'auto-approve verification|bulk multi-photo test|second automated test photo|automated functionality test photo|cmfr test' /tmp/archive.html 2>/dev/null; then
  echo "WARN: test strings still present in archive HTML"
  grep -Eio '.{0,40}(auto-approve|bulk multi|automated functionality|cmfr test).{0,40}' /tmp/archive.html | head -20 || true
else
  echo "OK: no test photo strings in archive HTML"
fi

curl -sS "http://127.0.0.1:3080/upcoming-reunion?year=2026" -o /tmp/up2026.html || true
if grep -q 'Gretchen Miotto' /tmp/up2026.html 2>/dev/null; then
  echo "OK: 2026 shows Gretchen Miotto"
else
  echo "WARN: Gretchen Miotto not found on upcoming 2026 page"
fi

echo "=== DONE ==="
