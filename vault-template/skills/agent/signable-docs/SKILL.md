---
name: signable-docs
description: Use when [YOUR_FIRST_NAME] wants a document that someone must sign or fill in (an agreement, a statement, an acknowledgement, a form). Covers the Google Doc draft, Google eSignature fields, signer order, and how to hand it over to send.
purpose: A Google Doc with an eSignature field for every blank, assigned to the right signer, that [YOUR_FIRST_NAME] sends after one read of the memo.
helper_model: opus medium
model_why: agreements and statements are compliance work, so the strongest tier; the field placement alone could run on a cheaper one
created_by: agent
created: [SYNC_START_DATE]
last_used: [SYNC_START_DATE]
source: the Memo starter kit
---

# Documents someone must sign or fill in

## Goal

A blank line in a document cannot be filled in. Google eSignature makes the document fillable by the right person, and [YOUR_FIRST_NAME] sends the request. The result is one document per signer, in the folder where the signed copy will live, with every blank a field of the right type for the right signer, a screenshot that proves it, and a memo with the link and the one step left.

## Settings

- Where the documents live: [SIGNED_DOCS_FOLDER]
- Who represents [YOUR_ORG] as a signer: [YOUR_NAME], [YOUR_ROLE]
- The signing tool: Google eSignature in Google Docs (it needs a Google Workspace plan that has it). Another tool: write its steps into Part 2.

## When to use

- [YOUR_FIRST_NAME] asks for something someone must sign, initial, date or fill in, or a template for it.
- A document exists and fields must be added, moved, reassigned or removed.

## When not to use

- A document nobody signs: draft it as an ordinary document.
- A web form that someone else hosts: fill it in, never submit it.
- A PDF that must be signed as a PDF: eSignature works on Google Docs only. Convert it first, or stop and say so.

## Steps

### Part 1. Draft the document

1. Draft a Google Doc in the folder where the signed copy will live. One document per signer when several people sign the same form, named "<Document> - <Person>". Keep a template with no name.
2. No agent notes in the document: no "Draft by Claude" line. Say that it is a draft in the memo.
3. Write every blank as a label at the end of its own short line, with nothing after it: "Signature: ", "Printed name: ", "Date signed: ". No underscores and no tick boxes: a signer can only fill fields.
4. Never one field per yes-or-no question. Write the questions as a plain list, then one line of affirmation with an Initials field, then "Or, I disclose the following:" with one Text field.
5. Fill in every fact you know: the name of the person, their role, the organisation, the period. Take them from `people/`; a title only when the vault confirms it.
6. Never print signer numbers in the text. The order is set in the eSignature panel, not on the page. A countersigning part gets its own heading and one line that names the one person who signs it.

### Part 2. Put in the eSignature fields

The document tools of the connectors cannot insert eSignature fields; only the Google Docs page in a browser can. Use the browser tools of your session (Claude in Chrome). If you have none, stop here and give [YOUR_FIRST_NAME] the steps of this part, spelled out click by click.

7. Check the account at the top right of the document first: it must be the account that owns the document.
8. Open Tools, then eSignature. In the side panel, open the signer list and name each signer: the person for [YOUR_ORG] first, then each other party.
9. To insert a field: pick the signer in the panel, click at the far right of the label line, then click the field button (Signature, Initials, Name, Text field, Date signed).
10. Insert from the bottom of the document upward. Each field pushes the text below it down, so working upward keeps the lines you still have to click where the last screenshot showed them. Take a screenshot after each run of inserts and check each field.
11. Never click "Request eSignature". [YOUR_FIRST_NAME] sends. The button turns blue as soon as any field exists, so it is not a check that the document is complete: check the fields of each signer on the screenshot.
12. Save a screenshot of the finished signature section for the memo.

### Part 3. Report

13. One memo per batch, with for each document: the link, the signer list with the fields of each, the facts you filled in and where they came from, and any text you changed.
14. The one step that is left, spelled out: the device, the app, the menu (Tools, then eSignature), the button (Request eSignature), what to type (the email address of each signer), and what happens after (each signer gets an email; the signed PDF lands next to the document).
15. If something stopped you, stop after the first document and quote exactly what the screen said. Do not try a way around it.

## Done when

- One document per signer in the right folder, with no agent notes and no signer numbers in the text.
- Every blank is a field of the right type for the right signer, shown on a screenshot.
- The memo has the links, the signer lists, and the one step left.
- No request was sent.

## Pitfalls

- A test on the live document. Try on a copy.
- Telling [YOUR_FIRST_NAME] that fields cannot be added because the connector cannot: the browser page can.
- A field for each question of a list: ugly and slow to sign.
