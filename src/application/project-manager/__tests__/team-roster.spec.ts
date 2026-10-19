import {
  buildRoster,
  rosterBlock,
  tagPeople,
} from '@application/project-manager/team-roster';

const roster = buildRoster(
  { 'Vlad Koropets': 'vlad_k', Andrii: 'andrii_qa', Anna: 'Anna_PM' },
  { Andrii: 'QA', 'Ira Zanizdra': 'QA' },
);

describe('team roster', () => {
  it('joins roles and usernames by name', () => {
    expect(roster).toEqual([
      { name: 'Andrii', role: 'QA', username: 'andrii_qa' },
      { name: 'Anna', role: null, username: 'anna_pm' },
      { name: 'Ira Zanizdra', role: 'QA', username: null },
      { name: 'Vlad Koropets', role: null, username: 'vlad_k' },
    ]);
  });

  it('asks for a line per person and tags only when someone has Telegram', () => {
    const block = rosterBlock(roster);
    expect(block).toContain('- Andrii — QA — @andrii_qa');
    expect(block).toContain('- Ira Zanizdra — QA');
    expect(block).toContain('own line in Focus today');
    expect(block).toContain('(@vlad_k)');
    expect(rosterBlock(buildRoster({}, { Andrii: 'QA' }))).not.toContain('@');
    expect(rosterBlock([])).toBe('');
  });

  it('keeps roster tags and drops the @ of anyone else', () => {
    expect(
      tagPeople('Vlad (@vlad_k) and @faisal_x; mail a@b.com', roster),
    ).toBe('Vlad (@vlad_k) and faisal_x; mail a@b.com');
  });

  it('tags a rostered person the model named without a tag, once', () => {
    const out = tagPeople(
      '- Vlad: smoke-test prod. Ask Vlad again.\n- Andrii: test the 10-18 build',
      roster,
    );
    expect(out).toBe(
      '- Vlad (@vlad_k): smoke-test prod. Ask Vlad again.\n- Andrii (@andrii_qa): test the 10-18 build',
    );
  });

  it('does not tag by a first name two people share', () => {
    const two = buildRoster({ 'Anna A': 'anna_a', 'Anna B': 'anna_b' });
    expect(tagPeople('Anna: approve', two)).toBe('Anna: approve');
    expect(tagPeople('Anna B: approve', two)).toBe('Anna B (@anna_b): approve');
  });

  it('matches whole words only', () => {
    expect(tagPeople('Annatoly and Andriiko', roster)).toBe(
      'Annatoly and Andriiko',
    );
  });
});
