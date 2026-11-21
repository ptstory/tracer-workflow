type ClosingIssueReference = {
  number: number;
  repository: {
    name: string;
    owner: { login: string };
  };
};

type GoverningIssueClassification =
  | { kind: "valid"; issueNumber: number }
  | { kind: "missing" }
  | { kind: "malformed"; detail: string }
  | { kind: "ambiguous"; issueNumbers: number[] }
  | { kind: "unsupported"; repositories: string[] };

function classifyGoverningIssueReferences(value: unknown, repository: string): GoverningIssueClassification {
  if (!Array.isArray(value)) return { kind: "malformed", detail: "closing issue references are not a list" };
  if (value.length === 0) return { kind: "missing" };

  const references: ClosingIssueReference[] = [];
  for (const [index, candidate] of value.entries()) {
    if (!candidate || typeof candidate !== "object") {
      return { kind: "malformed", detail: `closing issue reference ${index} is not an object` };
    }
    const reference = candidate as Partial<ClosingIssueReference>;
    if (!Number.isInteger(reference.number) || (reference.number ?? 0) <= 0 || !reference.repository ||
      typeof reference.repository.name !== "string" || reference.repository.name.trim() === "" ||
      !reference.repository.owner || typeof reference.repository.owner.login !== "string" || reference.repository.owner.login.trim() === "") {
      return { kind: "malformed", detail: `closing issue reference ${index} has incomplete identity` };
    }
    references.push(reference as ClosingIssueReference);
  }

  const expectedRepository = repository.toLowerCase();
  const inRepositoryNumbers = [...new Set(references
    .filter(({ repository: referenceRepository }) => `${referenceRepository.owner.login}/${referenceRepository.name}`.toLowerCase() === expectedRepository)
    .map(({ number }) => number))].sort((left, right) => left - right);
  if (inRepositoryNumbers.length === 1) return { kind: "valid", issueNumber: inRepositoryNumbers[0] };
  if (inRepositoryNumbers.length > 1) return { kind: "ambiguous", issueNumbers: inRepositoryNumbers };
  if (references.length === 0) return { kind: "missing" };
  return {
    kind: "unsupported",
    repositories: [...new Set(references.map(({ repository: referenceRepository }) => `${referenceRepository.owner.login}/${referenceRepository.name}`))].sort((left, right) => left.localeCompare(right)),
  };
}

export { classifyGoverningIssueReferences };
export type { ClosingIssueReference, GoverningIssueClassification };
