# Phase 11A.2 - Google Cloud Billing + Vertex AI Activation

This runbook activates Vertex AI for Google Cloud Run staging without API keys, JSON keys, or `GOOGLE_APPLICATION_CREDENTIALS`.

## Safety

- Do not use `GCP_SERVICE_ACCOUNT_KEY`.
- Do not create or download service account JSON keys.
- Do not print secrets.
- Do not run migrations or `db:push`.
- AI remains suggest-only. No auto-send and no outbound channel calls.

## Preflight

```bash
PROJECT_ID="khadamatk-auth"
REGION="us-central1"
SERVICE="khadamatak-staging"
RUNTIME_SA_NAME="khadamatak-staging-runtime"
RUNTIME_SA="${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud config set project "$PROJECT_ID"
gcloud beta billing projects describe "$PROJECT_ID" --format="value(billingEnabled)"
```

Expected: `True`.

## Budget alert

Create a low monthly budget for staging, for example 10 or 20 USD, with alerts at 50%, 80%, and 100%.

If CLI billing permissions are not available, use Google Cloud Console:

1. Billing.
2. Budgets & alerts.
3. Create budget.
4. Scope: project `khadamatk-auth`.
5. Amount: 10 or 20 USD monthly.
6. Threshold rules: 50%, 80%, 100%.
7. Save.

## Enable Vertex AI

```bash
gcloud services enable aiplatform.googleapis.com --project="$PROJECT_ID"
```

## Runtime service account

```bash
gcloud iam service-accounts describe "$RUNTIME_SA" --project="$PROJECT_ID" >/dev/null 2>&1 || \
gcloud iam service-accounts create "$RUNTIME_SA_NAME" \
  --project="$PROJECT_ID" \
  --display-name="Khadamatak staging runtime"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/aiplatform.user"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/cloudsql.client"

gcloud secrets add-iam-policy-binding DATABASE_URL \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding SESSION_SECRET \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/secretmanager.secretAccessor"
```

## Cloud Run Vertex env

Cloud Build deploys staging with:

```text
AI_PROVIDER=vertex
VERTEX_PROJECT_ID=$PROJECT_ID
VERTEX_LOCATION=us-central1
VERTEX_MODEL=gemini-2.5-flash
AI_MAX_OUTPUT_TOKENS=1024
AI_TEMPERATURE=0.2
```

## Manual update fallback

Use only if the trigger has not redeployed yet:

```bash
gcloud run services update "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --service-account="$RUNTIME_SA" \
  --update-env-vars=AI_PROVIDER=vertex,VERTEX_PROJECT_ID="$PROJECT_ID",VERTEX_LOCATION="$REGION",VERTEX_MODEL=gemini-2.5-flash,AI_MAX_OUTPUT_TOKENS=1024,AI_TEMPERATURE=0.2
```

## Verify

```bash
SERVICE_URL="$(gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)')"
curl -fsS "$SERVICE_URL/api/healthz"; echo
curl -fsS "$SERVICE_URL/api/readyz"; echo
```

Check `/api/ai/provider-status` from an authenticated browser session. It should show `provider=vertex` and `fallbackMode=false` after the first successful AI run.

