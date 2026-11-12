# Optional and experimental: a GPT worker in the Codex desktop app

Most installations do not need this. Memo's own agents are Claude Code sessions. This part lets a GPT model in the
Codex desktop app take memos too, for work that needs its computer and browser tools or its image tool. It was a first
integration when this kit was made: test it on a harmless task before you rely on it.

The worker is a chat in the Codex desktop app on the same computer as Memo. It is not a tmux session, and Memo cannot
start or stop it. Its pet is Landon, the papillon (see the README of the kit, "The pets").

## Register the worker

Add this entry to `local/agents.json`, and keep the other entries:

```json
{"name":"gpt","kind":"remote","runtime":"codex-desktop"}
```

Copy `charters/gpt.md` to `local/charters/gpt.md` and change it for your work. Restart the Memo server. Do not use
`scripts/remote-agent.sh gpt`: that script starts Claude, not the desktop app.

## Connect a desktop chat

1. In the Codex desktop app, pick the model you want and open one chat that will be the worker.
2. Give it this instruction, with the full path of your Memo app folder (`npm run setup` shows it as `[MEMO_APP_PATH]`
   in `my-setup/README.md`):

   > Connect as Memo agent gpt. Read <app folder>/local/charters/gpt.md, then run
   > <app folder>/scripts/memo prompt --as gpt for the current charter and recap.
   > Check the gpt queue, complete a bounded batch of explicitly assigned tasks, and reply
   > on the original memos. Verify results and record any blockers. Save a recap before ending.

## What Memo does

- The Agents page shows the worker with its last contact and the account-wide OpenAI limits of the local Codex
  sign-in, read through `codex app-server` each five minutes with no model call (`src/codex-usage.js`).
- With an optional `desktopThread` (the id of the chat) on the entry, Memo queues a wakeup in that chat when a memo
  arrives (`codex queue --thread ... --message ...`, `src/desktop-dispatch.js`), and scans the database each 30 seconds
  for arrivals it missed. An empty scan makes no model call.
- With `"desktopVerified": true` and a `model` on the entry, `memo send --to auto --capability computer-use` or
  `--capability image-generation` picks the worker, and the capture form of the Inbox suggests it for a task that
  starts with `[computer]`, `[image]`, or plain words such as "open ... and log in" (`ui/specialists.js`). Set
  `desktopVerified` only after your own test passed. The automatic pick names one model id in `ui/specialists.js`;
  change it there to the model you use.

## Limits

- The desktop app and the computer must stay available. A memo in the queue is not proof that work ran.
- Run only one worker for `gpt`. There is no claim lock.
- Permissions, confirmations and billing follow the desktop app. Memo grants none and adds no API key.
- Stop or pause the worker in the desktop app. Remove `desktopThread` and restart Memo to stop new wakeups.

## First test

Send a harmless task: open a public example page, report its title and one visible phrase, and reply on the memo.
Check that the page was really observed and that the reply reaches the Inbox. Do not use a real message or a purchase
as the first test.
