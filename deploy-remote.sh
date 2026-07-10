#!/bin/bash
set -e
cd /opt/production

if [ -d repos/capocciamiotto/.git ]; then
  cd repos/capocciamiotto
  sudo git fetch origin
  sudo git reset --hard origin/master
  cd /opt/production
else
  sudo git clone https://github.com/mseifert522/capocciamiotto.git repos/capocciamiotto
fi

sudo mkdir -p /opt/production/data/capocciamiotto \
  /opt/production/data/capocciamiotto-uploads/originals \
  /opt/production/data/capocciamiotto-uploads/web \
  /opt/production/data/capocciamiotto-uploads/thumbs
sudo chown -R 1000:1000 /opt/production/data/capocciamiotto /opt/production/data/capocciamiotto-uploads || true

# Secrets
if [ ! -f /opt/production/secrets/capocciamiotto.env ]; then
  SS=$(openssl rand -hex 24)
  AP=$(openssl rand -base64 12 | tr -d '/+=' | head -c 16)
  sudo tee /opt/production/secrets/capocciamiotto.env >/dev/null <<EOF
SESSION_SECRET=${SS}
ADMIN_EMAIL=info@seifertcapital.com
ADMIN_PASSWORD=${AP}
NODE_ENV=production
PORT=3080
DATA_DIR=/app/data
UPLOAD_DIR=/app/public/uploads
EOF
  sudo chmod 600 /opt/production/secrets/capocciamiotto.env
  echo "GENERATED_ADMIN_PASSWORD=${AP}"
else
  echo "Using existing secrets file"
  grep ADMIN_PASSWORD /opt/production/secrets/capocciamiotto.env || true
fi

# Patch compose if needed
if ! grep -q "prod-capocciamiotto" docker-compose.yml; then
  sudo cp docker-compose.yml "docker-compose.yml.bak.capocciamiotto"
  sudo python3 - <<'PY'
from pathlib import Path
p = Path("/opt/production/docker-compose.yml")
text = p.read_text()
if "prod-capocciamiotto" in text:
    print("compose already has service")
else:
    net = "  prod-capocciamiotto-net:\n    driver: bridge\n"
    if "networks:" in text:
        # insert after networks: line
        lines = text.splitlines(True)
        out = []
        inserted_net = False
        for i, line in enumerate(lines):
            out.append(line)
            if not inserted_net and line.strip() == "networks:":
                # find first blank after some networks - insert at end of networks block before services
                pass
        # simpler: before "services:"
        text2 = text
        if "\nservices:\n" in text2:
            text2 = text2.replace("\nservices:\n", "\n" + net + "\nservices:\n", 1)
        else:
            text2 = text + "\n" + net
        svc = """
  # --- capocciamiotto.com Capoccia-Miotto Family Reunion Tribute ---
  prod-capocciamiotto:
    build:
      context: ./repos/capocciamiotto
      dockerfile: Dockerfile
    container_name: prod-capocciamiotto
    restart: unless-stopped
    env_file:
      - ./secrets/capocciamiotto.env
    environment:
      - NODE_ENV=production
      - PORT=3080
    volumes:
      - ./data/capocciamiotto:/app/data
      - ./data/capocciamiotto-uploads:/app/public/uploads
    networks:
      - prod-capocciamiotto-net
      - proxy-net
    mem_limit: 512m
    cpus: 0.50
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://127.0.0.1:3080/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s
"""
        p.write_text(text2.rstrip() + "\n" + svc + "\n")
        print("compose service added")
PY
else
  echo "compose service exists"
fi

cd /opt/production
sudo docker compose build prod-capocciamiotto
sudo docker compose up -d prod-capocciamiotto

# Caddy
if ! sudo grep -q "capocciamiotto.com" /opt/infrastructure/Caddyfile; then
  sudo cp /opt/infrastructure/Caddyfile /opt/backups/Caddyfile-before-capocciamiotto
  sudo tee -a /opt/infrastructure/Caddyfile >/dev/null <<'CADDY'

# --- capocciamiotto.com Capoccia-Miotto Family Reunion Tribute ---
www.capocciamiotto.com {
    import security_headers
    import block_exploits
    tls internal
    redir https://capocciamiotto.com{uri} permanent
}

capocciamiotto.com {
    import security_headers
    import block_exploits
    tls internal
    encode zstd gzip
    reverse_proxy prod-capocciamiotto:3080
}
CADDY
  echo "Caddyfile updated"
fi

sudo docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo docker restart caddy
sleep 5
sudo docker network connect production_prod-capocciamiotto-net caddy 2>/dev/null || true

sudo docker ps --filter name=prod-capocciamiotto --format '{{.Names}} {{.Status}}'
sleep 5
sudo docker logs prod-capocciamiotto --tail 30
sudo docker exec prod-capocciamiotto node -e "require('http').get('http://127.0.0.1:3080/healthz',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>console.log(d,r.statusCode))}).on('error',e=>console.error(e))"
curl -sk -o /dev/null -w "local_https=%{http_code}\n" --resolve capocciamiotto.com:443:127.0.0.1 https://capocciamiotto.com/ || true
echo DONE
