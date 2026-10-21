export type CloudSyncFeedback = { attempt: number; syncing: boolean; error: string };
export type CloudSyncEvent =
  | { type: "start"; attempt: number }
  | { type: "success"; attempt: number }
  | { type: "failure"; attempt: number; error: string };

export const initialCloudSyncFeedback: CloudSyncFeedback = { attempt: 0, syncing: false, error: "" };

export function cloudSyncFeedback(state: CloudSyncFeedback, event: CloudSyncEvent): CloudSyncFeedback {
  if (event.type === "start") {
    if (event.attempt <= state.attempt) return state;
    // Keep the last failure visible until a retry is acknowledged.
    return { ...state, attempt: event.attempt, syncing: true };
  }
  if (event.attempt !== state.attempt) return state;
  return { attempt: event.attempt, syncing: false, error: event.type === "failure" ? event.error : "" };
}
