#!/usr/bin/env bash
# Build this platform and install it into a domain repo, in one command.
#
#     ./scripts/sync-into.sh ~/dev/git/clause-explorer
#
# Or, from the domain repo: `make platform-sync`.
#
# ## Why a wheel and not a submodule
#
# Submodules were the other candidate and were rejected on experience as much as design. The
# decisive technical point either way is the Docker build context: the domain repos build with
# `context: .`, so a sibling directory cannot be COPYd, and `pip install -e ../semantic-quorum`
# works on a laptop and breaks every container build. A wheel written INTO the domain repo is in
# the context.
#
# The thing that made wheels win rather than merely tie: a submodule lets you edit in place only
# in the domain you are standing in. Propagating a platform change to the SECOND domain needs
# commit, push, pull — over the network. This needs none of that: edit the platform, uncommitted
# even, run this, done.
#
# ## Why the wheel is gitignored and the lock is not
#
# Committing wheels means versioning build artifacts, and this project has already lost the
# ability to push a repo once by committing generated files. So `vendor/` is ignored and rebuilt.
#
# But something has to record WHICH platform version a domain was demoed against — that is the
# one real advantage a submodule pointer had. `platform.lock` is that record, committed, and more
# legible than a pointer: it carries the source commit, whether the tree was dirty, and when.
set -euo pipefail

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "usage: $0 /path/to/domain-repo" >&2
  exit 64
fi
DOMAIN="$(cd "$DOMAIN" && pwd)"
PLATFORM="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$DOMAIN/quorum.yaml" ] && [ ! -d "$DOMAIN/backend" ]; then
  echo "error: $DOMAIN does not look like a domain repo (no quorum.yaml, no backend/)" >&2
  exit 65
fi

VENDOR="$DOMAIN/vendor"
mkdir -p "$VENDOR"
rm -f "$VENDOR"/semantic_quorum-*.whl

echo "building wheel from $PLATFORM"
cd "$PLATFORM"

# Purge the staging directory before every build. setuptools copies a source file into
# `build/lib` only when the source is NEWER BY MTIME, so a stale staged copy silently wins and
# the wheel ships a mixture of versions.
#
# This is not hypothetical. A wheel built here shipped `domain.py` with a new property and
# `shape.py` from before the change that added it — so a median was computed against the wrong
# denominator by code that had been fixed, and `platform.lock` recorded the build as `clean`,
# because it reads the git tree and never looked at the wheel. Five tests caught it. A demo
# would not have.
rm -rf "$PLATFORM/build"
# --no-isolation keeps this to about a second. The isolated build is the correct default for a
# release and the wrong one for a loop you run fifty times a day.
"$PLATFORM/.venv/bin/python" -m build --wheel --no-isolation --outdir "$VENDOR" . >/dev/null 2>&1 || {
  echo "  isolated fallback (build backend not importable)…"
  "$PLATFORM/.venv/bin/python" -m build --wheel --outdir "$VENDOR" . >/dev/null
}

WHEEL="$(ls "$VENDOR"/semantic_quorum-*.whl | head -1)"
echo "  $(basename "$WHEEL")"

# The record. `dirty` matters: a figure produced against an uncommitted platform cannot be
# reproduced by anyone else, and that should be visible rather than inferred.
SHA="$(git -C "$PLATFORM" rev-parse HEAD)"
DIRTY="clean"
[ -n "$(git -C "$PLATFORM" status --porcelain)" ] && DIRTY="DIRTY — the platform tree had uncommitted changes"
cat > "$DOMAIN/platform.lock" <<LOCK
# Which semantic-quorum this domain is built against. Written by scripts/sync-into.sh.
# Committed on purpose: it is the record of what a demo or a published figure was produced with.
wheel:  $(basename "$WHEEL")
commit: $SHA
state:  $DIRTY
synced: $(date -u +%Y-%m-%dT%H:%M:%SZ)
LOCK

PY="$DOMAIN/.venv/bin/pip"
if [ -x "$PY" ]; then
  "$PY" install -q --force-reinstall --no-deps "$WHEEL"
  echo "  installed into $DOMAIN/.venv"

  # Verify, rather than assume. The failure above was invisible precisely because every step
  # reported success — the build ran, the install ran, the lock said clean, and the code was
  # still wrong. Comparing the installed bytes against the source is the only check that would
  # have caught it, and it costs milliseconds.
  SITE="$("$DOMAIN/.venv/bin/python" -c 'import quorum.domain,pathlib;print(pathlib.Path(quorum.domain.__file__).parent)')"
  DRIFT=0
  while IFS= read -r f; do
    rel="${f#"$PLATFORM/src/quorum/"}"
    if ! cmp -s "$f" "$SITE/$rel"; then
      echo "  DRIFT: $rel differs from source" >&2
      DRIFT=1
    fi
  done < <(find "$PLATFORM/src/quorum" -name '*.py')
  if [ "$DRIFT" -ne 0 ]; then
    echo "error: the installed package does not match src/. Wheel is stale — not usable." >&2
    exit 70
  fi
  echo "  verified: installed bytes match src/"
else
  echo "  no .venv in $DOMAIN — wheel is in vendor/, install it where you need it"
fi

# The frontend half does not exist yet (semantic-quorum#4). When it does it is `npm pack` into
# the same vendor/ and one line in the domain's package.json; the shape of this script does not
# change.
if [ -f "$PLATFORM/frontend/package.json" ]; then
  echo "packing frontend"
  (cd "$PLATFORM/frontend" && npm pack --silent --pack-destination "$VENDOR" >/dev/null)
  echo "  $(basename "$(ls "$VENDOR"/*.tgz | head -1)")"
fi

echo
echo "$DOMAIN is on platform $(echo "$SHA" | cut -c1-8) ($DIRTY)"
