# Torah Tai Chi - Project Overview

## Executive Summary

Torah Tai Chi is a content platform that merges Torah wisdom with tai chi/martial arts philosophy, focusing on the mind-body-spirit integration that both traditions share. The project aims to build an automated content engine that generates highly shareable short-form video content, with the ultimate goal of promoting a book on the subject (publishing in approximately one year).

**Key Stakeholders:** Yitzy (Innovation & Strategy), Yonah Lloyd (Content/Vision)

**Project Status:** Character design phase - selecting the visual identity for the AI-generated video presenter

---

## Project Vision

### The Concept

Torah Tai Chi explores the intersection of:
- **Jewish wisdom** - Torah concepts, middot (character traits), Rambam's health teachings, spiritual practices
- **Tai Chi philosophy** - Mind-body connection, balance, breath, movement, yin-yang principles

The content is **substantive Torah** - not watered-down "love everyone" spirituality, but authentic Jewish concepts made accessible to English-speaking audiences (Jewish and non-Jewish alike).

### Content Themes

1. **Middot & Movement** - Character traits (patience, humility, strength) taught through tai chi principles
2. **Body as Temple** - Jewish obligations around health, physical discipline as avodah (service)
3. **Balance & Shalom** - Inner peace concepts, tai chi yin-yang mapped to Torah dualities (din/chesed, guf/neshamah)
4. **Breath & Blessing** - Breathing practices, kavannah (intention), presence
5. **Weekly Parsha Connections** - Tying wellness wisdom to the weekly Torah portion

### Business Goals

- Build brand awareness and audience before book launch (~1 year out)
- Create a content vehicle that can scale with automation
- Establish Torah Tai Chi as a recognized voice in the Jewish wellness space
- Potential future monetization (courses, community, merchandise)

---

## Technical Architecture

### Platform Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         TORAH TAI CHI                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │   WEBSITE   │  │   SOCIAL    │  │    BOOK     │            │
│  │   (Hub)     │  │  PLATFORMS  │  │  (Future)   │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
│         │                │                │                    │
│         └────────────────┼────────────────┘                    │
│                          │                                     │
│              ┌───────────┴───────────┐                        │
│              │   CONTENT PIPELINE    │                        │
│              │       (n8n)           │                        │
│              └───────────────────────┘                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Content Pipeline (n8n Workflow)

The automated content system follows a 5-stage process with human approval gates:

```
Stage 1: IDEATION
├── Trigger: Weekly/daily cron job
├── Inputs: Parsha of the week, content pillar rotation, trending topics
├── Process: AI generates 5-10 content ideas with hooks
├── Output: Ideas stored in Supabase with "pending review" status
└── Notification: Email/Slack alert for human approval

Stage 2: SCRIPT GENERATION
├── Trigger: Idea approved in Supabase
├── Process: AI writes full script (hook, teaching, call-to-action)
├── Output: Script stored with brand voice guidelines applied
└── Gate: Human reviews/edits script

Stage 3: AUDIO GENERATION
├── Trigger: Script approved
├── Process: ElevenLabs API generates voice audio
└── Output: Audio file ready for video production

Stage 4: VIDEO GENERATION
├── Trigger: Audio file ready
├── Process: Hedra API combines character image + audio
├── Output: Animated video with lip-sync
└── Gate: Human reviews final video

Stage 5: DISTRIBUTION
├── Trigger: Video approved + scheduled time
├── Platforms: YouTube Shorts, Instagram Reels, TikTok, Facebook
├── Tools: Direct API integrations or Publer
└── Logging: Results tracked in master content database
```

### Technology Stack

| Component | Tool | Purpose |
|-----------|------|---------|
| **Workflow Automation** | n8n | Orchestrate entire content pipeline |
| **Content Database** | Supabase (Postgres) | Track ideas, scripts, approvals, publishing |
| **Image Generation** | Nano Banana (Google Gemini) | Create character designs and variations |
| **Voice Generation** | ElevenLabs | Text-to-speech for character voice |
| **Video Generation** | Hedra AI (Character-3) | Animate character with lip-sync |
| **Social Publishing** | Native APIs or Publer | Distribute to all platforms |
| **Website** | Webflow, Framer, or Next.js | Content hub and book landing page |

---

## Character Design

### Approach

Rather than using a realistic AI avatar (HeyGen, Synthesia), we opted for a **stylized/animated character** for several reasons:

- Avoids uncanny valley issues
- More distinctive and memorable brand identity
- Ages better as AI technology evolves
- Sidesteps potential halachic concerns about realistic human depictions
- Works well with Hedra's Character-3 animation capabilities

### Design Options

We generated 5 character directions using Nano Banana AI:

#### Option 1: The Wise Elder
- **Concept:** Dignified grandfather/rebbe figure
- **Age:** Late 60s-70s
- **Style:** Soft, rounded illustration (Headspace-like)
- **Attire:** White tai chi tunic, light blue kippah
- **Best for:** Traditional audiences, trust/authority

#### Option 2: The Modern Sage ⭐
- **Concept:** Contemporary teacher bridging tradition and wellness
- **Age:** Mid-40s to early 50s
- **Style:** Clean vector art, modern aesthetic
- **Attire:** Navy athletic shirt, brown leather kippah
- **Best for:** Broad audiences, younger demographics, relatability

#### Option 3: The Animated Master ⭐
- **Concept:** Stylized, storybook character with mystical quality
- **Age:** Ageless/timeless
- **Style:** Avatar/Ghibli-inspired animation
- **Attire:** Flowing white robes, blue sash, white turban
- **Best for:** Visual impact, social media shareability, memorability

#### Option 4: The Friendly Teacher
- **Concept:** Approachable community teacher everyone knows
- **Age:** Early 50s
- **Style:** Warm, friendly illustration with rounded shapes
- **Attire:** Casual light blue button-down, blue velvet kippah
- **Best for:** Beginners, maximum approachability

#### Option 5: The Symbolic Figure
- **Concept:** Abstract, logo-like brand icon
- **Age:** Undefined
- **Style:** Minimalist flat design, geometric
- **Attire:** Abstract blue and white robes with Star of David
- **Best for:** Brand recognition, logo use, merchandise

### Recommendations

**For main character:** Option 2 (Modern Sage) or Option 3 (Animated Master)
- Option 2 offers the best balance of relatability and animation compatibility
- Option 3 is most visually distinctive but may need the turban changed to a kippah

**For brand icon:** Option 5 could serve as a secondary brand element alongside the main character

### Character Generation Tools

- **Primary:** Nano Banana (Google Gemini 2.5 Flash Image)
  - Free access via gemini.google.com or aistudio.google.com
  - Excellent prompt adherence and character consistency
  - Can create variations by uploading existing images

- **Video Animation:** Hedra AI Character-3
  - API available on Creator plan ($24/month) and above
  - Supports stylized/cartoon characters
  - 60-90 second video generation
  - Make.com integration available (works with n8n)

---

## Brand Identity

### Name
**Torah Tai Chi** - Simple, clear, memorable. Communicates exactly what it is.

### Visual Identity

**Color Palette:**
- Primary: Israeli blue (#1e3a5f)
- Secondary: White/cream
- Accent: Gold
- Background: Soft grays and warm neutrals

**Logo Concept:**
Initial logo concept combines:
- Yin-yang symbol
- Torah scroll
- Tai chi figures (one wearing kippah)
- Israeli flag color scheme

### Voice & Tone

The character's speaking style should be:
- **Warm but substantive** - Not preachy, but teaches real Torah
- **Accessible** - Complex ideas made simple without dumbing down
- **Grounded** - Practical applications, not just theory
- **Occasionally humorous** - Light touches, never forced
- **Encouraging** - Motivates without being cheesy

---

## Content Strategy

### Format
**Primary:** Short-form vertical video (30-90 seconds)
- Optimized for YouTube Shorts, Instagram Reels, TikTok, Facebook Reels

### Publishing Cadence
- Target: 3-5 videos per week minimum
- Daily posting possible with automation

### Content Structure (Per Video)

1. **Hook** (0-3 seconds) - Attention-grabbing opening question or statement
2. **Teaching** (3-60 seconds) - Core concept with Torah + Tai Chi integration
3. **Application** (60-80 seconds) - Practical takeaway or mini-practice
4. **CTA** (80-90 seconds) - Follow, comment prompt, or book teaser

### Platform Strategy

| Platform | Content Approach |
|----------|------------------|
| **YouTube Shorts** | Primary discovery platform, SEO-friendly titles |
| **Instagram Reels** | Polished aesthetic, community building |
| **TikTok** | Trending sounds, more casual tone acceptable |
| **Facebook** | Older demographic, share-friendly content |

---

## Website Structure

### Pages

1. **Home**
   - Hero video introducing the concept
   - Value proposition
   - Latest content feed
   - Newsletter signup

2. **About**
   - The philosophy behind Torah Tai Chi
   - Book teaser / coming soon
   - The team (or keep anonymous/branded)

3. **Content Library**
   - All videos organized by theme/pillar
   - Search and filter functionality

4. **Book** (Pre-launch → Purchase)
   - Waitlist signup
   - Chapter previews
   - Purchase links when available

5. **Newsletter/Community**
   - Email signup
   - Exclusive content
   - Future: Community features

### Technical Options

- **Webflow** - Design flexibility, no code needed, good for content sites
- **Framer** - Modern, fast, great animations
- **Next.js** - Full control, best for custom functionality

---

## Project Phases

### Phase 1: Foundation (Weeks 1-2)
- [x] Define concept and content pillars
- [x] Generate character design options
- [ ] Select final character direction
- [ ] Create character variations (poses, expressions)
- [ ] Set up social media accounts
- [ ] Build basic landing page

### Phase 2: Content System (Weeks 3-4)
- [ ] Build n8n ideation workflow
- [ ] Create brand voice/style guide document
- [ ] Test script generation quality
- [ ] Set up Supabase content tracker
- [ ] Configure ElevenLabs voice

### Phase 3: Production Pipeline (Weeks 5-6)
- [ ] Integrate Hedra API into n8n
- [ ] Build approval interfaces (Slack/email notifications)
- [ ] Test end-to-end flow
- [ ] Create initial content bank (10-15 videos)

### Phase 4: Launch & Scale (Week 7+)
- [ ] Begin regular posting schedule
- [ ] Monitor engagement metrics
- [ ] Iterate on content based on performance
- [ ] Build email list
- [ ] Expand to additional content formats

### Phase 5: Book Launch (Month 12+)
- [ ] Ramp up content production
- [ ] Add book-specific CTAs
- [ ] Launch pre-order campaign
- [ ] Coordinate with publisher marketing

---

## Budget Considerations

### Ongoing Costs (Estimated Monthly)

| Item | Cost | Notes |
|------|------|-------|
| Hedra AI (Creator) | $24/month | ~1 hour video/month, API access |
| ElevenLabs | $5-22/month | Depending on character count |
| n8n | $20-50/month | Cloud hosted, or self-host free |
| Supabase | $0-25/month | Free tier may suffice initially |
| Website hosting | $15-30/month | Webflow/Framer/Vercel |
| **Total** | **~$65-150/month** | |

### One-Time or As-Needed

| Item | Cost | Notes |
|------|------|-------|
| Nano Banana Pro | Free or $10-20/month | For higher quality generations |
| Custom domain | $12-15/year | torahtaichi.com or similar |
| Social scheduling tool | $0-30/month | If needed beyond native posting |

---

## Success Metrics

### Growth Metrics
- Follower count across platforms
- Video views (total and average)
- Engagement rate (likes, comments, shares)
- Email list size

### Content Metrics
- Production velocity (videos per week)
- Approval rate (% of ideas that become videos)
- Time from idea to published

### Business Metrics
- Website traffic
- Book waitlist signups
- Click-through to book purchase (when available)
- Community engagement

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| AI video quality inconsistent | Test thoroughly, build review gates, iterate on character design |
| Content feels generic/AI-generated | Strong brand voice document, human editing pass, authentic Torah sources |
| Platform algorithm changes | Diversify across multiple platforms, build email list as owned audience |
| Character animation issues in Hedra | Test character designs before finalizing, have backup style options |
| Burnout on content production | Automation reduces load, batch content creation, sustainable schedule |

---

## Open Questions

1. **Character name?** Does the character need a name, or is "Torah Tai Chi" the brand voice?
2. **Yonah's involvement?** Is Yonah providing Torah content/scripts, or fully AI-generated?
3. **Book integration?** How closely should video content tie to book chapters?
4. **Community features?** Is there interest in building interactive community (comments, Q&A, live sessions)?
5. **Hebrew content?** Any plans for Hebrew-language content for Israeli audience?

---

## Next Steps (Immediate)

1. **Yonah reviews character options** - Select 1-2 directions to pursue
2. **Refine chosen character** - Generate variations, test in Hedra
3. **Lock character design** - Create final character bible
4. **Set up accounts** - Social platforms, Hedra, ElevenLabs
5. **Build first n8n workflow** - Start with ideation engine

---

## Resources & Links

### Tools
- [Nano Banana / Google AI Studio](https://aistudio.google.com)
- [Hedra AI](https://hedra.com)
- [ElevenLabs](https://elevenlabs.io)
- [n8n](https://n8n.io)
- [Supabase](https://supabase.com)

### Documentation Created
- Character Design Options (HTML presentation)
- Nano Banana Optimized Prompts (MD)
- This Project Overview (MD)

---

*Document created: January 2026*
*Last updated: January 2026*
*Project Lead: Yitzy (FiveBlocks Innovation & Strategy)*
