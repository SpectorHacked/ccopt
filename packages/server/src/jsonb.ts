/**
 * Postgres jsonb rejects NUL characters and lone surrogates inside strings
 * (error 22P05). Real transcripts contain NULs, and engine-side truncation can
 * split a surrogate pair. Strip both anywhere we write jsonb; raw blobs keep
 * full fidelity.
 */
export function sanitizeForJsonb<T>(value: T): T {
  if (typeof value === 'string') {
    return value
      .replace(/\u0000/g, '')
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
      .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '') as T;
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeForJsonb(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[sanitizeForJsonb(k)] = sanitizeForJsonb(v);
    }
    return out as T;
  }
  return value;
}
