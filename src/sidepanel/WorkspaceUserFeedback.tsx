import type { UserFeedback } from "@/shared/ui/userFeedback";
import { OrbitStatus } from "@/shared/ui/orbitPrimitives";
import {
  WORKSPACE_REVIEW_REQUIRED_FEEDBACK_CODES,
  type WorkspaceActivity,
} from "./sidePanelWorkspaceState";

/** Ordinary action outcomes share one surface; promoted review copy stays in the strip. */
export function WorkspaceUserFeedback({
  feedback,
  activity,
}: {
  feedback: UserFeedback | null;
  activity: WorkspaceActivity | null;
}) {
  if (!feedback) return null;
  if (
    feedback.code &&
    WORKSPACE_REVIEW_REQUIRED_FEEDBACK_CODES.has(feedback.code) &&
    activity?.kind === "review" &&
    activity.secondary === feedback.message
  )
    return null;
  return (
    <div data-testid="workspace-user-feedback">
      <OrbitStatus tone={feedback.tone} label={feedback.message} />
    </div>
  );
}
