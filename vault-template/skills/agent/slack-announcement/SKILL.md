---
name: slack-announcement
description: EXAMPLE, change or delete. Use when [YOUR_FIRST_NAME] asks to announce something to everyone (an event, an opening, a result, a resource) in [SLACK_CHANNEL_FOR_ANNOUNCEMENTS]. Covers the format, the channel, and the approval before anything is posted.
purpose: One announcement draft, in the format of [YOUR_ORG], that [YOUR_FIRST_NAME] approves and posts.
helper_model: opus medium
model_why: a public text in the voice of [YOUR_FIRST_NAME]
created_by: agent
created: [SYNC_START_DATE]
last_used: [SYNC_START_DATE]
source: the Memo starter kit, as an example of a skill that only one organisation needs
---

# EXAMPLE: announcements to the whole community

This skill is an example. It shows how a skill holds the preferences of one organisation: which channel, which format, who is tagged. Change every line under Settings to how [YOUR_ORG] does it, or delete the folder.

## Goal

An announcement that reads the same way each time, in the right channel, posted by [YOUR_FIRST_NAME] after one look.

## Settings

- The channel for announcements: [SLACK_CHANNEL_FOR_ANNOUNCEMENTS]
- A second channel for the same post, by topic: {none}
- The opening line, by kind: {"New event:", "We are hiring:", "New resource:"}
- Who may be tagged: {only people who asked to be tagged for that topic}
- Who posts: [YOUR_FIRST_NAME], always. The agent only drafts.

## When to use

- [YOUR_FIRST_NAME] says "announce this", "post this to everyone", or pastes an item and asks for a post.

## When not to use

- A message to one teammate or to the team channel: `slack-message-drafts`.

## Steps

1. Read the channel description and its last five posts with the connector, and match their format. If the description says this kind of post belongs elsewhere, tell [YOUR_FIRST_NAME]; do not draft.
2. Check the facts at the source: the date, the time with its zone, the place, the link, the deadline. Open the link.
3. Write the post: the opening line of its kind in bold, two or three short lines on what it is and who it is for, the date or the deadline, and one link. Voice: `skills/my-writing-voice/SKILL.md`.
4. Make the draft: [WHERE_TO_SEND_DRAFTS].
5. One memo, impact 2, effort micro: the channel, the full text, and the question "Post it?" in bold.

## Done when

- One draft, in the settings above, with every fact checked at its source.
- The memo has the channel and the full text.
- Nothing was posted.

## Pitfalls

- A post in a channel whose description says it belongs elsewhere.
- A date with no time zone.
