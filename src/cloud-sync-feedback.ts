export type CloudSyncFeedback = {
  attempt: number;
  syncing: boolean;
  error: string;
  syncingRevision: string;
  errorRevision: string;
};
export type CloudSyncEvent =
  | { type: "start"; attempt: number; revision: string }
  | { type: "success"; attempt: number }
  | { type: "failure"; attempt: number; revision: string; error: string };

export const initialCloudSyncFeedback: CloudSyncFeedback = {
  attempt: 0,
  syncing: false,
  error: "",
  syncingRevision: "",
  errorRevision: "",
};

export function cloudSyncFeedback(state: CloudSyncFeedback, event: CloudSyncEvent): CloudSyncFeedback {
  if (event.type === "start") {
    if (event.attempt <= state.attempt) return state;
    return {
      attempt: event.attempt,
      syncing: true,
      error: "",
      syncingRevision: event.revision,
      errorRevision: "",
    };
  }
  if (event.attempt !== state.attempt) return state;
  return {
    attempt: event.attempt,
    syncing: false,
    error: event.type === "failure" ? event.error : "",
    syncingRevision: "",
    errorRevision: event.type === "failure" ? event.revision : "",
  };
}
