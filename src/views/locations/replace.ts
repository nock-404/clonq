// Replacing a location that cannot be repaired in place (a moved folder, an expired
// cloud sign-in): the jobs move to a freshly added location, then the old one goes.
// The backend has no command to change a location, so this is done with the
// commands that exist: save every job again with the new place, then remove.

import type { ClonqState } from "../../hooks/useClonq";
import { api } from "../../lib/api";
import type { Job, JobInput, Location, Place } from "../../lib/types";

export function jobsUsing(state: ClonqState, locationId: string): Job[] {
  return (state.config?.jobs ?? []).filter((job) => job.source.location === locationId || job.target.location === locationId);
}

/**
 * The other locations of those jobs that are not reachable right now. Saving a job
 * checks both of its places, so these have to be reachable before the move.
 */
export function blockersOf(state: ClonqState, locationId: string): Location[] {
  const ids = new Set(
    jobsUsing(state, locationId)
      .flatMap((job) => [job.source.location, job.target.location])
      .filter((id) => id !== locationId && state.locations[id]?.reach.state !== "connected"),
  );
  return (state.config?.locations ?? []).filter((location) => ids.has(location.id));
}

function moved(place: Place, from: string, to: string): Place {
  return place.location === from ? { ...place, location: to } : place;
}

function inputOf(job: Job, from: string, to: string): JobInput {
  return {
    id: job.id,
    name: job.name,
    source: moved(job.source, from, to),
    target: moved(job.target, from, to),
    mode: job.mode,
    excludes: job.excludes,
    maxDeletePercent: job.safety.maxDeletePercent,
    ring: job.ring,
    triggers: job.triggers,
    enabled: job.enabled,
    archive: job.archive,
    conflicts: job.conflicts,
  };
}

/**
 * Moves every job from `from` to `to`, then removes `from`. Stops at the first job
 * that cannot be saved; calling it again carries on with the jobs that are left.
 */
export async function moveJobsAndRemove(state: ClonqState, from: string, to: string): Promise<void> {
  for (const job of jobsUsing(state, from)) {
    await api.saveJob(inputOf(job, from, to));
  }
  await api.removeLocation(from);
}
