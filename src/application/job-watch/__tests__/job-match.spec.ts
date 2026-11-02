import { matchJob } from '@application/job-watch/job-match';
import { JobPosting } from '@application/job-watch/job-board.interface';
import { DEFAULT_JOB_KEYWORDS } from '@application/job-watch/job-watch.config.interface';

const job = (over: Partial<JobPosting>): JobPosting => ({
  id: 'j1',
  title: 'Engineer',
  locations: ['Warsaw, Poland'],
  department: 'Product & Technology',
  team: '',
  workplaceType: 'Hybrid',
  url: 'https://example.test/j1',
  publishedAt: null,
  ...over,
});

const filter = {
  locations: ['Warsaw', 'Warszawa'],
  keywords: DEFAULT_JOB_KEYWORDS,
};

describe('matchJob', () => {
  it.each([
    ['Senior React Native Developer', ['react native']],
    ['React-Native Engineer', ['react native']],
    ['Mobile Engineer (iOS/Android)', ['mobile', 'ios', 'android']],
    ['Senior JavaScript Engineer - Gaming', ['javascript']],
    ['Front-end Developer', ['front end']],
    ['Full-Stack Engineer', ['full stack']],
  ])('matches "%s" by %j', (title, keywords) => {
    expect(matchJob(job({ title }), filter)).toEqual(keywords);
  });

  it('keeps whole words only', () => {
    expect(matchJob(job({ title: 'Test Scenarios Lead' }), filter)).toBeNull();
    expect(matchJob(job({ title: 'Reactor Physicist' }), filter)).toBeNull();
  });

  it('ignores postings without a matching role', () => {
    expect(
      matchJob(job({ title: 'Staff Backend Engineer - Sports' }), filter),
    ).toBeNull();
  });

  it('ignores the role in other places', () => {
    expect(
      matchJob(
        job({ title: 'Mobile Engineer', locations: ['Málaga, Spain'] }),
        filter,
      ),
    ).toBeNull();
  });

  it('accepts any of the places a posting names', () => {
    expect(
      matchJob(
        job({
          title: 'Mobile Engineer',
          locations: ['Stockholm, Sweden', 'Warsaw, Poland'],
        }),
        filter,
      ),
    ).toEqual(['mobile']);
  });

  it('matches anywhere when no place is configured', () => {
    expect(
      matchJob(job({ title: 'iOS Developer', locations: [] }), {
        ...filter,
        locations: [],
      }),
    ).toEqual(['ios']);
  });

  it('reads the team as well as the title', () => {
    expect(
      matchJob(job({ title: 'Senior Engineer', team: 'Mobile Apps' }), filter),
    ).toEqual(['mobile']);
  });
});
