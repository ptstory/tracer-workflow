export type ContinuityDisposition =
  | "continue-update"
  | "reconcile"
  | "supersede"
  | "close"
  | "split"
  | "create-new"
  | "human-decision";

export type ContinuityArtifactState =
  | "active"
  | "blocked"
  | "stale"
  | "superseded"
  | "partially-implemented"
  | "complete"
  | "closed-not-planned"
  | "unknown";

export type ContinuityPlacement =
  | "preserve-current"
  | "behind-current"
  | "propose-displacement"
  | "reconcile-existing"
  | "no-current-recommendation"
  | "unknown";

export type ContinuityRelationship = "blocking" | "related" | "binding" | "conflict" | "unknown";
export type ContinuityPriority = "observed" | "provisional" | "unknown";
export type ContinuityActionKind =
  | "continue-existing"
  | "check-completion"
  | "inspect-superseder"
  | "inspect-overlap"
  | "create-after-authorization"
  | "human-decision"
  | "inspect-coverage"
  | "inspect-dependency-conflict";

export interface ContinuityArtifact {
  ref: string;
  state: ContinuityArtifactState;
}

export interface ContinuityFinding {
  ref: string;
  relationship: ContinuityRelationship;
}

export interface ContinuityOutcome {
  disposition: ContinuityDisposition;
  artifacts: ContinuityArtifact[];
  sourceRefs: string[];
  placement: ContinuityPlacement;
  placementRationale: string;
  findings: ContinuityFinding[];
  priority: {
    status: ContinuityPriority;
    rationale: string;
  };
  displacement: {
    value: "yes" | "no" | "unknown";
    reason: string;
  };
  nextAction: {
    kind: ContinuityActionKind;
    targetRef: string | null;
    rationale: string;
  };
  coverage: {
    complete: boolean;
    gaps: string[];
  };
  writes: "none";
}

export interface ContinuityExpectation {
  disposition: ContinuityDisposition;
  artifactStates: ContinuityArtifact[];
  sourceRefs: string[];
  placement: ContinuityPlacement;
  findings: ContinuityFinding[];
  priority: ContinuityPriority;
  displacement: "yes" | "no" | "unknown";
  nextAction: {
    kind: ContinuityActionKind;
    targetRef: string | null;
  };
  coverageComplete: boolean;
  coverageHasGap: boolean;
}

export interface ContinuityEvaluationFixture {
  id: string;
  scenario: string;
  input: {
    topic: string;
    currentRecommendation: string | null;
    coverage: string;
    evidence: string[];
  };
  candidate: ContinuityOutcome;
  expected: ContinuityExpectation;
}

export function evaluateContinuityOutcome(
  outcome: ContinuityOutcome,
  expected: ContinuityExpectation,
): string[] {
  const failures: string[] = [];
  const candidateStates = new Map(outcome.artifacts.map((artifact) => [artifact.ref, artifact.state]));
  const candidateFindings = new Set(outcome.findings.map((finding) => `${finding.ref}:${finding.relationship}`));

  if (outcome.disposition !== expected.disposition) failures.push("disposition");
  if (outcome.placement !== expected.placement) failures.push("placement");
  if (outcome.priority.status !== expected.priority) failures.push("priority");
  if (outcome.displacement.value !== expected.displacement) failures.push("displacement");
  if (outcome.nextAction.kind !== expected.nextAction.kind) failures.push("next-action-kind");
  if (outcome.nextAction.targetRef !== expected.nextAction.targetRef) failures.push("next-action-target");
  if (outcome.coverage.complete !== expected.coverageComplete) failures.push("coverage-completeness");
  if (outcome.coverage.gaps.length > 0 !== expected.coverageHasGap) failures.push("coverage-gaps");
  if (outcome.writes !== "none") failures.push("read-only-boundary");
  if (!outcome.placementRationale.trim()) failures.push("placement-rationale");
  if (!outcome.priority.rationale.trim()) failures.push("priority-rationale");
  if (!outcome.displacement.reason.trim()) failures.push("displacement-reason");
  if (!outcome.nextAction.rationale.trim()) failures.push("next-action-rationale");

  for (const artifact of expected.artifactStates) {
    if (candidateStates.get(artifact.ref) !== artifact.state) failures.push(`artifact-state:${artifact.ref}`);
  }
  for (const sourceRef of expected.sourceRefs) {
    if (!outcome.sourceRefs.includes(sourceRef)) failures.push(`provenance:${sourceRef}`);
  }
  for (const finding of expected.findings) {
    if (!candidateFindings.has(`${finding.ref}:${finding.relationship}`)) {
      failures.push(`relationship:${finding.ref}:${finding.relationship}`);
    }
  }

  return failures;
}
