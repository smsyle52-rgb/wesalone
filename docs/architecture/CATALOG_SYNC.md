# Catalog Sync

## Model

Khadamatak mirrors Meta catalog assets instead of owning them. Commerce Catalog products, Page posts, and ads remain read-only copies inside the platform. Meta stays the source of truth.

## Cadence

The outbox worker checks active `catalog_sources` every 30 seconds and claims due sources with `FOR UPDATE SKIP LOCKED`. A source is due when it has never synced or `last_synced_at` is older than 30 minutes. Concurrent workers therefore do not double-sync the same source.

Manual sync uses:

`POST /api/catalog/sources/:id/sync`

The API validates the source in the current workspace, requires `catalog:sync`, and publishes a `catalog.sync.requested` domain event. The outbox worker consumes that event and runs the same sync path.

## Failure Handling

Each sync writes a `catalog_sync_runs` row. On success, the source becomes `synced` and `last_synced_at` advances. On failure, the source becomes `failed`, `last_sync_error` is stored, and existing mirrored data remains untouched.

Domain-event triggered syncs retry with exponential backoff up to five attempts. Failed syncs never wipe existing products, posts, or ads.

## Agent Knowledge Feed

Visible products are converted into knowledge records after catalog sync. The content is compact and factual:

`منتج: {name}. السعر: {price} {currency}. التوفر: {availability}. {description}`

This makes products available to the existing RAG retrieval flow. Product knowledge is updated idempotently by `catalog://product/{product_id}` source URLs.

## DRY_RUN

When `META_APP_SECRET` is absent or `META_DRY_RUN=true`, the sync generates sample products, posts, and ads. This keeps staging and local environments functional without external Meta API calls.
