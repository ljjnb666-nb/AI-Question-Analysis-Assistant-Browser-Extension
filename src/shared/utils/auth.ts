import { logEvent } from "./analytics";
import { DEFAULT_ANALYTICS_BASE_URL } from "../constants/analytics";
import { loadSettings, saveSettings, getOrCreateDeviceId } from "./storage";

type AuthSuccessResponse = {
  ok: true;
  user: {
    userId: string;
    email: string;
  };
  authToken: string;
};

type AuthFailureResponse = {
  ok: false;
  error?: string;
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

async function submitAuth(
  path: "/auth/register" | "/auth/login",
  email: string,
  password: string,
): Promise<AuthSuccessResponse> {
  const settings = await loadSettings();
  const deviceId = settings.deviceId || await getOrCreateDeviceId();
  const baseUrl = resolveBaseUrl(settings.analyticsBaseUrl);

  const response = await fetch(`${baseUrl}${path}`, {
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

  const payload = await response.json() as AuthSuccessResponse | AuthFailureResponse;
  if (!response.ok || !payload.ok) {
    throw new Error((payload as AuthFailureResponse).error || "Authentication failed");
  }

  await saveSettings({
    deviceId,
    analyticsBaseUrl: baseUrl,
    userId: payload.user.userId,
    userEmail: payload.user.email,
    authToken: payload.authToken,
  });

  logEvent(path === "/auth/register" ? "auth_registered" : "auth_logged_in", {
    userId: payload.user.userId,
  });

  return payload;
}

export async function loginWithEmail(email: string, password: string): Promise<AuthSuccessResponse> {
  return submitAuth("/auth/login", email, password);
}

export async function sendEmailVerificationCode(email: string): Promise<SendCodeSuccessResponse> {
  const settings = await loadSettings();
  const baseUrl = resolveBaseUrl(settings.analyticsBaseUrl);
  const response = await fetch(`${baseUrl}/auth/send-verification-code`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: email.trim() }),
  });
  const payload = await response.json() as SendCodeSuccessResponse | AuthFailureResponse;
  if (!response.ok || !payload.ok) {
    throw new Error((payload as AuthFailureResponse).error || "Failed to send verification code");
  }
  return payload as SendCodeSuccessResponse;
}

export async function registerWithEmailCode(email: string, password: string, verificationCode: string): Promise<AuthSuccessResponse> {
  const settings = await loadSettings();
  const deviceId = settings.deviceId || await getOrCreateDeviceId();
  const baseUrl = resolveBaseUrl(settings.analyticsBaseUrl);

  const response = await fetch(`${baseUrl}/auth/register`, {
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

  const payload = await response.json() as AuthSuccessResponse | AuthFailureResponse;
  if (!response.ok || !payload.ok) {
    throw new Error((payload as AuthFailureResponse).error || "Registration failed");
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
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/auth/session`, {
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
    await saveSettings({ userId: undefined, userEmail: undefined, authToken: undefined });
    return { status: "unauthenticated" };
  }

  if (response.ok) {
    try {
      const payload = (await response.json()) as SessionValidationSuccessResponse;
      if (payload?.ok && payload.user?.userId) {
        const serverUserId = String(payload.user.userId);
        const serverUserEmail = String(payload.user.email || "");
        await saveSettings({ userId: serverUserId, userEmail: serverUserEmail });
        return {
          status: "authenticated",
          userId: serverUserId,
          userEmail: serverUserEmail,
          expiresAt: Number(payload.expiresAt) || undefined,
        };
      }
    } catch {
      // Malformed success payloads prove nothing; treat like any other
      // inconclusive server response below.
    }
  }

  return { status: "server_unavailable" };
}

export async function logoutAccount(): Promise<AuthLogoutResult> {
  const settings = await loadSettings();
  const userId = String(settings.userId || "").trim();
  const authToken = String(settings.authToken || "");

  let serverStatus: AuthLogoutServerStatus = "no_local_credentials";
  if (userId && authToken) {
    try {
      const baseUrl = resolveBaseUrl(settings.analyticsBaseUrl);
      const response = await fetch(`${baseUrl}/auth/logout`, {
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

  // Local credentials are cleared no matter how the server call ended: a
  // failed revoke must not leave a session that still looks locally valid.
  await saveSettings({ userId: undefined, userEmail: undefined, authToken: undefined });
  logEvent("auth_logged_out");
  return { serverRevoked: serverStatus === "revoked", serverStatus };
}
