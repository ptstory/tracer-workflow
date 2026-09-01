# unbacked-work-monitor

Deterministic Bun monitor for local-only work in trusted repos discovered under
configured roots.

## Manual invocation

```bash
UNBACKED_WORK_ROOTS=/Users/perrystory/Code/vibecoding,/Users/perrystory/Code/corby \
UNBACKED_WORK_TRUSTED_REMOTES=origin \
UNBACKED_WORK_OUTPUT_DIR=/Users/perrystory/.local/state/tracer/unbacked-work \
/Users/perrystory/.bun/bin/bun /Users/perrystory/Code/tracer-workflow/tooling/unbacked-work-monitor/unbacked-work-monitor.ts
```

## Environment

- `UNBACKED_WORK_ROOTS`: comma/newline-separated root paths to scan recursively
- `UNBACKED_WORK_ROOTS_FILE`: newline/comma-separated roots in a file
- `UNBACKED_WORK_TRUSTED_REMOTES`: comma/newline-separated trusted remote names;
  defaults to `origin`
- `UNBACKED_WORK_OUTPUT_DIR`: defaults to `~/.local/state/tracer/unbacked-work/`

The monitor walks each root recursively, discovers non-bare Git repositories, and
scans them.

## Output

- `scan.json`: stable fleet report
- `attention.md`: concise Markdown summary containing only repos that need
  attention

## launchd

Install:

```bash
mkdir -p /Users/perrystory/.local/state/tracer/unbacked-work
cp /Users/perrystory/Code/tracer-workflow/tooling/unbacked-work-monitor/com.tracer.unbacked-work-monitor.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.tracer.unbacked-work-monitor.plist
```

Remove:

```bash
launchctl unload ~/Library/LaunchAgents/com.tracer.unbacked-work-monitor.plist
rm ~/Library/LaunchAgents/com.tracer.unbacked-work-monitor.plist
```

Successful runs exit 0 whether or not they find attention items. A non-zero exit
means the scan or output write failed.
