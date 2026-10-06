import React from "react";
import { ShieldCheckIcon } from "./Icons";

interface SessionStatusProps {
  expiresAt: string | null;
}

function formatExpiration(expiresAt: string | null): string {
  if (!expiresAt) {
    return "会话有效";
  }

  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) {
    return "会话有效";
  }

  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `本次会话将在 ${hours}:${minutes} 到期`;
}

export function SessionStatus({
  expiresAt,
}: SessionStatusProps): React.JSX.Element {
  const expirationText = formatExpiration(expiresAt);

  return (
    <div className="admin-session-status" aria-label="管理员会话状态">
      <div className="admin-session-badge">
        <span className="admin-status-dot" aria-hidden="true" />
        <ShieldCheckIcon size={14} className="admin-session-icon" />
        <span className="admin-session-label">管理员会话</span>
      </div>
      <span className="admin-session-expiry">{expirationText}</span>
    </div>
  );
}
