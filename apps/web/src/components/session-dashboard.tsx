"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Profile = {
  session: { expiresAt: string; id: string };
  user: { email: string; id: string; name: string | null; role: string };
};

type Session = {
  createdAt: string;
  expiresAt: string;
  id: string;
  ipAddress: string | null;
  isCurrent: boolean;
  lastActivityAt: string;
  provider: string;
  userAgent: string | null;
};

type LinkedAccount = {
  createdAt: string;
  provider: string;
  providerEmail: string | null;
  providerEmailVerified: boolean;
};

type SessionDashboardProps = {
  apiHealth: { service: string; status: string } | null;
  apiUrl: string;
  oauthNotice: string | null;
};

type DashboardState =
  | { kind: "loading" }
  | { kind: "signed-out"; notice: string | null }
  | {
      accounts: LinkedAccount[];
      kind: "ready";
      notice: string | null;
      profile: Profile;
      sessions: Session[];
    }
  | { kind: "error"; message: string };

export function SessionDashboard({ apiHealth, apiUrl, oauthNotice }: SessionDashboardProps) {
  const accessToken = useRef<string | null>(null);
  const [state, setState] = useState<DashboardState>({ kind: "loading" });
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    const response = await fetch(`${apiUrl}/auth/refresh`, {
      credentials: "include",
      method: "POST"
    });

    if (response.status === 401) {
      accessToken.current = null;
      return null;
    }

    ensureSuccessfulResponse(response, "The API could not refresh the browser session.");

    const payload = (await response.json()) as { accessToken: string };
    accessToken.current = payload.accessToken;
    return payload.accessToken;
  }, [apiUrl]);

  const authenticatedFetch = useCallback(
    async (path: string, init: RequestInit = {}): Promise<Response | null> => {
      const send = (token: string) =>
        fetch(`${apiUrl}${path}`, {
          ...init,
          credentials: "include",
          headers: { ...init.headers, authorization: `Bearer ${token}` }
        });

      let token = accessToken.current ?? (await refreshAccessToken());

      if (!token) {
        return null;
      }

      let response = await send(token);

      if (response.status !== 401) {
        return response;
      }

      token = await refreshAccessToken();

      return token ? send(token) : null;
    },
    [apiUrl, refreshAccessToken]
  );

  const loadDashboard = useCallback(async () => {
    setState({ kind: "loading" });

    try {
      const token = await refreshAccessToken();

      if (!token) {
        setState({ kind: "signed-out", notice: oauthNotice });
        return;
      }

      const [profileResponse, sessionsResponse, accountsResponse] = await Promise.all([
        authenticatedFetch("/auth/me"),
        authenticatedFetch("/sessions"),
        authenticatedFetch("/accounts")
      ]);

      if (!profileResponse || !sessionsResponse || !accountsResponse) {
        setState({ kind: "signed-out", notice: "Your session expired. Please sign in again." });
        return;
      }

      ensureSuccessfulResponse(profileResponse, "The API could not load your profile.");
      ensureSuccessfulResponse(sessionsResponse, "The API could not load your sessions.");
      ensureSuccessfulResponse(accountsResponse, "The API could not load your connected accounts.");

      const profile = (await profileResponse.json()) as Profile;
      const sessionsPayload = (await sessionsResponse.json()) as { sessions: Session[] };
      const accountsPayload = (await accountsResponse.json()) as { accounts: LinkedAccount[] };
      setState({
        accounts: accountsPayload.accounts,
        kind: "ready",
        notice: oauthNotice,
        profile,
        sessions: sessionsPayload.sessions
      });
    } catch (error) {
      setState({ kind: "error", message: getErrorMessage(error) });
    }
  }, [authenticatedFetch, oauthNotice, refreshAccessToken]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  async function revokeSession(session: Session) {
    setBusyAction(session.id);

    try {
      const response = await authenticatedFetch(`/sessions/${encodeURIComponent(session.id)}`, {
        method: "DELETE"
      });

      if (!response) {
        setState({ kind: "signed-out", notice: "Your session expired. Please sign in again." });
        return;
      }

      if (response.status === 404) {
        await loadDashboard();
        return;
      }

      ensureSuccessfulResponse(response, "The API could not revoke this session.");

      if (session.isCurrent) {
        accessToken.current = null;
        setState({ kind: "signed-out", notice: "This device was signed out." });
        return;
      }

      await loadDashboard();
    } catch (error) {
      setState({ kind: "error", message: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  }

  async function revokeAllSessions() {
    setBusyAction("all");

    try {
      const response = await authenticatedFetch("/sessions", { method: "DELETE" });

      if (!response) {
        setState({ kind: "signed-out", notice: "Your session expired. Please sign in again." });
        return;
      }

      ensureSuccessfulResponse(response, "The API could not revoke your sessions.");

      accessToken.current = null;
      setState({ kind: "signed-out", notice: "You were signed out from all devices." });
    } catch (error) {
      setState({ kind: "error", message: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  }

  async function linkGitHubAccount() {
    setBusyAction("github-link");

    try {
      const response = await authenticatedFetch("/auth/github/link", { method: "POST" });

      if (!response) {
        setState({ kind: "signed-out", notice: "Your session expired. Please sign in again." });
        return;
      }

      ensureSuccessfulResponse(response, "The API could not start GitHub account linking.");

      const { authorizationUrl } = (await response.json()) as { authorizationUrl: string };
      window.location.assign(authorizationUrl);
    } catch (error) {
      setState({ kind: "error", message: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  }

  if (state.kind === "loading") {
    return <LoadingPanel apiHealth={apiHealth} />;
  }

  if (state.kind === "error") {
    return <ErrorPanel apiHealth={apiHealth} message={state.message} onRetry={loadDashboard} />;
  }

  if (state.kind === "signed-out") {
    return <SignedOutPanel apiHealth={apiHealth} apiUrl={apiUrl} notice={state.notice} />;
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Authentication lifecycle lab</p>
          <h1>Profile &amp; sessions</h1>
        </div>
        <ApiHealth apiHealth={apiHealth} />
      </header>

      {state.notice ? <p className="notice">{state.notice}</p> : null}

      <section className="profile-card" aria-labelledby="profile-heading">
        <div>
          <p className="eyebrow">Profile</p>
          <h2 id="profile-heading">{state.profile.user.name ?? state.profile.user.email}</h2>
          <p className="profile-email">{state.profile.user.email}</p>
        </div>
        <dl className="profile-details">
          <div>
            <dt>Role</dt>
            <dd>{state.profile.user.role}</dd>
          </div>
          <div>
            <dt>Current session</dt>
            <dd className="monospace">{shortId(state.profile.session.id)}</dd>
          </div>
          <div>
            <dt>Session expiry</dt>
            <dd>{formatDate(state.profile.session.expiresAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="connections-card" aria-labelledby="connections-heading">
        <div>
          <p className="eyebrow">Connected accounts</p>
          <h2 id="connections-heading">Sign-in methods</h2>
          <p>Link another verified provider identity without creating a second user.</p>
        </div>
        <div className="connections-actions">
          <ul className="connections-list">
            {state.accounts.map((account) => (
              <li key={account.provider}>
                <span className="provider-badge">{formatProvider(account.provider)}</span>
                <span>{account.providerEmail ?? "Email unavailable"}</span>
                <span className="connection-status">
                  {account.providerEmailVerified ? "Verified" : "Unverified"}
                </span>
              </li>
            ))}
          </ul>
          <button
            className="button button--github"
            disabled={busyAction !== null || hasProvider(state.accounts, "GITHUB")}
            onClick={() => void linkGitHubAccount()}
            type="button"
          >
            {hasProvider(state.accounts, "GITHUB")
              ? "GitHub connected"
              : busyAction === "github-link"
                ? "Opening GitHub…"
                : "Connect GitHub"}
          </button>
        </div>
      </section>

      <section className="sessions-card" aria-labelledby="sessions-heading">
        <div className="sessions-heading">
          <div>
            <p className="eyebrow">Sessions</p>
            <h2 id="sessions-heading">Active devices</h2>
            <p>{state.sessions.length} active {state.sessions.length === 1 ? "session" : "sessions"}</p>
          </div>
          <button
            className="button button--danger"
            disabled={busyAction !== null}
            onClick={() => void revokeAllSessions()}
            type="button"
          >
            {busyAction === "all" ? "Signing out…" : "Log out from all devices"}
          </button>
        </div>

        <div className="sessions-list">
          {state.sessions.map((session) => (
            <article className="session-row" key={session.id}>
              <div className="session-provider">
                <span className="provider-badge">{formatProvider(session.provider)}</span>
                {session.isCurrent ? <span className="current-badge">This device</span> : null}
              </div>
              <div className="session-device">
                <strong>{session.userAgent ?? "Unknown device"}</strong>
                <span>{session.ipAddress ?? "IP address unavailable"}</span>
              </div>
              <dl className="session-dates">
                <div>
                  <dt>Created</dt>
                  <dd>{formatDate(session.createdAt)}</dd>
                </div>
                <div>
                  <dt>Last active</dt>
                  <dd>{formatDate(session.lastActivityAt)}</dd>
                </div>
                <div>
                  <dt>Expires</dt>
                  <dd>{formatDate(session.expiresAt)}</dd>
                </div>
              </dl>
              <button
                className="button button--secondary"
                disabled={busyAction !== null}
                onClick={() => void revokeSession(session)}
                type="button"
              >
                {busyAction === session.id
                  ? "Signing out…"
                  : session.isCurrent
                    ? "Log out this device"
                    : "Log out"}
              </button>
            </article>
          ))}
        </div>

        <p className="session-security-note">
          Access tokens stay only in this tab&apos;s memory. Refresh tokens are kept in an httpOnly
          cookie and are revoked with each session.
        </p>
      </section>
    </main>
  );
}

function SignedOutPanel({
  apiHealth,
  apiUrl,
  notice
}: {
  apiHealth: SessionDashboardProps["apiHealth"];
  apiUrl: string;
  notice: string | null;
}) {
  return (
    <main className="centered-shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Authentication lifecycle lab</p>
        <h1 id="page-title">auth-lab</h1>
        <p className="intro">
          Inspect how OAuth, token rotation, and session controls work together—one deliberately
          small step at a time.
        </p>
        <div className="sign-in-actions">
          <a className="button button--google" href={`${apiUrl}/auth/google`}>
            Continue with Google
          </a>
          <a className="button button--github" href={`${apiUrl}/auth/github`}>
            Continue with GitHub
          </a>
        </div>
        {notice ? <p className="notice">{notice}</p> : null}
        <ApiHealth apiHealth={apiHealth} />
      </section>
    </main>
  );
}

function LoadingPanel({ apiHealth }: { apiHealth: SessionDashboardProps["apiHealth"] }) {
  return (
    <main className="centered-shell">
      <section className="hero" aria-live="polite">
        <p className="eyebrow">Authentication lifecycle lab</p>
        <h1>Restoring session</h1>
        <p className="intro">Exchanging the secure refresh cookie for an in-memory access token…</p>
        <ApiHealth apiHealth={apiHealth} />
      </section>
    </main>
  );
}

function ErrorPanel({
  apiHealth,
  message,
  onRetry
}: {
  apiHealth: SessionDashboardProps["apiHealth"];
  message: string;
  onRetry: () => Promise<void>;
}) {
  return (
    <main className="centered-shell">
      <section className="hero" aria-live="polite">
        <p className="eyebrow">Authentication lifecycle lab</p>
        <h1>Couldn&apos;t load the session</h1>
        <p className="notice notice--error">{message}</p>
        <button className="button button--secondary" onClick={() => void onRetry()} type="button">
          Try again
        </button>
        <ApiHealth apiHealth={apiHealth} />
      </section>
    </main>
  );
}

function ApiHealth({ apiHealth }: { apiHealth: SessionDashboardProps["apiHealth"] }) {
  return (
    <div className={`api-health ${apiHealth ? "api-health--ready" : "api-health--waiting"}`}>
      <span aria-hidden="true" className="status-dot" />
      <div>
        <span>Fastify API</span>
        <strong>{apiHealth ? `${apiHealth.service}: ${apiHealth.status}` : "waiting for a connection"}</strong>
      </div>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatProvider(provider: string): string {
  return provider.charAt(0) + provider.slice(1).toLowerCase();
}

function hasProvider(accounts: LinkedAccount[], provider: string): boolean {
  return accounts.some((account) => account.provider === provider);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

function ensureSuccessfulResponse(response: Response, message: string): void {
  if (!response.ok) {
    throw new Error(message);
  }
}

function shortId(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}
