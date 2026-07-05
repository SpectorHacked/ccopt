/** Shared transcript upload — used by `ccopt sync` (batch) and `ccopt run` (per-run, from CI). */

import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

export interface UploadTarget {
  server: string;
  apiKey: string;
}

export interface UploadOutcome {
  ok: boolean;
  status: number;
  detail?: string;
}

export async function uploadSessionFile(
  target: UploadTarget,
  filePath: string,
  sessionId: string,
  agentId?: string,
): Promise<UploadOutcome> {
  const body = gzipSync(readFileSync(filePath));
  try {
    const res = await fetch(`${target.server.replace(/\/$/, '')}/api/v1/ingest`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${target.apiKey}`,
        'content-type': 'application/octet-stream',
        'content-encoding': 'gzip',
        'x-ccopt-session-id': sessionId,
        ...(agentId ? { 'x-ccopt-agent-id': agentId } : {}),
      },
      body,
    });
    return { ok: res.ok, status: res.status, detail: res.ok ? undefined : await res.text() };
  } catch (err) {
    return { ok: false, status: 0, detail: err instanceof Error ? err.message : String(err) };
  }
}
