#!/usr/bin/env bash
# Self-test for check-skills.mjs: a throwaway repo whose skill cites things that do and don't exist.
#
#   bash .github/scripts/check-skills.test.sh
set -uo pipefail

guard="$(cd "$(dirname "$0")" && pwd)/check-skills.mjs"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0

git init -q "$tmp"
mkdir -p "$tmp/.claude/skills/demo" "$tmp/docs" "$tmp/apps/web"
echo '.local/' >"$tmp/.gitignore"
echo '{"scripts":{"verify":"x","guides:check":"x"}}' >"$tmp/package.json"
echo '{"scripts":{"screenshot:ephemeral":"x"}}' >"$tmp/apps/web/package.json"
echo '# real' >"$tmp/docs/real.md"
skill="$tmp/.claude/skills/demo/SKILL.md"

# expect <name> <exit> <text-or-empty> ; skill body on stdin
expect() {
  cat >"$skill"
  out="$(node "$guard" "$tmp" 2>&1)"
  code=$?
  if [ "$code" -ne "$2" ] || { [ -n "$3" ] && ! grep -qF "$3" <<<"$out"; }; then
    printf '✗ %s: want exit %s + "%s", got %s\n%s\n' "$1" "$2" "$3" "$code" "$out"
    fails=$((fails + 1))
  else printf '✓ %s\n' "$1"; fi
}

expect "real path, real scripts, real link pass" 0 "" <<'EOF'
See `docs/real.md:12`, run `pnpm verify` and `pnpm --filter web screenshot:ephemeral /`.
[doc](../../../docs/real.md)
EOF
expect "missing path fails" 1 "path docs/gone.md does not exist" <<'EOF'
See `docs/gone.md`.
EOF
expect "missing root script fails" 1 "pnpm nope is not a script" <<'EOF'
Run `pnpm nope`.
EOF
expect "missing filtered script fails" 1 "pnpm --filter web gone is not a script in apps/web" <<'EOF'
Run `pnpm --filter web gone`.
EOF
expect "broken relative link fails" 1 "link → ../../../docs/gone.md" <<'EOF'
[doc](../../../docs/gone.md)
EOF
expect "commands inside a fence are checked" 1 "pnpm missing:script" <<'EOF'
```bash
pnpm missing:script
```
EOF
expect "templates, builtins and gitignored paths are skipped" 0 "" <<'EOF'
`docs/plans/<id>-<slug>.md` · `packages/db/migrations/NNNN_x.sql` · `pnpm install` · `pnpm exec prettier` · `.local/cache` · [p](./plans/<file>.md)
EOF

[ "$fails" -eq 0 ] && echo "all skills-guard self-tests passed" || exit 1
