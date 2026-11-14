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

The extended-workspace plugin requires Herdr 0.9.5 or later, `bash`, `git`, `fzf`, `jq`, and authenticated `gh`. The pane-issue plugin requires Herdr 0.9.1 or later, `jq`, and `git`; `gh` is needed for pull requests. Its optional push-hook setup is `herdr plugin action invoke ilazaridis.pane-issue.install-git-hook`; remove that hook with `herdr plugin action invoke ilazaridis.pane-issue.remove-git-hook`. Disabling a plugin does not remove its optional Git hook.

Both keybindings use Herdr's default `ctrl+b` prefix. The plugin READMEs document the commands and actions above. The extended-workspace plugin's GitHub PR picker exists, but whether this operator setup uses it is **unverified**; start issue lanes from the GitHub issue.

## Run an issue lane

1. In the repository's Herdr space, press `ctrl+b Shift+N` and choose **From a GitHub issue**. Select the open issue and confirm its branch. The plugin opens a worktree workspace under that repository. Do not start issue work in the home checkout.
2. In that issue workspace's Crush pane, use the current prompt template verbatim:

   ```text
   from-issue <issue-url>
   ```

   For example: `from-issue https://github.com/ptstory/tracer-workflow/issues/258`. `from-issue` reads the issue contract, posts its plan checkpoint before editing, implements and verifies one scoped slice, then commits/pushes and prepares a PR with current-head evidence.
3. Run lanes in parallel only when their files do not overlap. If one issue needs another issue's output, record the prerequisite as **Depends on** in GitHub; do not use parallel lanes to bypass that ordering.
4. After the implementation push and PR evidence refresh, launch the review in a fresh Review Gate session from the issue lane. The `open -g` command opens ChatGPT with the userscript's opt-in autosend query:

   ```sh
   open -g "https://chatgpt.com/?autosend=1&q=@review-gate <PR URL>"
   ```

   Replace `<PR URL>` with the full pull request URL. Review Gate Auto-send only opens the browser when the PR has no trusted verdict for its current head; a matching current-head verdict is printed instead. If no userscript is installed, the prompt remains available for manual submission.

## Read the `gate:*` verdict labels

The pane-issue plugin's PR status markers are separate from the Review Gate labels. Treat a `gate:*` label as a pointer to the latest verdict only after confirming that verdict is trusted and its `head-sha` matches the PR's current head; any push makes the old verdict stale.

| Label | Operator action |
|---|---|
| `gate:needs-fix` | Start a fresh `from-pr-review <PR_URL>` fixer pass for the current verdict. After its push, refresh the evidence and return the PR to a fresh Review Gate review. |
| `gate:needs-human` | Stop automated work and follow the verdict's `next-action` for the named human decision. |
| `gate:blocked` | Do not fix or merge around the blocker. Follow the verdict's `next-action` to inspect or resolve the stated blocker. |
| `gate:merge-candidate` | Review Gate found no blocking findings and the readiness gate is satisfied for that head. This label alone is not a general authorization to merge; follow the repository's configured landing policy and the issue's HITL/AFK authority. |

## Close the lane and remove its worktree

When the issue lane is finished and its work is safely on GitHub, close the Herdr workspace, then explicitly remove its worktree. Closing only the workspace leaves the checkout on disk.

```sh
herdr workspace close <workspace-id>
herdr worktree list
herdr worktree remove --workspace <workspace-id>
```

Use the workspace ID reported by Herdr, not a guessed path or ID. Check that the worktree is no longer needed and has no uncommitted work before removing it. Do not use `--force` to discard work. Keep the repository's home checkout and the repository space; remove only the completed issue's worktree.
