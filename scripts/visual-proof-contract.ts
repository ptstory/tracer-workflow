export type ProducerVisualProofState = "provided" | "n/a";
export type CurrentProducerProofKind = ProducerVisualProofState | "stale" | "missing";
export type ReviewerVisualProofStatus = "PROVIDED" | "N/A" | "MISSING";

export type ParsedVisualProof = {
  state: ProducerVisualProofState;
  headSha: string;
  surface: string;
  claim: string;
  details: string;
};

export type CurrentProducerProof = {
  kind: CurrentProducerProofKind;
  proof?: ParsedVisualProof;
};

export type VisualProofReviewInputs = {
  visuallyInspectable: boolean;
  reasonablyRenderable: boolean;
  currentProducerProof: CurrentProducerProof;
  proofSufficient?: boolean;
  scopeFaithful?: boolean;
};

const FULL_SHA = /^[0-9a-f]{40}$/;
const MARKER = /^## visual-proof: (provided|n\/a)$/;

export function parseVisualProofComment(body: string): ParsedVisualProof | null {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const marker = lines[0]?.trim().match(MARKER);
  if (!marker) return null;

  const state = marker[1] as ProducerVisualProofState;
  let cursor = 1;
  while (lines[cursor]?.trim() === "") cursor += 1;

  const values: Record<string, string> = {};
  for (const field of ["head-sha", "surface", "claim"] as const) {
    const line = lines[cursor];
    if (line === undefined) return null;
    const match = line.match(new RegExp(`^${field}:\\s*(.+)$`));
    if (!match) return null;
    values[field] = match[1].trim();
    cursor += 1;
  }

  if (!FULL_SHA.test(values["head-sha"])) return null;
  if (state === "n/a" && values.surface !== "n/a") return null;
  if (state === "provided" && values.surface === "n/a") return null;

  const details = lines.slice(cursor).join("\n").trim();
  if (!details) return null;

  return {
    state,
    headSha: values["head-sha"],
    surface: values.surface,
    claim: values.claim,
    details,
  };
}

export function findCurrentProducerProof(comments: string[], currentHeadSha: string): CurrentProducerProof {
  if (!FULL_SHA.test(currentHeadSha)) {
    throw new Error(`currentHeadSha must be a full lowercase SHA: ${currentHeadSha}`);
  }

  const parsed = comments.map(parseVisualProofComment).filter((proof): proof is ParsedVisualProof => proof !== null);

  for (let index = parsed.length - 1; index >= 0; index -= 1) {
    const proof = parsed[index];
    if (proof.headSha === currentHeadSha) {
      return { kind: proof.state, proof };
    }
  }

  if (parsed.length > 0) {
    return { kind: "stale", proof: parsed[parsed.length - 1] };
  }

  return { kind: "missing" };
}

export function assessVisualProof(inputs: VisualProofReviewInputs): ReviewerVisualProofStatus {
  if (!inputs.visuallyInspectable) return "N/A";
  if (!inputs.reasonablyRenderable) return "N/A";

  if (
    inputs.currentProducerProof.kind === "provided" &&
    inputs.proofSufficient === true &&
    inputs.scopeFaithful === true
  ) {
    return "PROVIDED";
  }

  return "MISSING";
}
