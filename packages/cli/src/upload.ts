/** Shared transcript upload — used by `effigent sync` (batch) and `effigent run` (per-run, from CI). */

import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { parseTranscript, type Run } from '@ccopt/core';

export interface UploadTarget {
  server: string;
  apiKey: string;
}

export interface UploadOutcome {
  ok: boolean;
  status: number;
  detail?: string;
}

/** Hosted collectors cap request bodies (~4.5 MB on Vercel). Above this we
 *  parse locally and ship the compact Run instead of the raw transcript. */
const MAX_BODY_BYTES = 3_500_000;

/** Shrink a Run until its JSON fits the body cap: progressively shorter step
 *  payloads, then head+tail step sampling as a last resort. */
function shrinkToFit(run: Run): { json: string; truncated: boolean } {
  let truncated = false;
  for (const cap of [4000, 2000, 1000, 500]) {
    const shrunk: Run = { ...run, steps: run.steps.map((s) => ({ ...s, payload: s.payload.slice(0, cap) })) };
    const json = JSON.stringify(shrunk);
    if (Buffer.byteLength(json) <= MAX_BODY_BYTES) return { json, truncated };
    truncated = true;
  }
  // Enormous step count: keep the first/last 800 steps (shape head + outcome).
  const head = run.steps.slice(0, 800).map((s) => ({ ...s, payload: s.payload.slice(0, 500) }));
  const tail = run.steps.slice(-800).map((s) => ({ ...s, payload: s.payload.slice(0, 500) }));
  const sampled: Run = { ...run, steps: [...head, ...tail] };
  return { json: JSON.stringify(sampled), truncated: true };
}

export async function uploadSessionFile(
  target: UploadTarget,
  filePath: string,
  sessionId: string,
  agentId?: string,
): Promise<UploadOutcome> {
  const raw = readFileSync(filePath);
  const gz = gzipSync(raw);
  const base = target.server.replace(/\/$/, '');
  const authHeaders = {
    authorization: `Bearer ${target.apiKey}`,
    'x-ccopt-session-id': sessionId,
    ...(agentId ? { 'x-ccopt-agent-id': agentId } : {}),
  };

  try {
    // Large session: parse locally, upload the compact Run (server redacts + persists
    // through the same choke point).
    if (gz.length > MAX_BODY_BYTES) {
      const run = parseTranscript(raw.toString('utf8'), { agentId });
      if (!run) return { ok: false, status: 0, detail: 'transcript too large and not parseable locally' };
      const { json, truncated } = shrinkToFit(run);
      const res = await fetch(`${base}/api/v1/ingest`, {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json', 'x-ccopt-format': 'run' },
        body: json,
      });
      return {
        ok: res.ok,
        status: res.status,
        detail: res.ok ? (truncated ? 'large session — step payloads trimmed locally' : undefined) : await res.text(),
      };
    }

    const res = await fetch(`${base}/api/v1/ingest`, {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/octet-stream', 'content-encoding': 'gzip' },
      body: gz,
    });
    return { ok: res.ok, status: res.status, detail: res.ok ? undefined : await res.text() };
  } catch (err) {
    return { ok: false, status: 0, detail: err instanceof Error ? err.message : String(err) };
  }
}
