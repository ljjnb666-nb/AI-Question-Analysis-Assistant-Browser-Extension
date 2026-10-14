import type { DomCandidateDiagnostics, QuestionBlock } from "@/shared/types";

/**
 * Strangler step 1: site-specific detection lives in adapters, the generic
 * engine stays site-agnostic. Adapters are moved as-is (zero behavior change);
 * later steps let them add score instead of early-returning.
 */
export interface SiteAdapterContext {
  hostRightCutX: number | null;
  vw: number;
  vh: number;
  diagnostics?: DomCandidateDiagnostics;
}

export interface SiteAdapter {
  /** Stable id, e.g. "pintia-question-list". */
  id: string;
  /** Cheap host/page predicate; evaluated before buildCandidates. */
  matches: () => boolean;
  /** Build candidates for this site. */
  buildCandidates: (ctx: SiteAdapterContext) => QuestionBlock[];
  /**
   * Whether this adapter's non-empty blocks take over the generic path.
   * Defaults to true. Adapters that only refine specific pages (e.g. code
   * problems when no structured containers exist) narrow it here instead of
   * the engine hardcoding per-site branches.
   */
  takesOver?: (ctx: SiteAdapterTakeoverContext) => boolean;
  /**
   * Pipeline phase. "pre-structured" adapters run before the generic
   * structured-container path, "post-structured" after it. Defaults to
   * "pre-structured". This preserves the original interleaving (e.g. pintia
   * question-list wins early, pintia code-problem only fills the gap).
   */
  phase?: "pre-structured" | "post-structured";
}

export interface SiteAdapterTakeoverContext {
  hasStructuredContainers: boolean;
  hasAcceptedDirectCard: boolean;
}

const registry = new Map<string, SiteAdapter>();

export function registerSiteAdapter(adapter: SiteAdapter): void {
  registry.set(adapter.id, adapter);
}

export function getSiteAdapter(id: string): SiteAdapter | undefined {
  return registry.get(id);
}

export function listSiteAdapters(): SiteAdapter[] {
  return [...registry.values()];
}

/**
 * Strangler step 1: run registered adapters in order; the first whose
 * predicate matches, produces blocks, and takes over wins. Returns null when
 * no adapter claims the page, leaving the generic engine in charge.
 */
export function runSiteAdapters(
  ctx: SiteAdapterContext,
  takeover: SiteAdapterTakeoverContext,
  phase: "pre-structured" | "post-structured" = "pre-structured",
): QuestionBlock[] | null {
  for (const adapter of listSiteAdapters()) {
    if ((adapter.phase ?? "pre-structured") !== phase) continue;
    if (!adapter.matches()) continue;
    const blocks = adapter.buildCandidates(ctx);
    if (blocks.length === 0) continue;
    if (adapter.takesOver?.(takeover) ?? true) return blocks;
  }
  return null;
}
