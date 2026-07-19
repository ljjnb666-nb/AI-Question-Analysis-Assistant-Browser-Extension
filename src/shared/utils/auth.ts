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

export async function logoutAccount(): Promise<void> {
  await saveSettings({
    userId: undefined,
    userEmail: undefined,
    authToken: undefined,
  });
  logEvent("auth_logged_out");
}
