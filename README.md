# auth-lab

Mały panel demonstracyjny pokazujący bezpieczny lifecycle sesji użytkownika: OAuth 2.0/OIDC, krótkie JWT, rotowane refresh tokeny i zarządzanie aktywnymi sesjami.

## Struktura

```
apps/
  api/        Fastify API
  web/        Next.js frontend
packages/
  database/   Prisma schema i konfiguracja bazy
```

## Wymagania

- Node.js 22+
- pnpm 11+
- Docker Desktop z uruchomionym silnikiem Docker

## Pierwsze uruchomienie

1. Skopiuj konfigurację: `Copy-Item .env.example .env`.
2. Uruchom PostgreSQL: `docker compose up -d postgres`.
3. Zainstaluj zależności: `pnpm install`.
4. Uruchom oba serwisy: `pnpm dev`.

Następnie otwórz [http://localhost:3000](http://localhost:3000). API udostępnia healthcheck pod [http://localhost:3001/health](http://localhost:3001/health).

## Polecenia

- `pnpm dev` — Next.js i Fastify równolegle.
- `pnpm build` — produkcyjny build obu aplikacji.
- `pnpm typecheck` — sprawdzenie typów TypeScript.
- `pnpm test` — testy API.
- `pnpm db:validate` — walidacja konfiguracji Prisma.

Model danych, OAuth i endpointy sesji będą dodawane w kolejnych etapach, aby każdy commit pozostał mały i łatwy do przejrzenia.
