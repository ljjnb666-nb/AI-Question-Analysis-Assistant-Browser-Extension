// Preserve the existing Side Panel import path while sharing the same
// timeout helper and 12-second budget with Popup. Runtime work stays content-owned.
export { awaitViewportCommand, VIEWPORT_COMMAND_TIMEOUT_MS } from "@/shared/ui/viewportDetectionTimeout";
export type { ViewportCommandOutcome } from "@/shared/ui/viewportDetectionTimeout";
