# ADR 0001: Separate Classification from Action Policy

## Status
Accepted

## Decision
The classifier produces a category, calibrated confidence, model version, and reasons. A deterministic policy engine separately decides whether to archive, draft, escalate, or do nothing. High-stakes signals override confidence.

## Rationale
This makes autonomy explainable and testable, allows thresholds to change without retraining, and provides a safety boundary around uncertain models. It also makes interview discussion concrete: statistical confidence is not equivalent to permission to mutate a mailbox.
