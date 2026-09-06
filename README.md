# InboxPilot

InboxPilot is an explainable Gmail triage agent. It separates **classification** from **action policy**: confidence thresholds may permit low-risk archive actions or reviewable reply drafts, while high-stakes messages remain untouched. Every decision is visible, auditable, and reversible where supported.

> The repository supports two modes. Demo mode runs without credentials using an in-memory mock Gmail adapter. Production mode uses Gmail OAuth, MongoDB Atlas persistence, the FastAPI ML service, and a versioned scikit-learn champion artifact. The demo remains the default safe regression fixture.

## Quick start

```bash
npm install
npm run dev
```

Open `http://localhost:5173` and click **Analyze inbox**. The demo includes promotional noise, routine project mail, a security alert, and an unknown message. API health is available at `http://localhost:4000/api/health`; the Python service runs independently with `uvicorn app.main:app --host 0.0.0.0 --port 8000` from `services/ml`.

## Architecture

React/Vite is the presentation layer. Express owns user-facing orchestration and policy decisions. FastAPI owns the ML contract: classification, safe drafting, and correction intake. Gmail OAuth and the real Gmail adapter are implemented behind a provider boundary. MongoDB/Mongoose models persist users and decisions when `MONGODB_URI` is configured; otherwise the mock repository is used.

The core flow is `email → classify → policy decision → action/audit → user correction`. The policy engine is deliberately deterministic and independent of the classifier, which makes threshold tuning, safety review, and model replacement straightforward.

## Safety model

InboxPilot never sends replies automatically. Drafts are suggestions that require review. Security, financial, legal, medical, employment, password, and verification signals are escalated even if a model is confident. Unsubscribe automation is disabled by default. All production credentials must be stored as environment variables and never committed.

## Tests

- Node policy tests: `npm test -w apps/api`
- Frontend type/build check: `npm run build -w apps/web`
- Python tests: `cd services/ml && pytest`

## Render deployment

Use `render.yaml` as the deployment blueprint. The ML service installs dependencies and trains the champion model during its build. Deploy ML and API first, set `WEB_ORIGIN`, `ML_SERVICE_URL`, `MONGODB_URI`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and optionally `GOOGLE_ALLOWED_EMAIL`, then deploy the static frontend with `VITE_API_URL=https://<api-service>/api`. Register the exact production OAuth callback URL and keep Gmail scopes least-privileged. Render free services can sleep, so sync is user-triggered; use a paid worker for predictable polling.

## ML model quality

The starter champion model now uses 125 curated examples across five classes, word-level and character-level TF-IDF features, explicit domain intent markers, balanced logistic regression, and sigmoid probability calibration. Five-fold stratified cross-validation currently reports **74.4% accuracy**, **73.8% macro-F1**, and **74.4% balanced accuracy**, compared with the former 15-example baseline’s 40% holdout accuracy. The 100% fit score is not used as the quality claim; cross-validation is the relevant number. Add reviewed mailbox labels before enabling wider autonomous actions.

## Production completion notes

Gmail OAuth, Gmail metadata sync, archive/undo, draft-save approval, MongoDB models/indexes, ML-service calls with a four-second timeout and local fallback, and a reproducible TF-IDF/logistic-regression champion training script are included. Before public launch, configure your own Google Cloud OAuth consent screen, Atlas database, HTTPS callback URL, and authenticated user/session policy. See `docs/LEARNING_GUIDE.md` and `docs/SECURITY_CHECKLIST.md` for the operational checklist.
