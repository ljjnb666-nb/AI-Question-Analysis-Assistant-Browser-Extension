import type { AnalyticsEvent } from "./analytics";

export interface AnalyticsSessionEntry {
  event: AnalyticsEvent;
  data?: Record<string, string | number | boolean>;
  ts: number;
  duration?: number;
}

export const SESSION_LOG: AnalyticsSessionEntry[] = [];
let analyticsQueue: Promise<void> = Promise.resolve();
let analyticsConsentGeneration = 0;

export function enqueueAnalyticsWork(work: () => Promise<void>): Promise<void> {
  const next = analyticsQueue.catch(() => undefined).then(work);
  analyticsQueue = next;
  return next;
}

export async function flushAnalyticsWork(): Promise<void> {
  await analyticsQueue.catch(() => undefined);
}

export function clearSessionAnalytics(): void {
  SESSION_LOG.length = 0;
}

export function getAnalyticsConsentGeneration(): number {
  return analyticsConsentGeneration;
}

export function invalidateAnalyticsConsent(): number {
  analyticsConsentGeneration += 1;
  clearSessionAnalytics();
  return analyticsConsentGeneration;
}

export function __resetAnalyticsStateForTests(): void {
  analyticsConsentGeneration = 0;
  clearSessionAnalytics();
  analyticsQueue = Promise.resolve();
}
