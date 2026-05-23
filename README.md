<<<<<<< HEAD
# UGC Marketplace

Infrastructure scaffold for a bilingual UGC influencer marketplace.

## Requirements

- Node.js 22+
- npm 10+
- Docker Desktop, optional for containerized local startup

## Install

```bash
npm install
```

## Environment

Copy the root template before local development:

```bash
cp .env.example .env
```

Do not commit real secrets.

## Development

Run the API:

```bash
npm run dev --workspace @ugc-marketplace/api
```

Run the web app in a second terminal:

```bash
npm run dev --workspace @ugc-marketplace/web
```

Default URLs:

- Web: `http://localhost:3000`
- API health: `http://localhost:4000/health`

## Auth Development

The API initializes the auth schema on startup. Verification emails are written to
the dev outbox instead of an external provider:

```bash
curl http://localhost:4000/dev/email-outbox
```

Use the latest token from that response with `/verify-email?token=...`.

## Docker

```bash
docker compose up --build
```

## Verification

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

The CI workflow runs the same baseline checks with `npm run ci`.
=======
# ugc-marketplacee
>>>>>>> 5fd82d0ec74b7b5e5bc744514ff375530cf9e70b
