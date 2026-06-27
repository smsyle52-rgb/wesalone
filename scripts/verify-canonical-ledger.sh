#!/usr/bin/env bash
set -euo pipefail

AUDIT_DIR="${AUDIT_DIR:-canonical-ledger-audit}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-ci_local_only}"
ADMIN_DB_URL="${ADMIN_DB_URL:-postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/postgres}"
LEDGER_DB_URL="${LEDGER_DB_URL:-postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/ledger_db}"
SCHEMA_DB_URL="${SCHEMA_DB_URL:-postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/schema_db}"

export PGPASSWORD
mkdir -p "$AUDIT_DIR"

echo "[audit] creating isolated databases"
psql "$ADMIN_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE DATABASE ledger_db;
CREATE DATABASE schema_db;
SQL

echo "[audit] building ledger_db from Drizzle journal only"
DATABASE_URL="$LEDGER_DB_URL" NODE_ENV=test pnpm --filter @workspace/db migrate

echo "[audit] building schema_db from TypeScript schema using drizzle push"
DATABASE_URL="$SCHEMA_DB_URL" NODE_ENV=test pnpm --filter @workspace/db push

normalize_schema_dump() {
  sed \
    -e '/^--/d' \
    -e '/^$/d' \
    -e '/^SET /d' \
    -e '/^SELECT pg_catalog\.set_config/d' \
    -e '/^\\restrict /d' \
    -e '/^\\unrestrict /d' \
    -e 's/[[:space:]]\+$//' \
    | LC_ALL=C sort
}

dump_schema() {
  local db_url="$1"
  local out_file="$2"
  pg_dump "$db_url" --schema-only --no-owner --no-privileges --exclude-table=public.__drizzle_migrations | normalize_schema_dump > "$out_file"
}

dump_schema "$LEDGER_DB_URL" "$AUDIT_DIR/ledger-schema.sql"
dump_schema "$SCHEMA_DB_URL" "$AUDIT_DIR/typescript-schema.sql"
diff -u "$AUDIT_DIR/ledger-schema.sql" "$AUDIT_DIR/typescript-schema.sql" > "$AUDIT_DIR/schema.diff" || true

run_query() {
  local db_url="$1"
  local out_file="$2"
  local sql="$3"
  psql "$db_url" -v ON_ERROR_STOP=1 -X -A -F $'\t' -P footer=off -c "$sql" > "$out_file"
}

columns_sql="SELECT table_schema, table_name, column_name, data_type, udt_name, is_nullable, COALESCE(column_default, '') AS column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name <> '__drizzle_migrations' ORDER BY table_schema, table_name, ordinal_position;"
tables_sql="SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> '__drizzle_migrations' ORDER BY 1,2;"
constraints_sql="SELECT n.nspname AS schema_name, c.relname AS table_name, con.conname AS constraint_name, con.contype AS constraint_type, pg_get_constraintdef(con.oid, true) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname <> '__drizzle_migrations' ORDER BY 1,2,3;"
indexes_sql="SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations' ORDER BY 1,2,3;"
functions_sql="SELECT n.nspname AS schema_name, p.proname AS function_name, pg_get_function_identity_arguments(p.oid) AS args, pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' ORDER BY 1,2,3;"
triggers_sql="SELECT event_object_schema, event_object_table, trigger_name, action_timing, event_manipulation, action_statement FROM information_schema.triggers WHERE event_object_schema = 'public' AND event_object_table <> '__drizzle_migrations' ORDER BY 1,2,3,4,5;"
sequences_sql="SELECT sequence_schema, sequence_name, data_type, start_value, minimum_value, maximum_value, increment FROM information_schema.sequences WHERE sequence_schema = 'public' ORDER BY 1,2;"

for db in ledger schema; do
  if [ "$db" = "ledger" ]; then url="$LEDGER_DB_URL"; else url="$SCHEMA_DB_URL"; fi
  run_query "$url" "$AUDIT_DIR/${db}-tables.tsv" "$tables_sql"
  run_query "$url" "$AUDIT_DIR/${db}-columns.tsv" "$columns_sql"
  run_query "$url" "$AUDIT_DIR/${db}-constraints.tsv" "$constraints_sql"
  run_query "$url" "$AUDIT_DIR/${db}-indexes.tsv" "$indexes_sql"
  run_query "$url" "$AUDIT_DIR/${db}-functions.tsv" "$functions_sql"
  run_query "$url" "$AUDIT_DIR/${db}-triggers.tsv" "$triggers_sql"
  run_query "$url" "$AUDIT_DIR/${db}-sequences.tsv" "$sequences_sql"
done

comm -13 <(cut -f1-3 "$AUDIT_DIR/ledger-columns.tsv" | tail -n +2 | LC_ALL=C sort) <(cut -f1-3 "$AUDIT_DIR/schema-columns.tsv" | tail -n +2 | LC_ALL=C sort) > "$AUDIT_DIR/missing-columns.tsv" || true
comm -23 <(cut -f1-3 "$AUDIT_DIR/ledger-columns.tsv" | tail -n +2 | LC_ALL=C sort) <(cut -f1-3 "$AUDIT_DIR/schema-columns.tsv" | tail -n +2 | LC_ALL=C sort) > "$AUDIT_DIR/extra-columns.tsv" || true
comm -3 <(tail -n +2 "$AUDIT_DIR/ledger-columns.tsv" | LC_ALL=C sort) <(tail -n +2 "$AUDIT_DIR/schema-columns.tsv" | LC_ALL=C sort) > "$AUDIT_DIR/column-definition-diff.tsv" || true
comm -3 <(tail -n +2 "$AUDIT_DIR/ledger-constraints.tsv" | LC_ALL=C sort) <(tail -n +2 "$AUDIT_DIR/schema-constraints.tsv" | LC_ALL=C sort) > "$AUDIT_DIR/constraint-diff.tsv" || true
comm -3 <(tail -n +2 "$AUDIT_DIR/ledger-indexes.tsv" | LC_ALL=C sort) <(tail -n +2 "$AUDIT_DIR/schema-indexes.tsv" | LC_ALL=C sort) > "$AUDIT_DIR/index-diff.tsv" || true
comm -3 <(tail -n +2 "$AUDIT_DIR/ledger-functions.tsv" | LC_ALL=C sort) <(tail -n +2 "$AUDIT_DIR/schema-functions.tsv" | LC_ALL=C sort) > "$AUDIT_DIR/function-diff.tsv" || true
comm -3 <(tail -n +2 "$AUDIT_DIR/ledger-triggers.tsv" | LC_ALL=C sort) <(tail -n +2 "$AUDIT_DIR/schema-triggers.tsv" | LC_ALL=C sort) > "$AUDIT_DIR/trigger-diff.tsv" || true
comm -3 <(tail -n +2 "$AUDIT_DIR/ledger-sequences.tsv" | LC_ALL=C sort) <(tail -n +2 "$AUDIT_DIR/schema-sequences.tsv" | LC_ALL=C sort) > "$AUDIT_DIR/sequence-diff.tsv" || true
{
  echo "# FUNCTIONS"
  cat "$AUDIT_DIR/function-diff.tsv"
  echo "# TRIGGERS"
  cat "$AUDIT_DIR/trigger-diff.tsv"
  echo "# SEQUENCES"
  cat "$AUDIT_DIR/sequence-diff.tsv"
} > "$AUDIT_DIR/functions-triggers-diff.tsv"

comm -13 <(tail -n +2 "$AUDIT_DIR/ledger-tables.tsv" | cut -f1-2 | LC_ALL=C sort) <(tail -n +2 "$AUDIT_DIR/schema-tables.tsv" | cut -f1-2 | LC_ALL=C sort) > "$AUDIT_DIR/missing-tables.tsv" || true
comm -23 <(tail -n +2 "$AUDIT_DIR/ledger-tables.tsv" | cut -f1-2 | LC_ALL=C sort) <(tail -n +2 "$AUDIT_DIR/schema-tables.tsv" | cut -f1-2 | LC_ALL=C sort) > "$AUDIT_DIR/extra-tables.tsv" || true

missing_tables=$(wc -l < "$AUDIT_DIR/missing-tables.tsv" | tr -d ' ')
extra_tables=$(wc -l < "$AUDIT_DIR/extra-tables.tsv" | tr -d ' ')
missing_columns=$(wc -l < "$AUDIT_DIR/missing-columns.tsv" | tr -d ' ')
extra_columns=$(wc -l < "$AUDIT_DIR/extra-columns.tsv" | tr -d ' ')
column_definition_diffs=$(wc -l < "$AUDIT_DIR/column-definition-diff.tsv" | tr -d ' ')
constraint_diffs=$(wc -l < "$AUDIT_DIR/constraint-diff.tsv" | tr -d ' ')
index_diffs=$(wc -l < "$AUDIT_DIR/index-diff.tsv" | tr -d ' ')
function_diffs=$(wc -l < "$AUDIT_DIR/function-diff.tsv" | tr -d ' ')
trigger_diffs=$(wc -l < "$AUDIT_DIR/trigger-diff.tsv" | tr -d ' ')
sequence_diffs=$(wc -l < "$AUDIT_DIR/sequence-diff.tsv" | tr -d ' ')
function_trigger_sequence_diffs=$((function_diffs + trigger_diffs + sequence_diffs))

DRIFT_FOUND=false
if [ "$missing_tables" != "0" ] || [ "$extra_tables" != "0" ] || [ "$missing_columns" != "0" ] || [ "$extra_columns" != "0" ] || [ "$column_definition_diffs" != "0" ] || [ "$constraint_diffs" != "0" ] || [ "$index_diffs" != "0" ] || [ "$function_trigger_sequence_diffs" != "0" ]; then
  DRIFT_FOUND=true
fi

{
  echo "DRIFT_FOUND=$DRIFT_FOUND"
  echo "MISSING_TABLES=$missing_tables"
  echo "EXTRA_TABLES=$extra_tables"
  echo "MISSING_COLUMNS=$missing_columns"
  echo "EXTRA_COLUMNS=$extra_columns"
  echo "COLUMN_DEFINITION_DIFF_LINES=$column_definition_diffs"
  echo "CONSTRAINT_DIFF_LINES=$constraint_diffs"
  echo "INDEX_DIFF_LINES=$index_diffs"
  echo "FUNCTION_DIFF_LINES=$function_diffs"
  echo "TRIGGER_DIFF_LINES=$trigger_diffs"
  echo "SEQUENCE_DIFF_LINES=$sequence_diffs"
  echo "FUNCTION_TRIGGER_SEQUENCE_DIFF_LINES=$function_trigger_sequence_diffs"
  echo "Rules enforced: ledger_db uses migrate only; schema_db uses push only; no phase345; no 0030 manual; no inline column patching."
} | tee "$AUDIT_DIR/workflow-summary.txt"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "drift_found=$DRIFT_FOUND" >> "$GITHUB_OUTPUT"
  echo "missing_tables=$missing_tables" >> "$GITHUB_OUTPUT"
  echo "extra_tables=$extra_tables" >> "$GITHUB_OUTPUT"
  echo "missing_columns=$missing_columns" >> "$GITHUB_OUTPUT"
  echo "extra_columns=$extra_columns" >> "$GITHUB_OUTPUT"
  echo "column_definition_diffs=$column_definition_diffs" >> "$GITHUB_OUTPUT"
  echo "constraint_diffs=$constraint_diffs" >> "$GITHUB_OUTPUT"
  echo "index_diffs=$index_diffs" >> "$GITHUB_OUTPUT"
  echo "function_diffs=$function_diffs" >> "$GITHUB_OUTPUT"
  echo "trigger_diffs=$trigger_diffs" >> "$GITHUB_OUTPUT"
  echo "sequence_diffs=$sequence_diffs" >> "$GITHUB_OUTPUT"
  echo "function_trigger_sequence_diffs=$function_trigger_sequence_diffs" >> "$GITHUB_OUTPUT"
fi

exit 0
