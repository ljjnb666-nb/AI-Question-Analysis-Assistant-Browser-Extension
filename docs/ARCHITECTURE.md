# Architecture

## Overview

This extension has three runtime surfaces:

- `background`: MV3 service worker for privileged browser actions.
- `content`: page-side runtime for capture, detection, highlighting, and auto-solve.
- `sidepanel`: operator UI for scan results, history, settings, and batch actions.

Shared contracts live in `src/shared`, especially:

- `src/shared/types/`: cross-surface message and data contracts (split by domain)
  - `capture.ts`: capture-related types
  - `messages.ts`: message protocols
  - `parse.ts`: parse result types
  - `question.ts`: question block types
  - `settings.ts`: app settings types
  - `ui.ts`: UI component types
- `src/shared/utils/storage.ts`: settings, history, and floating-window persistence.
- `src/shared/utils/parseRouter.ts`: AI provider routing and parse entrypoint.
- `src/shared/auth/`: authentication module (AuthFields, useAuthController, authText)
- `src/shared/ui/`: common UI components (extensionUi.tsx)

## Content Runtime

`src/content/content-main.ts` is the lightweight entrypoint that lazy-loads the full runtime.

Runtime bootstrap and state management are delegated to:

- `src/content/contentRuntimeBootstrap.ts`: lazy loading and initialization
- `src/content/contentRuntimeState.ts`: runtime state management
- `src/content/contentRuntimeMessages.ts`: message type routing
- `src/content/contentMainBridges.ts`: bridge assembly for capture, detection, layout-watch, and auto-solve runtime dependencies
- `src/content/contentMainWorkflows.ts`: high-level workflow coordination

Detection orchestration:
- `src/content/contentDetectionBridge.ts`: viewport/full-page detection orchestration
- `src/content/detector/domDetector.ts`: main detection logic (1140 lines - see REFACTOR-PLAN-domDetector.md for split plan)
- `src/content/detector/domDetectorPlatforms.ts`: (planned) platform-specific detection
- `src/content/detector/domDetectorScoring.ts`: (planned) candidate scoring system
- `src/content/detector/domDetectorContainers.ts`: (planned) container detection

Auto-solve orchestration:
- `src/content/contentAutoSolveRuntimeBridge.ts`: runtime wrappers used by auto-solve orchestration
- `src/content/autoSolveOrchestration.ts`: main auto-solve loop
- `src/content/contentQuestionServices.ts`: DOM extraction and question-resolution helpers

## Sidepanel Runtime

`src/sidepanel/SidePanelApp.tsx` is a composition root with focused responsibilities.

State management:
- `src/sidepanel/sidepanelAppState.ts`: centralized state reducer
- `src/sidepanel/sidepanelStateSync.ts`: state mapping helpers for runtime messages

Action coordination:
- `src/sidepanel/useSidePanelActions.ts`: async action handlers and tab-message coordination
- `src/sidepanel/sidepanelActionMessages.ts`: message action handlers
- `src/sidepanel/sidepanelSelectionSync.ts`: candidate selection sync logic

UI sections:
- `src/sidepanel/sidePanelShell.tsx`: layout shell components
- `src/sidepanel/CandidatesTab.tsx`: candidates tab
- `src/sidepanel/candidatesTabSections.tsx`: candidates tab UI sections
- `src/sidepanel/HistoryTab.tsx`: history tab
- `src/sidepanel/historyTabSections.tsx`: history tab UI sections
- `src/sidepanel/settingsPanel.tsx`: settings form
- `src/sidepanel/settingsSections.tsx`: settings form sections
- `src/sidepanel/sidepanelTheme.tsx`: theme configuration

Batch operations:
- `src/sidepanel/batchOperations.ts`: batch parse/fill workflows
- `src/sidepanel/batchParseHeuristics.ts`: risky candidate detection

Message handling:
- `src/sidepanel/sidepanelMessageBridge.ts`: runtime/storage listeners
- `src/sidepanel/tabActions.ts`: tab-level actions

## Quality Gates

The repo has baseline engineering gates:

```bash
npm run lint        # ESLint check (21 warnings currently, see TYPESCRIPT-RULES-PLAN.md)
npm run typecheck   # TypeScript compilation check
npm run test:run    # Unit tests (204 passing, 28 test files)
npm run test:e2e    # Playwright E2E tests
npm run check       # All of the above
```

`npm run check` is the minimum pre-merge gate.

Test coverage baseline: 51.16% (see docs/COVERAGE-ANALYSIS.md for improvement roadmap)

## Maintenance Plans

Active improvement plans:

- **REFACTOR-PLAN-domDetector.md**: 5-phase plan to split domDetector.ts (1140 lines → ~240 lines)
- **TYPESCRIPT-RULES-PLAN.md**: Phased TypeScript strictness roadmap (4 phases over 3 months)
- **COVERAGE-ANALYSIS.md**: Test coverage improvement roadmap (51% → 65% → 75% → 80%)

## Refactor Rule

When a file starts doing both orchestration and implementation detail, split by responsibility:

1. keep state ownership near the entrypoint
2. move dependency assembly into bridge modules
3. move multi-step workflows into orchestration modules
4. keep shared contracts in `src/shared`
