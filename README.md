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
4. Replace the placeholder values for `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_TRANSACTION_COOKIE_SECRET`, `ACCESS_TOKEN_SECRET`, and `REFRESH_TOKEN_PEPPER` in `.env`.

In development, a missing cookie secret is replaced with an in-memory random value so that the API remains usable before this setup is complete. Set a persistent secret before real testing; production refuses to start without one.

Google requires an exact redirect URI match, and permits `localhost` HTTP callbacks for local development. Production callbacks must use HTTPS. See the [Google web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server) and its [redirect URI rules](https://developers.google.com/identity/protocols/oauth2/web-server#redirect-uri_validation-rules).

## Application-session lifecycle

After the Google callback has verified the OIDC identity, the API creates one `Session` and one refresh-token record. It stores a random refresh token only in an `httpOnly`, `SameSite=Lax`, `/auth` cookie; PostgreSQL receives only an HMAC hash of that secret. The callback redirects without putting a token in the URL.

The browser obtains an access token with a credentialed `POST /auth/refresh` request. A successful call returns a short-lived JWT in JSON and replaces the refresh cookie with a new random value. The frontend should keep that access token in memory and send it as `Authorization: Bearer <token>`; it must not persist it in local storage or a JavaScript-readable cookie.

| Endpoint | Purpose |
| --- | --- |
| `POST /auth/refresh` | Rotate the refresh token and return `{ accessToken, tokenType, expiresIn }`. Requests with a foreign `Origin` are rejected. |
| `POST /auth/logout` | Revoke the session represented by the current refresh cookie and clear that cookie. It is intentionally idempotent. |
| `GET /auth/me` | Profile endpoint. It requires a Bearer access token and confirms that its server-side session is still active. |
| `GET /sessions` | List the authenticated user's active sessions, their provider, device metadata, timestamps, expiry, and whether each is the current session. |
| `DELETE /sessions/:id` | Revoke one active session owned by the authenticated user and its refresh tokens. Deleting the current session also clears its refresh cookie. |
| `DELETE /sessions` | Revoke every active session and refresh token belonging to the authenticated user, then clear the current refresh cookie. |

Rotation is single-use. If a used, revoked, expired, or concurrently consumed refresh token appears again, the API revokes its entire token family and the associated session. Because the authorization middleware reads the active session from PostgreSQL after validating the JWT, logout and reuse detection invalidate an already-issued access token immediately rather than waiting for its short expiry.

## Profile and session management

The dashboard restores a session by calling `POST /auth/refresh` once when it mounts, then keeps the returned access token only in React memory. It uses that token to load the profile and active sessions. When an API call returns `401`, it performs one refresh-and-retry cycle; it never writes an access token to `localStorage`, `sessionStorage`, or a JavaScript-readable cookie.

The Sessions screen makes the server-side state visible: provider, device/user-agent, IP address, creation time, last activity, expiry, and the current-device marker. Revoking another device reloads the list. Revoking the current session or all sessions clears the local in-memory token and returns the UI to the sign-in state.

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

### Function factories instead of application classes

The repositories, session services, Google/OIDC adapter, identity resolver, and sign-in workflow are factory functions. Each factory receives its dependencies explicitly—such as the Prisma client, a test clock, or an OAuth configuration—and returns only the operations that belong to that module. This gives the code a small, readable dependency boundary without `this`, constructors, inheritance, or mutable instance state.

For example, `createSessionLifecycleService` closes over the token secrets, database client, and clock; `createSessionsRepository` closes over a Prisma delegate and clock. Tests can substitute these dependencies directly, while application wiring is a straightforward series of function calls in `server.ts`. Custom authentication errors are ordinary `Error` objects with a stable `code` property and accompanying type guards, not subclasses.

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

After the identity is resolved, the callback creates a local application session, writes only its opaque refresh token to a secure cookie, and redirects to the UI with a non-sensitive status. It intentionally does not expose an access token in the redirect URL; access tokens are issued later through the cookie-backed refresh endpoint.

### Account creation and future account linking

On first Google sign-in, the application creates the `User` and `Account` in one nested Prisma write. If the Google `sub` already has an account, it finds that account's user. If a different local identity already owns the same email, the flow refuses to link it automatically. Email equality alone is not proof that the same person controls both accounts; explicit linking while authenticated will be added with GitHub support.

### Session tokens and immediate revocation

The API signs access JWTs with HS256 and keeps them short lived (15 minutes by default). Each token carries the user ID, role, and session ID, plus an issuer and audience. It is delivered only in the JSON response to `POST /auth/refresh`; the browser keeps it in memory and uses the `Authorization` header for API calls.

The refresh token is an independent 48-byte random secret and is never stored in plaintext. Its HMAC hash, expiry, `familyId`, consumption time, revocation time, and replacement ID provide a durable audit trail for rotation. Refresh tokens live for the surrounding session lifetime (30 days by default), are sent only as `httpOnly`, `Secure` in production, `SameSite=Lax` cookies scoped to `/auth`, and are cleared with the same scope on logout.

Refresh-token use runs in one Prisma transaction. The previous token is conditionally consumed before its replacement is created, so concurrent use cannot produce two valid descendants. A failed conditional update is treated as reuse: the service revokes the token family and its session. Authorization validates both the JWT and the current session row, making logout and refresh-token-reuse invalidation effective immediately even before a JWT expires.

This design is preferred over a single long-lived JWT because an independently revocable, rotated refresh token gives the server meaningful session control while keeping frequent API authorization lightweight. GitHub OAuth and explicit account linking remain later provider stages.

### Server-scoped session management

The sessions endpoints derive `userId` and the current session ID from the verified access token; the browser never submits a user ID. A selected session is revoked only through a query constrained by both its ID and the authenticated user. Refresh tokens are revoked in the same Prisma transaction only after that conditional session update succeeds, so a caller cannot invalidate another user's refresh tokens by guessing a session UUID.

`DELETE /sessions` also revokes refresh tokens through the `RefreshToken -> Session -> Account -> User` relation. This makes “log out from all devices” complete even for a browser that has not used its refresh token recently.

### Environment variables and secret boundaries

`.env.example` documents the required local configuration, while `.env` is ignored by Git. Database URLs, OAuth client secrets, cookie keys, and signing keys must remain server-only. In Next.js, only variables explicitly prefixed with `NEXT_PUBLIC_` may be exposed to browser code; no secret should use that prefix.

The Fastify CORS configuration allows credentialed requests only from the configured `WEB_ORIGIN`. It does not use `*`, because wildcard origins are incompatible with credentialed browser requests and would be too broad for cookie-based refresh tokens.

### CI as a branch-protection gate

GitHub Actions runs on pull requests and pushes to `main`. It uses a clean PostgreSQL service, applies the committed migration, validates Prisma, type-checks, runs tests, and creates production builds. Installation uses `--frozen-lockfile`, so an uncommitted dependency change fails the workflow.

The workflow grants only `contents: read`, cancels superseded runs for the same pull request, and has a ten-minute timeout. Configure the `Quality, tests and build` job as a required status check in GitHub branch protection rules before merging.

### Test strategy at the current stage

Repository tests use a mocked Prisma client to verify query shape and security filters quickly: for example, active-session lookups require the requesting user, refresh-token consumption requires a token that is unused, unrevoked, and unexpired, and all-device revocation is constrained by the owning user. Fastify tests cover the health endpoint, credentialed CORS configuration, OAuth transaction cookies, PKCE parameters, state mismatch rejection, callback handoff, identity-account resolution, refresh-cookie handling, Bearer-token middleware, and the three session-management endpoints.

The session-lifecycle and session-management services are tested with transactional Prisma doubles for token rotation, old-token reuse detection, current-session logout, individual-session ownership checks, and all-device revocation. The web dashboard is type-checked and production-built as part of the same quality gate. A later stage can add PostgreSQL integration tests and browser end-to-end tests around this flow.

## Continuous integration

The [`Verify` workflow](.github/workflows/ci.yml) runs for every pull request and for changes pushed to `main`. It starts a clean PostgreSQL service, applies migrations, then runs `pnpm ci:verify`.

To make it a merge gate, configure GitHub branch protection and require the `Quality, tests and build` job to pass.

## Current status

The application foundation, data model, repositories, initial migration, CI workflow, Google OIDC sign-in, rotating session tokens, profile dashboard, and session management are in place. The next small stages will add GitHub OAuth and explicit account linking.
