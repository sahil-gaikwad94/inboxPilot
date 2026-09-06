# Security and Privacy Checklist

Before production Gmail deployment, verify OAuth state/CSRF validation, least-privilege scopes, encrypted refresh tokens, secure cookies, authenticated resource ownership, request validation, rate limits, SSRF-safe unsubscribe requests, no secrets or bodies in logs, prompt-injection handling, retention cleanup, user disconnect/deletion, dependency audits, and a dedicated test mailbox. Confirm no raw private inbox export or credentials is committed. The demo is safe to run locally but is not production identity or storage.
