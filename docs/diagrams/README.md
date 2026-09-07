# Reader-facing workflow diagrams

These SVGs are the editable source as well as the GitHub-rendered assets. They are
hand-authored intentionally: there is no generation step, JavaScript runtime,
external font, or package dependency.

The figures follow a small editorial rule set inspired by `diagram-design`:

- one teaching claim per figure;
- low node density;
- restrained emphasis, using teal for the durable/current focus and orange only
  for the stale-verdict state;
- orthogonal connectors rather than diagonal routing;
- system fonts and inline SVG styles only;
- `<title>` and `<desc>` metadata in each SVG, with equivalent meaning preserved
  in README alt text and nearby prose.

When workflow semantics change, update the authoritative contract first
(`WORKFLOW.md` or the review-gate verdict contract), then update these explanatory
figures. The diagrams must not become an independent policy source.
