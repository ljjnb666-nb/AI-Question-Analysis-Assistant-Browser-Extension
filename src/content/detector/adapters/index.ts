export * from "./types";
import { registerSiteAdapter } from "./types";
import { pintiaCodeProblemAdapter, pintiaQuestionListAdapter } from "./pintia";

// Strangler step 1: platform adapters register here. The generic engine in
// domDetector.ts resolves them by id; unmatched pages use the generic path.
registerSiteAdapter(pintiaQuestionListAdapter);
registerSiteAdapter(pintiaCodeProblemAdapter);
