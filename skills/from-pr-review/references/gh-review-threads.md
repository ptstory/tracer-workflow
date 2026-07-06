# Reading & resolving review threads

The gotcha: **REST does not expose review-thread resolution state.** `gh pr view`
and the REST review-comments endpoint give you comments and reviews, but not
whether a *thread* is resolved/unresolved or its thread id. You need GraphQL for
that, and for resolving threads.

## List unresolved threads (GraphQL)

```bash
gh api graphql -f query='
  query($owner:String!, $repo:String!, $pr:Int!) {
    repository(owner:$owner, name:$repo) {
      pullRequest(number:$pr) {
        reviewThreads(first:100) {
          nodes {
            id
            isResolved
            isOutdated
            path
            comments(first:1) { nodes { body author { login } } }
          }
        }
      }
    }
  }' -f owner=OWNER -f repo=REPO -F pr=NUMBER
```

Filter `isResolved == false` for the actionable ledger. Keep the `id` — it's the
thread node id you resolve with.

## Reviews and top-level comments (REST, via gh)

```bash
gh pr view NUMBER --json reviews,comments,headRefOid,headRefName,baseRefName
```

`headRefOid` is the head SHA — capture it before and after your push so you know
which SHA the gate applies to.

## Resolve a thread (GraphQL mutation)

```bash
gh api graphql -f query='
  mutation($threadId:ID!) {
    resolveReviewThread(input:{threadId:$threadId}) {
      thread { id isResolved }
    }
  }' -f threadId=THREAD_NODE_ID
```

Only call this after the corresponding fix is pushed or the verdict is an explicit
deferral. Do not resolve on a defer — leave it open with a reply stating the
reason.

## Reply in a thread

Threaded replies to a specific review comment go through the REST reply endpoint:

```bash
gh api -X POST repos/OWNER/REPO/pulls/NUMBER/comments/COMMENT_ID/replies \
  -f body="Fixed in <sha>. <one line on what changed>."
```

`COMMENT_ID` is the first comment's REST id in the thread (not the GraphQL node
id — they differ). If you only have the GraphQL thread, the first comment's
`databaseId` (add it to the query) is the REST id.
