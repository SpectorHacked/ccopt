/**
 * L2 — family clustering, spec §3.3. Local implementation: character 3-gram
 * TF-IDF vectors over the canonical label sequence, cosine similarity, greedy
 * agglomeration against cluster centroids. No API dependency; approximate by
 * design — L2 groups "near-miss" shapes (one extra retry node, reordered reads)
 * that L1 keeps apart.
 */

export interface L2Options {
  /** Cosine similarity threshold for joining a family. */
  threshold?: number;
}

type SparseVec = Map<string, number>;

function ngrams(s: string, n = 3): string[] {
  const grams: string[] = [];
  for (let i = 0; i <= s.length - n; i++) grams.push(s.slice(i, i + n));
  return grams;
}

function vectorize(labelSequence: string[]): SparseVec {
  const v: SparseVec = new Map();
  // Whole labels as tokens (structure) + char 3-grams (fuzz within labels).
  for (const label of labelSequence) {
    v.set(`L:${label}`, (v.get(`L:${label}`) ?? 0) + 3);
    for (const g of ngrams(label)) {
      v.set(g, (v.get(g) ?? 0) + 1);
    }
  }
  return v;
}

function cosine(a: SparseVec, b: SparseVec): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, va] of small) {
    const vb = large.get(k);
    if (vb) dot += va * vb;
  }
  let na = 0;
  for (const v of a.values()) na += v * v;
  let nb = 0;
  for (const v of b.values()) nb += v * v;
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Group L1 shapes into L2 families. Input: one representative label sequence
 * per distinct L1 hash. Output: familyId per L1 hash (familyId = the first
 * member's L1 hash, prefixed).
 */
export function clusterFamilies(
  shapes: Array<{ l1: string; labelSequence: string[] }>,
  options: L2Options = {},
): Map<string, string> {
  const threshold = options.threshold ?? 0.82;
  const families: Array<{ id: string; centroid: SparseVec; members: number }> = [];
  const assignment = new Map<string, string>();

  // Deterministic order: larger shapes first, then lexicographic.
  const sorted = [...shapes].sort(
    (a, b) => b.labelSequence.length - a.labelSequence.length || a.l1.localeCompare(b.l1),
  );

  for (const shape of sorted) {
    const vec = vectorize(shape.labelSequence);
    let best: { idx: number; sim: number } | null = null;
    for (let i = 0; i < families.length; i++) {
      const sim = cosine(vec, families[i].centroid);
      if (sim >= threshold && (!best || sim > best.sim)) best = { idx: i, sim };
    }
    if (best) {
      const fam = families[best.idx];
      // Update centroid incrementally (mean of member vectors).
      for (const [k, v] of vec) {
        fam.centroid.set(k, ((fam.centroid.get(k) ?? 0) * fam.members + v) / (fam.members + 1));
      }
      fam.members += 1;
      assignment.set(shape.l1, fam.id);
    } else {
      const id = `fam_${shape.l1.slice(0, 12)}`;
      families.push({ id, centroid: vec, members: 1 });
      assignment.set(shape.l1, id);
    }
  }
  return assignment;
}
