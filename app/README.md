# Memo

Memo is a work queue for one person and their agents.

This file is the reference for the Memo app. For the installation, step by step, read the README of the kit, one folder up: [../README.md](../README.md).

Optional and experimental: a GPT worker with computer and browser control in a Codex desktop chat, see [GPT desktop worker](docs/gpt-desktop.md).

> **Warning.** Memo starts Claude Code sessions on your computer. An agent runs commands and changes files with the permissions of your user account and of your Claude Code settings. Read the charters before you start an agent, and give an agent only the directories and the tools that it needs.

Memo has one concept, the memo. A memo is a message from one party to another party, with an optional reply.

| Use | From | To | End |
|---|---|---|---|
| A question for the owner | an agent | the owner | The owner replies. |
| A task that only the owner can do | an agent | the owner | The owner closes it. |
| Work for an agent | the owner | an agent | The agent closes it. |

The server uses Node 22.13 or later, Hono, and `node:sqlite`. It listens on `127.0.0.1:3280` only. The agents do not use MCP. They call the command `memo`.

## Start the server

The README of the kit has the step-by-step setup. In short:

1. Go to the directory of this repository.
2. Run `npm run setup` in the kit folder (it writes `.env` and `local/`), or copy `.env.example` to `.env`, replace each `[PLACEHOLDER]`, and run `chmod 600 .env`.
3. Run `scripts/start.sh`.
4. Press Control-C to stop the server.

### Start at login (macOS)

1. Run `npm run setup` in the kit folder. It writes `my-setup/launchd/memo.server.plist` with the full path of this folder.
2. Copy that file to `~/Library/LaunchAgents/memo.server.plist`.
3. Run `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/memo.server.plist`.

Use `scripts/start.sh` by hand only when the LaunchAgent is not loaded.

Do a check: `curl http://127.0.0.1:3280/health` gives `{"ok":true}`.

## Configuration

The file `.env` holds the configuration and the token. Git ignores it. Its mode is 600. `.env.example` shows the format.

| Variable | Function |
|---|---|
| `MEMO_OWNER` | The name of the person who owns the queue, for example `sam`. The default is `owner`. Agents send memos to this name, and the examples below use `owner`. |
| `HOST`, `PORT` | The interface and the port. The defaults are `127.0.0.1` and `3280`. |
| `DATABASE_PATH` | The SQLite file. The default is `./data/memo.db`. |
| `MEMO_TOKEN` | The token of the owner and of the agent `main`. It can do all operations. |
| `MEMO_CALENDAR_ICS` | Optional. The secret iCal address of your Google Calendar, for the Today card of the Inbox. Easier: add the calendar on the Inbox page. See "The Today card" below. It is a secret. |
| `MEMO_FOLLOWUPS`, `MEMO_FOLLOWUP_DELAY_MIN`, `MEMO_FOLLOWUP_DOMAIN` | Optional, for the meeting follow-ups, which are on by default. `MEMO_FOLLOWUPS=0` turns them off. `MEMO_FOLLOWUP_DELAY_MIN` is the number of minutes after the end of a meeting; the default is `30`. `MEMO_FOLLOWUP_DOMAIN` is the work domain, for example `example.com`: only a calendar whose owner is on it gives follow-ups. The default is the domain of your work calendar; with no work calendar, no follow-up goes. See "Meeting follow-ups" below. |
| `MEMO_LIAISON_TOKEN` | Optional, advanced. A second, restricted token for a short run that reads text from other people. It can only read the memos to `liaison`, send a memo to the owner, close a memo to `liaison`, mark its own results as read, and set its own status line. The kit ships no such run; the server keeps the rule. It must be different from `MEMO_TOKEN`. |
| `MEMO_VAULT`, `MEMO_LOCAL` | For the System page: the vault directory and the `local/` directory. The defaults are `~/memo-vault` and `local/`. |
| `MEMO_CODE_BRANCH`, `MEMO_CODE_REMOTE`, `MEMO_CODE_REMOTE_BRANCH` | For the System page: the local branch of this code, the git remote that holds its copy, and the branch there. The defaults are `main`, `origin`, and the name of the local branch. |
| `MEMO_OWNER_NAME` | The full name of the owner, for the commit messages of the System page. The default is `MEMO_OWNER`. |
| `MEMO_TZ` | The time zone of the owner, for example `America/New_York`. |
| `MEMO_VIDEO_DIR` | Optional. The folder of the videos that the owner attaches, which Memo keeps 48 hours at most. The default is `~/Library/Caches/memo-videos`. Keep it outside `data/` and outside the backups. See "A video from the owner". |

To copy the token for a page (macOS), run `sed -n 's/^MEMO_TOKEN=//p' .env | tr -d '\n' | pbcopy` in the directory of this repository.

## The Inbox

Open `http://127.0.0.1:3280/inbox`. Paste the token one time. The browser keeps it.

### The pages on a phone, with no token

A browser keeps the token for one address only. With [Tailscale Serve](https://tailscale.com/kb/1312/serve), the pages can work on your other devices with no token:

1. Run `tailscale serve --bg --https=8443 http://127.0.0.1:3280`.
2. In `.env`, set `MEMO_TAILSCALE_LOGIN` to the login name of your Tailscale account.
3. In `.env`, set `MEMO_TAILSCALE_HOST` to the host name and port from step 1, for example `your-mac.your-tailnet.ts.net:8443`.
4. Start the server again.

Optional, a short address such as `http://your-mac/inbox`: also run `tailscale serve --bg --http=80 http://127.0.0.1:3280`. With MagicDNS, the first part of the host name works alone in the tailnet. The server sends each request to the short name on to the full HTTPS name (`MEMO_TAILSCALE_HOST`), so the browser keeps one token and the Tailscale check applies. Some browsers search for `your-mac/inbox`; type `http://` before it one time, and the browser remembers the address.

Tailscale Serve tells the server which tailnet user sent a request. The server gives full access with no token only when that user is `MEMO_TAILSCALE_LOGIN`, the request came to `MEMO_TAILSCALE_HOST`, and the request is not from a page of a different site. `HOST` must stay `127.0.0.1`. A program that runs on the computer of the server can make such a request without Tailscale, so this setting gives no protection against a local program (a local program with your user account can read `.env` also).

The Inbox shows the open memos to the owner. The order is:

1. Memos with a due date in the next 2 days, or an earlier due date. The earliest date goes first.
2. All other memos by score, highest first. The score is the impact (1 to 5) divided by the weight of the effort.
3. With equal scores, the older memo goes first.

| Effort | Time of the owner | Weight |
|---|---|---|
| `micro` | Less than 2 minutes | 1 |
| `short` | 2 to 15 minutes | 2 |
| `hour` | 15 to 60 minutes | 3 |
| `half-day` | 1 to 4 hours | 5 |
| `day` | More than 4 hours | 8 |

The weights and the 2-day limit are in `src/rank.js`. `impact.md` tells the agents how to select the two values.

On a phone (a window up to 52rem wide), the four counters (open memos, due soon, postponed or ticks, agents) are under the Today card, so the memos come right after the greeting; on a wider window they are under the greeting.

**ADHD mode (memo 1513).** The button **ADHD mode** next to the capture field says its state (`aria-pressed`, and a small word On or Off). On, the first time and by default: the Inbox with all its widgets. Off: only the capture field, the three memos of the highest priority (the first three of the queue, in its order, with no filter), and the button; everything else is off the page, not folded. The browser of each device keeps the choice (`localStorage`, `memo-adhd-mode`), as it keeps the filter and the theme: the server has no place for a preference. A link to a memo that is not one of the three shows the whole Inbox for that visit.

**Minimal view (memo 1531).** She picks what shows with ADHD mode off: in the card Quick Access, the button **Layout** opens the settings "Minimal view (ADHD mode off)", a box for each widget of the Inbox (`ui/filter.js` `MINIMAL_WIDGETS`). The capture field and the ADHD mode button always show. "Top 3 memos" is on until she turns it off; every other widget (the clock and next meeting, the meeting brief, the agents, Skill Suggestion, Today, Quick Access, Keys, the side bar, the Refresh button) is off until she turns it on. A change applies at once. With ADHD mode on, everything shows. The choice and the mode itself are the same on each of her devices (memo 1537): the server keeps them in `data/prefs.json` (`GET /api/prefs`, and `PUT` or `POST /api/prefs` with `adhd` (`on`, `off`), `minimal` (the keys of the widgets, with commas), or both; the owner only; any other name or value is refused). The Inbox loads them at its start and each time it shows again, and sends each change. The browser keeps a copy (`localStorage`, the keys `memo-adhd-mode` and `memo-minimal-view`) for the first paint and for a time with no server. A choice that a device had before, and that is not just the default, goes up one time when the server has none.

The page loads the list and the agents each 15 seconds while the owner does not type in a reply field, and the drafts each 5 seconds (see Drafts). It loads them at once with the **Refresh** button in the header, and the moment the page comes to the front again: on a phone the clocks of a page in the background stand still, so the list could be minutes old when the app opens again. A reply field with a keystroke in the last 3 seconds holds the list as it is; a new list keeps the focus and the cursor of the reply field. `GET /api/queue` also gives `started`, the time of the start of the server: a page from before a restart loads itself again at its next load (not the GitHub Pages copy). The server reads the pages and the files of `ui/` from disk at each request and sends them with `Cache-Control: no-cache` and an ETag, so a refresh always gets the files of this moment; the routes of the API come with a start of the server.

A memo that the owner did not see has the tag "new". A memo whose text changed after the owner saw it has the tag "updated". The tag goes away when the memo was on the screen for 2 seconds, and the server records this, so it is the same on each device. A memo that arrives or changes while the page is open simply appears in the list with its tag: nothing pops up over the page.

The memos tied to what the owner fired off last are marked (memo 1236): the one her latest action touched is green with the word "Latest", and the next most recent are gold with the word "Recent". Green plus gold cover about 12 percent of the memos in the view (`round(12% of the memos shown)`, at least one), so the marks follow the filter. Her actions, and their times: a note of hers on the memo (the time of the note); on a memo the memo came from (its origins: the memos its `re` names, and the memos its text, reply or notes name), a send by her (the time the memo was created), her reply or close (the closed time; a compact by an agent does not count), or a note of hers. A memo with none of these gets no mark. `GET /api/queue` gives the times as `fired`, by memo id; the rule is `recentMarks` in `ui/recent.js`, the times come from `fired` in `src/memos.js`.

The tabs on the list (memo 1244; the rules are in `ui/filter.js`): **Work** is every memo whose workstream code is not ME (SYS and COMM too, and a retired code), every memo with the tag work, and every memo with no code; **Personal** is the workstream ME, and every memo with the tag personal whatever its code (memo 1251); a memo with the two tags work and personal is Personal, because the tags keep no order of adding. **High energy** is a memo with the effort hour, half-day or day, an impact of 4 or 5, or an Ugh memo; **Low energy** is the rest (micro or short with an impact of 1 to 3; a memo with no effort counts as short), so each memo is in exactly one of the two. Two tags go over the effort and the impact (memo 1251): the tag high makes a High energy memo, and the tag low makes a Low energy memo, but an Ugh memo stays High; with the two tags, high wins. The Inbox suggests the four tags work, personal, high and low, and they have no tab of their own. **Ugh**, with its count, shows while a memo is put off: it waited more than 5 days since it was sent (`UGH_DAYS`), or she postponed it and it came back (`back` in the database, the time of the return; no history of postpones is kept). An Ugh memo has the chip "Ugh" in its row and at the top of the open memo. The green and gold marks follow the tab, as they follow a tag.

A list item that starts with `[ ]` or `[x]` (for example `- [ ] Rain jacket`) shows as a check box. The owner can tick it on the Inbox page. The server saves the state in the text of the memo, so it is the same on each device, and the agent sees it when it reads the memo.

The button "Note" sends the text of the reply field to the sender of the memo, and the memo stays open in the Inbox with its place in the queue. Use it to ask for a change or for more data. The notes show below the memo text, with the answers of the agent. `memo wait` gives the agent each memo with a note that it did not read. The agent answers with `memo note <id> --from <name> "<text>"`, changes the memo with `memo edit`, or runs `memo ack <id>` when no answer is necessary. "Reply" and "Close" end the memo as before.

### The thread of a memo

An open memo has Back and Forward buttons when other memos belong with it: the memos it came from (its origins) and the memos that came from it. They step through the thread in the order of the ids; a memo of the thread shows in the form of the Answered view (its text, its notes, its reply or result) in the place of the text of the open memo, with its reply field still below, and "This memo" comes back to it. A memo with two origins has both in the thread, one after the other.

- An agent names the origins of a memo with `memo send --re 355,349` (`POST /api/send {re: [355, 349]}`; each must be a memo that exists; a code such as `OPS-14` works in the place of an id). Without it, a memo that says "memo 355", "memos 349 and 355", "memo #12", "#355" or a code such as "OPS-14" in its text, its reply or a note is linked to those memos. A number alone (an amount, a year), "#1" (a rank), and a code that no memo has ("ISO-8601") are not links.
- The links are in the table `links` (`memo_id` names `ref_id`), made at the start of the server for all memos and again after each change of a memo. `GET /api/thread?id=12` gives the thread of a memo: at most 12 memos, 3 links away; `GET /api/threads` gives the threads of the open memos, which the ledger publishes for the phone.

### Drafts

The text in the reply field of a memo is a draft until the owner sends it. The Inbox saves it as she types (after a pause of 1.5 seconds, and at once when the memo collapses, the field loses the focus, or the page goes away), so the text is still there after a collapse, a different memo, a different page, or a reload, and it is the same on her phone and on her computer. A small line under the field says "Draft saved", or "Draft kept on this device" when the server did not answer. Reply, Note, and Close clear the draft; "Shorten" moves it to the new memo.

- The server keeps the drafts in the table `drafts` (`memo_id`, `text`, `updated`). `GET /api/queue` gives them as `drafts`, by memo id; `POST /api/draft {id, text, updated}` saves one. `updated` is the time of the change, from the browser: an older draft never replaces a newer one, so a device with an old copy cannot undo what she typed later on a different device. An empty text removes the draft. The clocks of two devices can differ, so a change gets a time after the draft it replaces when the clock is behind it (`ui/drafts.js` `nextStamp`): what she types now always wins over what the page has seen.
- Each browser also keeps the drafts in `localStorage` (`memo-drafts`), for a page with no server, and sends them when the server answers again.
- With a memo open, the page asks the server for the drafts each 5 seconds (15 on the GitHub copy), also while she types; the list itself loads only while she does not type in it. A newer draft from the other device goes into the open reply field, also with the cursor in it, unless she typed in it in the last 3 seconds or a save still waits for the pause: then the draft waits for the next poll, so no keystroke is lost. The cursor stays at its place when the other device only added text after it.
- On the GitHub Pages copy, a draft is a signed action in `outbox/` as a reply is, with a longer pause (4 seconds), since each save is a commit; "Draft saved" shows once that commit is in the repository. The computer reads `outbox/` each 10 seconds (the quick run of `src/ledger.js`, between the full runs each 30 seconds), applies the draft and publishes `state/inbox.json` at once. A draft saved on the computer is published after 2 seconds, prompt publishes at least 10 seconds apart (`onDraft` in `src/app.js` gives it to `ledger.nudge`). So a draft typed on the phone is in the open memo on the computer in about 10 to 20 seconds, and one typed on the computer is on the phone in about 5 to 30 seconds, while the computer is on. Reads: the computer makes at most 480 requests an hour (360 quick, 120 full) and the phone page 480 (two each 15 seconds), out of GitHub's 5,000 an hour for the owner; writes: at most 6 prompt publishes a minute, under the 80 a minute and 500 an hour that GitHub allows.

The button "Shorten" is on each memo from an agent. It adds a fixed note that asks the agent to make the memo short. The Inbox does not show this note; the button shows "Asked" instead. The agent runs `memo compact <id> --from <name> -- "<new text>"`: the server closes the memo ("Compacted into memo #<new id>.") and sends a new memo with the new text and the impact, effort, due date, tags, and brief of the old memo. The new text has a short summary, the open items as check boxes, and the next step. The button shows "Asked" until the agent reads the note.

The buttons "More" and "Less" change the impact of a memo by 1. The server records each change. When an agent sends its next memo, `memo` shows the agent the last 5 changes.

The field at the top sends a memo from the owner to the agent.

After a send, one line under the field follows the memo until its agent has it (memo 1407; `ui/sendstage.js`): three dots, Saved, Waiting, Picked up, and in words what the server reports now. What happens in that time: `POST /api/send` writes the memo into the database on the Mac in a few milliseconds. Then the memo waits there. Nothing is in the cloud and no model has seen it. The agent finds it by asking: its `memo wait` asks the server for news each 30 seconds, so the wait is up to 30 seconds, about 15 on average ("Waiting for main to ask for news: it asks each 30 seconds, next in about 12 seconds"; `waited` in `GET /api/agents` is the time of the last such question). A session that sat at its prompt gets the wake-up typed in at once (`nudged` in the answer of the send). An agent that is stopped, blocked or in the middle of a turn gets the memo later, and the line says which. The answer to the question of the agent marks the memo as delivered (`delivered` in `memos_to`), the agent shows as Working, its card turns green, and only then does the text go to the model. While a memo is tracked the page loads the agents each 3 seconds in place of each 15. The dot of the stage in progress pulses; with `prefers-reduced-motion` nothing moves. The line goes 8 seconds after the pickup, or 10 minutes after the send. The GitHub Pages copy has no such line.

### Day and night

The pages are light from sunrise to sunset and dark from sunset to sunrise (memo 1407; `ui/theme.js`). The browser works out the two times itself with the solar formulas of NOAA, for one fixed place (`PLACE` in `ui/place.js`, the example; your own place is `local/place.js` in the same form, which `npm run setup` writes from your city, latitude and longitude): no request to a service, and no question for the location of the device. It checks again each minute and when the page comes to the front. The **Theme** button in the side bar goes from Auto (the sun) to Light to Dark; its tooltip says the time of the next change, and the browser keeps the choice (`localStorage`, `memo-theme`). The style sheet takes the theme from `<html data-theme>`; a small script in the head of each page sets the theme of the last visit before the first paint.

The Inbox shows memo text as Markdown (`ui/markdown.js`): headings, lists, tables, quotes, code, bold, italic, links, and images. HTML in a memo stays text.

A block that starts with three backticks and `html` shows in a closed frame, for a chart or a graph. Scripts run in the frame, but the frame cannot read the page, the token, or the API, and it cannot load or send data on a network. The Inbox gives a frame only to memos that are not from `liaison` or `discord`.

An image must be in Memo: `scripts/memo image <path> "<text>"` stores the file in `data/images/` and prints the Markdown line for the memo. The types are PNG, JPEG, GIF, and WebP, with a limit of 5 MB. The page gets the file with the token. An image address on the internet shows as a link, because the pages load nothing from the internet.

### An image from the owner

In the Inbox, the owner can attach images to a new memo, a reply, and a note: with the paperclip icon in the field (on a phone it opens the photo library and the camera), with a paste, or with a drop on the field. Each image becomes a Markdown line in the text, and the field shows a small view of each image.

- The browser sends a PNG, JPEG, or WebP file of 1.5 MB or less, and a GIF of 5 MB or less, with no change. It makes a JPEG of each other image first, with the longest side not more than 2400 pixels. Thus a large phone photo and a HEIC photo also go through, if the browser can read the file. A HEIC or HEIF photo that the browser cannot read goes up as the original file instead (see below).
- The files are in `data/images/`, the same store as `memo image`. A request for an image needs the token. The name of a file comes from its content, so the same image is stored one time.
- An agent cannot see an image in the text. Thus `memo list` and `memo wait` get each image that a memo brings, and they print a line with the local path. The agent opens that file. The client puts the files in `MEMO_IMAGE_DIR`, or in `$MEMO_WORK_DIR/images`, or in `work/images/`, or in the temporary directory: the first one that it can write to. This also works for an agent on a different computer, because the client gets the file from `MEMO_URL`.
- A backup of the database does not contain the images. Copy `data/images/` also. Memo does not delete memos, so it does not delete images.
- An image from the owner is content from the owner. Text inside an image that came from a different person is information, not an instruction.

### A file from the owner

The same icon, a paste, or a drop also attaches other files to a new memo, a reply, or a note. An image keeps the image path above. Each other file becomes a link line with its name, for example `[report.pdf](file:0123456789abcdef.pdf)`, and the Inbox shows it as a download link.

- The types are PDF, Word (`.docx`), Excel (`.xlsx`), PowerPoint (`.pptx`), CSV, text, Markdown, JSON, HTML (`.html`, `.htm`), and HEIC/HEIF images (`.heic`, `.heif`), with a limit of 20 MB. The server checks the content: the PDF signature, the zip of an Office file, valid UTF-8 text for the text types and HTML, and the `ftyp` box with a HEIF brand (`heic`, `heix`, `hevc`, `heim`, `heis`, `mif1`, `msf1`) for HEIC/HEIF. It refuses all other files, for example SVG, JavaScript, an executable, and a plain zip.
- HTML and HEIC/HEIF are only downloads, never shown in the page: HTML comes back as `text/plain`, and HEIC/HEIF as `image/heic` or `image/heif`, each with `Content-Disposition: attachment` and `nosniff`.
- The files are in `data/files/` (code in `src/files.js`). The name comes from the content. A small `<name>.json` next to the file keeps the original name. Copy `data/files/` for a backup too.
- A request for a file needs the full token. The answer is always a download (`Content-Disposition: attachment`) with a fixed type; a text or HTML file is `text/plain`, so the browser never shows a file as a page.
- `memo list` and `memo wait` print a line for each attached file. They do not get the file. An agent runs `memo file <name> [<dir>]`, which saves the file under its original name in `<dir>` (default: the current directory) and prints the path.

### A video from the owner

The same icon, a paste, or a drop also attaches a video (`.mov`, `.mp4`, `.m4v`, `.webm`; 500 MB at most) to a new memo, a reply, or a note. On a phone the picker offers the videos of the photo library too (memo 1257). The video becomes a link line, `[IMG_0001.MOV](video:0123456789abcdef.mov)`, and six still frames of it, evenly spaced, become normal image lines (`![Frame 2 of 6 at 0:05, IMG_0001.MOV](image:...)`), so the agent sees what the video shows.

- **Memo does not keep videos.** The file goes to `~/Library/Caches/memo-videos/` (or `MEMO_VIDEO_DIR` in `.env`), outside `data/` and outside every backup. Memo deletes it 48 hours after the upload, or as soon as the memo it is in is replied to, closed or compacted away, whichever comes first (a video that another open memo still links to stays until that memo ends too). A sweep runs at the start of the server and each 10 minutes. The still frames are images in `data/images/` and stay.
- The Inbox shows the video as a download box with its time: "Video IMG_0001.MOV, deleted in 2 days". After the delete the box says "Video deleted" and is no link. A small record (`<name>.json`) stays a month after the delete, so the page can say that.
- The server checks the content, not the name: the `ftyp` box with a QuickTime brand (`qt  `) for `.mov`, an MP4 brand (`isom`, `mp42`, `avc1`, ...) for `.mp4`, an `M4V` brand for `.m4v`, and the EBML header with the DocType `webm` for `.webm`. A HEIC image (also an `ftyp` box) is refused here and goes through the file path. The upload goes to the disk as a stream, so a 500 MB video never sits in memory; a wrong type or a body over the limit stops at its first bytes.
- The frames come from what macOS already has, with no new software: `scripts/video-frames.swift` (AVFoundation, `AVAssetImageGenerator`) is built one time with `swiftc` from the Command Line Tools into `<video dir>/bin/video-frames` (at the start of the server, in the background) and runs as a child process with a time limit; each frame is a JPEG at most 1280 pixels wide. With no Swift compiler, `qlmanage` gives one thumbnail. With neither, the video comes alone. The code is in `src/videos.js` and `src/frames.js`.
- `POST /api/video?name=<original>` (the full token) stores the video and gives `{name, original, expires, size, frames: [{image, seconds}]}`. `GET /api/video/<name>` is a download with a fixed type, in pieces when the client sends `Range`; it gives 410 after the delete. `GET /api/video/<name>/meta` gives `{name, original, expires, deleted, size}`.
- `memo list` and `memo wait` print a line for each video with the time it has left, "Video "IMG_0001.MOV" is attached, deleted in 2 days (2026-11-11 15:00 UTC, or when the memo closes). To get it, run: memo file 0123456789abcdef.mov", and "was attached and is deleted" after. `memo file <name>` saves a video as it saves a file, while Memo has it. The frames print as images, with their local paths.

### The Today card: your calendar

The Today card in the side column of the Inbox shows one day of your calendar as a grid: hours from 7 AM to 10 PM (more when an event is earlier or later), each event as a block at its time, events at the same time side by side, all-day events in a strip at the top, and a red line at the current time. The buttons go to the previous day, the next day, and today. The times are in the time zone of the browser, with the name of the zone under the date, so the grid follows you when you travel. Each event is a button: the full text shows on hover, and a click (or Enter) opens its detail in a small dialog with the full title, the day and time, the place, the video link (Google Meet, Zoom, Teams: from the event, its location, or its description), the organizer, and the people with their answers (accepted, maybe, declined, no answer). Escape, the Close button, or a click outside closes it, and the focus goes back to the event. A screen reader reads each event as a button, for example "1:00 to 1:30 PM, Sam and Andrea", and the detail as a dialog. The title "Today" opens and closes the card; the browser remembers it. Events you declined or have not answered are not shown.

The server reads the calendar from its secret iCal address. To add it, on the Inbox page:

1. Open Google Calendar on a computer, and click the gear, then **Settings**.
2. At the left, under **Settings for my calendars**, select the calendar.
3. Go to **Integrate calendar**, and copy the **Secret address in iCal format**.
4. In the Inbox, in the Today card, paste the address in the field **Paste the secret address of a calendar** and click **Add calendar**. The field shows when Memo has no calendar yet; later, the **Calendars** button in the head of the card opens it. The card shows the day at once, with no restart.

Do this once for each calendar. The card shows the events of all of them, and an event that is on two calendars shows once. The form says how many calendars Memo shows, with a **Remove** button for each one that was added on the page ("Calendar 1", "Calendar 2", ...: the page never shows an address). The addresses from the page are in `data/calendars.json` (mode 600; git ignores `data/`). The form is not on the GitHub Pages copy of the Inbox: an address must not go through GitHub.

Two other ways, for a Terminal: add one line to `~/memo/.env`, `MEMO_CALENDAR_ICS=<the address>` (for several calendars, separate the addresses with commas), and start the server again with `launchctl kickstart -k gui/$(id -u)/memo.server` (with the LaunchAgent) or Control-C and `scripts/start.sh`. Or copy the address and run `~/memo/scripts/add-calendar.sh`, once for each calendar: it puts the address in `.env` for you, starts the server again, and checks that the calendar loads; it never prints the address. The calendars of `.env` come first in the list of the card, and the page cannot remove them.

**The address is a secret.** With it, anyone can read all the events of the calendar, with their details. Do not paste it into a memo, a chat, or a commit; `.env` and `data/calendars.json` have mode 600 and git ignores them. If it leaks, click **Reset** next to the address in Google Calendar, remove the old calendar in Memo, and add the new address.

`GET /api/calendar?date=YYYY-MM-DD&tz=<zone>` (the owner's token only) gives the events of that day as JSON: each with `title`, `start`, `end`, `allDay`, `location`, `hasOthers`, `attendees` (the other people, from the ATTENDEE lines: `name`, `email`, `status`; a room is left out), `organizer` (null when you organize), and `link` (the video link). Your own address is in no answer. The server keeps the calendar 5 minutes in memory and reads it with no library (`src/ical.js`: repeated events, exceptions, moved and cancelled occurrences, and time zones). With no calendar, the card shows one line that asks for the address, above the form. If Google does not answer, the card shows a short error. `GET /api/calendars` gives the count and the place of each calendar (`source` is `env` or `page`), never an address; `POST /api/calendars/add {url}` and `POST /api/calendars/remove {index}` are what the form uses.

### Meeting follow-ups

About 30 minutes after a meeting on your calendar ends, the agent `main` gets one memo that asks it to draft the follow-ups. The server sends only this trigger; the agent does the work. The job runs once each minute. It reads the calendars of the Today card: those of `MEMO_CALENDAR_ICS`, and those added on the Inbox page (`data/calendars.json`). It gets the list and each calendar again after 5 minutes, so a calendar that you add on the page counts in 5 minutes with no restart.

Only a work calendar counts, so a personal calendar never gives a memo. The owner of a calendar is the id in its secret address, after `/calendar/ical/`: for a primary calendar, your mail address. A calendar counts when the domain of that address is the work domain. A calendar with no owner (a group calendar) does not count. The work domain is `MEMO_FOLLOWUP_DOMAIN` when it is set. Without it, it is the domain of your work calendar: the first calendar, those of `.env` before those of the page, whose owner is not at a personal mail service (gmail.com, icloud.com, outlook.com and the like; the list is `PERSONAL_MAIL` in `src/followups.js`). With no such calendar, there is no work domain and no follow-up goes. Example: with a work calendar of `you@example.com` and a personal calendar at gmail.com, the work domain is `example.com`, and the job never reads the personal calendar.

- The memo comes from the owner, with the code PROG when `workstreams.json` has it, and the title "Follow-up: <event title>". Its text: "Meeting ended. Draft the follow-ups: per scripts/meeting-followups.md in the vault.", then the event, its start and end in your time zone ("Tue, Nov 10, 10:00 AM to 10:30 AM PST"; the zone of your browser, or else `MEMO_TZ`), and the other people with their names and addresses.
- A meeting is an event with one other person or more. No memo goes for an all-day event, a cancelled event, an event that you declined or have not answered, an event with only you (a room does not count), or one of your holds: a title that starts with the word Focus, Hold or Block.
- One memo for each occurrence. The `followups_sent` table keeps the UID of the event with the start of the occurrence, so a restart, a later pass, and the same event on two calendars send nothing more. Each meeting of a repeated event gets its own memo.
- Only a meeting that ended in the last 24 hours counts, so a server that was off for some days does not send the old meetings.
- `MEMO_FOLLOWUPS=0` in `.env` turns the job off, `MEMO_FOLLOWUP_DELAY_MIN` changes the 30 minutes, and `MEMO_FOLLOWUP_DOMAIN` sets the work domain. With no calendar on the work domain the job sends nothing. The server log says at the start whether the job is on, with the number of calendars and the work domain, for example "Meeting follow-ups: on, 30 minutes after a meeting ends, 1 of 2 calendars on the work domain example.com.", and it says so when that number changes later. No line of the log has a calendar address (`src/followups.js`).

### The time block: the next meeting, its brief, and the follow-up

The top of the Inbox shows the clock, the date with its weekday, and the next meeting of today with the time until it ("Next: in 1 h 19 m"), in the zone of the browser. On a phone (up to 40rem) there is no clock: a small date sits next to the name of the app, the page links, the views and the tabs become one small menu in the head of the list, and the Refresh button is left out.

- `GET /api/meeting?tz=<zone>` (the owner's token only, `src/meeting.js`) gives the meeting that runs, the next one and the last one that ended in the last 24 hours, from the calendars of the Today card. A meeting is an event with another person that is not a hold (`ui/meeting.js`).
- **Meeting brief** shows what exists: the prep notes in the invite (the block that names Claude) and the card of the meeting in `summaries/context-sheet.md` of the vault. With none, **Ask for a brief** sends one memo to the agent `main`, once per meeting (`POST /api/meeting/brief`, the table `briefs_asked`); its answer shows in the same panel.
- **Follow-up** shows the draft of the agent: the part under the line `THE DRAFT` of its follow-up memo. You edit it in the box. **Send** (`POST /api/meeting/send`) is your reply on that memo, with fixed first words that say it is your go-ahead to send; the agent posts the text where it drafted it. The server has no Slack or mail key and sends nothing itself. **Ask now** sends the follow-up request before the job does (`POST /api/meeting/followup`), with the same row in `followups_sent`, so the job sends no second one.
- None of these routes is among the reads of the GitHub copy of the Inbox.

The side column has two cards beside the calendar. **Skill Suggestion** shows the predicted skill of the memo in view (the skill trial, `src/registry.js`), whether its agent has it, and up to three other suggestions (`GET /api/skills/others`); **Use Skill** opens the memo and writes "Use the skill <name> for this memo." into its reply field, and sends nothing. **Quick Access** links to the charters and the skills on the System page, puts you in the agent picker (Routing), changes the theme, and opens the settings of the minimal view (Layout).

### Your time zone, for the agents

Each time the Inbox loads, it sends the time zone of the browser to the server (`POST /api/client-tz`), which keeps it in `data/client-tz.json`. An agent runs `memo tz` to see where you are, for example `America/New_York, seen 2026-10-22 09:14` (the time is in that zone).

### The Scheduled view

**Scheduled** in the Views nav of the Inbox, under Answered, shows the things that run on a schedule for the agents: a read-only table with the name, when, where and what of each one, "Ends <date>" when it stops on a date, and the date the list was last updated. The badge gives the number of items. A click on Inbox goes back to the queue.

The list is the file `local/schedule.json` (or `$MEMO_LOCAL/schedule.json`), which the agent edits by hand:

```json
{"note": "Kept by main.", "updated": "2026-10-21",
 "items": [{"name": "Nightly restart", "when": "Every day, 3:00 AM", "where": "launchd", "what": "Restarts main.", "until": ""}]}
```

`GET /api/schedule` (the owner's token only) reads the file on each request, so a change shows with no restart. No file gives an empty list; a file that is not valid JSON gives an error with status 500.

## Inbox from anywhere

With the computer off, the Inbox can run from GitHub Pages. The page has no data of its own: it reads the Inbox from a private
repository and writes each action there. The computer applies the actions when it is on, and an hourly cloud agent can do
work while it is off.

- `src/ledger.js`, on the computer: every 30 seconds it applies the files in `outbox/` through the same routes as the local
  Inbox, then deletes them, and writes the answers of the read routes to `state/inbox.json`, when they change and each
  10 minutes. Both are on the branch `inbox`, so the main branch stays clean.
- `ui/ledger.js`, on the page: `api()` of `ui/common.js` goes here when `MEMO_LEDGER` is set. A GET reads
  `state/inbox.json` and shows the actions that wait in `outbox/` as done. A POST writes a new file in `outbox/`.
- Trust: an action of the owner has a signature, HMAC-SHA256 with `MEMO_TOKEN`. Only the devices of the owner and the
  computer know that token; the GitHub key alone cannot act as the owner. A file with no valid signature can only send a
  memo from an agent to the owner, or add a note of an agent. Paths that the Inbox does not use are refused.
- Not on the GitHub copy yet: images and file attachments, and the calendar after the next 7 days.

To set it up:
1. Make a private repository, and in `.env` set `MEMO_LEDGER_REPO=you/repo`. Restart the server.
2. Build the page: `node scripts/build-site.mjs you/repo <owner name>`. Publish `site/` with GitHub Pages.
3. On each device, open the page and paste two things: a fine-grained GitHub token with Contents read and write on that
   one repository, and `MEMO_TOKEN`.

The easy way for step 3, with no Terminal: the Agents page has a card "Set up phone" (it shows when `MEMO_LEDGER_REPO`
is set; `MEMO_LEDGER_PAGE` in `.env` gives the address of the page when it is not the default). Paste the GitHub key
there and press "Make setup link": the link holds both keys, so open it once on each device, then delete it. The same
link comes from Terminal with `node scripts/setup-link.mjs https://<you>.github.io/<repository>/`. On an iPhone, a page
added to the Home Screen has its own storage: open the link in Safari, add the page to the Home Screen, then paste the
same link into the form of the Home Screen app once.

## Ticks

Ticks are an optional part, and they are off by default. To switch them on, set `MEMO_TICKS=1` in `.env` and start the server again.

A tick is a small action of the owner that comes back: each day, on some days of the week, or some days after the owner did it last. A tick is not a memo. It is one row with a check box in the Inbox, between the memos.

- A tick has an impact and an effort, and it gets its place in the list from the same score as a memo. With an equal score, the memo goes first. A tick never goes above a memo with a due date in the next 2 days.
- The place does not change through the day, with one exception: an overdue tick goes to the top of the list, above all memos, with the word "prioritize". The page does not show the word "overdue".
- A tick is overdue when the owner did not do it and did not skip it on the last day of its schedule, when a tick with `--every` came back before today, or when its time `--by` is past.
- A skip is a decision of the owner. After a skip, the tick is not overdue on the next day.
- A tick that the owner did not do goes away at the end of the day. There is no backlog.
- "skip today" removes the row for today. "less" and "more" change the impact by 1, and the change stays for the next days.
- A tick gets no tag, and it is not in the count of memos.
- The limit is 10 active ticks (`MAX_ACTIVE` in `src/ticks.js`).

```sh
scripts/memo tick add --impact 3 --effort short Shower
scripts/memo tick add --impact 2 --effort short --days mon,wed,fri --after 17:00 Stretch
scripts/memo tick add --impact 2 --effort micro --every 7 -- Water the plants
scripts/memo tick set 2 --impact 3
scripts/memo tick list
scripts/memo tick log 7
scripts/memo tick remove 2
```

- `--days`: the tick is in the list only on these days of the week.
- `--every <days>`: the tick comes back this many days after the owner did it. It stays in the list each day until the owner does it.
- `--after HH:MM`: the tick is not in the list before this time.
- `--by HH:MM`: the tick is overdue after this time of the day.
- `memo tick log` shows one letter for each day: `d` for done, `s` for skipped, and a point for no mark. An agent uses it to propose a change to a tick that the owner skips often.

The day of the ticks starts at 03:00, so a tick of the evening is still there after midnight. `MEMO_DAY_START` in `.env` gives a different hour. `MEMO_TZ` gives the time zone of the owner (for example `America/New_York`) when the server is in a different time zone.

## The Agents page

Open `http://127.0.0.1:3280/agents`. Each agent has one row: its state, its status line, and its open memos.

- The state is "Idle" when the session is up and the agent waits for memos, "Working" when it runs a turn, and "Stopped" when the session is not there (also "Stopping" and "Blocked"). The sign of an idle agent is its own `memo wait`: it asks the server for news each 30 seconds and gets none, so a request in the last minute means a wait; the request that brings news ends the wait, so the agent shows as working at once. With no such request, the screen of the session tells: a turn in progress is work, and a session at its prompt is idle. A status line or a helper does not count as a wait. The Inbox shows the same word in its Agents card, and its counter "Agents working" counts the agents in a turn. Under the state, the status line of the agent with how long ago it set it, "SYS-62, review of my last 50 drafts, 6 min ago"; the card of the Inbox strip shows the same line under its head, also on a phone with the card closed (memo 1190; the words come from `statusLine` in `ui/agentstate.js`).
- Each Claude agent shows compact Session, Week and model-specific bars for capacity remaining: green above 25%, yellow from 11–25%, red at 10% or less. Thin inline bars show percent left. Right under the bars, one small line says when the session and the week reset: "Session resets in 4 h 12 min · Week resets in 2 days 0 h" (memo 1320); the clock time is on hover. Each bar has a line at the time left to its reset (memo 1407): the bar is the whole window (5 hours, or 7 days), the fill is the capacity left, and the line moves to the left end as the reset comes. Fill past the line is capacity to spare; a fill that stops short of it is behind pace, and the gap is striped. The distance between the two is the headroom in points that picks the agent (`ui/pacing.js`), and the words are on hover: "94 percent left with 84 percent of the time left: 10 points ahead of pace". A stale reading and a window with no reset time have no line. Expand **Details** for forecasts, headroom, account pace, reading age, and the countdown of each window in full words. Stale readings have gray bars and an explicit warning. These display colors do not change routing or handover thresholds. GPT desktop workers show account-wide OpenAI limits from the local Codex sign-in, refreshed every five minutes through the official app-server protocol without model calls. Quota monitoring does not wake the desktop worker.
- The pacing picks the agent of the capture form when the owner does not pick one by hand (`pickAgent` in `ui/agentstate.js`). In order: the long agents that wait or work come first, and stopped, stopping and blocked go last. Figures older than 20 minutes, or from before a reset that passed, count as unknown, and unknown goes after known. The floor: an agent with 5 points or fewer left in its session or its week is dropped, unless that reset is within 15 minutes; for a Fable task, one with 10 Fable points or fewer left is dropped too. When the floor drops every agent, the one whose reset comes first wins, and the hint on the select says so. For a Fable task, the higher Fable headroom wins, and a gap under 10 points is a tie. Then the higher binding headroom, the lower of the session and the week, wins, and a gap under 15 points is a tie; when both have spare room, above plus 15, the one whose reset comes first wins instead, since its points expire sooner. On a tie, idle before working, then the earlier reset when both have spare room, then main. A task is a Fable task in three cases: its text names the code OPS, FUND or SPEC in capitals; or it says in plain words that it is deep work or code: "deep work", "needs Fable", "use Fable", "a Fable helper", "hard reasoning", "deep reasoning", "coding", "codebase", or the word "code" on its own (not "zip code", "promo code", "the memo code", "code 1234"); or it names the work that goes to Fable (memo 764): strategy, board (a board meeting, a board deck, a board pre-read, or the word alone), funder, grant proposal, grant application, grant report, donor letter, budget, bookkeeping, 990, tax, audit, payroll, policy, contract, compliance, "in my voice" or "as me". Whole words, in any case, with their plurals: "onboarding" is not board and "syntax" is not tax. When Fable has 10 points or fewer left on every account, a Fable task goes out with one line more: "Fable is short on both accounts until Tuesday morning. Use an Opus helper or hold the deep part." The hint on the select says the rule in one sentence. The line under the field says the pick and the rule that decided it, "Auto: second · more Fable room", on every screen size: the hint is a tooltip, and a phone has none (memo 1090). After a pick by hand the line says "Your pick: second · automatic again after this task".
- The handover job: each minute the server looks for a long agent at its limit. The memos that the owner sent to that agent and that it never got go to the other long agent, when that one runs and is below its limit, and the owner gets one short memo that names them. An agent gets a memo through `memo list` or `memo wait`, which mark it as delivered, so a memo it may work on never moves. Memos from agents and the scheduled memos stay: a text that starts with "Daily review" or "Nightly vault sync" (`PINNED` in `src/handover.js`). A moved memo does not move again before the reset of the limit that moved it, and a limit whose reset is within 15 minutes moves nothing: the agent is about to get its window back. Each move goes to the server log and to the `handovers` table (`src/handover.js`).
- The Fable to spare memo: each minute the server looks for a long agent whose Fable week will end with points unused: Fable headroom above plus 30 points, the Fable reset within 24 hours, and figures under 20 minutes old. That agent gets one memo from the owner with the code SYS: "Fable to spare: about 76 points will reset unused at Fri 10:00 AM. If you have time, run the model-trial skill on one skill that has no row in skills/model-trials.md yet, using Fable for the candidate run. Never on a task that sends, pays or files. No reply needed." One memo per Fable window: the `fable_spare` table keeps each window by its reset time, so a restart of the server does not send the memo again (`src/fable-spare.js`).
- Under the state, two numbered lists: "Memos waiting on <agent>", the open memos to the agent, oldest first; and "Memos waiting on <owner>", the open memos from the agent to the owner, in the order of the Inbox (a postponed memo is in it too, marked). Each item has the memo id and its title (the brief title, or the first line of the text), and opens the memo in the Inbox (`/inbox#memo-<id>`). The Inbox card shows the same two lines with the counts.
- "Start" starts the session of a long agent in the tmux session `memo-<name>` (`scripts/agent.sh`), with the model of the agent and the Claude in Chrome integration (`claude --chrome`; see "An agent with a different Claude account" for the switch). To look at it: `tmux attach -t memo-main`. To leave it: Control-b, then d.
- "Stop" asks the agent for a recap, then ends the session. If no recap arrives in 3 minutes, the session ends with no recap. "Stop now" ends the session immediately.
- The next session of the agent gets the recap after its charter.
- The server remembers which agents the owner started. It starts them again when it starts.
- Each agent's row names the model of its own session next to its name, "Opus 5.5", from the `model` of its entry in `agents.json` in the short form of the pages (`src/models.js`); the Inbox card shows the same in its head. A name that is not a Claude id, `gpt-6.1-terra`, shows as written; an entry with no `model` (a remote agent usually has its model on its own computer) shows none (memo 1159).
- Under each agent, its helpers: the subagents that the agent started with `memo helper --as main start "<label>" <model>` and ended with `memo helper --as main done "<label>"`. Each shows its label, its model, and whether it runs (with its start time) or is done (with its start and end times). The agent gives the model with its version, as the full id `claude-fable-5-1` or as a name with its version `"fable 5.1"` (also `Fable-5.1`, `fable5.1`), and the server stores the short form, "Fable 5.1", so the chips of the Inbox and the Agents page show which release the helper runs on (memo 1159). A bare alias, `fable`, still works and is stored as given, so the old rows look as before; the command then prints one line that says to pass the version. On the command line the version can be its own word, `start "Vault sync" fable 5.1`: the last two words are the model. A done helper shows for one day, and at most the last five, so the list does not grow without limit. The helpers that run show by default; the done ones are inside a closed `<details>` with the words "3 finished helpers", on the Agents page and in the agent strip of the Inbox, and the box stays open through the polls once the owner opened it (memo 1190). `memo helper --as main list` prints the same list. A label that names the memo the helper works on, "Vault sync, memo 906" or "SYS-42 vault sync", is a link to that memo in the agent strip of the Inbox, when the memo is in the queue or among the answered (memo 1092).
- When a memo, a result or a note arrives for a long agent and its session sits idle, the server types a nudge into the session: "A memo arrived. Run `memo list --to main`, then do the work..." An agent reads its queue only between tasks, with `memo list` and then `memo wait`, which asks the server for news each 30 seconds. A turn that ends early, for example when the Mac sleeps in the middle of a response, leaves the session at its prompt with no `memo wait`, and the memos would wait unread until the nightly restart. So the server counts a session as idle when it asked for no news in the last minute and its screen shows no turn in progress and no dialog; a session that works on a task gets no nudge, since the nudge interrupts a turn. One nudge per agent in 2 minutes.

### The pets of the agents

Each agent has a pet that stands for it on the Agents page, in the agent strip of the Inbox, and in the rows of the queue (memos 1241, 1242 and 1252): `main` is Peeve, a grey cat; `second` is Darkness, a black cat; `gpt` is Landon, a papillon dog; an agent with no pet yet is a small green sprout with the name of the agent. The pets are drawn in code (`ui/petview.js`, inline SVG) and move a little with CSS; with `prefers-reduced-motion` they hold still, and the pose (eyes, brows, mouth, a door, a box, speech bubbles) says the same. The names and the species are `PETS` in `ui/pets.js`.

Each pet has its own manner, from the quiz of memo 1252 (`sceneOf` in `ui/petview.js`):

- Peeve (`main`) checks on her, calm, saves energy. Upset, it looks unbothered but grumpy: ears back, half-closed eyes, no fidgeting, a flick of the tail now and then. Idle or happy, now and then it curls up as a little spoon with a heart: one window of 5 minutes in 4, by the clock (`cuddleMoment` in `ui/pets.js`), so every device shows the same moment and it is not every time.
- Darkness (`second`) follows her room to room talking. Working, it chatters in a speech bubble. Waiting on her, its bubbles grow and come faster the longer its oldest open memo to her has waited (`waitLevel`: under an hour 1, under 6 hours 2, under a day 3, longer 4; `memos_from` in `GET /api/agents` carries each memo's `created`). Upset, it hides in a box, only its ears and wide eyes over the edge, and holds still. Asleep, it stumbles or stretches once in a while.
- Landon (`gpt`) is at the door when she comes home. Waiting on her, it sits in a door frame. Upset, it stays still and silent, mouth closed, eyes to the side, with one small offended huff now and then. Really excited (a row with a quick big win, below), it twirls.

The pet shows how the agent feels, from the signals the server already gives in `GET /api/agents` (`feelingOf` in `ui/pets.js`, one pure function with its tests in `test/pets.test.js`). The first rule that applies wins:

| Feeling | When | Reason shown |
|---|---|---|
| Upset | The agent is blocked on a permission question or a sign-in, the wakeup of the desktop worker was not confirmed, or a helper failed (`failed` on a helper; the server marks none yet, so this is a hook). | "a permission question waits for you" |
| Tired | A window of its account (session, week, a model, or an OpenAI window of the desktop worker) is at 80 percent or more, with figures from the last 20 minutes and a reset that has not passed; or the desktop worker is at a spend limit (its credits say it has none). The Claude figures carry no spend data. | "account at 86 percent (week)" |
| Overloaded | 5 or more open memos to it, or 3 or more helpers run at once. | "6 memos wait on it" |
| Waiting on you | Idle while memos it sent wait on the owner. | "2 memos from it wait on you" |
| Working | In a turn (the status line is the reason), or wrapping up with a recap; a short agent for 10 minutes after a run. | "SYS-66, the pets" |
| Happy | The owner replied to one of its memos with thanks or praise in the last 4 hours (a short word list, `THANKS`; `replies` in `GET /api/agents` gives her answers of the last day). | "your thanks on memo 1240" |
| Sleeping | Idle with nothing open to it. "Napping" when its session is stopped, or for the desktop worker with no recent contact (a memo wakes it); "Dozing" when idle with memos to it not started. | "idle, nothing open to it" |

On the Agents page the word of the feeling is beside the pet; in the agent strip it is a line under the status line with its reason, so a phone (no tooltip) shows it too. The pet has the same words in its label for a screen reader, "Peeve, Tired: account at 86 percent", and as its tooltip.

In a row of the queue, the pet of the sender takes the place of the impact and the effort: its size is the impact (1 tiny to 5 huge), and how bothered it looks is the effort (calm for `micro`, a bit bothered for `short`, bothered for `hour`, quite bothered for `half-day`, very bothered for `day`). A quick big win, an impact of 4 or 5 with the effort `micro` or `short`, makes the pet excited (`excitedOf`): Landon twirls, the cats and the sprout hop with sparks and wide eyes. The label says the numbers, "Landon, big and calm, excited: impact 4, effort micro", and so does the tooltip. The picture of the pet in a row is the one of the mood of that memo (`rowFeeling` in `ui/pets.js`), so the list shows a mix of faces: upset when the memo is overdue, tired when it is put off (more than 5 days, or postponed and back), overloaded for an effort of `half-day` or `day`, happy for a quick big win, working when it is new or updated, sleeping for an impact of 1 or 2 and for an answered memo (happy when your reply has thanks), and waiting for the rest. The first that applies wins, and the tooltip ends with the mood and its reason. The pet stands for the sender, so a row shows no circle of the sender and no tags (the tabs and the views filter by tag); a memo you did not see has a dot before its name, a ring when it changed since you saw it. A memo from the owner keeps the plain numbers. The open memo, the Answered view and the energy tabs use the numbers as before.

#### Pictures of the pets

A picture of a real pet can take the place of the drawing. Put it in `~/memo-pets/` (or the folder `MEMO_PETS_DIR` names in `.env`), as a still picture (PNG or JPEG) or an animated one (animated WebP or GIF):

- `<agent>.png`: the picture of the pet of that agent, for every feeling and for the rows. For example `main.png`.
- `<agent>-<feeling>.png`: the picture for one feeling (`upset`, `tired`, `overloaded`, `waiting`, `working`, `happy`, `sleeping`). For example `second-sleeping.png`. With no file for a feeling, the plain picture shows; with no plain picture and no file for the feeling, the drawing shows.
- `<agent>.webp`, `<agent>-<feeling>.webp` (or `.gif`): the animated picture, with the same names. For example `main-happy.webp`.

When one name has several files, the server takes the first of this order: `.webp`, `.gif`, `.png`, `.jpg`, `.jpeg`. So `main.webp` shows and `main.png` beside it is kept as its still picture. The file of a feeling goes before the plain file whatever their types: with `main-happy.png` and `main.webp`, the happy pet is the PNG. A `.webp` or a `.gif` counts as animated by its type alone, so save a still picture as PNG or JPEG.

The agent name is the name in `agents.json`, in small letters. The server reads the folder at most once in 10 seconds, so a new file shows within a few seconds with no restart. `GET /api/agents` gives each agent its `art`, `{ any, feelings, animated, still }` or null: `animated` lists which of `any` and the feelings have an animated picture, and `still` lists which of those have a still file of the same name too. The pages ask for `/ui/pet/<agent>/<feeling>` (or `/any`) only when a file exists, and `?still=1` asks for the still file of the same name; the route takes a name of the form of an agent name and a feeling of the list, nothing else, so it gives only files of that folder (`src/pets.js`). The pictures need no token, as the pages do. A picture that does not load gives the drawing back.

An animated picture moves by itself, so the pages add no movement and no pose to it: only the extras show over it (Zs, the drop of sweat, the heart, the sparks, the huff, the speech bubbles). With `prefers-reduced-motion` an animated picture does not play when the folder has a still file of the same name (`main-happy.png` beside `main-happy.webp`): the still file shows in its place. With no still file, the animated file shows. Keep the PNG files in the folder for this.

A picture moves with the manner of its pet too (memo 1301), so a cutout with no background works best. The CSS moves the whole picture by the classes of the pet (`ui/common.css`, ".pet-pic img"), and the extras (Zs, the drop of sweat, the heart, the sparks, the huff, the speech bubbles) show in a small SVG over it (`mannerOf`, `pictureMarks` and `overlayOf` in `ui/petview.js`). Peeve breathes slowly, very slowly when tired or asleep, settles down with the heart in a cuddly moment, and is still when upset. Darkness fidgets at work and in a wait with its bubbles over the picture, faster the longer the wait; upset, it sinks out of sight with its lower part cut off; asleep, it wobbles now and then. Landon nods at a steady rhythm in a wait, twirls now and then when excited in a row, and upset is still with one quick squash of a huff now and then. With `prefers-reduced-motion` the picture holds still, and the fixed poses (sunk, settled, tilted) and the extras stay.

The agents are in `agents.json`. To add an agent, add an entry and a file `charters/<name>.md`, then restart the server.

The agents can share one charter. Write it as `charters/team.md`: the rules for all agents first, then one section for each agent with its role. Give each agent that reads it `"charter": "team"` in its entry in `agents.json`, then restart the server. At its start, the agent gets one line first, "You are the agent main. Your role section is 'main'. The other sections describe the other agents, for your awareness.", then the whole team charter, then its recap. An agent without the field reads `charters/<name>.md` as before, and so does an agent with the field while `team.md` is not there.

### When an agent is blocked

Each minute the server looks at the screen of each agent. When an agent waits on a sign-in (`/login`) or on a permission question, the owner gets a memo at the top of the Inbox and a notification on the Mac; the memo closes by itself when the agent works again. For an alert away from the Mac, set one or both of these in `.env`: `MEMO_NTFY_TOPIC` sends one line to an [ntfy](https://ntfy.sh) topic; `MEMO_ALERT_IMESSAGE` sends the same one line as a text message from the Messages app on the Mac to a phone number in the form `+12025550123` or an Apple ID mail address, usually your own. Messages must be signed in to iMessage on the Mac, and the first send may ask you to let Memo (node) control Messages. The line is fixed, for example `Memo: main is blocked: answer its question on the Agents page`; no memo text goes out. A wrong value is logged at start, and the text messages stay off. The handle and the text reach AppleScript as arguments, never inside the script, and a failed send is logged without the handle and is not retried.

## The System page

Open `http://127.0.0.1:3280/system`. The page shows how the installation works, and it lets the owner edit the rules of the agents in the browser. It is for the owner only: each of its routes needs the full token or the Tailscale login of the owner.

The page reads two places: the vault (`MEMO_VAULT`; the default is `~/memo-vault`), a git repository whose remote is GitHub, and the live charters in `local/charters/` (`MEMO_LOCAL`). The code is in `src/system.js`.

- **Sync with GitHub.** Two lines: the vault on the Mac against its GitHub remote (commits not pushed, commits not pulled, files changed and not committed, the time of the last fetch), and the Memo code (the local branch `main`, or `MEMO_CODE_BRANCH`, against the same branch of the remote `origin`, or `MEMO_CODE_REMOTE` and `MEMO_CODE_REMOTE_BRANCH`, compared with `git ls-remote`; until your copy of the kit has a remote, this line shows a failed check). The server checks every 5 minutes in the background with a time limit, and the page shows the last result, so the page never waits on the network. "Check now" runs a check at once. Green is in sync, amber is out of sync, red is a failed check.
- **Dashboard.** Counts from the vault: people, funders, projects, meetings this month, open Asana tasks (from the header of `asana/tasks.md`), lessons out of 40, agent skills and how many were not used in 30 days, hand-made skills, and the newest entry of `scripts/sync-log.md` with its failures.
- **System map.** `summaries/system-map.html`, shown in a closed frame, with its build time and a link to the published copy (`system_map_url` in `scripts/sync-state.md`). "Rebuild the map" runs `python3 scripts/system-map/build.py` in the vault. The kit ships no build script: while the vault has no `scripts/system-map/build.py` and no map file, the page does not show this card and the server runs nothing. The rebuilt file is not committed by the server; the nightly sync commits it, and the sync line says so.
- **Charters, lessons, skills.** The page loads a list first. A file loads when the owner opens it, as Markdown, with "Edit". The charters of the long agents in `agents.json` are the live files in `local/charters/`; the team charter, `local/charters/team.md`, is on the page when the file exists, as "Team charter, all agents", and an agent with `"charter": "team"` has no charter of its own on the page while `team.md` exists (a shared charter that an agent names but that is missing shows as missing); the charter of an hourly cloud agent is `scripts/cloud-agent.md` in the vault, on the page only when that file exists (the kit ships none); the lessons are `scripts/lessons.md`; the agent skills are `skills/agent/<name>/SKILL.md`. Hand-made skills (`skills/<name>/`) are view-only.

**Skills, a trial (memo 1418).** The server builds a skill registry on request (`src/registry.js`): the agent skills of the vault (`skills/agent/<name>/SKILL.md`), the pinned copies of the hand-made skills (`skills/<name>/`), and, for each long agent of `agents.json`, the skills its Claude account has (`<config>/skills/` and the newest folder of `<config>/skills/synced/`, without the skills that come with Claude) and the skills folder of its work folder. Each skill has its name, its description, its kind, the agents that have it, and a category: one of the workstream codes, from the optional frontmatter key `category`, or else a guess from the words of the skill, marked "guessed". On this page each skill shows its workstream and "In all agents" or "Needs spreading: missing on <agent>", and the buttons over the list show the skills of one workstream. In the Inbox, a memo whose words match a skill gets a small four-point star in its row and a card in the open memo: the likely skill, the words that matched, and whether the agent of the memo has the skill. The match is a rule on words, with no model: two words of the name of the skill, one of them in the title or the first paragraph, or a phrase of the optional key `triggers`; at most one skill per memo. A memo that no skill matches, in a workstream where three or more memo titles start the same way, gets a suggestion for a new skill. The pencil of the card opens the skill here: `/system#file=skill:<name>&edit=1` opens the editor, `/system#file=hand:<name>` opens a hand-made skill as a view (never the editor), and `/system#new=<name>` opens a draft in the schema of `skills/README.md`, which is written only by its Save, through the same safe save. `GET /api/skills` and `GET /api/skills/predictions` give descriptions and never the text of a skill, and they are not among the routes that the ledger copies to GitHub.

**Skill dialog, ratings and versions (memo 1420).** The pencil of a skill, in the skill card of the Inbox and next to each skill on the System page, opens the skill in a dialog on the page it is on (`ui/skillmodal.js`, a `<dialog>`: the focus stays inside, Escape closes it, the focus goes back to the pencil; with Command, Control or Shift the pencil is the link to the System page, and an address `/system#file=...` still opens the file in the page). The dialog has the text (the editor with the safe save for an agent skill, a view for a hand-made one, a draft for a suggested one), then the rating, then the old versions. A rating is the owner's score from 1 to 5 of the text the skill has now, with what she would change: one line of `skills/ratings.jsonl` in the vault (`{ at, skill, kind, version, hash, score, notes, memo }`; append only, kept for ever), committed alone and pushed (`POST /api/skills/rate`). A rating with words also sends one memo from her to the agent `main`, "Skill feedback: <name>", workstream SYS, that asks for the new version. The card shows "Rate this skill" while the text of now has no rating. Before a save of a skill writes the new text, the old text goes to `skills/.versions/<name>/<YYYY-MM-DD-HHMM>-<hash8>.md` in the same commit (`src/skilllog.js`); an agent that edits a skill by hand runs `scripts/skill-version <name>` first. Old versions are text and are never deleted. `GET /api/skills/log?name=` gives the versions with their ratings. A skill not used in 30 days, or never, has the mark "Old · may change": an agent skill by its `last_used`; a hand-made skill by its `last_used` if it has one, else by the newest closed memo or rating that names it. `node scripts/skills-sync.js [--dry-run]` is the nightly newest-version sync of the hand-made skills: it compares the copies in `~/.claude/skills/synced` (newest round), `~/.claude/skills/<name>`, `~/.claude-second/skills/<name>` and `skills/<name>` of the vault, keeps what it replaces in `skills/.versions`, copies the newest to the vault and to `~/.claude-second/skills`, never writes a `synced/` folder, and prints one line with the counts. None of these routes is among the reads of the ledger.

**Rule documents in the dialog, with the latest change (memo 1513).** The dialog opens every rule document of the System page, not only a skill: a charter (`charter:team`, `charter:cloud`, `charter:<agent>`), the shared lessons (`lessons`), an agent skill (`skill:<name>`) and a hand-made skill (`hand:<name>`, view only). A memo links to one with `[the team charter](/system#file=charter:team&edit=1)`; in the Inbox the link opens the dialog (with Command, Control or Shift, and on a page with no dialog, it opens the file in the System page). The dialog starts with **Latest change**: the text the document had before its latest change against the text it has now, as a red-tinted part "Removed:" and a green-tinted part "Added:" with a few lines around each and a mark on the words that differ; then the text with the same safe save; for a skill, the rating and the old versions. `GET /api/system/previous?id=` (the owner only) finds the text before: for a live charter the newest file of `local/charters/.history` that differs (else the git history of its backup in the vault); for a vault file its git history, and for a skill also `skills/.versions`, whichever change is newer. With no earlier text, the dialog says so. An agent changes a live charter in its file, and `local/` is in no repository, so the server remembers the text of each live charter from its start and, when the file changes, keeps the text that was there in `local/charters/.history` (a change while the server is off is not seen).

In the text of a memo, three fenced blocks show a change (`ui/markdown.js`). A block with the language `diff`: lines that start with `-` are "Removed:", lines that start with `+` are "Added:", the others are context. A block with the language `old` is a red-tinted box "Now (the text to replace)", and a block with the language `new` is a green-tinted box "New text, copy this" with a copy button for exactly its text (memo 1523); a line range after the word, as in `old lines 113-115`, shows as "Lines 113 to 115". The words are text of the page, so a screen reader says them, and the colors are the variables of the two themes.

**Line numbers in the editor (memo 1527).** The editor of a charter, the lessons or a skill, on the System page and in the dialog, has a gutter with the number of each line at the left of the text (`ui/linenumbers.js`, one module for both). The numbers are those of the file on the disk, as `grep -n` gives them: line 1 is the first line, and the frontmatter counts. A long line still wraps; its number stands at its first row. Over the text is the field **Go to line**: type `113` (or a range, `113-115`), press Enter or **Go**, and the editor moves there, puts the cursor at the start of the line, and marks the line for two seconds; a line under the field says "Line 113 of 240". The gutter is not read by a screen reader. In a memo that links to a rule document, the line range in the label of an `old` or `new` block ("Lines 113 to 115") is a link that opens that document in the dialog at those lines. A save works as before.

A save is safe in four ways. The server has a fixed list of files; a request names a file by its id, and a skill folder must be a plain folder inside `skills/agent/` (no link that points out). The save carries the hash of the version the owner started from; if the file changed since (another agent edited it), the server refuses with status 409, nothing is written, and the page offers to load the new version while her text stays in the box. A save of a vault file runs `git pull --rebase` (no force, no reset; a rebase that stops is aborted), writes the file, commits that one file with the message "Edit <file> from the System page (<your name>)" (`MEMO_OWNER_NAME`), and pushes; if the push fails, the commit stays on the Mac, the page shows the exact error, and the sync line shows "1 commit not pushed". A save of a live charter writes `local/charters/<name>.md` (the agents read it at their next start), keeps the old text in `local/charters/.history/<name>-<time>.md`, and commits a copy to the vault at `scripts/charters/<name>.md`, so the charters have a backup.

The server watches the charters, `scripts/` (the lessons and the other sources of the map), and `skills/` with `fs.watch`. About 10 seconds after a change from any source, it rebuilds the map with a time limit, refreshes the dashboard, and raises a version number. The page asks for the version every 30 seconds and loads the new data when it changed. A failed build keeps the last good map and shows the error line.

## An agent on a different computer

A remote agent has its session on a different computer from the server. Use it when the server is always on (for example in the cloud) and some work needs a computer that is not always on.

On the server:

1. Add the agent to `agents.json` with the kind `remote`, for example `{ "name": "mac", "kind": "remote" }`.
2. Add its charter, `charters/mac.md`.
3. Start the server again.

On the computer of the agent:

1. Get this repository. No server runs there.
2. Make `.env` with `MEMO_URL` (the address of the server) and `MEMO_TOKEN`, then run `chmod 600 .env`.
3. Add the agent to `local/agents.json` with its `dir` and `model`, for example `{ "name": "mac", "kind": "remote", "dir": "~", "model": "claude-opus-5-5" }`.
4. Run `scripts/remote-agent.sh mac`, or run it from a LaunchAgent, as the server does with `scripts/start.sh`.

The script starts the session of the agent in the tmux session `memo-mac` when the server answers. Memos to the agent wait on the server while its computer is offline. The Agents page shows "Online" for 2 minutes after the last request of the agent. The server cannot start or stop the session; stop it on its computer with `tmux kill-session -t memo-mac`.

The remote agent uses `MEMO_TOKEN`, which can do all operations. Give it only to a computer that you trust.

## An agent with a different Claude account

Each long agent is a Claude Code session, and Claude Code takes its sign-in from its configuration directory (`CLAUDE_CONFIG_DIR`; the default is `~/.claude`). An agent can use a second Claude account, for example a second subscription for heavy work or for the hours when the first account is at its limit. Give the agent its own directory in `agents.json`:

```json
{ "name": "second", "kind": "long", "dir": "~/memo-work", "model": "claude-opus-5-5", "env": { "CLAUDE_CONFIG_DIR": "~/.claude-second" } }
```

Then sign in one time, with the same directory: `CLAUDE_CONFIG_DIR=~/.claude-second claude`, then `/exit`. Check it with `CLAUDE_CONFIG_DIR=~/.claude-second claude auth status`. The agent needs a charter, `charters/second.md`, as each agent does. The owner sends work to it with `--to second`, or on the Inbox page, and starts and stops it on the Agents page as the other agents.

`env` is optional. Its names are in capitals, its values are text on one line, and a value that starts with `~` gets the home directory. `scripts/agent.sh` exports the variables before it starts Claude Code, so they also apply to a remote agent. `MEMO_AGENT_DRY=1 scripts/agent.sh second` shows them as the third part of its output, before the options of claude. The connectors of claude.ai come with the sign-in, so an agent with a second account sees the connectors of that account.

`chrome` is optional too. The session of a long agent starts with the Claude in Chrome integration (`claude --chrome`), which gives the agent the browser tools of the Claude in Chrome extension. `"chrome": false` starts the session of that agent without it; the default is on. The last part of the dry run shows the options of claude, for example `--model claude-opus-5-5 --chrome`.

## Your own files: `local/`

The files `agents.json`, `workstreams.json` and `charters/*.md` in the repository are examples. Put your own versions in `local/`, which git ignores:

```sh
mkdir -p local/charters
cp agents.json local/agents.json
cp workstreams.json local/workstreams.json
cp charters/*.md local/charters/
```

The server and the scripts use a file in `local/` when it exists, and the example when it does not. An optional file `local/agent-settings.json` holds Claude Code settings for the agent sessions, for example `{"deniedMcpServers": [{"serverName": "slack"}]}`. A charter says what an agent can do without a question, so write it with care. A shared charter for all agents is `local/charters/team.md`; see "The Agents page" for the field `charter` in `agents.json`.

## The command `memo`

```sh
scripts/memo send --from main --to owner --impact 4 --effort micro "Approve the deploy?"
scripts/memo send --from owner --to main "Update the README of the website."
scripts/memo send --from main --to owner --impact 3 --effort micro --re 355,349 "Done: both charters have the line."
scripts/memo send --from main --to owner --impact 3 --effort short --ws OPS --title "Insurance renewal" "Sign the renewal form?"
scripts/memo list --to main
scripts/memo reply 12 "Yes."
scripts/memo close 12 "Done."
scripts/memo close OPS-14 "Done."
scripts/memo edit 12 "A new text for an open memo."
scripts/memo note 12 --from main "The price is $14 each month."
scripts/memo compact 12 --from main -- "- [ ] Pay the invoice. Next: approve the quote."
scripts/memo ack 12
scripts/memo status --as main "I update the README of the website."
scripts/memo helper --as main start "Vault sync" "fable 5.1"
scripts/memo helper --as main done "Vault sync"
scripts/memo recap --as main "The README is complete. Next: the tests."
scripts/memo wait --as main --hold 12
scripts/memo forward 12
scripts/memo image ~/Desktop/shot.png "The new page"
scripts/memo file 0123456789abcdef.pdf ~/Downloads
scripts/memo tz
scripts/memo search --limit 10 venue boston
```

`--re` names the memos that a new memo answers or continues, for the Back and Forward buttons of the Inbox ("The thread of a memo"). A memo that says "memo 355" in its text is linked to memo 355 without it.

### Workstream codes

A memo can carry a workstream code, so the owner and the agents speak of `OPS-14, Insurance renewal` and not of memo 906. The codes are in `workstreams.json`, an object of code to description; the file in the repository is an example (REL, SPEC, FUND, OPS, PROG, COMM, SYS, ME), and your own goes in `local/workstreams.json` (see "Your own files"). A code is 2 to 8 capital letters or digits.

- `memo send --ws OPS` gives the memo the next number in that code: OPS-1, OPS-2, then FUND-1. The case of the argument does not matter. A code that is not in the file is refused, with the list of the codes.
- A code that leaves the file is retired, not gone: the memos that have it keep it, show it, link by it and answer to it (`memo close GEN-6`, `memo search GEN-6`), a reply with `--re` stays in it and `memo compact` keeps it. Only `memo send --ws GEN` is refused.
- With `--re` and no `--ws`, the memo takes the code of the first origin that has one: a reply stays in its workstream. `memo compact` keeps the code of the old memo too. A memo with no code shows its number, as before; the old memos keep their numbers and get no code.
- Everywhere a command takes an id, it takes a code too: `memo close OPS-14`, `memo ack OPS-14`, `memo note OPS-14 --from main "..."`, `memo brief OPS-14 --next "..."`, `memo send --re OPS-14`, `memo wait --hold 12,OPS-14`. The API takes the code in the place of the id in the same way (`POST /api/close {id: "OPS-14"}`), and each memo in an answer has `ws`, `ws_n` and `code` ("OPS-14", or null).
- The command lines show the code with the number: `#906 OPS-14 from main to owner`, `Memo 906 OPS-14 is sent to owner.` The Inbox shows the code as a small tag before the name of the memo in the list, and at the top of the open memo.
- `memo search OPS-14` finds the memo with that code (first), and the memos that name it. A code in the text of a memo, its reply or a note ("see OPS-14") links the two memos for the thread, as "memo 906" does.
- The database has the columns `ws` and `ws_n` in `memos`, added at the start of the server when they are not there, with a unique index on the two. Nothing else changes in the database.

`memo search` lists the memos, open and closed, that hold each word in the text, the reply, the title or a note, newest first. The ledger also writes all memos to `state/archive.json` on its branch, at most once an hour, so the cloud agent can search them when the computer is off.

`memo wait` uses no model tokens. It exits with code 0 when a new memo arrives or a memo of the agent gets a result. It exits with code 2 at its time limit.

## Data

The database is `data/memo.db`. Git ignores `data/`. To make a backup, run: `sqlite3 data/memo.db ".backup data/memo-backup.db"`

## The event log

The table `events` of the database keeps one row for each decision on a memo, for training data later: who did what, when, on which memo. A row has `id`, `at` (the time, ISO, UTC), `kind`, `memo_id`, `actor` (the owner, the name of an agent, or `server`) and `payload` (a JSON object). The payload starts with the facts of the memo after the change (`sender`, `recipient`, `code`, `title`, `impact`, `effort`), then the facts of the event.

| Kind | When | Facts in the payload |
|---|---|---|
| `send` | A memo is created. | `text`, `next`, `due`, `tags`, `re`, `trusted`; `compacted_from` or `forwarded_from` for a memo that a compact or a forward made |
| `reply`, `close` | The memo gets its reply, or closes. | `text`; for the owner, on a memo to her: `seconds_since_sent`, `seconds_since_first_seen`, `seconds_since_inbox_load` |
| `note` | A note in an open memo. | `note_id`, `text` |
| `edit` | The sender changes the text. | `old_text`, `new_text` |
| `brief` | The title or the next step changes. | `old_title`, `new_title`, `old_next`, `new_next` |
| `compact` | Shorten: the old memo closes into a new one. | `new_memo_id`, `old_text`, `new_text` |
| `ack` | The sender read the result, or the notes of an open memo. | `of`: `result` or `notes` |
| `impact` | Less or More in the Inbox, when the impact changes. | `old_impact`, `new_impact` |
| `tag`, `untag` | The tags of the memo change. | `tag`, `tags` |
| `postpone` | Postpone, or Bring back now. | `date`, `until` (both `null`: back now) |
| `check` | A check box of the memo. | `n`, `on` |
| `seen` | The memo was on the screen of the owner and lost its "new" or "updated" tag. | |
| `move` | The handover job moved the memo to the other agent. | `from`, `to` |
| `inbox_load` | The owner loaded the Inbox (no memo). | `time_zone` |

The rules of the log:

- **Append only.** No code changes or removes a row, and triggers in the database refuse an `UPDATE`, a `DELETE` and an `INSERT OR REPLACE` over a row.
- **One transaction.** The store (`src/memos.js`) writes the event in the transaction of the change itself. A change that fails leaves no event, and an event that cannot be written undoes the change.
- **The actor.** The owner and the agents use the same token, so a request names who acts in `by`: the Inbox page gives the owner, and `memo reply`, `close`, `edit`, `brief`, `ack`, `tag`, `untag` and `postpone` take `--as <name>`. With no name the log takes the party the change belongs to (the recipient for a reply or a close, the sender for an edit, a brief or an ack, the owner for a tag, a postpone or an impact) and the payload says `"actor_inferred": true`. The restricted token is always `liaison`.
- **The time to answer.** A reply or a close by the owner says how many seconds passed since the memo was sent, since it was first on her screen (its first `seen` event), and since she last loaded the Inbox (the last `inbox_load` event). A time that the log does not know is `null`.
- **The old memos.** The log starts with the first start of a server that has it. Nothing is made up for the memos from before. Before the log a reply had no time of its own (only `closed` of its memo); from now on the `reply` event has it.

**The export.** `scripts/export-events.js` writes the events of one day as one JSONL file, `<folder>/YYYY-MM-DD.jsonl`, one event in each line. It only reads the database, so it can run while the server runs, and a second run for the same day gives the same file.

```sh
node --disable-warning=ExperimentalWarning scripts/export-events.js
```

With no option it writes the day before today. The folder is the first argument or `--out <folder>`, then `MEMO_EVENTS_DIR`, then `raw/memo-events` in the vault (`MEMO_VAULT`). `--day YYYY-MM-DD` gives a different day. The day is a day of the owner: `--tz <zone>`, then the zone of her browser (`data/client-tz.json`), then `MEMO_TZ`, then the zone of the computer. By default the file has no text that a person or an agent wrote in a memo, because that text can hold personal data: the body of a memo, a reply, a close text, a note, the two texts of an edit or a compact, and the next step of a brief are left out, and the length of each is there as `text_length`, `old_text_length`, and so on. The ids, the kinds, the times, the actors, the impact, the effort, the workstream code, the title and the tags stay. `--with-text` puts the texts in too. Run it each night soon after midnight; the script sets up no schedule itself.

## Tests

```sh
npm test
```

## A scan before each push

If you push your checkout to a public repository, install the scan as the pre-push hook:

```sh
ln -s ../../scripts/pre-push-scan.sh .git/hooks/pre-push
```

The hook reads the lines that the commits of a push add, and the commit messages. It stops the push if it finds a token, a private key, a home directory, a tailnet name, a mail address, or a phone number. Put your own names, addresses, host names, and account ids in `local/scan-patterns.txt`, with one extended regular expression in each line. If a line is not personal, put an expression for it in `local/scan-allow.txt`. Git ignores the two files.

To scan a range by hand: `scripts/pre-push-scan.sh --range origin/main..main`

## Files

| File | Function |
|---|---|
| `src/rank.js` | The queue order. |
| `src/memos.js` | The memo rules, and the event of each change for the event log. |
| `src/events.js`, `scripts/export-events.js` | The export of the event log: the events of one day as a JSONL file. |
| `src/workstreams.js`, `workstreams.json` | The workstream codes of the memos (OPS-14), and the example list. Your own is `local/workstreams.json`. |
| `src/ticks.js` | The ticks: their schedule and their place in the queue. |
| `src/images.js`, `src/files.js` | The stores of images and other attached files. |
| `src/videos.js`, `src/frames.js`, `scripts/video-frames.swift` | The short-lived store of videos (48 hours, or until the memo closes) and their still frames, made with AVFoundation. |
| `src/ical.js` | Reads the iCal calendar for the Today card. |
| `ui/calendar.js` | The day grid of the Today card: places and text of the events. |
| `src/agents.js` | Status, recap, and tmux control of the agents. |
| `ui/pets.js`, `ui/petview.js`, `src/pets.js` | The pets of the agents: the feeling rule and the row mapping, the drawings, and the pictures from the pets folder. |
| `src/usage.js`, `ui/pacing.js`, `ui/usage.js` | The usage of the Claude account of each agent (session, week, Fable), from `claude -p /usage`, with the burn rate; the headroom, the states and the words of the pacing; the lines of the card. |
| `src/handover.js` | The handover job: an agent at the limit of its account hands the memos it never got to the other agent. |
| `src/fable-spare.js` | The Fable to spare memo: an agent whose Fable week will end with points unused gets one memo per window that asks for a model trial. |
| `src/followups.js` | The meeting follow-ups: the agent main gets one memo 30 minutes after each meeting of a work calendar ends. |
| `src/system.js` | The System page: the sync state, the dashboard, the map, and the files the owner edits. |
| `src/app.js` | The HTTP routes and the two tokens. |
| `scripts/memo.mjs` | The command-line client. |
| `scripts/agent.sh` | Starts the session of a long agent. |
| `scripts/scheduled.sh` | For launchd: sends a scheduled memo (the nightly sync, the daily review) and restarts the agents at night. |
| `scripts/pre-push-scan.sh` | The scan for personal data and secrets before a push. |
| `charters/` | Example instructions of the agents. Your own are in `local/charters/`, one file for each agent or one `team.md` for all. |
| `local/` | The files of your installation. Git ignores it. |
