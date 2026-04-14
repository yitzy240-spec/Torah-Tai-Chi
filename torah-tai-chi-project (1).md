# Torah Tai Chi - Project Documentation

## Overview

Torah Tai Chi is a wellness content platform that bridges ancient Jewish Torah wisdom with Tai Chi philosophy and practice. The project centers around an animated character—a modern sage—who delivers short-form video teachings on mind, body, and spirit wellness.

### Core Concept

Both Judaism and Tai Chi share foundational concepts around health and wellness of mind, body, and spirit. This project creates content that explores the intersection of these two traditions, making ancient wisdom accessible through modern digital media.

### Target Audience

English-speaking adults interested in:
- Holistic health and wellness
- Mindfulness and meditation
- Martial arts philosophy
- Jewish spirituality
- Mind-body-spirit connection

---

## Project Goals

### Goal 1: Website Assets

Create short, looping animated clips of the character performing Tai Chi movements to use as visual assets throughout the website as users scroll.

**Requirements:**
- Transparent or clean background animations
- Consistent character style
- Multiple movement loops (cloud hands, wave hands, etc.)
- Web-optimized formats (webm, Lottie, or mp4)

### Goal 2: Weekly Automated Video Shorts

Produce weekly video content tied to the Torah portion, delivered through an automated n8n workflow. Each video features the character as a talking head with dynamic background visuals reflecting the discussion topic.

**Requirements:**
- Consistent character appearance across all videos
- Dynamic backgrounds that reflect the weekly theme
- Professional captions/subtitles
- Multi-platform export (9:16 for TikTok/Reels, 16:9 for YouTube)

---

## The Character

### Description

A modern sage who bridges ancient wisdom traditions:
- **Appearance:** Fit middle-aged man (mid-50s), gray-streaked dark hair and beard
- **Attire:** Brown leather kippah, navy blue mandarin-collar athletic shirt
- **Expression:** Warm, approachable smile; calm and peaceful demeanor
- **Style:** Clean vector illustration, flat colors, modern minimalist

### Character Bio

**Name:** Rav Eli (or "The Guide")

A lifelong Torah scholar and Tai Chi practitioner who discovered the profound parallels between Jewish teachings on mind-body-spirit wellness and Eastern martial arts philosophy. Warm, approachable, and physically fit, he carries decades of learning lightly—preferring a gentle smile over stern lectures. He teaches that true health comes from aligning body, breath, and soul.

### Tai Chi Movements for Animation

1. **Cloud Hands (Yun Shou)** - Hands float horizontally across the body like clouds drifting across the sky
2. **Wave Hands Like Clouds** - Arms rise and sink like waves, palms turning gently
3. **Grasp the Sparrow's Tail** - Hands extend forward, pull back toward chest, then push outward
4. **Single Whip** - One arm extends with "beak hand" while other sweeps across body
5. **Parting the Wild Horse's Mane** - Alternating diagonal arm movements

---

## Website

### Platform

Wix (chosen for ease of content updates by non-technical team members)

### Site Description (for Wix AI)

> A wellness blog and video content hub called "Torah Tai Chi" that combines Jewish Torah wisdom with Tai Chi philosophy and practice. The site serves as the central home for social media content featuring an animated modern sage character—an athletic, fit man with a kippah and slight gray in his beard who delivers short-form video teachings on mind, body, and spirit wellness.
>
> **Features needed:**
> - Video gallery/media section for teaching videos
> - Blog for written articles
> - Resources section with external links
> - Social media integration
> - Clean, serene aesthetic with Israeli flag color palette (blue and white)
> - Modern yet spiritual feel—approachable for general wellness audience
>
> **Target audience:** English-speaking adults interested in holistic health, mindfulness, meditation, martial arts philosophy, and Jewish spirituality.

### Visual Style

- **Color Palette:** Israeli flag colors (blue and white) with warm earth tone accents
- **Aesthetic:** Serene, modern, spiritual but not overly religious
- **Feel:** Wise but warm, like learning from a friendly teacher

---

## Automated Video Production Pipeline

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     WEEKLY TRIGGER                          │
│              (Torah portion of the week)                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    CLAUDE API                               │
│                                                             │
│  Input: Torah portion name/text                             │
│  Output:                                                    │
│    - 60-90 second spoken script                             │
│    - 3-5 scene descriptions for background visuals          │
│    - Title and subtitle text                                │
│    - Structured JSON format                                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    KIE.AI API                               │
│           (Background Visual Generation)                    │
│                                                             │
│  Models available:                                          │
│    - GPT-4o Image (images with good text rendering)         │
│    - Flux Kontext (consistent style images)                 │
│    - Veo 3.1 Fast (video clips, cost-effective)             │
│                                                             │
│  Output: 3-5 background images or video clips               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    HEYGEN API                               │
│              (Full Video Generation)                        │
│                                                             │
│  Template includes:                                         │
│    - Avatar (Photo Avatar of character)                     │
│    - Voice (text-to-speech)                                 │
│    - Background (image or video)                            │
│    - Text overlays                                          │
│    - Captions                                               │
│                                                             │
│  Output: Complete rendered video                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      OUTPUT                                 │
│                                                             │
│  - Save to Google Drive                                     │
│  - Optional: Auto-post to social media APIs                 │
│    (Instagram, TikTok, YouTube)                             │
└─────────────────────────────────────────────────────────────┘
```

### Video Structure

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   [Dynamic background visuals reflecting the topic]         │
│                                                             │
│   - Serene nature scenes                                    │
│   - Abstract flowing imagery                                │
│   - Thematic illustrations                                  │
│                                                             │
│                    ┌──────────────┐                         │
│                    │              │                         │
│                    │  Character   │                         │
│                    │  talking     │                         │
│                    │  head (PIP)  │                         │
│                    └──────────────┘                         │
│                                                             │
│   [Captions/subtitles at bottom]                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

### APIs & Services

| Service | Purpose | Notes |
|---------|---------|-------|
| **Claude API** | Script generation | Generates weekly scripts + scene descriptions |
| **Kie.ai** | Image/video generation | Unified API for GPT-4o Image, Flux, Veo 3.1 |
| **HeyGen** | Talking avatar + full video | Template-based video generation with backgrounds |
| **ElevenLabs** | Voice generation (optional) | If custom voice cloning needed |
| **n8n** | Workflow automation | Orchestrates the entire pipeline |

### HeyGen Setup

**Photo Avatar Requirements:**
- Front-facing, eyes looking at camera
- Neutral or slight smile expression
- High resolution (1024+ pixels)
- Clean/solid background
- Head and shoulders visible
- No hands near face

**Template Variables:**
- `{{script}}` - The spoken text
- `{{background}}` - Image or video URL
- `{{title}}` - Video title overlay
- `{{subtitle}}` - Optional subtitle

**Background Options via API:**
```json
// Solid color
{ "type": "color", "value": "#FAFAFA" }

// Image
{ "type": "image", "url": "https://..." }

// Video
{ "type": "video", "url": "https://...", "play_style": "loop" }
```

### n8n Integration

**HeyGen in n8n:**
- Community node available: `@1kdanny/n8n-nodes-heygen`
- Or use HTTP Request node with HeyGen API directly
- Existing workflow template: [Generate AI videos from text with HeyGen](https://n8n.io/workflows/3054)

**Kie.ai in n8n:**
- Use HTTP Request node
- API documentation: https://docs.kie.ai

---

## Background Visual Style Options

### Option A: Ink & Watercolor Eastern
- Flowing ink wash landscapes
- Bamboo, mountains, water
- Muted earth tones with blue accents
- Meditative, timeless feel

### Option B: Modern Geometric/Abstract
- Flowing lines and shapes
- Sacred geometry elements
- Blue/white/gold palette
- Clean, contemporary

### Option C: Illustrated (Matching Character)
- Same vector/flat illustration style
- Custom scene illustrations
- Most cohesive but requires more asset creation

### Option D: Cinematic Nature
- Real footage or AI-generated realistic scenes
- Sunrises, flowing water, forests
- High production feel

**Recommended:** Start with Option A or a hybrid approach using a locked-in style prompt for consistency.

---

## Sample Content

### HeyGen Avatar Test Script

**Short (15 seconds):**
> Shalom, and welcome to Torah Tai Chi. I'm here to guide you on a journey where ancient Jewish wisdom meets the flowing art of Tai Chi. Together, we'll explore how to nurture your mind, body, and spirit.

**Medium (30 seconds):**
> Shalom, and welcome to Torah Tai Chi. I'm here to guide you on a journey where ancient Jewish wisdom meets the flowing art of Tai Chi.
>
> Both traditions teach us that true health comes from balance—balance between action and rest, between strength and softness, between the physical and the spiritual.
>
> Together, we'll explore practices that nurture your mind, strengthen your body, and uplift your spirit. Let's begin.

---

## Implementation Roadmap

### Phase 1: Foundation
- [ ] Finalize character design (HeyGen-ready headshot)
- [ ] Create HeyGen Photo Avatar
- [ ] Select/clone voice in HeyGen (or ElevenLabs)
- [ ] Build HeyGen template with placeholders
- [ ] Test one video manually end-to-end

### Phase 2: Automation Setup
- [ ] Set up Kie.ai account and API key
- [ ] Lock in background visual style prompt
- [ ] Build n8n workflow structure
- [ ] Test Claude script generation prompt
- [ ] Test Kie.ai image generation
- [ ] Connect all nodes in n8n

### Phase 3: Website
- [ ] Select Wix template
- [ ] Customize design (colors, fonts, layout)
- [ ] Create pages (Home, Videos, Blog, Resources, About)
- [ ] Set up social media integration
- [ ] Add initial content

### Phase 4: Website Animations (Goal 1)
- [ ] Generate/rig character for animation
- [ ] Create looping Tai Chi movement clips
- [ ] Export in web-optimized formats
- [ ] Integrate into Wix site

### Phase 5: Launch
- [ ] Test full weekly automation cycle
- [ ] Set up social media accounts
- [ ] Configure auto-posting (optional)
- [ ] Go live

---

## Team & Contacts

- **Yonah Lloyd** - Project Owner
- **Harvey** - Collaborator (providing feedback on character/direction)
- **Yitzy Marcus** - Technical Implementation

---

## Resources & Links

- **Kie.ai API Docs:** https://docs.kie.ai
- **HeyGen API Docs:** https://docs.heygen.com
- **HeyGen Template API:** https://docs.heygen.com/docs/generate-video-from-template-v3
- **n8n HeyGen Workflow:** https://n8n.io/workflows/3054
- **Wix Templates:** https://www.wix.com/website/templates

---

## Notes

- Content is for English-speaking audience
- Yonah and Harvey will handle content uploads (need simple platform)
- Weekly videos tied to Torah portion create natural content calendar
- Social media clips drive traffic to website
- Character consistency is critical across all generated content
