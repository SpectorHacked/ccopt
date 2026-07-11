export const dynamic = 'force-dynamic';

/**
 * Liveness probe hit by `effigent doctor` (GET /healthz). Public, no auth, no
 * DB — it only confirms the collector is up and routing works. The deeper
 * "auth + DB" check is /api/v1/reports with a Bearer key.
 */
export function GET() {
  return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
}
