# AI Models — Locked Selection

## Generation

- Model: `gemini-2.5-flash`
- Region: `us-central1`
- Temperature: `0.3` (conservative — reduces hallucination on Yemeni Arabic dialect)
- Max output tokens: `2048`
- Cost (approximate): `$0.075` per million input tokens, `$0.30` per million output tokens
- Why this model: Strong Arabic dialect understanding, low latency (~1-2s typical), price-competitive for SMB SaaS at first 50 merchants.

## Embeddings

- Model: `text-embedding-005`
- Output dimension: `768`
- Why this dim: `text-embedding-005` is Google's production embedding model. `768` is sufficient for KB retrieval at our document scale (thousands of chunks per workspace). Storage and index size scale linearly with dim — `768` is the sweet spot.

## Fallback (DRY_RUN)

- When `AI_PROVIDER=mock` or Vertex credentials are absent, embeddings return deterministic pseudo-vectors derived from `sha256(text)`.
- KB lexical search continues to work.
- Draft replies return a canned response.

## Cost projection

- 5 merchants: ~$30/month
- 50 merchants: ~$300/month
- 500 merchants: ~$2,500/month (at which point we revisit batching, caching, smaller models)

## Upgrade path

- If quality issues arise for complex queries: `gemini-2.5-pro` selectable per-agent via the agents model column.
- The agents model column is the override.
- Workspace default = `VERTEX_MODEL` env.
- Agent default = workspace default.
