# Docs Layout

## Core Docs

- `RELEASE-READINESS.md`: authoritative release-hardening status, frozen invariants, known safe limitations, and release gates
- `PHASE12-RC-TRUTH.md`: Phase 12 release-candidate identity and bundle-truth contract
- `PHASE12B-REAL-BROWSER-ACCEPTANCE.md`: Phase 12B real Chrome `activeTab` user-activation and lifecycle acceptance contract
- `ARCHITECTURE.md`: module boundaries and refactor rules
- `COMPATIBILITY-MATRIX.md`: deterministic DOM compatibility corpus and known safe limitations
- `PERMISSIONS.md`: frozen production permission contract and screenshot-authority evidence
- `API-KEY-SECURITY.md`: local API key encryption threat model (not a secret vault)
- `MANUAL-TEST-GUIDE.md`: manual verification steps and release manual checks
- `ANALYTICS-AUTH.md`: local analytics/auth backend setup and security notes
- `P0-IMPROVEMENTS.md`: earlier engineering improvement notes (historical record)
- [`../PRIVACY.md`](../PRIVACY.md): extension and service data flows (analytics, account service, AI providers)

## Recommended Reading Order

1. Read `../README.md` for the repo-level setup commands.
2. Read `RELEASE-READINESS.md` for the current release-hardening status and invariants.
3. Read `ARCHITECTURE.md` before refactoring runtime modules.
4. Read `COMPATIBILITY-MATRIX.md` for supported scenarios and known limitations.
5. Read `PERMISSIONS.md` for the production permission contract.
6. Read `../PRIVACY.md` for data flows, then `ANALYTICS-AUTH.md` before starting the local backend or auth flow.
7. Read `API-KEY-SECURITY.md` for the local credential storage threat model.
8. Use `MANUAL-TEST-GUIDE.md` when validating capture, parse, fill, and auto-solve behavior.
9. Run `npm run test:e2e` for the extension popup smoke test after `dist/` is buildable locally.
