# Architecture Decision Records

One ADR per concern, each stating the current decisions. `docs/architecture.md` remains the spec for
entities and interfaces; ADRs record the decisions and the reasons. Keep an ADR a decision record:
target 250 lines, hard cap 320 (enforced by `nub run docs:check`). Move interface and implementation
detail to `docs/architecture.md`.

## Numbering and references

- **Current ADRs are 0001 to 0018 plus any new ADR from 0037.** Numbers 0001 to 0018 are permanent; do not renumber them.
- **Archived ADRs are 0001 to 0036**, kept unchanged in [`archive/`](./archive/) under their original
  numbers and file names because code comments, issues and pull requests refer to them.
- **New ADRs start at 0037.** Never reuse a number from either range.
- A bare `ADR NNNN` means a **current** ADR. Refer to an archived decision as
  `archived ADR NNNN` (or link its file under `archive/`).
- `nub run docs:check` validates numbering, references, links and the line cap. Do not edit files in
  `archive/`.

Each current ADR below lists the archived ones it supersedes.

| ADR  | Title                                                    | Supersedes (archived)              |
| ---- | -------------------------------------------------------- | ---------------------------------- |
| 0001 | Architecture and Conventions                             | 0001, 0005, 0007, 0016, 0018, 0019 |
| 0002 | Database                                                 | 0002                               |
| 0003 | Storage and Content-Addressed Assets                     | 0006, 0020                         |
| 0004 | Capture Pipeline                                         | 0003, 0015, 0017, 0028             |
| 0005 | Capture Performance and Sharding                         | 0031                               |
| 0006 | Testing Option, Hosting-Only Mode and the Database Queue | 0034                               |
| 0007 | Remote Browsers and Public Origin                        | 0033                               |
| 0008 | Image Diff Engines                                       | 0004, 0032                         |
| 0009 | Baselines, Approval and Retention                        | 0009                               |
| 0010 | Projects, Published Storybook and Labels                 | 0011, 0013                         |
| 0011 | Authentication and Access                                | 0008, 0021, 0023, 0030             |
| 0012 | Server-Rendered UI                                       | 0012, 0025                         |
| 0013 | UI Review                                                | 0035                               |
| 0014 | Git Hosts and Notifications                              | 0010, 0024, 0036                   |
| 0015 | Observability and Logging                                | 0014, 0022                         |
| 0016 | AI Insights                                              | 0026                               |
| 0017 | MCP Server                                               | 0027                               |
| 0018 | Design Providers                                         | 0029                               |
| 0037 | Portability and Trust in Visual Results (proposed)       | —                                  |
| 0038 | Environment Migration and Baseline Review               | —                                  |

Work that implements ADRs 0005 to 0007, 0013 and 0014 is tracked in GitHub issues #212 to #236.
