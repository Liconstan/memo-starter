---
type: log
updated: [SYNC_START_DATE]
source: the nightly people pass
---

# People merges

When two files are the same person, the nightly sync merges them: it keeps the fuller file, and moves the other file into this folder, unchanged. To undo a merge, move the old file back to `people/`, take its name out of `aliases:` in the kept file, and point the wikilinks back.

## Merged

Format, one line per merge:
`- YYYY-MM-DD: kept [[people/first-last]], merged <old-file>.md. Evidence: <one line: the same email address, the same organisation, a source that links the two names>`

## Possible pairs, not merged

Format: `- <file a> and <file b>: <why they may be one person>, <what would settle it>`

