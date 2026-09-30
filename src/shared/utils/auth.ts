import { logEvent } from "./analytics";
import { DEFAULT_ANALYTICS_BASE_URL } from "../constants/analytics";
import { loadSettings, saveSettings, getOrCreateDeviceId } from "./storage";
import { fetchJsonWithTimeout, readAuthErrorMessage } from "./authFetch";

type AuthSuccessResponse = {
  ok: true;
  user: {
    userId: string;
    email: string;
  };
  authToken: string;
};

type SendCodeSuccessResponse = {
  ok: true;
  expiresAt: number;
};

type SessionValidationSuccessResponse = {
  ok: true;
  user: {
    userId: string;
    email: string;
  };
  expiresAt?: number;
};

export type AuthSessionValidationResult =
  | {
      status: "authenticated";
      userId: string;
      userEmail: string;
      expiresAt?: number;
    }
  | { status: "unauthenticated" }
  | { status: "server_unavailable" };

export type AuthLogoutServerStatus = "revoked" | "no_local_credentials" | "network_error" | "server_rejected";

export type AuthLogoutResult = {
  serverRevoked: boolean;
  serverStatus: AuthLogoutServerStatus;
};

function resolveBaseUrl(value: string | undefined): string {
  return String(value || DEFAULT_ANALYTICS_BASE_URL).trim().replace(/\/+$/, "");
}

function isWellFormedAuthSuccess(payload: unknown): payload is AuthSuccessResponse {
  const candidate = payload as AuthSuccessResponse | null;
  return (
    !!candidate &&
    candidate.ok === true &&
    typeof candidate.authToken === "string" &&
    candidate.authToken.length > 0 &&
    typeof candidate.user?.userId === "string" &&
    candidate.user.userId.length > 0
  );
}

async function submitAuth(
  path: "/auth/register" | "/auth/login",
  email: string,
  password: string,
): Promise<AuthSuccessResponse> {
  const settings = await loadSettings();
  const deviceId = settings.deviceId || await getOrCreateDeviceId();
  const baseUrl = resolveBaseUrl(settings.analyticsBaseUrl);

  const { ok, payload } = await fetchJsonWithTimeout(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: email.trim(),
      password,
      deviceId,
    }),
  });

  if (!ok) {
    throw new Error(readAuthErrorMessage(payload) || "Authentication failed");
  }
  // A success response that is missing its credential fields must fail
  // closed: nothing is persisted and the UI never enters authenticated state.
  if (!isWellFormedAuthSuccess(payload)) {
    throw new Error("AUTH_MALFORMED_RESPONSE");
  }

  const success = payload;
  await saveSettings({
    deviceId,
    analyticsBaseUrl: baseUrl,
    userId: success.user.userId,
    userEmail: success.user.email,
    authToken: success.authToken,
  });

  logEvent(path === "/auth/register" ? "auth_registered" : "auth_logged_in", {
    userId: success.user.userId,
  });

  return success;
}

export async function loginWithEmail(email: string, password: string): Promise<AuthSuccessResponse> {
  return submitAuth("/auth/login", email, password);
}

export async function sendEmailVerificationCode(email: string): Promise<SendCodeSuccessResponse> {
  const settings = await loadSettings();
  const baseUrl = resolveBaseUrl(settings.analyticsBaseUrl);
  const { ok, status, payload } = await fetchJsonWithTimeout(`${baseUrl}/auth/send-verification-code`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: email.trim() }),
  });

  if (ok) {
    const success = payload as SendCodeSuccessResponse | null;
    if (success?.ok && Number.isFinite(success.expiresAt)) return success;
    throw new Error("AUTH_SEND_CODE_FAILED");
  }

  // The client only surfaces stable, sanitized outcomes: rate limiting, the
  // server's email-service contract code, or a generic failure. Raw server
  // messages (which may mention internal configuration) never propagate.
  if (status === 429) {
    throw new Error("AUTH_RATE_LIMITED");
  }
  if (readAuthErrorMessage(payload) === "EMAIL_SERVICE_UNAVAILABLE") {
    throw new Error("EMAIL_SERVICE_UNAVAILABLE");
  }
  throw new Error("AUTH_SEND_CODE_FAILED");
}

export async function registerWithEmailCode(email: string, password: string, verificationCode: string): Promise<AuthSuccessResponse> {
  const settings = await loadSettings();
  const deviceId = settings.deviceId || await getOrCreateDeviceId();
  const baseUrl = resolveBaseUrl(settings.analyticsBaseUrl);

  const { ok, payload } = await fetchJsonWithTimeout(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: email.trim(),
      password,
      verificationCode: verificationCode.trim(),
      deviceId,
    }),
  });

  if (!ok) {
    throw new Error(readAuthErrorMessage(payload) || "Registration failed");
  }
  if (!isWellFormedAuthSuccess(payload)) {
    throw new Error("AUTH_MALFORMED_RESPONSE");
  }

  await saveSettings({
    deviceId,
    analyticsBaseUrl: baseUrl,
    userId: payload.user.userId,
    userEmail: payload.user.email,
    authToken: payload.authToken,
  });

  logEvent("auth_registered", {
    userId: payload.user.userId,
  });

  return payload;
}

export async function validateAuthSession(): Promise<AuthSessionValidationResult> {
  const settings = await loadSettings();
  const localUserId = String(settings.userId || "").trim();
  const localAuthToken = String(settings.authToken || "");
  if (!localUserId || !localAuthToken) {
    return { status: "unauthenticated" };
  }

  const baseUrl = resolveBaseUrl(settings.analyticsBaseUrl);
  let response;
  try {
    response = await fetchJsonWithTimeout(`${baseUrl}/auth/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localAuthToken}`,
      },
      body: JSON.stringify({ userId: localUserId }),
    });
  } catch {
    // A network failure proves nothing about the stored token: keep the
    // credentials but never report an authenticated session in this state.
    return { status: "server_unavailable" };
  }

  if (response.status === 401) {
    // Only clear the credentials this validation actually proved invalid:
    // a newer login may have replaced them while the request was in flight,
    // and a stale 401 must never wipe the fresh session.
    const current = await loadSettings();
    const currentUserId = String(current.userId || "").trim();
    const currentAuthToken = String(current.authToken || "");
    if (currentUserId === localUserId && currentAuthToken === localAuthToken) {
      await saveSettings({ userId: undefined, userEmail: undefined, authToken: undefined });
    }
    return { status: "unauthenticated" };
  }

  if (response.ok) {
    const payload = response.payload as SessionValidationSuccessResponse | null;
    if (payload?.ok && payload.user?.userId) {
      const serverUserId = String(payload.user.userId);
      const serverUserEmail = String(payload.user.email || "");
      // Identity refresh writes only when the server identity actually
      // differs from the cached one. An unconditional read-merge-write here
      // would resurrect this context's stale settings snapshot over any
      // concurrent change (e.g. another surface switching analyticsBaseUrl).
      // And symmetric with the stale-401 contract: this validation may only
      // update identity if the CURRENT credentials are still the pair it
      // validated — a newer login must never be overwritten by an older
      // validation's corrected identity.
      const current = await loadSettings();
      const currentUserId = String(current.userId || "").trim();
      const currentAuthToken = String(current.authToken || "");
      const sameCredentials = currentUserId === localUserId && currentAuthToken === localAuthToken;
      const identityChanged =
        serverUserId !== localUserId || serverUserEmail !== String(settings.userEmail || "");
      if (sameCredentials && identityChanged) {
        await saveSettings({ userId: serverUserId, userEmail: serverUserEmail });
      }
      return {
        status: "authenticated",
        userId: serverUserId,
        userEmail: serverUserEmail,
        expiresAt: Number(payload.expiresAt) || undefined,
      };
    }
  }

  return { status: "server_unavailable" };
}

export async function logoutAccount(): Promise<AuthLogoutResult> {
  // AUTH-UI-INV-14: local authority is revoked IMMEDIATELY — the server
  // revoke is a best-effort follow-up. Snapshot the credentials first, clear
  // local storage, then use the snapshot (never a re-read) for the network
  // call so a hanging server cannot keep the machine logged in.
  const settings = await loadSettings();
  const userId = String(settings.userId || "").trim();
  const authToken = String(settings.authToken || "");
  const analyticsBaseUrl = resolveBaseUrl(settings.analyticsBaseUrl);

  await saveSettings({ userId: undefined, userEmail: undefined, authToken: undefined });
  logEvent("auth_logged_out");

  let serverStatus: AuthLogoutServerStatus = "no_local_credentials";
  if (userId && authToken) {
    try {
      const response = await fetchJsonWithTimeout(`${analyticsBaseUrl}/auth/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ userId }),
      });
      serverStatus = response.ok ? "revoked" : "server_rejected";
    } catch {
      serverStatus = "network_error";
    }
  }

  return { serverRevoked: serverStatus === "revoked", serverStatus };
}
