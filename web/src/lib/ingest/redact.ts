// Best-effort secret redaction. The transcript shipper redacts BEFORE anything
// leaves the source machine (tools/transcript-sync/ship.py); this is the
// server-side backstop for anything that slips through. Matches are replaced
// with «redacted» (env assignments keep their var name for context).

const PATTERNS: RegExp[] = [
  // tokens / keys by shape
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bgh[ousr]_[A-Za-z0-9]{20,}\b/g,
  /\bwandb_v1_[A-Za-z0-9]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

// KEY=value / KEY: "value" for known secret env names (keep the name).
const ENV_ASSIGN =
  /\b(SCIENCEDASH_AUTH_TOKEN|SCIENCEDASH_SESSION_SECRET|SCIENCEDASH_PASSWORD_SALT|SCIENCEDASH_AUTH_PASSWORD_HASH|WANDB_API_KEY|GITHUB_PAT|GITHUB_TOKEN|ANTHROPIC_API_KEY|AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY)\s*[:=]\s*["']?([A-Za-z0-9_\-./+=]{8,})["']?/g;

export function redact(input: string): string {
  if (!input) return input;
  let out = input;
  out = out.replace(ENV_ASSIGN, (_m, name) => `${name}=«redacted»`);
  for (const rx of PATTERNS) out = out.replace(rx, "«redacted»");
  return out;
}
