export type ContractDoc = "skill" | "workflow" | "readme" | "prompt";

export type ContractCheck = {
  doc: ContractDoc;
  section?: string;
  fragments: string[];
  forbidden?: string[];
};

export type ContractScenario = {
  name: string;
  checks: ContractCheck[];
};

export const docs: Record<ContractDoc, string> = {
  skill: "skills/from-issue/SKILL.md",
  workflow: "WORKFLOW.md",
  readme: "README.md",
  prompt: "prompts/agent-brief.md",
};

export const contractScenarios: ContractScenario[] = [
  {
    name: "validated execution inputs can come from issue, pasted implementation handoff, or pasted durable brief",
    checks: [
      {
        doc: "skill",
        section: "## Inputs",
        fragments: [
          "A GitHub issue URL or number plus its durable `ready-for-agent` brief.",
          "A validated complete pasted implementation handoff for that issue.",
          "A validated pasted durable agent brief.",
        ],
      },
      {
        doc: "workflow",
        fragments: [
          "validated pasted implementation handoff / durable agent brief",
          "The durable issue brief, a validated pasted implementation handoff, or a validated pasted durable agent brief are all execution inputs once validated",
        ],
      },
      {
        doc: "readme",
        fragments: [
          "`ready-for-agent` issue, or for a validated pasted implementation handoff / durable agent brief",
          "accepted as equivalent execution input",
        ],
      },
      {
        doc: "prompt",
        fragments: [
          "The authoritative execution input may be one of three validated sources",
          "a complete pasted implementation handoff",
          "equivalent execution input",
        ],
      },
    ],
  },
  {
    name: "nested brainstorming and planning remain subordinate to outer-stage execution",
    checks: [
      {
        doc: "skill",
        section: "## Contract",
        fragments: [
          "Once action-ready input is accepted, any nested `using-superpowers`, brainstorming, or planning step is a subordinate subroutine and must return control to execution.",
          "An ordinary `Approve this direction` / design-approval checkpoint does not end the run unless it explicitly names a concrete unresolved blocker",
          "Multi-file scope, UI impact, a desire for planning, or a nested skill's default approval checkpoint are not blockers by themselves.",
        ],
      },
      {
        doc: "workflow",
        fragments: [
          "Once it accepts action-ready input, nested brainstorming/planning/`using-superpowers` steps are subordinate subroutines and must return control to execution.",
          "An ordinary `Approve this direction` / design-approval checkpoint only ends the run if it names a concrete unresolved blocker",
          "Multi-file scope, UI impact, a desire for planning, or a nested skill's default approval checkpoint are not blockers by themselves.",
        ],
      },
      {
        doc: "readme",
        fragments: [
          "nested brainstorming/planning/`using-superpowers` steps are subordinate subroutines",
          "ordinary approval gate does not end the run unless it names a concrete unresolved blocker",
          "Multi-file scope, UI impact, a desire for planning, or a nested skill's default approval checkpoint are not blockers by themselves.",
        ],
      },
      {
        doc: "prompt",
        fragments: [
          "those steps must return control to execution",
          "A generic `Approve this direction` or design-approval checkpoint does not end the run unless it names a concrete unresolved blocker",
          "Multi-file scope, UI impact, a desire for planning, or a nested skill's default approval checkpoint are not blockers by themselves.",
        ],
      },
    ],
  },
  {
    name: "generic approval-gate regression is rejected unless the blocker is explicit",
    checks: [
      {
        doc: "skill",
        section: "## Contract",
        fragments: [
          "An ordinary `Approve this direction` / design-approval checkpoint does not end the run unless it explicitly names a concrete unresolved blocker that is absent from the issue or brief.",
        ],
        forbidden: [
          "Stop for approval because the task is multi-file.",
          "Stop for approval because planning would be useful.",
        ],
      },
      {
        doc: "prompt",
        fragments: [
          "A generic `Approve this direction` or design-approval checkpoint does not end the run unless it names a concrete unresolved blocker",
        ],
        forbidden: [
          "Ask for approval solely because the task affects UI.",
        ],
      },
    ],
  },
  {
    name: "genuinely unresolved product or architecture decisions stop only as named blockers",
    checks: [
      {
        doc: "skill",
        section: "## Contract",
        fragments: [
          "Explicit durable blocker naming the exact missing prerequisite or decision.",
        ],
      },
      {
        doc: "workflow",
        fragments: [
          "explicit durable blocker naming the exact missing prerequisite or decision",
        ],
      },
      {
        doc: "readme",
        fragments: [
          "explicit durable blocker naming the exact missing prerequisite or decision",
        ],
      },
    ],
  },
  {
    name: "terminal outcomes are explicitly limited to the four accepted results",
    checks: [
      {
        doc: "skill",
        section: "## Contract",
        fragments: [
          "The terminal completion result is one of four outcomes:",
          "PR opened with a closing issue reference plus an evidence bundle.",
          "Existing PR/worktree resumed and advanced.",
          "Explicit durable blocker naming the exact missing prerequisite or decision.",
          "Verified failure with the exact recovery state persisted.",
        ],
      },
      {
        doc: "workflow",
        fragments: [
          "The terminal outcomes are limited to: PR opened with closing issue reference + evidence bundle; existing PR/worktree resumed and advanced; explicit durable blocker naming the exact missing prerequisite or decision; verified failure with the exact recovery state persisted.",
        ],
      },
      {
        doc: "readme",
        fragments: [
          "The allowed terminal outcomes are: PR opened with closing issue reference + evidence bundle; existing PR/worktree resumed and advanced; explicit durable blocker naming the exact missing prerequisite or decision; verified failure with the exact recovery state persisted.",
        ],
      },
      {
        doc: "prompt",
        fragments: [
          "The allowed terminal outcomes are:",
          "verified failure with the exact recovery state persisted",
        ],
      },
    ],
  },
  {
    name: "resuming a live worktree and persisting verified failure recovery remain first-class outcomes",
    checks: [
      {
        doc: "skill",
        section: "## Steps",
        fragments: [
          "Validate the input artifact if it was pasted, then resume the same issue/worktree when present; do not recreate the handoff or branch.",
          "If blocked or a verified failure cannot be recovered locally, stop with a blocker handoff that names the blocker, the failure, and the next required recovery contract.",
        ],
      },
      {
        doc: "workflow",
        fragments: [
          "resumes the same issue/worktree when present",
          "verified failure with the exact recovery state persisted",
          "If a blocker is durable or a failure is verified and cannot be recovered in the current worktree",
        ],
      },
      {
        doc: "readme",
        fragments: [
          "existing issue/worktree when one exists",
          "handoff-only result is allowed only for genuine blockers or verified failures that cannot be recovered locally",
        ],
      },
    ],
  },
];
