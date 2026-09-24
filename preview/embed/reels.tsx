// A reel pair for the website: nothing but the running drive on a transparent page.
// ?style=licht|vakuum|praezision picks the reels, ?ring=red|yellow|blue|green|white the write ring,
// ?state=running|idle, ?transparent=1 inside an <iframe>. While running, the tape moves from one reel to the other in a loop.

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Reels, Ring } from "../../src/lib/types";
import "../../src/styles/app.css";
import { UiReelPair } from "../../src/ui/UiReelPair";
import { setReelStyle } from "../../src/ui/reels/style";

const params = new URLSearchParams(location.search);
const styles: Reels[] = ["licht", "vakuum", "praezision"];
const rings: Ring[] = ["red", "yellow", "blue", "green", "white"];
const style = styles.find((item) => item === params.get("style")) ?? (document.documentElement.dataset.style as Reels | undefined) ?? "licht";
const ring = rings.find((item) => item === params.get("ring")) ?? "blue";
const running = params.get("state") !== "idle";
/** One full pass of the tape from reel to reel, in milliseconds. */
const PASS_MS = 45_000;

setReelStyle(style);
// ?transparent=1 for an <iframe>: with the app's dark color scheme a browser would paint the
// frame opaque; a normal scheme and no background let the website show through.
if (params.get("transparent") === "1") {
  document.documentElement.style.colorScheme = "normal";
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
}

function Drive() {
  const [progress, setProgress] = useState(running ? 5 : 60);
  useEffect(() => {
    if (!running) return;
    const started = performance.now();
    const timer = setInterval(() => {
      const elapsed = (performance.now() - started) % PASS_MS;
      setProgress(5 + (elapsed / PASS_MS) * 90);
    }, 250);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <div className="h-[92vh]">
        <UiReelPair ring={ring} progress={progress} running={running} label="clonq" />
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <Drive />
  </StrictMode>,
);
