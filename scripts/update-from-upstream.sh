#!/usr/bin/env bash
# Pull ChatbotX upstream into Wesal One, safely.
#
#   bash scripts/update-from-upstream.sh          # preview only, changes nothing
#   bash scripts/update-from-upstream.sh --merge  # actually merge
#
# Preview mode is the default on purpose: it tells you what would land and
# whether anything risky is in it, before you touch the working tree.
set -euo pipefail

UPSTREAM_REMOTE="upstream"
UPSTREAM_BRANCH="main"
DO_MERGE=false
[[ "${1:-}" == "--merge" ]] && DO_MERGE=true

if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
  echo "Adding $UPSTREAM_REMOTE remote..."
  git remote add "$UPSTREAM_REMOTE" https://github.com/ChatbotXIO/ChatbotX.git
fi

echo "==> Fetching $UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
git fetch "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH"

RANGE="HEAD..$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"

if [[ -f "$(git rev-parse --git-dir)/shallow" ]]; then
  echo
  echo "NOTE: this clone is shallow, so the commit count below is not the real"
  echo "      number of upstream changes. File-level sections are still accurate."
  echo "      For a true count: git fetch --unshallow $UPSTREAM_REMOTE"
fi

echo
echo "==> Commits we don't have yet: $(git rev-list --count "$RANGE")"
git log --oneline --no-merges "$RANGE" | head -30

echo
echo "==> NEW upstream migrations (review these by hand — highest risk)"
git diff --name-status "$RANGE" -- packages/database/drizzle/ \
  | grep -E '^A' || echo "   (none)"

echo
echo "==> Files WE changed that upstream also changed (these will conflict)"
# Our fork points, as of the drizzle-wesal split:
#   - the two TimescaleDB migrations (Cloud SQL has no TimescaleDB)
#   - Arabic translations
#   - the migration runner
for f in \
  packages/database/drizzle/20260517074023_migrate_analytics_to_timescaledb_table/migration.sql \
  packages/database/drizzle/20260622040000_align_message_attachment_to_shard_schema/migration.sql \
  packages/database/scripts/run-migrations.mjs \
  apps/builder/messages/ar.json
do
  if git diff --quiet "$RANGE" -- "$f" 2>/dev/null; then :; else
    echo "   CONFLICT LIKELY: $f"
  fi
done

echo
echo "==> Upstream EDITS to tables we built on (commerce / points / billing)"
# Only 'M' (modified) matters here. A plain diff also lists 'D' entries for our
# own tables — files that exist for us and simply don't exist upstream — which
# reads alarmingly but means the opposite: upstream never touched them.
git diff --name-status "$RANGE" -- \
  'packages/database/src/schema/product*' \
  'packages/database/src/schema/order*' \
  'packages/database/src/schema/point-*' \
  'packages/database/src/schema/platform-*' \
  | grep -E '^M' | sed 's/^/   /' \
  || echo "   (none — upstream did not modify our areas)"

if [[ "$DO_MERGE" != true ]]; then
  echo
  echo "Preview only. Nothing changed."
  echo "If the above looks safe:"
  echo "  1. gcloud sql backups create --instance=khadamatak-prod --project=khadamatk-auth"
  echo "  2. bash scripts/update-from-upstream.sh --merge"
  exit 0
fi

echo
echo "==> Merging"
echo "    On conflict in the two TimescaleDB migrations, keep OUR version:"
echo "      git checkout --ours <file> && git add <file>"
git merge "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" || {
  echo
  echo "Merge stopped with conflicts. Resolve, then: git commit"
  exit 1
}

echo
echo "==> Merged. Before deploying:"
echo "    pnpm install"
echo "    pnpm --filter builder check-types"
echo "    Review any new migration above, then apply it deliberately."
