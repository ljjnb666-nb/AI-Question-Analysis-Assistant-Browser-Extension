/**
 * Non-authoritative, short-lived UX snapshot for Edge/Chrome action popups.
 *
 * The popup is destroyed when it loses focus. Only email + server-confirmed
 * send metadata are resumable. NEVER store a password, verification code,
 * auth token, or login authority here.
 */
export const POPUP_REGISTRATION_DRAFT_KEY = "quizSolver:popupRegistrationDraft:v1";
export const POPUP_REGISTRATION_DRAFT_TTL_MS = 30 * 60 * 1000;
const MAX_EMAIL_LENGTH = 254;
const MAX_BASE_URL_LENGTH = 2048;
const MAX_CODE_EXPIRY_AHEAD_MS = 11 * 60 * 1000;

export type PopupRegistrationDraft = {
  email: string;
  /** Set only after a successful send-code response for exactly this email. */
  sentForEmail?: string;
  /** Authoritative expiry received from the server, not a generated client token. */
  codeExpiresAt?: number;
  /** Absolute UI resend-cooldown deadline. */
  cooldownUntil?: number;
  /** Backend identity to prevent restoring a code against a different server. */
  backendUrl?: string;
};

type StoredDraft = PopupRegistrationDraft & {
  version: 1;
  updatedAt: number;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizePopupRegistrationDraft(raw: unknown, now = Date.now()): PopupRegistrationDraft | null {
  if (!record(raw) || raw.version !== 1) return null;
  if (
    typeof raw.updatedAt !== "number" ||
    !Number.isFinite(raw.updatedAt) ||
    raw.updatedAt > now + 60_000 ||
    now - raw.updatedAt > POPUP_REGISTRATION_DRAFT_TTL_MS
  ) return null;
  if (typeof raw.email !== "string" || raw.email.length > MAX_EMAIL_LENGTH) return null;
  const email = raw.email.trim();
  if (!email) return null;

  const draft: PopupRegistrationDraft = { email };
  const sentEmail = typeof raw.sentForEmail === "string" ? raw.sentForEmail.trim() : "";
  const expiry = raw.codeExpiresAt;
  const cooldown = raw.cooldownUntil;
  const backend = raw.backendUrl;
  if (
    sentEmail.toLowerCase() === email.toLowerCase() &&
    typeof expiry === "number" && Number.isFinite(expiry) &&
    expiry > now && expiry <= now + MAX_CODE_EXPIRY_AHEAD_MS &&
    typeof cooldown === "number" && Number.isFinite(cooldown) &&
    cooldown >= now - POPUP_REGISTRATION_DRAFT_TTL_MS && cooldown <= now + 61_000 &&
    typeof backend === "string" && backend.length > 0 && backend.length <= MAX_BASE_URL_LENGTH
  ) {
    draft.sentForEmail = sentEmail;
    draft.codeExpiresAt = expiry;
    draft.cooldownUntil = cooldown;
    draft.backendUrl = backend;
  }
  return draft;
}

function sessionStorage(): chrome.storage.StorageArea | null {
  if (typeof chrome === "undefined" || !chrome.storage?.session) return null;
  return chrome.storage.session;
}

// All mutations from the same extension surface are ordered so an earlier
// email keystroke cannot overwrite the later successful send-code snapshot.
let mutationTail: Promise<unknown> = Promise.resolve();
function queueMutation(action: () => Promise<void>): Promise<boolean> {
  const next = mutationTail.catch(() => undefined).then(async () => {
    try {
      await action();
      return true;
    } catch {
      return false;
    }
  });
  mutationTail = next;
  return next;
}

export async function loadPopupRegistrationDraft(): Promise<PopupRegistrationDraft | null> {
  const storage = sessionStorage();
  if (!storage) return null;
  try {
    const result = await storage.get(POPUP_REGISTRATION_DRAFT_KEY);
    return normalizePopupRegistrationDraft(result[POPUP_REGISTRATION_DRAFT_KEY]);
  } catch {
    return null;
  }
}

export function savePopupRegistrationDraft(draft: PopupRegistrationDraft): Promise<boolean> {
  const storage = sessionStorage();
  if (!storage) return Promise.resolve(false);
  const now = Date.now();
  const normalized = normalizePopupRegistrationDraft({ ...draft, version: 1, updatedAt: now }, now);
  return queueMutation(async () => {
    if (!normalized) {
      await storage.remove(POPUP_REGISTRATION_DRAFT_KEY);
      return;
    }
    const stored: StoredDraft = { ...normalized, version: 1, updatedAt: now };
    await storage.set({ [POPUP_REGISTRATION_DRAFT_KEY]: stored });
  });
}

export function clearPopupRegistrationDraft(): Promise<boolean> {
  const storage = sessionStorage();
  if (!storage) return Promise.resolve(false);
  return queueMutation(async () => storage.remove(POPUP_REGISTRATION_DRAFT_KEY));
}
