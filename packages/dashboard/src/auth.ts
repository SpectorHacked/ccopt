/** Multi-tenant auth: the tenant's ccopt API key, kept in localStorage and sent
 *  as a Bearer token. `server` may be blank to use the same origin (e.g. when the
 *  API is fronted by the same CloudFront distribution under /api). */

export interface Auth {
  server: string;
  key: string;
  tenant?: string;
}

const LS_KEY = 'ccopt.auth';

export function loadAuth(): Auth | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Auth;
    return a && typeof a.key === 'string' ? a : null;
  } catch {
    return null;
  }
}

export function saveAuth(a: Auth): void {
  localStorage.setItem(LS_KEY, JSON.stringify(a));
}

export function clearAuth(): void {
  localStorage.removeItem(LS_KEY);
}

const base = (server: string) => server.replace(/\/$/, '');

/** Verify the key against the tenant reports endpoint. Returns true on HTTP 200. */
export async function verifyKey(a: Auth): Promise<boolean> {
  try {
    const res = await fetch(`${base(a.server)}/api/v1/reports`, {
      headers: { authorization: `Bearer ${a.key}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The tenant's registered/observed agents (agent_id strings), most-costly first. */
export async function fetchAgents(a: Auth): Promise<string[]> {
  try {
    const res = await fetch(`${base(a.server)}/api/v1/agents`, {
      headers: { authorization: `Bearer ${a.key}` },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { agents?: Array<{ agent_id: string }> };
    return (json.agents ?? []).map((x) => x.agent_id).filter(Boolean);
  } catch {
    return [];
  }
}
