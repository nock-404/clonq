// English texts shared across the app (formatting, generic words); the source every other language mirrors.

export const common = {
  percent: (shown: string) => `${shown}%`,
  justNow: "just now",
  /** Tape reels as a unit of data: `count` decides the plural, `shown` is the formatted number. */
  reels: (count: number, shown: string) => `${shown} ${count === 1 ? "reel" : "reels"}`,
  reelsBelow: (limit: string) => `< ${limit} reels`,
};
