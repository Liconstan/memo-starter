# Variables

Every placeholder of the kit and of its vault template (the repository second-brain-starter), in one list. This file is made from `variables.json` by `npm run setup -- --docs`; change that file, not this one.

**How to read a placeholder.** A name in capitals in square brackets, for example `[YOUR_NAME]`, stands for a value that only you know. `npm run setup` asks you for each one and fills it in everywhere. You do not edit the files by hand.

- **Required**: setup asks until it has a value (most have a default; press Return to take it).
- **Optional**: press Return to skip it. The placeholder then stays in the files in capitals, setup lists it at its end, and an agent that meets it asks you once by memo.
- **Fill in later**: the settings of the skills and the vault templates (a CRM, a program, a channel, a bookkeeping sheet). Setup does not ask them, so the first setup stays short. Fill one in when you start to use its skill: `npm run setup -- --all`, or let the agent ask you by memo when it meets it.
- Run `npm run setup` again at any time to change an answer.

A second kind of marker is not a placeholder: words in curly brackets, for example `{Name}` or `{one line}` in the vault templates, are slots that the agents fill in for each person, meeting or project. Setup leaves them alone.

Count: 80 variables, 26 required, 15 optional, 38 fill in later, 1 made by setup.

## You

| Placeholder | What it means | Example | Required | Default | Used in |
|---|---|---|---|---|---|
| `[YOUR_NAME]` | Your full name, as the agents should write it. | Sam Rivera | required | none | `app/.env.example`, `templates/local/charters/team.md`, `templates/local/scan-patterns.txt`, `second-brain-starter/vault/CLAUDE.md`, `second-brain-starter/vault/README.md`, `second-brain-starter/vault/skills/agent/signable-docs/SKILL.md`, `README.md` |
| `[YOUR_FIRST_NAME]` | The name the agents call you in charters, playbooks and skills. | Sam | required | first word of YOUR_NAME | `templates/local/charters/team.md`, `second-brain-starter/vault/CLAUDE.md`, `second-brain-starter/vault/README.md`, `second-brain-starter/vault/drafts/_README.md`, `second-brain-starter/vault/email/_template.md`, `second-brain-starter/vault/funders/_org-facts.md`, `second-brain-starter/vault/me/goals.md`, `second-brain-starter/vault/me/key-links.md`, `second-brain-starter/vault/me/time-tracking-projects.md`, `second-brain-starter/vault/me/writing-voice.md`, `second-brain-starter/vault/meetings/_template.md`, `second-brain-starter/vault/people/_index.md`, `second-brain-starter/vault/people/_settled.md`, `second-brain-starter/vault/people/_team.md`, `second-brain-starter/vault/people/_template.md`, `second-brain-starter/vault/people/_to-cover.md`, `second-brain-starter/vault/projects/_index.md`, `second-brain-starter/vault/projects/example-workstream/overview.md`, `second-brain-starter/vault/scripts/daily-review.md`, `second-brain-starter/vault/scripts/lessons.md`, `second-brain-starter/vault/scripts/meeting-followups.md`, `second-brain-starter/vault/scripts/nightly-sync.md`, `second-brain-starter/vault/scripts/slack-channels.md`, `second-brain-starter/vault/scripts/sync-state.md`, `second-brain-starter/vault/scripts/task-predictions.md`, `second-brain-starter/vault/skills/README.md`, `second-brain-starter/vault/skills/agent/application-rolling-review/SKILL.md`, `second-brain-starter/vault/skills/agent/check-work/SKILL.md`, `second-brain-starter/vault/skills/agent/email-reply-drafts/SKILL.md`, `second-brain-starter/vault/skills/agent/event-guest-import/SKILL.md`, `second-brain-starter/vault/skills/agent/external-newsletter-submissions/SKILL.md`, `second-brain-starter/vault/skills/agent/gifts-and-pledges-tab/SKILL.md`, `second-brain-starter/vault/skills/agent/guest-list-crm-match/SKILL.md`, `second-brain-starter/vault/skills/agent/inbox-cleanup/SKILL.md`, `second-brain-starter/vault/skills/agent/ios-shortcut-install/SKILL.md`, `second-brain-starter/vault/skills/agent/model-trial/SKILL.md`, `second-brain-starter/vault/skills/agent/signable-docs/SKILL.md`, `second-brain-starter/vault/skills/agent/skill-audit/SKILL.md`, `second-brain-starter/vault/skills/agent/slack-message-drafts/SKILL.md`, `second-brain-starter/vault/skills/my-writing-voice/SKILL.md`, `second-brain-starter/vault/skills/slack-announcement/SKILL.md`, `second-brain-starter/vault/skills/slack-announcement/references/channel-map.md`, `second-brain-starter/vault/summaries/days/_template.md`, `second-brain-starter/vault/writing/_index.md` |
| `[MEMO_OWNER]` | Your short name in Memo commands: `memo send --to sam`. Small letters, digits and hyphens only; it must start with a letter. | sam | required | YOUR_FIRST_NAME in small letters | `app/.env.example`, `templates/local/charters/team.md`, `second-brain-starter/vault/scripts/daily-review.md`, `second-brain-starter/vault/scripts/nightly-sync.md` |
| `[YOUR_ORG]` | The organisation or business your work is for. For personal use only, write: my own projects. | Example Org | required | none | `templates/local/charters/team.md`, `templates/local/workstreams.json`, `second-brain-starter/vault/CLAUDE.md`, `second-brain-starter/vault/funders/_org-facts.md`, `second-brain-starter/vault/funders/_template.md`, `second-brain-starter/vault/me/key-links.md`, `second-brain-starter/vault/people/_team.md`, `second-brain-starter/vault/people/_template.md`, `second-brain-starter/vault/projects/_index.md`, `second-brain-starter/vault/scripts/daily-review.md`, `second-brain-starter/vault/scripts/nightly-sync.md`, `second-brain-starter/vault/skills/README.md`, `second-brain-starter/vault/skills/agent/application-rolling-review/SKILL.md`, `second-brain-starter/vault/skills/agent/event-guest-import/SKILL.md`, `second-brain-starter/vault/skills/agent/external-newsletter-submissions/SKILL.md`, `second-brain-starter/vault/skills/agent/gifts-and-pledges-tab/SKILL.md`, `second-brain-starter/vault/skills/agent/guest-list-crm-match/SKILL.md`, `second-brain-starter/vault/skills/agent/inbox-cleanup/SKILL.md`, `second-brain-starter/vault/skills/agent/signable-docs/SKILL.md`, `second-brain-starter/vault/skills/agent/skill-audit/SKILL.md`, `second-brain-starter/vault/skills/my-writing-voice/SKILL.md`, `second-brain-starter/vault/skills/nonprofit-finance-copilot/SKILL.md`, `second-brain-starter/vault/skills/slack-announcement/SKILL.md`, `second-brain-starter/vault/skills/slack-announcement/references/channel-map.md` |
| `[YOUR_ROLE]` | Your role there, in a few words. | Executive Director | optional | none | `templates/local/charters/team.md`, `second-brain-starter/vault/CLAUDE.md`, `second-brain-starter/vault/skills/agent/signable-docs/SKILL.md` |
| `[YOUR_EMAIL]` | Your work email address: the mailbox the agents read and draft in. | sam@example.org | required | none | `templates/local/scan-patterns.txt`, `second-brain-starter/vault/email/_template.md`, `second-brain-starter/vault/skills/agent/email-reply-drafts/SKILL.md`, `second-brain-starter/vault/skills/agent/inbox-cleanup/SKILL.md` |
| `[YOUR_WORK_DOMAIN]` | The part of your work email after the @. Only a calendar on this domain gives meeting follow-ups, so a personal calendar gives none. | example.org | required | the domain of YOUR_EMAIL | `app/.env.example`, `templates/local/scan-patterns.txt`, `second-brain-starter/vault/scripts/meeting-followups.md`, `README.md` |
| `[YOUR_TIMEZONE]` | Your time zone, as an IANA name. | America/New_York | required | the time zone of this computer | `app/.env.example`, `second-brain-starter/vault/scripts/daily-review.md`, `second-brain-starter/vault/scripts/lessons.md`, `second-brain-starter/vault/skills/agent/email-reply-drafts/SKILL.md`, `README.md` |
| `[YOUR_CITY]` | The place whose sunrise and sunset turn the pages light and dark. A city name, for the tooltip of the Theme button. Skip it and the pages follow Greenwich; the Theme button still holds light or dark. | Lisbon | optional | none | `templates/local/place.js` |
| `[YOUR_LATITUDE]` | The latitude of that place, in degrees, north positive. Search the web for: latitude longitude <your city>. | 38.72 | optional | none | `templates/local/place.js` |
| `[YOUR_LONGITUDE]` | The longitude of that place, in degrees, east positive (so the Americas are negative). | -9.14 | optional | none | `templates/local/place.js` |
| `[WRITING_STYLE_NOTES]` | How you want text written for you to read, in one line. The agents follow it in every memo. | Short sentences. The point first. No jargon. | required | Short sentences. The point first, then the reason. Plain words. | `templates/local/charters/team.md`, `second-brain-starter/vault/CLAUDE.md`, `second-brain-starter/vault/skills/my-writing-voice/SKILL.md` |

## The computer that runs Memo

| Placeholder | What it means | Example | Required | Default | Used in |
|---|---|---|---|---|---|
| `[MAC_USERNAME]` | The account name of your user on the Mac that runs Memo (the name of your home folder). In Terminal on that Mac, the command whoami prints it. | sam | required | the user that runs setup | `templates/local/scan-patterns.txt`, `second-brain-starter/vault/README.md`, `README.md` |
| `[MEMO_APP_PATH]` | The full path of the app folder of this kit on that Mac. Setup finds it; change it only if you will move the kit. | /Users/Shared/memo-starter/app | required | the app folder of this kit | `templates/local/charters/team.md`, `second-brain-starter/vault/scripts/nightly-sync.md`, `second-brain-starter/vault/skills/README.md`, `templates/launchd/memo.daily-review.plist`, `templates/launchd/memo.nightly-restart.plist`, `templates/launchd/memo.server.plist`, `templates/launchd/memo.vault-sync.plist`, `app/docs/gpt-desktop.md` |
| `[VAULT_PATH]` | The folder of your vault: the notes that the agents keep about your meetings, mail, people and projects. Setup creates it from vault-template/. | ~/memo-vault | required | ~/memo-vault | `app/.env.example`, `templates/local/agent-settings.json`, `templates/local/charters/team.md`, `second-brain-starter/vault/CLAUDE.md`, `second-brain-starter/vault/README.md`, `templates/launchd/memo.daily-review.plist`, `templates/launchd/memo.vault-sync.plist`, `README.md` |
| `[AGENT_WORK_DIR]` | The folder the agents start in, for their scratch files. Setup creates it. | ~/memo-work | required | ~/memo-work | `templates/local/agents.json`, `templates/local/charters/team.md`, `second-brain-starter/vault/skills/README.md`, `README.md` |
| `[OUTBOX_PATH]` | The folder where an agent puts a file that you must open yourself (a PDF, a spreadsheet, a page). Setup creates it. | ~/Memo Outbox | required | ~/Memo Outbox | `templates/local/agent-settings.json`, `templates/local/charters/team.md`, `second-brain-starter/vault/scripts/lessons.md`, `second-brain-starter/vault/skills/agent/event-guest-import/SKILL.md`, `second-brain-starter/vault/skills/agent/guest-list-crm-match/SKILL.md`, `README.md` |

## Tailscale (phone and remote access)

| Placeholder | What it means | Example | Required | Default | Used in |
|---|---|---|---|---|---|
| `[TAILSCALE_HOST]` | The full Tailscale name of the Mac that runs Memo. In the Tailscale admin console, on the Machines page, click the Mac: the name ends in .ts.net. Skip it until Tailscale is installed (README step 8), then run setup again. | mac-mini.tail1a2b3c.ts.net | optional | none | `app/.env.example`, `templates/local/scan-patterns.txt`, `README.md` |
| `[TAILSCALE_LOGIN]` | The login name of your Tailscale account: the email address or name at the top right of the Tailscale admin console. Only this login opens Memo with no token. | sam@example.org | optional | none | `app/.env.example`, `README.md` |
| `[NTFY_TOPIC]` | A long random name for phone alerts through the ntfy app, when an agent is blocked. Anyone who knows the name can read the alerts, so make it hard to guess. Skip it for no alerts. | memo-alerts-8f3k2n9x4q7w | optional | none | `app/.env.example`, `README.md` |

## Claude accounts and agents

| Placeholder | What it means | Example | Required | Default | Used in |
|---|---|---|---|---|---|
| `[MAIN_AGENT_MODEL]` | The model of the agent main: a Claude Code model alias (opus, sonnet) or a full model id. | opus | required | opus | `templates/local/agents.json` |
| `[SECOND_AGENT_MODEL]` | The model of the agent second. | opus | required | opus | `templates/local/agents.json` |
| `[HELPER_MODEL]` | The default model alias for the helpers (subagents) that read sources and write summaries. A cheaper tier keeps your usage limits for the hard work. | sonnet | required | sonnet | `templates/local/charters/team.md`, `second-brain-starter/vault/scripts/lessons.md`, `second-brain-starter/vault/scripts/nightly-sync.md`, `second-brain-starter/vault/skills/README.md`, `second-brain-starter/vault/skills/agent/skill-audit/SKILL.md` |
| `[FIRST_CLAUDE_ACCOUNT_EMAIL]` | The email address of your first Claude account, which runs the agent main. | sam@example.org | required | YOUR_EMAIL | `templates/local/charters/team.md`, `second-brain-starter/vault/CLAUDE.md`, `README.md` |
| `[SECOND_CLAUDE_ACCOUNT_EMAIL]` | The email address of your second Claude account, which runs the agent second. Skip it if you have one account: both agents then share it and its limits. | sam+agent@example.org | optional | none | `templates/local/charters/team.md`, `second-brain-starter/vault/CLAUDE.md`, `README.md` |
| `[SECOND_CLAUDE_CONFIG_DIR]` | The folder where Claude Code keeps the sign-in of the second account. With one account only, answer ~/.claude. | ~/.claude-second | required | ~/.claude-second | `app/.env.example`, `templates/local/agents.json`, `templates/local/charters/team.md`, `second-brain-starter/vault/scripts/daily-review.md`, `second-brain-starter/vault/scripts/nightly-sync.md`, `README.md` |

## GitHub backup of the vault

| Placeholder | What it means | Example | Required | Default | Used in |
|---|---|---|---|---|---|
| `[GITHUB_USERNAME]` | Your GitHub user name, for the private backup of the vault. Skip it for no backup; the nightly sync then commits on the Mac only. | sam-rivera | optional | none | `README.md` |
| `[VAULT_GITHUB_REPO]` | The private GitHub repository that backs up the vault, as user/name. | sam-rivera/memo-vault | optional | GITHUB_USERNAME/memo-vault | `second-brain-starter/vault/CLAUDE.md`, `second-brain-starter/vault/README.md`, `second-brain-starter/vault/scripts/nightly-sync.md`, `README.md` |

## Your tools

| Placeholder | What it means | Example | Required | Default | Used in |
|---|---|---|---|---|---|
| `[TASK_MANAGER]` | The tool that holds your tasks and is the source of truth for them. It needs a connector on your Claude account. | Asana | required | Asana | `templates/local/charters/team.md`, `second-brain-starter/vault/CLAUDE.md`, `second-brain-starter/vault/asana/tasks.md`, `second-brain-starter/vault/funders/_template.md`, `second-brain-starter/vault/people/_template.md`, `second-brain-starter/vault/people/_to-cover.md`, `second-brain-starter/vault/projects/_index.md`, `second-brain-starter/vault/projects/example-workstream/overview.md`, `second-brain-starter/vault/scripts/daily-review.md`, `second-brain-starter/vault/scripts/lessons.md`, `second-brain-starter/vault/scripts/meeting-followups.md`, `second-brain-starter/vault/scripts/nightly-sync.md`, `second-brain-starter/vault/scripts/task-predictions.md`, `second-brain-starter/vault/skills/agent/inbox-cleanup/SKILL.md`, `second-brain-starter/vault/skills/agent/slack-message-drafts/SKILL.md`, `second-brain-starter/vault/summaries/context-sheet.md`, `README.md` |
| `[MEETING_NOTES_TOOL]` | The tool that records your meetings and gives notes and transcripts. It needs a connector on your Claude account. | Granola | required | Granola | `templates/local/charters/team.md`, `second-brain-starter/vault/meetings/_template.md`, `second-brain-starter/vault/scripts/meeting-followups.md`, `second-brain-starter/vault/scripts/nightly-sync.md`, `second-brain-starter/vault/skills/agent/inbox-cleanup/SKILL.md`, `README.md` |
| `[CHAT_TOOL]` | The chat tool of your team. | Slack | required | Slack | `templates/local/charters/team.md`, `second-brain-starter/vault/docs/slack/_template.md`, `second-brain-starter/vault/scripts/nightly-sync.md`, `second-brain-starter/vault/skills/agent/slack-message-drafts/SKILL.md` |
| `[SLACK_CHANNELS_TO_SYNC]` | The team channels whose every message the nightly sync saves, with commas between them. Your direct messages and your own threads are saved anyway. | #team-internal, #ops | optional | none | `second-brain-starter/vault/scripts/slack-channels.md` |
| `[SYNC_START_DATE]` | How far back the first nightly sync reads your meetings, mail, chat and documents, as YYYY-MM-DD. Later runs go further back when they have room. | 2026-01-01 | required | 30 days before today | `templates/local/schedule.json`, `second-brain-starter/vault/README.md`, `second-brain-starter/vault/asana/tasks.md`, `second-brain-starter/vault/docs/_index.md`, `second-brain-starter/vault/drafts/_README.md`, `second-brain-starter/vault/email/_correspondents.md`, `second-brain-starter/vault/funders/_index.md`, `second-brain-starter/vault/funders/_org-facts.md`, `second-brain-starter/vault/inbox/_README.md`, `second-brain-starter/vault/me/goals.md`, `second-brain-starter/vault/me/key-links.md`, `second-brain-starter/vault/me/time-tracking-projects.md`, `second-brain-starter/vault/me/writing-voice.md`, `second-brain-starter/vault/meetings/_index.md`, `second-brain-starter/vault/people/_index.md`, `second-brain-starter/vault/people/_merged/merges.md`, `second-brain-starter/vault/people/_settled.md`, `second-brain-starter/vault/people/_team.md`, `second-brain-starter/vault/people/_to-cover.md`, `second-brain-starter/vault/projects/_index.md`, `second-brain-starter/vault/projects/example-workstream/overview.md`, `second-brain-starter/vault/raw/_README.md`, `second-brain-starter/vault/scripts/daily-review.md`, `second-brain-starter/vault/scripts/lessons.md`, `second-brain-starter/vault/scripts/meeting-followups.md`, `second-brain-starter/vault/scripts/nightly-sync.md`, `second-brain-starter/vault/scripts/slack-channels.md`, `second-brain-starter/vault/scripts/sync-log.md`, `second-brain-starter/vault/scripts/sync-state.md`, `second-brain-starter/vault/scripts/task-predictions.md`, `second-brain-starter/vault/skills/README.md`, `second-brain-starter/vault/skills/agent/application-rolling-review/SKILL.md`, `second-brain-starter/vault/skills/agent/check-work/SKILL.md`, `second-brain-starter/vault/skills/agent/email-reply-drafts/SKILL.md`, `second-brain-starter/vault/skills/agent/event-guest-import/SKILL.md`, `second-brain-starter/vault/skills/agent/external-newsletter-submissions/SKILL.md`, `second-brain-starter/vault/skills/agent/gifts-and-pledges-tab/SKILL.md`, `second-brain-starter/vault/skills/agent/guest-list-crm-match/SKILL.md`, `second-brain-starter/vault/skills/agent/inbox-cleanup/SKILL.md`, `second-brain-starter/vault/skills/agent/ios-shortcut-install/SKILL.md`, `second-brain-starter/vault/skills/agent/model-trial/SKILL.md`, `second-brain-starter/vault/skills/agent/signable-docs/SKILL.md`, `second-brain-starter/vault/skills/agent/skill-audit/SKILL.md`, `second-brain-starter/vault/skills/agent/slack-message-drafts/SKILL.md`, `second-brain-starter/vault/skills/model-trials.md`, `second-brain-starter/vault/summaries/_README.md`, `second-brain-starter/vault/writing/_index.md`, `README.md` |

## Where things go

| Placeholder | What it means | Example | Required | Default | Used in |
|---|---|---|---|---|---|
| `[WHERE_TO_SEND_DRAFTS]` | Where an agent leaves a draft for you to review and send. The safe default: a draft inside the tool itself, plus a memo with the full text. | a draft in the tool it will be sent from (a Gmail draft, a Slack draft), plus a memo with the full text and the link | required | a draft in the tool it will be sent from (a Gmail draft, a Slack draft), plus a memo with the full text and the link | `templates/local/charters/team.md`, `second-brain-starter/vault/drafts/_README.md`, `second-brain-starter/vault/scripts/lessons.md`, `second-brain-starter/vault/scripts/meeting-followups.md`, `second-brain-starter/vault/skills/agent/email-reply-drafts/SKILL.md`, `second-brain-starter/vault/skills/agent/slack-message-drafts/SKILL.md` |
| `[WHERE_TO_SEND_FOLLOWUPS]` | Where meeting follow-ups go by default, when the routing list of the playbook has no row for the meeting. | a Slack direct message to the person for a teammate, an email for anyone outside the team | required | a Slack direct message to the person for a teammate, an email for anyone outside the team | `second-brain-starter/vault/scripts/meeting-followups.md` |
| `[SLACK_CHANNEL_FOR_ANNOUNCEMENTS]` | The channel for announcements to your whole community or company (the example skill slack-announcement uses it). Skip it if you post none. | #announcements | optional | none | `second-brain-starter/vault/skills/slack-announcement/SKILL.md`, `second-brain-starter/vault/skills/slack-announcement/references/channel-map.md` |
| `[SLACK_CHANNEL_FOR_TEAM_UPDATES]` | The internal channel of your team, for updates and for the follow-up of a team meeting. | #team-internal | optional | none | `second-brain-starter/vault/scripts/daily-review.md`, `second-brain-starter/vault/scripts/meeting-followups.md`, `second-brain-starter/vault/scripts/slack-channels.md`, `second-brain-starter/vault/skills/agent/slack-message-drafts/SKILL.md` |
| `[SIGNED_DOCS_FOLDER]` | The Google Drive folder where documents to sign, and their signed copies, live. | Shared drive Operations, folder Agreements | optional | none | `second-brain-starter/vault/me/key-links.md`, `second-brain-starter/vault/skills/agent/signable-docs/SKILL.md` |
| `[BOOKING_LINK]` | Your scheduling link, which agents put in a reply that proposes a call. | https://cal.example.org/sam | optional | none | `templates/local/charters/team.md`, `second-brain-starter/vault/CLAUDE.md`, `second-brain-starter/vault/me/key-links.md`, `second-brain-starter/vault/skills/agent/email-reply-drafts/SKILL.md`, `second-brain-starter/vault/skills/my-writing-voice/SKILL.md` |

## The schedule

| Placeholder | What it means | Example | Required | Default | Used in |
|---|---|---|---|---|---|
| `[NIGHTLY_SYNC_HOUR]` | The hour (0 to 23, by the clock of the Mac that runs Memo) at which the agents restart; the nightly sync starts 30 minutes later. Pick an hour when you sleep. | 3 | required | 3 | `templates/local/schedule.json`, `second-brain-starter/vault/scripts/nightly-sync.md`, `templates/launchd/memo.nightly-restart.plist`, `templates/launchd/memo.vault-sync.plist`, `README.md` |
| `[DAILY_REVIEW_HOUR]` | The hour (0 to 23, by the clock of the Mac that runs Memo) at which the daily review memo arrives, Monday to Friday. | 8 | required | 8 | `templates/local/schedule.json`, `second-brain-starter/vault/scripts/daily-review.md`, `templates/launchd/memo.daily-review.plist`, `README.md` |

## Skills and templates: your tools

| Placeholder | What it means | Example | Required | Default | Used in |
|---|---|---|---|---|---|
| `[TIME_TRACKER]` | The time tracker that sorts your computer time into projects, if you use one. The Monday review reports the hours by project (me/time-tracking-projects.md). Skip it if you track no time. | DoneThat | fill in later | none | `second-brain-starter/vault/me/time-tracking-projects.md`, `second-brain-starter/vault/scripts/daily-review.md` |

## Skills: CRM

| Placeholder | What it means | Example | Required | Default | Used in |
|---|---|---|---|---|---|
| `[CRM_IMPORTER]` | The person who loads import files into the CRM, and how to reach them. | Robin (robin@example.org), by email | fill in later | none | `second-brain-starter/vault/skills/agent/guest-list-crm-match/SKILL.md` |
| `[CRM_NAME]` | The CRM that holds the people your organisation knows, as the agent should call it. | our Airtable CRM | fill in later | none | `second-brain-starter/vault/skills/README.md`, `second-brain-starter/vault/skills/agent/application-rolling-review/SKILL.md`, `second-brain-starter/vault/skills/agent/email-reply-drafts/SKILL.md`, `second-brain-starter/vault/skills/agent/event-guest-import/SKILL.md`, `second-brain-starter/vault/skills/agent/guest-list-crm-match/SKILL.md` |
| `[CRM_PEOPLE_TABLES]` | Every table, view or list in the CRM that holds people, so a full pull misses no one. | People table, plus the attendees of each event in the Events table | fill in later | none | `second-brain-starter/vault/skills/agent/guest-list-crm-match/SKILL.md` |
| `[EVENT_PLATFORM]` | The event platform whose guest lists are brought into the CRM. | Partiful | fill in later | none | `second-brain-starter/vault/skills/README.md`, `second-brain-starter/vault/skills/agent/event-guest-import/SKILL.md` |

## Skills: Slack announcements

| Placeholder | What it means | Example | Required | Default | Used in |
|---|---|---|---|---|---|
| `[COMMUNITY_SCOPE]` | What the community is about, to check a post fits. | AI ethics, tech policy and adjacent research | fill in later | none | `second-brain-starter/vault/skills/slack-announcement/SKILL.md`, `second-brain-starter/vault/skills/slack-announcement/references/posting-guidelines.md` |
| `[POSTING_GUIDELINES_LINK]` | Link to the community's own posting guidelines, if they exist. | https://example.org/posting-guidelines | fill in later | none | `second-brain-starter/vault/skills/slack-announcement/SKILL.md`, `second-brain-starter/vault/skills/slack-announcement/references/posting-guidelines.md` |
| `[SLACK_CHANNEL_FOR_EVENTS]` | Main channel for events, conferences and workshops. | #events | fill in later | none | `second-brain-starter/vault/skills/slack-announcement/SKILL.md`, `second-brain-starter/vault/skills/slack-announcement/references/channel-map.md` |
| `[SLACK_CHANNEL_FOR_FUNDING]` | Main channel for funds, grants and requests for proposals. | #funding-opportunities | fill in later | none | `second-brain-starter/vault/skills/slack-announcement/SKILL.md`, `second-brain-starter/vault/skills/slack-announcement/references/channel-map.md`, `second-brain-starter/vault/skills/slack-announcement/references/posting-guidelines.md` |
| `[SLACK_CHANNEL_FOR_JOBS]` | Main channel for jobs, fellowships, competitions and board roles. | #opportunities | fill in later | none | `second-brain-starter/vault/skills/slack-announcement/SKILL.md`, `second-brain-starter/vault/skills/slack-announcement/references/channel-map.md`, `second-brain-starter/vault/skills/slack-announcement/references/posting-guidelines.md` |
| `[SLACK_CHANNEL_FOR_NEWS]` | Main channel for news, launches, reports and papers. | #news | fill in later | none | `second-brain-starter/vault/skills/slack-announcement/SKILL.md`, `second-brain-starter/vault/skills/slack-announcement/references/channel-map.md` |
| `[SLACK_TOPIC_CHANNELS]` | Topic channels where a short pointer to a post goes, as topic: #channel lines. | policy: #t-policy; research: #t-research | fill in later | none | `second-brain-starter/vault/skills/slack-announcement/SKILL.md`, `second-brain-starter/vault/skills/slack-announcement/references/channel-map.md` |
| `[SLACK_WORKSPACE_URL]` | The web address of the Slack workspace, used to build channel and DM links. | https://yourteam.slack.com | fill in later | none | `second-brain-starter/vault/skills/slack-announcement/SKILL.md` |

## Skills: applications

| Placeholder | What it means | Example | Required | Default | Used in |
|---|---|---|---|---|---|
| `[APPLICATIONS_TABLE]` | Where the program's applications live: the base and table, or the form's response sheet. | Airtable base Programs, table Applications | fill in later | none | `second-brain-starter/vault/skills/agent/application-rolling-review/SKILL.md` |
| `[PROGRAM_FIT_RUBRIC]` | One line: the main filter for a strong fit with the program. | a concrete project on open-source climate data, and a track record of shipping | fill in later | none | `second-brain-starter/vault/skills/agent/application-rolling-review/SKILL.md` |
| `[PROGRAM_LOCATION]` | Where participants of the program must be, for the logistics check. | Berlin, in person | fill in later | none | `second-brain-starter/vault/skills/agent/application-rolling-review/SKILL.md` |
| `[PROGRAM_NAME]` | The program that takes rolling applications. | the Example Fellowship | fill in later | none | `second-brain-starter/vault/scripts/daily-review.md`, `second-brain-starter/vault/skills/README.md`, `second-brain-starter/vault/skills/agent/application-rolling-review/SKILL.md` |

## Skills: cost-effectiveness estimates

| Placeholder | What it means | Example | Required | Default | Used in |
|---|---|---|---|---|---|
| `[BOTEC_FIELD]` | The field or cause area the cost-effectiveness estimates are for; sets the analyst's role in the prompt. | education programs for low-income students | fill in later | none | `second-brain-starter/vault/skills/back-of-envelope-estimate/SKILL.md` |
| `[BOTEC_OUTCOME_UNIT]` | The outcome each estimate counts, per objective, in total and per $1,000. | Students Helped | fill in later | none | `second-brain-starter/vault/skills/back-of-envelope-estimate/SKILL.md` |
| `[BOTEC_REFERENCE_SHEET]` | Link to a shared sheet of standard estimates (benchmarks, typical sizes, past rates) that rows can cite as 'Standard Estimates Sheet'. Leave empty if there is none. | https://docs.google.com/spreadsheets/d/EXAMPLE/edit | fill in later | none | `second-brain-starter/vault/skills/back-of-envelope-estimate/SKILL.md` |

## Skills: email

| Placeholder | What it means | Example | Required | Default | Used in |
|---|---|---|---|---|---|
| `[SCHEDULING_POLL_TOOL]` | The poll tool used to find a time with two or more people. | When2meet | fill in later | none | `second-brain-starter/vault/skills/agent/email-reply-drafts/SKILL.md` |

## Skills: finance

| Placeholder | What it means | Example | Required | Default | Used in |
|---|---|---|---|---|---|
| `[ACCOUNTING_LEDGER]` | The general ledger the organization uses. | QuickBooks Online | fill in later | none | `second-brain-starter/vault/skills/nonprofit-finance-copilot/SKILL.md` |
| `[BANK_AND_CARD_TOOLS]` | The bank and card tools where deposits show up, checked for gifts that have no row yet. | Ramp and the operating bank account | fill in later | none | `second-brain-starter/vault/skills/agent/gifts-and-pledges-tab/SKILL.md` |
| `[BOOKKEEPER_NAME]` | The outside bookkeeper or accounting firm that reads the gifts and pledges tab and owns its review columns. | Example Bookkeeping LLC | fill in later | none | `second-brain-starter/vault/skills/agent/gifts-and-pledges-tab/SKILL.md` |
| `[BOOKKEEPING_SHEET]` | Link to the Google Sheet bookkeeping worksheet that holds the gifts and pledges tab. | https://docs.google.com/spreadsheets/d/EXAMPLE/edit | fill in later | none | `second-brain-starter/vault/skills/agent/gifts-and-pledges-tab/SKILL.md` |
| `[FINANCE_REVIEWER]` | The bookkeeper or CPA who signs off on reconciliations, proposed entries and filings. | Jordan Park, CPA, at Example Accounting | fill in later | none | `second-brain-starter/vault/skills/nonprofit-finance-copilot/SKILL.md` |
| `[GIFT_RECORDING_RULES]` | Link to the written procedure for recording donations and pledges for the annual return, if there is one. | https://docs.google.com/document/d/EXAMPLE/edit | fill in later | none | `second-brain-starter/vault/skills/agent/gifts-and-pledges-tab/SKILL.md` |
| `[GRANT_LETTERS_FOLDER]` | Link to the Drive folder where award letters, grant agreements and DAF notices are filed as PDFs. | https://drive.google.com/drive/folders/EXAMPLE | fill in later | none | `second-brain-starter/vault/skills/agent/gifts-and-pledges-tab/SKILL.md` |
| `[ONLINE_GIVING_PLATFORMS]` | Online giving platforms whose gifts arrive through the bank feed and need no pledge row. | Every.org, Stripe and PayPal | fill in later | none | `second-brain-starter/vault/skills/agent/gifts-and-pledges-tab/SKILL.md` |
| `[PLEDGES_TAB_NAME]` | The name of the tab in the bookkeeping worksheet where each gift and pledge gets a row. | Pledges (official) | fill in later | none | `second-brain-starter/vault/skills/agent/gifts-and-pledges-tab/SKILL.md` |

## Skills: inbox cleanup

| Placeholder | What it means | Example | Required | Default | Used in |
|---|---|---|---|---|---|
| `[GROUP_ADDRESSES_ARCHIVE_AFTER_14_DAYS]` | Group addresses whose mail is archived after 14 days unless the owner replied. | ops@ | fill in later | none | `second-brain-starter/vault/skills/agent/inbox-cleanup/SKILL.md` |
| `[GROUP_ADDRESSES_TO_ARCHIVE]` | Group addresses whose mail is archived at any age. | courses@, newsletter@, team-internal@ | fill in later | none | `second-brain-starter/vault/skills/agent/inbox-cleanup/SKILL.md` |
| `[GROUP_ADDRESSES_TO_KEEP]` | Group addresses whose mail always stays in the inbox. | hiring@ | fill in later | none | `second-brain-starter/vault/skills/agent/inbox-cleanup/SKILL.md` |
| `[TO_RESPOND_LABEL]` | A Gmail label from an older triage tool that marks mail to answer; the cleanup leaves it alone. | To respond | fill in later | none | `second-brain-starter/vault/skills/agent/inbox-cleanup/SKILL.md` |

## Skills: writing voice

| Placeholder | What it means | Example | Required | Default | Used in |
|---|---|---|---|---|---|
| `[AI_DETECTOR_TOOL]` | The AI-writing detector used to score drafts. | Pangram | fill in later | none | `second-brain-starter/vault/skills/my-writing-voice/SKILL.md` |
| `[EMAIL_GREETING]` | How the owner greets people in email. | Hi {Name}, (Hey {Name}, for peers) | fill in later | none | `second-brain-starter/vault/skills/my-writing-voice/SKILL.md` |
| `[EMAIL_SIGNOFF]` | How the owner signs off an email. | Best, then the first name | fill in later | none | `second-brain-starter/vault/skills/my-writing-voice/SKILL.md` |
| `[VOICE_FILLER_WORDS]` | Filler words the owner uses lightly, which make drafts read as human. | just, Also, I think, actually, If you have time | fill in later | none | `second-brain-starter/vault/skills/my-writing-voice/SKILL.md` |

## Made by setup

| Placeholder | What it means | Example | Required | Default | Used in |
|---|---|---|---|---|---|
| `[MEMO_TOKEN]` | The secret token of Memo. Setup makes a random one, writes it only into app/.env, and never shows it. You are not asked for it. | (43 random characters) | made by setup | none | `app/.env.example` |
