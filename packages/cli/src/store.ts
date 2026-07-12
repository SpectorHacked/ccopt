/**
 * Local run discovery. Primary source: Claude Code's own transcript store
 * (~/.claude/projects/**\/*.jsonl) — zero-install capture. `effigent run` adds an
 * agent-map so programmatic/CI sessions carry an explicit agentId.
 */

import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { parseTranscript, type Run } from '@effigent/core';

export const EFFIGENT_HOME = join(homedir(), '.effigent');
export const AGENT_MAP_PATH = join(EFFIGENT_HOME, 'agent-map.json');
/** Where `effigent run --isolated` preserves transcripts when not uploading. */
export const EFFIGENT_STORE = join(EFFIGENT_HOME, 'store');

export function defaultSource(): string {
  return join(homedir(), '.claude', 'projects');
}

/** Default scan roots: Claude Code's own store + effigent's isolated-run store. */
export function defaultSources(): string[] {
  return [defaultSource(), EFFIGENT_STORE];
}

/** Per-session tag files — one file per sessionId so concurrent `effigent run`
 *  wrappers never race on a shared JSON (last-writer-wins clobbering). */
export const AGENT_TAGS_DIR = join(EFFIGENT_HOME, 'agent-map.d');
export const CONFIG_PATH = join(EFFIGENT_HOME, 'config.json');

export interface AgentRule {
  /** Regex tested against the run's cwd. First match wins. */
  pattern: string;
  agent: string;
}

export interface CcoptConfig {
  server?: string;
  apiKey?: string;
  /** cwd-based attribution for agents that run in unpredictable dirs (temp clones, daemons). */
  agentRules?: AgentRule[];
  /** Registered agents and their scoped capture keys (from `effigent agent add`). */
  agents?: Record<string, { agentId: string; key: string; harness?: string }>;
}

export function loadConfig(): CcoptConfig {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as CcoptConfig;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveConfig(config: CcoptConfig): void {
  mkdirSync(EFFIGENT_HOME, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function agentFromRules(cwd: string | undefined, rules: AgentRule[] | undefined): string | undefined {
  if (!cwd || !rules) return undefined;
  for (const rule of rules) {
    try {
      if (new RegExp(rule.pattern).test(cwd)) return rule.agent;
    } catch {
      /* invalid pattern — skip */
    }
  }
  return undefined;
}

/** Sniff the cwd of a session by scanning its first lines (cheap, no full parse). */
export function sniffCwd(path: string, maxBytes = 65536): string | undefined {
  let head: string;
  try {
    const fd = openSync(path, 'r');
    const buf = Buffer.alloc(maxBytes);
    const n = readSync(fd, buf, 0, maxBytes, 0);
    closeSync(fd);
    head = buf.subarray(0, n).toString('utf8');
  } catch {
    return undefined;
  }
  for (const line of head.split('\n')) {
    const m = line.match(/"cwd":"([^"]+)"/);
    if (m) return m[1];
  }
  return undefined;
}

/**
 * The git repository a cwd belongs to, named by its top-level directory —
 * a project's stable, collision-resistant identity. Walks up to the first
 * `.git`. Returns undefined outside any repo (stray/home/temp dirs stay
 * unattributed, so they never upload under the privacy default).
 *
 * This is a far better default agent id than the cwd's leaf segment: two
 * unrelated projects that happen to share a folder name (`web`, `app`, or two
 * clones) no longer collapse into one agent. A monorepo holding several agents
 * is the one case this can't split on its own — use `agentRules` there.
 */
export function gitRepoName(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  let dir = cwd;
  for (let i = 0; i < 64; i++) {
    try {
      if (existsSync(join(dir, '.git'))) return basename(dir) || undefined;
    } catch {
      /* unreadable — keep walking up */
    }
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return undefined;
}

/**
 * Resolve a session's agentId without a full parse. Precedence:
 *   explicit tag (`effigent run`/`tag`)  >  cwd `agentRule`  >  git repo name.
 * The git-repo default means each project becomes its own agent automatically —
 * distinct agents no longer merge just because attribution wasn't configured.
 */
export function resolveAgentId(sessionId: string, path: string): string | undefined {
  const map = loadAgentMap();
  if (map[sessionId]) return map[sessionId];
  const cwd = sniffCwd(path);
  return agentFromRules(cwd, loadConfig().agentRules) ?? gitRepoName(cwd);
}

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
      else if (entry.isFile() && entry.name.endsWith('.jsonl') && !entry.name.startsWith('agent-')) {
        // agent-*.jsonl are subagent SIDECHAIN transcripts — fragments of a
        // parent session, never standalone runs. Syncing them pollutes both
        // the bucket and the analytics.
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
  const config = loadConfig();
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
    const cwd = sniffCwd(session.path);
    const run = parseTranscript(jsonl, {
      agentId:
        agentMap[session.sessionId] ??
        agentFromRules(cwd, config.agentRules) ??
        gitRepoName(cwd),
    });
    if (!run) continue;
    if (options.minSteps !== undefined && run.steps.length < options.minSteps) continue;
    if (options.agentFilter && !run.agentId.includes(options.agentFilter)) continue;
    runs.push(run);
  }
  return runs;
}
