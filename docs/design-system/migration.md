# Screen Migration

1. Record a visual and behavioral baseline.
2. Inventory local primitives and product compositions.
3. Replace only primitives available from `@workspace/ui`.
4. Preserve API calls, state transitions, permissions, analytics, and copy.
5. Add shared behavior only when genuinely reusable.
6. Verify RTL, mobile widths, keyboard behavior, and the original workflow.
7. Remove legacy code only after all imports are gone.

Suggested order: low-risk settings/forms, tables, contacts, operational dashboards, then inbox and agent workflows last because of their production sensitivity.
