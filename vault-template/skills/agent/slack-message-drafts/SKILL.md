---
name: slack-message-drafts
description: "Use when you draft an internal chat message for [YOUR_FIRST_NAME] to send (to a teammate, a channel or a thread). Covers when to reply in an existing thread, and the one-draft format for a new subject: a header message on top and the thread message below."
purpose: One chat draft in the voice of [YOUR_FIRST_NAME], in the right place, in the shape it is sent from without editing.
helper_model: opus medium
model_why: the voice of [YOUR_FIRST_NAME] needs the strongest tier
created_by: agent
created: [SYNC_START_DATE]
last_used: [SYNC_START_DATE]
source: the Memo starter kit
---

# Internal chat message drafts

## Goal

[YOUR_FIRST_NAME] sends every chat message. Agents only make drafts, with the draft tool of the connector. A new subject is one draft that splits into a header post and a first thread reply, with nothing to delete in between.

## Settings

- The chat tool: [CHAT_TOOL].
- Where a draft goes: [WHERE_TO_SEND_DRAFTS].
- The internal channel of the team: [SLACK_CHANNEL_FOR_TEAM_UPDATES].
- New subject format: header post plus thread reply (step 2). If [YOUR_FIRST_NAME] prefers one plain message, say so here: {header plus thread}.

## When to use

- An internal message from [YOUR_FIRST_NAME] to a teammate, a channel or a thread.

## When not to use

- An announcement to everyone: the example skill `slack-announcement`.

## Steps

1. Decide: reply or new subject.
   - Reply: the message answers someone in an existing thread, or the channel is a loose conversation. Draft it as one plain message, in the thread when there is one.
   - New subject: the message starts a topic. Use the two-piece format of step 2.
2. The two-piece format, in one draft:
   - Top: the header message, short. An emoji, a bold title, and one line on what the thread is for. This becomes the top-level post.
   - A blank line, then the thread message: the full content, with mentions, numbers and asks. [YOUR_FIRST_NAME] posts the header, opens its thread, and pastes this part as the first reply.
   - Write nothing between the two parts that must be deleted: no labels such as "Header" or "Thread".
   - Formatting: link names; do not paste raw addresses. Group a long list under short bold labels.
3. Voice: read `skills/my-writing-voice/SKILL.md`. Mention people by their real user id from the user search of the connector; never guess an id.
4. Where the draft goes: in the channel or direct message where it will be sent. If the tool says a draft exists there already, say so in the memo and put the text in the memo.
5. In the memo: the link of the channel or direct message, whether it is a reply or a two-piece draft, and the full text to paste, every time, also when the draft was created. A draft can come up blank, so the memo text is the fallback.

## Done when

- The draft sits in the channel or direct message it is for, or the memo says why it could not.
- A new subject has a header line, a blank line, then the thread message, and no labels between them.
- Every mention is a real user id; every link is a linked name.
- The memo has the link, the kind (reply or two-piece), and the full text.

## Pitfalls

- Labels such as "Header" or "Thread" that must be deleted.
- Raw addresses in the place of linked names; a long list that is not grouped.
- A guessed user id.
- A memo with links only and no text to paste.
- Items the teammate cannot act on. Leave them out and keep them as tasks for [YOUR_FIRST_NAME].
