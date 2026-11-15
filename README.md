# Worklog

**Automatic time and token tracking for Claude Code, per project.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Worklog is a mod for Claude Code. It counts the time and the tokens you spend on each project. You do not start or stop a timer.

![Worklog above the prompt](docs/screenshots/desktop.png)

## Features

- **No timer.** Worklog counts while you work with Claude.
- **Per project.** Each session counts for its project. You can give a session another name at any time.
- **Ticket IDs.** When a message or a Git branch contains a ticket ID, such as `PROJ-142`, the session counts for that ticket.
- **Time and tokens.** By day, week, month or year, or since you started.
- **Activity heatmap.** Your whole year at a glance.
- **Parallel sessions.** Each session counts. Two sessions on the same project are merged.
- **Past work included.** Worklog reads your Claude Code history, so your past days show from the start.
- **Desktop app and terminal.** Four themes. English and French.

## Install

```sh
claude plugin marketplace add Abdoul-sudo/worklog
claude plugin install worklog@worklog
```

Then restart Claude Code, or run `/reload-plugins`.

Worklog needs Claude Code 2.1.290 or later. Node.js is optional: Worklog uses it to read your past history.

Worklog is also part of [Claude Modpack](https://github.com/Abdoul-sudo/claude-modpack).

## Use

At the bottom of Claude Code, a small chip shows the current project and its time today, for example `⏱ mobile-app · 1h 12`. Click the chip to show or hide Worklog.

In Worklog:

- Click **Day**, **Week**, **Month**, **Year** or **All** to change the period. Click **‹** or **›** to move in time.
- Click **⇄** next to a name to count this session for it. In the terminal, click the name.
- Click **+ Add item** to count this session for a new name.
- Click **✎** next to the name of this session to rename it.
- Click the gear to open the settings.

### Commands

| Command | What it does |
| --- | --- |
| `/worklog` | Shows or hides Worklog. |
| `/worklog <name>` | Counts this session for `<name>`. For example: `/worklog PROJ-142`. |
| `/worklog stop` | Pauses this session until your next message. |

## Settings

Open Worklog, then click the gear.

![Worklog settings](docs/screenshots/settings.png)

| Setting | Default |
| --- | --- |
| Show the activity heatmap | On |
| Ask after a long idle time | On |
| Show | Time and tokens |
| Language | English |
| Theme | Night |
| Idle time counted as work | 45 min |

## How time is counted

- Time counts while you send messages and while Claude works, subagents included.
- A pause shorter than 45 minutes counts. You can change this limit in the settings.
- After a longer pause, Worklog asks if it was work. Click **Count** to add it.
- When two sessions run at the same time, both count.

## Privacy

Worklog keeps its data on your computer, in `~/.claude/worklog/`. It does not keep your messages. It sends nothing over the network.

To keep the data in another folder, set the environment variable `WORKLOG_DATA_DIR`.

## Limitations

- Worklog only sees your work in Claude Code. Meetings and calls do not count.
- In the terminal, clicks work only in fullscreen mode (`/tui fullscreen`).

## License

[MIT](LICENSE)
