# Issue standard

Issues should describe one independently mergeable change. Include enough durable
context for execution without relying on chat history.

## Context

Explain the current behavior or project state and why this change is needed.

## Settled facts

List verified facts the executing agent should treat as settled. Include a source
for every fact, such as a repository path and relevant symbol/section, a GitHub
issue/PR/comment URL, or an external source URL. The executing agent must not
re-verify these facts unless repository evidence contradicts them. Leave the
section empty or write `None recorded` when there are no settled facts.

## Goal

Describe the observable result this issue should achieve.

## Scope

List included behavior and constraints. Keep the work to one PR when possible.

## Stop conditions

Name conditions that require stopping before implementation or require human
decision.

## Out of scope

List adjacent work that this issue does not authorize.

## Acceptance criteria

Use independently testable observable outcomes, one criterion per bullet.

## Dependencies

List prerequisite issues or contracts and the exact relationship to this work.

## Related

List related issues without implying they are blockers.
