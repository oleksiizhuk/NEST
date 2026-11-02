import { JobPosting } from '@application/job-watch/job-board.interface';

// Lower case without accents (ł too, which does not decompose), every run of
// punctuation or spaces as one space, padded, so a phrase is found only as
// whole words: "react-native" is "react native", "Zürich" is "zurich",
// "iOS" matches but "Scenarios" does not
export const normalize = (text: string): string =>
  ` ${(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;

const contains = (text: string, phrase: string): boolean => {
  const wanted = normalize(phrase);
  return wanted.trim().length > 0 && normalize(text).includes(wanted);
};

export interface JobHit {
  // The posting's place that matched (its first place when any place goes)
  place: string;
  keywords: string[];
}

// Why a posting is worth announcing, or null when it is not
export function matchJob(
  job: JobPosting,
  filter: { locations: string[]; keywords: string[] },
): JobHit | null {
  const place = filter.locations.length
    ? job.locations.find((where) =>
        filter.locations.some((wanted) => contains(where, wanted)),
      )
    : job.locations[0] ?? '';
  if (place === undefined) return null;
  const text = `${job.title} ${job.team}`;
  const hits = filter.keywords.filter((keyword) => contains(text, keyword));
  // "react native" says it all; "react" next to it is noise
  const keywords = hits.filter(
    (hit) =>
      !hits.some(
        (other) =>
          other !== hit && contains(other, hit) && !contains(hit, other),
      ),
  );
  return keywords.length ? { place, keywords } : null;
}
