# Quiz Solver Extension

A Chrome MV3 extension for question capture, DOM-based detection, AI-assisted solving, batch fill, and guided auto-solve.

## Main Capabilities

- Manual capture with question-region selection
- Viewport and full-page question detection
- Sidepanel batch parse and batch fill workflows
- Floating result window with persistent state
- Auto-solve flow with retry/review heuristics
- Multiple AI providers routed through a shared parse layer

## Project Layout

```text
src/
  background/   MV3 service worker
  content/      page-side capture, detection, highlight, auto-solve
  popup/        popup entry
  sidepanel/    operator UI and batch workflows
  shared/       contracts, storage, parsing, utilities
```

See [docs/ARCHITECTURE.md](/C:/Users/LJJ2004/所有项目/quiz-solver-ext/docs/ARCHITECTURE.md) for module responsibilities and refactor rules.

See [docs/README.md](/C:/Users/LJJ2004/所有项目/quiz-solver-ext/docs/README.md) for the documentation and screenshot layout.

## Development

```bash
npm install
npm run dev
npm run build
```

Load `dist/` in `chrome://extensions` with Developer Mode enabled.

## Quality Checks

```bash
npm run lint
npm run typecheck
npm run test:run
npm run check
```

`npm run check` is the default local gate before committing.
