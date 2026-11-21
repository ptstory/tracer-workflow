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

type BodyClosingReference = { issueNumber: number; repository: string };

function parseBodyClosingReferences(body: string, repository: string): BodyClosingReference[] {
  const references: BodyClosingReference[] = [];
  const pattern = /\b(?:Fixes|Closes|Resolves)\s+(?:([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+))?#(\d+)\b/gi;
  for (const match of body.matchAll(pattern)) {
    const ownerRepository = match[1] ?? repository;
    const issueNumber = Number(match[2]);
    if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) return [{ issueNumber: 0, repository: ownerRepository }];
    references.push({ issueNumber, repository: ownerRepository });
  }
  return references;
}

function classifyGoverningIssueReferences(value: unknown, repository: string, body: unknown): GoverningIssueClassification {
  if (typeof body !== "string") return { kind: "malformed", detail: "pull request body is unavailable or malformed" };
  if (!Array.isArray(value)) return { kind: "malformed", detail: "closing issue references are not a list" };

  const bodyReferences = parseBodyClosingReferences(body, repository);
  if (bodyReferences.length === 0) return { kind: "missing" };
  if (bodyReferences.some(({ issueNumber }) => issueNumber <= 0)) {
    return { kind: "malformed", detail: "pull request body contains an invalid closing issue number" };
  }
  if (bodyReferences.length > 1) {
    return { kind: "ambiguous", issueNumbers: bodyReferences.map(({ issueNumber }) => issueNumber).sort((left, right) => left - right) };
  }

  const [bodyReference] = bodyReferences;
  if (bodyReference.repository.toLowerCase() !== repository.toLowerCase()) {
    return { kind: "unsupported", repositories: [bodyReference.repository] };
  }

  const references: ClosingIssueReference[] = [];
  for (const [index, candidate] of value.entries()) {
    if (!candidate || typeof candidate !== "object") {
      return { kind: "malformed", detail: `closing issue reference ${index} is not an object` };
    }
    const reference = candidate as Partial<ClosingIssueReference>;
    if (!Number.isSafeInteger(reference.number) || (reference.number ?? 0) <= 0 || !reference.repository ||
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
  if (inRepositoryNumbers.length > 1) return { kind: "ambiguous", issueNumbers: inRepositoryNumbers };
  if (!inRepositoryNumbers.includes(bodyReference.issueNumber)) {
    return { kind: "malformed", detail: `pull request body closes #${bodyReference.issueNumber}, but GitHub reports no matching in-repository closing issue reference` };
  }
  return { kind: "valid", issueNumber: bodyReference.issueNumber };
}

export { classifyGoverningIssueReferences };
export type { ClosingIssueReference, GoverningIssueClassification };
