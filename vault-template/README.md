# The vault of [YOUR_FIRST_NAME]

This folder is the personal context library of [YOUR_NAME]. The rules for how Claude works here are in `CLAUDE.md`. Read that file first.

**Where it is:** `[VAULT_PATH]` on the Mac that runs Memo (user `[MAC_USERNAME]`). **Backup:** the private GitHub repository `[VAULT_GITHUB_REPO]`.

## What is where

- `CLAUDE.md`: the rules. `scripts/lessons.md`: the rules [YOUR_FIRST_NAME] gave over time.
- `scripts/nightly-sync.md` and `scripts/daily-review.md`: the two playbooks that run on a schedule. `scripts/meeting-followups.md`: what happens after each meeting.
- `people/`: one file per person. Start with `people/_index.md`.
- `skills/`: how to do one kind of task. Start with `skills/README.md`.
- The other folders are described in `CLAUDE.md`.

## How it fills up

The vault starts almost empty. Each night the agent `second` reads the new meetings, mail, chat and documents of [YOUR_FIRST_NAME], and writes them here (`scripts/nightly-sync.md`). The first runs also go back in time, to [SYNC_START_DATE]. After about a week the agents know who the people are and what is open.

## To change how an agent works

- One kind of task: edit its skill in `skills/agent/`, or on the System page of Memo.
- Every task: add a rule to `scripts/lessons.md`.
- The schedule or the steps of the sync: edit the playbook in `scripts/`.
