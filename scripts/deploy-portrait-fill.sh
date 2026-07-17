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
sudo docker cp "$REPO/src/server.js" "$C:/app/src/server.js"

# Express caches compiled EJS in production — restart required for views + server.js
sudo docker restart "$C"
sleep 7

echo "=== origin verify ==="
sudo docker exec "$C" grep site.css /app/views/partials/header.ejs
sudo docker exec "$C" node -e '
const http=require("http");
function get(path){return new Promise((resolve,reject)=>{
  http.get("http://127.0.0.1:3080"+path,res=>{let d="";res.on("data",c=>d+=c);res.on("end",()=>resolve({status:res.statusCode,headers:res.headers,body:d}));}).on("error",reject);
});}
(async()=>{
  const home=await get("/");
  console.log("status", home.status);
  console.log("cache_control", home.headers["cache-control"]);
  console.log("html_css", (home.body.match(/site\.css[^"\x27]*/)||[])[0]);
  console.log("has_inline_object_fit", home.body.includes("object-fit:cover"));
  if(!String((home.body.match(/site\.css[^"\x27]*/)||[])[0]||"").includes("portrait-fill-3")) process.exit(2);
  if(!home.body.includes("object-fit:cover")) process.exit(3);
  console.log("ORIGIN_OK");
})().catch(e=>{console.error(e);process.exit(1);});
'
echo DONE
