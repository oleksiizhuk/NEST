// Tool output comes from repositories, tickets and APIs the team does not
// fully control. It is wrapped so the model treats it as data, and obvious
// secrets that were committed by mistake are masked before it sees them.
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /((?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*)(["']?)[^\s"']{6,}\2/gi,
];

export const redactSecrets = (text: string): string =>
  SECRET_PATTERNS.reduce(
    (acc, pattern) =>
      acc.replace(pattern, (match, prefix?: string) =>
        typeof prefix === 'string' && /[:=]\s*$/.test(prefix)
          ? `${prefix}[redacted]`
          : '[redacted]',
      ),
    text,
  );

// Text that closes the wrapper itself could pose as instructions after it
const neutralizeWrapper = (text: string): string =>
  text.replace(/<(\/?)\s*tool_data/gi, '<$1tool-data');

export const wrapUntrusted = (source: string, text: string): string =>
  `<tool_data source="${source.replace(/"/g, "'")}">\n${neutralizeWrapper(
    redactSecrets(text),
  )}\n</tool_data>`;

const DENIED_PATH = [
  /(^|\/)\.env(\.|$)/i,
  /\.(pem|key|p12|pfx|keystore|jks|mobileprovision)$/i,
  /(^|\/)secrets?\//i,
  /(^|\/)google-services\.json$/i,
  /(^|\/)GoogleService-Info\.plist$/i,
  /(^|\/)id_(rsa|ed25519)/i,
];

export const assertReadablePath = (path: string): string => {
  const clean = String(path ?? '').replace(/^\/+/, '');
  if (clean.split('/').includes('..'))
    throw new Error('path may not contain ..');
  if (DENIED_PATH.some((re) => re.test(clean))) {
    throw new Error('this file may hold secrets and is not readable here');
  }
  return clean;
};
