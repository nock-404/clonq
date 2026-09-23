import { LayoutList } from "lucide-react";
import { LayoutGroup } from "motion/react";
import { useMemo } from "react";
import type { ClonqState } from "../hooks/useClonq";
import { lastDryRunByJob } from "../lib/runs";
import { UiEmpty } from "../ui";
import { JobCard } from "./JobCard";

interface JobListProps {
  state: ClonqState;
}

export function JobList({ state }: JobListProps) {
  const dryRuns = useMemo(() => lastDryRunByJob(state.recent), [state.recent]);
  const jobs = state.config?.jobs ?? [];
  if (state.config && jobs.length === 0) {
    return <UiEmpty icon={LayoutList} title="Noch keine Jobs" />;
  }
  return (
    <LayoutGroup>
      <div className="flex flex-col gap-2">
        {jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            live={state.live[job.id]}
            latest={state.latest[job.id]}
            lastDryRun={dryRuns[job.id]}
          />
        ))}
      </div>
    </LayoutGroup>
  );
}
