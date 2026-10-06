# coverage-band

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) that shows your test coverage after every test run Claude makes: a gauge with a mark at your threshold, the change since the last run, and the modules that fall below it.

```
🧪 ━━━━━━━━┃━ 99.3% ↑8.0 · MyApp.WebApi 78.4%
```

- The line is green up to your coverage (red when the total is below the threshold); the yellow `┃` marks the threshold.
- `↑8.0` / `↓1.2`: points gained or lost since the previous run in that folder.
- Modules below the threshold follow in yellow, and a toast lists how many there are.
- `/coverage` opens a pane with every module and its bar.

## What it reads

It reacts to Bash commands that run tests (`dotnet test`, `npm test`, `pnpm test`, `yarn test`, `jest`, `vitest`, `pytest`), then picks up the reports that command wrote:

- **Cobertura XML** (`coverage.cobertura.xml`, `coverage.xml`, `cobertura-coverage.xml`): .NET (coverlet), coverage.py, Jest. Several reports from one run (one per .NET test project) are merged line by line, so a line covered by any test project counts once, like ReportGenerator does.
- **lcov** (`lcov.info`): Vitest, Jest, c8. Modules are folders.

Only reports written during that command count; `node_modules`, `bin`, `obj`, `.git` and `.venv` are skipped. A failing coverage read never affects the test command itself.

## Install

Requires Claude Code 2.1.287 or later, on macOS or Linux (it uses `find`).

```
/plugin marketplace add santtisosa/coverage-band
/plugin install coverage-band@coverage-band
```

## Settings (`/config`)

| Setting | Default | |
|---|---|---|
| Placement | `hint` | `hint`: at the end of the hint line under the prompt. `band`: a row above the prompt. `status`: a pinned notice under the prompt. |
| Threshold | `80` | Minimum line coverage, in percent. |
| Gauge width | `10` | Cells in the gauge. |

## Develop

```
claude plugin validate .
claude plugin test .
```

`hooks/coverage.ts` holds the parsers, the merge and the gauge; `hooks/register.tsx` wires them to Claude Code.

## License

MIT
