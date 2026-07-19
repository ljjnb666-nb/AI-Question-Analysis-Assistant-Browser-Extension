# Architecture

## Overview

This extension has three runtime surfaces:

- `background`: MV3 service worker for privileged browser actions.
- `content`: page-side runtime for capture, detection, highlighting, and auto-solve.
- `sidepanel`: operator UI for scan results, history, settings, and batch actions.

Shared contracts live in `src/shared`, especially:

- `src/shared/types/index.ts`: cross-surface message and data contracts.
- `src/shared/utils/storage.ts`: settings, history, and floating-window persistence.
- `src/shared/utils/parseRouter.ts`: AI provider routing and parse entrypoint.

## Content Runtime

`src/content/content-main.ts` is the orchestration entrypoint, not the implementation dump.

Its responsibilities are intentionally narrow:

- hold content-runtime state
- wire message handlers
- start manual capture flow
- invoke bridge/orchestration modules

Most heavy wiring is delegated to:

- `src/content/contentMainBridges.ts`: bridge assembly for capture, detection, layout-watch, and auto-solve runtime dependencies
- `src/content/contentDetectionBridge.ts`: viewport/full-page detection orchestration
- `src/content/contentAutoSolveRuntimeBridge.ts`: runtime wrappers used by auto-solve orchestration
- `src/content/autoSolveOrchestration.ts`: main auto-solve loop
- `src/content/contentQuestionServices.ts`: DOM extraction and question-resolution helpers

## Sidepanel Runtime

`src/sidepanel/SidePanelApp.tsx` should remain a composition root.

It should primarily:

- own React state
- derive UI metrics
- render tabs

Behavioral wiring should stay outside the component where possible:

- `src/sidepanel/useSidePanelActions.ts`: async action handlers and tab-message coordination
- `src/sidepanel/sidepanelMessageBridge.ts`: runtime/storage listeners
- `src/sidepanel/sidepanelStateSync.ts`: state mapping helpers for runtime messages
- `src/sidepanel/batchOperations.ts`: batch parse/fill workflows

## Quality Gates

The repo now has a baseline engineering gate:

```bash
npm run lint
npm run typecheck
npm run test:run
npm run check
```

`npm run check` is the minimum pre-merge gate.

## Refactor Rule

When a file starts doing both orchestration and implementation detail, split by responsibility:

1. keep state ownership near the entrypoint
2. move dependency assembly into bridge modules
3. move multi-step workflows into orchestration modules
4. keep shared contracts in `src/shared`
