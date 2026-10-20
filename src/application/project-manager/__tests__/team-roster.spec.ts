import {
  buildRoster,
  rosterBlock,
  tagPeople,
} from '@application/project-manager/team-roster';

const roster = buildRoster(
  { 'Max Brenner': 'max_b', Tomas: 'tomas_qa', Anna: 'Anna_PM' },
  { Tomas: 'QA', 'Lena Ward': 'QA' },
);

describe('team roster', () => {
  it('joins roles and usernames by name', () => {
    expect(roster).toEqual([
      { name: 'Anna', role: null, username: 'anna_pm' },
      { name: 'Lena Ward', role: 'QA', username: null },
      { name: 'Max Brenner', role: null, username: 'max_b' },
      { name: 'Tomas', role: 'QA', username: 'tomas_qa' },
    ]);
  });

  it('asks for a line per person and tags only when someone has Telegram', () => {
    const block = rosterBlock(roster);
    expect(block).toContain('- Tomas — QA — @tomas_qa');
    expect(block).toContain('- Lena Ward — QA');
    expect(block).toContain('own line in Focus today');
    expect(block).toContain('(@max_b)');
    expect(rosterBlock(buildRoster({}, { Tomas: 'QA' }))).not.toContain('@');
    expect(rosterBlock([])).toBe('');
  });

  it('keeps roster tags and drops the @ of anyone else', () => {
    expect(tagPeople('Max (@max_b) and @client_x; mail a@b.com', roster)).toBe(
      'Max (@max_b) and client_x; mail a@b.com',
    );
  });

  it('tags a rostered person the model named without a tag, once', () => {
    const out = tagPeople(
      '- Max: smoke-test prod. Ask Max again.\n- Tomas: test the 10-18 build',
      roster,
    );
    expect(out).toBe(
      '- Max (@max_b): smoke-test prod. Ask Max again.\n- Tomas (@tomas_qa): test the 10-18 build',
    );
  });

  it("tags each person's own line even after an earlier mention", () => {
    const out = tagPeople(
      [
        'Since yesterday: ABC-1 is on dev for Tomas (@tomas_qa), Max fixed it.',
        'Focus today:',
        '- Max Brenner: smoke-test prod',
        '- Tomas: verify ABC-1',
        '• Anna (QA lead) — approve flags',
        '- Max Petrov: not ours',
        '- Lena Ward: no Telegram',
      ].join('\n'),
      roster,
    );
    expect(out.split('\n')).toEqual([
      'Since yesterday: ABC-1 is on dev for Tomas (@tomas_qa), Max fixed it.',
      'Focus today:',
      '- Max Brenner (@max_b): smoke-test prod',
      '- Tomas (@tomas_qa): verify ABC-1',
      '• Anna (@anna_pm) (QA lead) — approve flags',
      '- Max Petrov: not ours',
      '- Lena Ward: no Telegram',
    ]);
  });

  it('does not tag by a first name two people share', () => {
    const two = buildRoster({ 'Anna A': 'anna_a', 'Anna B': 'anna_b' });
    expect(tagPeople('Anna: approve', two)).toBe('Anna: approve');
    expect(tagPeople('Anna B: approve', two)).toBe('Anna B (@anna_b): approve');
  });

  it('matches whole words only', () => {
    expect(tagPeople('Annatoly and Tomasko', roster)).toBe(
      'Annatoly and Tomasko',
    );
  });

  it('never tags a namesake who is not on the roster', () => {
    expect(tagPeople('- Max Petrov: fix login', roster)).toBe(
      '- Max Petrov: fix login',
    );
  });

  it('keeps the @ of scoped packages, URLs and emails', () => {
    const text =
      'bump @react-navigation/native and @types/node, see https://medium.com/@author/post, mail a@b.com';
    expect(tagPeople(text, roster)).toBe(text);
    expect(tagPeople('done.@client_x', roster)).toBe('done.client_x');
  });
});
