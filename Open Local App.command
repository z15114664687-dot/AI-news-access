#!/bin/zsh
set -e

cd "$(dirname "$0")"

echo "Preparing local database..."
npm run local:setup

echo "Opening AI Ecosystem Intelligence at http://127.0.0.1:3000"
(sleep 2 && open "http://127.0.0.1:3000") &

npm run dev -- --hostname 127.0.0.1
