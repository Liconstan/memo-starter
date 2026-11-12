---
type: playbook
updated: [SYNC_START_DATE]
source: the Memo starter kit. Change it as [YOUR_FIRST_NAME] corrects the follow-ups, and note the memo number of each change.
---

# Meeting follow-ups

Why it matters: after each meeting, everyone gets their decisions and action items in writing, in the place [YOUR_FIRST_NAME] already talks to them, so nothing that was agreed slips.

Trigger: Memo sends `main` a memo "Follow-up: <meeting>" about 30 minutes after a meeting with other people ends, for the calendars on the work domain [YOUR_WORK_DOMAIN]. [YOUR_FIRST_NAME] can also ask by memo for any meeting.

## Steps

1. Find the notes of the meeting in [MEETING_NOTES_TOOL], by date and title. No notes yet: try again on the next `memo wait`, for at most 3 hours; then say in the memo that no notes exist.
2. Read the summary, then the transcript for owners, dates and exact asks. The transcript outranks the summary. Never invent an owner.
3. List per person: the decisions that affect them, and their action items with any date that was said. Leave out items nobody owns, and items that were only floated.
4. Leave out anything sensitive: criticism of the work of a person or of an outside organisation, pay, hiring doubts, health, personal matters, and anything about a person marked `never publish`. Those stay in the memo to [YOUR_FIRST_NAME] only.
5. Where it goes: each meeting has one place, and all its follow-ups go there. Look the meeting up in the routing list below, by its calendar title. A meeting that is not in the list: [WHERE_TO_SEND_FOLLOWUPS]. For a person, read "How [YOUR_FIRST_NAME] writes to them" in their people file.
6. Format: a short header line with the date of the call and the words "decisions and next steps", then **Decided** with bullets (each a full plain sentence, with the reason when one was given), then one block per person: their name or mention on its own line, then their action items, the most urgent first, with a date where one was said. Close with a line that asks people to flag anything the notes got wrong. Keep the shape, but write each one fresh from what was said: drop empty sections, and word the bullets the way [YOUR_FIRST_NAME] talks (`skills/my-writing-voice/SKILL.md`). For chat, follow `skills/agent/slack-message-drafts`.
7. Make the drafts, never the sends: [WHERE_TO_SEND_DRAFTS].
8. The own action items of [YOUR_FIRST_NAME], and yours, become tasks in [TASK_MANAGER], not lines in the post.
9. One memo to [YOUR_FIRST_NAME] per meeting: the bold line "Follow-ups for <meeting> are drafted; review and send", then for each draft the place, a link, and the full text; then what was left out as sensitive, one line each.
10. Only when [YOUR_FIRST_NAME] replies on that memo with the words to send it, for that text: post the text exactly as written in the reply, in the place the draft was for. The tool may still ask [YOUR_FIRST_NAME] to confirm. With no such reply, nothing is sent.

## Routing list, one place per meeting

By calendar title. Add a row when [YOUR_FIRST_NAME] names a place.

| Meeting | Where the follow-up goes |
|---|---|
| {Weekly 1:1, Name and [YOUR_FIRST_NAME]} | {The chat direct message with Name} |
| {Weekly team meeting} | [SLACK_CHANNEL_FOR_TEAM_UPDATES], as one reply in the thread of that week's meeting |

## Done when

- Every person with an action item has it in one draft, in the right place, or is listed in the memo as unrouted.
- Nothing sensitive is in a draft.
- [YOUR_FIRST_NAME] has one memo per meeting with the full text and the link of every draft.
- Nothing was sent without the go-ahead of step 10.
