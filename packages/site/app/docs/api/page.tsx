import type { Metadata } from 'next';
import { Nav, Footer, PageHero, DocSection, CodeBlock } from '../../ui';
import { COLLECTOR_URL, TRACES_URL } from '../../config';

export const metadata: Metadata = {
  title: 'Machine API — Effigent docs',
  description: 'The collector endpoints: ingest, OTLP traces, agent registration, key validation, and the optimize bundle.',
};

export default function ApiDocs() {
  return (
    <div style={{ width: '100%', overflowX: 'hidden' }}>
      <Nav />
      <PageHero
        eyebrow="Docs · Machine API"
        title="Five endpoints, Bearer keys, no surprises."
        sub="Everything the CLI does goes through these. All machine endpoints authenticate with capture keys (eff_…); scoped keys are pinned to their agent."
      />

      <DocSection>
        <h2 className="h-serif" style={{ fontSize: 24, margin: '0 0 10px' }}>POST /api/v1/ingest — transcripts</h2>
        <CodeBlock title="gzipped Claude Code JSONL">{`curl -X POST ${COLLECTOR_URL}/api/v1/ingest \\
  -H "Authorization: Bearer <scoped-key>" \\
  -H "x-effigent-session-id: <session-id>" \\
  --data-binary @session.jsonl.gz

# → {"parsed":true,"agentId":"billing-agent","costUsd":0.0111}
# large sessions: send a pre-parsed Run with  x-effigent-format: run`}</CodeBlock>
      </DocSection>

      <DocSection>
        <h2 className="h-serif" style={{ fontSize: 24, margin: '0 0 10px' }}>POST /v1/traces — OpenTelemetry</h2>
        <CodeBlock title="OTLP/HTTP GenAI spans (uncompressed JSON)">{`curl -X POST ${TRACES_URL} \\
  -H "Authorization: Bearer <scoped-key>" \\
  -H "content-type: application/json" \\
  -d @otlp-payload.json

# gen_ai.* semantic conventions; tool spans may carry
# gen_ai.tool.call.arguments / traceloop.entity.input+output`}</CodeBlock>
      </DocSection>

      <DocSection>
        <h2 className="h-serif" style={{ fontSize: 24, margin: '0 0 10px' }}>POST /api/v1/agents — registration</h2>
        <CodeBlock title="tenant key → agent + scoped key (plaintext returned once)">{`curl -X POST ${COLLECTOR_URL}/api/v1/agents \\
  -H "Authorization: Bearer <workspace-key>" \\
  -H "content-type: application/json" \\
  -d '{"name":"billing-agent","harness":"claude-code"}'

# → {"agentId":"…","name":"billing-agent","apiKey":"eff_…"}`}</CodeBlock>
      </DocSection>

      <DocSection>
        <h2 className="h-serif" style={{ fontSize: 24, margin: '0 0 10px' }}>GET /api/v1/reports — key validation</h2>
        <CodeBlock title="what `effigent login` probes">{`curl ${COLLECTOR_URL}/api/v1/reports -H "Authorization: Bearer <key>"   # 200 = valid`}</CodeBlock>
      </DocSection>

      <DocSection>
        <h2 className="h-serif" style={{ fontSize: 24, margin: '0 0 10px' }}>GET /api/v1/optimize — the activation bundle</h2>
        <CodeBlock title="what `effigent optimize` downloads">{`curl "${COLLECTOR_URL}/api/v1/optimize?agent=billing-agent&mark=1" \\
  -H "Authorization: Bearer <scoped-key>"

# → { tools: [ToolSpec + replay verdicts], knowledge: {entries, coverage, worthIt},
#     drift: {changed, changedAt}, activatable }
# mark=1 stamps the dashboard's Optimized badge when something activatable exists`}</CodeBlock>
      </DocSection>
      <Footer />
    </div>
  );
}
