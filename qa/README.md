# BDK Delivery QA

## Smoke benchmark

Run:

`npm run test:smoke`

The smoke suite starts the server on an isolated local port and verifies:

1. health endpoint
2. store/catalog contract
3. order preview calculation
4. WhatsApp order parsing

This is a baseline, not a production-readiness certificate. The next benchmark layer must add integration, security, regression, responsive/PWA and deployment validation before delivery claims are made.
