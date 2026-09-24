// English texts shared across the app (formatting, generic words); the source every other language mirrors.

export const common = {
  percent: (shown: string) => `${shown}%`,
  justNow: "just now",
  never: "never",
  /** Tape reels as a unit of data: `count` decides the plural, `shown` is the formatted number. */
  reels: (count: number, shown: string) => `${shown} ${count === 1 ? "reel" : "reels"}`,
  reelsBelow: (limit: string) => `< ${limit} reels`,

  close: "Close",
  dismiss: "Dismiss",
  cancel: "Cancel",
  save: "Save",
  saving: "Saving…",
  choose: "Choose…",
  searchActions: "Search actions…",
  /** The two parts of a time field for assistive technology, e.g. "Start time, hours". */
  hours: (label: string) => `${label}, hours`,
  minutes: (label: string) => `${label}, minutes`,

  copy: "Copy",
  copyNamed: (name: string) => `Copy ${name}`,
  copied: "Copied to clipboard.",
  selectedForCopy: "Selected. Press ⌘C to copy.",

  status: {
    running: "Running",
    succeeded: "Succeeded",
    partial: "Finished with warnings",
    blocked: "Stopped",
    failed: "Failed",
    cancelled: "Cancelled",
  },
  mode: {
    mirror: "Mirror",
    backup: "Backup",
    blind: "Blind backup",
    bidirectional: "Two-way",
    versioned: "Versions",
  },
  locationKind: {
    folder: "Folder on this Mac",
    volume: "Drive",
    ssh: "Server (SSH)",
    smb: "Network share",
    cloud: "Cloud",
  },
  reach: {
    connected: "connected",
    disconnected: "not connected",
    missing: "folder missing",
    untested: "checking",
    failed: "no connection",
    unknown: "unknown",
  },
  unknownLocation: "unknown location",

  job: {
    checking: "checking…",
    unreachable: "Location unreachable",
    entries: (done: string, total: string) => `${done} / ${total} items`,
    remaining: (duration: string) => `${duration} left`,
  },
};
