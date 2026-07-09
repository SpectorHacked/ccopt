# ccopt — the Optimizer CLI

Capture your AI agents' runs — Claude Code, OpenAI Codex, LangGraph/CrewAI/AutoGen, or any
OTel-capable agent — and send them to your [Optimizer](https://github.com/SpectorHacked/ccopt)
workspace, where every run becomes an execution graph with cost, models, and
optimization insights (replace / memoize / template / route).

## Install

```sh
npm i -g ccopt
```

## Two-minute setup

```sh
# 1. Log in with your workspace key (generate it on the dashboard's Install page)
ccopt login --server https://<your-dashboard-url> --key cck_…

# 2. Register the agent — mints a scoped capture key
ccopt agent add my-agent

# 3. Wire capture for your harness
ccopt install claude --agent my-agent    # Claude Code: SessionEnd hook, zero-touch
ccopt install codex  --agent my-agent    # Codex: prints the OTel env, key filled in
ccopt install python --agent my-agent    # LangGraph / CrewAI / AutoGen via OpenLLMetry
ccopt install node   --agent my-agent    # Node/TS agents via OpenLLMetry
ccopt install otel   --agent my-agent    # any OTel exporter
```

Or wrap any command directly (CI, cron, one-offs):

```sh
ccopt run --agent nightly-etl -- node etl.js
```

## Security

- One **scoped key per agent** — write-only, bound to that agent, stored hashed server-side.
- Keys live in `~/.ccopt/config.json`, never in your agent's code or settings.
- Captured payloads are **redacted** (API keys, credentials, PII) before storage or analysis.

## Commands

| Command | What it does |
| --- | --- |
| `ccopt login` | Save + verify the server URL and workspace key |
| `ccopt agent add <name>` | Register an agent, mint its scoped capture key |
| `ccopt agent list` | List agents registered from this machine |
| `ccopt install <harness>` | Wire capture: `claude`, `codex`, `python`, `node`, `otel` |
| `ccopt run --agent <name> -- <cmd…>` | Run any agent command with capture + attribution |
| `ccopt sync` | Upload local Claude Code sessions in batch |
| `ccopt doctor` | Check your local setup |
