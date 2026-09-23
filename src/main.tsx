import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { startUpdateChecks } from "./lib/update";
import "./styles/app.css";
import { MainWindow } from "./views/MainWindow";
import { Popover } from "./views/Popover";

// Both windows load the same page; the label decides what it shows.
const isPopover = getCurrentWindow().label === "popover";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing in index.html");

startUpdateChecks();

createRoot(root).render(<StrictMode>{isPopover ? <Popover /> : <MainWindow />}</StrictMode>);
