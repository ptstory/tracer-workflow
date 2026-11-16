import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { countCorrectiveRounds, evaluateReviewGateEligibility, type CorrectiveReview, type EligibilityDecision } from "../lib/review-gate-eligibility";
import { parseGateComment, parseGateReviewMetadata, type Comment } from "../lib/verdict";

type WatcherConfig = {
  repositories: string[];
  reviewer_logins: string[];
  refresh_interval_seconds: number;
};

type PullRequest = {
  number: number;
  title: string;
  url: string;
  headRefOid: string;
  labels: { name: string }[];
  closingIssuesReferences: { number: number }[];
};

type GithubComment = { user: { login: string } | null; body: string; created_at: string };
type IssueMetadata = { state: string; title: string; body: string; labels: { name: string }[] };
type NotificationCandidate = { key: string; title: string; body: string };
type NotificationState = { notified: string[] };
type HerdrSnapshot = { protocol: number; workspaces: { worktree?: { repo_root: string; checkout_path: string; repo_key: string; repo_name: string } | null }[]; panes: unknown[]; agents: unknown[] };
type ReviewMetadata = { blockingTargets: string[] | null; rebaseline: boolean };
type HistoricalReview = { commentedAt: string; headSha: string; metadata: ReviewMetadata };
type HerdrEvent = { event?: string; data?: { type?: string } };
type CommandResult = { status: number; stdout: string; stderr: string };
type CommandRunner = (executable: string, args: string[]) => CommandResult;
type Logger = (message: string) => void;
type WatcherDependencies = {
  commandRunner?: CommandRunner;
  snapshot?: () => Promise<HerdrSnapshot>;
  waitForEvent?: (timeoutMs: number) => Promise<HerdrEvent | null>;
  logger?: Logger;
  pause?: (milliseconds: number) => Promise<void>;
  pluginEnabled?: () => boolean;
};

const DEFAULT_REFRESH_INTERVAL_SECONDS = 60;
const MIN_REFRESH_INTERVAL_SECONDS = 15;
const MAX_REFRESH_INTERVAL_SECONDS = 3600;
const STALE_LOCK_MS = 60 * 60 * 1000;
const ISSUE_HITL_LABELS = new Set(["blocked", "hitl", "needs-human", "needs-fix", "needs-info", "needs-triage", "ready-for-human"]);
const PULL_REQUEST_HITL_LABELS = new Set(["hitl", "needs-human", "needs-fix", "ready-for-human"]);
const HISTORICAL_BLOCKING_SET_REQUIRED_SINCE = Date.parse("2026-09-01T12:23:47Z");
const HERDR_PROTOCOL = 22;

function runCommand(executable: string, args: string[]): CommandResult {
  const result = spawnSync(executable, args, { encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (result.error instanceof Error ? result.error.message : ""),
  };
}

function parseToml(source: string): unknown {
  return Bun.TOML.parse(source);
}

function validateConfig(value: unknown): WatcherConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Watcher configuration must be a TOML table");
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.repositories) || !record.repositories.every((repo) => typeof repo === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))) {
    throw new Error("repositories must contain one or more owner/repo values");
  }
  if (record.repositories.length === 0 || new Set(record.repositories.map((repo) => repo.toLowerCase())).size !== record.repositories.length) {
    throw new Error("repositories must be non-empty and unique");
  }
  if (!Array.isArray(record.reviewer_logins) || !record.reviewer_logins.every((login) => typeof login === "string" && login.trim())) {
    throw new Error("reviewer_logins must contain one or more GitHub logins");
  }
  if (record.repositories.some((repository) => {
    const [owner, repo] = (repository as string).split("/");
    return owner.length > 39 || repo.length > 100 || owner.startsWith("-") || owner.endsWith("-") || repo.startsWith(".") || repo.endsWith(".git");
  })) throw new Error("repositories contains an invalid GitHub repository name");
  const interval = record.refresh_interval_seconds ?? DEFAULT_REFRESH_INTERVAL_SECONDS;
  if (typeof interval !== "number" || !Number.isInteger(interval) || interval < MIN_REFRESH_INTERVAL_SECONDS || interval > MAX_REFRESH_INTERVAL_SECONDS) {
    throw new Error(`refresh_interval_seconds must be an integer from ${MIN_REFRESH_INTERVAL_SECONDS} to ${MAX_REFRESH_INTERVAL_SECONDS}`);
  }
  return {
    repositories: record.repositories as string[],
    reviewer_logins: [...new Set((record.reviewer_logins as string[]).map((login) => login.trim().toLowerCase()))],
    refresh_interval_seconds: interval,
  };
}

function pluginConfigDirectory(environment: NodeJS.ProcessEnv): string | null {
  if (environment.HERDR_PLUGIN_CONFIG_DIR) return environment.HERDR_PLUGIN_CONFIG_DIR;
  if (environment.HERDR_PLUGIN_ID && environment.HERDR_BIN_PATH) {
    const result = runCommand(environment.HERDR_BIN_PATH, ["plugin", "config-dir", environment.HERDR_PLUGIN_ID]);
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  return null;
}

function configPath(environment: NodeJS.ProcessEnv): string {
  const pluginDirectory = pluginConfigDirectory(environment);
  if (pluginDirectory) return resolve(pluginDirectory, "config.toml");
  return resolve(environment.HOME ?? ".", ".config/herdr/tracer-review-gate-watcher/config.toml");
}

function statePath(environment: NodeJS.ProcessEnv): string {
  if (environment.HERDR_PLUGIN_STATE_DIR) return resolve(environment.HERDR_PLUGIN_STATE_DIR, "notified.json");
  return resolve(environment.XDG_STATE_HOME ?? resolve(environment.HOME ?? ".", ".local/state"), "herdr/plugins/tracer.review-gate-watcher/notified.json");
}

function configuredRepositories(environment: NodeJS.ProcessEnv): WatcherConfig {
  const configuration = loadConfig(environment);
  const reviewers = environment.TRACER_REVIEWER_LOGINS?.split(",").map((login) => login.trim().toLowerCase()).filter(Boolean);
  if (!reviewers?.length) throw new Error("TRACER_REVIEWER_LOGINS must contain at least one trusted reviewer");
  if (configuration.reviewer_logins.some((login) => !reviewers.includes(login))) {
    throw new Error("Watcher reviewer_logins must be contained in TRACER_REVIEWER_LOGINS");
  }
  return configuration;
}

function loadConfig(environment: NodeJS.ProcessEnv): WatcherConfig {
  const path = configPath(environment);
  if (!existsSync(path)) throw new Error(`Watcher config not found: ${path}`);
  return validateConfig(parseToml(readFileSync(path, "utf8")));
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Could not parse ${label} as JSON`);
  }
}

function successfulJson<T>(commandRunner: CommandRunner, args: string[], label: string): T {
  const result = commandRunner("gh", args);
  if (result.status !== 0) throw new Error(result.stderr.trim() || `GitHub read failed for ${label}`);
  return parseJson<T>(result.stdout, label);
}

function validatePullRequest(value: unknown, repository: string): PullRequest {
  if (!value || typeof value !== "object") throw new Error(`Open pull request response for ${repository} contained an invalid record`);
  const pr = value as Partial<PullRequest>;
  const urlRepository = typeof pr.url === "string" ? pr.url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+$/)?.[1] : undefined;
  if (!Number.isInteger(pr.number) || typeof pr.title !== "string" || typeof pr.url !== "string" || urlRepository?.toLowerCase() !== repository.toLowerCase() ||
    !/^[0-9a-f]{40}$/.test(pr.headRefOid ?? "") || !Array.isArray(pr.labels) || !pr.labels.every((label) => label && typeof label.name === "string") ||
    !Array.isArray(pr.closingIssuesReferences) || !pr.closingIssuesReferences.every((issue) => issue && Number.isInteger(issue.number))) {
    throw new Error(`Open pull request response for ${repository} had incomplete identity or head data`);
  }
  return pr as PullRequest;
}

function pullRequests(repository: string, commandRunner: CommandRunner): PullRequest[] {
  const result = commandRunner("gh", ["pr", "list", "--repo", repository, "--state", "open", "--limit", "1000", "--json", "number,title,url,headRefOid,labels,closingIssuesReferences"]);
  if (result.status !== 0) throw new Error(result.stderr.trim() || `Unable to read open pull requests for ${repository}`);
  const records = parseJson<unknown>(result.stdout, `open pull requests for ${repository}`);
  if (!Array.isArray(records)) throw new Error(`Open pull request response for ${repository} was not a list`);
  return records.map((record) => validatePullRequest(record, repository));
}

function pullRequest(repository: string, number: number, commandRunner: CommandRunner): PullRequest {
  const value = successfulJson<unknown>(commandRunner, ["pr", "view", String(number), "--repo", repository, "--json", "number,title,url,headRefOid,labels,closingIssuesReferences"], `pull request #${number}`);
  return validatePullRequest(value, repository);
}

function issueMetadata(repository: string, number: number, commandRunner: CommandRunner): IssueMetadata {
  const value = successfulJson<Partial<IssueMetadata>>(commandRunner, ["issue", "view", String(number), "--repo", repository, "--json", "state,title,body,labels"], `governing issue #${number}`);
  if ((value.state !== "OPEN" && value.state !== "CLOSED") || typeof value.title !== "string" || typeof value.body !== "string" ||
    !Array.isArray(value.labels) || !value.labels.every((label) => label && typeof label.name === "string")) {
    throw new Error(`Governing issue #${number} metadata was incomplete`);
  }
  return value as IssueMetadata;
}

function reviewComments(repository: string, number: number, commandRunner: CommandRunner): Comment[] {
  const result = commandRunner("gh", ["api", `repos/${repository}/issues/${number}/comments`, "--paginate", "--slurp"]);
  if (result.status !== 0) throw new Error(result.stderr.trim() || `Unable to read comments for ${repository}#${number}`);
  const pages = parseJson<unknown>(result.stdout, `comments for ${repository}#${number}`);
  if (!Array.isArray(pages) || !pages.every(Array.isArray)) throw new Error(`Comment response for ${repository}#${number} was not paginated`);
  return (pages as GithubComment[][]).flatMap((page) => page.map((comment) => {
    if (!comment || typeof comment.body !== "string" || typeof comment.created_at !== "string" ||
      (comment.user !== null && (!comment.user || typeof comment.user.login !== "string"))) {
      throw new Error(`Comment response for ${repository}#${number} contained malformed data`);
    }
    return { author: comment.user ? { login: comment.user.login } : null, body: comment.body, createdAt: comment.created_at };
  }));
}

function hasHitl(labels: readonly { name: string }[], issue = false): boolean {
  const markers = issue ? ISSUE_HITL_LABELS : PULL_REQUEST_HITL_LABELS;
  return labels.some(({ name }) => markers.has(name.toLowerCase()));
}

function governingIssueIsHitl(issue: IssueMetadata): boolean {
  const autonomyDeclarations = [...issue.body.matchAll(/(?:^|\n)\s*autonomy\s*:\s*([^\r\n]*)/gi)]
    .map((match) => match[1].trim().toLowerCase());
  return hasHitl(issue.labels, true) || /\[(?:HITL|needs-human)\]/i.test(issue.title) ||
    autonomyDeclarations.length !== 1 || autonomyDeclarations[0] !== "afk-safe";
}

function correctiveReviewHistory(repository: string, pullRequestNumber: number, comments: Comment[], reviewerLogins: readonly string[], commandRunner: CommandRunner): CorrectiveReview[] {
  const historicalReviews: HistoricalReview[] = comments.reduce<HistoricalReview[]>((reviews, comment) => {
    if (!comment.author?.login || !reviewerLogins.includes(comment.author.login.toLowerCase()) || !comment.body.startsWith("## review-gate:")) return reviews;
    const parsed = parseGateComment([comment], { pullRequestNumber, trustedReviewerLogins: reviewerLogins });
    const metadata = parseGateReviewMetadata(comment.body);
    if (parsed.kind === "parsed") {
      if (metadata) {
        reviews.push({ commentedAt: parsed.verdict.commentedAt, headSha: parsed.verdict.headSha, metadata: { blockingTargets: metadata.blockingTargets, rebaseline: metadata.rebaseline } });
        return reviews;
      }
      const markerDate = Date.parse(comment.createdAt);
      if (!Number.isFinite(markerDate) || markerDate >= HISTORICAL_BLOCKING_SET_REQUIRED_SINCE) {
        throw new Error(`Trusted review-gate comment for PR #${pullRequestNumber} has no usable review metadata`);
      }
      reviews.push({ commentedAt: parsed.verdict.commentedAt, headSha: parsed.verdict.headSha, metadata: { blockingTargets: null, rebaseline: false } });
      return reviews;
    }
    if (parsed.kind === "invalid") {
      const header = comment.body.match(/^## review-gate:\s*(\S+)/)?.[1];
      const markerDate = Date.parse(comment.createdAt);
      if (header && header !== "needs-fix" && header !== "needs-human" && header !== "blocked" && header !== "merge-candidate") {
        if (Number.isFinite(markerDate) && markerDate >= HISTORICAL_BLOCKING_SET_REQUIRED_SINCE) {
          throw new Error(`Trusted review-gate comment for PR #${pullRequestNumber} is malformed`);
        }
        return reviews;
      }
      if (!Number.isFinite(markerDate) || markerDate >= HISTORICAL_BLOCKING_SET_REQUIRED_SINCE) {
        throw new Error(`Trusted review-gate comment for PR #${pullRequestNumber} is malformed`);
      }
      return reviews;
    }
    return reviews;
  }, []).sort((left, right) => left.commentedAt.localeCompare(right.commentedAt));
  const latestConforming = new Map<string, string>();
  for (const review of historicalReviews) latestConforming.set(review.headSha, review.commentedAt);
  const reviews = historicalReviews.filter((review) => latestConforming.get(review.headSha) === review.commentedAt);
  const history: CorrectiveReview[] = [];
  let previousSha: string | null = null;
  let previousTargetsKnown = true;
  for (const review of reviews) {
    if ((previousSha !== null && !review.metadata.rebaseline && !previousTargetsKnown) ||
      (review.metadata.blockingTargets === null && previousSha !== null)) {
      throw new Error(`Cannot derive corrective-round history for PR #${pullRequestNumber}: prior verdict has no blocking set`);
    }
    let changedFilesSincePrevious: string[] = [];
    if (previousSha !== null && !review.metadata.rebaseline && previousSha !== review.headSha) {
      const result = commandRunner("gh", ["api", `repos/${repository}/compare/${previousSha}...${review.headSha}`, "--paginate", "--slurp"]);
      if (result.status !== 0) throw new Error(result.stderr.trim() || `Unable to derive corrective-round history for PR #${pullRequestNumber}`);
      const pages = parseJson<{ status: string; ahead_by: number; files?: { filename: string }[] }[]>(result.stdout, `commit comparison for PR #${pullRequestNumber}`);
      const first = pages[0];
      const files = pages.flatMap((page) => page.files ?? []);
      if (!first || first.status !== "ahead" || first.ahead_by < 1 || files.length >= 300 ||
        pages.some((page) => !Array.isArray(page.files) || page.files.some((file) => typeof file.filename !== "string"))) {
        throw new Error(`Cannot derive linear corrective-round history for PR #${pullRequestNumber}`);
      }
      changedFilesSincePrevious = files.map((file) => file.filename);
    }
    history.push({ blockingTargets: review.metadata.blockingTargets ?? [], changedFilesSincePrevious, rebaseline: review.metadata.rebaseline || previousSha === null });
    previousSha = review.headSha;
    previousTargetsKnown = review.metadata.blockingTargets !== null;
  }
  return history;
}

function pullRequestDecision(repository: string, pr: PullRequest, comments: Comment[], reviewerLogins: readonly string[], commandRunner: CommandRunner): EligibilityDecision {
  let history: CorrectiveReview[];
  try {
    history = correctiveReviewHistory(repository, pr.number, comments, reviewerLogins, commandRunner);
  } catch {
    return { kind: "stop", reason: "malformed-verdict" };
  }
  if (countCorrectiveRounds(history) > 2) return { kind: "stop", reason: "circuit-breaker" };
  return evaluateReviewGateEligibility({
    pullRequestNumber: pr.number,
    currentHeadSha: pr.headRefOid,
    currentLabels: pr.labels.map((label) => label.name),
    comments,
    trustedReviewerLogins: reviewerLogins,
    correctiveReviewHistory: history,
    priorAttempt: null,
    now: 0,
  });
}

function notificationCandidate(repository: string, pr: PullRequest, decision: EligibilityDecision): NotificationCandidate | null {
  if (decision.kind === "dispatch") {
    return { key: `${repository}#${pr.number}:${pr.headRefOid}:needs-fix`, title: `Review Gate needs a fix: ${repository}#${pr.number}`, body: `${pr.url}\nManual action: from-pr-review ${pr.url}` };
  }
  if (decision.kind === "notify-only") {
    return { key: `${repository}#${pr.number}:${pr.headRefOid}:needs-human`, title: `Review Gate needs human input: ${repository}#${pr.number}`, body: `${pr.url}\nNext action: ${decision.nextAction}` };
  }
  return null;
}

function readNotificationState(path: string): NotificationState {
  if (!existsSync(path)) return { notified: [] };
  const value = parseJson<Partial<NotificationState>>(readFileSync(path, "utf8"), "notification state");
  if (!Array.isArray(value.notified) || !value.notified.every((key) => typeof key === "string")) throw new Error("Notification state file is malformed");
  return { notified: [...new Set(value.notified)] };
}

function writeNotificationState(path: string, state: NotificationState): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify({ notified: [...new Set(state.notified)] }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
}

function writeNotificationStateForEnvironment(environment: NodeJS.ProcessEnv, state: NotificationState): void {
  writeNotificationState(statePath(environment), state);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function withStateLock<T>(path: string, action: () => T): T | null {
  mkdirSync(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  let lock: number;
  try {
    lock = openSync(lockPath, "wx", 0o600);
  } catch {
    try {
      const age = Date.now() - statSync(lockPath).mtimeMs;
      const owner = Number(readFileSync(lockPath, "utf8"));
      if (age < STALE_LOCK_MS || (Number.isInteger(owner) && owner > 0 && processExists(owner))) return null;
      unlinkSync(lockPath);
      lock = openSync(lockPath, "wx", 0o600);
    } catch {
      return null;
    }
  }
  try {
    writeFileSync(lock, String(process.pid));
    return action();
  } finally {
    closeSync(lock);
    unlinkSync(lockPath);
  }
}

function pluginIsEnabled(environment: NodeJS.ProcessEnv, commandRunner: CommandRunner): boolean {
  const executable = environment.HERDR_BIN_PATH ?? "herdr";
  const pluginId = environment.HERDR_PLUGIN_ID ?? "tracer.review-gate-watcher";
  const result = commandRunner(executable, ["plugin", "list", "--json"]);
  if (result.status !== 0) return false;
  const envelope = parseJson<{ result?: { plugins?: { plugin_id: string; enabled: boolean }[] } }>(result.stdout, "Herdr plugin list");
  return envelope.result?.plugins?.some((plugin) => plugin.plugin_id === pluginId && plugin.enabled) ?? false;
}

function sendNotification(candidate: NotificationCandidate, environment: NodeJS.ProcessEnv, commandRunner: CommandRunner): void {
  const executable = environment.HERDR_BIN_PATH ?? "herdr";
  const result = commandRunner(executable, ["notification", "show", candidate.title, "--body", candidate.body]);
  if (result.status !== 0) throw new Error(result.stderr.trim() || "Herdr could not show notification");
}

function samePullRequestIdentity(left: PullRequest, right: PullRequest): boolean {
  return left.number === right.number && left.url === right.url && left.headRefOid === right.headRefOid &&
    JSON.stringify(left.labels.map((label) => label.name).sort()) === JSON.stringify(right.labels.map((label) => label.name).sort()) &&
    JSON.stringify(left.closingIssuesReferences.map((issue) => issue.number).sort()) === JSON.stringify(right.closingIssuesReferences.map((issue) => issue.number).sort());
}

function actionableCandidate(repository: string, initial: PullRequest, config: WatcherConfig, environment: NodeJS.ProcessEnv, commandRunner: CommandRunner): NotificationCandidate | null {
  if (hasHitl(initial.labels) || initial.closingIssuesReferences.length !== 1 || /^\[(?:HITL|needs-human|needs-fix)\]/i.test(initial.title)) return null;
  const issueNumber = initial.closingIssuesReferences[0].number;
  const issue = issueMetadata(repository, issueNumber, commandRunner);
  if (issue.state !== "OPEN" || governingIssueIsHitl(issue)) return null;
  const comments = reviewComments(repository, initial.number, commandRunner);
  const decision = pullRequestDecision(repository, initial, comments, config.reviewer_logins, commandRunner);
  const candidate = notificationCandidate(repository, initial, decision);
  if (!candidate) return null;

  const current = pullRequest(repository, initial.number, commandRunner);
  if (!samePullRequestIdentity(initial, current) || hasHitl(current.labels) || /^\[(?:HITL|needs-human|needs-fix)\]/i.test(current.title)) return null;
  const currentIssue = issueMetadata(repository, issueNumber, commandRunner);
  if (currentIssue.state !== "OPEN" || governingIssueIsHitl(currentIssue)) return null;
  const currentComments = reviewComments(repository, initial.number, commandRunner);
  const currentDecision = pullRequestDecision(repository, current, currentComments, config.reviewer_logins, commandRunner);
  const currentCandidate = notificationCandidate(repository, current, currentDecision);
  if (!currentCandidate || currentCandidate.key !== candidate.key || currentCandidate.body !== candidate.body) return null;
  if (!pluginIsEnabled(environment, commandRunner)) throw new Error("Herdr watcher plugin is disabled or unavailable");
  const finalIssue = issueMetadata(repository, issueNumber, commandRunner);
  if (finalIssue.state !== "OPEN" || governingIssueIsHitl(finalIssue)) return null;
  const finalPr = pullRequest(repository, initial.number, commandRunner);
  if (!samePullRequestIdentity(current, finalPr) || hasHitl(finalPr.labels)) return null;
  return currentCandidate;
}

function logFailure(logger: Logger, repository: string, number: number, error: unknown): void {
  logger(`Stopped on ${repository} PR #${number}: ${error instanceof Error ? error.message : String(error)}`);
}

function reconcileRepository(repository: string, config: WatcherConfig, environment: NodeJS.ProcessEnv, state: NotificationState, commandRunner: CommandRunner, logger: Logger): void {
  let prs: PullRequest[];
  try {
    prs = pullRequests(repository, commandRunner);
  } catch (error) {
    logger(`Stopped on ${repository}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const openPrefixes = prs.map((pr) => `${repository}#${pr.number}:`);
  state.notified = state.notified.filter((key) => !key.startsWith(`${repository}#`) || openPrefixes.some((prefix) => key.startsWith(prefix)));
  for (const pr of prs) {
    try {
      const candidate = actionableCandidate(repository, pr, config, environment, commandRunner);
      if (!candidate || state.notified.includes(candidate.key)) continue;
      state.notified.push(candidate.key);
      writeNotificationState(statePath(environment), state);
      try {
        if (!pluginIsEnabled(environment, commandRunner)) throw new Error("Herdr watcher plugin is disabled or unavailable");
        sendNotification(candidate, environment, commandRunner);
      } catch (error) {
        state.notified = state.notified.filter((key) => key !== candidate.key);
        writeNotificationState(statePath(environment), state);
        throw error;
      }
    } catch (error) {
      logFailure(logger, repository, pr.number, error);
    }
  }
}

function githubRepositoryFromRemote(remote: string): string | null {
  const match = remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)(?:\.git)?\/?$/i);
  return match?.[1].toLowerCase() ?? null;
}

function watchedRepositories(snapshot: HerdrSnapshot, config: WatcherConfig, commandRunner: CommandRunner): { repository: string; repositoryRoots: string[] }[] {
  return config.repositories.flatMap((repository) => {
    const expectedRepoName = repository.split("/").at(-1)?.toLowerCase();
    const repositoryRoots = snapshot.workspaces.flatMap((workspace) => {
      const worktree = workspace.worktree;
      if (!worktree || typeof worktree.repo_root !== "string" || typeof worktree.repo_name !== "string" ||
        worktree.repo_name.toLowerCase() !== expectedRepoName) return [];
      const result = commandRunner("git", ["-C", worktree.repo_root, "remote", "get-url", "origin"]);
      if (result.status !== 0 || githubRepositoryFromRemote(result.stdout.trim()) !== repository.toLowerCase()) return [];
      return [worktree.repo_root];
    });
    const uniqueRoots = [...new Set(repositoryRoots)];
    if (uniqueRoots.length > 1) throw new Error(`Ambiguous Herdr repositories for watched repository ${repository}`);
    return uniqueRoots.length ? [{ repository, repositoryRoots: uniqueRoots }] : [];
  });
}

function parseSnapshot(output: string): HerdrSnapshot {
  const response = parseJson<{ result?: { type?: string; snapshot?: HerdrSnapshot } }>(output, "Herdr session snapshot");
  const snapshot = response.result?.snapshot;
  if (response.result?.type !== "session_snapshot" || !snapshot || snapshot.protocol !== HERDR_PROTOCOL ||
    !Array.isArray(snapshot.workspaces) || !Array.isArray(snapshot.panes) || !Array.isArray(snapshot.agents)) {
    throw new Error("Herdr returned an unsupported or incomplete session snapshot");
  }
  return snapshot;
}

async function readHerdrSnapshot(environment: NodeJS.ProcessEnv, commandRunner: CommandRunner): Promise<HerdrSnapshot> {
  const result = commandRunner(environment.HERDR_BIN_PATH ?? "herdr", ["api", "snapshot"]);
  if (result.status !== 0) throw new Error(result.stderr.trim() || "Herdr session is unavailable");
  return parseSnapshot(result.stdout);
}

async function reconcile(environment: NodeJS.ProcessEnv, dependencies: WatcherDependencies = {}): Promise<void> {
  const config = configuredRepositories(environment);
  if (!config.reviewer_logins.length) throw new Error("Reviewer allowlist is empty");
  if (environment.HERDR_ENV !== "1") throw new Error("Watcher must run from an active Herdr plugin context");
  const commandRunner = dependencies.commandRunner ?? runCommand;
  const logger = dependencies.logger ?? console.error;
  const snapshot = await (dependencies.snapshot ?? (() => readHerdrSnapshot(environment, commandRunner)))();
  if (snapshot.protocol !== HERDR_PROTOCOL || !Array.isArray(snapshot.workspaces) || !Array.isArray(snapshot.panes) || !Array.isArray(snapshot.agents)) {
    throw new Error("Herdr snapshot is unsupported or incomplete");
  }
  if (!pluginIsEnabled(environment, commandRunner)) throw new Error("Herdr watcher plugin is disabled or unavailable");
  const path = statePath(environment);
  const result = withStateLock(path, () => {
    const state = readNotificationState(path);
    const watched = watchedRepositories(snapshot, config, commandRunner);
    for (const entry of watched) reconcileRepository(entry.repository, config, environment, state, commandRunner, logger);
    writeNotificationState(path, state);
  });
  if (result === null) logger("Skipped reconciliation because another watcher owns the state lock");
}

async function waitForHerdrEvent(socketPath: string, timeoutMs: number): Promise<HerdrEvent | null> {
  return await new Promise((accept, reject) => {
    let buffer = "";
    let connection: Awaited<ReturnType<typeof Bun.connect>> | null = null;
    let subscribed = false;
    let settled = false;
    const finish = (error?: Error, event: HerdrEvent | null = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      connection?.end();
      if (error) reject(error);
      else accept(event);
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    Bun.connect({
      unix: socketPath,
      socket: {
        data(_socket, data) {
          buffer += new TextDecoder().decode(data);
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const value = parseJson<{ id?: string; event?: string; data?: { type?: string }; error?: { code?: string; message?: string } }>(line, "Herdr event stream");
            if (value.id === "tracer-watcher:subscribe") {
              if (value.error) finish(new Error(`Herdr subscription failed: ${value.error.message ?? value.error.code ?? "unknown error"}`));
              else subscribed = true;
              continue;
            }
            if (!subscribed) continue;
            if (value.error?.code === "events_lost") finish();
            else finish(undefined, { event: value.event, data: value.data });
            return;
          }
        },
        open(socket) {
          socket.write(`${JSON.stringify({
            id: "tracer-watcher:subscribe",
            method: "events.subscribe",
            params: { subscriptions: ["workspace.created", "workspace.closed", "worktree.created", "worktree.opened", "worktree.removed"].map((type) => ({ type })) },
          })}\n`);
        },
        error(_socket, error) {
          finish(new Error(`Herdr event stream failed: ${error.message}`));
        },
        close() {
          finish();
        },
      },
    }).then((socket) => { connection = socket; }).catch((error) => finish(new Error(`Herdr event stream failed: ${String(error)}`)));
  });
}

async function watch(environment: NodeJS.ProcessEnv, dependencies: WatcherDependencies = {}): Promise<void> {
  const config = configuredRepositories(environment);
  if (environment.HERDR_ENV !== "1") throw new Error("Watcher must run from an active Herdr plugin context");
  const commandRunner = dependencies.commandRunner ?? runCommand;
  const logger = dependencies.logger ?? console.error;
  const pause = dependencies.pause ?? ((milliseconds) => new Promise((accept) => setTimeout(accept, milliseconds)));
  const enabled = dependencies.pluginEnabled ?? (() => pluginIsEnabled(environment, commandRunner));
  const wait = dependencies.waitForEvent ?? ((timeoutMs) => waitForHerdrEvent(environment.HERDR_SOCKET_PATH as string, timeoutMs));
  const interval = config.refresh_interval_seconds * 1000;
  while (environment.HERDR_ENV === "1" && enabled()) {
    try {
      await reconcile(environment, { ...dependencies, commandRunner, logger });
      if (environment.HERDR_ENV !== "1" || !enabled()) return;
      await wait(interval);
    } catch (error) {
      logger(`Herdr watcher reconnecting after error: ${error instanceof Error ? error.message : String(error)}`);
      if (environment.HERDR_ENV !== "1" || !enabled()) return;
      try {
        await readHerdrSnapshot(environment, commandRunner);
      } catch {
        return;
      }
      await pause(Math.min(interval, 10_000));
    }
  }
}

async function runWatcher(argv: string[], environment: NodeJS.ProcessEnv, dependencies: WatcherDependencies = {}): Promise<void> {
  if (argv.includes("--check")) {
    configuredRepositories(environment);
    return;
  }
  if (argv.includes("--once")) {
    await reconcile(environment, dependencies);
    return;
  }
  await watch(environment, dependencies);
}

if (import.meta.main) {
  runWatcher(process.argv.slice(2), process.env).catch((error) => {
    console.error(`Tracer Herdr watcher stopped: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

export {
  actionableCandidate,
  configuredRepositories,
  correctiveReviewHistory,
  governingIssueIsHitl,
  hasHitl,
  loadConfig,
  notificationCandidate,
  parseSnapshot,
  parseToml,
  pluginIsEnabled,
  pullRequestDecision,
  readHerdrSnapshot,
  readNotificationState,
  reconcile,
  watchedRepositories,
  runWatcher,
  validateConfig,
  watch,
  writeNotificationState,
  type CommandResult,
  type CommandRunner,
  type NotificationCandidate,
  type NotificationState,
  type WatcherConfig,
  type WatcherDependencies,
};
