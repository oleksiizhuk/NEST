// Node 24 warns about url.parse() (DEP0169) only when it is called from
// outside node_modules. Our code never calls it and every dependency lives in
// node_modules, so on Vercel the warning comes from the platform's own
// request wrapper, once per instance: noise we cannot fix at the source.
// Only these codes are dropped; every other warning still reaches the logs.
export const QUIET_WARNING_CODES = ['DEP0169'];

type Emit = (warning: string | Error, ...rest: unknown[]) => void;
const QUIET = Symbol.for('nest.quietWarnings');

// The code the way Node reads it (internal/process/warning): an Error keeps
// its own code and ignores the rest; then an options object; a constructor
// in the second or third place means there is no code
const codeOf = (warning: string | Error, rest: unknown[]): unknown => {
  if (warning instanceof Error)
    return (warning as Error & { code?: unknown }).code;
  const [type, code] = rest;
  if (type && typeof type === 'object')
    return (type as { code?: unknown }).code;
  if (typeof type === 'function' || typeof code === 'function')
    return undefined;
  return code;
};

export const quietPlatformWarnings = (
  proc: { emitWarning: Emit } = process as unknown as { emitWarning: Emit },
): void => {
  const emit = proc.emitWarning as Emit & { [QUIET]?: true };
  // Installed once, however often the entry module is loaded
  if (emit[QUIET]) return;
  const filtered: Emit & { [QUIET]?: true } = function (
    this: unknown,
    warning,
    ...rest
  ) {
    if (QUIET_WARNING_CODES.includes(String(codeOf(warning, rest)))) return;
    return emit.call(this, warning, ...rest);
  };
  filtered[QUIET] = true;
  proc.emitWarning = filtered;
};
