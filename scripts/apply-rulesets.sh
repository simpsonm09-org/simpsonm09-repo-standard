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

for file in "$here"/rulesets/*.json; do
  name="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["name"])' "$file")"
  id="$(gh api "repos/$repo/rulesets" --jq ".[] | select(.name==\"$name\") | .id" 2>/dev/null | head -n1 || true)"
  if [[ "$apply" == "1" ]]; then
    if [[ -n "$id" ]]; then
      gh api -X PUT "repos/$repo/rulesets/$id" --input "$file" >/dev/null
      echo "updated $name"
    else
      gh api -X POST "repos/$repo/rulesets" --input "$file" >/dev/null
      echo "created $name"
    fi
  else
    if [[ -n "$id" ]]; then echo "would update $name"; else echo "would create $name"; fi
  fi
done
