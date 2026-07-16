#!/bin/bash
set -euo pipefail
sudo docker cp /tmp/home.ejs prod-capocciamiotto:/app/views/home.ejs
if [ -d /opt/production/repos/capocciamiotto ]; then
  sudo cp /tmp/home.ejs /opt/production/repos/capocciamiotto/views/home.ejs
  echo "Synced host repo"
fi
sudo docker restart prod-capocciamiotto
sleep 5
sudo docker ps --filter name=prod-capocciamiotto --format '{{.Names}} {{.Status}}'
if sudo docker exec prod-capocciamiotto grep -q 'Home Photographs' /app/views/home.ejs; then
  echo "FAIL: Home Photographs still present"
  exit 1
fi
if sudo docker exec prod-capocciamiotto grep -q 'Community Board' /app/views/home.ejs; then
  echo "OK: Community Board present, Home Photographs removed"
fi
echo DONE
