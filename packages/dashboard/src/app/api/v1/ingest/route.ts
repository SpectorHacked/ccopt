import { gunzipSync } from 'node:zlib';
import { authenticateKey, persistRun } from '@/lib/agent-auth.ts';
import { parseTranscript } from '@/lib/engine/transcript.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Transcript ingest (Claude Code SessionEnd hook / `ccopt run` / `ccopt sync`).
 * Bearer cck_ key; gzipped (or plain) JSONL body; session id via header.
 * Note: request bodies are capped (~4.5 MB on Vercel) — transcripts are gzipped
 * by the CLI, which keeps almost all sessions well under it.
 */
export async function POST(req: Request) {
  const auth = await authenticateKey(req.headers.get('authorization'));
  if (!auth) return Response.json({ error: 'invalid API key' }, { status: 401 });

  const sessionId = req.headers.get('x-ccopt-session-id') ?? '';
  if (!sessionId) return Response.json({ error: 'x-ccopt-session-id header required' }, { status: 400 });
  const agentIdHeader = req.headers.get('x-ccopt-agent-id') ?? undefined;

  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length === 0) return Response.json({ error: 'binary body required' }, { status: 400 });

  let jsonl: string;
  try {
    // Vercel may strip content-encoding; sniff the gzip magic bytes instead.
    const isGzip = raw[0] === 0x1f && raw[1] === 0x8b;
    jsonl = (isGzip ? gunzipSync(raw) : raw).toString('utf8');
  } catch {
    return Response.json({ error: 'failed to decompress body' }, { status: 400 });
  }

  // A scoped agent key binds attribution to its agent — it wins over the
  // client-supplied header (a leaked key must not be able to spoof another agent).
  const effectiveAgentId = auth.agentName ?? agentIdHeader;

  const run = parseTranscript(jsonl, { agentId: effectiveAgentId });
  if (!run) return Response.json({ parsed: false, reason: 'no assistant activity' }, { status: 202 });

  await persistRun(auth, sessionId, run);
  return Response.json({ parsed: true, agentId: run.agentId, costUsd: run.costUsd });
}
