// Preview only (Orte): every location glyph in every size and lamp state, on the
// surfaces it appears on, so the drawings can be judged side by side. ?glyphs=1

import { UiLocationGlyph, type GlyphKind } from "../src/ui/UiLocationGlyph";

const KINDS: GlyphKind[] = ["folder", "volume", "ssh", "smb", "cloud", "webdav"];
const SIZES = ["xs", "sm", "md", "lg"] as const;
const SURFACES = ["bg-canvas", "bg-raised", "bg-accent-soft"];
const LAMPS = [
  { key: "off", props: {} },
  { key: "on", props: { connected: true } },
  { key: "busy", props: { busy: true } },
  { key: "fault", props: { failed: true } },
  { key: "dimmed", props: { dimmed: true } },
];

export function OrteGlyphs() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col gap-5 overflow-auto bg-raised p-6 text-ink">
      <div className="flex gap-4">
        {SURFACES.map((surface) => (
          <div key={surface} className={`hairline flex flex-col gap-1.5 rounded-[var(--radius-panel)] p-2 ${surface}`}>
            {LAMPS.map((lamp) => (
              <div key={lamp.key} className="flex items-center gap-2">
                {KINDS.map((kind) => (
                  <span key={kind} className="flex items-center gap-1">
                    <UiLocationGlyph kind={kind} size="xs" {...lamp.props} />
                    <UiLocationGlyph kind={kind} size="sm" {...lamp.props} />
                  </span>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {KINDS.map((kind) => (
          <div key={kind} className="flex items-center gap-4">
            {SURFACES.map((surface) => (
              <div key={surface} className={`hairline flex items-end gap-3 rounded-[var(--radius-panel)] p-2 ${surface}`}>
                {SIZES.map((size) => (
                  <UiLocationGlyph key={size} kind={kind} size={size} connected={size === "lg"} failed={size === "md" && surface === "bg-raised"} />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
