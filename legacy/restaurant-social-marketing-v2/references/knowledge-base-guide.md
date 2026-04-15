# Knowledge Base Guide

## Overview

The knowledge base stores rich, structured information about the restaurant that the AI agent uses to create authentic, detailed content. Instead of generic food posts, the agent can reference actual dishes, ingredients, chef stories, and recipe histories.

## Directory Structure

```
tiktok-marketing/knowledge-base/
  menu.json       — Full menu with sections, dishes, ingredients, prices
  history.json    — Restaurant origin story, milestones, philosophy
  chef.json       — Chef background, training, specialties, fun facts
  recipes.json    — Recipe stories, cultural significance, special ingredients
```

## Schema Documentation

### menu.json

```json
{
  "lastUpdated": "2026-04-08",
  "currency": "USD",
  "sections": [
    {
      "name": "Starters",
      "items": [
        {
          "name": "Burrata with Heirloom Tomatoes",
          "price": 16,
          "description": "Creamy burrata from Puglia served with seasonal heirloom tomatoes, basil oil, and aged balsamic",
          "ingredients": ["burrata", "heirloom tomatoes", "basil oil", "aged balsamic", "sea salt"],
          "allergens": ["dairy"],
          "isSignature": true,
          "isVegetarian": true,
          "visualDescription": "White creamy burrata split open with red and yellow tomatoes, dark balsamic drizzle, green basil oil on a white plate",
          "featuredInPosts": 0,
          "lastFeatured": null
        }
      ]
    }
  ]
}
```

**Key fields:**
- `visualDescription` — Detailed description of how the dish LOOKS. Used directly in image generation prompts
- `featuredInPosts` — Counter tracking how many times this dish has been featured. Helps the daily report suggest underrepresented items
- `isSignature` — Flagged items get priority in content suggestions

### history.json

```json
{
  "foundedYear": 2018,
  "founders": ["Marco Rossi", "Anna Bianchi"],
  "originStory": "Two childhood friends who grew up cooking together in their grandmother's kitchen in Trastevere. After years working in Michelin-starred restaurants across Europe, they wanted to open a place that felt like coming home for dinner.",
  "milestones": [
    { "year": 2019, "event": "Won Best New Restaurant in [city]" },
    { "year": 2021, "event": "Featured in [publication]" },
    { "year": 2023, "event": "Expanded to include outdoor terrace" }
  ],
  "philosophy": "Seasonal Italian cooking with ingredients from local farms. No shortcuts, no frozen anything, everything made fresh daily.",
  "neighborhood": "We chose [neighborhood] because it reminded us of the streets in Rome where we grew up — narrow, buzzy, full of life.",
  "nameOrigin": "Named after Marco's grandmother Lucia, who taught them both to cook."
}
```

### chef.json

```json
{
  "name": "Chef Marco Rossi",
  "title": "Head Chef & Co-Owner",
  "background": "Trained at the Culinary Institute of Florence. Worked under Chef Massimo Bottura at Osteria Francescana for 2 years, then at The River Cafe in London for 3 years.",
  "specialties": ["fresh pasta", "seasonal Italian", "wood-fired cooking"],
  "signature": "Known for his carbonara technique — uses guanciale cured in-house for 3 weeks and egg yolks from a local farm.",
  "story": "Left a Michelin-starred kitchen to open a neighborhood restaurant where he could cook the food he grew up eating. 'I wanted people to feel like they were eating at my grandmother's table, not in a restaurant.'",
  "funFacts": [
    "Makes fresh pasta dough at 5am every morning",
    "Sources ingredients from 3 local farms within 30 miles",
    "Has a tattoo of his grandmother's pasta recipe on his forearm",
    "Once cooked for 200 people at a street party using only one burner"
  ]
}
```

### recipes.json

```json
{
  "recipes": [
    {
      "dish": "Nonna Lucia's Carbonara",
      "menuItem": "Carbonara",
      "story": "This recipe came from Chef Marco's grandmother Lucia, who learned it from her mother in a small village outside Rome in 1952. The secret is patience — the guanciale is cured in-house for 3 weeks, and the egg yolks come from free-range chickens at a farm 20 miles away.",
      "culturalSignificance": "One of the four classic Roman pastas (cacio e pepe, gricia, amatriciana, carbonara). The original recipe uses no cream — just eggs, pecorino, guanciale, and black pepper.",
      "specialIngredients": [
        { "name": "Guanciale", "detail": "Cured in-house for 3 weeks from local heritage breed pork" },
        { "name": "Pecorino Romano", "detail": "Imported from Lazio, aged 8 months minimum" },
        { "name": "Egg yolks", "detail": "From free-range chickens at Green Valley Farm, 20 miles away" }
      ],
      "process": "The pasta is hand-rolled every morning using a bronze die for texture. The carbonara sauce is made to order — never pre-made. Marco insists on tossing the pasta off the heat to prevent the eggs from scrambling.",
      "hookIdeas": [
        "The secret to this carbonara is a recipe from 1952",
        "They cure their own guanciale for 3 WEEKS and you can taste it",
        "His nonna taught him this carbonara and she wouldn't approve of any other version",
        "This is what REAL carbonara looks like — no cream in sight"
      ]
    }
  ]
}
```

## Conversational Extraction Guidelines

The knowledge base is populated through natural conversation, not forms. Here's how to extract information:

### Menu
Don't ask "What's on your menu?" all at once. Build gradually:
- "What are your sections? Starters, mains, desserts?"
- "What's your most popular starter?"
- "Tell me about it — what's in it, how much is it?"
- "What does it look like on the plate? Describe the colors and presentation"
- "Any allergens I should note?"
- "Which dishes are you most proud of? Those will be our content stars"

### History
- "How did the restaurant start? What's the origin story?"
- "How long have you been open?"
- "Any big milestones? Awards, press, expansions?"
- "Why did you choose this location?"
- "What's the name about? Is there a story behind it?"

### Chef
- "Tell me about your chef — where did they train?"
- "What's their signature move? What are they known for?"
- "Any fun facts? Things that would make great content?"
- "Why did they decide to open/work at this restaurant?"

### Recipes
- "Any dishes with a special story behind them?"
- "Family recipes? Something passed down?"
- "Any ingredients that are particularly special — locally sourced, imported, house-made?"
- "Walk me through how [signature dish] is made"

## Using the Knowledge Base in Content Creation

### Image Generation Prompts
Instead of generic "a pasta dish", use the `visualDescription` field:
```
Before: "iPhone photo of pasta at an Italian restaurant"
After:  "iPhone photo of hand-rolled rigatoni with slow-cooked pork ragu, 
         shaved pecorino, and fresh basil on a white ceramic plate. 
         Rustic wooden table, warm candlelight."
```

### Hook Generation
Reference specific knowledge base details:
```
Before: "This restaurant makes great pasta"
After:  "They cure their own guanciale for 3 WEEKS for this carbonara"
After:  "The chef trained under Massimo Bottura and then opened THIS"
After:  "This recipe hasn't changed since 1952 and you can taste why"
```

### Storytelling Captions
Pull from `history.json` and `recipes.json`:
```
"Two childhood friends who grew up cooking in their nonna's kitchen in Rome 
ended up opening this place in [city]. The carbonara is from a recipe that's 
been in the family since 1952 — no cream, just eggs, guanciale they cure 
themselves, and pecorino imported from Lazio. This is what real Italian 
cooking tastes like."
```

### Suggest Underrepresented Content
The `featuredInPosts` counter in menu.json lets the daily report identify dishes that haven't been featured yet:
- "Your carbonara has been featured 8 times but your burrata hasn't been in a single post. Let's feature it today."
- "You have 15 menu items but only 4 have been featured. Here are 5 dishes that could make great content..."

## Keeping the Knowledge Base Updated

- Update `menu.json` when dishes are added, removed, or change price
- Increment `featuredInPosts` each time a dish appears in a post
- Add new recipe stories as you learn them through conversation
- Update chef info if they share new details
- The daily report script references the knowledge base — keep it accurate
