# Restaurant Social Media Marketing Skill

An AI-powered skill for automating multi-platform social media marketing for restaurants to increase bookings. Posts to TikTok, Instagram, and Facebook via Composio. Researches competitors, generates AI food/ambiance images (or uses real photos from Google Drive), adds text overlays, tracks analytics across platforms, and iterates on what works.

## 🚀 **Key Features**

- **Multi-Platform Posting**: TikTok (6-slide slideshows), Instagram (carousels/Reels), Facebook (single posts)
- **AI Image Generation**: Uses `gpt-image-1.5` for photorealistic food/restaurant images
- **Google Drive Integration**: Uses your actual restaurant photos when available
- **Text Overlays**: Viral-worthy reactions and storytelling text on images
- **Analytics & Optimization**: Tracks views, engagement, and bookings to optimize content
- **Promotion Detection**: Automatically creates promotional content when offers are mentioned
- **Competitor Research**: Analyzes what's working for similar restaurants
- **Knowledge Base**: Builds deep understanding of your restaurant through conversation

## 🔧 **How to Use This Skill**

### 1. **Install the Skill**
```bash
# From your Hermes agent environment
skill_manage create --name restaurant-social-marketing --content "$(cat SKILL.md)"
```

### 2. **Set Up Prerequisites**
Before running the skill, ensure you have:
- **Node.js** (v18+) installed
- **node-canvas** installed (`npm install canvas`)
- **Composio account** with connected TikTok, Instagram, Facebook, and Google Drive
- **API Key** for OpenAI or OpenRouter (OpenRouter recommended for cost savings)

### 3. **Run the Onboarding Process**
When you first load the skill, it will:
1. Ask for your communication and posting language preferences
2. Verify your technical connections (TikTok, Instagram, Facebook, Google Drive)
3. Confirm your restaurant details from your Google Drive
4. Begin conversational onboarding to learn about your restaurant

### 4. **Using the Skill**
After setup, the skill will:
- Generate content drafts in your TikTok inbox (you add music and publish)
- Track performance and booking correlations
- Iterate on what works based on actual booking data
- Handle promotional content automatically when offers are mentioned

## 📁 **Directory Structure**

```
restaurant-social-marketing/
├── SKILL.md              # Main skill documentation (this file)
├── _meta.json            # Skill metadata
├── references/           # Reference guides and documentation
│   ├── analytics-loop.md
│   ├── app-categories.md
│   ├── competitor-research.md
│   ├── google-drive-setup.md
│   ├── knowledge-base-guide.md
│   ├── platform-formats.md
│   ├── promotion-content-guide.md
│   ├── revenuecat-integration.md
│   └── slide-structure.md
└── scripts/              # Executable scripts
    ├── add-text-overlay.js
    ├── check-analytics.js
    ├── competitor-research.js
    ├── composio-helpers.js
    ├── daily-report.js
    ├── generate-slides.js
    ├── google-drive-sync.js
    ├── knowledge-base.js
    ├── onboarding.js
    ├── post-to-facebook.js
    ├── post-to-instagram.js
    ├── post-to-platforms.js
    ├── post-to-tiktok.js
    └── promotion-manager.js
```

## 🔑 **Usage Command for Hosted Versions**

To use this skill in a hosted Hermes agent environment, provide this installation command:

```
skill_manage create --name restaurant-social-marketing --content "<SKILL_CONTENT>"
```

Where `<SKILL_CONTENT>` is the full content of the `SKILL.md` file in this repository.

## 📖 **Documentation**

- **Skill Overview**: See `SKILL.md` for complete documentation
- **Reference Guides**: Check the `references/` directory for detailed guides
- **Script Usage**: Each script in `scripts/` has built-in help (run with `--help`)

## 🛠️ **Customization**

You can customize the skill by:
1. Modifying `SKILL.md` for different behavior
2. Adding custom references in `references/`
3. Adding custom scripts in `scripts/`
4. Using the skill management system to patch or update specific parts

## 📞 **Support**

For issues or questions, please refer to the Hermes agent documentation or open an issue in this repository.

---

*Skill updated: [Insert Date]*
*Based on Hermes Agent Social Media Marketing Framework*
