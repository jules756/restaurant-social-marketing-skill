# Knowledge-Gap Probing

The restaurant's best content comes from specifics only the owner knows. Fill those gaps over time — at most one question per day. Never during the owner's busy hours. Never two days in a row.

## Gap Detection

Silently scan at the start of each session:

```
read_file: /host-agent-home/social-marketing/knowledge-base/chef.json
read_file: /host-agent-home/social-marketing/knowledge-base/recipes.json
read_file: /host-agent-home/social-marketing/knowledge-base/history.json
read_file: /host-agent-home/social-marketing/photo-inventory.json
```

If any file is missing or thin, queue a probe. Prioritize by what unlocks the highest-engagement content first.

## Probes (Ordered by Content Value)

### Chef background (missing → unlocks chef-story posts)

> *"Quick one — can you tell me about your chef? Where did they train?"*

Save to `knowledge-base/chef.json`. Unlocks: "Chef trained at X" / "Here's what Y years in the kitchen looks like" hooks.

### Recipe stories (thin → unlocks recipe-origin posts)

> *"Is there a dish with a story behind it? Family recipe, something you changed on purpose, anything with history?"*

Save to `knowledge-base/recipes.json`. Unlocks: "This sauce has been made the same way since 1987" — consistently high engagement.

### Sourcing / suppliers (missing → unlocks provenance posts)

> *"Do you source from any specific local suppliers? Farms, bakers, importers?"*

Save to `knowledge-base/history.json` under `sourcing`. Unlocks: "Our tomatoes come from [farm], 20 minutes from here" — premium-positioning hook.

### Photo inventory gaps

Check `photo-inventory.json` for missing dish categories:

> *"I notice I don't have photos of your desserts yet. When you have a sec, drop a few in the shared folder — it'll make the dessert posts look like your actual food."*

Save: none (the inventory self-updates from the next sync).

### Dining-room photos missing

> *"Got any shots of the dining room when it's busy? Those do really well for the 'this place is alive' angle."*

### Event history

> *"Have you done any events — tastings, collaborations, pop-ups? Worth mentioning them in content sometimes."*

## Timing Rules

- Check `memory` for the last probe timestamp. Wait at least 24 hours between probes.
- Never probe during a promotion window — the owner is stressed, focused on the live push.
- Never probe immediately after bad news from analytics. Fix the post first, probe later.
- Prefer low-stress times: late-morning on a quiet weekday. Avoid Friday PM, Saturday, Sunday service hours.
- If the owner said *"I'm busy"* or *"later"* on the last message, skip probing this session entirely.

## Saving

Every answer → write to the matching `knowledge-base/*.json` immediately via `patch` or `terminal`. Never ask the same question twice. Log the probe in `memory` so future sessions know it's done.
