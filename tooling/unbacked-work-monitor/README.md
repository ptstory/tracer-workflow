# unbacked-work-monitor

Deterministic Bun monitor for local-only work in trusted repos discovered under
configured roots.

## Manual invocation

```bash
UNBACKED_WORK_ROOTS="$HOME/Code" \
UNBACKED_WORK_TRUSTED_REMOTES=origin \
UNBACKED_WORK_OUTPUT_DIR="$HOME/.local/state/tracer/unbacked-work" \
bun tooling/unbacked-work-monitor/unbacked-work-monitor.ts
```

## Environment

- `UNBACKED_WORK_ROOTS`: comma/newline-separated root paths to scan recursively
- `UNBACKED_WORK_ROOTS_FILE`: newline/comma-separated roots in a file
- `UNBACKED_WORK_TRUSTED_REMOTES`: comma/newline-separated trusted remote names;
  defaults to `origin`
- `UNBACKED_WORK_OUTPUT_DIR`: defaults to `~/.local/state/tracer/unbacked-work/`

If no roots are configured, the monitor defaults to `$HOME/Code`. Keep any
more specific private project inventory in environment configuration or a local
roots file rather than committing it here.

The monitor walks each root recursively, discovers non-bare Git repositories, and
scans them.

## Output

- `scan.json`: stable fleet report
- `attention.md`: concise Markdown summary containing only repos that need attention

## launchd

Copy `com.tracer.unbacked-work-monitor.plist` to `~/Library/LaunchAgents/`,
replace every `REPLACE_WITH_*` placeholder with local values, then load it with
`launchctl`. The checked-in plist is intentionally a machine-neutral template.

Successful runs exit 0 whether or not they find attention items. A non-zero exit
means the scan or output write failed.
