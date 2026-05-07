# Cloud Build CI/CD Agent

This pipeline builds the existing Dockerfile, pushes a commit-tagged image to Artifact Registry, and deploys only the Cloud Run staging service. It does not run migrations, does not run `db:push`, and does not write secret values into source or build logs.

## Manual Build

Run this from the repository root in Cloud Shell or another environment with the Google Cloud SDK authenticated to the staging project:

```bash
TAG="$(date +%Y%m%d%H%M%S)"

gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions=SHORT_SHA="$TAG",_REGION=us-central1,_SERVICE=khadamatak-staging,_REPOSITORY=khadamatak,_IMAGE=app,_CLOUDSQL_INSTANCE=khadamatk-auth:us-central1:khadamatak-prod \
  .
```

`SHORT_SHA` is supplied manually here because `gcloud builds submit` from a local/archive source may not have a Git commit SHA. GitHub triggers can use the built-in `$SHORT_SHA`.

The image URL created by the build is:

```text
$_REGION-docker.pkg.dev/$PROJECT_ID/$_REPOSITORY/$_IMAGE:$SHORT_SHA
```

## Pre-Flight Required Resources

Create the Artifact Registry Docker repository before the first build:

```bash
gcloud artifacts repositories create khadamatak \
  --repository-format=docker \
  --location=<REGION>
```

Create the required Secret Manager secrets before the first deploy:

```bash
gcloud secrets create DATABASE_URL --replication-policy=automatic
gcloud secrets create SESSION_SECRET --replication-policy=automatic
```

Add secret versions with real values from a secure shell. Do not commit or paste real values into source files:

```bash
printf '<DATABASE_URL>' | gcloud secrets versions add DATABASE_URL --data-file=-
printf '<SESSION_SECRET>' | gcloud secrets versions add SESSION_SECRET --data-file=-
```

`GEMINI_API_KEY` is optional and is not configured by this pipeline. Add it manually only if the staging service is meant to use Gemini, or create a separate reviewed variant later.

## GitHub Trigger

1. Open Google Cloud Console.
2. Go to Cloud Build > Triggers.
3. Select Create trigger.
4. Choose the GitHub repository and connect it if needed.
5. Use a branch pattern for staging only, for example `^main$` or a dedicated staging branch such as `^staging$`.
6. Set Configuration to Cloud Build configuration file.
7. Set Location to `cloudbuild.yaml`.
8. Add substitutions:
   - `_REGION=us-central1`
   - `_SERVICE=khadamatak-staging`
   - `_REPOSITORY=khadamatak`
   - `_IMAGE=app`
   - `_CLOUDSQL_INSTANCE=khadamatk-auth:us-central1:khadamatak-prod`
9. Save the trigger and run it manually once for the first staging deploy.

Do not create a production trigger from this file. Production deployment should use a separate reviewed pipeline and separate service substitutions.

## Required IAM

Grant the Cloud Build service account the minimum permissions it needs in the staging project:

- `roles/artifactregistry.writer` on the Artifact Registry repository or project.
- `roles/run.admin` is required when `cloudbuild.yaml` uses `--allow-unauthenticated` or creates/updates the Cloud Run service. This can be reduced later after public access is fixed in place and `--allow-unauthenticated` is removed for a more precise least-privilege setup.
- `roles/iam.serviceAccountUser` on the Cloud Run runtime service account used by the staging service.
- `roles/logging.logWriter` if Cloud Build logging is not already covered.

Grant the Cloud Run runtime service account access to runtime secrets:

- `roles/secretmanager.secretAccessor` on `DATABASE_URL`.
- `roles/secretmanager.secretAccessor` on `SESSION_SECRET`.

## Runtime Secrets

This pipeline binds Secret Manager references by name only:

```bash
--set-secrets=DATABASE_URL=DATABASE_URL:latest,SESSION_SECRET=SESSION_SECRET:latest
```

It does not set explicit values for `DATABASE_URL` or `SESSION_SECRET`, so secret values are not printed by the deploy command. The named secrets must exist before the first deploy.

## Cloud SQL Connection

The staging `DATABASE_URL` uses the Cloud SQL Unix socket path, so the Cloud Run service must be deployed with the Cloud SQL connection:

```bash
--add-cloudsql-instances=$_CLOUDSQL_INSTANCE
```

For the current staging setup, `_CLOUDSQL_INSTANCE` is:

```text
khadamatk-auth:us-central1:khadamatak-prod
```

This is only the instance connection name, not a database password or full `DATABASE_URL`.

## Staging Only Guardrails

- The default substitutions target `khadamatak-staging`.
- The deploy step uses `$_SERVICE`, so the trigger must define only the staging service name.
- Restrict the trigger to the staging branch or the reviewed staging release branch.
- Do not give this trigger production service names in substitutions.
- Keep production deploy permissions separate when possible.

## Migrations

Migrations are not part of this pipeline and must not run during app startup.

Run migrations as a separate, explicit operational step after review and approval. Do not add `db:push` or migration commands to `cloudbuild.yaml`.
