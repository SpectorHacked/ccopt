import type { Metadata } from 'next';
import { Nav, Footer, PageHero, DocSection } from '../../ui';

export const metadata: Metadata = {
  title: 'Insights & the engine — Effigent docs',
  description: 'How runs become graphs, how determinism is scored on the D0–D5 lattice, and what each optimization action means.',
};

const ACTIONS: Array<[string, string]> = [
  ['Replace with tool', 'The value is identical in every run — precompute it, or compile the call away entirely.'],
  ['Compile to code', 'Every argument is constant or provenance-derived from earlier outputs — code can issue this call without the LLM.'],
  ['Memoize by input', 'The same input always produced the same output — cache keyed by input.'],
  ['Synthesize template', 'Fixed structure with volatile data slots — a parameterized tool, with unresolved slots as arguments.'],
  ['Route to smaller model', 'The LLM step is structurally stable — a cheaper model handles it.'],
  ['Cache', 'Mostly stable — cache with validation.'],
];

export default function InsightsDocs() {
  return (
    <div style={{ width: '100%', overflowX: 'hidden' }}>
      <Nav />
      <PageHero
        eyebrow="Docs · Insights"
        title="How the engine decides."
        sub="Per agent, the last 40 runs are parsed into execution graphs, clustered by similarity, aligned step-by-step, and scored for determinism. Every suggestion carries the evidence that produced it."
      />

      <DocSection>
        <h2 className="h-serif" style={{ fontSize: 26, margin: '0 0 14px' }}>The pipeline</h2>
        <div style={{ fontSize: 14.5, color: 'var(--ink-2)', lineHeight: 1.8 }}>
          <p style={{ margin: '0 0 10px' }}>
            <strong>1 · Graph.</strong> Every run becomes a DAG: model turns, tool calls, results, and the dataflow between
            them (which outputs feed which inputs).
          </p>
          <p style={{ margin: '0 0 10px' }}>
            <strong>2 · Cluster by similarity, not equality.</strong> Runs are compared by sequence similarity <em>and</em> DAG
            topology, then aligned column-by-column against the cluster&apos;s most representative run — so an inserted retry
            or a reordered read doesn&apos;t shatter the analysis.
          </p>
          <p style={{ margin: '0 0 10px' }}>
            <strong>3 · Score the lattice.</strong> Each aligned step lands on a determinism ladder: constant → derivable →
            pure function of input → parameterized → routable → keep-the-LLM. Scoring runs on raw values (numbers kept), so
            &quot;processed 3 rows&quot; vs &quot;processed 9,214 rows&quot; is honestly non-deterministic.
          </p>
          <p style={{ margin: 0 }}>
            <strong>4 · Gate on confidence.</strong> Every action requires a Wilson lower bound at the detector&apos;s honest
            sample size — two agreeing runs never fire anything.
          </p>
        </div>
      </DocSection>

      <DocSection>
        <h2 className="h-serif" style={{ fontSize: 26, margin: '0 0 14px' }}>What each action means</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {ACTIONS.map(([name, desc]) => (
            <div key={name} style={{ display: 'flex', gap: 14, alignItems: 'baseline', borderTop: '1px solid oklch(0.92 0.005 90)', paddingTop: 12 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, minWidth: 190 }}>{name}</div>
              <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>{desc}</div>
            </div>
          ))}
        </div>
      </DocSection>

      <DocSection>
        <h2 className="h-serif" style={{ fontSize: 26, margin: '0 0 14px' }}>Drift — &quot;has my agent changed?&quot;</h2>
        <p style={{ fontSize: 14.5, color: 'var(--ink-2)', lineHeight: 1.65, margin: 0 }}>
          Each run&apos;s graph is embedded into a vector space; the newest runs are compared against the window&apos;s
          baseline. When they move away (a prompt rewrite, a new tool, a framework upgrade), the agent is flagged{' '}
          <strong>behavior changed</strong> — because every optimization was validated against the <em>old</em> behavior,
          drift is the signal to re-validate before trusting the bundle.
        </p>
      </DocSection>
      <Footer />
    </div>
  );
}
