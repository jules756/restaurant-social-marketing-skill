# Error Handling

Every external dependency can fail. The pipeline must degrade gracefully — never leave the owner staring at a silent bot.

## Drive sync failure

Cascade:

1. Drive sync fails (platform API error, network, expired OAuth) → fall back to the last successful local cache at `/host-agent-home/social-marketing/photos/`.
2. No local cache → fall back to txt2img generation using `restaurant-profile.json` + knowledge-base context.
3. No knowledge-base beyond profile → txt2img with profile only.

**Notify the owner only if the cache is older than 7 days.** Use `terminal` to check cache mtime:

```
find /host-agent-home/social-marketing/photos -maxdepth 2 -type f -name '*.jpg' -mtime -7 | head -1
```

If empty, tell the owner:
> *"Couldn't reach your Drive today — using photos from last week. Check your connection when you get a chance."*

Do NOT notify for transient failures with a fresh cache.

## platform API post failure (platform posting)

1. Log error to `/host-agent-home/social-marketing/errors.json` (append JSON lines).
2. Retry once after 60 seconds via `terminal`.
3. If retry fails → notify owner:
   > *"Couldn't post to [platform] — looks like a connection issue. Want me to try again, or save this for later?"*
4. Save the post payload (images + caption) to `/host-agent-home/social-marketing/posts/failed/<timestamp>/` so nothing is lost.
5. **Never silently drop a failed post.**

## OpenRouter / image generation failure

1. Retry once immediately within the `generate-slides.js` script (it has built-in retry).
2. If the script exits non-zero after retries → notify owner:
   > *"Image generation is slow right now — I'll retry in 10 minutes."*
3. Queue via `memory` with a retry timestamp.
4. Retry automatically at the queued time.
5. If still failing after 30 minutes total → notify honestly:
   > *"Generation's been down for half an hour. Want to try again tomorrow, or is this urgent enough to troubleshoot now?"*

## Telegram send failure

If `send_message` or the Bot API `sendMediaGroup` fails:

1. Log and retry once.
2. If still failing → fall back to writing the slide paths and caption to a file: `/host-agent-home/social-marketing/posts/<timestamp>/telegram-fallback.txt`.
3. Tell owner on the next available channel: *"Slides are ready at `<path>` — Telegram wouldn't accept them just now."*

## Account / auth errors

If a posting script returns an OAuth or account-scoping error:

- This is an Installer-side issue.
- Do NOT ask the owner anything. Reply *"Something's off on my end — one sec. I'll fix and come back."*
- Write a note via `memory` so the Installer sees it next time they check logs.

## Never

- Pretend an action succeeded when it didn't.
- Ask the owner to check a config or run a command.
- Retry indefinitely. Cap at the retry counts above.
- Dump stack traces to the owner. Errors are internal.
