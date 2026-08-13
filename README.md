# auth-lab

`auth-lab` is a deliberately small application for exploring the full lifecycle of an authenticated user session. The finished product will include OAuth 2.0/OIDC sign-in with Google and GitHub, short-lived access tokens, rotating refresh tokens, account linking, and a session-management screen.

The scope is intentionally narrow: login, profile, and session management. The goal is to make the authentication and authorization mechanisms visible and understandable rather than to build a large product around them.

## Architecture

```text
Browser
  |
  v
Next.js web app
  |
  v
Fastify API ---- Google OIDC / GitHub OAuth
  |
  v
PostgreSQL (Prisma)
  |
  +-- User -> Account -> Session -> RefreshToken
```

## Repository structure

```text
apps/
  api/        Fastify API
  web/        Next.js application
packages/
  database/   Prisma schema, generated client, and database repositories
```

## Requirements

- Node.js 22+
- pnpm 11+
- Docker Desktop with the Docker Engine running

## Getting started

1. Create a local configuration file:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Start PostgreSQL:

   ```powershell
   docker compose up -d postgres
   ```

3. Install dependencies:

   ```powershell
   pnpm install
   ```

4. Apply the committed migrations:

   ```powershell
   pnpm db:migrate:deploy
   ```

5. Start the web app and API:

   ```powershell
   pnpm dev
   ```

Open [http://localhost:3000](http://localhost:3000). The API health check is available at [http://localhost:3001/health](http://localhost:3001/health).

If port `5432` is already used by another local PostgreSQL installation, set a different `POSTGRES_PORT` in `.env` and change the port in `DATABASE_URL` to the same value before starting Docker Compose.

## Google OAuth setup

1. Create an OAuth 2.0 **Web application** client in Google Cloud Console.
2. Add the exact value of `GOOGLE_REDIRECT_URI` to the client's authorized redirect URIs. The local default is `http://localhost:3001/auth/google/callback`.
3. Add your Google account as a test user while the consent screen is in testing mode.
4. Replace the placeholder values for `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `OAUTH_TRANSACTION_COOKIE_SECRET` in `.env`.

In development, a missing cookie secret is replaced with an in-memory random value so that the API remains usable before this setup is complete. Set a persistent secret before real testing; production refuses to start without one.

Google requires an exact redirect URI match, and permits `localhost` HTTP callbacks for local development. Production callbacks must use HTTPS. See the [Google web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server) and its [redirect URI rules](https://developers.google.com/identity/protocols/oauth2/web-server#redirect-uri_validation-rules).

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start Next.js and Fastify in parallel. |
| `pnpm build` | Build the database package, web app, and API for production. |
| `pnpm typecheck` | Type-check every workspace package. |
| `pnpm test` | Run API and database-repository tests. |
| `pnpm ci:verify` | Run the validation, type-check, test, and build sequence used by CI. |
| `pnpm db:generate` | Regenerate Prisma Client after a schema change. |
| `pnpm db:migrate:deploy` | Apply committed Prisma migrations. |
| `pnpm db:validate` | Validate the Prisma schema and configuration. |

## Data model

```text
User 1--* Account 1--* Session 1--* RefreshToken
```

- `User` is the application-level identity. It owns profile information and a role for future authorization rules.
- `Account` represents an identity at an OAuth provider. The unique `provider` + `providerAccountId` pair prevents the same provider account from being linked twice.
- `Session` represents one sign-in on one device or browser. It records creation, last activity, expiry, revocation, IP address, and user agent.
- `RefreshToken` stores only a token hash plus metadata needed for rotation, revocation, and refresh-token reuse detection.

## Technical decisions

### pnpm workspace instead of independent repositories

The web app, API, and database package are versioned together because authentication contracts span all three. A pnpm workspace keeps their dependencies isolated while providing one lockfile, one set of root quality commands, and local package imports without publishing an internal package. Separate repositories would add release and versioning overhead without improving this small project.

### Next.js for the UI, Fastify for the authentication boundary

Next.js is responsible for the user interface and browser-facing routes. Fastify owns OAuth callbacks, token issuance, session invalidation, and authorization middleware. Keeping provider secrets and token logic out of the frontend gives the API a clear security boundary and avoids coupling the browser to a specific OAuth provider implementation.

Fastify is chosen over a heavier application framework because its plugin model, schema support, and low-overhead request lifecycle suit a small API that will progressively add authentication middleware. Next.js is not used as the OAuth backend so that API behavior remains independently testable and could later serve another client without moving security-sensitive logic.

### PostgreSQL as the source of truth; Redis deferred

PostgreSQL stores users, linked provider accounts, sessions, and refresh-token metadata transactionally. Session revocation and refresh-token rotation need durable state, relational constraints, and auditable timestamps; PostgreSQL provides these without another moving part.

Redis is intentionally not part of the initial implementation. It can later be introduced for rate limiting, short-lived caches, or distributed coordination if there is a real need. It is not required to correctly revoke a session or detect refresh-token reuse in this application.

### Prisma with committed migrations and a generated client

Prisma provides a typed data model and checked-in SQL migrations. The generated client is excluded from Git because it is deterministic build output. The database package exposes a small Prisma client factory and repository layer, so the API does not need to scatter ORM queries throughout authentication handlers.

The initial migration is committed rather than relying on `db push`. `prisma migrate deploy` can therefore reproduce the exact database history in development, CI, and production.

### Separate `User`, `Account`, `Session`, and `RefreshToken` models

A provider identity is not the same as a local application user. Separating `Account` from `User` enables multiple sign-in methods per user and is the foundation for later Google/GitHub account linking. A session belongs to an account, and the account belongs to a user; this avoids duplicating `userId` in `Session` and prevents mismatched account/user references at the database level.

Each refresh token belongs to one session and is stored as a hash, never as its raw secret. `familyId`, `usedAt`, `revokedAt`, and the self-reference to its replacement are included now because they are required to implement rotation and detect reuse safely in the next session-lifecycle stage.

### UUID primary keys and database constraints

All identity and token records use UUID primary keys rather than sequential integers. They are safe to expose in URLs and JWT claims without revealing record counts. Unique constraints, foreign keys, cascade behavior, and indexes implement important invariants in PostgreSQL instead of relying only on application code.

### Google OIDC Authorization Code Flow with PKCE

Google sign-in is implemented as a backend-owned Authorization Code Flow. The API creates a fresh high-entropy `state`, PKCE `code_verifier`, and OIDC `nonce` for every attempt. It stores them in a signed, `httpOnly`, `SameSite=Lax` cookie restricted to `/auth/google`; the callback clears it regardless of outcome. The incoming `state` is compared in constant time and transactions expire after ten minutes.

The API sends the original verifier only to Google's token endpoint. It then verifies the returned `id_token` signature using Google's JWKS and validates issuer, audience, expiry, nonce, subject, and verified email before any database write. This is stronger than decoding the JWT or trusting profile fields sent by the browser. Google documents `state` as an opaque round-trip value and `nonce` as replay protection in its [OIDC reference](https://developers.google.com/identity/openid-connect/reference); `jose` caches and selects trusted JWKS keys for signature verification.

At this stage, the callback creates or finds a `User` and `Account`, then redirects to the UI with a non-sensitive status only. It intentionally does **not** create an application session yet. The next stage will add access and refresh tokens.

### Account creation and future account linking

On first Google sign-in, the application creates the `User` and `Account` in one nested Prisma write. If the Google `sub` already has an account, it finds that account's user. If a different local identity already owns the same email, the flow refuses to link it automatically. Email equality alone is not proof that the same person controls both accounts; explicit linking while authenticated will be added with GitHub support.

### Planned token and provider stages

The following items are planned for subsequent implementation stages:

- Google OIDC and GitHub OAuth adapters. Google will use its OIDC `id_token`; GitHub will use its OAuth access token to fetch the profile because it does not provide the same OIDC identity token flow.
- Short-lived JWT access tokens for API authorization, paired with long-lived, rotating refresh tokens in `httpOnly`, `Secure`, and appropriately scoped `SameSite` cookies.
- Server-side session and refresh-token revocation, which makes "log out this device" and "log out all devices" effective immediately even before JWT expiry.

This design is preferred over a single long-lived JWT because an independently revocable, rotated refresh token gives the server meaningful session control while keeping frequent API authorization lightweight.

### Environment variables and secret boundaries

`.env.example` documents the required local configuration, while `.env` is ignored by Git. Database URLs, OAuth client secrets, cookie keys, and signing keys must remain server-only. In Next.js, only variables explicitly prefixed with `NEXT_PUBLIC_` may be exposed to browser code; no secret should use that prefix.

The Fastify CORS configuration allows credentialed requests only from the configured `WEB_ORIGIN`. It does not use `*`, because wildcard origins are incompatible with credentialed browser requests and would be too broad for cookie-based refresh tokens.

### CI as a branch-protection gate

GitHub Actions runs on pull requests and pushes to `main`. It uses a clean PostgreSQL service, applies the committed migration, validates Prisma, type-checks, runs tests, and creates production builds. Installation uses `--frozen-lockfile`, so an uncommitted dependency change fails the workflow.

The workflow grants only `contents: read`, cancels superseded runs for the same pull request, and has a ten-minute timeout. Configure the `Quality, tests and build` job as a required status check in GitHub branch protection rules before merging.

### Test strategy at the current stage

Repository tests use a mocked Prisma client to verify query shape and security filters quickly: for example, active-session lookups require the requesting user, and refresh-token consumption requires a token that is unused, unrevoked, and unexpired. Fastify tests cover the health endpoint, credentialed CORS configuration, OAuth transaction cookies, PKCE parameters, state mismatch rejection, callback handoff, and identity-account resolution.

Later stages will add integration tests against PostgreSQL for token rotation and end-to-end tests for OAuth callback, state, PKCE, and session-revocation scenarios. This layered approach keeps feedback fast now while reserving full infrastructure tests for flows that need them.

## Continuous integration

The [`Verify` workflow](.github/workflows/ci.yml) runs for every pull request and for changes pushed to `main`. It starts a clean PostgreSQL service, applies migrations, then runs `pnpm ci:verify`.

To make it a merge gate, configure GitHub branch protection and require the `Quality, tests and build` job to pass.

## Current status

The application foundation, data model, repositories, initial migration, CI workflow, and Google OIDC identity flow are in place. Application session tokens, authorization middleware, GitHub account linking, and the session-management UI are intentionally introduced in subsequent small stages.
