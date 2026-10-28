#!/bin/sh
# Downloads the resources of a compatibility suite into its resources
# directory: the releases that its resources.txt pins, each checked against
# its SHA-256, in the category it names, whole, or the path in the archive
# that a line names, under the name that it gives, or its own. None of them
# is in the repository.
#
#   sh compat/fetch.sh qbox
set -e
suite="$(dirname "$0")/$1"
downloads="$(mktemp -d)"
trap 'rm -rf "$downloads"' EXIT
rm -rf "$suite/resources"
grep -v -e '^#' -e '^$' "$suite/resources.txt" | while read -r category url sha256 path name; do
  files="$downloads/$sha256"
  if [ ! -d "$files" ]; then
    curl -fsSL -o "$files.zip" "$url"
    echo "$sha256  $files.zip" | sha256sum -c --quiet
    unzip -q "$files.zip" -d "$files"
  fi
  mkdir -p "$suite/resources/$category"
  if [ -n "$path" ]; then
    mv "$files/$path" "$suite/resources/$category/$name"
  else
    mv "$files"/* "$suite/resources/$category/"
  fi
done
