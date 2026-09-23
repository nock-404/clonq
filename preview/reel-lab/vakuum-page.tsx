// Reel lab, variant "Vakuumsäulen": open /preview/reel-lab/vakuum.html?state=running|idle|empty
// in the Vite dev server.

import { createRoot } from "react-dom/client";
import "../../src/styles/app.css";
import "./lab.css";
import type { Ring } from "../../src/lib/types";
import { UiReel } from "../../src/ui/reels/vakuum/UiReel";
import { UiReelPair } from "../../src/ui/reels/vakuum/UiReelPair";

type State = "running" | "idle" | "empty";

const states: Record<State, { title: string; progress: number; running: boolean; label: string }> = {
  running: { title: "Läuft", progress: 62, running: true, label: "Band läuft" },
  idle: { title: "Fertig", progress: 100, running: false, label: "Band steht" },
  empty: { title: "Leer", progress: 0, running: false, label: "Leeres Band" },
};

const param = new URLSearchParams(location.search).get("state");
const state: State = param === "idle" || param === "empty" ? param : "running";
const current = states[state];

const rings: Ring[] = ["red", "yellow", "blue", "green", "white"];
const ringParam = new URLSearchParams(location.search).get("ring");
const loupeRing: Ring = rings.find((ring) => ring === ringParam) ?? "blue";

const sizes = ["xs", "sm", "md", "lg"] as const;

const jobs: { name: string; ring: Ring; running: boolean }[] = [
  { name: "WORK → M2mini", ring: "blue", running: true },
  { name: "WORK → Storage Box", ring: "green", running: false },
  { name: "M2mini → Storage Box", ring: "red", running: false },
  { name: "Fotos → NAS", ring: "yellow", running: false },
  { name: "Dokumente → Cloud", ring: "white", running: false },
];

function Caption({ children }: { children: string }) {
  return <div className="text-[0.6875rem] font-medium tracking-wide text-ink-faint uppercase">{children}</div>;
}

function Panel({ ring }: { ring: Ring }) {
  return (
    <section className="hairline flex flex-col items-center gap-3 rounded-[var(--radius-panel)] bg-well px-5 pt-4 pb-3">
      <div className="h-64">
        <UiReelPair ring={ring} progress={current.progress} running={current.running} label={current.label} />
      </div>
    </section>
  );
}

function Lab() {
  return (
    <div className="vakuum-desktop h-full w-full">
      <div className="flex h-full w-full flex-col gap-3 bg-canvas px-5 py-4">
        <header className="flex items-baseline gap-4">
          <h1 className="text-base font-semibold tracking-tight">Vakuumsäulen</h1>
          <nav className="flex gap-1">
            {(Object.keys(states) as State[]).map((key) => (
              <a
                key={key}
                href={`?state=${key}${ringParam ? `&ring=${ringParam}` : ""}`}
                className={`rounded-[var(--radius-control)] px-2 py-0.5 ${key === state ? "bg-selected text-ink" : "text-ink-soft hover:bg-hover"}`}
              >
                {states[key].title}
              </a>
            ))}
          </nav>
          <span className="text-ink-faint">Fortschritt {current.progress} %</span>
        </header>

        <div className="flex min-h-0 flex-1 gap-6">
          <div className="flex w-[27rem] shrink-0 flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Caption>Detailbereich, Originalgröße (h-64)</Caption>
              <div className="flex gap-3">
                <Panel ring="blue" />
                <Panel ring="yellow" />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Caption>Einzelspule xs · sm · md · lg, steht | läuft</Caption>
              <div className="hairline flex flex-col gap-2 rounded-[var(--radius-panel)] bg-well px-3 py-2.5">
                {(["blue", "red"] as const).map((ring) => (
                  <div key={ring} className="flex items-center gap-3">
                    {[false, true].map((spinning) => (
                      <div key={String(spinning)} className={`flex items-center gap-3 ${spinning ? "" : "hairline-r pr-3"}`}>
                        {sizes.map((size) => (
                          <UiReel key={size} ring={ring} size={size} spinning={spinning} fill={spinning ? 0.45 : 0.8} label={`${ring} ${size}`} />
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex flex-col gap-2">
                <Caption>Seitenleiste (xs)</Caption>
                <div className="hairline flex w-52 flex-col gap-0.5 rounded-[var(--radius-panel)] bg-well p-1.5">
                  {jobs.slice(0, 4).map((job) => (
                    <div key={job.name} className={`flex items-center gap-2 rounded-[var(--radius-control)] px-2 py-1 ${job.running ? "bg-selected" : ""}`}>
                      <UiReel ring={job.ring} size="xs" spinning={job.running} />
                      <span className="truncate">{job.name}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Caption>Popover (sm)</Caption>
                <div className="hairline flex flex-col gap-0.5 rounded-[var(--radius-panel)] bg-well p-1.5">
                  {jobs.slice(0, 3).concat(jobs.slice(4)).map((job) => (
                    <div key={job.name} className="flex items-center gap-2.5 px-2 py-0.5">
                      <UiReel ring={job.ring} spinning={job.running} fill={job.running ? 0.55 : 0.8} />
                      <span className="truncate text-ink-soft">{job.name.split(" → ")[1]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <Caption>Lupe 2,5-fach</Caption>
            <div className="hairline h-160 rounded-[var(--radius-panel)] bg-well px-5">
              <UiReelPair ring={loupeRing} progress={current.progress} running={current.running} label={current.label} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Lab />);
