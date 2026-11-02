import { AshbyJobBoard } from '@infrastructure/job-watch/ashby-job-board';
import { readFileSync } from 'fs';
import { join } from 'path';

const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'ashby-board.json'), 'utf8'),
);

const respond = (status: number, body: unknown) =>
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);

describe('AshbyJobBoard', () => {
  afterEach(() => jest.restoreAllMocks());

  it('maps a real-shaped board and drops unlisted postings', async () => {
    const fetchSpy = respond(200, fixture);
    const jobs = await new AshbyJobBoard().list('acme');

    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://api.ashbyhq.com/posting-api/job-board/acme',
    );
    expect(jobs.map((j) => j.title)).toEqual([
      'Senior React Native Engineer',
      'Data Engineer',
    ]);
    expect(jobs[0]).toMatchObject({
      team: 'Mobile',
      workplaceType: 'Hybrid',
      locations: ['Berlin, Germany', 'München, Germany', 'Berlin', 'Germany'],
      url: 'https://jobs.ashbyhq.com/acme/6f1b9a52-0c3e-4f8e-9d1a-2b7c5e8f0a11',
    });
    // Missing fields become empty, never "null" or a crash
    expect(jobs[1]).toMatchObject({
      team: '',
      workplaceType: '',
      locations: ['Lisbon, Portugal'],
      url: 'https://jobs.ashbyhq.com/acme/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
      publishedAt: null,
    });
  });

  it('fails loudly on an unknown board', async () => {
    respond(404, {});
    await expect(new AshbyJobBoard().list('nope')).rejects.toThrow(
      'Ashby responded 404',
    );
  });

  it('fails loudly on an unexpected body', async () => {
    respond(200, { message: 'maintenance' });
    await expect(new AshbyJobBoard().list('acme')).rejects.toThrow(
      'no job list',
    );
  });
});
