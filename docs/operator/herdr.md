# Running tracer-workflow lanes from Herdr

This is one operator setup, not a workflow requirement. The examples below describe the local Herdr 0.9.5 setup in the issue's settled facts; adapt paths and agent choices to your installation. GitHub remains the durable record for issues, PRs, commits, comments, and checks.

## One repo space, one issue workspace

Create **one Herdr space per repository**. Start each issue lane as its own worktree workspace nested under that repository's space. Never start issue work in the repository's home checkout. The issue's acceptance criteria cite the Nov 13 #241 incident for this guardrail: [issue #241](https://github.com/ptstory/tracer-workflow/issues/241). Keep each lane on its issue branch and PR; do not reuse a workspace for unrelated issue work.

| Visible element | Provided by | Operator meaning |
|---|---|---|
| Repository space and nested workspace tree | Core Herdr | One repository space contains its issue worktree workspaces. |
| Workspace and tab | Core Herdr | A worktree workspace isolates a lane; use the workspace that owns that issue branch. |
| Agents list and working/finished state | Core Herdr | Shows agent activity, not a Review Gate verdict or merge authorization. |
| `ctrl+b` prefix and `ctrl+b Shift+D` close-workspace key | Core Herdr | The prefix opens Herdr commands. Closing a workspace does not remove its Git worktree. |
| Issue number in blue and PR number in purple in the agent pane | `ilazaridis/herdr-pane-issue` plugin | Plugin metadata rendered in the Agents sidebar. |
| `✓` approved, `✗` changes requested, `●` pending, `◌` draft next to a PR | `ilazaridis/herdr-pane-issue` plugin | States documented by the plugin README. These are PR states, not the four `gate:*` labels below. |
| Whether a filled versus empty PR marker specifically means ready versus draft | `ilazaridis/herdr-pane-issue` plugin | **Unverified**; do not rely on this interpretation. |
| Issue/PR sidebar values inferred from a worktree or branch name before a PR exists | `ilazaridis/herdr-pane-issue` plugin | Plugin behavior. The exact first-number parsing is documented by its README; the displayed issue may come from the worktree name or branch. |

## Install the plugins

| Plugin | What it adds | Keybinding | Install | Disable |
|---|---|---|---|---|
| `U5K492/herdr-new-workspace-extended` (`u5k492.new-workspace-extended`) | A new-workspace picker, including **From a GitHub issue**, which selects an open issue and opens a worktree workspace from the latest default branch. | `ctrl+b Shift+N` (`prefix+shift+n`) | `herdr plugin install U5K492/herdr-new-workspace-extended` | `herdr plugin disable u5k492.new-workspace-extended` |
| `ilazaridis/herdr-pane-issue` (`ilazaridis.pane-issue`) | Displays the issue and PR for each agent pane and opens the PR, or the issue before a PR exists. | `ctrl+b i` (`prefix+i`) | `herdr plugin install ilazaridis/herdr-pane-issue` | `herdr plugin disable ilazaridis.pane-issue` |

Plugin installation does not configure the keybindings or sidebar display. Add these entries to `~/.config/herdr/config.toml`, merging them with any existing configuration:

```toml
[[keys.command]]
key = "prefix+shift+n"
type = "plugin_action"
command = "u5k492.new-workspace-extended.new"
description = "new workspace (extended)"

[[keys.command]]
key = "prefix+i"
type = "plugin_action"
command = "ilazaridis.pane-issue.open"

[ui.sidebar.agents]
rows = [["state_icon", "machine", "workspace", "tab"], ["agent", { token = "$issue", fg = "#89b4fa" }, { token = "$pr", fg = "#cba6f7" }]]
```

If your existing `[keys]` configuration sets `new_workspace = "prefix+shift+n"`, remove that assignment so the plugin binding can take effect, or move the built-in command to another key, for example `[keys]` with `new_workspace = "prefix+ctrl+n"`. Otherwise Herdr keeps the built-in binding and disables the extended-workspace plugin binding. After merging the configuration, run `herdr server reload-config` to apply it. The pane-issue plugin README provides the keybinding and sidebar rows above.

The extended-workspace plugin requires Herdr 0.9.5 or later, `bash`, `git`, `fzf`, `jq`, and authenticated `gh`. The pane-issue plugin requires Herdr 0.9.1 or later, `jq`, and `git`; `gh` is needed for pull requests. Its optional push-hook setup is `herdr plugin action invoke ilazaridis.pane-issue.install-git-hook`; remove that hook with `herdr plugin action invoke ilazaridis.pane-issue.remove-git-hook`. Disabling a plugin stops its future hooks; it does not remove its optional Git hook or stop a process already running in a workspace.

Both keybindings use Herdr's default `ctrl+b` prefix. The plugin READMEs document the commands and actions above. The extended-workspace plugin's GitHub PR picker exists, but whether this operator setup uses it is **unverified**; start issue lanes from the GitHub issue.

## Review Gate notifications

The optional Tracer Review Gate Watcher sends Herdr notifications for eligible current-head `gate:needs-fix` and `gate:needs-human` verdicts. It does not create panes or launch agents. Follow [`tooling/herdr-watcher/README.md`](../../tooling/herdr-watcher/README.md) to link the plugin, configure watched repositories and trusted reviewers, and verify plugin disable and Herdr shutdown behavior. The listener is owned by Herdr and is not a detached service.

## Launch explicit issue lanes

The `tooling/launch-lanes/launch.ts` CLI starts Crush lanes for an explicit list of GitHub issues. It runs from an ordinary shell with access to Herdr, `gh`, `git`, and Bun. It creates one issue worktree per eligible issue, starts Crush, waits for Herdr to recognize the Crush process, renames the agent, then submits the shared from-issue prompt through `herdr agent prompt`. It never uses raw pane input to submit the prompt. Herdr can report Crush question dialogs as `working`, and even after rename it may reject `agent prompt` with `agent_not_ready`; the launcher exits non-zero and reports the pane rather than answering or bypassing that dialog. Related: issue [#295](https://github.com/ptstory/tracer-workflow/issues/295).

Copy `tooling/launch-lanes/repositories.example.json` to `~/.config/tracer/launch-lanes/repositories.json` and edit each checkout path. Then run a dry plan before launching:

```sh
bun tooling/launch-lanes/launch.ts --dry-run owner/repo#23 owner/other#17
bun tooling/launch-lanes/launch.ts owner/repo#23 owner/other#17
```

The default is at most three lanes and at most one lane per repository, including already-running agents. `--max N` caps lanes started in this invocation and `--allow-same-repo` allows more than one lane for a repository in that invocation; neither disables duplicate issue/worktree/live-agent checks. Each issue prints one started, planned, or skipped result. Closed, missing, HITL/blocked, unmapped, and already-active issues are skipped. The launcher does not choose issues, merge, or synthesize `HERDR_*` values. If Herdr fails to recognize a Crush agent within two minutes, the agent is blocked, or rename/prompt submission fails, inspect the named pane manually. `agent_not_ready` is a hard stop; there is no pane-input fallback.

### Manual live verification

Run this from an ordinary shell inside Herdr, not from a Crush tool call. Use a disposable authorized repository and test issue. In a throwaway worktree workspace, run `herdr pane run <pane-id> crush`, wait for `herdr agent list` to identify a Crush agent on that pane, rename it with `herdr agent rename <pane-id> <unique-name>`, then run `herdr agent prompt <unique-name> "Reply with the word ready." --wait --timeout 120000`. Verify Herdr reports the lane as `working` while responding and that the prompt was accepted. Do not answer any unexpected Crush question or use raw pane input to submit the prompt; record the pane and stop if rename/prompt fails. Remove the disposable workspace only after verifying its Git worktree is clean.

## Run one issue lane manually

1. In the repository's Herdr space, press `ctrl+b Shift+N` and choose **From a GitHub issue**. Select the open issue and confirm its branch. The plugin opens a worktree workspace under that repository. Do not start issue work in the home checkout.
2. In that issue workspace's Crush pane, use the current prompt template verbatim:

   ```text
   from-issue <issue-url>
   ```

   For example: `from-issue https://github.com/ptstory/tracer-workflow/issues/258`. `from-issue` reads the issue contract, posts its plan checkpoint before editing, implements and verifies one scoped slice, then commits/pushes and prepares a PR with current-head evidence.
3. Run lanes in parallel only when their files do not overlap. If one issue needs another issue's output, record the prerequisite as **Depends on** in GitHub; do not use parallel lanes to bypass that ordering.
4. After the implementation push and PR evidence refresh, `from-issue` runs the Review Gate Auto-send launch guard. It opens a fresh Review Gate session only when the PR has no trusted verdict for its current head; otherwise the helper prints the current verdict and next action. Do not also run this manual fallback after the normal guarded launch.

   ```sh
   open -g "https://chatgpt.com/?autosend=1&q=@review-gate <PR URL>"
   ```

   Replace `<PR URL>` with the full pull request URL. Use this `open -g` command only when launching manually because the normal guard was not run; `open -g` itself does not check for a current-head verdict. If no userscript is installed, the prompt remains available for manual submission.

## Read the `gate:*` verdict labels

The pane-issue plugin's PR status markers are separate from the Review Gate labels. Treat a `gate:*` label as a pointer to the latest verdict only after confirming that verdict is trusted and its `head-sha` matches the PR's current head; any push makes the old verdict stale.

| Label | Operator action |
|---|---|
| `gate:needs-fix` | Start a fresh `from-pr-review <PR_URL>` fixer pass for the current verdict. After its push, refresh the evidence and return the PR to a fresh Review Gate review. |
| `gate:needs-human` | Stop automated work and follow the verdict's `next-action` for the named human decision. |
| `gate:blocked` | Do not fix or merge around the blocker. Follow the verdict's `next-action` to inspect or resolve the stated blocker. |
| `gate:merge-candidate` | Review Gate found no blocking findings and the readiness gate is satisfied for that head. This label alone is not a general authorization to merge; follow the repository's configured landing policy and the issue's HITL/AFK authority. |

## Close the lane and remove its worktree

When the issue lane is finished and its work is safely on GitHub, remove its linked worktree while the Herdr workspace is still open. Herdr resolves the workspace ID for removal and closes the associated workspace after successfully removing the worktree. Closing the workspace first makes that ID unavailable to the removal command and leaves the checkout on disk.

```sh
herdr worktree list
git -C <worktree-path> status --short
herdr worktree remove --workspace <workspace-id>
```

Use the workspace ID and path reported by Herdr, not guessed values. Run the removal only when `git status --short` is empty. Do not use `--force` to discard work. `herdr workspace close <workspace-id>` closes a workspace without removing its checkout; use it only when the worktree should remain on disk, not before removing a linked worktree. Keep the repository's home checkout and the repository space; remove only the completed issue's worktree.
