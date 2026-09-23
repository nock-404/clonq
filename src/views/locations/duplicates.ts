// Finds locations that already exist, so the flow can stop before adding the same thing twice.

import type { CloudProvider, Config, Location } from "../../lib/types";

function locations(config: Config | null): Location[] {
  return config?.locations ?? [];
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Another location with this name, ignoring case. */
export function nameTaken(config: Config | null, name: string, except?: string): Location | undefined {
  if (name.trim() === "") return undefined;
  return locations(config).find((location) => location.id !== except && same(location.name, name));
}

export function sameFolder(config: Config | null, path: string): Location | undefined {
  const clean = path.replace(/\/+$/, "");
  return locations(config).find((location) => location.kind.type === "folder" && location.kind.path.replace(/\/+$/, "") === clean);
}

export function sameServer(config: Config | null, host: string, user: string, port: number): Location | undefined {
  return locations(config).find(
    (location) => location.kind.type === "ssh" && same(location.kind.host, host) && same(location.kind.user, user) && location.kind.port === port,
  );
}

/** "smb://NAS.local/Fotos/" and "smb://nas.local/Fotos" are the same share. */
function shareKey(url: string): string {
  const match = url.trim().replace(/\/+$/, "").match(/^smb:\/\/([^/\s]+)\/(.+)$/i);
  return match ? `${(match[1] ?? "").toLowerCase()}/${match[2] ?? ""}` : url.trim();
}

export function sameShare(config: Config | null, url: string): Location | undefined {
  const key = shareKey(url);
  return locations(config).find((location) => location.kind.type === "smb" && shareKey(location.kind.url) === key);
}

/** The same provider and start folder; it may still be another account, so this only warns. */
export function sameCloud(config: Config | null, provider: CloudProvider, root: string): Location | undefined {
  const clean = root.trim().replace(/^\/+|\/+$/g, "");
  return locations(config).find(
    (location) => location.kind.type === "cloud" && location.kind.provider === provider && location.kind.root.replace(/^\/+|\/+$/g, "") === clean,
  );
}
