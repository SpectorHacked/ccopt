import type { Metadata } from 'next';
import Link from 'next/link';
import { Nav, Footer, PageHero, DocSection, CodeBlock } from '../../ui';

export const metadata: Metadata = {
  title: 'Privacy & redaction — Effigent docs',
  description: 'Built-in redaction filters, workspace custom rules, and exactly what is stored.',
};

const BUILTINS = ['PRIVATE_KEY', 'API_KEY', 'AWS_KEY', 'JWT', 'BEARER', 'DB_URL', 'PHONE', 'SSN', 'CREDENTIAL', 'EMAIL', 'CARD'];

export default function RedactionDocs() {
  return (
    <div style={{ width: '100%', overflowX: 'hidden' }}>
      <Nav />
      <PageHero
        eyebrow="Docs · Privacy & redaction"
        title="Redacted before it exists."
        sub="Every payload passes one choke point before storage or analysis — both capture paths, no exceptions. Values become typed placeholders so graphs stay comparable without keeping the secret."
      />

      <DocSection>
        <h2 className="h-serif" style={{ fontSize: 26, margin: '0 0 14px' }}>Built-in filters — always on</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {BUILTINS.map((b) => (
            <span key={b} style={{ fontFamily: 'var(--mono)', fontSize: 11.5, fontWeight: 600, border: '1px solid var(--line-2)', borderRadius: 12, padding: '4px 12px', color: 'var(--ink-2)' }}>{b}</span>
          ))}
        </div>
        <CodeBlock title="what the engine sees">{`before: db=postgresql://svc:s3cretpw@db.internal/prod contact=oncall@acme.com
after:  db=[REDACTED:DB_URL] contact=[REDACTED:EMAIL]`}</CodeBlock>
        <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.65, marginTop: 12 }}>
          Person names are deliberately <em>not</em> redacted — they are routine agent context (assignees, commit authors) and
          removing them would gut the analysis.
        </p>
      </DocSection>

      <DocSection>
        <h2 className="h-serif" style={{ fontSize: 26, margin: '0 0 14px' }}>Workspace rules</h2>
        <p style={{ fontSize: 14.5, color: 'var(--ink-2)', lineHeight: 1.65, margin: 0 }}>
          Organization admins add custom regex filters in the dashboard&apos;s <strong>Privacy</strong> view — internal ticket
          ids, hostnames, extra PII formats. Up to 20 rules of 200 characters each, validated before saving (an invalid rule
          can never break ingest), applied after the built-ins within a minute of saving.
        </p>
      </DocSection>

      <DocSection>
        <h2 className="h-serif" style={{ fontSize: 26, margin: '0 0 14px' }}>What is stored</h2>
        <div style={{ fontSize: 14.5, color: 'var(--ink-2)', lineHeight: 1.75 }}>
          <p style={{ margin: '0 0 10px' }}>
            Redacted, truncated step payloads (8&nbsp;KB per step), per-step token usage, models, timings, and the derived
            analysis. Capture keys are stored as SHA-256 hashes — plaintext exists only in the response that minted them.
          </p>
          <p style={{ margin: 0 }}>
            The full posture — scoping, opt-in capture, tenancy — is on the{' '}
            <Link href="/security" style={{ fontWeight: 600, color: 'oklch(0.4 0.14 250)' }}>security page</Link>.
          </p>
        </div>
      </DocSection>
      <Footer />
    </div>
  );
}
