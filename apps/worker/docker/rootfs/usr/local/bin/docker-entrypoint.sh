#!/bin/sh

set -eu

WORKER_DIST_DIR="${WORKER_DIST_DIR:-/app/apps/worker/dist}"
NODE_BIN="${NODE_BIN:-/usr/local/bin/node}"

# --enable-source-maps resolves production stack traces back to original TypeScript
# source. Exported so every worker launched below (loop and single-worker exec) inherits it.
export NODE_OPTIONS="${NODE_OPTIONS:-} --enable-source-maps"

# Map a built bundle (dir + file basename without .mjs) to its roster name.
# Standard:  <dir>/worker.mjs            -> <dir>
# Variants:  <dir>/worker-<suffix>.mjs   -> <dir>-<suffix>, with aliases below
#            to preserve the historical sequence-* CLI names.
map_worker_name() {
  dir="$1"
  file="$2"
  if [ "$file" = "worker" ]; then
    echo "$dir"
    return 0
  fi
  case "${dir}/${file}" in
    "sequence-scheduler/worker-producer") echo "sequence-producer" ;;
    "sequence-scheduler/worker-consumer") echo "sequence-consumer" ;;
    *) echo "${dir}-${file#worker-}" ;;
  esac
}

# Scan dist/ and emit a "name|path" line per built worker bundle, sorted.
# The roster is derived from what was actually built, so it can never drift
# from the tsdown entrypoints or reference a worker that does not exist.
discover_workers() {
  for path in "$WORKER_DIST_DIR"/*/worker*.mjs; do
    [ -f "$path" ] || continue   # skip the literal pattern when nothing matches
    rel="${path#"$WORKER_DIST_DIR"/}"
    dir="${rel%%/*}"
    file="${rel##*/}"
    file="${file%.mjs}"
    printf '%s|%s\n' "$(map_worker_name "$dir" "$file")" "$path"
  done | sort
}

WORKER_TABLE="$(discover_workers)"

all_worker_names() {
  printf '%s\n' "$WORKER_TABLE" | cut -d'|' -f1
}

print_usage() {
    names="$(all_worker_names | tr '\n' '|' | sed 's/|$//')"
    echo "Usage: ${0} worker [all${names:+|}${names}]" >&2
    echo "       ${0} worker <name>[,<name>...]   # a subset in one container" >&2
    echo "       ${0} {bash|sh}" >&2
}

resolve_worker_script() {
  line="$(printf '%s\n' "$WORKER_TABLE" | grep "^$1|" | head -n1)"
  [ -n "$line" ] || return 1
  printf '%s\n' "${line#*|}"
}

require_script() {
  if [ ! -f "$1" ]; then
    echo "Worker script not found: $1" >&2
    exit 4
  fi
}

# Starts the named workers and supervises them as one unit.
#
# Takes a newline-separated roster rather than always starting everything,
# because "everything" is twelve Node processes and each one carries its own
# runtime and bundle. Twelve of them sat at 7.2Gi of an 8Gi box — 90% — with no
# room to grow, and the Consumption workload profile caps at 8Gi, so there was
# no larger box to move to. Splitting the roster across containers is the only
# lever left.
run_workers() {
  roster="$1"
  if [ -z "$roster" ]; then
    echo "No worker bundles found under $WORKER_DIST_DIR" >&2
    exit 4
  fi

  pids=""

  handle_shutdown() {
    for pid in $pids; do
      kill -TERM "$pid" 2>/dev/null || true
    done
    wait || true
    exit 0
  }

  trap 'handle_shutdown' INT TERM

  # Validate every entrypoint first so we never start partially. A name that
  # does not exist is a configuration mistake worth failing loudly on, not
  # something to skip quietly into a half-running container.
  for worker in $roster; do
    script="$(resolve_worker_script "$worker")" || {
      echo "Unknown worker: $worker" >&2
      print_usage
      exit 3
    }
    require_script "$script"
  done

  for worker in $roster; do
    script="$(resolve_worker_script "$worker")"
    echo "Starting worker: $worker ($script)"
    "$NODE_BIN" "$script" &
    pids="$pids $!"
  done

  while true; do
    for pid in $pids; do
      if ! kill -0 "$pid" 2>/dev/null; then
        status=0
        wait "$pid" || status=$?
        if [ "$status" -eq 0 ]; then
          status=1
        fi
        echo "Worker process $pid exited with status $status, stopping others..."
        for other_pid in $pids; do
          if [ "$other_pid" != "$pid" ]; then
            kill -TERM "$other_pid" 2>/dev/null || true
          fi
        done
        wait || true
        exit "$status"
      fi
    done
    sleep 1
  done
}

case "${1:-}" in
    "worker")
        if [ "$#" -gt 2 ]; then
            print_usage
            exit 3
        fi

        worker="${2:-all}"
        if [ "$worker" = "all" ]; then
            run_workers "$(all_worker_names)"
            exit 0
        fi

        # A comma-separated list runs those workers under the supervisor; a
        # single name still execs directly, so one worker per container keeps
        # its process as PID 1 and its signals unmediated.
        case "$worker" in
          *,*)
            run_workers "$(printf '%s' "$worker" | tr ',' '\n')"
            exit 0
            ;;
        esac

        script="$(resolve_worker_script "$worker")" || {
          print_usage
          exit 3
        }
        require_script "$script"
        exec "$NODE_BIN" "$script"
        ;;
    "/bin/sh" | "sh" | "/bin/bash" | "bash")
        exec "$@"
        ;;
    *)
        print_usage
        exit 3
        ;;
esac
