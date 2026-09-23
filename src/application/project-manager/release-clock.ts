// Working days (Mon–Fri) from tomorrow up to and including the release day.
export const workingDaysLeft = (today: Date, releaseDate: string): number => {
  const end = new Date(`${releaseDate}T00:00:00Z`);
  const day = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  let count = 0;
  while (day < end) {
    day.setUTCDate(day.getUTCDate() + 1);
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
};

// The line that goes in front of every question: the model has no clock.
export const todayLine = (now: Date, releaseDate: string | null): string => {
  const date = now.toISOString().slice(0, 10);
  const weekday = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    timeZone: 'UTC',
  });
  if (!releaseDate) return `Today is ${weekday} ${date}.`;
  return (
    `Today is ${weekday} ${date}. Release date ${releaseDate}: ` +
    `${workingDaysLeft(now, releaseDate)} working days left.`
  );
};
