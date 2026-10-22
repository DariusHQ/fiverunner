#!/bin/sh
# Downloads the resources of a compatibility suite into its resources
# directory: the releases that its resources.txt pins, each checked against
# its SHA-256, in the category it names. None of them is in the repository.
#
#   sh compat/fetch.sh qbox
set -e
suite="$(dirname "$0")/$1"
rm -rf "$suite/resources"
grep -v -e '^#' -e '^$' "$suite/resources.txt" | while read -r category url sha256; do
  zip="$(mktemp)"
  curl -fsSL -o "$zip" "$url"
  echo "$sha256  $zip" | sha256sum -c --quiet
  mkdir -p "$suite/resources/$category"
  unzip -q "$zip" -d "$suite/resources/$category"
  rm "$zip"
done
