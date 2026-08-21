# BDK Delivery Gate — Test Matrix

This file is a test contract. It does not claim PASS until executed.

## Gate 1 — Runtime
- [ ] server/runtime starts
- [ ] health endpoint passes
- [ ] provider/runtime path executes

## Gate 2 — Core user flow
- [ ] catalog/store loads
- [ ] order can be built
- [ ] totals are correct
- [ ] order confirmation path is coherent
- [ ] status transitions are valid
- [ ] ticket/operational output is correct

## Gate 3 — Persistence
- [ ] authoritative persistence configured
- [ ] restart preserves authoritative state
- [ ] migrations apply cleanly
- [ ] failure/readiness behavior is explicit

## Gate 4 — Security
- [ ] secrets absent from source/artifacts
- [ ] input validation
- [ ] auth/authz where applicable
- [ ] tenant isolation where applicable
- [ ] dependency audit
- [ ] abuse/rate-limit/idempotency checks where applicable

## Gate 5 — UX/device
- [ ] desktop browser
- [ ] mobile browser
- [ ] responsive layout
- [ ] critical error states
- [ ] PWA behavior if in scope

## Gate 6 — Regression
- [ ] automated tests
- [ ] smoke test
- [ ] integration tests
- [ ] no critical regressions

## Gate 7 — Deployment
- [ ] build artifact reproducible
- [ ] deployment starts
- [ ] health after deployment
- [ ] persistence after deployment
- [ ] logs/observability
- [ ] rollback/recovery path understood

## Gate 8 — Evidence
- [ ] test report
- [ ] security findings
- [ ] known limitations
- [ ] build/source identifier
- [ ] human review

Final state is one of:
`DELIVERABLE | BLOCKED | REQUIRES_HUMAN_GATE | NOT_VERIFIED`
