import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { quietPlatformWarnings } from '@config/quiet-warnings';

const ROOT = join(__dirname, '..', '..', '..');

describe('quietPlatformWarnings', () => {
  const install = () => {
    const original = jest.fn();
    const proc = { emitWarning: original as (...a: unknown[]) => void };
    quietPlatformWarnings(proc as any);
    return { proc, original };
  };

  it("drops url.parse()'s DEP0169, in every form Node emits it", () => {
    const { proc, original } = install();
    proc.emitWarning('`url.parse()` …', 'DeprecationWarning', 'DEP0169');
    proc.emitWarning('`url.parse()` …', {
      type: 'DeprecationWarning',
      code: 'DEP0169',
    });
    proc.emitWarning(Object.assign(new Error('x'), { code: 'DEP0169' }));
    expect(original).not.toHaveBeenCalled();
  });

  it('passes every other warning through unchanged', () => {
    const { proc, original } = install();
    proc.emitWarning('Buffer() is deprecated', 'DeprecationWarning', 'DEP0005');
    proc.emitWarning('possible leak', 'MaxListenersExceededWarning');
    proc.emitWarning('plain');
    expect(original.mock.calls).toEqual([
      ['Buffer() is deprecated', 'DeprecationWarning', 'DEP0005'],
      ['possible leak', 'MaxListenersExceededWarning'],
      ['plain'],
    ]);
  });

  it('installs once, so a second load does not wrap it twice', () => {
    const { proc } = install();
    const first = proc.emitWarning;
    quietPlatformWarnings(proc as any);
    expect(proc.emitWarning).toBe(first);
  });

  it('reads arguments the way Node does', () => {
    const { proc, original } = install();
    function Ctor() {
      return undefined;
    }
    // A constructor before the code: Node sees no code, so it stays
    proc.emitWarning('a', Ctor, 'DEP0169');
    // An Error ignores type and code: its own code (none) counts
    proc.emitWarning(new Error('b'), 'Warning', 'DEP0169');
    // util.deprecate's form, and an unbound call
    proc.emitWarning('c', 'DeprecationWarning', 'DEP0169', Ctor);
    const unbound = proc.emitWarning;
    unbound('d', 'DeprecationWarning', 'DEP0005');
    expect(
      original.mock.calls.map((c) => (c[0] instanceof Error ? 'b' : c[0])),
    ).toEqual(['a', 'b', 'd']);
  });

  // The whole fix rests on Node sending DEP0169 through process.emitWarning;
  // a real process proves it (and the default argument) on this Node
  it('silences a real url.parse() in a Node process, and only that', () => {
    const script = [
      "require('ts-node').register({ transpileOnly: true });",
      "require('./src/config/quiet-warnings').quietPlatformWarnings();",
      "require('url').parse('http://example.com/a?b=1');",
      "process.emitWarning('control', 'DeprecationWarning', 'DEP0005');",
    ].join('\n');
    const run = spawnSync(process.execPath, ['-e', script], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(run.status).toBe(0);
    expect(run.stderr).not.toContain('DEP0169');
    expect(run.stderr).toContain('DEP0005');
  });

  it('is where api/index.js loads it from after the build', () => {
    const entry = readFileSync(join(ROOT, 'api', 'index.js'), 'utf8');
    expect(entry).toContain("require('../dist/config/quiet-warnings')");
    // The build maps src/ to dist/ one to one
    expect(existsSync(join(ROOT, 'src', 'config', 'quiet-warnings.ts'))).toBe(
      true,
    );
  });
});
