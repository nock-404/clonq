// The only place that talks to the Rust side.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ArchivedFile,
  BrowseEntry,
  FilePreview,
  Snapshot,
  EntryKind,
  RunEntryPage,
  CloudProvider,
  CloudProviderInfo,
  Config,
  FolderEntry,
  Job,
  JobInput,
  JobStats,
  LiveRun,
  Location,
  LocationStatus,
  MountedVolume,
  Overview,
  Run,
  ServerDraft,
  ServerInput,
  UiSettings,
} from "./types";

export interface RunOptions {
  dryRun?: boolean;
  force?: boolean;
}

export const api = {
  getConfig: () => invoke<Config>("get_config"),
  liveRuns: () => invoke<LiveRun[]>("live_runs"),
  latestRuns: () => invoke<Run[]>("latest_runs"),
  recentRuns: (limit: number) => invoke<Run[]>("recent_runs", { limit }),
  runEntries: (runId: string, kind: EntryKind | null, query: string, offset: number, limit: number) =>
    invoke<RunEntryPage>("run_entries", { runId, kind, query, offset, limit }),
  archiveSnapshots: (jobId: string) => invoke<Snapshot[]>("archive_snapshots", { jobId }),
  archiveFiles: (jobId: string, stamp: string) => invoke<ArchivedFile[]>("archive_files", { jobId, stamp }),
  /** Copies into a new folder in Downloads; returns that folder. */
  restoreArchive: (jobId: string, stamp: string, path?: string) =>
    invoke<string>("restore_archive", { jobId, stamp, path: path ?? null }),
  browseList: (location: string, path: string) => invoke<BrowseEntry[]>("browse_list", { location, path }),
  browsePreview: (location: string, path: string) => invoke<FilePreview>("browse_preview", { location, path }),
  /** Copies into Downloads/clonq-dateien; returns the copy. */
  browseDownload: (location: string, path: string) => invoke<string>("browse_download", { location, path }),
  browseRename: (location: string, path: string, newName: string) => invoke<void>("browse_rename", { location, path, newName }),
  browseDelete: (location: string, path: string) => invoke<void>("browse_delete", { location, path }),
  jobStats: (jobId: string) => invoke<JobStats>("job_stats", { jobId }),
  overview: () => invoke<Overview>("overview"),
  setUiSettings: (settings: UiSettings) => invoke<Config>("set_ui_settings", { settings }),
  runJob: (jobId: string, options: RunOptions = {}) =>
    invoke<string>("run_job", { jobId, dryRun: options.dryRun ?? false, force: options.force ?? false }),
  cancelJob: (jobId: string) => invoke<void>("cancel_job", { jobId }),
  openMainWindow: (jobId?: string) => invoke<void>("open_main_window", { jobId: jobId ?? null }),
  quit: () => invoke<void>("quit"),

  mountedVolumes: () => invoke<MountedVolume[]>("mounted_volumes"),
  locationStatuses: () => invoke<LocationStatus[]>("location_statuses"),
  addFolderLocation: (name: string, path: string) => invoke<Location>("add_folder_location", { name, path }),
  addVolumeLocation: (name: string, volumeUuid: string) => invoke<Location>("add_volume_location", { name, volumeUuid }),
  /** Makes a key and reads the server's host keys. Pass the draft's id again after the address changed: the key stays. */
  prepareServer: (name: string, host: string, port: number, locationId: string | null = null) =>
    invoke<ServerDraft>("prepare_server", { name, host, port, locationId }),
  /** The user compared a fingerprint; pins the host keys read by prepareServer. */
  trustServer: (locationId: string) => invoke<void>("trust_server", { locationId }),
  installServerKey: (server: ServerInput, password: string) => invoke<void>("install_server_key", { server, password }),
  testServer: (server: ServerInput) => invoke<string>("test_server", { server }),
  addServerLocation: (server: ServerInput) => invoke<Location>("add_server_location", { server }),
  testLocation: (id: string) => invoke<LocationStatus>("test_location", { id }),
  /** Mounts a network share; other kinds just report their status. */
  connectLocation: (id: string) => invoke<LocationStatus>("connect_location", { id }),
  renameLocation: (id: string, name: string) => invoke<Config>("rename_location", { id, name }),
  removeLocation: (id: string) => invoke<Config>("remove_location", { id }),
  addSmbLocation: (name: string, url: string, user: string, password: string) =>
    invoke<Location>("add_smb_location", { name, url, user, password }),
  cloudProviders: () => invoke<CloudProviderInfo[]>("cloud_providers"),
  /** Opens the browser for providers with browserLogin; resolves once the account is connected. */
  addCloudLocation: (name: string, provider: CloudProvider, fields: Record<string, string>, root: string) =>
    invoke<Location>("add_cloud_location", { name, provider, fields, root }),
  listFolders: (location: string, path: string) => invoke<FolderEntry[]>("list_folders", { location, path }),
  createFolder: (location: string, path: string) => invoke<void>("create_folder", { location, path }),
  saveJob: (job: JobInput) => invoke<Job>("save_job", { job }),
  deleteJob: (id: string) => invoke<Config>("delete_job", { id }),
  setJobEnabled: (id: string, enabled: boolean) => invoke<Config>("set_job_enabled", { id, enabled }),
  jobDefaults: () => invoke<string[]>("job_defaults"),

  onRunUpdate: (handler: (run: LiveRun) => void): Promise<UnlistenFn> =>
    listen<LiveRun>("run-update", (event) => handler(event.payload)),
  onRunsChanged: (handler: () => void): Promise<UnlistenFn> => listen("runs-changed", handler),
  onShowJob: (handler: (jobId: string) => void): Promise<UnlistenFn> =>
    listen<string>("show-job", (event) => handler(event.payload)),
  onConfigChanged: (handler: (config: Config) => void): Promise<UnlistenFn> =>
    listen<Config>("config-changed", (event) => handler(event.payload)),
  onVolumesChanged: (handler: (volumes: MountedVolume[]) => void): Promise<UnlistenFn> =>
    listen<MountedVolume[]>("volumes-changed", (event) => handler(event.payload)),
  onServersChecked: (handler: () => void): Promise<UnlistenFn> => listen("servers-checked", handler),
};
