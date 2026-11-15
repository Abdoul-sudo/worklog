# Worklog

**See how much time and how many tokens each project takes. No timer to start.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Worklog is a mod for Claude Code. It counts your time and your tokens automatically, project by project. You do not need to start or stop a timer.

![Worklog above the prompt](docs/screenshots/desktop.png)

## Quick start

1. Install Worklog:

   ```sh
   claude plugin marketplace add Abdoul-sudo/worklog
   claude plugin install worklog@worklog
   ```

2. Restart Claude Code.
3. Work as usual. A small chip at the bottom shows the project of the session and its time today: `⏱ mobile-app · 1h 12`.
4. Click the chip to open Worklog. Click it again to close it.

That is all. Worklog needs Claude Code 2.1.290 or later.

## How it works

### When the timer runs

- The timer starts with your first message in a session. Opening a session does not count.
- The timer runs while Claude works. This includes subagents, workflows and Ultracode, even when they work alone for hours.
- The timer keeps running while you read or think. A pause shorter than 1 hour counts as work.

### When the timer stops

- **After 1 hour without activity.** When you come back, Worklog asks if this pause was work. Click **Count** to add it, or **Ignore** to leave it out.
- **After 4 hours without activity**, for example a night. This time does not count, and Worklog does not ask.
- **When you type `/worklog stop`.** Use it when Claude is done but the timer still runs, for example when you leave. While Claude works, `/worklog stop` does nothing: the real time and tokens count. The timer resumes with your next message.
- **When you quit Claude Code**, or 2 minutes after you close its window.

You can change the 1 hour in the settings.

### What Worklog counts

- **Time** per project, per day.
- **Tokens** per project: the answers of Claude, the subagents and the cache reads.
- **Parallel sessions.** When two sessions run at the same time, both count. The total of the day can then be more than the real time. Worklog shows the part in parallel.

### The name of a session

Each session counts for one name. Worklog chooses it in this order:

1. The name that you give with `/worklog <name>`, or in the Worklog list.
2. A ticket ID in your messages, such as `PROJ-142`.
3. A ticket ID in the name of your Git branch, such as `feature/PROJ-142-login`.
4. The name of the session group in the desktop app.
5. The name of the project folder.

The first ticket ID of a session also gets the time spent before it.

## What you can do

In Worklog:

| To | Do this |
| --- | --- |
| See another period | Click **Day**, **Week**, **Month**, **Year** or **All**. Click **‹** or **›** to go back or forward. |
| Count this session for another name | Point to the name in the list, then click **⇄**. In the terminal, click the name. |
| Count this session for a new name | Click **+ Add item**, type the name, then press Enter. |
| Rename the current name | Click **✎** next to it. The new name also replaces the old one on past days. |
| Change the settings | Click the gear. |

With commands:

| Command | What it does |
| --- | --- |
| `/worklog` | Shows or hides Worklog. |
| `/worklog <name>` | Counts this session for `<name>`. For example: `/worklog PROJ-142`. |
| `/worklog stop` | Stops the timer of this session until your next message. It does nothing while Claude works. |

## Settings

Open Worklog, then click the gear.

![Worklog settings](docs/screenshots/settings.png)

| Setting | Default | What it does |
| --- | --- | --- |
| Show the activity heatmap | On | Shows one square per day of the year. |
| Show | Time and tokens | Shows the time, the tokens, or both. |
| Language | English | English or French. |
| Theme | Night | Simple, Night, Aurora or Ember. Desktop app only. |
| Ask after a pause of | 1h | A shorter pause counts as work. After a longer pause, Worklog asks if it was work. |

## Questions

**Do subagents and Ultracode count?**
Yes. The timer runs while they work, even when you do not type. Their tokens count too.

**What if I forget to stop the timer?**
Nothing to do. The timer stops by itself after 1 hour without activity.

**Does Worklog see my past work?**
Yes. On the first start, Worklog reads your Claude Code history. For this, it needs Node.js. Without Node.js, Worklog counts from the day you install it.

**Can I use it in the terminal?**
Yes. In the terminal, clicks work in fullscreen mode (`/tui fullscreen`).

## Privacy

Worklog keeps its data on your computer, in `~/.claude/worklog/`. It does not keep your messages. It sends nothing over the network.

To keep the data in another folder, set the environment variable `WORKLOG_DATA_DIR`.

## Limitations

Worklog only sees your work in Claude Code. Meetings, calls and work in other tools do not count.

## License

[MIT](LICENSE)
