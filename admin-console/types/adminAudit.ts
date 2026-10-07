export interface AdminAuditMetadata {
  method?: string;
  path?: string;
  reason?: string;
}

export interface AdminAuditItem {
  auditId: string;
  event: string;
  outcome: string;
  createdAt: string;
  ipHash: string | null;
  sessionTag: string | null;
  metadata: AdminAuditMetadata | null;
}

export interface AdminAuditResponse {
  ok: true;
  generatedAt: string;
  data: AdminAuditItem[];
  page: {
    limit: number;
    nextCursor: string | null;
  };
}
