# HOLIX Magazine — Digital Library

A web reader for HOLIX Magazine issues. Readers browse and read issues as
PDFs, favorite them, and comment. An admin dashboard handles uploads and shows
read, favorite and membership analytics.

**Stack:** Node.js · Express · Supabase (Postgres and Storage) · vanilla JS
frontend · deployed on Render

## Features

- **Issue library.** Issues are sorted by the number in their label
  (`issue 03` → 3), not by upload time, so a re-uploaded issue keeps its place.
- **Lightweight membership.** Readers register with only a name. They are
  recognised by an `HttpOnly` cookie, with a fallback to their IP address.
- **Reads, favorites and comments.** Each is stored per member and rolled up
  into per-issue stats (`issue_stats`).
- **Admin dashboard.** Upload a cover and a PDF (checked by MIME type, up to
  100 MB, stored in Supabase Storage buckets). You can also delete an issue,
  which removes its storage objects too, and see member, read and favorite
  analytics.
- **Signed admin sessions.** Admin tokens are HMAC-signed with a key derived
  from `ADMIN_PASSWORD` and expire after 12 hours. Signatures are compared in
  constant time.

## Architecture

```
public/            static frontend (index.html, app.js, style.css, legal pages)
server.js          Express API + static hosting
  /api/me, /api/register            member identity
  /api/magazines[/:id][/read]       library + read tracking
  /api/favorites/:id                toggle favorite
  /api/comments[/:magazineId]       comments
  /api/admin/*                      login, upload, delete, stats, members, analytics
Supabase           tables: members, issues, reads, favorites, comments, issue_stats
                   storage buckets: covers, pdfs
```

The server talks to Supabase with the service-role key, so it is the only
thing that can write data. The browser never holds Supabase credentials.

## Running locally

Requires Node.js 18 or newer.

```bash
npm install
cat > .env <<'ENV'
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
ADMIN_PASSWORD=<choose-one>
ENV
npm start            # or: npm run dev  (nodemon)
```

Then open http://localhost:3000.

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-side only. Never expose it to the browser. |
| `ADMIN_PASSWORD` | yes in production | If unset, admin login only works locally, using the development fallback |
| `PORT` | no | Defaults to `3000` |

For a step-by-step setup guide written for non-developers, see
[docs/SETUP-GUIDE-NON-DEVELOPERS.txt](docs/SETUP-GUIDE-NON-DEVELOPERS.txt).

## Deployment

`render.yaml` defines a free-tier Render web service (`npm install` and
`npm start`). Set `ADMIN_PASSWORD` and `SUPABASE_SERVICE_ROLE_KEY` in the
Render dashboard.

## Legal

[Terms](TERMS.md) · [Privacy](PRIVACY.md)
