# BDK Delivery QA Baseline

## Current executable smoke test

`npm run test:smoke`

The smoke suite starts the server on an isolated local port and verifies health, store/catalog contract, order preview and WhatsApp order parsing.

## Full Delivery Gate

See `qa/delivery-gate.md`. Smoke PASS is not production readiness. Full delivery requires runtime/provider execution, persistence, security, browser/mobile, regression, deployment and evidence gates.
