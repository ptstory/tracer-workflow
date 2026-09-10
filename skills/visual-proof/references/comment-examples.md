# visual-proof comment examples

## Provided — standalone component

```visual-proof
## visual-proof: provided

head-sha: 0123456789abcdef0123456789abcdef01234567
surface: Storybook / ActivityCard / populated state
claim: Standalone ActivityCard renders the populated and long-title states; production integration is not part of this PR.

![ActivityCard populated state](https://github.com/user-attachments/assets/example-activity-card)
```

## Provided — interaction

```visual-proof
## visual-proof: provided

head-sha: 89abcdef0123456789abcdef0123456789abcdef
surface: /settings/profile / avatar editor
claim: The current implementation opens, crops, saves, and returns to the updated profile state.

https://github.com/user-attachments/assets/example-avatar-flow.webm
```

## N/A — no reasonable render path yet

```visual-proof
## visual-proof: n/a

head-sha: fedcba9876543210fedcba9876543210fedcba98
surface: n/a
claim: This PR defines the component API and markup only; wiring into a renderable surface is tracked separately and adding a route here would exceed the issue scope.

No current render surface exists without implementing the later integration slice.
```

## N/A — non-visual work

```visual-proof
## visual-proof: n/a

head-sha: 00112233445566778899aabbccddeeff00112233
surface: n/a
claim: This PR changes review-policy parsing and documentation only; it has no visual runtime surface.

No screenshot is applicable.
```
