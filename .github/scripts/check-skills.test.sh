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
echo '{"name":"web","scripts":{"screenshot:ephemeral":"x","dev":"x"}}' >"$tmp/apps/web/package.json"
mkdir -p "$tmp/packages/db/migrations/meta"
echo '{"name":"@mat-plan/db","scripts":{"db:verify":"x"}}' >"$tmp/packages/db/package.json"
echo '{}' >"$tmp/packages/db/migrations/meta/_journal.json"
echo '# real' >"$tmp/docs/real.md"
echo 'x = 1' >"$tmp/.squawk.toml"
echo '#!/bin/sh' >"$tmp/.claude/skills/demo/check.sh"
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

expect "workspace filters come from package names: -F, --filter=, --filter" 0 "" <<'EOF'
`pnpm -F @mat-plan/db db:verify` · `pnpm --filter=web screenshot:ephemeral` · `pnpm --filter @mat-plan/db db:verify`
EOF
expect "a filtered package found by its name, not a hand-kept map" 1 "pnpm --filter @mat-plan/db gone is not a script in packages/db" <<'EOF'
Run `pnpm -F @mat-plan/db gone`.
EOF
expect "--filter=x form is checked" 1 "pnpm --filter web nope is not a script in apps/web" <<'EOF'
Run `pnpm --filter=web nope`.
EOF
expect "pnpm run <script> is checked" 1 "pnpm nope is not a script" <<'EOF'
Run `pnpm run nope`.
EOF
expect "pnpm run <real script> passes" 0 "" <<'EOF'
Run `pnpm run verify`.
EOF
expect "every pnpm in one span is checked, not just the first" 1 "pnpm second is not a script" <<'EOF'
Run `pnpm verify && pnpm second`.
EOF
expect "non-./ relative link, from the skill dir or the root" 0 "" <<'EOF'
[check](check.sh) and [doc](docs/real.md)
EOF
expect "non-./ relative link that exists nowhere fails" 1 "link → nowhere.md does not exist" <<'EOF'
[x](nowhere.md)
EOF
expect "#anchors and URLs in links are fine" 0 "" <<'EOF'
[doc](../../../docs/real.md#some-heading) · [site](https://example.com/x.md) · [top](#top)
EOF
expect "an #anchor does not hide a missing link target" 1 "link → ../../../docs/gone.md does not exist" <<'EOF'
[doc](../../../docs/gone.md#heading)
EOF
expect "line suffixes :L12, :12-20 and #L3 are stripped" 0 "" <<'EOF'
`docs/real.md:L12` · `docs/real.md:12-20` · `docs/real.md#L3` · [l](../../../docs/real.md#L3-L9)
EOF
expect "a line suffix does not hide a missing file" 1 "path docs/gone.md does not exist" <<'EOF'
`docs/gone.md:L12`
EOF
expect "root files are checked generically, not from a list" 0 "" <<'EOF'
`.squawk.toml` · `package.json` · `_journal.json` · `SKILL.md`
EOF
expect "a missing root-shaped file fails" 1 "file MISSING.md does not exist" <<'EOF'
See `MISSING.md`.
EOF
expect "a missing root-shaped dotfile fails" 1 "file .nothere.toml does not exist" <<'EOF'
See `.nothere.toml`.
EOF

expect "pnpm -r / --recursive spans are skipped (no false positive)" 0 "" <<'EOF'
`pnpm -r test` · `pnpm --recursive build`
EOF
expect "pnpm -C <dir> uses that directory's scripts (no false positive)" 0 "" <<'EOF'
`pnpm -C apps/web dev` · `pnpm --dir=./apps/web/ screenshot:ephemeral`
EOF
expect "pnpm -C <dir> with a missing script fails" 1 "pnpm -C apps/web gone is not a script in apps/web" <<'EOF'
`pnpm -C apps/web gone`
EOF

# Entry point: runs through a symlink and from a path containing a space.
ln -s "$guard" "$tmp/link.mjs"
mkdir -p "$tmp/dir with space" && cp "$guard" "$tmp/dir with space/check.mjs"
echo 'See `docs/gone.md`.' >"$skill"
for g in "$tmp/link.mjs" "$tmp/dir with space/check.mjs"; do
  out="$(node "$g" "$tmp" 2>&1)"
  if [ $? -eq 1 ] && grep -qF "docs/gone.md" <<<"$out"; then printf '✓ runs via %s\n' "${g#"$tmp"/}"
  else printf '✗ did not run via %s\n%s\n' "$g" "$out"; fails=$((fails + 1)); fi
done

[ "$fails" -eq 0 ] && echo "all skills-guard self-tests passed" || exit 1
