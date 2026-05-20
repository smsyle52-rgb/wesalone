# Agent Context

## Draft Reply Inputs

When Khadamatak drafts a reply, the agent receives a bounded context assembled from these sources:

1. Conversation memory: last 20 turns plus a rolling summary when available.
2. Knowledge retrieval: top matching KB chunks, including catalog-fed product knowledge.
3. Active ads: up to 5 active Meta ad campaigns in the workspace.
4. Recent posts: up to 5 synced Meta Page posts from the last 14 days.
5. The latest conversation transcript or manual test message.

## Catalog Awareness

Catalog products are mirrored from Meta and converted into knowledge chunks. Active ads and recent posts are injected as a compact context block:

`إعلانات نشطة حالياً: {ad name} — يروّج لمنتجات: {product names}`

`آخر منشورات: {post summaries}`

This lets the agent answer questions about advertised products without requiring the merchant to restate the campaign context.

## Bounds

The catalog context is intentionally small: max 5 active ads and max 5 recent posts. Product details still flow through RAG, so the prompt does not carry the full catalog.

## Safety

The agent remains in draft-review mode unless Trust Mode explicitly allows auto-send. If a product price, policy, or availability is not present in mirrored catalog or KB data, the agent should ask to verify instead of inventing an answer.
