import { SessionDashboard } from "../components/session-dashboard";

export const dynamic = "force-dynamic";

type ApiHealth = {
  status: string;
  service: string;
};

type HomePageProps = {
  searchParams: Promise<{ oauth?: string | string[] }>;
};

async function getApiHealth(): Promise<ApiHealth | null> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

  try {
    const response = await fetch(`${apiUrl}/health`, { cache: "no-store" });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as ApiHealth;
  } catch {
    return null;
  }
}

function getOAuthStatusMessage(oauth: string | string[] | undefined) {
  if (oauth === "google-complete") {
    return "Google identity verified and a browser session was started. The app can now exchange its refresh cookie for a short-lived access token.";
  }

  if (oauth === "google-denied") {
    return "Google sign-in was cancelled.";
  }

  if (oauth === "google-link-required") {
    return "This email already belongs to an account. Sign in first, then link Google from your profile.";
  }

  if (oauth === "google-failed") {
    return "Google sign-in could not be completed. Please start again.";
  }

  if (oauth === "github-complete") {
    return "GitHub identity verified and a browser session was started. The app can now exchange its refresh cookie for a short-lived access token.";
  }

  if (oauth === "github-denied") {
    return "GitHub sign-in was cancelled.";
  }

  if (oauth === "github-linked") {
    return "GitHub was linked to this account. You can now sign in with either provider.";
  }

  if (oauth === "github-link-denied") {
    return "GitHub account linking was cancelled.";
  }

  if (oauth === "github-link-required") {
    return "This email already belongs to an account. Sign in first, then link GitHub from your profile.";
  }

  if (oauth === "github-failed" || oauth === "github-link-failed") {
    return "GitHub verification could not be completed. Please start again.";
  }

  return null;
}

export default async function Home({ searchParams }: HomePageProps) {
  const apiHealth = await getApiHealth();
  const oauthStatus = getOAuthStatusMessage((await searchParams).oauth);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

  return <SessionDashboard apiHealth={apiHealth} apiUrl={apiUrl} oauthNotice={oauthStatus} />;
}
