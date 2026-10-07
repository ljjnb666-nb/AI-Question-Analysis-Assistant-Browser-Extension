export interface AdminUserListItem {
  userId: string;
  email: string;
  createdAt: string;
  linkedDeviceCount: number;
  latestDeviceSeenAt: string | null;
}

export interface AdminUsersPageDto {
  limit: number;
  nextCursor: string | null;
}

export interface AdminUsersQueryDto {
  q: string | null;
}

export interface AdminUsersResponse {
  ok: true;
  generatedAt: string;
  data: AdminUserListItem[];
  page: AdminUsersPageDto;
  query: AdminUsersQueryDto;
}

export interface AdminSystemServiceState {
  status: "ok";
  uptimeSeconds: number;
}

export interface AdminSystemStorageState {
  driver: "sqlite" | "json";
}

export interface AdminSystemEmailState {
  configured: boolean;
}

export interface AdminSystemDeploymentState {
  authority: "single_process";
}

export interface AdminSystemAnalyticsState {
  retentionDays: number;
  privacyEpoch: number;
}

export interface AdminSystemResponse {
  ok: true;
  generatedAt: string;
  service: AdminSystemServiceState;
  storage: AdminSystemStorageState;
  email: AdminSystemEmailState;
  deployment: AdminSystemDeploymentState;
  analytics: AdminSystemAnalyticsState;
}

export interface FetchAdminUsersOptions {
  limit?: number;
  cursor?: string | null;
  q?: string | null;
  signal?: AbortSignal;
}
