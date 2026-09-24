// Every user-facing word for states and modes, in one place. The words come from the
// catalog at call time, because the language can change while the app runs.

import { locale, texts } from "../i18n";
import { formatDate } from "./format";
import type { Config, Location, Mode, Place, Reach, RunStatus } from "./types";

export function statusLabel(status: RunStatus): string {
  return texts().common.status[status];
}

export function modeLabel(mode: Mode): string {
  return texts().common.mode[mode];
}

export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger";

export const statusTone: Record<RunStatus, Tone> = {
  running: "accent",
  succeeded: "ok",
  partial: "warn",
  blocked: "warn",
  failed: "danger",
  cancelled: "neutral",
};

const HOME = /^\/Users\/[^/]+/;

export function locationOf(place: Place, config: Config | null): Location | undefined {
  return config?.locations.find((location) => location.id === place.location);
}

/** "M2mini/WORK", "Storage Box/M2mini", "Desktop" – a location name plus the path inside it. */
export function placeLabel(place: Place, config: Config | null): string {
  const location = locationOf(place, config);
  const name = location?.name ?? texts().common.unknownLocation;
  const path = place.path.replace(/^\/+|\/+$/g, "");
  return path ? `${name}/${path}` : name;
}

export function locationKindLabel(kind: Location["kind"]["type"]): string {
  return texts().common.locationKind[kind];
}

export function locationDetail(location: Location): string {
  switch (location.kind.type) {
    case "folder":
      return location.kind.path.replace(HOME, "~");
    case "volume":
      return `/Volumes/${location.kind.volumeName}`;
    case "ssh":
      return `${location.kind.user}@${location.kind.host}:${location.kind.port}`;
    case "smb":
      return location.kind.url;
    case "cloud":
      return `${location.kind.remote}:${location.kind.root}`;
  }
}

export function reachLabel(reach: Reach | undefined): { text: string; tone: Tone } {
  const t = texts().common.reach;
  switch (reach?.state) {
    case "connected":
      return { text: t.connected, tone: "ok" };
    case "disconnected":
      return { text: t.disconnected, tone: "neutral" };
    case "missing":
      return { text: t.missing, tone: "danger" };
    case "untested":
      return { text: t.untested, tone: "neutral" };
    case "failed":
      return { text: t.failed, tone: "danger" };
    default:
      return { text: t.unknown, tone: "neutral" };
  }
}

/** Messages come from the Rust side in terse English; the known ones get a proper sentence in the interface language. */
export function messageLabel(message: string): string {
  const t = texts().messages;
  const rules: [RegExp, (m: RegExpMatchArray) => string][] = [
    // More specific than "source … does not exist" below, so it comes first.
    [/^source folder (.+) does not exist$/, (m) => t.sourceFolderMissing(tidy(m[1]))],
    [/^the deletion limit must be between 0 and 100 %$/, () => t.deletionLimitRange],
    [/^(.+) cannot be read$/, (m) => t.cannotRead(tidy(m[1]))],
    [/^directory not found$/, () => t.directoryGone],
    [/^object not found$/, () => t.objectGone],
    // The rest of these messages is English system text; it stays out of the sentence.
    [/^file system: Permission denied/, () => t.permissionDenied],
    [/^file system: No such file or directory/, () => t.noSuchFile],
    [/^file system: /, () => t.fileSystemFailed],
    [/^source (.+) does not exist$/, (m) => t.sourceMissing(tidy(m[1]))],
    [/^source (.+) is empty, nothing is changed$/, (m) => t.sourceEmpty(tidy(m[1]))],
    [/^source (.+) is not a folder$/, (m) => t.sourceNotFolder(tidy(m[1]))],
    [/^target folder (.+) does not exist$/, (m) => t.targetFolderMissing(tidy(m[1]))],
    [/^volume (.+) is not connected$/, (m) => t.volumeNotConnected(tidy(m[1]))],
    [
      /^would delete (\d+) of (\d+) entries on the target \(([\d.]+) %\), limit is ([\d.]+) %$/,
      (m) => t.wouldDelete(count(m[1]), count(m[2]), decimal(m[3]), decimal(m[4])),
    ],
    [/^deletion limit reached \((\d+) allowed\), the remaining deletions were skipped$/, (m) => t.deletionLimitReached(count(m[1]))],
    [/^location (.+) does not exist$/, () => t.locationGone],
    [/^folder (.+) does not exist$/, (m) => t.folderMissing(tidy(m[1]))],
    [/^(.+) is not connected$/, (m) => t.notConnected(tidy(m[1]))],
    [/^source and target are the same folder$/, () => t.sameFolder],
    [/^the target lies inside the source; it would copy itself$/, () => t.targetInsideSource],
    [/^the source lies inside the target; a mirror would delete everything around it$/, () => t.sourceInsideTarget],
    [/^a name is required$/, () => t.nameRequired],
    [/^login refused: wrong user, password or key$/, () => t.loginRefused],
    [/^host name not found$/, () => t.hostNotFound],
    [/^this is not a clonq licence key$/, () => t.notLicenceKey],
    [/^this licence key is not genuine$/, () => t.licenceNotGenuine],
    [/^this licence key is for another product or version$/, () => t.licenceOtherProduct],
    [/^versioned backups are part of clonq Pro: enter a licence in Settings$/, () => t.proNeeded],
    [/^your clonq Pro licence covers versions released until (\S+); this version is newer$/, (m) => t.licenceNotCovering(formatDate(m[1] ?? ""))],
    [/^this clonq Pro licence has been withdrawn$/, () => t.licenceWithdrawn],
    [/^the integrity check is part of clonq Pro: enter a licence in Settings$/, () => t.checkNeedsPro],
    [/^(\d+) file\(s\) differ in content (?:although size and date match|between source and target)$/, (m) => t.contentDiffers(Number(m[1]))],
    [/^there is no snapshot to check yet$/, () => t.noSnapshotToCheck],
    [/^the key for this server is missing; start again$/, () => t.serverKeyMissing],
    [/^no parent folder$/, () => t.noParentFolder],
    [/^the job ran since the last integrity check; run the check again before repairing$/, () => t.repairStale],
    [/^source and target share no checksum, so the content cannot be compared without downloading it$/, () => t.noCommonHash],
    [/^(\d+) file\(s\) could not be checked$/, (m) => t.notChecked(Number(m[1]))],
    [/^some files could not be read and were not checked; the log names them$/, () => t.unreadNotChecked],
    [/^the target folder overlaps with the job (.+); a versioned job needs a folder of its own$/, (m) => t.versionedOverlap(m[1] ?? "")],
    [/^versioned backups need an empty target folder; choose a new one$/, () => t.versionedNeedsEmpty],
    [/^this folder holds the snapshots; choose another folder for the new mode$/, () => t.snapshotsFolderInUse],
    [/^the encryption password of this job is missing on this Mac; without it the copy cannot be read, so clonq does not make a new one$/, () => t.encryptionPasswordMissing],
    [/^the rclone configuration could not be read$/, () => t.rcloneConfigUnreadable],
    [/^the encryption password could not be read$/, () => t.encryptionPasswordUnreadable],
    [/^versioned backups need a folder, drive or server as the target$/, () => t.versionedNeedsFolder],
    [/^encrypted cloud copies are part of clonq Pro: enter a licence in Settings$/, () => t.encryptionPro],
    [/^encryption needs a cloud as the target$/, () => t.encryptionNeedsCloud],
    [/^encryption needs an empty target folder; choose a new one$/, () => t.encryptionNeedsEmpty],
    [/^this folder holds the encrypted copy; choose an empty folder for a copy without encryption$/, () => t.encryptedFolderInUse],
    [/^could not repair (.+?): (.*)$/, (m) => t.couldNotRepair(m[1] ?? "", m[2] ?? "")],
    [/^versioned backups need a source on this Mac and a folder, drive or server as the target$/, () => t.versionedNeedsLocalAndFolder],
    [/^only versioned jobs keep snapshots$/, () => t.onlyVersionedSnapshots],
    [/^only two-way jobs keep an archive on the source$/, () => t.onlyTwoWaySourceArchive],
    [/^the server refused the connection on this port$/, () => t.portRefused],
    [/^no answer from the server \(timeout\)$/, () => t.serverTimeout],
    [/^still used by (.+)$/, (m) => t.stillUsedBy(m[1] ?? "")],
    [/^(.+) is already a location$/, (m) => t.alreadyLocation(tidy(m[1]))],
    [/^folders on external drives are added as a drive, not as a folder$/, () => t.externalFolder],
    [/^two-way sync stopped: .*too many deletes \(>(\d+)%, (\d+) of (\d+)\)/, (m) => t.twoWayStopped(count(m[2]), count(m[3]), m[1] ?? "")],
    [/^share (.+) is not connected$/, (m) => t.shareNotConnected(m[1] ?? "")],
    [/^the address must start with smb:\/\/$/, () => t.smbPrefix],
    [/^the address has no server$/, () => t.noServer],
    [/^the address has no share name, e\.g\. smb:\/\/nas\/daten$/, () => t.noShare],
    [/^a user is required$/, () => t.userRequired],
    [/^the keychain refused the password: (.+)$/, (m) => t.keychainRefused(m[1] ?? "")],
    [/^the share could not be connected: (.*)$/, (m) => t.shareConnectFailed(m[1] ?? "")],
    [/^the sign-in did not finish within five minutes$/, () => t.signInTimeout],
    [/^no answer from the cloud \(timeout\)$/, () => t.cloudTimeout],
    [/^(.+) is required$/, (m) => t.required(m[1] ?? "")],
    [/^unknown cloud provider (.+)$/, (m) => t.unknownProvider(m[1] ?? "")],
    [/^(.+) cannot be created: (.+)$/, (m) => t.cannotCreate(tidy(m[1]), m[2] ?? "")],
    [/^path (.+) must not climb out of its location$/, () => t.pathLeavesLocation],
    [/^(.+) has not been tested yet$/, (m) => t.notTestedYet(m[1] ?? "")],
    [/^(.+) no longer exists$/, (m) => t.noLongerExists(m[1] ?? "")],
    [/^choose a location$/, () => t.chooseLocation],
    [/^the jobs would start each other in a circle$/, () => t.jobCycle],
    [/^the interval must be between 1 minute and one year$/, () => t.intervalRange],
    [/^(.+) already exists$/, (m) => t.alreadyExists(m[1] ?? "")],
    [/^the new name must be a plain name$/, () => t.plainName],
    [/^the file is too large for a preview$/, () => t.tooLargeForPreview],
    [/^there is no preview for this kind of file$/, () => t.noPreview],
    [/^moving to the Trash failed: (.+)$/, () => t.trashFailed],
    [/^the location itself cannot be deleted here$/, () => t.cannotDeleteLocation],
    [/^restoring from the archive failed$/, () => t.restoreFailed],
    [/^(.+) is not an archive folder$/, (m) => t.notArchive(m[1] ?? "")],
    [/^path must not climb out of the archive$/, () => t.pathLeavesArchive],
    [/^the copy failed$/, () => t.copyFailed],
    [/^rename failed$/, () => t.renameFailed],
    [/^the server's key was not read; start again$/, () => t.hostKeyNotRead],
    [/^unknown server draft; start again$/, () => t.unknownDraft],
    [/^the server's host key is not confirmed yet$/, () => t.hostKeyUnconfirmed],
    [/^the server's host key changed; check it before trusting it again$/, () => t.hostKeyChanged],
    [/^(.+) must be a single line$/, (m) => t.singleLine(m[1] ?? "")],
    [/^the app quit during this run$/, () => t.appQuit],
  ];
  for (const [pattern, render] of rules) {
    const match = message.match(pattern);
    if (match) return render(match);
  }
  return message;
}

function count(digits: string | undefined): string {
  return Number(digits ?? 0).toLocaleString(locale());
}

function decimal(value: string | undefined): string {
  return Number(value ?? 0).toLocaleString(locale(), { maximumFractionDigits: 1 });
}

function tidy(path: string | undefined): string {
  return (path ?? "").replace(HOME, "~");
}
