# Docs Layout

## Core Docs

- `ARCHITECTURE.md`: module boundaries and refactor rules
- `MANUAL-TEST-GUIDE.md`: manual verification steps
- `ANALYTICS-AUTH.md`: local analytics/auth backend setup and security notes
- `P0-IMPROVEMENTS.md`: earlier engineering improvement notes

## Recommended Reading Order

1. Read `../README.md` for the repo-level setup commands.
2. Read `ARCHITECTURE.md` before refactoring runtime modules.
3. Read `ANALYTICS-AUTH.md` before starting the local backend or auth flow.
4. Use `MANUAL-TEST-GUIDE.md` when validating capture, parse, fill, and auto-solve behavior.
5. Run `npm run test:e2e` for the extension popup smoke test after `dist/` is buildable locally.
