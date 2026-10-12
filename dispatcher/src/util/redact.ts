/** Redact likely secrets from text bound for journals, reports, or PR bodies. */

export const REDACTED = "[redacted]";

/** Replace likely secrets with [redacted]. Idempotent. */
export function redactSecrets(text: string): string {
  let out = text;
  out = out.replace(/sk-[A-Za-z0-9-_]{8,}/g, REDACTED);
  out = out.replace(/xox[bap]-[-A-Za-z0-9]+/g, REDACTED);
  out = out.replace(/gh[pousr]_[A-Za-z0-9_]{8,}/g, REDACTED);
  out = out.replace(/(Bearer\s+)[A-Za-z0-9\-._~+/=]+/gi, `$1${REDACTED}`);
  out = out.replace(
    /((?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*)(['"]?)[^\s'";,]{1,}(['"]?)/gi,
    `$1$2${REDACTED}$3`,
  );
  out = out.replace(/(--token\s+)\S+/gi, `$1${REDACTED}`);
  return out;
}

const SENSITIVE_KEY = /secret|password|token|api[_-]?key/i;

/** Redact every string value in a JSON-shaped structure. */
export function redactJson<T>(value: T): T {
  if (typeof value === "string") return redactSecrets(value) as T;
  if (Array.isArray(value)) return value.map(redactJson) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) && typeof v === "string" ? REDACTED : redactJson(v);
    }
    return out as T;
  }
  return value;
}
