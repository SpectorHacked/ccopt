/**
 * Local run discovery. Primary source: Claude Code's own transcript store
 * (~/.claude/projects/**\/*.jsonl) — zero-install capture. `ccopt run` adds an
 * agent-map so programmatic/CI sessions carry an explicit agentId.
 */

import { mkdirSync, readdirSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseTranscript, type Run } from '@ccopt/core';

export const CCOPT_HOME = join(homedir(), '.ccopt');
export const AGENT_MAP_PATH = join(CCOPT_HOME, 'agent-map.json');
/** Where `ccopt run --isolated` preserves transcripts when not uploading. */
export const CCOPT_STORE = join(CCOPT_HOME, 'store');

export function defaultSource(): string {
  return join(homedir(), '.claude', 'projects');
}

/** Default scan roots: Claude Code's own store + ccopt's isolated-run store. */
export function defaultSources(): string[] {
  return [defaultSource(), CCOPT_STORE];
}

/** Per-session tag files — one file per sessionId so concurrent `ccopt run`
 *  wrappers never race on a shared JSON (last-writer-wins clobbering). */
export const AGENT_TAGS_DIR = join(CCOPT_HOME, 'agent-map.d');

export function loadAgentMap(): Record<string, string> {
  const map: Record<string, string> = {};
  try {
    Object.assign(map, JSON.parse(readFileSync(AGENT_MAP_PATH, 'utf8')) as Record<string, string>);
  } catch {
    /* legacy map absent */
  }
  try {
    for (const f of readdirSync(AGENT_TAGS_DIR)) {
      try {
        map[f] = readFileSync(join(AGENT_TAGS_DIR, f), 'utf8').trim();
      } catch {
        /* skip unreadable tag */
      }
    }
  } catch {
    /* tags dir absent */
  }
  return map;
}

/** Race-free tagging: one atomic file write per session. */
export function tagSessions(sessionIds: string[], agentId: string): void {
  mkdirSync(AGENT_TAGS_DIR, { recursive: true });
  for (const id of sessionIds) {
    if (!/^[\w-]+$/.test(id)) continue; // session ids are uuids; refuse path tricks
    writeFileSync(join(AGENT_TAGS_DIR, id), agentId);
  }
}

export interface DiscoveredSession {
  path: string;
  sessionId: string;
  mtimeMs: number;
}

export function discoverSessions(sourceDir: string): DiscoveredSession[] {
  const out: DiscoveredSession[] = [];
  if (!existsSync(sourceDir)) return out;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        out.push({
          path: p,
          sessionId: entry.name.replace(/\.jsonl$/, ''),
          mtimeMs: statSync(p).mtimeMs,
        });
      }
    }
  };
  walk(sourceDir);
  return out;
}

export interface LoadOptions {
  sinceDays?: number;
  agentFilter?: string;
  minSteps?: number;
}

export function loadRuns(sourceDirs: string | string[], options: LoadOptions = {}): Run[] {
  const dirs = Array.isArray(sourceDirs) ? sourceDirs : [sourceDirs];
  const agentMap = loadAgentMap();
  const cutoff =
    options.sinceDays !== undefined ? Date.now() - options.sinceDays * 86_400_000 : undefined;
  const runs: Run[] = [];
  const seenSessions = new Set<string>();
  for (const session of dirs.flatMap(discoverSessions)) {
    if (seenSessions.has(session.sessionId)) continue;
    seenSessions.add(session.sessionId);
    if (cutoff !== undefined && session.mtimeMs < cutoff) continue;
    let jsonl: string;
    try {
      jsonl = readFileSync(session.path, 'utf8');
    } catch {
      continue;
    }
    const run = parseTranscript(jsonl, { agentId: agentMap[session.sessionId] });
    if (!run) continue;
    if (options.minSteps !== undefined && run.steps.length < options.minSteps) continue;
    if (options.agentFilter && !run.agentId.includes(options.agentFilter)) continue;
    runs.push(run);
  }
  return runs;
}
