<h1 align="center">Worklog</h1>

<p align="center">
  <em>Automatically track the time, tokens and API price of each project in Claude Code, with a yearly activity heatmap and 8 themes to choose from.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude%20Code-mod-0F766E?style=flat-square&labelColor=334155&logo=claude&logoColor=white" alt="Claude Code mod">
  <img src="https://img.shields.io/badge/license-MIT-0F766E?style=flat-square&labelColor=334155" alt="MIT license">
  <img src="https://img.shields.io/badge/runs%20in-desktop%20%2B%20terminal-0F766E?style=flat-square&labelColor=334155" alt="Runs in the desktop app and the terminal">
</p>

<p align="center">
  <img src="docs/screenshots/desktop.gif" width="880" alt="Worklog above the Claude Code prompt box: the time, the tokens and the streak, a heatmap of the year, and the time of each name. The pointer points to Tokens, and a box shows the tokens of each type and each model. Then it clicks Month and All. In the settings, it picks the Sakura theme and sets Show to Tokens and price. It clicks Day and points to the API price: the box now shows the price of each line. It clicks All, then goes back to the Aurora theme and to Time and tokens.">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-the-timer-works">How the timer works</a> ·
  <a href="#tokens-and-price">Tokens and price</a> ·
  <a href="#breaks">Breaks</a> ·
  <a href="#project-names">Project names</a> ·
  <a href="#themes">Themes</a> ·
  <a href="#in-the-terminal">Terminal</a> ·
  <a href="#settings">Settings</a> ·
  <a href="#faq">FAQ</a> ·
  <a href="#privacy-and-access">Privacy</a>
</p>

---

You work with Claude on several projects, sometimes for hours without a break. Where did the time go? Which project used the most tokens? How much would they cost on the API?

With Worklog, you can see the time, the tokens and the API price of each project, right above the prompt. Worklog tracks everything automatically for you.

## Quick start

```sh
claude plugin marketplace add Abdoul-sudo/worklog
claude plugin install worklog@worklog
```

Restart Claude Code, then work as usual. A chip at the bottom shows the name of the session and its time today, for example `⏱ mobile-app · 1h 12`. Click the chip to open Worklog, or type `/worklog`.

Worklog needs Claude Code 2.1.325 or later. Node.js is optional: Worklog uses it once, to read your past history.

## How the timer works

- The timer starts with your first message in a session. Opening a session does not count.
- The timer runs while Claude works: answers, subagents, workflows, Ultracode and background commands, even when they work alone for hours.
- When Claude is done, a break starts. When you come back, Worklog decides if the break counts as work.
- While Claude waits for a background command to end, the time counts as work. If you come back before it ends, such as with a dev server that never stops, the wait is a break.
- In one project: if several things work at the same time, the time counts only once. For example, if 3 subagents work for 10 minutes, the project gets 10 minutes, not 30.
- Across projects: if two projects work at the same time, each project gets its time, and the total adds them up. Worklog shows the overlap apart, such as "incl. 1h 00 in parallel".

## Tokens and price

Do you look at your tokens more than at your time? Set **Show** to **Tokens and price** in the settings. The API price then takes the place of the time: in the stats, in each line and in the heatmap.

<p align="center">
  <img src="docs/screenshots/price.png" width="880" alt="Worklog with Show set to Tokens and price: 21.5M tokens and $23 today, and the tokens and the price of each name.">
</p>

- The price is what your tokens cost at the Anthropic API list prices, for each model and each answer.
- Worklog always counts the price, also when it shows the time. So when you switch, your past days have their price too.
- With a Pro or Max plan, the API price is not your bill. It shows what your work would cost on the API.

### Token details

Point to **Tokens**, **API price** or the tokens of a name. A box shows where your tokens went:

- On the left, each type of token: input, output, cache write and cache read.
- On the right, each model, such as Opus or Sonnet.

With **Tokens and price**, each line also shows its API price. The detail is in the desktop app and VS Code.

<p align="center">
  <img src="docs/screenshots/details.png" width="880" alt="Worklog with Show set to Tokens and price. Under the API price of today, 21 dollars, a box is open. On the left: input 46.1k tokens for 14 cents, output 413k for 6.37 dollars, cache write 1.7M for 11 dollars, cache read 20.1M for 3.12 dollars. On the right: Opus 5.5, 12.4M tokens for 15 dollars, and Sonnet 5.5, 9.9M tokens for 5.80 dollars.">
</p>

## Breaks

A break is the time between the end of Claude's work and your next message. A short break counts as work. For a long break, Worklog asks you. A very long break does not count.

<p align="center">
  <img src="docs/breaks.svg" width="880" alt="One day with Worklog. Work always counts. A short 30 min break counts as work when you come back. For a long 2h break, Worklog asks you. The night is a very long break: it does not count.">
</p>

**Example.** Claude finishes at 10:00. You stop for a coffee. At 10:30, you send a new message. Worklog adds the 30 minutes at that moment. During the break, the total does not change. It catches up when you come back.

| Break | What Worklog does |
| --- | --- |
| Short: up to 1h | Counts the break as work. |
| Long: from 1h to 4h | Asks you if the break was work. |
| Very long: more than 4h | Does not count the break as work, and does not ask. |

If you close Claude Code during a short break, the break counts as work up to the moment you close Claude Code.

When Worklog asks, click **Count** to add the break, or **Ignore** to leave it out.

<p align="center">
  <img src="docs/screenshots/ask.png" width="880" alt="Under Worklog, the question: 2h 08 break on website, from 9:12 to 11:20. Count it as work? Two buttons: Count and Ignore.">
</p>

You can change the 1h and the 4h in the settings. To never get the question, set **Then ask** to **Never**.

## Project names

The time of each session goes to one name, such as a project or a task. Worklog decides on the name in this order:

1. The name that you choose, with `/worklog <name>` or in the list.
2. An ID in your messages, such as `PROJ-142`.
3. An ID in the name of your Git branch, such as `feature/PROJ-142-login`.
4. The name of the project folder. In a Git worktree, the name of the main project.

When Worklog finds the first ID of a session, the time before it also goes to this ID.

To count this session for another name from now on, point to the name in the list, then click **⇄**.

<p align="center">
  <img src="docs/screenshots/switch.png" width="880" alt="The list of names. The pointer is on the switch icon next to website.">
</p>

## Themes

Worklog has eight themes in the desktop app. Click the gear, then click a theme.

<p align="center">
  <img src="docs/screenshots/themes.png" width="880" alt="Worklog in its eight themes: Default, Night, Aurora, Ember, Forest, Ocean, Dusk and Sakura.">
</p>

## In the terminal

Worklog works in the terminal too, with the same data. In a wide terminal, the heatmap shows one square for each day.

<p align="center">
  <img src="docs/screenshots/terminal.png" width="880" alt="Worklog in the terminal: the stats and the names on the left, the heatmap of the year on the right.">
</p>

To click in Worklog in the terminal, use the fullscreen mode: `/tui fullscreen`.

## Usage

| Task | Action |
| --- | --- |
| See another period | Click **Day**, **Week**, **Month**, **Year** or **All**. Click **‹** or **›** to go back or forward. |
| Count this session for another name, from now on | Point to the name, then click **⇄**. In the terminal, click the name. |
| Count this session for a new name, from now on | Click **+ Add item**, type the name, then press Enter. |
| Rename | Click **✎** next to the name. The new name also replaces the old one on past days. |
| Open the settings | Click the gear. In the terminal, click **≡**. |

| Command | What it does |
| --- | --- |
| `/worklog` | Shows or hides Worklog. |
| `/worklog <name>` | Counts this session for `<name>`, from now on. For example: `/worklog PROJ-142`. |

## Settings

<p align="center">
  <img src="docs/screenshots/settings.png" width="880" alt="The settings, with the Show menu open: Time and tokens, or Tokens and price. The eight themes on the right.">
</p>

| Setting | Default | What it does |
| --- | --- | --- |
| Show the activity heatmap | On | Shows one square for each day of the year. |
| Show | Time and tokens | Shows the time and the tokens, or the tokens and their API price. |
| Language | English | English or French. |
| Stay active during breaks | Up to 1h | A break up to this length is short: it counts as work. |
| Then ask | Up to 4h | For a long break, up to this length, Worklog asks you if it was work. A very long break does not count. **Never** turns off the question. |
| Theme | Night | Default, Night, Aurora, Ember, Forest, Ocean, Dusk or Sakura. Desktop app only. |

## Update

Claude Code does not update Worklog automatically. Choose one of these options.

**Automatic updates (recommended).** Do this one time:

1. In Claude Code, type `/plugin`.
2. Open the **Marketplaces** tab, then select **worklog**.
3. Select **Enable auto-update**.

Claude Code then gets each new version when a session starts. The next session uses it.

**Manual update.** Run these commands for each new version:

```sh
claude plugin marketplace update worklog
claude plugin update worklog@worklog
```

Then restart Claude Code, or type `/reload-plugins`.

To know when a new version comes out, click **Watch** on this GitHub page, then **Custom** > **Releases**.

## Uninstall

```sh
claude plugin uninstall worklog@worklog
```

Your data stays in `~/.claude/worklog/`. To remove it, delete this folder.

## FAQ

<details>
<summary><strong>Where does the API price come from?</strong></summary>

Worklog takes the prices from the public [LiteLLM price list](https://github.com/BerriAI/litellm). It gets the list again once a day.

For your past work, Worklog reads the details of each answer in your Claude Code history. If Claude Code deleted an old conversation, the tokens of that conversation have no price.

</details>

<details>
<summary><strong>Do all tokens have the same price?</strong></summary>

No. The API gives a different price to each type of token, and Worklog uses each price:

- Input tokens (what Claude reads): the normal price.
- Output tokens (what Claude writes): about 5 times the input price.
- Cache writes (Claude saves your conversation for later): 1.25 times the input price for 5 minutes, 2 times for 1 hour.
- Cache reads (Claude reads the saved conversation again): only 0.1 times the input price.

In long sessions, most tokens are cache reads. They are cheap, so many tokens can still cost little.

</details>

<details>
<summary><strong>Does a resumed or forked conversation count twice?</strong></summary>

No. When you resume or fork a conversation, Claude Code can copy old messages into the new file. Worklog counts each message only once.

</details>

<details>
<summary><strong>What does Worklog not count?</strong></summary>

Work outside Claude Code: meetings, calls and other tools.

</details>

## Privacy and access

Worklog runs on your computer and keeps its data there. This is all that it can do:

| Access | What Worklog does |
| --- | --- |
| Reads files | Its own data in `~/.claude/worklog/`. Your Claude Code history in `~/.claude/projects/`, for the time, the tokens and the model of each answer. |
| Writes files | Only its own data, in `~/.claude/worklog/`. |
| Runs commands | `git branch --show-current`, to find an ID in the branch name. `node`, to read your past history. |
| Network | Once a day, it downloads the public LiteLLM price list. It sends nothing about you or your work. |
| Your messages | It reads each message to find an ID, such as `PROJ-142`. It does not keep your messages. |

To stop the price download, set the environment variable `WORKLOG_PRICES` to `off`. To keep the data in another folder, set the environment variable `WORKLOG_DATA_DIR`.

## License

[MIT](LICENSE)
