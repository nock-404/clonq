// Dev-only lab for the reel variant "Präzision".
// Open /preview/reel-lab/praezision.html?state=running|idle|empty in the Vite dev server.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles/app.css";
import "./lab.css";
import type { Ring } from "../../src/lib/types";
import { UiReel } from "../../src/ui/reels/praezision/UiReel";
import { UiReelPair } from "../../src/ui/reels/praezision/UiReelPair";

type LabState = "running" | "idle" | "empty";

const STATES: Record<LabState, { progress: number; running: boolean; title: string }> = {
  running: { progress: 62, running: true, title: "Läuft, 62 %" },
  idle: { progress: 100, running: false, title: "Fertig" },
  empty: { progress: 0, running: false, title: "Leer" },
};

const params = new URLSearchParams(location.search);
const requested = params.get("state");
const state: LabState = requested === "idle" || requested === "empty" ? requested : "running";
const current = STATES[state];

const SIZES = ["xs", "sm", "md", "lg"] as const;
const RINGS: Ring[] = ["blue", "red"];
const LIST_RINGS: Ring[] = ["blue", "green", "red", "yellow", "white"];

function Caption({ children }: { children: string }) {
  return <div className="text-[0.6875rem] font-medium tracking-wide text-ink-faint uppercase">{children}</div>;
}

function Lab() {
  return (
    <div className="praezision-desktop flex h-full items-start justify-center p-3">
      <div className="hairline flex gap-6 rounded-[var(--radius-panel)] bg-canvas p-4">
        <div className="flex w-[29rem] flex-col gap-5">
          <div className="flex items-baseline justify-between">
            <div className="text-[0.9375rem] font-semibold tracking-tight">Präzision</div>
            <nav className="flex gap-1">
              {(Object.keys(STATES) as LabState[]).map((key) => (
                <a
                  key={key}
                  href={`?state=${key}`}
                  className={`rounded-[var(--radius-control)] px-2 py-0.5 text-[0.75rem] ${key === state ? "bg-selected text-ink" : "text-ink-soft hover:bg-hover"}`}
                >
                  {STATES[key].title}
                </a>
              ))}
            </nav>
          </div>

          <div className="flex gap-5">
            <section className="hairline flex flex-col items-center gap-3 rounded-[var(--radius-panel)] bg-well px-5 pt-4 pb-3">
              <div className="h-64">
                <UiReelPair ring="blue" progress={current.progress} running={current.running} label={current.running ? "Band läuft" : "Band steht"} />
              </div>
            </section>

            <div className="flex flex-col gap-4">
              <Caption>Einzelspule</Caption>
              {RINGS.map((ring) =>
                [false, true].map((spinning) => (
                  <div key={`${ring}-${spinning}`} className="flex items-center gap-3">
                    {SIZES.map((size) => (
                      <UiReel key={size} ring={ring} size={size} spinning={spinning} fill={spinning ? 0.55 : 0.8} />
                    ))}
                  </div>
                )),
              )}
            </div>
          </div>

          <div className="flex gap-5">
            <div className="flex w-56 flex-col gap-1">
              <Caption>Seitenleiste</Caption>
              {LIST_RINGS.slice(0, 3).map((ring, i) => (
                <div key={ring} className={`flex items-center gap-2.5 rounded-[var(--radius-control)] px-2 py-1.5 ${i === 0 ? "bg-selected" : ""}`}>
                  <UiReel ring={ring} size="xs" spinning={i === 0 && current.running} />
                  <span className="text-ink">{["WORK → M2mini", "WORK → Storage Box", "M2mini → Storage Box"][i]}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Caption>Menüleiste</Caption>
              {LIST_RINGS.slice(1).map((ring, i) => (
                <div key={ring} className="flex items-center gap-2.5 px-1 py-1">
                  <UiReel ring={ring} size="sm" fill={0.3 + i * 0.2} />
                  <span className="text-ink-soft">{["Fotos", "Projekte", "Archiv", "Mail"][i]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="hairline relative rounded-[var(--radius-panel)] bg-well px-4 py-3">
          <div className="absolute top-3 left-4">
            <Caption>Detail 2,5×</Caption>
          </div>
          <div className="h-160">
            <UiReelPair ring="blue" progress={current.progress} running={current.running} label="Detailansicht" />
          </div>
        </div>
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Lab />
    </StrictMode>,
  );
}
