# ADR 0002: Safe Demo Storage Boundary

## Status
Accepted

## Decision
The first runnable release uses an in-memory repository and mock Gmail adapter, while keeping API shapes and boundaries ready for MongoDB and Gmail implementations.

## Rationale
This makes the complete flow testable without private credentials or external services and avoids implying that raw mailbox content is safe to persist. Production work must add authenticated ownership, encrypted tokens, Mongoose schemas/indexes, retention cleanup, and transactional/idempotent action records.
