#!/usr/bin/env node
/**
 * Bundle invariant: the npm CLI ships capture + the local waste-report
 * pipeline ONLY. The v3 brain (alignment, lattice, synthesis, replay,
 * embeddings, drift) is server-side — if any of these symbols appear in the
 * bundle, someone broke tree-shaking (top-level side effect or a new CLI
 * import) and the publish should fail loudly, not silently grow.
 */
import { readFileSync } from 'node:fs';

const FORBIDDEN = [
  'embedRunGraph',
  'detectDrift',
  'analyzeDeterminism',
  'synthesizeTools',
  'replayToolSpec',
  'clusterBySimilarity',
];

const bundle = readFileSync(new URL('./dist/index.cjs', import.meta.url), 'utf8');
const leaked = FORBIDDEN.filter((sym) => bundle.includes(sym));
if (leaked.length > 0) {
  console.error(`✗ CLI bundle contains server-side engine symbols: ${leaked.join(', ')}`);
  console.error('  The brain must stay out of the npm package — check for new CLI imports');
  console.error('  or top-level side effects in core that defeat tree-shaking.');
  process.exit(1);
}
console.log(`✓ bundle clean (${Math.round(bundle.length / 1024)} kB) — no server-side engine symbols`);
