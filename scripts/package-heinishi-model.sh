#!/usr/bin/env bash
# Package the frozen Heinishi delivery as a Biowatch model archive.
#
# Usage: scripts/package-heinishi-model.sh <delivery-dir> <output-dir>
#
# Biowatch extracts model archives into model-zoo/<id>/, so the archive's single
# top-level folder must be the app-side model version. The delivery content is
# copied unchanged; the Python adapter re-verifies every asset hash at load time.
set -euo pipefail

MODEL_ID=maze-speciesnet-jingxi
MODEL_VERSION=0.0.1
MANIFEST_SHA256=f91b10dd27687d44641ffd7b1fdb72102552f01844a4a0c31652d1a738791e9b

delivery=${1:?delivery directory required}
out=${2:?output directory required}

actual=$(sha256sum "$delivery/manifest.json" | cut -d' ' -f1)
if [ "$actual" != "$MANIFEST_SHA256" ]; then
  echo "Unexpected delivery manifest: $actual" >&2
  exit 1
fi

mkdir -p "$out"
archive="$out/$MODEL_ID-$MODEL_VERSION.tar.gz"
tar -czf "$archive" --exclude='__pycache__' --exclude='*.pyc' \
  --owner=0 --group=0 --sort=name \
  --transform "s,^\.,$MODEL_VERSION," -C "$delivery" .

echo "Archive: $archive"
echo "Size (MB): $(( $(stat -c %s "$archive") / 1048576 ))"
echo "Entries: $(tar -tzf "$archive" | wc -l)"
sha256sum "$archive"
