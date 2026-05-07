#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-khadamatk-auth}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-khadamatak-staging}"
REPOSITORY="${REPOSITORY:-khadamatak}"
IMAGE="${IMAGE:-app}"
CLOUDSQL_INSTANCE="${CLOUDSQL_INSTANCE:-khadamatk-auth:us-central1:khadamatak-prod}"
TAG="${TAG:-$(date +%Y%m%d%H%M%S)}"

gcloud config set project "$PROJECT_ID"

gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions=SHORT_SHA="$TAG",_REGION="$REGION",_SERVICE="$SERVICE",_REPOSITORY="$REPOSITORY",_IMAGE="$IMAGE",_CLOUDSQL_INSTANCE="$CLOUDSQL_INSTANCE" \
  .

SERVICE_URL="$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='value(status.url)')"

echo "SERVICE_URL=$SERVICE_URL"
curl -fsS "$SERVICE_URL/api/healthz"
echo
curl -fsS "$SERVICE_URL/api/readyz"
echo
