import type { ClonqState } from "../../hooks/useClonq";
import type { Location } from "../../lib/types";

// Placeholder; the full view replaces this file.

interface LocationDetailProps {
  state: ClonqState;
  location: Location;
  now: number;
}

export function LocationDetail({ location }: LocationDetailProps) {
  return <h1 className="text-xl font-semibold tracking-tight">{location.name}</h1>;
}
