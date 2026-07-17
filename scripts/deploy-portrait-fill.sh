#!/bin/bash
set -euo pipefail
REPO=/opt/production/repos/capocciamiotto
C=prod-capocciamiotto

cd "$REPO"
sudo git fetch origin
sudo git reset --hard origin/master

sudo docker cp "$REPO/public/css/site.css" "$C:/app/public/css/site.css"
sudo docker cp "$REPO/views/partials/header.ejs" "$C:/app/views/partials/header.ejs"
sudo docker cp "$REPO/views/partials/member-card.ejs" "$C:/app/views/partials/member-card.ejs"

# Express caches EJS in production
sudo docker restart "$C"
sleep 7

sudo docker exec "$C" node -e '
const http=require("http");
http.get("http://127.0.0.1:3080/",res=>{let d="";res.on("data",c=>d+=c);res.on("end",()=>{
  console.log("css", (d.match(/site\.css[^"\x27]*/)||[])[0]);
  console.log("has_fill_class", d.includes("member-card-photo--fill"));
  console.log("no_inline_cover_all", !d.includes("object-fit:cover") || d.includes("member-card-photo--fill"));
  if(!String((d.match(/site\.css[^"\x27]*/)||[])[0]||"").includes("portrait-full-1")) process.exit(2);
  console.log("OK");
});}).on("error",e=>{console.error(e);process.exit(1);});
'
