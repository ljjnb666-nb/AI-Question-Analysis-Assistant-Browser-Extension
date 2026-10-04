import type { loadSettings } from "@/shared/utils/storage";
import type { validateAuthSession, AuthSessionValidationResult } from "@/shared/utils/auth";

/**
 * One shared semantic model for every surface (Popup, Side Panel, Settings).
 * Local storage credentials only ever mean LOCAL_SESSION_CANDIDATE: the
 * transition to "authenticated" happens exclusively through a server-validated
 * session, and "server_unavailable" never unlocks protected UI.
 */
export type AuthSessionStatus =
  | "loading"
  | "validating"
  | "authenticated"
  | "unauthenticated"
  | "server_unavailable";

export type AuthSessionState = {
  status: AuthSessionStatus;
  userId: string;
  userEmail: string;
  expiresAt?: number;
  /** The server rejected a locally cached session (401/expired/revoked/forged). */
  sessionRejected: boolean;
};

export const INITIAL_AUTH_SESSION_STATE: AuthSessionState = {
  status: "loading",
  userId: "",
  userEmail: "",
  sessionRejected: false,
};

export type AuthSessionCoordinatorDeps = {
  loadSettings: typeof loadSettings;
  validateAuthSession: typeof validateAuthSession;
  /**
   * Notified whenever the appSettings blob changes in chrome.storage. The
   * coordinator decides whether the change matters; listeners must not infer
   * authentication from raw storage values.
   */
  subscribeToStorageChanges: (listener: () => void) => () => void;
};

const CREDENTIALS_SEPARATOR = "\u0000";

/**
 * Fingerprint of the local session candidate, computed from decrypted values.
 * Used only to decide whether a storage change warrants a new server
 * validation; it is never treated as proof of authentication.
 */
export function computeSessionCandidateFingerprint(settings: {
  userId?: string;
  authToken?: string;
  analyticsBaseUrl?: string;
}): string {
  const userId = String(settings.userId ?? "").trim();
  const authToken = String(settings.authToken ?? "");
  if (!userId || !authToken) return "";
  return [userId, authToken, String(settings.analyticsBaseUrl ?? "")].join(CREDENTIALS_SEPARATOR);
}

export function createAuthSessionCoordinator(deps: AuthSessionCoordinatorDeps) {
  let state: AuthSessionState = INITIAL_AUTH_SESSION_STATE;
  let disposed = false;
  let generation = 0;
  // A credential-clear event can precede the corresponding server rejection
  // result. Preserve only that non-authoritative UI hint, never session authority.
  let clearedValidationGeneration: number | null = null;
  // Fingerprint of the session candidate this coordinator last scheduled a
  // server validation for. Null means "unknown, force a validation".
  let lastValidationFingerprint: string | null = null;
  let bootstrapPromise: Promise<void> | null = null;
  let unsubscribeStorage: (() => void) | null = null;
  const listeners = new Set<() => void>();

  function getState(): AuthSessionState {
    return state;
  }

  function setState(patch: Partial<AuthSessionState>): void {
    const next = { ...state, ...patch };
    if (
      next.status === state.status &&
      next.userId === state.userId &&
      next.userEmail === state.userEmail &&
      next.expiresAt === state.expiresAt &&
      next.sessionRejected === state.sessionRejected
    ) {
      return;
    }
    state = next;
    for (const listener of listeners) listener();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async function readCurrentFingerprint(): Promise<string> {
    const settings = await deps.loadSettings();
    return computeSessionCandidateFingerprint(settings);
  }

  function applyValidationResult(result: AuthSessionValidationResult): void {
    if (result.status === "authenticated") {
      setState({
        status: "authenticated",
        userId: result.userId,
        userEmail: result.userEmail,
        expiresAt: result.expiresAt,
        sessionRejected: false,
      });
      return;
    }
    if (result.status === "unauthenticated") {
      // validateAuthSession already cleared the local credentials; surface the
      // generic "sign in again" state without internal reasons (expired,
      // revoked, hash mismatch...).
      lastValidationFingerprint = "";
      setState({
        status: "unauthenticated",
        userId: "",
        userEmail: "",
        expiresAt: undefined,
        sessionRejected: true,
      });
      return;
    }
    // Server unavailable: keep the local candidate credentials, stay locked,
    // and keep the fingerprint so unrelated storage writes don't re-validate.
    setState({ status: "server_unavailable", sessionRejected: false });
  }

  async function runValidation(fingerprint: string): Promise<void> {
    lastValidationFingerprint = fingerprint;
    generation += 1;
    const currentGeneration = generation;
    setState({ status: "validating", sessionRejected: false });
    let result: AuthSessionValidationResult;
    try {
      result = await deps.validateAuthSession();
    } catch {
      result = { status: "server_unavailable" };
    }
    // A validation that lost a generation race (logout, re-login, newer
    // storage-driven validation) must never overwrite the newer auth state.
    if (currentGeneration !== generation || disposed) {
      if (!disposed && result.status === "unauthenticated" &&
          clearedValidationGeneration === currentGeneration && state.status === "unauthenticated") {
        clearedValidationGeneration = null;
        setState({ sessionRejected: true });
      }
      return;
    }
    applyValidationResult(result);
  }

  async function reconcileFromStorage(options?: { force?: boolean }): Promise<void> {
    const fingerprint = await readCurrentFingerprint();
    if (disposed) return;
    if (!options?.force && fingerprint !== "" && fingerprint === lastValidationFingerprint) {
      // Same candidate already validated (or validation in flight): this is
      // either an unrelated settings write or the echo of our own identity
      // refresh. Skipping here is what prevents a validation loop.
      return;
    }
    if (!fingerprint) {
      lastValidationFingerprint = "";
      if (state.status === "unauthenticated") return;
      // Credentials disappeared (logout or a rejected session cleared them).
      // Bump the generation so any in-flight validation cannot resurrect a
      // session from stale results.
      clearedValidationGeneration = state.status === "validating" ? generation : null;
      generation += 1;
      setState({
        status: "unauthenticated",
        userId: "",
        userEmail: "",
        expiresAt: undefined,
        sessionRejected: false,
      });
      return;
    }
    clearedValidationGeneration = null;
    await runValidation(fingerprint);
  }

  function handleStorageChanged(): void {
    void reconcileFromStorage().catch(() => undefined);
  }

  async function bootstrap(): Promise<void> {
    if (bootstrapPromise) return bootstrapPromise;
    bootstrapPromise = reconcileFromStorage().finally(() => {
      bootstrapPromise = null;
    });
    return bootstrapPromise;
  }

  function start(): void {
    // React may mount → unmount → remount the same hook instance
    // (StrictMode): a disposed coordinator must be revivable.
    disposed = false;
    if (!unsubscribeStorage) {
      unsubscribeStorage = deps.subscribeToStorageChanges(handleStorageChanged);
    }
    void bootstrap();
  }

  function dispose(): void {
    clearedValidationGeneration = null;
    disposed = true;
    generation += 1;
    unsubscribeStorage?.();
    unsubscribeStorage = null;
  }

  /** Explicit user action (Retry) after server_unavailable. */
  function retryValidation(): Promise<void> {
    return reconcileFromStorage({ force: true });
  }

  /**
   * Login/register succeeded with a server-authoritative response. The UI
   * trusts the server response itself, not the fact that storage now contains
   * credentials.
   */
  async function applyAuthenticatedSession(userId: string, userEmail: string): Promise<void> {
    clearedValidationGeneration = null;
    generation += 1;
    setState({
      status: "authenticated",
      userId,
      userEmail,
      expiresAt: undefined,
      sessionRejected: false,
    });
    // Record the fingerprint of what the login flow just persisted so the
    // storage echo of the credential write does not trigger a re-validation.
    lastValidationFingerprint = await readCurrentFingerprint();
  }

  /** Logout always converges to unauthenticated, whatever the server did. */
  function applyLoggedOut(): void {
    clearedValidationGeneration = null;
    generation += 1;
    lastValidationFingerprint = "";
    setState({
      status: "unauthenticated",
      userId: "",
      userEmail: "",
      expiresAt: undefined,
      sessionRejected: false,
    });
  }

  return {
    getState,
    subscribe,
    start,
    dispose,
    bootstrap,
    retryValidation,
    handleStorageChanged,
    applyAuthenticatedSession,
    applyLoggedOut,
  };
}

export type AuthSessionCoordinator = ReturnType<typeof createAuthSessionCoordinator>;
