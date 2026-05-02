# @ballast/shared

Typed Jupiter API clients and shared utilities.

## Layout

- `src/clients/` — typed fetch wrappers for Jupiter endpoints (Lend Earn, Prediction). Each client takes a `JupiterHttpClient` and exposes typed methods. The HTTP client emits an `ApiObservation` for every request — orchestrator consumes these to build the public DX log.
- `src/types/` — TypeScript interfaces mirroring Jupiter's response shapes. Authoritative source: live API probes documented in `/docs/api-research/`.
- `src/utils/` — helpers for unit conversions (micro-USD, bps) and assertions.

## Why a thin client (and not a full SDK)

Jupiter ships official SDKs (`@jup-ag/lend`, `@jup-ag/lend-read`) that we use for transaction-building flows. But for read-only API exploration — which dominates Ballast's surface area — a thin typed client gives us:

1. Full visibility into what the API actually returns (including undocumented fields)
2. The `onObservation` hook that powers the public DX log (a key differentiator)
3. Zero dependency on SDK release cadence
