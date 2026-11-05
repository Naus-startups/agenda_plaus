// The demo accounts all share a published password (see README / docker-compose.yml), so
// they must only ever exist in a local, throwaway database. The API image runs this on every
// start: in production, or against any database that isn't local (e.g. Neon, reached from a
// .env still set to development), it skips — successfully, so the server still starts.
// ALLOW_DEMO_SEED=true overrides that, for a staging database on purpose.
const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "db", "postgres", "host.docker.internal"]);

export function demoSeedAllowed(env: Record<string, string | undefined>): boolean {
  if (env.ALLOW_DEMO_SEED === "true") return true;
  if (env.NODE_ENV === "production") return false;
  try {
    return LOCAL_DATABASE_HOSTS.has(new URL(env.DATABASE_URL ?? "").hostname);
  } catch {
    return false;
  }
}
