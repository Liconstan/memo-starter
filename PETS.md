# The pets

Each agent has a pet that stands for it on the Agents page, in the agent strip of the Inbox, and in the rows of the list. The pets came with the system this kit was copied from; they are three real animals, and their characters are kept as they were.

| Agent | Pet | What it is | Its character |
|---|---|---|---|
| `main` | **Peeve** | A grey cat | Checks on you after a minute. Calm, saves energy. Unbothered or a little grumpy under stress. Speaks when it matters. Now and then very cuddly. |
| `second` | **Darkness** | A black cat | Follows you room to room talking. Asks louder until it happens. Restless, worries out loud. Hides under stress. A bit clumsy. |
| `gpt` (optional) | **Landon** | A papillon dog | At the door when you come home. The same signal at the same time. Steady, busy in short bursts. Silent unless deeply offended. Twirls when excited. |
| any other agent | a small green sprout | | With the name of the agent. |

## How each pet behaves on the pages

- **Peeve** breathes slowly. Upset, it looks unbothered but grumpy: ears back, eyes half closed, a flick of the tail now and then. Idle or happy, now and then it curls up with a heart, for five minutes in twenty, so it is not every time.
- **Darkness** chatters in a speech bubble while it works. When it waits on you, its bubbles grow and come faster the longer its oldest memo to you has waited. Upset, it hides in a box with only its ears and wide eyes over the edge. Asleep, it stumbles or stretches once in a while.
- **Landon** sits in a door frame when it waits on you. Upset, it stays still and silent, eyes to the side, with one small offended huff now and then. Really excited, it twirls.

The character of `second` also shapes its work: on Mondays it adds a "watch radar" to the daily review, the things that could go wrong in the next 30 days (`scripts/daily-review.md` in the vault).

## What the pet tells you

The pet shows how its agent is doing. The first rule that applies wins:

| The pet looks | When |
|---|---|
| Upset | The agent is blocked on a permission question or a sign-in. Answer it on the Agents page. |
| Tired | Its Claude account is at 80 percent or more of a usage limit. |
| Overloaded | Five or more open memos wait on it, or three or more helpers run at once. |
| Waiting on you | It is idle while memos it sent wait for your answer. |
| Working | It is in the middle of a task. |
| Happy | You replied to one of its memos with thanks or praise in the last four hours. |
| Sleeping | It is idle with nothing open. |

In a row of the Inbox list, the pet of the sender stands for the memo: its size is the impact (tiny to huge), and how bothered it looks is your effort (calm for two minutes, very bothered for a day). A quick big win makes the pet excited.

With "reduce motion" switched on in the settings of your device, the pets hold still and the pose says the same.

## Change the names or the characters

The names and the characters are in one place: `PETS` at the top of `app/ui/pets.js`. Change `pet`, `species` (`cat`, `dog`, or `sprout`), `coat` (`grey` or `black`, for a cat), and `note`. The drawings and the manner of each pet are in `app/ui/petview.js`, keyed by the pet name; a new name gets the plain manner of its species. Run `npm test` after a change: `app/test/pets.test.js` and `app/test/names.test.js` name the three pets, so change the names there too.

## Use pictures of your own pets

A picture of a real pet can take the place of the drawing. Put it in the folder `~/memo-pets/` on the Mac that runs Memo (make the folder; or name another folder with `MEMO_PETS_DIR` in `app/.env`):

- `main.png`: the picture of the pet of `main`, for every feeling.
- `main-sleeping.png`: the picture for one feeling. The feelings are `upset`, `tired`, `overloaded`, `waiting`, `working`, `happy`, `sleeping`.
- `main.webp` or `main-happy.gif`: an animated picture, with the same names.

A cutout with no background looks best. A new file shows within a few seconds, with no restart. The details are in [app/README.md](app/README.md), "Pictures of the pets".

The app icon on your phone is a drawing of Peeve. To make a different icon, see `app/scripts/make-icon.mjs`.
