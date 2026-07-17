#!/bin/bash
set -euo pipefail
REPO=/opt/production/repos/capocciamiotto
C=prod-capocciamiotto

cd "$REPO"
sudo git fetch origin
sudo git reset --hard origin/master

# Copy files into running container
sudo docker cp "$REPO/public/css/site.css" "$C:/app/public/css/site.css"
sudo docker cp "$REPO/views/partials/header.ejs" "$C:/app/views/partials/header.ejs"
sudo docker cp "$REPO/views/partials/member-card.ejs" "$C:/app/views/partials/member-card.ejs"

# CRITICAL: Express caches EJS in production — restart to pick up views
sudo docker restart "$C"
sleep 6

echo "=== verify disk ==="
sudo docker exec "$C" grep site.css /app/views/partials/header.ejs
sudo docker exec "$C" grep -n 'object-fit: cover !important' /app/public/css/site.css | head -3

echo "=== verify live render ==="
sudo docker exec "$C" node -e '
const http=require("http");
http.get("http://127.0.0.1:3080/",res=>{let d="";res.on("data",c=>d+=c);res.on("end",()=>{
  const m=d.match(/site\.css[^"\x27]*/);
  console.log("html_css_link", m&&m[0]);
  if(!m||!String(m[0]).includes("portrait-fill-2")) process.exit(2);
});}).on("error",e=>{console.error(e);process.exit(1);});
'
sudo docker exec "$C" node -e '
const http=require("http");
http.get("http://127.0.0.1:3080/css/site.css?v=portrait-fill-2",res=>{let d="";res.on("data",c=>d+=c);res.on("end",()=>{
  console.log("has_absolute_img", d.includes("position: absolute !important") && d.includes("object-fit: cover !important"));
  if(!d.includes("object-fit: cover !important")) process.exit(3);
});}).on("error",e=>{console.error(e);process.exit(1);});
'
echo "DONE OK"
