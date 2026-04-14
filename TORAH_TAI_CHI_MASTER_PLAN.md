# Torah Tai Chi - Master Execution Plan

> **Last Updated:** January 19, 2026  
> **Status:** Planning Phase  
> **Site ID:** `46353841-460c-4d59-bd54-0a583f390cba`

---

## Critical Review of Original Plans

### What Was Over-Engineered

The original documentation proposed a complex 5-stage automated pipeline with multiple AI services. Here's what needs simplification:

| Original Idea | Problem | Recommendation |
|---------------|---------|----------------|
| n8n + Kie.ai + HeyGen + ElevenLabs | Too many moving parts, multiple points of failure | Pick ONE video generation platform |
| 5-stage approval workflow | Overkill for weekly content | Simplify to 2 stages: Script → Video |
| Hedra AND HeyGen mentioned | Conflicting tools for same purpose | Choose HeyGen (better API, templates, MCP server) |
| Kie.ai as "workflow automation" | **Kie.ai is NOT automation** - it's just cheaper API access | Use n8n OR Zapier for orchestration |
| Custom animated character | Requires consistent image generation + video animation | Use HeyGen Photo Avatar instead |

### What Was Missing

1. **No clear MVP definition** - What's the minimum to launch?
2. **Website structure not started** - Wix site exists but empty
3. **Character not finalized** - Still in "design phase" after a year
4. **No content actually produced** - Zero videos published

### The Real Question: n8n vs Simpler Options

**n8n is needed IF you want:**
- Scheduled triggers (weekly Torah portion)
- Multi-step workflows (Claude → Image Gen → HeyGen)
- Approval gates before publishing
- Content database tracking

**n8n is NOT needed IF:**
- You manually trigger video creation
- You use HeyGen's built-in Zapier integration
- You're okay with simpler Google Sheets → Zapier → HeyGen flow

**Verdict:** For weekly automated content tied to Torah portions, **n8n adds value**. But start simpler - get ONE video working manually first.

---

## Simplified Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    PHASE 1: MANUAL MVP                       │
│                                                              │
│   You write script → HeyGen generates video → Post manually  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    PHASE 2: SEMI-AUTOMATED                   │
│                                                              │
│   Claude writes script → You approve → HeyGen → Post         │
│   (Triggered manually via n8n webhook or Zapier)             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    PHASE 3: FULLY AUTOMATED                  │
│                                                              │
│   Weekly cron → Claude script → HeyGen → Auto-post           │
│   (With approval gate via email/Slack)                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Technology Stack (Simplified)

| Component | Tool | Why |
|-----------|------|-----|
| **Website** | Wix | Already set up, easy for non-technical updates |
| **Video Generation** | HeyGen | Best API, templates, built-in voice, MCP server available |
| **Script Generation** | Claude API | Quality writing, understands Torah content |
| **Background Images** | Kie.ai (Flux/GPT-4o) | Cheap, good quality, optional |
| **Workflow Automation** | n8n (your existing instance) | You already have it running |
| **Content Tracking** | Supabase (Postgres) | Free tier, MCP access, real database |

### What We're NOT Using

- ❌ **Hedra** - HeyGen does the same thing better
- ❌ **ElevenLabs** - HeyGen has built-in voice
- ❌ **Custom animated character** - Use HeyGen Photo Avatar (simpler, more consistent)
- ❌ **Kie.ai for automation** - It's just an API, not a workflow tool

---

## The Character Decision

### Original Plan: Custom Animated Character
- Requires: Consistent image generation → Hedra animation → Hope it works
- Risk: Style drift, uncanny valley, technical complexity
- Time to first video: Weeks of iteration

### Recommended: HeyGen Photo Avatar
- Requires: One good headshot photo of "Rav Eli" character
- Risk: Lower (HeyGen handles all animation)
- Time to first video: Hours

**Options for the Photo Avatar:**
1. **AI-generated headshot** - Use Midjourney/DALL-E to create a consistent "Modern Sage" face
2. **Real person** - Yonah or someone else becomes the face
3. **Stock photo** - Licensed image of appropriate-looking person

**Recommendation:** Generate ONE high-quality AI headshot, use it for all videos. HeyGen's Photo Avatar feature animates still images with lip-sync.

---

## Execution Plan

### Phase 0: Decisions Required (This Week)
- [ ] **Character decision:** AI-generated face vs real person vs stock?
- [ ] **Voice decision:** HeyGen stock voice vs clone Yonah's voice?
- [ ] **Content cadence:** Weekly (tied to parsha) vs 3x/week vs daily?
- [ ] **Approval workflow:** Who approves scripts? Who approves videos?

### Phase 1: First Video (Week 1)
**Goal:** Produce ONE complete video manually to validate the concept

1. [ ] Write a 60-second script manually (Torah + Tai Chi wisdom)
2. [ ] Create/select character headshot for HeyGen Photo Avatar
3. [ ] Generate video in HeyGen manually
4. [ ] Create simple background image (or use solid color)
5. [ ] Download and review
6. [ ] Post to TikTok/YouTube manually

**Success Criteria:** One video live on social media

### Phase 2: Website MVP (Week 2)
**Goal:** Basic Wix site with essential pages

1. [ ] Set up site structure:
   - Home (hero + latest video embed)
   - About (mission + character intro)
   - Videos (embedded social feeds)
   - Blog (Wix native blog)
   - Contact/Newsletter signup

2. [ ] Configure Wix apps:
   - Blog app
   - Video gallery or social embed
   - Newsletter/email capture

3. [ ] Basic styling:
   - Israeli blue/white color scheme
   - Clean, serene aesthetic
   - Mobile-responsive

**Success Criteria:** Site live at torahtaichi.com with basic content

### Phase 3: Content Pipeline (Weeks 3-4)
**Goal:** Semi-automated workflow for consistent content

1. [ ] Set up Supabase database:
   - Content ideas table
   - Scripts table (with approval status)
   - Published content log

2. [ ] Create Claude prompt template:
   - Input: Torah portion name + theme
   - Output: 60-90 second script + background image prompt

3. [ ] Build n8n workflow (basic):
   - Trigger: Manual webhook or form submission
   - Step 1: Claude generates script
   - Step 2: Save to Supabase for review
   - Step 3: On approval, trigger HeyGen
   - Step 4: Notify when complete

4. [ ] Test end-to-end flow

**Success Criteria:** Can generate a video with one click + approval

### Phase 4: Full Automation (Month 2)
**Goal:** Weekly automated content with minimal intervention

1. [ ] Add weekly cron trigger (Friday for Shabbat parsha)
2. [ ] Add Torah portion API/data source
3. [ ] Add social media auto-posting (or use scheduling tools)
4. [ ] Add analytics tracking

**Success Criteria:** Videos generated and posted weekly with only approval step

### Phase 5: Scale & Optimize (Month 3+)
- A/B test hooks and formats
- Expand to daily content
- Add blog post generation
- Build email list
- Prepare for book launch

---

## Budget Reality Check

### Minimum Viable Budget (Phase 1-2)

| Item | Cost | Notes |
|------|------|-------|
| HeyGen Creator | $29/month | 15 credits/month, ~15 videos |
| Wix | Already paid? | Check existing subscription |
| Domain | Already owned | torahtaichi.com |
| n8n | Free (self-hosted) or $20/month | You have existing instance |
| Claude API | ~$5-10/month | For script generation |
| **Total** | **~$35-60/month** | |

### Optional Add-ons

| Item | Cost | When Needed |
|------|------|-------------|
| Kie.ai credits | Pay-as-you-go | If generating custom backgrounds |
| ElevenLabs | $5-22/month | Only if cloning voice |
| Supabase Pro | $25/month | If exceeding free tier |

---

## Content Strategy (Simplified)

### Weekly Parsha Format
Each week, one video tied to the Torah portion:

```
Hook (3 sec): "This week's parsha teaches us about [concept]..."
Teaching (45 sec): Torah wisdom + Tai Chi parallel
Application (10 sec): "Try this: [simple practice]"
CTA (2 sec): "Follow for more Torah Tai Chi wisdom"
```

### Content Pillars (Rotate)
1. **Middot & Movement** - Character traits through tai chi
2. **Body as Temple** - Jewish health obligations
3. **Balance & Shalom** - Inner peace concepts
4. **Breath & Blessing** - Breathing + kavannah

---

## Immediate Next Steps

### Today
1. Review this plan together
2. Make character decision (AI face vs real person)
3. Write first test script

### This Week
1. Create HeyGen account and Photo Avatar
2. Generate first test video
3. Post to TikTok/YouTube

### Next Week
1. Build basic Wix site structure
2. Set up Supabase content tracker
3. Create n8n workflow skeleton

---

## Open Questions for Yonah

1. **Character:** Are we using an AI-generated face, or does someone want to be on camera?
2. **Voice:** Stock HeyGen voice, or clone a real voice?
3. **Approval:** Who reviews scripts before video generation?
4. **Frequency:** Start with weekly, or aim for more?
5. **Book timeline:** Still ~1 year out? This affects content strategy.

---

## Files in This Project

| File | Purpose |
|------|---------|
| `TORAH_TAI_CHI_MASTER_PLAN.md` | **This file** - Single source of truth |
| `torah-tai-chi-project.md` | Original project overview (reference) |
| `torah-tai-chi-project (1).md` | Detailed technical spec (reference) |
| `torah_taichi_project_overview.md` | Character design notes (reference) |

---

*This plan replaces the scattered documentation with a focused, actionable roadmap.*

---

## Appendix: Deep Dive Platform Comparison (January 2026)

### Executive Summary: Why HeyGen Wins for Torah Tai Chi

After comprehensive research across all major AI avatar platforms, **HeyGen** emerges as the clear winner for this project. Here's why:

| Requirement | HeyGen | Synthesia | Elai.io | D-ID | DeepBrain |
|-------------|--------|-----------|---------|------|-----------|
| **Unlimited videos** | ✅ $29/mo | ❌ 10 min/mo | ❌ 15 min/mo | ❌ Limited | ❌ Limited |
| **Custom Photo Avatar** | ✅ AI-generated | ✅ $1000/yr add-on | ✅ | ✅ | ✅ |
| **API for automation** | ✅ Full API | ✅ Full API | ✅ Zapier only | ✅ | ✅ |
| **n8n integration** | ✅ Native workflows | ✅ HTTP Request | ❌ | ❌ | ❌ |
| **MCP Server** | ✅ Official | ❌ | ❌ | ❌ | ❌ |
| **Voice cloning** | ✅ Included | ✅ With avatar | ✅ | ✅ | ✅ |
| **Cost for weekly content** | **$29/mo** | ~$89/mo | ~$39/mo | ~$50/mo | ~$30/mo |

---

### Detailed Platform Analysis

#### HeyGen - **RECOMMENDED**

**Web Pricing (What We'll Use):**
| Plan | Price | Videos | Duration | Resolution | Key Features |
|------|-------|--------|----------|------------|--------------|
| Free | $0 | 3/month | 3 min | 720p | Watermarked, 500 avatars |
| **Creator** | **$29/mo** | **Unlimited** | 30 min | 1080p | Voice cloning, 700+ avatars, Brand Kit |
| Business | $149/mo | Unlimited | 60 min | 4K | 5 custom avatars, team features |

**API Pricing (For Full Automation):**
| Plan | Price | Credits | Cost/Credit | Notes |
|------|-------|---------|-------------|-------|
| Free | $0 | 10/mo | - | Watermarked |
| Pro | $99/mo | 100 | $0.99 | 1 credit = 1 min video |
| Scale | $330/mo | 660 | $0.50 | Video translation included |

**Photo Avatar Capabilities:**
- Upload your own image OR generate with AI prompts
- Unlimited slots on Creator plan
- "Generate Looks" - change outfits/backgrounds with prompts
- "Look Packs" - batch generate variations
- Motion prompts for gestures
- Avatar IV - highest quality lip-sync (uses GenCredits)

**Why HeyGen for Torah Tai Chi:**
1. **Unlimited videos at $29/mo** - No minute counting for weekly content
2. **Photo Avatar from AI image** - Create "Rav Eli" without a real person
3. **MCP Server** - Can integrate directly with AI assistants
4. **n8n workflows exist** - Pre-built templates for automation
5. **Voice cloning included** - Consistent voice across all videos

---

#### Synthesia - Strong Alternative

**Pricing:**
| Plan | Price | Minutes | Avatars | API |
|------|-------|---------|---------|-----|
| Free | $0 | 10 min/mo | 9 | ❌ |
| Starter | $29/mo | 10 min/mo | 125 | ❌ |
| Creator | $89/mo | 30 min/mo | 180 | ✅ 360 min/yr |
| Enterprise | Custom | Unlimited | 230+ | ✅ |

**Pros:**
- Highest avatar realism (G2 rated #1)
- Best for corporate/training content
- Bulk personalization from CSV
- 140+ languages

**Cons for Torah Tai Chi:**
- **Minute-based pricing** - 10 min/mo at $29 = only ~10 videos
- Custom avatar is $1000/year add-on
- More "corporate" feel, less creative
- API only on Creator ($89/mo) or higher

---

#### Elai.io - Budget Option

**Pricing:**
| Plan | Price | Minutes | Features |
|------|-------|---------|----------|
| Free | $0 | 1 min | 80 avatars |
| Creator | ~$29/mo | 15 min/mo | Full HD |
| Team | ~$59/mo | Custom | 4K, premium voices |

**Pros:**
- Good Zapier integration
- Competitive pricing
- Photo-to-avatar feature

**Cons:**
- No native n8n integration
- Minute-based limits
- Less mature API

---

#### D-ID - Quick Social Clips

**Pricing:** ~$5.90/min for API, studio plans from $16/mo

**Pros:**
- Fast generation
- Good for short clips
- Simple API

**Cons:**
- Per-minute pricing adds up fast
- Less feature-rich
- No MCP server

---

#### DeepBrain AI Studios - Enterprise Focus

**Pricing:**
| Plan | Price | Videos | Features |
|------|-------|--------|----------|
| Free | $0 | 3 videos | 720p, 3 min max |
| Personal | $30/mo | Unlimited | 1080p, 30 min max |
| Team | $99/mo | Unlimited | 4K, 60 min max |

**Pros:**
- Unlimited videos on paid plans
- Good avatar quality
- Interactive features

**Cons:**
- Less automation-friendly
- Smaller avatar library
- No MCP server

---

### Cost Analysis: Torah Tai Chi (52 Weekly Videos/Year)

| Platform | Plan Needed | Annual Cost | Notes |
|----------|-------------|-------------|-------|
| **HeyGen** | Creator $29/mo | **$348/year** | Unlimited videos, best value |
| Synthesia | Creator $89/mo | $1,068/year | Only 30 min/mo, may need more |
| Elai.io | Creator ~$29/mo | ~$348/year | 15 min/mo may be tight |
| DeepBrain | Personal $30/mo | $360/year | Comparable, less automation |

**Winner: HeyGen Creator at $29/mo** - Unlimited videos, best automation support

---

### Automation Capability Comparison

| Platform | n8n | Zapier | Make | API | Webhooks | MCP |
|----------|-----|--------|------|-----|----------|-----|
| **HeyGen** | ✅ HTTP + workflows | ✅ | ✅ | ✅ Full | ✅ | ✅ |
| Synthesia | ✅ HTTP | ✅ Native | ✅ Native | ✅ Full | ✅ | ❌ |
| Elai.io | ❌ | ✅ Native | ❌ | Limited | ❌ | ❌ |
| D-ID | ✅ HTTP | ✅ | ✅ | ✅ | ✅ | ❌ |
| DeepBrain | ❌ | ❌ | ❌ | Limited | ❌ | ❌ |

**HeyGen has the best automation ecosystem** - existing n8n workflow templates, MCP server for AI agents, and full API access.

---

### The n8n Question Revisited

**Do we still need n8n with HeyGen?**

**YES** - but HeyGen makes it much easier:

| Task | Without n8n | With n8n |
|------|-------------|----------|
| Weekly trigger | Manual | ✅ Cron job |
| Torah portion lookup | Manual | ✅ API call |
| Script generation | Manual | ✅ Claude API |
| Video creation | HeyGen UI | ✅ HeyGen API |
| Wait for completion | Manual check | ✅ Webhook/polling |
| Post to social | Manual | ✅ Platform APIs |

**HeyGen's MCP Server** could potentially replace n8n for simple workflows, but n8n gives more control and the ability to chain multiple services.

**Recommended Architecture:**
```
n8n (orchestration)
  ├── Cron trigger (weekly)
  ├── Torah portion API
  ├── Claude API (script generation)
  ├── HeyGen API (video generation)
  ├── Wait for webhook
  └── Social media APIs (posting)
```

---

## FINAL TECH STACK DECISION

### Confirmed Stack for Torah Tai Chi

| Component | Tool | Cost | Why |
|-----------|------|------|-----|
| **Video Generation** | HeyGen Creator | $29/mo | Unlimited videos, Photo Avatar, best automation |
| **Avatar** | HeyGen Photo Avatar | Included | AI-generated "Rav Eli" character |
| **Voice** | HeyGen Voice Clone | Included | Consistent voice (or stock voice to start) |
| **Script Generation** | Claude API | ~$5-10/mo | Quality Torah content, custom prompts |
| **Workflow Automation** | n8n (your instance) | $0-20/mo | Weekly triggers, API orchestration |
| **Content Tracking** | Supabase (Postgres) | $0 (free tier) | Ideas, scripts, published content |
| **Website** | Wix | Existing | Already set up, easy updates |
| **Social Posting** | Manual → Later automate | $0 | Start manual, add automation later |

**Total Monthly Cost: ~$35-60/month**

### Why This Stack Wins

1. **HeyGen Creator ($29/mo) gives UNLIMITED videos** - No minute counting
2. **Photo Avatar lets us create "Rav Eli" from AI image** - No real person needed
3. **n8n + HeyGen API = full automation** - Pre-built workflow templates exist
4. **MCP Server available** - Future AI agent integration possible
5. **Voice cloning included** - Consistent character voice
6. **Best cost-to-value ratio** - $348/year for unlimited content

### What We're NOT Using (And Why)

| Tool | Why Not |
|------|---------|
| Invideo AI | No consistent avatar, can't build "Rav Eli" brand |
| Synthesia | $89/mo for API, minute-based limits, $1000 custom avatar |
| Elai.io | No n8n integration, minute limits |
| D-ID | Per-minute pricing, less features |
| Hedra | HeyGen does the same thing better |
| Kie.ai | Just an API aggregator, not needed with HeyGen |
| ElevenLabs | HeyGen has voice cloning built-in |

---

## REVISED EXECUTION PLAN

### Phase 1: First Video (This Week)
**Goal:** One video live using HeyGen

1. [ ] Sign up for HeyGen Creator ($29/mo)
2. [ ] Create "Rav Eli" Photo Avatar:
   - Option A: Generate with AI prompt in HeyGen
   - Option B: Create image in Midjourney/DALL-E, upload to HeyGen
3. [ ] Write first 60-second script manually
4. [ ] Generate video in HeyGen
5. [ ] Download and post to TikTok/YouTube

**Success Criteria:** One video posted

### Phase 2: Avatar Refinement (Week 2)
**Goal:** Consistent, recognizable character

1. [ ] Refine "Rav Eli" avatar prompt/image
2. [ ] Generate "Looks" (different backgrounds/outfits)
3. [ ] Test voice options (stock vs clone)
4. [ ] Create 3-5 more videos manually
5. [ ] Establish visual brand consistency

**Success Criteria:** 5 videos with consistent character

### Phase 3: Website Launch (Week 2-3)
**Goal:** Basic Wix site live

1. [ ] Set up site structure (Home, About, Videos, Blog)
2. [ ] Embed social media feeds
3. [ ] Add newsletter signup
4. [ ] Basic styling (blue/white theme)

**Success Criteria:** Site live at torahtaichi.com

### Phase 4: Semi-Automation (Week 4)
**Goal:** n8n workflow for assisted creation

1. [ ] Set up Supabase content tracker
2. [ ] Create Claude prompt template for scripts
3. [ ] Build n8n workflow:
   - Manual trigger (webhook)
   - Claude generates script
   - Save to Supabase for review
4. [ ] Test script generation quality

**Success Criteria:** Can generate scripts with one click

### Phase 5: Full Automation (Month 2)
**Goal:** Weekly automated pipeline

1. [ ] Add HeyGen API to n8n workflow
2. [ ] Add weekly cron trigger
3. [ ] Add Torah portion data source
4. [ ] Add approval gate (email/Slack notification)
5. [ ] Test end-to-end flow

**Success Criteria:** Weekly videos generated automatically with approval step

### Phase 6: Social Automation (Month 3)
**Goal:** Auto-posting to platforms

1. [ ] Add YouTube upload to n8n
2. [ ] Add TikTok posting (if API available)
3. [ ] Add Instagram/Facebook (when accounts ready)
4. [ ] Set up scheduling

**Success Criteria:** Videos auto-posted after approval

---

## Immediate Next Steps

### Today
1. **Sign up for HeyGen Creator** - $29/mo, cancel anytime
2. **Create first Photo Avatar** - Test the AI generation feature
3. **Write first script** - 60 seconds on a Torah/Tai Chi concept

### This Week
1. Generate first video
2. Post to TikTok and YouTube
3. Iterate on avatar if needed

### Decision: Avatar Approach

**Option A: AI-Generated Face (Recommended)**
- Use HeyGen's "Design with AI" feature
- Prompt: "Middle-aged Jewish man, mid-50s, fit, gray-streaked dark hair and beard, warm smile, wearing navy blue mandarin collar athletic shirt, brown leather kippah, peaceful expression, professional headshot style"
- Pros: No real person needed, fully controllable, consistent
- Cons: May need iteration to get right

**Option B: Real Person**
- Yonah or someone else becomes the face
- Upload photo to HeyGen
- Pros: More authentic, easier to get right
- Cons: Ties brand to real person

**Recommendation:** Start with Option A. If the AI-generated avatar doesn't work well after a few attempts, fall back to Option B.
