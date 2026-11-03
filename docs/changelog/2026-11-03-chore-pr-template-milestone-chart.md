- **2026-11-03** — **The PR template prompts for the milestone progress chart**, inside "Where this
  sits". AGENTS.md has required it since the rule was written, and the template carried a **Diagram**
  section (pivotal flow / model / schema) and nothing for the chart — two separate obligations, one
  prompt. So the chart depended on remembering, and **four consecutive milestone PRs shipped without
  one** (#323, #325, #326, #327), each caught by the maintainer after the fact rather than by the
  thing an author actually fills in.
  📌 The prompt sits in "Where this sits" on purpose: a PR that fills that section is, by definition,
  one that owes a chart — and a PR that deletes the section for being standalone deletes the prompt
  with it. AGENTS.md now points at the template rather than being the only place the rule lives.
