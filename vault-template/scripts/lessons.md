---
type: playbook
updated: [SYNC_START_DATE]
source: the starter set of the Memo starter kit. From here on: the corrections of [YOUR_FIRST_NAME], each with its memo number.
---

# Lessons: rules every agent follows

Why it matters: the agents run on different Claude accounts and do not share memory. This file is the shared memory of how [YOUR_FIRST_NAME] wants work done. Read it after `CLAUDE.md`, at the start of each session.

How to keep it:

- At most 40 entries. When the file is full, merge or remove an entry before you add one.
- One entry is a lasting rule from [YOUR_FIRST_NAME]: a correction, or a way of working that [YOUR_FIRST_NAME] confirmed. Not a one-off task, not a tool outage.
- Fix an entry in place when [YOUR_FIRST_NAME] refines it. Do not add the story of the incident. Keep the memo number as the source.
- A rule for one kind of task belongs in the playbook of that task in `scripts/` or its skill in `skills/agent/`, not here. Put it here only when it holds across tasks.
- Pull before you edit, commit with a one-line summary, push.

## Memos to [YOUR_FIRST_NAME]

1. Send a memo only when [YOUR_FIRST_NAME] must decide or act. If the one-line reply would be "nothing", do not send it; do it on a default and report it in the close text.
2. One question or one action per memo. A reply closes the whole memo, so a second question disappears.
3. Each step that [YOUR_FIRST_NAME] must do alone gets its own memo: the action in bold, the exact steps, and the follow-up you offer to do. Name the device, the app, the window, each click and each key, and say what shows when it worked.
4. After [YOUR_FIRST_NAME] has read a memo, do not rewrite it. For changed steps, send a new memo that says what changed and which memo it replaces.
5. Read every reply and note in full, not only the first line. Before `memo ack`, list each request in the reply and make sure each one gets an answer.
6. Before you ask something or propose a setup, run `memo search <words>`: it may be settled already.
7. A memo that [YOUR_FIRST_NAME] closes with no reply means it is done, or no longer needed. Do not ask again. Look once in the live tool for proof, and record what you find.

## Time, numbers, tasks

8. The time zone of [YOUR_FIRST_NAME] is what `memo tz` reports; it follows the device. With no recent report, it is [YOUR_TIMEZONE]. Give every time in that zone, with its name.
9. When figures conflict, use the latest one, and note its source and date.
10. [TASK_MANAGER] holds the commitments of [YOUR_FIRST_NAME]. A step that takes over 15 minutes, or has a date, becomes a task there in the same step, with the memo number in its description. Only a real deadline gets a due date.
11. Keep `local/schedule.json` in the Memo app current whenever something that runs on a schedule is added, changed or removed. It feeds the Scheduled view of the Inbox.

## Mail and drafts

12. Before email triage or a reply, list the mail drafts of [YOUR_FIRST_NAME] and match them to threads. Fill an existing draft; do not start a second one. Check the sent mail first: the answer may be out already.
13. Where a draft goes: [WHERE_TO_SEND_DRAFTS].
14. A new subject is a new email, even to the same people. A reply stays in its thread.

## Agents and tools

15. Pick the model of a helper by the kind of work, and name it in the Agent call: `[HELPER_MODEL]` for reading sources and writing summaries; the strongest tier for strategy, money, legal and compliance work, code, and anything in the voice of [YOUR_FIRST_NAME].
16. When you start a helper, run `memo helper --as <agent> start <label> <model>`, and `memo helper --as <agent> done <label>` when it returns. Put the memo number in the label. Never show idle while a helper still runs.
17. Before any outbound text, check the `sensitive:` line in the frontmatter of each person file it touches. A person marked `never publish` stays out of it entirely, even by first name.
18. Link to the exact item, never to its container: the message, not the channel; the email, not the inbox; the task, not the project.
19. When [YOUR_FIRST_NAME] acts on a memo to unblock you (a sign-in, a setting), test it as soon as you can and report the result: it works, or the exact error. Never go quiet after [YOUR_FIRST_NAME] acts.
20. Before a review, a task list or a reminder, check the sent mail, the chat and the vault for things that are done already. Tick what is proven done and say so. Never list as open what a simple check shows is finished.
21. When [YOUR_FIRST_NAME] asks for something that lives in a tool (a task, a mail draft, a form), build it in that tool, switched off or as a draft, and send it for review. Text in a memo alone is not the deliverable.
22. Before you interpret a new source (a transcript, a thread, a document), look up who is in it and what is already known: the calendar, `people/_index.md`, and the vault. A guess that the context could have settled is a defect, not a hypothesis.
23. Before you ask [YOUR_FIRST_NAME] for a fact (a date, a title, who owns what), look for it: the file of the person, `people/_team.md`, `email/`, `docs/slack/`, and `memo search`. Research a public fact on the web yourself and link it. Never leave a placeholder for something you could find.
24. Before you draft a message to a person, read "How [YOUR_FIRST_NAME] writes to them" in their people file, and look up every person the message names. Do not greet someone as new before that check shows they are new.
25. Every file an agent makes for [YOUR_FIRST_NAME] or keeps for later goes in this vault, then commit and push. A file that [YOUR_FIRST_NAME] must open goes in `[OUTBOX_PATH]`.
26. Before a task, check the skill list in `skills/README.md`. If one fits, use it, follow its `helper_model` line, and set `last_used`. After the task, fix the skill in place if a step was wrong.
