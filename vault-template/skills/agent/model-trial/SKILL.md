---
name: model-trial
description: Use when [YOUR_FIRST_NAME] asks, or when a cheaper or faster model tier is released. Reruns one finished task of a skill on the candidate model, has [YOUR_FIRST_NAME] judge both outputs blind, and records the verdict.
purpose: Each skill runs on the cheapest model and effort that gives work as good as the current one, with the evidence on file.
helper_model: opus medium
model_why: the trial itself is bookkeeping; [YOUR_FIRST_NAME] is the blind judge
created_by: agent
created: [SYNC_START_DATE]
last_used: [SYNC_START_DATE]
source: the Memo starter kit
---

# Trying a cheaper model on a skill

## Goal

Model releases come often, and nobody wants to edit every skill each time. This is a one-off trial, run on request or on a release, never on every run. One task, two models, one blind verdict, one row.

## When to use

- [YOUR_FIRST_NAME] asks to try a model on a skill.
- A new tier is released that is cheaper or faster than the one a skill names.
- A "Fable to spare" memo arrives from Memo (some plans only): points of the strongest tier will reset unused within a day. Pick one skill with no row in `skills/model-trials.md` yet, and run one trial. Skip it if work from [YOUR_FIRST_NAME] waits.

## When not to use

- As part of a normal task. Never run a task twice to compare.
- On a task that sends, pays or files anything.

## Steps

1. Pick one recent finished task of the skill, with its request, its output and its usage (tokens and time). If the usage was not kept, run the current model once more on the same task and keep that result as the baseline.
2. Rerun the same task with the same brief on the candidate model and effort [helper: the candidate]. The throwaway rules of `skill-audit` apply when the task touches real people or shared tools: TEST in every name, stop before sending, clean up after.
3. [YOUR_FIRST_NAME] judges blind. Label the two outputs A and B in random order; keep the key to yourself until the answer. Never name the models, the efforts or the usage in what [YOUR_FIRST_NAME] sees.
   - Inline text (a draft message, a summary): put both in one memo, A then B, in full, with the request and the skill's Done when on top.
   - A document or a design: make each in its own app, titled only "Trial A" and "Trial B", and give both links.
   - The memo asks one question, in bold: which is better, A, B, or equal. Impact 2, effort micro or short by the length.
4. Record one row in `skills/model-trials.md`: the date, the skill, the models compared (model and effort for each), the quality verdict, the usage of each, the decision.
5. On the answer, unblind and record the verdict. If the candidate is as good or better, and cheaper, change the `helper_model` line and `model_why` of the skill to cite the row by date. If not, leave the skill alone; the row is the record.
6. Pull, commit, push. Close the trial memo with one line: which output was which model, and whether the model of the skill changed. Delete the TEST copies.

## Done when

- One row in `skills/model-trials.md` with both usage figures and the verdict.
- The `helper_model` line of the skill matches the decision.
- No TEST item is left behind.

## Pitfalls

- A memo or a file name that tells which output came from which model.
- Comparing two different tasks, or two briefs that differ.
- Running a trial on every task because it seemed cheap.
