#!/usr/bin/env node
/**
 * ccopt — The Agent Waste Report CLI.
 *
 *   ccopt analyze   local-only mode: engine + report on your own transcripts
 *   ccopt sync      upload session transcripts to the hosted service
 *   ccopt run       headless wrapper tagging a Claude Code run with an agentId
 */

import { Command } from 'commander';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { analyzeRuns, renderReportHtml } from '@ccopt/core';
import {
  CCOPT_HOME,
  CCOPT_STORE,
  defaultSource,
  defaultSources,
  discoverSessions,
  loadAgentMap,
  loadRuns,
  tagSessions,
} from './store.js';
import { uploadSessionFile } from './upload.js';

const program = new Command();
program.name('ccopt').description('ccopt — graph-based agent waste detection').version('0.1.0');

program
  .command('analyze')
  .description('Analyze local Claude Code transcripts and render the Waste Report')
  .option('--source <dir...>', 'transcript directories', defaultSources())
  .option('--days <n>', 'analysis window in days', '30')
  .option('--agent <substr>', 'only include agents whose id contains this substring')
  .option('--min-steps <n>', 'ignore trivial sessions with fewer steps', '3')
  .option('--out <file>', 'HTML report output path', 'ccopt-report.html')
  .option('--json <file>', 'JSON report output path', 'ccopt-report.json')
  .action((opts) => {
    const sources: string[] = Array.isArray(opts.source) ? opts.source : [opts.source];
    const runs = loadRuns(sources.map((s: string) => resolve(s)), {
      sinceDays: Number(opts.days),
      agentFilter: opts.agent,
      minSteps: Number(opts.minSteps),
    });
    if (runs.length === 0) {
      console.error(`No runs found under ${opts.source} in the last ${opts.days} day(s).`);
      process.exitCode = 1;
      return;
    }
    const { report } = analyzeRuns(runs);
    writeFileSync(resolve(opts.out), renderReportHtml(report));
    writeFileSync(resolve(opts.json), JSON.stringify(report, null, 2));
    const total = report.totals;
    console.log(`Analyzed ${total.runs} runs across ${report.agentIds.length} agent(s).`);
    console.log(
      `Observed spend $${total.costUsd} (~$${total.estMonthlyCostUsd}/mo) · ` +
        `${Math.round(total.clusteredRunRatio * 100)}% of runs repeat a known shape · ` +
        `cache-read ratio ${Math.round(total.cacheReadRatio * 100)}%`,
    );
    for (const [i, f] of report.findings.entries()) {
      console.log(`  #${i + 1} [${f.kind}] $${f.estMonthlySavingUsd}/mo — ${f.title}`);
    }
    console.log(`Report: ${resolve(opts.out)}`);
  });

program
  .command('sync')
  .description('Upload local session transcripts to the ccopt service')
  .requiredOption('--server <url>', 'ccopt server base URL')
  .requiredOption('--key <apiKey>', 'tenant API key')
  .option('--source <dir...>', 'transcript directories', defaultSources())
  .option('--days <n>', 'only sync sessions modified in the last N days', '30')
  .action(async (opts) => {
    const agentMap = loadAgentMap();
    const cutoff = Date.now() - Number(opts.days) * 86_400_000;
    const sourceDirs: string[] = Array.isArray(opts.source) ? opts.source : [opts.source];
    const seen = new Set<string>();
    const sessions = sourceDirs
      .flatMap((d: string) => discoverSessions(resolve(d)))
      .filter((s) => s.mtimeMs >= cutoff)
      .filter((s) => (seen.has(s.sessionId) ? false : (seen.add(s.sessionId), true)));
    if (sessions.length === 0) {
      console.error('Nothing to sync.');
      return;
    }
    const statePath = `${CCOPT_HOME}/sync-state.json`;
    let state: Record<string, number> = {};
    try {
      state = JSON.parse(readFileSync(statePath, 'utf8'));
    } catch {
      /* first sync */
    }
    let uploaded = 0;
    let skipped = 0;
    for (const s of sessions) {
      if (state[s.sessionId] && state[s.sessionId] >= s.mtimeMs) {
        skipped++;
        continue;
      }
      const r = await uploadSessionFile(
        { server: opts.server, apiKey: opts.key },
        s.path,
        s.sessionId,
        agentMap[s.sessionId],
      );
      if (!r.ok) {
        console.error(`  ✗ ${s.sessionId}: HTTP ${r.status} ${r.detail ?? ''}`);
        continue;
      }
      state[s.sessionId] = s.mtimeMs;
      uploaded++;
    }
    mkdirSync(CCOPT_HOME, { recursive: true });
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    console.log(`Synced ${uploaded} session(s), ${skipped} already up to date.`);
  });

program
  .command('doctor')
  .description('Check that ccopt can capture, attribute, and (optionally) upload on this machine')
  .option('--server <url>', 'ccopt server to check (env CCOPT_SERVER)')
  .option('--key <apiKey>', 'tenant API key to verify (env CCOPT_API_KEY)')
  .action(async (opts) => {
    let failures = 0;
    const ok = (msg: string) => console.log(`  ✓ ${msg}`);
    const warn = (msg: string) => console.log(`  ! ${msg}`);
    const bad = (msg: string) => {
      console.log(`  ✗ ${msg}`);
      failures++;
    };

    console.log('ccopt doctor\n');

    const major = Number(process.versions.node.split('.')[0]);
    major >= 20 ? ok(`node ${process.versions.node}`) : bad(`node ${process.versions.node} — need ≥ 20`);

    const claudeBin = spawnSync('claude', ['--version'], { encoding: 'utf8' });
    claudeBin.status === 0
      ? ok(`claude CLI ${claudeBin.stdout.trim()}`)
      : warn('claude CLI not on PATH (fine if your agent bundles the Agent SDK)');

    for (const src of defaultSources()) {
      if (!existsSync(src)) {
        warn(`no transcript store at ${src} yet (created on first agent run)`);
        continue;
      }
      const sessions = discoverSessions(src);
      const recent = sessions.filter((s) => Date.now() - s.mtimeMs < 30 * 86_400_000);
      ok(`${src}: ${sessions.length} session(s), ${recent.length} in the last 30 days`);
    }

    const runs = loadRuns(defaultSources(), { sinceDays: 30, minSteps: 1 });
    runs.length > 0
      ? ok(`${runs.length} run(s) parse cleanly (${[...new Set(runs.map((r) => r.agentId))].length} agent id(s))`)
      : warn('no parseable runs in the last 30 days — run any Claude Code/Agent SDK agent first');

    const tags = Object.keys(loadAgentMap()).length;
    tags > 0
      ? ok(`${tags} session(s) explicitly attributed via ccopt run/tag`)
      : warn('no explicit attributions yet — untagged runs fall back to their directory name');

    if (process.env.ANTHROPIC_API_KEY) ok('env auth: ANTHROPIC_API_KEY set (--isolated will work)');
    else if (process.env.CLAUDE_CODE_USE_BEDROCK || process.env.CLAUDE_CODE_USE_VERTEX)
      ok('env auth: Bedrock/Vertex configured (--isolated will work)');
    else
      warn(
        'no env-based auth detected — `ccopt run --isolated` needs ANTHROPIC_API_KEY (or Bedrock/Vertex); ' +
          'non-isolated capture works regardless',
      );

    const server: string | undefined = opts.server ?? process.env.CCOPT_SERVER;
    const apiKey: string | undefined = opts.key ?? process.env.CCOPT_API_KEY;
    if (server) {
      try {
        const health = await fetch(`${server.replace(/\/$/, '')}/healthz`);
        health.ok ? ok(`server reachable: ${server}`) : bad(`server unhealthy: HTTP ${health.status}`);
        if (apiKey) {
          const auth = await fetch(`${server.replace(/\/$/, '')}/api/v1/reports`, {
            headers: { authorization: `Bearer ${apiKey}` },
          });
          auth.ok ? ok('API key accepted') : bad(`API key rejected: HTTP ${auth.status}`);
        } else {
          warn('no API key provided — skipping auth check (set CCOPT_API_KEY)');
        }
      } catch (err) {
        bad(`cannot reach ${server}: ${err instanceof Error ? err.message : err}`);
      }
    } else {
      warn('no server configured — local-only mode (set CCOPT_SERVER to check upload path)');
    }

    console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
    process.exitCode = failures === 0 ? 0 : 1;
  });

program
  .command('tag')
  .description('Attribute existing session(s) to a logical agentId (for external harnesses)')
  .requiredOption('--agent <id>', 'logical agent id')
  .argument('<sessionId...>', 'Claude Code session id(s) to tag')
  .action((sessionIds: string[], opts) => {
    tagSessions(sessionIds, opts.agent);
    console.log(`Tagged ${sessionIds.length} session(s) as ${opts.agent}`);
  });

program
  .command('run')
  .description(
    'Run ANY agent command tagged with an agentId (for CI/cron). Standalone: no changes ' +
      'to the wrapped agent — sessions written during the run are attributed and, with ' +
      '--server, uploaded straight from the runner (ephemeral-machine safe).',
  )
  .requiredOption('--agent <id>', 'logical agent id for this run')
  .option('--source <dir>', 'transcript directory to watch (non-isolated mode)', defaultSource())
  .option(
    '--isolated',
    'run with a private CLAUDE_CONFIG_DIR: exact attribution, safe for concurrent agents. ' +
      'Requires env-based auth (ANTHROPIC_API_KEY / Bedrock / Vertex) or file-based credentials; ' +
      'macOS keychain logins do not carry over.',
  )
  .option('--server <url>', 'ccopt server to upload captured sessions to (env CCOPT_SERVER)')
  .option('--key <apiKey>', 'tenant API key for --server (env CCOPT_API_KEY)')
  .allowUnknownOption(true)
  .argument('<cmd...>', 'command to execute, e.g. -- claude -p "…" or -- node my-agent.js')
  .action(async (cmd: string[], opts) => {
    const argv = [...cmd];
    const server: string | undefined = opts.server ?? process.env.CCOPT_SERVER;
    const apiKey: string | undefined = opts.key ?? process.env.CCOPT_API_KEY;
    if (server && !apiKey) {
      console.error('[ccopt] --server requires --key (or CCOPT_API_KEY)');
      process.exitCode = 2;
      return;
    }

    // Precise path: direct `claude` invocations get a known --session-id up front.
    const preTagged: string[] = [];
    if (argv[0] === 'claude' && !argv.includes('--session-id')) {
      const sessionId = randomUUID();
      argv.splice(1, 0, '--session-id', sessionId);
      preTagged.push(sessionId);
    }

    const env = { ...process.env };
    let watchDir: string;
    let isoDir: string | undefined;
    if (opts.isolated) {
      // Private transcript store per run — exact attribution, concurrency-safe.
      isoDir = mkdtempSync(join(tmpdir(), 'ccopt-run-'));
      env.CLAUDE_CONFIG_DIR = isoDir;
      // Carry over file-based credentials/state when present (Linux/CI).
      for (const f of ['.credentials.json']) {
        const src = join(homedir(), '.claude', f);
        if (existsSync(src)) copyFileSync(src, join(isoDir, f));
      }
      const stateFile = join(homedir(), '.claude.json');
      if (existsSync(stateFile)) copyFileSync(stateFile, join(isoDir, '.claude.json'));
      watchDir = join(isoDir, 'projects');
    } else {
      watchDir = resolve(opts.source);
    }

    // Snapshot → run → diff. In isolated mode the diff is exact; in shared mode,
    // concurrent sessions on this machine during the window are attributed too.
    const before = new Map(discoverSessions(watchDir).map((s) => [s.path, s.mtimeMs]));
    console.error(`[ccopt] agent=${opts.agent}${opts.isolated ? ' isolated' : ''} watching=${watchDir}`);
    const res = spawnSync(argv[0], argv.slice(1), { stdio: 'inherit', env });

    const produced = discoverSessions(watchDir).filter((s) => {
      const prev = before.get(s.path);
      return prev === undefined || s.mtimeMs > prev;
    });
    const sessionIds = [...new Set([...preTagged, ...produced.map((s) => s.sessionId)])];

    // Local attribution for `ccopt analyze`/`ccopt sync` on this machine.
    // Per-session tag files — safe under concurrent wrappers.
    if (sessionIds.length > 0) tagSessions(sessionIds, opts.agent);

    // Cloud path: push transcripts off the (possibly ephemeral) machine now.
    if (server && apiKey) {
      let ok = 0;
      for (const s of produced) {
        const r = await uploadSessionFile({ server, apiKey }, s.path, s.sessionId, opts.agent);
        if (r.ok) ok++;
        else console.error(`[ccopt] upload failed for ${s.sessionId}: HTTP ${r.status} ${r.detail ?? ''}`);
      }
      console.error(`[ccopt] uploaded ${ok}/${produced.length} session(s) as ${opts.agent}`);
    }

    // Isolated transcripts would vanish with the temp dir — preserve them locally
    // so `ccopt analyze` still sees them (defaultSources includes CCOPT_STORE).
    if (isoDir) {
      for (const s of produced) {
        const rel = s.path.slice(watchDir.length + 1);
        const dest = join(CCOPT_STORE, rel);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(s.path, dest);
      }
      rmSync(isoDir, { recursive: true, force: true });
    }

    console.error(
      sessionIds.length > 0
        ? `[ccopt] attributed ${sessionIds.length} session(s) to ${opts.agent}`
        : '[ccopt] no sessions observed during the run',
    );
    process.exitCode = res.status ?? 1;
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
