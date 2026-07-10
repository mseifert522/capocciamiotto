# Capoccia–Miotto Family Reunion Tribute

**Domain:** https://capocciamiotto.com  
**Since:** 1977  
**VM:** infra-prod-01

A living digital family archive for the Capoccia and Miotto families—photographs, reunion years, stories, and community board with moderated contributions.

## Admin

- URL: `/admin/login`
- Default email: `info@seifertcapital.com` (override with `ADMIN_EMAIL`)
- Set a strong `ADMIN_PASSWORD` and `SESSION_SECRET` in production

## Stack

- Node.js + Express + EJS
- SQLite (portable archive database)
- Sharp (web + thumbnail derivatives; originals preserved)
- Docker on infra-prod-01 behind Caddy

## Local

```bash
npm install
npm start
```

Open http://localhost:3080
