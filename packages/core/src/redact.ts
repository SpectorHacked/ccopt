/**
 * Sensitive-data redaction — applied at the ingest choke point before a run is
 * stored or analyzed. Pattern-based (no LLM in the path): provider API keys,
 * cloud credentials, bearer tokens, PEM blocks, emails, and card-like numbers
 * are replaced with typed placeholders so graphs stay comparable (the same
 * secret always becomes the same token) without ever storing the value.
 */

const RULES: Array<{ name: string; re: RegExp }> = [
  // PEM / private key blocks first (multiline, would otherwise partially match)
  { name: 'PRIVATE_KEY', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  // provider + platform keys
  { name: 'API_KEY', re: /\b(?:sk|rk)-[A-Za-z0-9_-]{16,}\b/g }, // OpenAI/Anthropic/Stripe-style
  { name: 'API_KEY', re: /\b(?:eff|cck)_[a-f0-9]{16,}\b/g }, // our own capture keys
  { name: 'API_KEY', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g }, // GitHub
  { name: 'API_KEY', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g }, // Slack
  { name: 'API_KEY', re: /\bAIza[A-Za-z0-9_-]{30,}\b/g }, // Google
  { name: 'AWS_KEY', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'BEARER', re: /\b[Bb]earer\s+[A-Za-z0-9._~+/-]{16,}=*/g },
  // connection strings with inline credentials
  { name: 'DB_URL', re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s@/]+@[^\s"']+/g },
  // PII
  { name: 'EMAIL', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { name: 'CARD', re: /\b(?:\d[ -]?){13,16}\b/g },
];

/** Replace sensitive values with `[REDACTED:<TYPE>]` placeholders. */
export function redactSensitive(text: string): string {
  if (!text) return text;
  let out = text;
  for (const { name, re } of RULES) out = out.replace(re, `[REDACTED:${name}]`);
  return out;
}

/** True when redaction would change the text (useful for tests/metrics). */
export function containsSensitive(text: string): boolean {
  return RULES.some(({ re }) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}
