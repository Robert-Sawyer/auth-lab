export const dynamic = "force-dynamic";

type ApiHealth = {
  status: string;
  service: string;
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

export default async function Home() {
  const apiHealth = await getApiHealth();

  return (
    <main>
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Authentication lifecycle lab</p>
        <h1 id="page-title">auth-lab</h1>
        <p className="intro">
          Fundament aplikacji jest gotowy. W kolejnych etapach dodamy OAuth, tokeny i zarządzanie sesjami.
        </p>

        <div className={`status ${apiHealth ? "status--ready" : "status--waiting"}`}>
          <span aria-hidden="true" className="status-dot" />
          <div>
            <p>Fastify API</p>
            <strong>{apiHealth ? `${apiHealth.service}: ${apiHealth.status}` : "oczekuje na połączenie"}</strong>
          </div>
        </div>
      </section>
    </main>
  );
}
