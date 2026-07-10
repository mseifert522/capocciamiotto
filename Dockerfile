FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ libvips42 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /app/data /app/public/uploads/originals /app/public/uploads/web /app/public/uploads/thumbs /app/public/uploads/audio \
    /app/public/uploads/board/images /app/public/uploads/board/thumbs /app/public/uploads/board/videos \
    && chown -R node:node /app

ENV NODE_ENV=production
ENV PORT=3080
ENV DATA_DIR=/app/data
ENV UPLOAD_DIR=/app/public/uploads
ENV SESSION_SECRET=change-me-in-compose

USER node
EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3080/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/server.js"]
