# Technology Radar Delivery Gate

A discovered technology is not production-ready by discovery alone.

## Required evidence
1. source/version/commit captured
2. license verified
3. security/dependency review
4. architecture compatibility reviewed
5. bounded experiment executed
6. regression passed
7. performance/economic impact measured
8. rollback path verified
9. promotion decision recorded

## Promotion states
`WATCH → EXPERIMENT → VALIDATED → PROPOSED_FOR_PRODUCTION → APPROVED → PROMOTED`

A failure returns the candidate to `WATCH` or `REJECTED`; it is retained as evidence.

## Automatic behavior
The BDK may automatically discover, catalog, score, compare and prepare experiments. It may create a branch/change proposal after a successful experiment. It must not silently deploy new dependencies or production code from the radar.

## Goal
Use the external ecosystem to accelerate delivery while preserving security, provenance, reproducibility and human accountability.
