---
name: deliverable-package-finalizer
description: >
  Invoke when work is functionally complete but not yet packaged for
  handoff, review, or client delivery. Covers artifact registries,
  scrape output packages, API deliverables, and any output that needs
  to be verified, labeled, and handed off cleanly. Also invoke when
  asked "is this ready to ship" or "what do I still need to do."
---

# Deliverable Package Finalizer

Turn messy implementation state into something that can be handed off or reviewed without explanation.

## Iron Law

**"It works on my machine" is not a deliverable. A deliverable is something another person or system can consume without you present.**

## Phase 1: Inventory the Outputs

Before anything else, list what actually exists:

```bash
ls -la dist/ output/ artifacts/ exports/ data/ 2>/dev/null
```

For each expected output file:
- [ ] File exists
- [ ] File is non-empty (`wc -l <file>` or `wc -c <file>`)
- [ ] File modification time is recent (matches the work just done)
- [ ] File is at the expected path (not buried in a temp or worktree location)

If any expected file is missing, stop. Do not proceed to packaging. Identify which step failed to produce it.

## Phase 2: Validate Each Output

**JSON artifacts:**
```bash
python3 -m json.tool <artifact-file> > /dev/null && echo VALID || echo INVALID
```

**Newline-delimited JSON (NDJSON):**
```bash
python3 -c "
import sys
for i, line in enumerate(open('<file>'), 1):
    try: import json; json.loads(line)
    except: print(f'Line {i} invalid: {line[:80]}'); sys.exit(1)
print('All lines valid')
"
```

**CSV:**
```bash
python3 -c "
import csv
rows = list(csv.DictReader(open('<file>')))
print(f'Rows: {len(rows)}, columns: {list(rows[0].keys()) if rows else []}')
"
```

**Sanity check counts:**
```bash
# JSON array
python3 -c "import json; d=json.load(open('<file>')); print(f'Items: {len(d)}')"

# Spot-check a sample item has expected fields
python3 -c "
import json
d = json.load(open('<file>'))
if d: print(json.dumps(d[0], indent=2))
"
```

If validation fails, the artifact is not deliverable. Fix the output, not the packaging.

## Phase 3: Compare Against Baseline

If there is a previous version or expected baseline:

```bash
# Item count comparison
echo "Previous: $(python3 -c "import json; print(len(json.load(open('<prev-artifact>'))))")"
echo "Current:  $(python3 -c "import json; print(len(json.load(open('<curr-artifact>'))))")"

# Field presence check (did a field disappear?)
python3 -c "
import json
prev = json.load(open('<prev-artifact>'))
curr = json.load(open('<curr-artifact>'))
prev_keys = set(prev[0].keys()) if prev else set()
curr_keys = set(curr[0].keys()) if curr else set()
print('Removed fields:', prev_keys - curr_keys)
print('Added fields:', curr_keys - prev_keys)
"
```

Flag regressions — fewer items, missing fields, or changed schema — before packaging.

## Phase 4: Generate Handoff Summary

Every deliverable needs a human-readable summary. Write it to `handoff.md` or `README.md` in the output directory:

```markdown
# Deliverable: <name>

**Generated:** <ISO timestamp>
**Status:** complete | partial | blocked

## What's included
- <artifact-name>: <N> items, <size>
- <artifact-name>: <N> items, <size>

## What's not included
- <item>: deferred / blocked because <reason>

## Known issues
- <issue>: <mitigation>

## How to consume
<exact command or URL to access the artifacts>

## Blockers (if status is not complete)
- <blocker description>
```

Distinguish clearly between:
- **Done:** output exists, validated, deliverable
- **Deferred:** out of scope for this run, not a failure
- **Blocked:** needed but cannot produce without external dependency

## Phase 5: Package for Delivery

Depending on the delivery target:

**Artifact registry / API endpoint:**
```bash
# Verify the registry endpoint is reachable
curl -s -o /dev/null -w "%{http_code}" https://<registry-host>/api/health

# Publish
<publish-command>

# Verify the artifact is accessible post-publish
curl -s "https://<registry-host>/api/artifacts/<artifact-name>" | python3 -m json.tool | head -20
```

**Direct file handoff:**
```bash
# Create a dated package directory
mkdir -p deliverables/<YYYY-MM-DD>
cp <artifact-files> deliverables/<YYYY-MM-DD>/
cp handoff.md deliverables/<YYYY-MM-DD>/
ls -la deliverables/<YYYY-MM-DD>/
```

**GitHub release or upload:**
```bash
gh release create v<version> <artifact-files> --notes-file handoff.md
```

## Phase 6: Smoke Test the Delivered Artifact

After delivery, verify the artifact is consumable from the delivery target — not just from local disk:

```bash
# Download and verify from registry
curl -s "https://<registry-host>/api/artifacts/<artifact-name>" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(f'OK: {len(d)} items')"
```

If this fails, the delivery step has a bug — the artifact is not actually accessible.

## Phase 7: Final Checklist Before Closing

```
[ ] All expected outputs exist and are non-empty
[ ] All outputs pass format validation
[ ] Item counts match expectations (or regression is documented)
[ ] handoff.md written with done / deferred / blocked distinction
[ ] Artifacts delivered to target and smoke-tested from target
[ ] Any blockers documented with specific reason, not vague "TBD"
[ ] No uncommitted changes to source files that affect this deliverable
```

## Anti-Patterns

- Packaging an unvalidated artifact (JSON syntax errors, truncated files)
- Saying "done" when some items are missing without documenting which ones
- Treating a local file as delivered before verifying the registry or endpoint
- Writing a vague handoff note that requires explanation to understand
- Closing the task before smoke-testing the delivered artifact

## Related Skills

- `scraper-debug-and-hardening` — for diagnosing why outputs are missing
- `verification-before-completion` — general pre-completion verification
- `plan-promotion` — for promoting session lessons after delivery
