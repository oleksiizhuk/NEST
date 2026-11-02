import { quietPlatformWarnings } from '@config/quiet-warnings';

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
});
