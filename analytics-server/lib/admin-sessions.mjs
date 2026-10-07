import { randomBytes } from "node:crypto";

export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const ADMIN_SESSION_MAX_COUNT = 64;

export function createAdminSessionStore({
  createToken = () => randomBytes(32).toString("base64url"),
  createCsrfToken = () => randomBytes(32).toString("base64url"),
  maxSessions = ADMIN_SESSION_MAX_COUNT,
  now = () => Date.now(),
  ttlMs = ADMIN_SESSION_TTL_MS,
} = {}) {
  if (!Number.isInteger(maxSessions) || maxSessions < 1) {
    throw new RangeError("maxSessions must be a positive integer");
  }
  if (!Number.isFinite(ttlMs) || ttlMs < 1) {
    throw new RangeError("ttlMs must be a positive number");
  }

  const sessions = new Map();

  function removeExpired() {
    const currentTime = now();
    for (const [token, session] of sessions) {
      if (session.expiresAt <= currentTime) sessions.delete(token);
    }
  }

  return {
    delete(token) {
      sessions.delete(String(token || ""));
    },
    get(token) {
      removeExpired();
      const session = sessions.get(String(token || ""));
      if (!session || session.expiresAt <= now()) return null;
      return {
        expiresAt: session.expiresAt,
        csrfToken: session.csrfToken,
      };
    },
    has(token) {
      removeExpired();
      const session = sessions.get(String(token || ""));
      return Boolean(session && session.expiresAt > now());
    },
    issue() {
      removeExpired();
      while (sessions.size >= maxSessions) {
        sessions.delete(sessions.keys().next().value);
      }

      let token;
      do {
        token = String(createToken() || "");
      } while (!token || sessions.has(token));

      const csrfTokens = new Set(
        [...sessions.values()].map((session) => session.csrfToken),
      );
      let csrfToken;
      do {
        csrfToken = String(createCsrfToken() || "");
      } while (!csrfToken || csrfToken === token || csrfTokens.has(csrfToken));

      const expiresAt = now() + ttlMs;
      sessions.set(token, { expiresAt, csrfToken });
      return { token, expiresAt, csrfToken };
    },
    get size() {
      removeExpired();
      return sessions.size;
    },
  };
}
