import { JobPosting } from '@application/job-watch/job-board.interface';

// Lower case, every run of punctuation or spaces as one space, padded, so a
// phrase is found only as whole words: "react-native" is "react native",
// "iOS" matches but "Scenarios" does not
export const normalize = (text: string): string =>
  ` ${(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;

const contains = (text: string, phrase: string): boolean => {
  const wanted = normalize(phrase);
  return wanted.trim().length > 0 && normalize(text).includes(wanted);
};

// The keywords a posting matched, or null when it is not one to announce
export function matchJob(
  job: JobPosting,
  filter: { locations: string[]; keywords: string[] },
): string[] | null {
  const placed =
    !filter.locations.length ||
    job.locations.some((place) =>
      filter.locations.some((wanted) => contains(place, wanted)),
    );
  if (!placed) return null;
  const text = `${job.title} ${job.team}`;
  const hits = filter.keywords.filter((keyword) => contains(text, keyword));
  // "react native" says it all; "react" next to it is noise
  const shown = hits.filter(
    (hit) =>
      !hits.some(
        (other) =>
          other !== hit && contains(other, hit) && !contains(hit, other),
      ),
  );
  return shown.length ? shown : null;
}
