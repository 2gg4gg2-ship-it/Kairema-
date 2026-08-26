# KAIREMA — SSE admission contract

**Дата:** 2026-08-26  
**Статус:** **READ-ONLY POLICY DECISION**  
**Scope:** current chat-stream handler only; no provider, auth, schema or queue infrastructure change.

## Current verified behavior

| Stage | Current behavior | Measurement boundary |
|---|---|---|
| Authentication and input | Request is authenticated and validated before chat work. | Rejected requests never enter stream admission. |
| Replay | Process-local completed/pending replay, then durable stored assistant replay, return before quota and admission. | Duplicate replay does not consume quota or active-stream capacity. |
| Durable ingress quota | Per-user durable fixed-minute quota runs before capacity reservation. Quota store failure is fail-closed 503; quota excess is 429 with `Retry-After`. | This is cross-replica only for request rate, not active streams. |
| Local capacity | Immediate accept if process has fewer than 12 active streams and actor has fewer than 2 local active streams. | `12 / instance`, `2 / user / instance`. |
| Saturation | Immediate controlled 503 before history/context/provider work. | No queue depth or wait exists. |
| Lifecycle | Reservation is released exactly once in handler `finally` after success, error or cancellation path settles. | Capacity is not intentionally released while a provider call remains outstanding. |

## Admission measurement contract

The following are metadata-only local-process measurements. They are diagnostic samples, not global production SLOs.

| Metric | Meaning | Initial benchmark target | Limitation |
|---|---|---|---|
| Accepted streams | Reservations created after durable quota. | Report only. | Current process only. |
| Controlled capacity 503 | Local 12/2 guard rejected a request. | Report only; not an application error. | Does not include other pods. |
| Per-user capacity rejections | Aggregate rejections caused by the 2-stream local actor limit. | Report only. | No user ID is retained. |
| Queue entered / timeout / wait percentiles | Always zero because no queue is created. | Zero by policy. | A queue would need separate approval/infrastructure. |
| Active streams and active-user buckets | Current local active count plus aggregate bucket distribution. | Never above 12 locally. | Snapshot may reset on process restart. |
| Stream-start and duration percentiles | Bounded local sample of handler start-to-SSE-start and active duration. | Benchmark target only; no production SLO asserted. | Includes current process scheduling only. |
| Replay, rate-limit and quota-unavailable outcomes | Aggregate control-flow counters. | Report only. | Does not include content or identifiers. |

## Bounded queue decision

**Decision: retain immediate accept / immediate controlled 503; do not add a queue or wait policy in this runtime.**

A queue held in process memory would be scoped to one autoscale pod, would be lost on restart, and would not coordinate with capacity on other replicas. A bounded HTTP wait would also retain open requests while the existing SSE handler may wait on a long-lived provider operation. That would add pressure precisely during saturation, introduce non-uniform behavior between replicas, and cannot provide a correct global queue without additional distributed infrastructure. Redis, BullMQ, Kafka and new services are explicitly out of scope.

The safe free-first admission behavior is therefore: **accept immediately when local capacity is available; otherwise return a generic controlled 503 before history/context/provider work**. Durable request quota and durable replay remain authoritative for their own scopes; local active-stream state remains only a resource safeguard.

## Evidence-based next decision boundary

No numerical production queue or latency SLO is asserted. A future policy requires separately approved non-production evidence with a cross-replica-safe coordination mechanism or platform-provided admission primitive. Until then, the existing 12/2 guard remains the explicit runtime limit, and the benchmark must classify it as a local saturation boundary rather than capacity readiness.
