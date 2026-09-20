#!/bin/zsh
cd /Users/harsh/Documents/outset-app/backend
for i in {1..40}; do
  if npx tsx scripts/_draft-sample.mts > logs/drafts.log 2>&1; then echo "DRAFTS OK $(date)" >> logs/drafts.log; exit 0; fi
  echo "retry $i $(date)" >> logs/drafts-retry.log
  sleep 120
done
echo "DRAFTS GAVE UP $(date)" >> logs/drafts.log
