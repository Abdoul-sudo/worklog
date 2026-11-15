# Worklog

**See how much time and how many tokens each project takes. No timer to start.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Worklog is a mod for Claude Code. It records your working time and your tokens automatically, for each project and each day.

![Worklog above the prompt](docs/screenshots/desktop.png)

## Features

- **Automatic time tracking.** The time counts while Claude works. Your pauses count when you come back.
- **Token count** for each project, subagents and Ultracode included.
- **Totals** for the day, the week, the month, the year, or since the start.
- **Activity heatmap** with one square for each day of the year.
- **Automatic names.** A ticket ID in your messages or in your Git branch names the session.
- **Four themes** and **two languages**: English and French.
- **Desktop app and terminal.**
- **Local data.** Nothing leaves your computer.

## Requirements

- Claude Code 2.1.325 or later. Worklog is tested with this version.
- Node.js, optional. Worklog uses it once, to read your past Claude Code history.

## Quick start

1. Install Worklog:

   ```sh
   claude plugin marketplace add Abdoul-sudo/worklog
   claude plugin install worklog@worklog
   ```

2. Restart Claude Code.
3. Work as usual. A chip at the bottom shows the name of the session and its time today: `⏱ mobile-app · 1h 12`.
4. Click the chip to open Worklog. Click it again to close it.

## How it works

### When the timer runs

- The timer starts with your first message in a session. Opening a session does not count.
- The timer runs while Claude works. This includes subagents, workflows and Ultracode, even when they work alone for hours.
- When Claude is done, the timer waits for you.

### Pauses

A pause is the time between the end of Claude's work and your next message. You read, you test, or you leave. Worklog looks at the pause when you come back:

- **Shorter than 1 hour:** the pause counts as work. Worklog adds it to the total.
- **From 1 to 4 hours:** Worklog asks if this pause was work. Click **Count** to add it, or **Ignore** to leave it out.
- **Longer than 4 hours**, for example a night: the pause does not count, and Worklog does not ask.

If you quit Claude Code or close its window, the pause until then counts if it is shorter than 1 hour.

You can change the 1 hour and the 4 hours in the settings.

### What Worklog counts

- **Time** for each name, each day.
- **Tokens** for each name: all the tokens that Claude and its subagents use, cache reads included.
- **Parallel sessions.** When two sessions work at the same time, both count. The total of the day can then be more than the clock time. Worklog shows how much of it was in parallel.

### How Worklog names a session

Each session counts for one name. Worklog uses the first name that it finds in this list:

1. A name that you give, with `/worklog <name>` or in the Worklog list.
2. A ticket ID in your messages, such as `PROJ-142`.
3. A ticket ID in the name of your Git branch, such as `feature/PROJ-142-login`.
4. The name of the session group in the desktop app.
5. The name of the project folder.

When Worklog finds the first ticket ID of a session, the time before it also goes to this ticket.

## Usage

### In Worklog

| Task | Action |
| --- | --- |
| See another period | Click **Day**, **Week**, **Month**, **Year** or **All**. Click **‹** or **›** to go back or forward. |
| Count this session for another name | Point to the name in the list, then click **⇄**. In the terminal, click the name. |
| Count this session for a new name | Click **+ Add item**, type the name, then press Enter. |
| Rename the name of this session | Click **✎** next to it. The new name also replaces the old one on past days. |
| Open the settings | Click the gear. In the terminal, click **≡**. |

### Commands

| Command | Description |
| --- | --- |
| `/worklog` | Shows or hides Worklog. |
| `/worklog <name>` | Counts this session for `<name>`. For example: `/worklog PROJ-142`. |

## Settings

Open Worklog, then click the gear.

![Worklog settings](docs/screenshots/settings.png)

| Setting | Default | Description |
| --- | --- | --- |
| Show the activity heatmap | On | Shows one square for each day of the year. |
| Show | Time and tokens | Shows the time, the tokens, or both. |
| Language | English | English or French. |
| Theme | Night | Simple, Night, Aurora or Ember. Desktop app only. |
| Pauses › Count up to | 1h | A shorter pause counts as work. |
| Pauses › Ask up to | 4h | For a longer pause, Worklog asks if it was work. A pause longer than this does not count. |

## Update

```sh
claude plugin marketplace update worklog
claude plugin update worklog@worklog
```

Then restart Claude Code, or type `/reload-plugins`.

## Uninstall

```sh
claude plugin uninstall worklog@worklog
```

Your data stays in `~/.claude/worklog/`. To remove it, delete this folder.

## FAQ

**Do subagents and Ultracode count?**
Yes. The timer runs while they work, even when you do not type. Their tokens count too.

**Do I need to stop the timer when I leave?**
No. The timer runs only while Claude works. Worklog looks at your pause when you come back.

**Does Worklog see my past work?**
Yes, if Node.js is installed. On the first start, Worklog reads your Claude Code history. Without Node.js, Worklog counts from the day you install it.

**Can I use Worklog in the terminal?**
Yes. To click in Worklog, use the fullscreen mode: `/tui fullscreen`.

## Privacy

Worklog keeps its data on your computer, in `~/.claude/worklog/`. It does not keep your messages. It sends nothing over the network.

To keep the data in another folder, set the environment variable `WORKLOG_DATA_DIR`.

## Limitations

Worklog sees only your work in Claude Code. Meetings, calls and work in other tools do not count.

## License

[MIT](LICENSE)
