import { matchJob, normalize } from '@application/job-watch/job-match';
import { JobPosting } from '@application/job-watch/job-board.interface';
import { DEFAULT_JOB_KEYWORDS } from '@application/job-watch/job-watch.config.interface';

const job = (over: Partial<JobPosting>): JobPosting => ({
  id: 'j1',
  title: 'Engineer',
  locations: ['Berlin, Germany'],
  department: 'Engineering',
  team: '',
  workplaceType: 'Hybrid',
  url: 'https://example.test/j1',
  publishedAt: null,
  ...over,
});

const filter = {
  locations: ['Berlin', 'Zurich'],
  keywords: DEFAULT_JOB_KEYWORDS,
};

const keywordsOf = (title: string) =>
  matchJob(job({ title }), filter)?.keywords ?? null;

describe('normalize', () => {
  it('drops accents, ł included, and punctuation', () => {
    expect(normalize('Zürich')).toBe(' zurich ');
    expect(normalize('Łódź, PL')).toBe(' lodz pl ');
    expect(normalize('Zürich')).toBe(' zurich ');
    expect(normalize('React-Native / iOS')).toBe(' react native ios ');
  });
});

describe('matchJob', () => {
  it.each([
    ['Senior React Native Developer', ['react native']],
    ['React-Native Engineer', ['react native']],
    ['Mobile Engineer (iOS/Android)', ['mobile', 'ios', 'android']],
    ['Senior JavaScript Engineer - Payments', ['javascript']],
    ['Front-end Developer', ['front end']],
    ['Full-Stack Engineer', ['full stack']],
    ['Senior Web Engineer', ['web']],
    ['ReactJS Developer', ['reactjs']],
    ['React.js Developer', ['react']],
    ['Next.js Developer', ['next js']],
  ])('matches "%s" by %j', (title, keywords) => {
    expect(keywordsOf(title)).toEqual(keywords);
  });

  it('keeps whole words only', () => {
    expect(keywordsOf('Test Scenarios Lead')).toBeNull();
    expect(keywordsOf('Reactor Physicist')).toBeNull();
    expect(keywordsOf('Webinar Producer')).toBeNull();
  });

  it('ignores postings without a matching role', () => {
    expect(keywordsOf('Staff Backend Engineer - Payments')).toBeNull();
  });

  it('ignores the role in other places', () => {
    expect(
      matchJob(
        job({ title: 'Mobile Engineer', locations: ['Lisbon, Portugal'] }),
        filter,
      ),
    ).toBeNull();
  });

  it('matches a place written with or without accents', () => {
    expect(
      matchJob(
        job({ title: 'Mobile Engineer', locations: ['Zürich, Switzerland'] }),
        filter,
      ),
    ).toEqual({ place: 'Zürich, Switzerland', keywords: ['mobile'] });
  });

  it('names the place that matched, not the first one', () => {
    expect(
      matchJob(
        job({
          title: 'Mobile Engineer',
          locations: ['Lisbon, Portugal', 'Berlin, Germany'],
        }),
        filter,
      ),
    ).toEqual({ place: 'Berlin, Germany', keywords: ['mobile'] });
  });

  it('matches anywhere when no place is configured', () => {
    expect(
      matchJob(job({ title: 'iOS Developer', locations: [] }), {
        ...filter,
        locations: [],
      }),
    ).toEqual({ place: '', keywords: ['ios'] });
  });

  it('reads the team as well as the title', () => {
    expect(
      matchJob(job({ title: 'Senior Engineer', team: 'Mobile Apps' }), filter)
        ?.keywords,
    ).toEqual(['mobile']);
  });
});
