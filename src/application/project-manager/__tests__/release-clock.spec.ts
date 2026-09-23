import {
  todayLine,
  workingDaysLeft,
} from '@application/project-manager/release-clock';

describe('release clock', () => {
  const wed = new Date('2026-09-23T10:00:00Z');

  it('counts weekdays after today up to the release day', () => {
    // Thu 24, Fri 25, Mon 28, Tue 29, Wed 30
    expect(workingDaysLeft(wed, '2026-09-30')).toBe(5);
  });

  it('is zero on or after the release day', () => {
    expect(
      workingDaysLeft(new Date('2026-09-30T08:00:00Z'), '2026-09-30'),
    ).toBe(0);
    expect(
      workingDaysLeft(new Date('2026-10-02T08:00:00Z'), '2026-09-30'),
    ).toBe(0);
  });

  it('tells the model the date and the countdown', () => {
    expect(todayLine(wed, '2026-09-30')).toBe(
      'Today is Wednesday 2026-09-23. Release date 2026-09-30: 5 working days left.',
    );
    expect(todayLine(wed, null)).toBe('Today is Wednesday 2026-09-23.');
  });
});
