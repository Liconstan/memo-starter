---
name: skill-audit
description: Use when [YOUR_FIRST_NAME] asks to audit, test or check a skill, or after a skill was rewritten. Proves a fresh agent can follow it end to end on a throwaway case and fixes the wording.
purpose: A skill that a fresh agent with no context can follow to a correct result, with the proof logged in the skill.
helper_model: opus medium
model_why: the judge needs judgment about what a fresh agent misread; the test run itself uses the model of the audited skill
created_by: agent
created: [SYNC_START_DATE]
last_used: [SYNC_START_DATE]
source: the Memo starter kit
---

# Auditing a skill

## Goal

A skill is only useful if an agent that has never seen the task can follow it. Steps that read clearly to their author often fail in practice. This skill tests any skill, cheaply, without touching real people.

## When to use

- [YOUR_FIRST_NAME] asks to audit, test or check a skill.
- A skill was written or largely rewritten.
- A skill failed in use and the fix is not obvious.

## When not to use

- Reviewing the output of one task: `check-work`.
- Comparing models: `model-trial`.
- Hand-made skills in `skills/<name>/`: agents never change them; send a memo with the findings instead.

## Steps

1. Read the audited skill in full. Check the frontmatter against the schema in `skills/README.md`: every field present, `description` one line under 300 characters that starts with "Use when", `helper_model` a tier alias plus an effort. Check that the body has Goal, When to use, When not to use, Steps, Done when and Pitfalls, in that order. Note every gap.
2. Make a throwaway case: a made-up thread, document or message that names no real person and no real organisation. Put TEST in every title and name. The case must exercise every step.
3. Run the skill end to end [helper: the cheapest model the skill names, else `[HELPER_MODEL]`]. The brief holds only the text of the skill, the case, and these rules: do each step as written; stop before any step that would send, post, share or write to a shared tool, and say what you would have done; create only items with TEST in the name; at the end, list every step that was unclear, wrong or missing, with its number and what you did instead. Give no other guidance, or the test proves nothing.
4. Judge the run [helper: opus medium]: compare the output with the skill's Done when, read the list of the runner, and add every defect the runner did not see. For each defect, name the step and the wording that caused it.
5. Fix the skill in place: reword the steps, add the missing ones, move a rule to Pitfalls if it is a trap and not a step. Keep every existing rule and memo number.
6. Clean up: delete every TEST item the run made. If a tool cannot delete something, say so in the audit log line and in the memo.
7. Add one line to a `## Audit log` section at the bottom of the audited skill: the date, the runner model, the judge model, the result, the memo number. One line per audit; never rewrite old lines.
8. Pull, commit with a one-line summary, push. Send a memo only if a fix changes what [YOUR_FIRST_NAME] will see.

## Done when

- The runner reached the end of the skill, or the audit log says where it stopped and why.
- Every defect found has a wording fix in the skill.
- No TEST item is left in any tool.
- The audit log line is in the skill and pushed.

## Pitfalls

- A run that touches a real thread, person or shared file. Test on a copy, never on the live item.
- Extra guidance in the brief of the runner, which hides the defects a fresh agent would hit.
- A judge that only reads the list of the runner and skips the output itself.

## Audit log
