# models/evals/battle/work28/w17-why-daily-gap/ — Folder for work item analyzing why daily market gaps occur

Every folder under models/evals/battle/work28/w17-why-daily-gap/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/battle/work28/w17-why-daily-gap/ — Folder for work item analyzing why daily market gaps occur
  - models/evals/battle/work28/w17-why-daily-gap/check.sh (5) — Script verifying the answer mentions market closure and the findGaps function
  - also: meta.json, task.txt
- models/evals/battle/work28/w17-why-daily-gap/project/ — Script to analyze daily trading gaps for futures contracts
  - models/evals/battle/work28/w17-why-daily-gap/project/config.mjs (7) — Sets the trading session hours and lists the NQ and ES contracts
  - models/evals/battle/work28/w17-why-daily-gap/project/gaps.mjs (13) — Calculates missing minutes between saved bar timestamps ✓
  - models/evals/battle/work28/w17-why-daily-gap/project/report.mjs (11) — Prints missing time intervals for a specific contract and date
  - also: package.json
- models/evals/battle/work28/w17-why-daily-gap/project/data/ — Directory storing daily saved bar time data for contracts
  - models/evals/battle/work28/w17-why-daily-gap/project/data/README.md (2) — Explains the JSON format for saving contract bar times by day
- models/evals/battle/work28/w17-why-daily-gap/solution/ — Solution folder for daily gap analysis work
  - also: answer.txt
