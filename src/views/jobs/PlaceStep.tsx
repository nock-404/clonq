import { Plus, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { refreshLocations, type ClonqState } from "../../hooks/useClonq";
import { texts, useT } from "../../i18n";
import { api } from "../../lib/api";
import { formatBytes } from "../../lib/format";
import { locationDetail, messageLabel, placeLabel, reachLabel } from "../../lib/labels";
import type { Location, Place } from "../../lib/types";
import { UiButton, UiNotice } from "../../ui";
import { UiFormGroup } from "../../ui/UiFormGroup";
import { UiLamp } from "../../ui/UiLamp";
import { UiLocationGlyph } from "../../ui/UiLocationGlyph";
import { UiOptionCard } from "../../ui/UiOptionCard";
import { clashOf, jobsAt, overlapText, reachProblem, samePlace, stepLabel, trimPath } from "./draft";
import { FolderBrowser, type FolderMark } from "./FolderBrowser";

interface PlaceStepProps {
  role: "source" | "target";
  state: ClonqState;
  place: Place | null;
  /** The other end of the job, to see overlaps early. */
  other: Place | null;
  /** The job being edited; its own places do not count as used by another job. */
  jobId: string | null;
  onChange: (place: Place) => void;
  /** Opens the sheet for a new location; the wizard comes back afterwards. */
  onAddLocation: () => void;
  /** Told whether an opened folder could be read. */
  onReadable: (place: Place, readable: boolean) => void;
}

const REMOTE = new Set(["ssh", "smb", "cloud"]);

/** The address of a location, short enough for a narrow card; a server shows its host only. */
function shortDetail(location: Location): string {
  return location.kind.type === "ssh" ? location.kind.host : locationDetail(location);
}

/** Text that may wrap after a slash or a dot, as paths and host names should, rather than anywhere. */
function Breakable({ text }: { text: string }) {
  const parts = text.split(/(?<=[/.])/);
  return (
    <>
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < parts.length - 1 ? <wbr /> : null}
        </span>
      ))}
    </>
  );
}

/** A short state for the card: free space when it can be used, otherwise what stands in the way. */
function cardState(location: Location, state: ClonqState, checking: boolean) {
  const reach = state.locations[location.id]?.reach;
  if (reach?.state === "connected") {
    const t = texts();
    return { text: reach.freeBytes !== null ? t.wizard.place.free(formatBytes(reach.freeBytes)) : t.common.reach.connected, tone: "ok" as const, busy: false, usable: true };
  }
  const label = reachLabel(reach);
  return { text: checking ? texts().common.reach.untested : label.text, tone: label.tone, busy: checking || reach?.state === "untested", usable: false };
}

/** Step 1 and 2: which location, and which folder inside it. */
export function PlaceStep({ role, state, place, other, jobId, onChange, onAddLocation, onReadable }: PlaceStepProps) {
  const t = useT();
  const p = t.wizard.place;
  const [checking, setChecking] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const autoChecked = useRef(new Set<string>());
  const config = state.config;
  const locations = config?.locations ?? [];
  const chosen = place ? locations.find((location) => location.id === place.location) : undefined;
  const reach = chosen ? state.locations[chosen.id]?.reach : undefined;
  const problem = chosen ? reachProblem(chosen, state) : null;
  const clash = place ? clashOf(place, role, other, state) : null;
  const otherWord = stepLabel(role === "target" ? 0 : 1);

  const check = async (id: string) => {
    setChecking(id);
    setCheckError(null);
    try {
      await api.testLocation(id);
      await refreshLocations();
    } catch (error) {
      setCheckError(messageLabel(String(error)));
    } finally {
      setChecking(null);
    }
  };

  // A server, share or cloud that has not been tried yet is tried as soon as it is chosen.
  useEffect(() => {
    if (!chosen || !REMOTE.has(chosen.kind.type) || reach?.state !== "untested" || autoChecked.current.has(chosen.id)) return;
    autoChecked.current.add(chosen.id);
    void check(chosen.id);
  }, [chosen, reach?.state]);

  const markOf = (path: string): FolderMark => {
    if (!chosen) return { clash: null, uses: [] };
    const here = { location: chosen.id, path };
    return { clash: clashOf(here, role, other, state) ? otherWord : null, uses: jobsAt(here, config, jobId) };
  };

  // In the grid a card shows the address too; in the narrow list beside the folders only the state.
  const card = (location: Location, compact: boolean) => {
    const status = cardState(location, state, checking === location.id);
    const statusLine = (
      <span className="flex items-center gap-1.5">
        <UiLamp tone={status.usable ? "neutral" : status.tone} busy={status.busy} />
        {status.text}
      </span>
    );
    return (
      <UiOptionCard
        key={location.id}
        art={<UiLocationGlyph kind={location.kind.type} size="md" connected={status.usable} busy={status.busy} />}
        title={location.name}
        description={
          compact ? (
            statusLine
          ) : (
            <span className="flex flex-col">
              <span>
                <Breakable text={shortDetail(location)} />
              </span>
              {statusLine}
            </span>
          )
        }
        selected={place?.location === location.id}
        disabled={role === "source" && location.kind.type === "ssh"}
        onPress={() => {
          if (place?.location !== location.id) onChange({ location: location.id, path: "" });
        }}
      />
    );
  };

  const addCard = (
    <div className="hairline-dashed flex min-h-[3.75rem] items-center rounded-[var(--radius-panel)] px-1.5">
      <UiButton variant="ghost" icon={Plus} onPress={onAddLocation}>
        {p.addLocation}
      </UiButton>
    </div>
  );
  const placesLabel = role === "source" ? p.sourceLocation : p.targetLocation;

  // Nothing chosen yet: every location as a card, and for the source the places other jobs copy from.
  if (!chosen) {
    const known = role === "source" ? knownSources(state, jobId) : [];
    return (
      <div className="flex h-full flex-col gap-3 overflow-y-auto">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={placesLabel}>
          {locations.map((location) => card(location, false))}
          {addCard}
        </div>
        {known.length > 0 ? (
          <UiFormGroup title={p.knownTitle} aside={p.knownAside}>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={p.knownLabel}>
              {known.map((entry) => (
                <UiOptionCard
                  key={`${entry.place.location}/${entry.place.path}`}
                  art={<UiLocationGlyph kind={entry.location.kind.type} size="sm" connected />}
                  title={placeLabel(entry.place, config)}
                  description={entry.users.length === 1 ? t.wizard.folders.sourceOf(entry.users[0] ?? "") : p.sourceOfJobs(entry.users.length)}
                  selected={false}
                  onPress={() => onChange(entry.place)}
                />
              ))}
            </div>
          </UiFormGroup>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-[15.5rem_minmax(0,1fr)] gap-4">
      <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto" role="radiogroup" aria-label={placesLabel}>
        {locations.map((location) => card(location, true))}
        <div className="pt-1">
          <UiButton variant="ghost" icon={Plus} onPress={onAddLocation}>
            {p.addLocation}
          </UiButton>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-col gap-2">
        {problem ? (
          <Unreachable
            location={chosen}
            text={problem}
            failure={reach?.state === "failed" ? messageLabel(reach.message) : checkError}
            checking={checking === chosen.id}
            canCheck={REMOTE.has(chosen.kind.type)}
            onCheck={() => void check(chosen.id)}
            drive={chosen.kind.type === "volume" && reach?.state === "disconnected"}
          />
        ) : (
          <FolderBrowser
            key={chosen.id}
            location={chosen}
            path={place?.path ?? ""}
            onPath={(path) => onChange({ location: chosen.id, path })}
            markOf={markOf}
            onReadable={(path, readable) => onReadable({ location: chosen.id, path }, readable)}
          />
        )}
        {clash && place ? (
          <UiNotice tone="danger">{overlapText(clash, role, other ? placeLabel(other, config) : "")}</UiNotice>
        ) : null}
      </div>
    </div>
  );
}

interface UnreachableProps {
  location: Location;
  text: string;
  failure: string | null;
  checking: boolean;
  canCheck: boolean;
  onCheck: () => void;
  drive: boolean;
}

/** In place of the folders: why the location cannot be opened, and what helps. */
function Unreachable({ location, text, failure, checking, canCheck, onCheck, drive }: UnreachableProps) {
  const p = useT().wizard.place;
  return (
    <div className="hairline flex flex-1 flex-col items-center justify-center gap-3 rounded-[var(--radius-panel)] bg-well px-8 text-center">
      <UiLocationGlyph kind={location.kind.type} size="lg" connected={false} busy={checking} />
      <div className="flex max-w-[24rem] flex-col gap-1">
        <span className="text-[0.8125rem] font-medium text-ink">{checking ? p.checkingName(location.name) : text}</span>
        {!checking && failure ? <span className="text-xs text-danger">{failure}</span> : null}
        {!checking && drive ? <span className="text-xs text-ink-faint">{p.driveHint}</span> : null}
      </div>
      {canCheck ? (
        <UiButton variant="secondary" icon={RotateCw} disabled={checking} onPress={onCheck}>
          {checking ? p.checking : p.check}
        </UiButton>
      ) : null}
    </div>
  );
}

interface KnownSource {
  place: Place;
  location: Location;
  /** The jobs that copy from it, as quoted names. */
  users: string[];
}

/** Places that other jobs already copy from, each once. */
function knownSources(state: ClonqState, jobId: string | null): KnownSource[] {
  const config = state.config;
  const found: KnownSource[] = [];
  for (const job of config?.jobs ?? []) {
    if (job.id === jobId) continue;
    const location = config?.locations.find((item) => item.id === job.source.location);
    if (!location || state.locations[location.id]?.reach.state !== "connected") continue;
    if (found.some((entry) => samePlace(entry.place, job.source))) continue;
    const users = (config?.jobs ?? []).filter((item) => item.id !== jobId && samePlace(item.source, job.source)).map((item) => texts().wizard.quote(item.name));
    found.push({ place: { location: job.source.location, path: trimPath(job.source.path) }, location, users });
  }
  return found.slice(0, 4);
}
