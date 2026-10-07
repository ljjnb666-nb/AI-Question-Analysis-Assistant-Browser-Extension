import { createHash } from "node:crypto";
import {
  ADMIN_AUDIT_RETENTION_MS,
  generateId,
  readAdminAuditEventsInStorage,
  recordAdminAuditEventInStorage,
} from "./store.mjs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_CURSOR_LENGTH = 1024;
const MAX_EVENT_LENGTH = 64;
const MAX_OUTCOME_LENGTH = 32;
const MAX_METADATA_VALUE_LENGTH = 120;
const ALLOWED_METADATA_KEYS = new Set(["method", "path", "reason"]);
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const ALLOWED_REASONS = new Set([
  "invalid_credentials",
  "origin_mismatch",
  "admin_csrf_rejected",
  "admin_csrf_required",
  "unsupported_mutation",
]);

export const ADMIN_AUDIT_EVENTS = Object.freeze({
  LOGIN: "admin_login",
  LOGOUT: "admin_logout",
  CSRF_REJECTED: "admin_csrf_rejected",
  ORIGIN_REJECTED: "admin_origin_rejected",
  MUTATION_REJECTED: "admin_mutation_rejected",
});
const ALLOWED_EVENTS = new Set(Object.values(ADMIN_AUDIT_EVENTS));
const ALLOWED_OUTCOMES = new Set(["success", "failure", "rejected"]);

export class AdminAuditError extends Error {
  constructor(code = "ADMIN_STORAGE_UNAVAILABLE", statusCode = 503) {
    super(code);
    this.name = "AdminAuditError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function invalidQuery() {
  throw new AdminAuditError("INVALID_ADMIN_QUERY", 400);
}

function boundedString(value, maxLength) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    ![...value].some((character) => {
      const code = character.codePointAt(0);
      return code <= 0x1f || code === 0x7f;
    });
}

function normalizeLimit(value) {
  if (value == null || value === "") return DEFAULT_LIMIT;
  const raw = String(value);
  if (!/^\d+$/.test(raw)) invalidQuery();
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) invalidQuery();
  return limit;
}

function encodeCursor({ createdAt, auditId }) {
  return Buffer.from(
    JSON.stringify({ v: 1, createdAt, auditId }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(value) {
  if (value == null || value === "") return null;
  const raw = String(value);
  if (raw.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    invalidQuery();
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    invalidQuery();
  }

  if (
    !parsed ||
    parsed.v !== 1 ||
    !Number.isSafeInteger(parsed.createdAt) ||
    parsed.createdAt < 0 ||
    !boundedString(parsed.auditId, 128)
  ) {
    invalidQuery();
  }

  return {
    createdAt: parsed.createdAt,
    auditId: parsed.auditId,
  };
}

export function normalizeAdminAuditQuery({ limit, cursor } = {}) {
  return {
    limit: normalizeLimit(limit),
    cursor: decodeCursor(cursor),
  };
}

function hashTag(prefix, value) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  return `${prefix}_${digest}`;
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const safe = {};
  for (const [key, rawValue] of Object.entries(metadata)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) continue;
    const value = String(rawValue ?? "").trim();
    if (!value || value.length > MAX_METADATA_VALUE_LENGTH) continue;
    if ([...value].some((character) => {
      const code = character.codePointAt(0);
      return code <= 0x1f || code === 0x7f;
    })) {
      continue;
    }

    if (key === "method") {
      if (!ALLOWED_METHODS.has(value)) continue;
      safe.method = value;
      continue;
    }
    if (key === "path") {
      if (
        !value.startsWith("/admin") ||
        value.includes("?") ||
        value.includes("#") ||
        !/^\/[A-Za-z0-9._~/-]+$/.test(value)
      ) {
        continue;
      }
      safe.path = value;
      continue;
    }
    if (key === "reason") {
      if (!ALLOWED_REASONS.has(value)) continue;
      safe.reason = value;
    }
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

function toDto(entry) {
  if (
    !boundedString(entry?.auditId, 128) ||
    !boundedString(entry?.event, MAX_EVENT_LENGTH) ||
    !ALLOWED_EVENTS.has(entry.event) ||
    !boundedString(entry?.outcome, MAX_OUTCOME_LENGTH) ||
    !ALLOWED_OUTCOMES.has(entry.outcome)
  ) {
    throw new AdminAuditError();
  }
  const createdAt = Number(entry.createdAt);
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw new AdminAuditError();
  if (entry.ipHash != null && !/^ip_[0-9a-f]{16}$/.test(String(entry.ipHash))) {
    throw new AdminAuditError();
  }
  if (
    entry.sessionTag != null &&
    !/^session_[0-9a-f]{16}$/.test(String(entry.sessionTag))
  ) {
    throw new AdminAuditError();
  }

  return {
    auditId: entry.auditId,
    event: entry.event,
    outcome: entry.outcome,
    createdAt: new Date(createdAt).toISOString(),
    ipHash: entry.ipHash ?? null,
    sessionTag: entry.sessionTag ?? null,
    metadata: sanitizeMetadata(entry.metadata),
  };
}

export function createAdminAuditRecorder({
  now = () => Date.now(),
  recordImpl = recordAdminAuditEventInStorage,
  generateIdImpl = () => generateId("adm"),
} = {}) {
  return function recordAdminAudit({
    event,
    outcome,
    ip,
    sessionToken,
    metadata,
  }) {
    if (
      !boundedString(event, MAX_EVENT_LENGTH) ||
      !ALLOWED_EVENTS.has(event) ||
      !boundedString(outcome, MAX_OUTCOME_LENGTH) ||
      !ALLOWED_OUTCOMES.has(outcome)
    ) {
      throw new AdminAuditError("ADMIN_INTERNAL_ERROR", 500);
    }
    const createdAt = Number(now());
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
      throw new AdminAuditError("ADMIN_INTERNAL_ERROR", 500);
    }

    const auditId = String(generateIdImpl());
    if (!boundedString(auditId, 128)) {
      throw new AdminAuditError("ADMIN_INTERNAL_ERROR", 500);
    }

    const entry = {
      auditId,
      event,
      outcome,
      createdAt,
      ipHash: hashTag("ip", ip),
      sessionTag: hashTag("session", sessionToken),
      metadata: sanitizeMetadata(metadata),
    };

    try {
      return recordImpl(entry);
    } catch {
      throw new AdminAuditError();
    }
  };
}

export function createAdminAuditReadModel({
  now = () => Date.now(),
  readImpl = readAdminAuditEventsInStorage,
} = {}) {
  return {
    list(query = normalizeAdminAuditQuery()) {
      const current = Number(now());
      if (!Number.isSafeInteger(current) || current < 0) {
        throw new AdminAuditError("ADMIN_INTERNAL_ERROR", 500);
      }
      let rows;
      try {
        rows = readImpl({
          limit: query.limit + 1,
          cursorCreatedAt: query.cursor?.createdAt ?? null,
          cursorAuditId: query.cursor?.auditId ?? null,
          cutoffCreatedAt: current - ADMIN_AUDIT_RETENTION_MS,
        });
      } catch (error) {
        if (error instanceof AdminAuditError) throw error;
        throw new AdminAuditError();
      }

      if (!Array.isArray(rows)) throw new AdminAuditError();
      const hasMore = rows.length > query.limit;
      const visible = rows.slice(0, query.limit);
      const data = visible.map(toDto);
      const last = visible.at(-1);
      const nextCursor = hasMore && last
        ? encodeCursor({
            createdAt: Number(last.createdAt),
            auditId: String(last.auditId),
          })
        : null;

      return {
        generatedAt: new Date(current).toISOString(),
        data,
        page: {
          limit: query.limit,
          nextCursor,
        },
      };
    },
  };
}

export const ADMIN_AUDIT_DEFAULT_LIMIT = DEFAULT_LIMIT;
export const ADMIN_AUDIT_MAX_LIMIT = MAX_LIMIT;
