import { createServer } from "node:http";
import { isMailerConfigured, sendVerificationCodeEmail } from "./lib/mailer.mjs";
import { createAnalyticsHandler } from "./lib/server.mjs";
import {
  assertProductionStorageAuthority,
  pruneAdminAuditEventsInStorage,
} from "./lib/store.mjs";

assertProductionStorageAuthority();
pruneAdminAuditEventsInStorage();

const ADMIN_AUDIT_HOUSEKEEPING_INTERVAL_MS = 24 * 60 * 60 * 1000;
const adminAuditHousekeepingTimer = setInterval(() => {
  try {
    pruneAdminAuditEventsInStorage();
  } catch {
    // Keep failure output opaque: storage paths and low-level errors are never
    // part of the externally visible/logged Admin security contract.
    console.error("[analytics-server] admin audit housekeeping failed");
  }
}, ADMIN_AUDIT_HOUSEKEEPING_INTERVAL_MS);
adminAuditHousekeepingTimer.unref?.();

const PORT = Number(process.env.ANALYTICS_PORT || 8787);
const HOST = String(process.env.ANALYTICS_HOST || "0.0.0.0").trim() || "0.0.0.0";
const PUBLIC_BASE_URL =
  String(process.env.PUBLIC_BASE_URL || "").trim() ||
  `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`;
const server = createServer(
  createAnalyticsHandler({
    isMailerConfigured,
    sendVerificationCodeEmail,
    publicBaseUrl: PUBLIC_BASE_URL,
  }),
);

server.listen(PORT, HOST, () => {
  console.log(`[analytics-server] listening on ${PUBLIC_BASE_URL} (${HOST}:${PORT})`);
});
