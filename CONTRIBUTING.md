# Contributing

Thanks for contributing to the UGC Marketplace.

## Branching

- `main` is the deployable branch.
- Use short-lived feature branches: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`.
- Open a Pull Request to `main`; PRs require a green CI run and one review.

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: add password reset endpoint`
- `fix: prevent escrow double-release`
- `chore: bump eslint`
- `docs: explain parental consent flow`

## Local development

```bash
npm install
cp .env.example .env
npm run dev --workspace @ugc-marketplace/api
npm run dev --workspace @ugc-marketplace/web
```

## Before opening a PR

Run the same baseline CI uses:

```bash
npm run ci
```

That executes `lint`, `format:check`, `typecheck`, `test`, and `build`.

## Code style

- TypeScript everywhere.
- No `any` in new code unless explicitly justified in a comment.
- Backend errors should be typed and surfaced via `next(error)` to the error
  handler, not by sending `res.status(500)` ad-hoc.
- Never commit real secrets. `.env.example` is the source of truth for the
  variable list.

## Security & privacy

- Auth endpoints must be rate-limited.
- Any new endpoint that returns user PII must require `requireAuth` and check
  ownership/role.
- Users under 18 must have `parentalConsentGrantedAt` before payments or
  direct messaging are enabled.
- Report security issues privately to the repo owner instead of opening a
  public issue.
