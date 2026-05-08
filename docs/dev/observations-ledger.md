# Observations Ledger

<!--
Schema:
  ts                 ISO-8601 timestamp
  task_id            task-id of the cycle that logged this row
  file               relative path
  line               line number (or empty for file-level)
  observation        concise description
  in_user_path       always `false` for ledger rows
  security_relevant  bool
-->

| ts | task_id | file | line | observation | in_user_path | security_relevant |
|----|---------|------|------|-------------|--------------|-------------------|
| 2026-05-07T05:56:11Z | 20260507-055611 | docs/dev/specs/spec-20260506-203755.md | 29 | Mermaid scaling/failure-label work is outside the selected inline Markdown/table-cell slice; keep for a later MermaidRenderer cycle. | false | false |
| 2026-05-07T05:56:11Z | 20260507-055611 | docs/dev/specs/spec-20260506-203755.md | 44 | Mobile sibling overflow after super-wide tables is a layout/flex-chain issue, not the current inline parser/rendering slice. | false | false |
| 2026-05-07T05:56:11Z | 20260507-055611 | docs/dev/specs/spec-20260506-203755.md | 37 | Context-capacity denominator/manual switch UI is a separate AgentInput/modelModeOptions product slice. | false | false |
| 2026-05-07T05:56:11Z | 20260507-055611 | docs/dev/specs/spec-20260506-203755.md | 50 | Skill/Command/MCP/zero-arg tool-card visual mapping is a separate ToolView dispatch slice. | false | false |
| 2026-05-07T05:56:11Z | 20260507-055611 | docs/dev/specs/spec-20260506-203755.md | 59 | mhchem and broad HTML-inline support are outside this P0 inline Markdown regression slice. | false | false |
| 2026-05-07T06:37:57Z | 20260507-055611 | docs/dev/specs/spec-20260506-203755.md | 23 | P0 same-subsystem #10 reference links are deferred: same parser package but not required to satisfy the selected #5/#5b/#12 leak/table slice; schedule a separate parser cycle to avoid mixing delimiter repair with reference-definition state. | false | false |
| 2026-05-07T06:37:57Z | 20260507-055611 | docs/dev/specs/spec-20260506-203755.md | 24 | P0 same-subsystem #11 footnotes are deferred: require block/reference collection and renderer UI decisions outside this cycle's inline span/table-cell path. | false | false |
| 2026-05-07T06:37:57Z | 20260507-055611 | docs/dev/specs/spec-20260506-203755.md | 26 | P0 same-subsystem #13 nested ordered-list repair is deferred: list block structure/indentation is separate from the selected inline span/table-cell data-flow fix. | false | false |
