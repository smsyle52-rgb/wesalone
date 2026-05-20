# Catalog Layer Report

## Summary

The catalog layer mirrors Meta data into Khadamatak without taking ownership of it. Meta remains the source of truth. The platform now stores read-only copies of Commerce Catalog products, Page posts, and ads, then feeds visible products into the existing AI knowledge retrieval path.

## New Tables

- `catalog_sources`
- `products`
- `social_posts`
- `ad_campaigns`
- `catalog_sync_runs`

## New Endpoints

- `GET /api/catalog/sources`
- `POST /api/catalog/sources`
- `POST /api/catalog/sources/:id/sync`
- `DELETE /api/catalog/sources/:id`
- `GET /api/catalog/products`
- `GET /api/catalog/products/:id`
- `PATCH /api/catalog/products/:id`
- `GET /api/catalog/posts`
- `GET /api/catalog/ads`
- `GET /api/catalog/sync-runs`

## Sync Cadence

The outbox worker checks active catalog sources and syncs any source older than 30 minutes. Manual sync requests publish `catalog.sync.requested` domain events and are consumed by the worker.

## Agent Context Expansion

Draft replies now include:

- Conversation memory.
- Knowledge chunks, including catalog-fed product facts.
- Up to 5 active ads.
- Up to 5 recent Page posts from the last 14 days.

## DRY_RUN

When `META_APP_SECRET` is absent or `META_DRY_RUN=true`, sync generates sample products, posts, and ads. No external Meta API calls are required in development.

## Operator Next Steps

1. Request Meta permissions in App Review: `catalog_management`, `business_management`, `ads_read`.
2. Re-run Embedded Signup for a workspace.
3. Select Commerce Catalogs and Ad Accounts in the Meta channel selection screen.
4. Open `/catalog` and run the first manual sync.
5. Ask the agent about a synced product and confirm the reply cites mirrored facts.
