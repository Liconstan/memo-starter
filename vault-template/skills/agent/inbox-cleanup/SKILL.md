---
name: inbox-cleanup
description: Use for the nightly inbox upkeep (nightly-sync step 2b) or when [YOUR_FIRST_NAME] asks to clean up the Gmail inbox. Archives machine and group mail, archives action mail that was acted on, and leaves every real conversation in the inbox.
purpose: The inbox holds only mail from people and things that still need an action.
helper_model: opus medium
model_why: judgment on each bulk query, and a real conversation must never be archived
created_by: agent
created: [SYNC_START_DATE]
last_used: [SYNC_START_DATE]
source: the Memo starter kit
---

# Inbox cleanup

## Goal

The work inbox, [YOUR_EMAIL], shows real people and open actions, nothing else. Each run covers the whole inbox, not only the new mail.

## Before the first run

Send [YOUR_FIRST_NAME] one memo with the lists below and ask for a yes, with changes. Write the changes into this file. Run nothing before that yes. Then put the date and the memo number here: {not approved yet}.

## The rules

- Archive and mark as read. Never delete, trash, unsubscribe, send, draft or create a filter. Never mark the mail of a person as read.
- No new labels. Existing labels stay on their threads.
- Always skip starred threads.

## Archive, whatever its age

- Notifications of documents and files: comment and activity notices (but see Keep), "shared with you" notices.
- Calendar mail: accepted, declined, updated and cancelled, and invitations for past dates.
- Share notices of the meeting notes tool.
- Newsletters and promotions; product notices; the own mass mail of [YOUR_ORG].
- Notifications of tools: the task manager, chat, forms, video calls, code hosting, event reminders.
- Receipts and payment notices that need no action.
- Login and verification codes; automatic replies such as out of office.
- Group addresses that [YOUR_FIRST_NAME] is on, older than 14 days, unless [YOUR_FIRST_NAME] replied in the thread: {list them here after the first yes}.

## Action mail

Approval, signature, verify or "action required" mail: check the live tool first, such as the status of the bill or of the signing request. Done: archive. Not done: leave it, and list it for "Emails to answer" in the daily review. No tool can check it: leave it and list it.

## Keep in the inbox

- Any thread where a person wrote to [YOUR_FIRST_NAME] personally, or where [YOUR_FIRST_NAME] replied.
- A comment notice whose comment or reply a person wrote.
- Invitations for future events. Threads with applicants, funders, clients and invoices.
- Unsure: account and security notices, suspicious-login alerts, share requests. Leave them.

## Pitfalls

- A bulk query catches real conversations: support threads that got a reply, calendar replies with a personal note. Check the first page of every query, and skip threads with a message from [YOUR_FIRST_NAME].
- A search matches per message, so a filter on a label can still catch a thread with one labelled message. Check after each bulk archive.
- Confirm that the account is [YOUR_EMAIL] before any bulk work.

## Done when

- No machine mail of the kinds above is in the inbox, and no real conversation left it.
- The log line reads `inbox archived N, action open M, inbox now T`.
