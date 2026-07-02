#!/usr/bin/env bash
# Reports which procurement-skills have changed since their business-facing
# behavior was last translated into the Feishu business doc. Detection only —
# it does not touch the Feishu doc or the manifest; a human decides whether
# the underlying change actually needs a doc update, then updates both.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$REPO_ROOT/docs/business-doc-sync-manifest.json"

if [[ ! -f "$MANIFEST" ]]; then
  echo "error: manifest not found at $MANIFEST" >&2
  exit 2
fi

doc_url=$(jq -r '.doc_url' "$MANIFEST")
out_of_sync=0

echo "Business doc: $doc_url"
echo

for skill in $(jq -r '.skills | keys[]' "$MANIFEST"); do
  recorded_sha=$(jq -r --arg s "$skill" '.skills[$s]' "$MANIFEST")
  current_sha=$(git -C "$REPO_ROOT" log -1 --format=%H -- "procurement-skills/$skill/" 2>/dev/null || echo "")

  if [[ -z "$current_sha" ]]; then
    echo "⚠️  $skill: no commit history found under procurement-skills/$skill/ — check the skill still exists"
    out_of_sync=1
  elif [[ "$current_sha" == "$recorded_sha" ]]; then
    echo "✅ $skill: in sync ($recorded_sha)"
  else
    echo "❌ $skill: OUT OF SYNC — doc reflects $recorded_sha, current is $current_sha"
    out_of_sync=1
  fi
done

echo
if [[ "$out_of_sync" -eq 0 ]]; then
  echo "All skills in sync with the business doc."
else
  echo "Some skills have changed since the business doc was last updated."
  echo "Review whether the change is business-relevant; if so, update the"
  echo "corresponding section in $doc_url and refresh docs/business-doc-sync-manifest.json."
fi

exit "$out_of_sync"
