// Deutsche Texte, die überall gebraucht werden; Schlüssel und Funktionen wie in ../en/common.ts.

import type { Shape } from "..";
import type { common as source } from "../en/common";

export const common: Shape<typeof source> = {
  percent: (shown) => `${shown} %`,
  justNow: "gerade eben",
  reels: (count, shown) => `${shown} ${count === 1 ? "Spule" : "Spulen"}`,
  reelsBelow: (limit) => `< ${limit} Spulen`,
};
