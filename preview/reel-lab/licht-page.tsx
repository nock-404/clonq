// Reel lab, variant "Licht": smoked-glass reels with wide windows, a machined head on a brushed plate.
// Open /preview/reel-lab/licht.html?state=running|idle|empty in the Vite dev server.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Ring } from "../../src/lib/types";
import "../../src/styles/app.css";
import "./lab.css";
import { UiReel } from "../../src/ui/reels/licht/UiReel";
import { UiReelPair } from "../../src/ui/reels/licht/UiReelPair";

type State = "running" | "idle" | "empty";

const STATES: Record<State, { progress: number; running: boolean; label: string }> = {
  running: { progress: 62, running: true, label: "Tape running" },
  idle: { progress: 100, running: false, label: "Tape stopped" },
  empty: { progress: 0, running: false, label: "Empty tape" },
};

const params = new URLSearchParams(location.search);
const param = params.get("state");
const state: State = param === "idle" || param === "empty" ? param : "running";
// ?freeze=1 holds all motion on its first frame, so stills are repeatable.
const freeze = params.get("freeze") === "1";
const current = STATES[state];

const SIZES = ["xs", "sm", "md", "lg"] as const;
const RINGS: Ring[] = ["blue", "red"];
const ROWS: { name: string; ring: Ring }[] = [
  { name: "WORK → M2mini", ring: "blue" },
  { name: "WORK → Storage Box", ring: "green" },
  { name: "M2mini → Storage Box", ring: "red" },
  { name: "Fotos → NAS", ring: "yellow" },
  { name: "Mail → Archiv", ring: "white" },
];

function Caption({ children }: { children: string }) {
  return <p className="text-[0.6875rem] font-medium tracking-wide text-ink-faint uppercase">{children}</p>;
}

function LabPage() {
  return (
    <div className={`licht-desktop h-full w-full p-5 ${freeze ? "licht-freeze" : ""}`}>
      <div className="hairline flex h-full gap-8 overflow-hidden rounded-xl bg-canvas px-7 py-5">
        <div className="flex w-[27rem] shrink-0 flex-col gap-5">
          <Caption>{`Licht · ${state}`}</Caption>

          <div className="flex gap-4">
            <section className="hairline flex flex-col items-center gap-3 rounded-[var(--radius-panel)] bg-well px-5 pt-4 pb-3">
              <div className="h-64">
                <UiReelPair ring="blue" progress={current.progress} running={current.running} label={current.label} />
              </div>
            </section>

            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {ROWS.map((row, index) => (
                <div
                  key={row.name}
                  className={`flex items-center gap-2.5 rounded-[var(--radius-control)] px-2 py-1.5 ${index === 0 ? "bg-selected" : ""}`}
                >
                  <UiReel size="xs" ring={row.ring} spinning={index === 0 && current.running} />
                  <span className="truncate">{row.name}</span>
                </div>
              ))}
              <div className="mt-3 flex flex-col gap-1">
                {ROWS.slice(0, 3).map((row, index) => (
                  <div key={row.name} className="flex items-center gap-3 px-2 py-1">
                    <UiReel size="sm" ring={row.ring} spinning={index === 0 && current.running} fill={index === 0 ? 0.45 : 0.85} />
                    <span className="truncate text-ink-soft">{row.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Caption>Single reel · xs sm md lg · still, spinning</Caption>
            {RINGS.map((ring) => (
              <div key={ring} className="flex items-center gap-4">
                {[false, true].map((spinning) =>
                  SIZES.map((size) => (
                    <UiReel key={`${size}-${spinning}`} size={size} ring={ring} spinning={spinning} fill={spinning ? 0.45 : 0.85} />
                  )),
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="relative h-160 shrink-0">
          <div className="absolute top-0 -left-6">
            <Caption>2.5×</Caption>
          </div>
          <UiReelPair ring="blue" progress={current.progress} running={current.running} label={current.label} />
        </div>
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing in licht.html");

createRoot(root).render(
  <StrictMode>
    <LabPage />
  </StrictMode>,
);
