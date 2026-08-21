export type RegressionCase = {
  id: number;
  name: string;
  input: {
    summary: string;
    pastedArtifact?: string;
    shouldRecognizePastedArtifact?: boolean;
  };
  skillMatches: Array<{
    heading: "Inputs" | "Dirty checkout" | "Contract" | "Steps" | "Do not";
    mustContain: string[];
  }>;
};

export const completeHandoff = `Issue #20 handoff

Goal
- Continue execution in the same session.

Files
- skills/from-issue/SKILL.md
- skills/from-issue/from-issue-contract.test.ts

Constraints
- Create or reuse the dedicated issue worktree when the primary checkout is dirty.

Acceptance criteria
- A complete handoff enters execution instead of producing another handoff.

Verification
- bun run typecheck
- bun test
`;

export const incompleteHandoff = `Issue #20 handoff

Goal
- Continue execution in the same session.

Files
- skills/from-issue/SKILL.md

Constraints
- Preserve existing work.

Acceptance criteria
- Enter execution when safe.
`;

export const regressionCases: RegressionCase[] = [
  {
    id: 1,
    name: "complete handoff still drives execution",
    input: {
      summary: "A validated complete pasted handoff arrives for issue #20 and the run must move into execution.",
      pastedArtifact: completeHandoff,
      shouldRecognizePastedArtifact: true,
    },
    skillMatches: [
      {
        heading: "Inputs",
        mustContain: [
          "validate a pasted handoff by matching a bounded shape",
          "issue #n handoff",
          "goal",
          "files",
          "constraints",
          "acceptance criteria",
          "verification",
          "otherwise treat it as an incomplete contract and stop only as an explicit blocker",
        ],
      },
    ],
  },
  {
    id: 2,
    name: "complete handoff does not degrade into a terminal Handoff draft",
    input: {
      summary: "The contract must not collapse a valid pasted handoff into a nested Handoff draft terminal response.",
      pastedArtifact: completeHandoff,
      shouldRecognizePastedArtifact: true,
    },
    skillMatches: [
      {
        heading: "Contract",
        mustContain: [
          "do not emit another implementation handoff for the same issue",
          "update or resume the existing lane instead",
          "a handoff-only result is allowed only for genuine blockers or verified failures",
        ],
      },
    ],
  },
  {
    id: 3,
    name: "dirty primary checkout creates or reuses an isolated worktree",
    input: {
      summary: "The main checkout is dirty and the issue needs isolation before continuing.",
    },
    skillMatches: [
      {
        heading: "Dirty checkout",
        mustContain: [
          "if the primary checkout is dirty and isolation is required, create or reuse the dedicated issue branch/worktree and continue execution there",
        ],
      },
    ],
  },
  {
    id: 4,
    name: "genuinely incomplete input is allowed to stop as a durable blocker",
    input: {
      summary: "The brief is missing an unresolved prerequisite that prevents execution.",
      pastedArtifact: incompleteHandoff,
      shouldRecognizePastedArtifact: false,
    },
    skillMatches: [
      {
        heading: "Inputs",
        mustContain: [
          "otherwise treat it as an incomplete contract and stop only as an explicit blocker",
        ],
      },
    ],
  },
  {
    id: 5,
    name: "existing issue worktree resumes instead of spawning another lane",
    input: {
      summary: "The same issue already has an active branch or worktree.",
    },
    skillMatches: [
      {
        heading: "Contract",
        mustContain: [
          "resume the existing issue/worktree if it already exists",
          "do not emit another implementation handoff for the same issue",
        ],
      },
      {
        heading: "Steps",
        mustContain: [
          "validate the input artifact if it was pasted, then resume the same issue/worktree when present",
          "do not recreate the handoff or branch",
        ],
      },
    ],
  },
  {
    id: 6,
    name: "from-issue plus ready-for-agent input keeps using-superpowers subordinate",
    input: {
      summary: "A ready-for-agent brief arrives with no blocker; nested using-superpowers must not become a terminal gate.",
    },
    skillMatches: [
      {
        heading: "Contract",
        mustContain: [
          "once action-ready input is accepted, any nested `using-superpowers`, brainstorming, or planning step is a subordinate subroutine and must return control to execution",
        ],
      },
    ],
  },
  {
    id: 7,
    name: "nested brainstorming or planning returns control in the same session",
    input: {
      summary: "The outer from-issue run asks for brainstorming or planning as a nested step.",
    },
    skillMatches: [
      {
        heading: "Contract",
        mustContain: [
          "once action-ready input is accepted, any nested `using-superpowers`, brainstorming, or planning step is a subordinate subroutine and must return control to execution",
          "do not emit another implementation handoff for the same issue",
        ],
      },
    ],
  },
  {
    id: 8,
    name: "Approve this direction without a named blocker is rejected",
    input: {
      summary: "A nested approval asks to stop even though no unresolved blocker is named.",
    },
    skillMatches: [
      {
        heading: "Contract",
        mustContain: [
          "an ordinary `approve this direction` / design-approval checkpoint does not end the run unless it explicitly names a concrete unresolved blocker that is absent from the issue or brief",
          "multi-file scope, ui impact, a desire for planning, or a nested skill's default approval checkpoint are not blockers by themselves",
        ],
      },
    ],
  },
  {
    id: 9,
    name: "unresolved product or architecture decisions may block explicitly",
    input: {
      summary: "The issue or brief still omits a real product or architecture decision.",
    },
    skillMatches: [
      {
        heading: "Contract",
        mustContain: [
          "an ordinary `approve this direction` / design-approval checkpoint does not end the run unless it explicitly names a concrete unresolved blocker that is absent from the issue or brief",
          "explicit durable blocker naming the exact missing prerequisite or decision",
        ],
      },
    ],
  },
];
