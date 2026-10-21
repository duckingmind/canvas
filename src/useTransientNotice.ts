import React from "react";

export type NoticeAction = { label: string; run: () => void };

/** Notices have their own lifetime; unrelated generation tasks never hold them open. */
export function useTransientNotice(defaultDuration = 6000) {
  const [notice, setNotice] = React.useState<{
    text: string;
    action?: NoticeAction;
    duration: number;
  } | null>(null);
  const show = React.useCallback((text: string, action?: NoticeAction, duration = defaultDuration) => {
    // A new object also restarts the timer when the same operation is repeated.
    setNotice(text ? { text, action, duration } : null);
  }, [defaultDuration]);
  React.useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.duration);
    return () => window.clearTimeout(timer);
  }, [notice]);
  return { notice, show };
}
