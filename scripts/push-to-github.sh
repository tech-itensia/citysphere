#!/usr/bin/env bash
# First push of the project to git@github.com:tech-itensia/citysphere.git
# Run on your Mac from the project folder. SSH will ask for your key passphrase - type it yourself.
set -euo pipefail
cd "$(dirname "$0")/.."
REMOTE=${1:-git@github.com:tech-itensia/citysphere.git}

[ -d .git ] || git init
git branch -M main 2>/dev/null || true
git add -A
# keep local diagnostics out (.env IS committed so the project runs on another machine)
git rm -r --cached --quiet --ignore-unmatch diagnostics.txt
echo "==> Files to be committed: $(git diff --cached --name-only | wc -l | tr -d ' ')"
git diff --cached --quiet || git commit -m "CitySphere: SCaaS smart city platform (ThingsBoard CE, Kafka, Node.js microservices, React command centre)"
git branch -M main
git remote get-url origin >/dev/null 2>&1 && git remote set-url origin "$REMOTE" || git remote add origin "$REMOTE"

echo "==> Testing SSH access to GitHub (enter your key passphrase if asked)"
KEY=${SSH_KEY:-}
[ -n "$KEY" ] && export GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes"
OUT=$(${GIT_SSH_COMMAND:-ssh} -T git@github.com 2>&1 || true)   # ssh -T always exits 1, even on success
echo "$OUT"
echo "$OUT" | grep -qi "successfully authenticated" \
  || { echo "SSH auth failed. Try another key: SSH_KEY=~/.ssh/<your-key> bash scripts/push-to-github.sh"; ls ~/.ssh; exit 1; }

echo "==> Pushing to $REMOTE"
git push -u origin main
echo "Done: https://github.com/tech-itensia/citysphere"
