#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="khadamatk-auth"
REGION="us-central1"
SERVICE="khadamatak-staging"
REPO="khadamatak"
IMAGE="app"
CLOUDSQL_INSTANCE="khadamatk-auth:us-central1:khadamatak-prod"
RUNTIME_SA_NAME="khadamatak-staging-runtime"
RUNTIME_SA="$RUNTIME_SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"
BUDGET_NAME="khadamatak-staging-vertex-budget"
BUDGET_AMOUNT_USD="20"

echo "PHASE_11A2_VERTEX_PREFLIGHT"
gcloud config set project "$PROJECT_ID" >/dev/null

echo "project id: $PROJECT_ID"
BILLING_ENABLED="$(gcloud beta billing projects describe "$PROJECT_ID" --format="value(billingEnabled)" 2>/tmp/phase11a2-billing.err || true)"
if [ "$BILLING_ENABLED" != "True" ] && [ "$BILLING_ENABLED" != "true" ]; then
  echo "billing enabled: no"
  echo "ABORT_BILLING_NOT_ENABLED"
  exit 1
fi
echo "billing enabled: yes"

BILLING_ACCOUNT_NAME="$(gcloud beta billing projects describe "$PROJECT_ID" --format="value(billingAccountName)" 2>/dev/null || true)"
if [ -z "$BILLING_ACCOUNT_NAME" ]; then
  echo "ABORT_NO_BILLING_ACCOUNT_SCOPE"
  exit 1
fi
BILLING_ACCOUNT_ID="$(printf "%s" "$BILLING_ACCOUNT_NAME" | sed "s#^billingAccounts/##")"
echo "billing account: masked"

gcloud services enable billingbudgets.googleapis.com --project="$PROJECT_ID" >/dev/null 2>&1 || true
EXISTING_BUDGET="$(gcloud billing budgets list --billing-account="$BILLING_ACCOUNT_ID" --filter="displayName=$BUDGET_NAME" --format="value(displayName)" --limit=1 2>/tmp/phase11a2-budget-list.err || true)"
if [ "$EXISTING_BUDGET" = "$BUDGET_NAME" ]; then
  echo "budget alert: present"
else
  echo "budget alert: creating ${BUDGET_AMOUNT_USD} USD monthly, thresholds 50/80/100"
  if ! gcloud billing budgets create \
    --billing-account="$BILLING_ACCOUNT_ID" \
    --display-name="$BUDGET_NAME" \
    --budget-amount="${BUDGET_AMOUNT_USD}USD" \
    --calendar-period=month \
    --filter-projects="projects/$PROJECT_ID" \
    --threshold-rule=percent=0.50 \
    --threshold-rule=percent=0.80 \
    --threshold-rule=percent=1.00 \
    --format="value(displayName)" >/tmp/phase11a2-budget.out 2>/tmp/phase11a2-budget.err; then
    echo "BUDGET_CREATE_FAILED"
    echo "Create it from Console: Billing > Budgets & alerts > Create budget > project khadamatk-auth > 20 USD > alerts 50%, 80%, 100%."
    echo "ABORT_BUDGET_NOT_CONFIRMED"
    exit 1
  fi
  echo "budget alert: created"
fi

echo "Enabling Vertex AI API..."
gcloud services enable aiplatform.googleapis.com --project="$PROJECT_ID" >/dev/null

echo "Preparing runtime service account..."
gcloud iam service-accounts describe "$RUNTIME_SA" --project="$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$RUNTIME_SA_NAME" \
    --project="$PROJECT_ID" \
    --display-name="Khadamatak staging runtime" >/dev/null

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")"
CLOUDBUILD_SA="$PROJECT_NUMBER@cloudbuild.gserviceaccount.com"

for ROLE in roles/aiplatform.user roles/cloudsql.client; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$RUNTIME_SA" \
    --role="$ROLE" \
    --quiet >/dev/null
done

gcloud secrets add-iam-policy-binding DATABASE_URL \
  --project="$PROJECT_ID" \
  --member="serviceAccount:$RUNTIME_SA" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet >/dev/null

gcloud secrets add-iam-policy-binding SESSION_SECRET \
  --project="$PROJECT_ID" \
  --member="serviceAccount:$RUNTIME_SA" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet >/dev/null

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$CLOUDBUILD_SA" \
  --role="roles/run.admin" \
  --quiet >/dev/null

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$CLOUDBUILD_SA" \
  --role="roles/artifactregistry.writer" \
  --quiet >/dev/null

gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:$CLOUDBUILD_SA" \
  --role="roles/iam.serviceAccountUser" \
  --quiet >/dev/null

echo "runtime service account: $RUNTIME_SA"
echo "vertex role: granted"
echo "service account key used: no"

echo "Building and deploying staging from GitHub main..."
WORKDIR="$(mktemp -d)"
git clone --depth=1 https://github.com/smsyle52-rgb/khadamatak.git "$WORKDIR" >/dev/null
cd "$WORKDIR"
TAG="$(git rev-parse --short HEAD)"
echo "commit: $TAG"

gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions=SHORT_SHA="$TAG",_REGION="$REGION",_SERVICE="$SERVICE",_REPOSITORY="$REPO",_IMAGE="$IMAGE",_CLOUDSQL_INSTANCE="$CLOUDSQL_INSTANCE",_RUNTIME_SERVICE_ACCOUNT="$RUNTIME_SA" \
  .

SERVICE_URL="$(gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --format="value(status.url)")"
echo "service url: $SERVICE_URL"
curl -fsS "$SERVICE_URL/api/healthz"; echo
curl -fsS "$SERVICE_URL/api/readyz"; echo

echo "PHASE_11A2_VERTEX_SETUP=OK"
