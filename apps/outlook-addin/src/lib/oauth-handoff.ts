/** Same-origin storage key written by auth-callback.html for the task pane. */
export const OAUTH_HANDOFF_STORAGE_KEY = "scomm-office.oauth.handoff";
/** BroadcastChannel name for the same handoff. */
export const OAUTH_HANDOFF_CHANNEL = "scomm-office-oauth";

const HANDOFF_MAX_AGE_MS = 120_000;

/**
 * True when a callback payload was written after this sign-in started.
 */
export function isFreshOAuthHandoff(
  raw: string,
  openedAtMs: number,
  nowMs: number = Date.now(),
): boolean {
  try {
    const parsed = JSON.parse(raw) as { ts?: unknown };
    const ts = typeof parsed.ts === "number" ? parsed.ts : 0;
    if (!ts) {
      return false;
    }
    if (ts + HANDOFF_MAX_AGE_MS < nowMs) {
      return false;
    }
    return ts + 2_000 >= openedAtMs;
  } catch {
    return false;
  }
}

/**
 * Listen for the auth-callback page (Office dialog or browser popup).
 * messageParent often never runs: Office.onReady hangs if the first dialog
 * page skipped office.js, and Google drops window.opener.
 */
export function subscribeOAuthHandoff(
  openedAtMs: number,
  onRaw: (raw: string) => void,
): () => void {
  let stopped = false;
  const seen = new Set<string>();

  const deliver = (raw: string) => {
    if (stopped || !raw || seen.has(raw) || !isFreshOAuthHandoff(raw, openedAtMs)) {
      return;
    }
    seen.add(raw);
    try {
      window.localStorage.removeItem(OAUTH_HANDOFF_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    onRaw(raw);
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key === OAUTH_HANDOFF_STORAGE_KEY && event.newValue) {
      deliver(event.newValue);
    }
  };
  window.addEventListener("storage", onStorage);

  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel(OAUTH_HANDOFF_CHANNEL);
    channel.onmessage = (event) => {
      if (typeof event.data === "string") {
        deliver(event.data);
      }
    };
  } catch {
    /* BroadcastChannel missing in some WebViews */
  }

  const poll = window.setInterval(() => {
    try {
      const raw = window.localStorage.getItem(OAUTH_HANDOFF_STORAGE_KEY);
      if (raw) {
        deliver(raw);
      }
    } catch {
      /* ignore */
    }
  }, 250);

  return () => {
    stopped = true;
    window.clearInterval(poll);
    window.removeEventListener("storage", onStorage);
    try {
      channel?.close();
    } catch {
      /* ignore */
    }
  };
}
