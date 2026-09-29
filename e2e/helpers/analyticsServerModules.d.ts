// The analytics server ships as plain ESM JavaScript. These wildcard module
// declarations give the E2E harness the narrow API surface it drives.
declare module "*/analytics-server/lib/store.mjs" {
  export function resetDbConnectionForTests(): void;
  export function validateUserSessionInStorage(
    userId: string,
    authToken: string,
    now: number,
  ): { user: { userId: string; email: string }; expiresAt: number } | null;
  export function revokeUserSessionInStorage(userId: string, authToken: string, now: number): Promise<boolean>;
}

declare module "*/analytics-server/lib/server.mjs" {
  export function createAnalyticsHandler(
    options: Record<string, unknown>,
  ): (req: unknown, res: unknown) => Promise<void>;
}
