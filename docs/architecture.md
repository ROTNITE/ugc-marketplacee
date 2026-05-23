# Architecture Notes

This repository starts as a small npm-workspaces monorepo.

## Workspaces

- `apps/web` is the Next.js frontend.
- `apps/api` is the Node.js TypeScript API.

## Setup Boundaries

- Product features are intentionally out of scope for the initial setup.
- Secrets must not be committed. Use `.env.example` files as templates only.
- Database schemas, auth, payments, chat, recommendations, and moderation flows will be added in later phases.

## Local Services

`docker-compose.yml` defines local containers for the web app, API, PostgreSQL, and Redis. The API does not depend on database migrations yet; PostgreSQL and Redis are included as development infrastructure for future phases.

## Auth

Auth uses PostgreSQL tables initialized by the API on startup. Access sessions use
short-lived JWTs, refresh sessions use rotated HttpOnly cookies, and verification
emails go to a development outbox until a real email provider is selected.

## Checks

The baseline CI contract is:

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```
