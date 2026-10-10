# delegation-guard

A Claude Code plugin that reminds the main session to hand reading, searching, research and review to subagents, and shows above the prompt how full the main context is next to how many tokens went to subagents.

## What it does

### Status row above the prompt

The plugin adds one row to the band directly above the prompt input:

```
Hauptkontext 45k (22 %) │ Delegiert: 1 Agent, 210k Tokens │ Selbst diesen Turn: 4/6
```

The labels are currently rendered in German. In English:

| Rendered label | Meaning |
| --- | --- |
| `Hauptkontext <tokens> (<percent> %)` | Main context: tokens in the main conversation's context window and its fill level, the same figures the status line uses. Shows `Hauptkontext –` until the first measurement arrives after a main-thread turn. |
| `Delegiert: <n> Agent(s), <tokens> Tokens` | Delegated: subagents spawned in this session and the tokens they have used. |
| `Selbst diesen Turn: <count>/<limit>` | Self this turn: reading/searching steps the main session has done itself in the current turn, against the reminder threshold. |

The counter is dimmed below the threshold, turns to the warning color one step before it, and to the error color when it is reached.

The row is drawn under whatever the engine and other plugins already put in the band (for example a button another plugin adds), never in place of it. While a survey occupies the band, the row is left out. Its width follows the band's available columns.

### Reminder to the model

This plugin **does influence model behavior.** When the main session has done `threshold` reading/searching steps itself within one turn, the plugin appends the following text to the context of the tool call that reached the threshold, so the model reads it together with that tool result:

> Delegation reminder: you have done N reading/searching steps yourself in this turn. Hand the remaining agent-capable work (reading, searching, research, review) to a subagent with an explicit model, and keep the main session for orchestration and short edits.

When exactly it fires:

- Only for tool calls made by the main session, never for calls made inside a subagent.
- On the counted call where the turn's count reaches the threshold (default 6).
- At most once per turn. A new turn resets both the count and the "already reminded" flag.
- Only while the guard is on (`/delegation on`, the default).

Spawning a subagent from the main session resets the turn's count to 0, but does not re-arm the reminder within the same turn.

## Requirements

- Claude Code with support for plugin hooks modules (the `mods` / function-hooks API). Tested on Claude Code 2.1.295. This API is marked early access and may change between releases.
- A surface that draws the band above the prompt: the terminal or the desktop app. On other surfaces the reminder still works, but no row is shown.

## Installation

The repository is a single-plugin marketplace.

From a terminal:

```
claude plugin marketplace add m-tababi/delegation-guard
claude plugin install delegation-guard@delegation-guard
```

Or from the prompt of an interactive session:

```
/plugin install delegation-guard --marketplace m-tababi/delegation-guard
```

Confirm adding the marketplace with `y`, then choose a scope.

### Local development install

Add a local clone as a folder marketplace and install from it:

```
claude plugin marketplace add /path/to/delegation-guard
claude plugin install delegation-guard@delegation-guard
```

A plugin installed from a folder marketplace is read from that folder, so after editing it `/reload-plugins` picks up the change without a reinstall. Alternatively, `claude --plugin-dir /path/to/delegation-guard` loads the plugin for a single session.

## Configuration

### Plugin option

| Option | Type | Default | Range |
| --- | --- | --- | --- |
| `threshold` | number | `6` | whole numbers 1-50 |

`threshold` is the number of self-done reading/searching steps in one main-session turn that triggers the reminder. It can be set when installing (`claude plugin install ... --config threshold=8`) or later with `claude plugin configure delegation-guard`. A value that is not a whole number from 1 to 50 is ignored and the default of 6 is used.

### `/delegation` command

```
/delegation [status | on | off | threshold <1-50>]
```

- `status` (also the default without arguments) shows whether the guard is on, the active threshold and where it comes from, the steps counted this turn, and the delegated agents and tokens of this session.
- `off` stops both the reminder and the status row; `on` brings them back.
- `threshold <n>` overrides the configured threshold.

The on/off state and a threshold set with `/delegation threshold` are stored and persist across sessions. A stored threshold takes precedence over the plugin option; there is currently no command to remove the override again.

## How counting works

- **Self-done steps.** A tool call counts when it is made by the main session (not by a subagent), was not denied, and is one of `Read`, `Grep`, `Glob`, `Bash`, `WebFetch`, `WebSearch` or `NotebookRead`. An MCP tool (`mcp__...`) counts only when its server reports the call as read-only. Calls that return an error still count.
- **Turn boundaries.** The count resets when the main session starts a new turn, and when the main session spawns a subagent.
- **Delegated agents.** Every subagent spawn counts, including subagents spawned by other subagents. Each agent is counted once per session.
- **Delegated tokens.** For each spawned subagent, the plugin adds input, cache-read, cache-creation and output tokens whenever one of its turns completes. Engine-internal forks (for example compaction) are not counted, because only agents seen at spawn are tracked.
- **Main context.** Taken from the figures the engine reports after each main-session turn, the same ones the status line shows.
- The step count, agents and delegated tokens are per session; they start at zero in each new session.

## Limitations

- Subagent tokens are added only when a subagent's turn completes. A running subagent adds nothing yet, and an interrupted or failed turn reports no usage.
- `Bash` always counts as a reading/searching step, including commands that write.
- Nested spawns count as delegated work just like spawns from the main session.
- The band labels are German; the reminder text and `/delegation` output are English.
- The plugin builds on an early-access API; a Claude Code update may require changes.

## Development

```
claude plugin validate .   # checks manifest, marketplace file, types contract and hooks module
claude plugin test .       # runs tests/*.test.ts(x)
```

File layout:

```
.claude-plugin/
  plugin.json        plugin manifest (name, version, userConfig, types contract)
  marketplace.json   single-plugin marketplace pointing at this repository
hooks/
  hooks.json         names the hooks module
  register.tsx       hooks: counting, reminder, /delegation command, status row
  counting.ts        pure helpers: what counts, threshold parsing, reminder text, token formatting
types/
  index.d.ts         state contract (PluginState) for this plugin
tests/
  counting.test.ts   unit tests for the helpers
  delegation.test.tsx  engine tests for counting, reminder, band and command
tsconfig.json
```

`tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which Claude Code generates (together with the API type declarations) when it loads the plugin from a development folder, for example with `--plugin-dir`. After that, `tsc -p .` type-checks the plugin. The generated folder is not committed.

## License

MIT, see [LICENSE](LICENSE).
