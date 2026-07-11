import type { Metadata } from 'next';
import { Nav, Footer, PageHero, DocSection, CodeBlock } from '../../ui';
import { COLLECTOR_URL, TRACES_URL } from '../../config';

export const metadata: Metadata = {
  title: 'Capture — Effigent docs',
  description: 'The two capture paths — transcript hook and OpenTelemetry — what each records, and how attribution works.',
};

export default function Capture() {
  return (
    <div style={{ width: '100%', overflowX: 'hidden' }}>
      <Nav />
      <PageHero
        eyebrow="Docs · Capture"
        title="Two paths into the same execution graph."
        sub="Capture is passive — nothing sits in your agent's request path. Both paths normalize into the same Run model, so the engine doesn't care which harness you run."
      />

      <DocSection>
        <h2 className="h-serif" style={{ fontSize: 26, margin: '0 0 14px' }}>Path 1 — transcript hook (Claude Code)</h2>
        <p style={{ fontSize: 14.5, color: 'var(--ink-2)', lineHeight: 1.65, margin: '0 0 14px' }}>
          <code>effigent install claude</code> adds a SessionEnd hook: every finished session uploads its transcript (gzipped)
          under the agent&apos;s scoped key. Richest signal — every model turn, tool call, tool result, thinking step, and
          <strong> per-request token usage attributed to individual steps</strong>, which is what makes cost estimates measured
          rather than guessed.
        </p>
        <CodeBlock title="what travels">{`POST ${COLLECTOR_URL}/api/v1/ingest
Authorization: Bearer <scoped-key>
x-effigent-session-id: <session>
<gzipped JSONL transcript>

# sessions over the ~4.5 MB body cap are pre-parsed client-side
# and sent as x-effigent-format: run`}</CodeBlock>
      </DocSection>

      <DocSection>
        <h2 className="h-serif" style={{ fontSize: 26, margin: '0 0 14px' }}>Path 2 — OpenTelemetry (SDKs, Codex, anything)</h2>
        <p style={{ fontSize: 14.5, color: 'var(--ink-2)', lineHeight: 1.65, margin: '0 0 14px' }}>
          Standard OTel GenAI spans, exported straight to the collector. OpenLLMetry auto-instrumentation covers LangGraph,
          CrewAI, AutoGen, the OpenAI Agents SDK, and the raw openai/anthropic clients. Per-span model, token usage, and
          duration land on each step; tool spans carry arguments <em>and successful outputs</em>
          (<code>gen_ai.tool.*</code>, <code>traceloop.entity.input/output</code>) — the material the memoizer and the
          knowledge graph feed on.
        </p>
        <CodeBlock title="exporter env (printed with your key by `effigent install otel`)">{`export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=${TRACES_URL}
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_COMPRESSION=none
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <scoped-key>"`}</CodeBlock>
      </DocSection>

      <DocSection>
        <h2 className="h-serif" style={{ fontSize: 26, margin: '0 0 14px' }}>Attribution & privacy rules</h2>
        <div style={{ fontSize: 14.5, color: 'var(--ink-2)', lineHeight: 1.75 }}>
          <p style={{ margin: '0 0 10px' }}>
            <strong>Scoped keys win.</strong> A capture key minted for an agent can only upload as that agent — a spoofed
            header cannot re-attribute traffic.
          </p>
          <p style={{ margin: '0 0 10px' }}>
            <strong>Capture is opt-in per agent.</strong> <code>effigent sync</code> uploads only sessions explicitly claimed
            by a tag or rule; everything else stays on the machine.
          </p>
          <p style={{ margin: 0 }}>
            <strong>Redaction runs before storage.</strong> Secrets and PII are replaced at the ingest choke point — see{' '}
            <a href="/docs/redaction" style={{ fontWeight: 600, color: 'oklch(0.4 0.14 250)' }}>Privacy &amp; redaction</a>.
          </p>
        </div>
      </DocSection>
      <Footer />
    </div>
  );
}
