import { Cloud, Folder, HardDrive, Network, Server } from "lucide-react";
import type { LocationKind } from "../lib/types";

// Placeholder glyphs; the drawn versions replace this file.

type Size = "xs" | "sm" | "md" | "lg";

interface UiLocationGlyphProps {
  kind: LocationKind["type"];
  size?: Size;
  /** Lit when the location is reachable. */
  connected?: boolean;
}

const icons = { folder: Folder, volume: HardDrive, ssh: Server, smb: Network, cloud: Cloud };
const sizes: Record<Size, string> = { xs: "size-4", sm: "size-5", md: "size-8", lg: "size-12" };

export function UiLocationGlyph({ kind, size = "sm", connected = false }: UiLocationGlyphProps) {
  const Icon = icons[kind];
  return <Icon className={`${sizes[size]} ${connected ? "text-accent" : "text-ink-faint"}`} strokeWidth={1.8} />;
}
