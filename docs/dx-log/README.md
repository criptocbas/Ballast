# DX Log

This directory holds the running Developer Experience log for our Jupiter integration. It is **maintained in real-time during development** — every friction point is captured here as it happens, then rolled into `DX-REPORT.md` at submission.

The orchestrator's `/dx/observations` endpoint serves a live feed of every Jupiter API call (timestamps, latency, status, error messages). The frontend's `/dx` page surfaces it publicly so judges can verify our integration depth in real time.

## Files

- `00-bootstrap.md` — initial findings from the API research probes
- `01-ai-stack.md` — observations on Jupiter's AI tools (CLI, Skills, Docs MCP)
- (more files added as features land)

## Counting DX gaps

Each captured friction point gets a stable ID (`DX-GAP-#N`). The final report lists all of them with severity, root cause, and a specific suggested fix.

| Range | Meaning |
|---|---|
| #1–#9 | Read-API surface (events, markets, orderbook, lend tokens) |
| #10–#19 | AI Stack (CLI, Skills, MCP) |
| #20+ | Write-API surface (orders, deposits, claims) — populated as we hit them |
