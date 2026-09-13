# Privacy Policy template for Review Gate

> This template is only relevant if you later share/publish a GPT with Actions and a privacy-policy URL is required. Customize and host it before publication. Do not publish this unchanged as legal advice.

## Data processed

The Review Gate action sends requests to GitHub's API for repositories and pull requests explicitly requested by the user. Depending on repository visibility and token permissions, this can include pull-request metadata, issue/spec text, changed-file patches, repository file contents, review comments, check/status results, and the final Review Record comment.

## Purpose

Data is processed only to perform software-engineering review and, when requested, publish the resulting SHA-pinned Review Record to the target pull request.

## Authentication

GitHub authentication is handled using credentials configured for the GPT Action. Credentials should be restricted to the minimum repositories and permissions required.

## Mutations

The intended API surface permits only one GitHub write operation: creating a normal issue/pull-request timeline comment. It does not expose merge, push, branch/ref, label, workflow-dispatch, or repository-file mutation operations.

## Retention

Specify the retention behavior of any infrastructure you operate. If the GPT Action connects directly to GitHub without an intermediary service you control, state that accurately rather than claiming independent server-side retention.

## Third parties

GitHub receives API requests under its own terms and privacy practices. OpenAI processes GPT conversations and Action invocations under the applicable OpenAI terms and privacy controls.

## Contact

Add an appropriate contact method before publishing.
