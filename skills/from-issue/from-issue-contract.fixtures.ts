export type RegressionCase = {
  id: number;
  name: string;
  input: {
    summary: string;
    pastedArtifact?: string;
    shouldRecognizePastedArtifact?: boolean;
  };
  assistantResponse: string;
  expectedOutcomes: Array<
    | "create-or-reuse-worktree"
    | "execution-in-place"
    | "resume-existing-worktree"
    | "explicit-blocker"
    | "generic-approval-gate"
  >;
  valid: boolean;
  mustMention?: string[];
  mustNotMention?: string[];
  requireNamedBlocker?: boolean;
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
    assistantResponse:
      "Validated Issue #20 handoff. Create or reuse the dedicated issue branch/worktree, continue execution there, and implement the smallest safe slice.",
    expectedOutcomes: ["create-or-reuse-worktree", "execution-in-place"],
    valid: true,
    mustMention: ["validated issue #20 handoff", "create or reuse", "continue execution"],
    mustNotMention: ["Handoff draft", "Approve this direction"],
  },
  {
    id: 2,
    name: "complete handoff does not degrade into a terminal Handoff draft",
    input: {
      summary: "The contract must not collapse a valid pasted handoff into a nested Handoff draft terminal response.",
      pastedArtifact: completeHandoff,
      shouldRecognizePastedArtifact: true,
    },
    assistantResponse:
      "Validated the pasted handoff and implement the smallest safe slice in the current issue lane instead of drafting another handoff.",
    expectedOutcomes: ["execution-in-place"],
    valid: true,
    mustMention: ["validated the pasted handoff", "implement the smallest safe slice"],
    mustNotMention: ["Handoff draft"],
  },
  {
    id: 3,
    name: "dirty primary checkout creates or reuses an isolated worktree",
    input: {
      summary: "The main checkout is dirty and the issue needs isolation before continuing.",
    },
    assistantResponse:
      "The primary checkout is dirty and isolation is required. Create or reuse the dedicated issue branch/worktree and continue execution there.",
    expectedOutcomes: ["create-or-reuse-worktree"],
    valid: true,
    mustMention: ["primary checkout is dirty", "create or reuse", "worktree"],
    mustNotMention: ["stop and emit a blocker handoff only"],
  },
  {
    id: 4,
    name: "genuinely incomplete input is allowed to stop as a durable blocker",
    input: {
      summary: "The brief is missing an unresolved prerequisite that prevents execution.",
      pastedArtifact: incompleteHandoff,
      shouldRecognizePastedArtifact: false,
    },
    assistantResponse:
      "Blocked: missing Verification section in the pasted handoff. Persist the exact missing prerequisite durably before execution continues.",
    expectedOutcomes: ["explicit-blocker"],
    valid: true,
    mustMention: ["blocked:", "missing verification section", "persist"],
    requireNamedBlocker: true,
  },
  {
    id: 5,
    name: "existing issue worktree resumes instead of spawning another lane",
    input: {
      summary: "The same issue already has an active branch or worktree.",
    },
    assistantResponse:
      "Resume the existing issue/worktree, continue execution in that lane, and do not recreate the handoff or branch.",
    expectedOutcomes: ["resume-existing-worktree"],
    valid: true,
    mustMention: ["resume the existing issue/worktree", "do not recreate"],
    mustNotMention: ["start another session"],
  },
  {
    id: 6,
    name: "from-issue plus ready-for-agent input keeps using-superpowers subordinate",
    input: {
      summary: "A ready-for-agent brief arrives with no blocker; nested using-superpowers must not become a terminal gate.",
    },
    assistantResponse:
      "The ready-for-agent brief is sufficient. Run using-superpowers as a subordinate step, return control to execution, and implement the slice without stopping for approval.",
    expectedOutcomes: ["execution-in-place"],
    valid: true,
    mustMention: ["using-superpowers as a subordinate step", "return control to execution"],
    mustNotMention: ["Approve this direction"],
  },
  {
    id: 7,
    name: "nested brainstorming or planning returns control in the same session",
    input: {
      summary: "The outer from-issue run asks for brainstorming or planning as a nested step.",
    },
    assistantResponse:
      "Use brainstorming or planning internally if needed, then return control to execution in the same session and implement the smallest safe slice.",
    expectedOutcomes: ["execution-in-place"],
    valid: true,
    mustMention: ["return control to execution in the same session", "implement the smallest safe slice"],
    mustNotMention: ["another handoff"],
  },
  {
    id: 8,
    name: "Approve this direction without a named blocker is rejected",
    input: {
      summary: "A nested approval asks to stop even though no unresolved blocker is named.",
    },
    assistantResponse: "Approve this direction before implementation.",
    expectedOutcomes: ["generic-approval-gate"],
    valid: false,
    mustMention: ["approve this direction"],
  },
  {
    id: 9,
    name: "unresolved product or architecture decisions may block explicitly",
    input: {
      summary: "The issue or brief still omits a real product or architecture decision.",
    },
    assistantResponse:
      "Blocked: unresolved architecture decision for the wire format is absent from the issue brief. Persist that exact missing decision durably instead of implementing guessed behavior.",
    expectedOutcomes: ["explicit-blocker"],
    valid: true,
    mustMention: ["blocked:", "unresolved architecture decision", "persist"],
    requireNamedBlocker: true,
  },
];
