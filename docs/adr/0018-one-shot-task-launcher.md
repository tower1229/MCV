# ADR 0018: Bare MCV Opens a One-Shot Task Launcher

Status: Accepted

## Decision

In an interactive capable terminal, bare `mcv` opens a full-screen, one-shot task launcher. Non-TTY output, redirected streams, `TERM=dumb`, explicit ASCII locales, and terminals smaller than `60×18` keep the safe one-shot report: a valid binding receives Overview, while an absent or invalid binding receives Repository Report. `mcv status`, help, version, JSON, MCP, and every explicit subcommand never enter the launcher.

The launcher owns only a read-only `MenuSnapshot`, navigation state, task intent, and the minimum task parameters. It must not own or retain an Operation Plan, Change, Issue, authorization, Apply state, or Result. After selection it restores the terminal and returns a typed `MenuAction`; the root command adapter then invokes the existing Command/Operation path. The selected task exits when it succeeds, fails, is cancelled, or is interrupted. There is no persistent global Shell and no return to the launcher.

Repository lifecycle actions may use an internal interactive Command mode: the command creates and displays one Plan, asks for terminal confirmation, and applies that same in-process Plan. The launcher never synthesizes `--yes`. Deploy and Restore selection only supplies Scope, Profiles, and an optional project target; every write remains behind the existing Apply seam.

Five situations determine ordering and focus: `unbound`, `blocked`, `pending`, `bound`, and `stable`. The default tasks are respectively Create Repository, Inspect System, Deploy Environment, Capture Local Configuration, and Inspect System. Project Deploy starts without a selected Profile; Global Deploy preselects the built-in `global` Profile.

The long-lived test seams are the pure menu state model and the packaged `dist/index.js` process under real PTY/ConPTY. Tests assert routing, exit code, terminal restoration, and filesystem effects. Large view snapshots and private call-order mocks are not product contracts.

This ADR supersedes only the bare-command and default alternate-screen clauses in ADR 0014 and ADR 0015. Their decisions about the removed multi-business Shell, dedicated Profile/Capture TUIs, MCP, and Plan/Apply safety remain in force.

## Consequences

- A capable interactive user gets a low-learning-cost cockpit without weakening CLI automation.
- The menu may fail safely to a report and must never create a Review Artifact.
- Operation progress is optional typed stage data; only an interactive human terminal adapter renders it to stderr.
- `Esc`/`q` exits normally, Ctrl+C returns 130, and every exit restores alternate screen, cursor, and terminal input mode.
