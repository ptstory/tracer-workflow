# Review Gate ChatGPT plugin

This directory versions the ChatGPT plugin packaging for Review Gate.

## Source of truth

Git history in this repository is the source of truth for plugin releases.

The plugin is intentionally a thin integration layer. Mutable Review Gate protocol semantics remain canonical in:

- `skills/review-gate/PROMPT.md`
- `skills/review-gate/references/verdict-contract.md`
- `skills/from-issue/references/pr-body-contract.md`

The plugin skill fetches those files from live GitHub state before each review. Do not fork those mutable contracts into this package as a second authority.

## Versions

Each release lives under a semantic-version directory:

```text
actions/review-gate-plugin/
  README.md
  v0.1.0/
    review-gate/
      plugin.json
      skills/
        review-gate/
          SKILL.md
          references/
```

The nested `review-gate/` directory is the standalone plugin package root. Its directory name matches `plugin.json.name`.

## Release workflow

1. Copy the latest version directory to the next semantic version.
2. Make plugin-only changes in the new version directory.
3. Bump `plugin.json.version` to match the directory version.
4. Review the diff in Git and merge through the normal Tracer workflow.
5. Package the nested `review-gate/` directory as a ZIP or tar.gz.
6. Update the existing private ChatGPT plugin from that archive rather than creating a second plugin.
7. Record the resulting ChatGPT release in the PR or release notes if useful; do not commit credentials, access tokens, or private account secrets.

Protocol-only changes normally do not require a plugin release because the skill resolves the live Tracer contract at review time.

## Initial release

`v0.1.0` is the first ChatGPT plugin port of the former Review Gate Custom GPT.
