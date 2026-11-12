---
type: state
updated: [SYNC_START_DATE]
source: the nightly sync
---

# Sync state

Watermarks: the newest item already synced for each source. The nightly sync reads this file first, and updates a line only after the files of that source are written. A line that says "none yet" means the first run starts at [SYNC_START_DATE].

- meetings: none yet
- gmail: none yet
- slack: none yet
- docs: none yet
- tasks: none yet
- backlog_done: false
- backlog_until: none yet
- backfill_until: none yet

## Not saved yet

Items a run could not save, to try again: `- <source> <id>: <why>`

## Watch list

Things to check each night, with one memo to [YOUR_FIRST_NAME] when something arrives: `- <what to watch>: <where>, since <date>, memo <number>`

