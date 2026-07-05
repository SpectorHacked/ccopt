/** Synthetic Claude Code transcript builder for engine tests. */

export interface SynthTool {
  name: string;
  input: Record<string, unknown>;
  result: string;
  isError?: boolean;
}

export interface SynthRunSpec {
  sessionId: string;
  cwd?: string;
  prompt: string;
  tools: SynthTool[];
  finalText: string;
  model?: string;
  startedAt?: string;
  outputTokens?: number;
  inputTokens?: number;
  cacheReadTokens?: number;
}

export function synthTranscript(spec: SynthRunSpec): string {
  const model = spec.model ?? 'claude-sonnet-5';
  const cwd = spec.cwd ?? '/work/agents/scraper';
  const t0 = spec.startedAt ?? '2026-07-01T10:00:00.000Z';
  const lines: object[] = [];
  let seq = 0;
  const ts = () => new Date(Date.parse(t0) + seq++ * 1000).toISOString();

  lines.push({
    type: 'user',
    sessionId: spec.sessionId,
    uuid: `u-${spec.sessionId}-p`,
    timestamp: ts(),
    cwd,
    message: { role: 'user', content: spec.prompt },
  });

  spec.tools.forEach((tool, i) => {
    const toolUseId = `toolu_${spec.sessionId}_${i}`;
    lines.push({
      type: 'assistant',
      sessionId: spec.sessionId,
      uuid: `a-${spec.sessionId}-${i}`,
      requestId: `req_${spec.sessionId}_${i}`,
      timestamp: ts(),
      cwd,
      message: {
        role: 'assistant',
        model,
        usage: {
          input_tokens: spec.inputTokens ?? 2000,
          output_tokens: spec.outputTokens ?? 150,
          cache_creation_input_tokens: 500,
          cache_read_input_tokens: spec.cacheReadTokens ?? 300,
        },
        content: [{ type: 'tool_use', id: toolUseId, name: tool.name, input: tool.input }],
      },
    });
    lines.push({
      type: 'user',
      sessionId: spec.sessionId,
      uuid: `u-${spec.sessionId}-${i}`,
      timestamp: ts(),
      cwd,
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: [{ type: 'text', text: tool.result }],
            ...(tool.isError ? { is_error: true } : {}),
          },
        ],
      },
    });
  });

  lines.push({
    type: 'assistant',
    sessionId: spec.sessionId,
    uuid: `a-${spec.sessionId}-final`,
    requestId: `req_${spec.sessionId}_final`,
    timestamp: ts(),
    cwd,
    message: {
      role: 'assistant',
      model,
      usage: {
        input_tokens: spec.inputTokens ?? 2000,
        output_tokens: spec.outputTokens ?? 150,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: spec.cacheReadTokens ?? 300,
      },
      content: [{ type: 'text', text: spec.finalText }],
    },
  });

  return lines.map((l) => JSON.stringify(l)).join('\n');
}

/** A standard 3-tool "scrape" procedure with parameterizable data. */
export function scrapeRun(i: number, opts: Partial<SynthRunSpec> = {}): string {
  return synthTranscript({
    sessionId: `scrape-${i}`,
    prompt: `Scrape https://shop.example.com/products?page=${i} and write results to /data/out/products_${i}.json`,
    tools: [
      {
        name: 'WebFetch',
        input: { url: `https://shop.example.com/products?page=${i}` },
        result: `<html>product list page ${i} with 20 items id=prod_${1000 + i}</html>`,
      },
      {
        name: 'Bash',
        input: { command: `jq '.items | length' /data/tmp/page_${i}.json` },
        result: '20',
      },
      {
        name: 'Write',
        input: { file_path: `/data/out/products_${i}.json`, content: `{"count": 20, "page": ${i}}` },
        result: `File created at /data/out/products_${i}.json`,
      },
    ],
    finalText: `Done. Scraped page ${i}, wrote 20 products to /data/out/products_${i}.json.`,
    startedAt: `2026-07-0${(i % 5) + 1}T10:00:00.000Z`,
    ...opts,
  });
}
