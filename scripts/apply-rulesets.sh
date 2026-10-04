#!/usr/bin/env bash
set -euo pipefail

repo=""
apply=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) apply=1 ;;
    -h|--help|help)
      echo "usage: $0 <owner/repo> [--apply]"
      exit 0
      ;;
    *) repo="$1" ;;
  esac
  shift
done

if [[ -z "$repo" ]]; then
  echo "usage: $0 <owner/repo> [--apply]" >&2
  exit 2
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

visibility="$(gh api "repos/$repo" --jq .visibility)"
if [[ "$visibility" != "public" ]]; then
  echo "$repo is $visibility. Rulesets stay unenforced until the repository is public."
  for file in "$here"/rulesets/*.json; do
    echo "  would apply $(basename "$file")"
  done
  exit 0
fi

# The repository's agent access level decides whether the App joins the bypass
# list. The App id comes from the environment, then the captured app metadata.
short="${repo##*/}"
level="$(node "$here/scripts/agent-access.mjs" "$short" 2>/dev/null || true)"
[[ -z "$level" ]] && level="read"

app_id="${AGENT_APP_ID:-}"
if [[ -z "$app_id" && -f "$HOME/.config/simpsonm09/agent-app.json" ]]; then
  app_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$HOME/.config/simpsonm09/agent-app.json" 2>/dev/null || true)"
fi

for file in "$here"/rulesets/*.json; do
  ruleset_name="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["name"])' "$file")"
  payload="$(mktemp)"
  if [[ -n "$app_id" ]]; then
    node "$here/scripts/ruleset-payload.mjs" "$file" --level "$level" --app-id "$app_id" >"$payload"
  else
    node "$here/scripts/ruleset-payload.mjs" "$file" --level "$level" >"$payload"
  fi
  id="$(gh api "repos/$repo/rulesets" --jq ".[] | select(.name==\"$ruleset_name\") | .id" 2>/dev/null | head -n1 || true)"
  if [[ "$apply" == "1" ]]; then
    if [[ -n "$id" ]]; then
      gh api -X PUT "repos/$repo/rulesets/$id" --input "$payload" >/dev/null
      echo "updated $ruleset_name"
    else
      gh api -X POST "repos/$repo/rulesets" --input "$payload" >/dev/null
      echo "created $ruleset_name"
    fi
  else
    if [[ -n "$id" ]]; then echo "would update $ruleset_name"; else echo "would create $ruleset_name"; fi
  fi
  rm -f "$payload"
done
