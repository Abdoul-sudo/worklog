---
name: release-notes
description: The sections that every GitHub release of Worklog must have, with the Install and Update text
metadata:
  type: project
---

Every GitHub release has these sections, in this order:

1. The changes of the version, for example `## Fixes in 4.6.1` or `## New in 4.6`.
2. `## Install`, for a person who does not have Worklog yet.
3. `## Update`, for a person who has Worklog already.

Use this text for the last two sections. The commands are the same as in the Quick start and Update sections of README.md. If they change there, change them here too.

````md
## Install

```sh
claude plugin marketplace add Abdoul-sudo/worklog
claude plugin install worklog@worklog
```

Then restart Claude Code. To get new versions automatically, see [Update](https://github.com/Abdoul-sudo/worklog#update).

## Update

```sh
claude plugin marketplace update worklog
claude plugin update worklog@worklog
```

Then restart Claude Code, or type `/reload-plugins`.
````

**Why:** a person who finds a release page must be able to install Worklog from that page. The first release (4.5.2) had Install. The releases 4.5.3 to 4.6.1 had only Update.

**How to apply:** write this text in each new release, with `gh release create` or `gh release edit`.
