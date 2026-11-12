---
name: check-work
description: Use before a helper's output reaches [YOUR_FIRST_NAME], when the task has stakes (money, people, a document to send, a tax or legal record). A short independent review against the request and the skill's Done when.
purpose: Catch the defects in a helper's output before [YOUR_FIRST_NAME] does.
helper_model: opus medium
model_why: a checker needs judgment; use the strongest tier you have for money, legal and compliance work
created_by: agent
created: [SYNC_START_DATE]
last_used: [SYNC_START_DATE]
source: the Memo starter kit
---

# Checking a helper's work

## Goal

A second agent reads the output cold, against what was asked, and says what is wrong. Short, so it runs often.

## When to use

- Any output from a helper that goes to [YOUR_FIRST_NAME] and has stakes: money, a real person, a document to send, a filing, a figure that will be quoted.
- The judge step of `skill-audit` and `model-trial`.

## When not to use

- Mechanical jobs (a snapshot, a field fill) with a check built into the playbook.
- A quick lookup that the main agent reads itself.

## Steps

One helper, one screen of output [helper: opus medium].

1. Brief the checker with: the original request in the words of [YOUR_FIRST_NAME], the skill's Done when (if a skill was used), the output, and the sources the output cites. Not the reasoning of the maker.
2. The checker compares the output with the request line by line: anything asked and missing, anything added that was not asked.
3. The checker ticks each Done when item, or says which fails.
4. The checker checks facts at the source: every figure, name, date and link, opened and read, not assumed. For a text in the voice of [YOUR_FIRST_NAME], read `skills/my-writing-voice/SKILL.md` and flag what sounds wrong.
5. The checker returns a numbered list of defects, each with where it is and what the source says. No defects: "none found", and what was checked.
6. The main agent fixes the defects, or sends the task back to the maker with the list. Then the output goes to [YOUR_FIRST_NAME].

## Done when

- Every defect has a place and a source.
- Every Done when item is ticked or named as failing.
- The fix is applied, or the task is back with the maker.

## Pitfalls

- Giving the checker the reasoning of the maker: it then checks the reasoning, not the output.
- A check that reads the output but opens no source.
- Letting the maker check its own work.
