---
type: playbook
updated: [SYNC_START_DATE]
source: the Memo starter kit. Change it as [YOUR_FIRST_NAME] corrects the review, and note the memo number of each change.
---

# Daily review playbook

The memo "Daily review" arrives Monday to Friday at [DAILY_REVIEW_HOUR]:00 by the clock of the Mac, for the agent `second`. [TASK_MANAGER] is the source of truth for tasks. Give times in the current zone of [YOUR_FIRST_NAME], from `memo tz` (with no recent report: [YOUR_TIMEZONE]).

The agent that sends the review memo also does the follow-up when [YOUR_FIRST_NAME] replies: the focus blocks that were picked, and the tasks the reply asks for.

0. **Memo refresh.** Run `memo list --to [MEMO_OWNER]`. For each open memo that you sent, check the sent mail, the drafts, the chat, [TASK_MANAGER] and the calendar for what changed since it was sent. If something changed, add one note with `memo note <id> --from <your name>`: a bold first line with the change and its time, two or three bullets, and the new next step; then `memo brief <id> --next "<new step>"`. No note when nothing changed.
1. Read `asana/tasks.md` (last night's snapshot), then check [TASK_MANAGER] live for changes since.
2. **Done check before listing.** Before a task goes under Overdue, Due today or a focus block, look for proof that it is done already: the sent mail, the chat messages of [YOUR_FIRST_NAME] and the replies to them, the form or page itself, the meetings since the task was set. Done with proof: tick it and name it under "Ticked as done" with the link. Likely done but unsure: list it under "Done? Reply yes to tick" with the evidence, not as overdue.
3. Read today's calendar and this week's.
4. Send [YOUR_FIRST_NAME] one memo, impact 3, effort short, with `--due` today, workstream SYS. Leave out each section that is empty:
   - **Overdue** tasks of [YOUR_FIRST_NAME], each with its link.
   - **Due today**, then **this week**.
   - **Up to three focus blocks** for free time today or tomorrow, each tied to a task: start, end, task. Ask: "Reply with the numbers to add." Create only the blocks that get a yes, as private holds with no guests. Never move a meeting with other people.
   - Tasks of teammates that block [YOUR_FIRST_NAME].
   - **Private to bring up today**: for each of today's meetings, the open private rows of `people/_to-cover.md` (the ones that cannot go on the invite): the meeting, the item, why, the source link. Then the rows marked "must cover".
   - **People merged** in last night's sync, from `people/_merged/merges.md`: one line each, and the possible pairs. Ask to flag a wrong one; undo a merge that is flagged.
   - **Emails to answer**: the threads tagged `needs you:` in last night's `email/` sections that still have no answer, oldest first, at most 8: the sender, the subject, the days waiting, the link, and the edit link of the draft if one exists.
   - **Ticked as done**, and **Done? Reply yes to tick**, from step 2 and from step 9b of the nightly sync.
5. Keep it short. No memo when nothing is overdue, nothing is due this week, and there is no free time to block: close the review memo with "nothing due".

Rules:

- A step of [YOUR_FIRST_NAME] that takes over 15 minutes, or has a date, becomes a task in [TASK_MANAGER], with the memo number in its description. A quick yes-or-no question stays a memo.
- Only a real deadline gets a due date.
- Personal tasks stay out of the work projects of [YOUR_ORG].

## Mondays: last week and this week

On Mondays, put first in the memo a ready-to-paste update for the team meeting: "Last week:" and "This week:", 3 to 8 items each, results and numbers first, no internal tooling. Sources: the tasks completed last week, the memos closed, the meetings, the sent mail. Under it, one line for each fact you could not confirm. Where the update goes: [SLACK_CHANNEL_FOR_TEAM_UPDATES].

## Mondays: watch radar

The agent `second` (its pet is Darkness: vigilant, says what could go wrong) adds one section on Mondays, or sends it as its own memo when the review has nothing else:

- Renewals and subscriptions in the next 30 days, from renewal notices in the mail.
- Reports and deadlines for funders, clients or authorities in the next 30 days.
- Overdue tasks of [YOUR_FIRST_NAME] that slipped more than a week, and the memos marked Ugh in the Inbox.
- Mail drafts and chat drafts older than 7 days that were never sent.
- Agent sign-ins: run `claude -p /usage` for `main`, and `CLAUDE_CONFIG_DIR=[SECOND_CLAUDE_CONFIG_DIR] claude -p /usage` for `second`. If either says that its sign-in ends within 7 days, put it first, with the exact steps to sign in again.

One line each with the date, the cost or the stakes, and the link. No section when nothing is found.

## Add your own sections

A section that only [YOUR_ORG] needs (new applicants to look at, new orders, a weekly number) goes in step 4 as one bullet: its name in bold, where the data comes from, and "only if any".
