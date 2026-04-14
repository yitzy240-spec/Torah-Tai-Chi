# Torah Tai Chi — Complete n8n Implementation Guide
## Full Pipeline: Script → Audio → Video → Stitch → Output

**Version:** 3.2 — Kie.ai TTS proxy replaces direct ElevenLabs
**Date:** February 24, 2026
**Status:** Ready for test run

> **API Verification Notes (v3.1):**
> - Kie.ai polling endpoint is `GET /api/v1/jobs/recordInfo?taskId=XXX` (not `/jobs/{taskId}`)
> - Kie.ai uses `state` field (not `status`) with values: `waiting`, `queuing`, `generating`, `success`, `fail`
> - Kie.ai results are in `data.resultJson` → parse JSON → `resultUrls[]`
> - Seedance 2.0 may not yet be on Kie.ai — fallback model is `bytedance/seedance-1.5-pro`
> - fal.ai merge-videos does **not** support crossfade — use `fal-ai/ffmpeg-api/compose` for transitions
> - Audio files should be hosted via Kie.ai File Upload API (not Google Drive)
> - ElevenLabs TTS is proxied through Kie.ai (`elevenlabs/text-to-speech-multilingual-v2`) — no separate ElevenLabs account needed
> - TTS uses same createTask/poll pattern as Seedance video generation

---

## Table of Contents

1. [Prerequisites & Setup](#1-prerequisites--setup)
2. [Workflow Variables](#2-workflow-variables)
3. [Claude Script Prompt (Full)](#3-claude-script-prompt-full)
4. [Workflow 3: Video Production (Complete Node-by-Node)](#4-workflow-3-video-production)
5. [Manual Test Run Steps](#5-manual-test-run-steps)
6. [Troubleshooting](#6-troubleshooting)

---

## 1. Prerequisites & Setup

### API Accounts Needed

| Service | Purpose | Sign Up | Plan |
|---------|---------|---------|------|
| **Kie.ai** | Seedance video gen + ElevenLabs TTS + audio hosting | https://kie.ai | Pay-as-you-go |
| **Anthropic** | Claude script generation | https://console.anthropic.com | Pay-as-you-go |
| **fal.ai** | FFmpeg video stitching | https://fal.ai | Pay-as-you-go |
| **Supabase** | Content tracking (Postgres DB) | https://supabase.com | Free tier OK |

### Credentials to Configure in n8n

Create these credentials in n8n Settings → Credentials BEFORE building workflows:

1. **Header Auth — Kie.ai** (`kieAiAuth`): Name=`Authorization`, Value=`Bearer YOUR_KIE_API_KEY` — used for Seedance video AND ElevenLabs TTS
2. **Header Auth — fal.ai** (`falAiAuth`): Name=`Authorization`, Value=`Key YOUR_FAL_API_KEY`
3. **Header Auth — Anthropic** (`anthropicAuth`): Name=`x-api-key`, Value=`YOUR_ANTHROPIC_API_KEY`
4. **Supabase** (`supabaseAuth`): Project URL + service role key from your Supabase dashboard (Settings → API)

> **Important:** All HTTP Request nodes should use these credential names via n8n's credential system — never hardcode API keys in node parameters.

### Character Image

Generate your character image ONCE and host it at a permanent public URL. Every Seedance call uses this same URL.

**Generation prompt** (use GPT-4o Image, Midjourney, or Flux):
```
Full-body illustration of a Torah Tai Chi instructor. Mid-50s Jewish man,
warm smile, trimmed gray-flecked beard, wearing a knit kippah and fitted
navy blue athletic wear. Athletic but approachable build. Standing in a
relaxed, balanced tai chi posture. Modern minimalist flat illustration
style with clean lines. Solid white background. Professional character
design suitable for animation.
```

Upload the result to Google Drive (make publicly accessible) or an S3 bucket. Save the URL — this is your `CHARACTER_IMAGE_URL`.

### Supabase Database

Create a table called `content` in your Supabase project with this schema:

```sql
CREATE TABLE content (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT,
  hook TEXT,
  parsha TEXT,
  content_pillar TEXT CHECK (content_pillar IN ('wisdom', 'movement', 'mindfulness', 'health', 'spirituality')),
  description TEXT,
  script_json JSONB,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'script_review', 'script_approved', 'generating', 'video_review', 'ready_to_publish', 'published')),
  segment_video_urls JSONB,
  final_video_url TEXT,
  platform_links JSONB,
  cost_usd NUMERIC(10,2),
  error_log TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```|

---

## 2. Workflow Variables

In n8n, set these as **Workflow Variables** (Settings → Variables, available in n8n 1.x+). Access them in expressions as `{{ $vars.VARIABLE_NAME }}`.

Alternatively, use a **Set node** at the start of the workflow to define these as fields that flow through the pipeline.

```json
{
  "CHARACTER_IMAGE_URL": "https://drive.google.com/uc?id=YOUR_FILE_ID",
  "ELEVENLABS_VOICE_ID": "YOUR_VOICE_ID",
  "SUPABASE_URL": "https://YOUR_PROJECT_ID.supabase.co",
  "SUPABASE_SERVICE_KEY": "YOUR_SERVICE_ROLE_KEY",
  "GOOGLE_DRIVE_FOLDER_ID": "YOUR_FOLDER_ID",
  "ASPECT_RATIO": "9:16",
  "RESOLUTION": "1080p",
  "SEEDANCE_MODEL": "bytedance/seedance-1.5-pro"
}
```

---

## 3. Claude Script Prompt (Full)

This is the COMPLETE system prompt. Copy-paste it exactly into the Claude API node.

<details>
<summary><strong>Click to expand full system prompt (long)</strong></summary>

```
You are the scriptwriter and visual director for "Torah Tai Chi," a short-form video series featuring an illustrated animated sage who delivers Torah-inspired wellness wisdom. Your job is to produce a complete production script that will be processed by an automated video pipeline.

TECHNICAL CONSTRAINTS:
The video is generated by Seedance 2.0. Each segment = one API call.
1. You write segments. Each segment's text → audio (ElevenLabs) → audio + character image + scene_prompt → Seedance 2.0 → video clip.
2. All clips are stitched together into one final video with 0.5s crossfade transitions.

HARD LIMITS PER SEGMENT:
- Duration: 4 to 15 seconds. NEVER exceed 15 seconds.
- Speaking pace: ~2.5 words/second (calm, wise delivery).
- 10 words ≈ 4 sec, 25 words ≈ 10 sec, 37 words ≈ 15 sec MAXIMUM.
- If a thought needs >37 words, SPLIT across two segments.
- ALWAYS err shorter. 12 seconds is better than 15.
- Each segment is generated INDEPENDENTLY — Seedance has no memory between segments.

TOTAL VIDEO: 60-75 seconds. 5-7 segments ideal.

CHARACTER:
- Mid-50s illustrated Jewish sage, navy athletic wear, kippah, trimmed beard.
- NEVER describe his appearance in scene_prompt (the reference image handles that).
- ONLY describe ACTIONS, MOVEMENT, EXPRESSION, and POSITION.

VOICE & TONE (for script_text):
- Warm, wise, conversational — like a favorite uncle sharing life advice.
- Simple language. Short sentences. No jargon.
- Hebrew terms OK but ALWAYS naturally translated: "What the Torah calls shalom — true peace..."
- Use "you" and "we." Rhetorical questions work well.
- NO cheesy sign-offs. Keep it genuine.

VIDEO STRUCTURE:
Seg 1 — HOOK (5-8 sec, ~12-20 words): Stop the scroll. Character already in motion — NEVER start static.
Seg 2-4 — TEACHING (30-45 sec, 2-3 segments): Core Torah-Tai Chi insight. Vary movement/camera across segments.
Seg 5-6 — PRACTICE (10-15 sec, 1-2 segments): Simple viewer takeaway. Closer camera, slower movement.
Final — CLOSE (5-8 sec, ~12-20 words): Warm sign-off. Mention "Torah Tai Chi" naturally. Character walks away or gentle ending.

SCENE PROMPT ENGINEERING:
Each scene_prompt goes directly to Seedance 2.0. It MUST include ALL 7 elements in this order:

1. CHARACTER ACTION: What is the character physically doing?
   ✓ "Character walks slowly along a riverside path"
   ✗ "Character talks" (too vague)

2. HAND/BODY DETAIL: Specific hand and body position.
   ✓ "hands clasped behind his back"
   ✓ "gestures gently with right hand, left resting at side"

3. EXPRESSION: Facial emotion.
   ✓ "warm contemplative smile"
   ✓ "eyebrows raised with curiosity"

4. ENVIRONMENT: Specific, vivid setting.
   ✓ "sunlit riverside path, morning golden light, smooth river stones, willow trees"
   ✗ "nature scene" (useless)

5. LIGHTING: Light quality.
   ✓ "warm golden hour backlighting, long shadows"
   ✓ "dappled sunlight filtering through canopy"

6. CAMERA: Camera movement/angle.
   ✓ "camera follows at medium distance, smooth side tracking shot"
   ✓ "slow push-in from wide to medium close-up"

7. LIP SYNC: ALWAYS end every scene_prompt with exactly:
   "Character speaks naturally, matching @audio_file_1 with expressive lip sync."

ENVIRONMENTS (pick from these — they render well in Seedance):
- RIVERSIDE_PATH: "sunlit riverside path, smooth river stones, willow trees, flowing clear water, wildflowers"
- FOREST_TRAIL: "dappled forest trail, tall deciduous trees, ferns, natural earth path, fallen leaves"
- OLIVE_GROVE: "ancient olive grove, gnarled trunks, dry golden grass, Mediterranean warmth, stone terrace"
- GARDEN_COURTYARD: "serene garden courtyard, stone water feature, trimmed hedges, flowering vines on old walls"
- HILLTOP_VISTA: "grassy hilltop overlooking green valley, distant rolling hills, open sky, ancient tree"
- BAMBOO_GROVE: "tall bamboo grove, soft ground mist, filtered green light, natural bamboo corridor"
- LAKESIDE_DOCK: "weathered wooden dock over calm lake, mountains reflected in still water, morning mist"

MOVEMENTS (pick from these):
- WALKING_FORWARD: walks along path, camera tracks
- WALKING_ALONGSIDE: walks at gentle pace, camera beside at same speed
- PAUSE_AND_TURN: pauses mid-step, turns slightly toward camera
- STANDING_GESTURE: stands relaxed, gestures with hands, shifts weight
- STANDING_CONTEMPLATIVE: gazes at feature, hands folded, thoughtful
- REACHING_TOUCHING: reaches to touch tree bark / water / stone
- TURNING_REVEAL: back to camera, slowly turns to face and speak
- WALKING_AWAY: walks slowly away from camera

CAMERAS (vary across segments — never repeat 3x in a row):
- TRACKING_SIDE: alongside at same pace
- TRACKING_FRONT: leads character, walking backward
- TRACKING_BEHIND: follows from behind
- STATIC_MEDIUM: stationary, medium shot
- SLOW_PUSH_IN: slowly moves toward character
- SLOW_PULL_OUT: slowly moves away
- LOW_ANGLE_UP: below eye level looking up
- EYE_LEVEL: straight on, conversational
- ORBIT_SLOW: very slowly circles character

ENVIRONMENT CONTINUITY:
Use the SAME environment for all segments (recommended) OR change only at natural content breaks. Keep lighting consistent throughout (all morning, or all golden hour).

TRANSITIONS:
Plan segment endings/beginnings for 0.5s crossfade:
GOOD: walking → walking, pause → different angle, turn → new direction
BAD: mid-gesture → different pose, close-up → same-angle close-up

OUTPUT FORMAT — Return ONLY valid JSON. No markdown. No code fences. No commentary.

{
  "title": "Short title, max 60 chars",
  "description": "2-sentence social caption with core insight.",
  "hashtags": ["#TorahTaiChi", "#JewishWellness", "3-5 more"],
  "content_pillar": "wisdom|movement|mindfulness|health|spirituality",
  "parsha_reference": "Parsha name — specific concept (verse)",
  "visual_strategy": "single_location",
  "primary_environment": "RIVERSIDE_PATH",
  "lighting_era": "morning_golden",
  "total_duration_sec": 65,
  "segment_count": 6,
  "segments": [
    {
      "segment_id": 1,
      "role": "hook",
      "duration_sec": 8,
      "word_count": 20,
      "script_text": "Exact spoken words. Punctuation guides pacing — commas for pauses, periods for stops, ellipses for trailing thought.",
      "scene_prompt": "Full 7-element Seedance prompt. Self-contained. Ends with lip sync instruction referencing @audio_file_1.",
      "environment": "RIVERSIDE_PATH",
      "movement": "WALKING_FORWARD",
      "camera": "TRACKING_FRONT",
      "hand_position": "hands clasped behind back",
      "expression": "warm inviting smile",
      "transition_out": "continues walking, slight head turn",
      "transition_in_next": "walking, camera from different angle"
    }
  ]
}

VALIDATION (check before returning):
☐ Every duration_sec between 4-15
☐ Every word_count matches actual script_text word count
☐ word_count ÷ 2.5 ≈ duration_sec (±2 sec)
☐ Sum of duration_sec = total_duration_sec
☐ total_duration_sec between 55-80
☐ segment_count matches actual segment count
☐ No two adjacent segments use same camera
☐ Every scene_prompt ends with "@audio_file_1 with expressive lip sync"
☐ Every scene_prompt has all 7 elements
☐ First segment role="hook", character already moving
☐ Last segment role="close", mentions "Torah Tai Chi"
☐ transition_out of N compatible with transition_in_next
```

</details>

---

## 4. Workflow 3: Video Production

This is the main workflow. Build it exactly as described. Each numbered section = one n8n node.

### Node Map

```
[1. Webhook Trigger]
    │
    ▼
[2. Supabase: Get Record]
    │
    ▼
[3. Supabase: Set Status → "generating"]
    │
    ▼
[4. HTTP Request: Claude API — Generate Script]
    │
    ▼
[5. Code: Parse & Validate Script]
    │
    ▼
[6. Supabase: Save Script JSON]
    │
    ▼
[7. Split In Batches — segments]
    │
    ▼
[8. HTTP Request: ElevenLabs — Generate Audio]
    │
    ▼
[9. HTTP Request: Google Drive — Upload Audio]
    │
    ▼
[10. Code: Build Seedance Payload]
    │
    ▼
[11. HTTP Request: Kie.ai — Create Seedance Task]
    │
    ▼
[12. Wait: 15 seconds]
    │
    ▼
[13. HTTP Request: Kie.ai — Poll Task Status]
    │
    ▼
[14. IF: Task Complete?]
    │
    ├─ NO → [12. Wait] (loop)
    │
    └─ YES ↓
[15. Code: Store Segment Result]
    │
    ▼
[7. Split In Batches — next segment] (loop back)
    │
    ▼ (when all segments done)
[16. Code: Collect All Video URLs]
    │
    ▼
[17. HTTP Request: fal.ai — Submit Merge Job]
    │
    ▼
[18. Wait: 10 seconds]
    │
    ▼
[19. HTTP Request: fal.ai — Poll Merge Status]
    │
    ▼
[20. IF: Merge Complete?]
    │
    ├─ NO → [18. Wait] (loop)
    │
    └─ YES ↓
[21. HTTP Request: Google Drive — Upload Final Video]
    │
    ▼
[22. Supabase: Update Record with Video URL + Status]
    │
    ▼
[23. Email/Slack: Notify — Video Ready for Review]
```

---

### Node 1: Webhook Trigger

**Type:** Webhook
**Method:** POST
**Path:** `/torah-tai-chi-produce`
**Authentication:** None (or header auth if you want security)
**Response Mode:** Immediately

For testing, you can also use a **Manual Trigger** and hardcode a test Supabase record ID.

---

### Node 2: Supabase — Get Record

**Type:** HTTP Request (Supabase REST API)
**Method:** GET
**URL:** `{{ $vars.SUPABASE_URL }}/rest/v1/content?id=eq.{{$json.body.record_id}}&select=*`

**Headers:**
| Header | Value |
|--------|-------|
| `apikey` | `{{ $vars.SUPABASE_SERVICE_KEY }}` |
| `Authorization` | `Bearer {{ $vars.SUPABASE_SERVICE_KEY }}` |

Returns an array — use `{{$json[0]}}` to access the record.

---

### Node 3: Supabase — Set Status

**Type:** HTTP Request (Supabase REST API)
**Method:** PATCH
**URL:** `{{ $vars.SUPABASE_URL }}/rest/v1/content?id=eq.{{$node["Supabase Get Record"].json[0].id}}`

**Headers:**
| Header | Value |
|--------|-------|
| `apikey` | `{{ $vars.SUPABASE_SERVICE_KEY }}` |
| `Authorization` | `Bearer {{ $vars.SUPABASE_SERVICE_KEY }}` |
| `Content-Type` | `application/json` |
| `Prefer` | `return=minimal` |

**Body:** `{ "status": "generating", "updated_at": "{{ $now.toISO() }}" }`

---

### Node 4: HTTP Request — Claude API (Script Generation)

**Type:** HTTP Request
**Method:** POST
**URL:** `https://api.anthropic.com/v1/messages`

**Authentication:** Use the `anthropicAuth` Header Auth credential configured in n8n.

**Additional Headers:**
| Header | Value |
|--------|-------|
| `anthropic-version` | `2023-06-01` |
| `Content-Type` | `application/json` |

**Settings:** Enable "Retry On Fail" — 2 retries, 10 second delay. This handles Claude 429 rate limits.

**Body (JSON):**
```json
{
  "model": "claude-sonnet-4-5-20250514",
  "max_tokens": 4096,
  "system": "<<PASTE ENTIRE SYSTEM PROMPT FROM SECTION 3 HERE>>",
  "messages": [
    {
      "role": "user",
      "content": "Create a Torah Tai Chi video script for the following approved content idea:\n\nTITLE: {{$node['Supabase Get Record'].json[0].title}}\nHOOK: {{$node['Supabase Get Record'].json[0].hook}}\nPARSHA: {{$node['Supabase Get Record'].json[0].parsha}}\nCONTENT PILLAR: {{$node['Supabase Get Record'].json[0].content_pillar}}\nDESCRIPTION: {{$node['Supabase Get Record'].json[0].description}}\n\nTarget duration: 60-75 seconds.\nAspect ratio: 9:16 (vertical, for social media)."
    }
  ]
}
```

---

### Node 4b: IF — Claude Response OK?

**Type:** IF
**Condition:** `{{$json.content}}` **is not empty**

This catches cases where Claude returns an error or empty response. On failure, update Supabase status to `script_error` and stop.

---

### Node 5: Code — Parse & Validate Script

**Type:** Code
**Language:** JavaScript

```javascript
const response = $input.first().json;

// Handle both direct response and nested response formats
const rawText = response.content?.[0]?.text || response.content;
if (!rawText) {
  throw new Error('Claude returned empty response: ' + JSON.stringify(response).substring(0, 500));
}

// Parse JSON — handle code fences if Claude wraps them
let script;
try {
  script = JSON.parse(rawText);
} catch (e) {
  const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  script = JSON.parse(cleaned);
}

// Validate
const warnings = [];

script.segments.forEach((seg) => {
  if (seg.duration_sec < 4 || seg.duration_sec > 15) {
    warnings.push(`Seg ${seg.segment_id}: duration ${seg.duration_sec}s outside 4-15`);
  }
  const est = Math.round(seg.word_count / 2.5);
  if (Math.abs(est - seg.duration_sec) > 3) {
    warnings.push(`Seg ${seg.segment_id}: ${seg.word_count} words ≈ ${est}s but set to ${seg.duration_sec}s`);
  }
  if (!seg.scene_prompt.includes('lip sync')) {
    warnings.push(`Seg ${seg.segment_id}: missing lip sync instruction in scene_prompt`);
  }
});

const totalDur = script.segments.reduce((sum, s) => sum + s.duration_sec, 0);
if (Math.abs(totalDur - script.total_duration_sec) > 1) {
  warnings.push(`total_duration_sec mismatch: header says ${script.total_duration_sec}, sum is ${totalDur}`);
  script.total_duration_sec = totalDur; // fix it
}

return [{
  json: {
    script: script,
    scriptJson: JSON.stringify(script),
    segments: script.segments,
    segmentCount: script.segments.length,
    totalDuration: totalDur,
    hasWarnings: warnings.length > 0,
    warnings: warnings,
    // Initialize results collector
    completedSegments: []
  }
}];
```

---

### Node 6: Supabase — Save Script JSON

**Type:** HTTP Request (Supabase REST API)
**Method:** PATCH
**URL:** `{{ $vars.SUPABASE_URL }}/rest/v1/content?id=eq.{{$node["Supabase Get Record"].json[0].id}}`

**Headers:**
| Header | Value |
|--------|-------|
| `apikey` | `{{ $vars.SUPABASE_SERVICE_KEY }}` |
| `Authorization` | `Bearer {{ $vars.SUPABASE_SERVICE_KEY }}` |
| `Content-Type` | `application/json` |
| `Prefer` | `return=minimal` |

**Body:** `{ "script_json": {{$json.scriptJson}}, "updated_at": "{{ $now.toISO() }}" }`

---

### Node 7: Split In Batches

**Type:** Split In Batches
**Batch Size:** 1
**Input:** `{{$json.segments}}` from Node 5

This iterates through each segment one at a time. When all batches are done, output goes to Node 16.

---

### Node 8: HTTP Request — ElevenLabs (Audio)

**Type:** HTTP Request
**Method:** POST
**URL:** `https://api.elevenlabs.io/v1/text-to-speech/{{ $vars.ELEVENLABS_VOICE_ID }}`

**Authentication:** Use the `elevenLabsAuth` Header Auth credential configured in n8n.

**Additional Headers:**
| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |
| `Accept` | `audio/mpeg` |

**Body (JSON):**
```json
{
  "text": "{{$json.script_text}}",
  "model_id": "eleven_multilingual_v2",
  "voice_settings": {
    "stability": 0.50,
    "similarity_boost": 0.80,
    "style": 0.3,
    "use_speaker_boost": true
  }
}
```

**Response:** Binary data (MP3 audio)
**Settings:** Set "Response Format" to **File** (binary).

---

### Node 9: Upload Audio to Kie.ai File Storage

**Type:** HTTP Request
**Method:** POST
**URL:** `https://api.kie.ai/api/v1/files/uploadFileBase64`

**Authentication:** Use the `kieAiAuth` Header Auth credential.

> **Why Kie.ai storage instead of Google Drive?** Google Drive `uc?export=download` URLs often trigger virus-scan interstitials that break Seedance's file fetch. Kie.ai's own storage returns direct URLs that always work with their models. Files are retained for 3 days — sufficient for the pipeline.

**Preceding Code node (convert binary to base64):**
```javascript
const binaryData = $input.first().binary.data;
const segment = $node['Split In Batches'].json;

return [{
  json: {
    fileName: `torah-tai-chi-seg-${segment.segment_id}-audio.mp3`,
    fileBase64: binaryData.data, // n8n binary data is already base64
    mimeType: 'audio/mpeg',
    segment: segment
  }
}];
```

**Body (JSON):**
```json
{
  "fileName": "{{$json.fileName}}",
  "fileBase64": "{{$json.fileBase64}}",
  "mimeType": "{{$json.mimeType}}"
}
```

**Response contains:**
```json
{
  "code": 200,
  "data": {
    "fileUrl": "https://file.kie.ai/..."
  }
}
```

**Extract public URL using a Code node after upload:**
```javascript
const audioUrl = $input.first().json.data?.fileUrl || $input.first().json.fileUrl;
const segment = $node['Split In Batches'].json;

return [{
  json: {
    audioPublicUrl: audioUrl,
    segment: segment
  }
}];
```

> **Fallback:** If Kie.ai file upload is unavailable, use `POST https://api.kie.ai/api/v1/files/uploadFileUrl` to upload from a Google Drive public link, or use fal.ai storage (`fal.storage.upload`).

---

### Node 10: Code — Build Seedance Payload

**Type:** Code
**Language:** JavaScript

```javascript
const segment = $json.segment || $node['Split In Batches'].json;
const audioUrl = $json.audioPublicUrl;
const characterUrl = $vars.CHARACTER_IMAGE_URL;
const aspectRatio = $vars.ASPECT_RATIO || '9:16';
const resolution = $vars.RESOLUTION || '1080p';
const model = $vars.SEEDANCE_MODEL || 'bytedance/seedance-1.5-pro';

// The scene_prompt from Claude already contains the @audio_file_1 reference
// But let's make sure it's there, and prepend the @image_file_1 reference
let prompt = segment.scene_prompt;

// Ensure @image_file_1 prefix
if (!prompt.startsWith('@image_file_1')) {
  prompt = `@image_file_1 ${prompt}`;
}

// Ensure @audio_file_1 is referenced (should already be in the prompt from Claude)
if (!prompt.includes('@audio_file_1')) {
  prompt = prompt.replace(
    /matching the provided audio with expressive lip sync/i,
    'matching @audio_file_1 with expressive lip sync'
  );
  // If still not there, append it
  if (!prompt.includes('@audio_file_1')) {
    prompt += ' Character speaks naturally, matching @audio_file_1 with expressive lip sync.';
  }
}

return [{
  json: {
    apiPayload: {
      model: model,
      input: {
        prompt: prompt,
        input_urls: [
          characterUrl,
          audioUrl
        ],
        aspect_ratio: aspectRatio,
        resolution: resolution,
        duration: String(segment.duration_sec)
      }
    },
    segmentId: segment.segment_id,
    segmentDuration: segment.duration_sec
  }
}];
```

---

### Node 11: HTTP Request — Kie.ai (Create Seedance Task)

**Type:** HTTP Request
**Method:** POST
**URL:** `https://api.kie.ai/api/v1/jobs/createTask`

**Authentication:** Use the `kieAiAuth` Header Auth credential.

**Additional Headers:**
| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |

**Body (JSON):** `{{$json.apiPayload}}`

**Response will contain:**
```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_bytedance_1765186743319"
  }
}
```

Save `data.taskId` for polling.

---

### Node 12: Wait

**Type:** Wait
**Duration:** 15 seconds
**Resume:** After time

First iteration waits 15 seconds (Seedance typically takes 60-120 sec, but we start checking early). Subsequent loops use 10 seconds.

---

### Node 13: HTTP Request — Kie.ai (Poll Status)

**Type:** HTTP Request
**Method:** GET
**URL:** `https://api.kie.ai/api/v1/jobs/recordInfo?taskId={{$node['Create Seedance Task'].json.data.taskId}}`

**Authentication:** Use the `kieAiAuth` Header Auth credential.

> **Note:** The Kie.ai polling endpoint is `/api/v1/jobs/recordInfo` with `taskId` as a query parameter — NOT a path parameter.

---

### Node 14: IF — Task Complete?

**Type:** Switch (3 outputs)
**Conditions:**
- Output 1 (`success`): `{{$json.data.state}}` **equals** `success`
- Output 2 (`fail`): `{{$json.data.state}}` **equals** `fail`
- Output 3 (default/still processing): everything else → back to Node 12 (Wait)

> **Critical:** Kie.ai uses `state` (not `status`) with values: `waiting`, `queuing`, `generating`, `success`, `fail`.

**Output 1 (success)** → Node 15 (Store Result)
**Output 2 (fail)** → Log error to Supabase error_log field, continue to next segment
**Output 3 (still processing)** → back to Node 12 (Wait)

**Add a loop counter** to prevent infinite polling. After 40 loops (10 minutes), mark as failed:

```javascript
// In a Code node before Wait
const loopCount = ($json.pollCount || 0) + 1;
if (loopCount > 40) {
  throw new Error(`Seedance task timed out after ${loopCount * 15} seconds for segment ${$json.segmentId}`);
}
return [{ json: { ...$json, pollCount: loopCount } }];
```

---

### Node 15: Code — Store Segment Result

**Type:** Code
**Language:** JavaScript

```javascript
// Kie.ai returns results in data.resultJson as a JSON string
const resultJsonStr = $json.data?.resultJson || $json.resultJson;
let videoUrl;

try {
  const resultData = JSON.parse(resultJsonStr);
  videoUrl = resultData.resultUrls?.[0];
} catch (e) {
  // Fallback: try direct field access
  videoUrl = $json.data?.resultUrls?.[0]
    || $json.output?.video_url
    || $json.output?.url;
}

const segmentId = $node['Build Seedance Payload'].json.segmentId;

// Store result — we'll collect all of these after the loop
return [{
  json: {
    segmentId: segmentId,
    videoUrl: videoUrl,
    status: 'completed'
  }
}];
```

This feeds back to Node 7 (Split In Batches) for the next segment.

---

### Node 16: Code — Collect All Video URLs

**Type:** Code
**Language:** JavaScript

This node receives ALL outputs from the Split In Batches loop. It must sort them by segment_id and build the URL array for stitching.

```javascript
// All segment results arrive here after the loop completes
const items = $input.all();

// Sort by segment ID to ensure correct order
const sorted = items
  .map(item => item.json)
  .sort((a, b) => a.segmentId - b.segmentId);

// Extract video URLs in order
const videoUrls = sorted.map(s => s.videoUrl).filter(Boolean);

// Check for missing segments
const missing = sorted.filter(s => !s.videoUrl);
if (missing.length > 0) {
  const missingIds = missing.map(s => s.segmentId).join(', ');
  // Log warning but continue with what we have
  return [{
    json: {
      videoUrls: videoUrls,
      segmentCount: sorted.length,
      successCount: videoUrls.length,
      failedSegments: missingIds,
      hasErrors: true
    }
  }];
}

return [{
  json: {
    videoUrls: videoUrls,
    segmentCount: sorted.length,
    successCount: videoUrls.length,
    hasErrors: false
  }
}];
```

---

### Node 17: HTTP Request — fal.ai (Submit Merge Job)

**Type:** HTTP Request
**Method:** POST
**URL:** `https://queue.fal.run/fal-ai/ffmpeg-api/merge-videos`

**Headers:**
| Header | Value |
|--------|-------|
| `Authorization` | `Key YOUR_FAL_API_KEY` |
| `Content-Type` | `application/json` |

**Body (JSON):**
```json
{
  "video_urls": {{$json.videoUrls}},
  "resolution": {
    "width": 1080,
    "height": 1920
  }
}
```

> **Note on crossfade:** The `merge-videos` endpoint does a simple concatenation — no crossfade. For 0.5s crossfade transitions, use `fal-ai/ffmpeg-api/compose` instead with track-based keyframes. For MVP, simple concatenation is acceptable — add crossfade in Phase 2.

**Response:**
```json
{
  "request_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "status": "IN_QUEUE"
}
```

---

### Node 18: Wait

**Type:** Wait
**Duration:** 10 seconds

---

### Node 19: HTTP Request — fal.ai (Poll Merge Status)

**Type:** HTTP Request
**Method:** GET
**URL:** `https://queue.fal.run/fal-ai/ffmpeg-api/merge-videos/status/{{$node['Submit Merge Job'].json.request_id}}`

**Headers:**
| Header | Value |
|--------|-------|
| `Authorization` | `Key YOUR_FAL_API_KEY` |

---

### Node 20: IF — Merge Complete?

**Type:** IF
**Condition:** `{{$json.status}}` equals `COMPLETED`

**True** → Fetch result:

Add an HTTP Request to get the actual result:
**URL:** `https://queue.fal.run/fal-ai/ffmpeg-api/merge-videos/result/{{$node['Submit Merge Job'].json.request_id}}`

The response contains:
```json
{
  "video": {
    "url": "https://fal.media/files/xxxxx/merged.mp4",
    "content_type": "video/mp4",
    "file_size": 12345678
  }
}
```

**False** → Back to Node 18 (Wait + poll again). Add a loop counter (max 30 iterations = 5 min).

---

### Node 21: Google Drive — Upload Final Video

**Type:** HTTP Request (download video) → Google Drive Upload

First, download the merged video from fal.ai:

**HTTP Request:**
- URL: `{{$json.video.url}}` (from fal.ai result)
- Response Format: File

Then upload to Google Drive:
**Google Drive node:**
- Operation: Upload
- File Name: `torah-tai-chi-{{$node['Supabase Get Record'].json[0].title}}.mp4`
- Parent Folder: `{{$workflow.staticData.GOOGLE_DRIVE_FOLDER_ID}}`

---

### Node 22: Supabase — Update Record

**Type:** HTTP Request (Supabase REST API)
**Method:** PATCH
**URL:** `{{ $vars.SUPABASE_URL }}/rest/v1/content?id=eq.{{$node["Supabase Get Record"].json[0].id}}`

**Headers:**
| Header | Value |
|--------|-------|
| `apikey` | `{{ $vars.SUPABASE_SERVICE_KEY }}` |
| `Authorization` | `Bearer {{ $vars.SUPABASE_SERVICE_KEY }}` |
| `Content-Type` | `application/json` |
| `Prefer` | `return=minimal` |

**Body (JSON):**
```json
{
  "status": "video_review",
  "final_video_url": "{{Google Drive shareable link}}",
  "segment_video_urls": {{$node['Collect All Video URLs'].json.videoUrls}},
  "cost_usd": {{estimated cost}},
  "updated_at": "{{ $now.toISO() }}"
}
```

---

### Node 23: Email/Slack Notification

**Type:** Email (SMTP) or Slack node

**Subject/Message:** `Torah Tai Chi video ready for review: {{title}}`
**Body:** Include Google Drive link and any warnings from validation.

---

## 5. Manual Test Run Steps

Before building the full n8n workflow, test each stage manually to verify your API keys work and the output quality is acceptable.

### Step 1: Generate a Test Script

Use the Claude API playground (or console.anthropic.com) with the system prompt from Section 3 and this user message:

```
Create a Torah Tai Chi video script for the following content idea:

TITLE: The Strength in Stillness
HOOK: What if real strength meant standing still?
PARSHA: Vayishlach
CONTENT PILLAR: wisdom
DESCRIPTION: Exploring how Jacob's wrestling teaches us that endurance and presence are true strength, connected to the Tai Chi concept of sung (relaxed readiness).

Target duration: 60-75 seconds.
Aspect ratio: 9:16 (vertical, for social media).
```

Save the returned JSON.

### Step 2: Generate Audio for Segment 1

```bash
curl -X POST "https://api.elevenlabs.io/v1/text-to-speech/YOUR_VOICE_ID" \
  -H "xi-api-key: YOUR_ELEVENLABS_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: audio/mpeg" \
  -d '{
    "text": "What if the bravest thing you could do today... was not to push harder, but to stand still?",
    "model_id": "eleven_multilingual_v2",
    "voice_settings": {
      "stability": 0.5,
      "similarity_boost": 0.8,
      "style": 0.3
    }
  }' \
  --output segment1.mp3
```

Upload `segment1.mp3` to a public URL (Google Drive, S3, etc.).

### Step 3: Generate Video for Segment 1

```bash
curl -X POST "https://api.kie.ai/api/v1/jobs/createTask" \
  -H "Authorization: Bearer YOUR_KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "bytedance/seedance-2.0",
    "input": {
      "prompt": "@image_file_1 Character walks slowly along a sunlit riverside path, emerging from behind a willow tree into frame. Hands at sides, relaxed gait, curious expression with slight eyebrow raise. Morning golden light filters through willow branches, casting long dappled shadows on smooth river stones. Flowing clear water visible in background, wildflowers along the bank. Camera positioned ahead of character, medium shot, character walks toward camera. Character speaks naturally, matching @audio_file_1 with expressive lip sync.",
      "input_urls": [
        "YOUR_CHARACTER_IMAGE_URL",
        "YOUR_SEGMENT1_AUDIO_URL"
      ],
      "aspect_ratio": "9:16",
      "resolution": "1080p",
      "duration": "8"
    }
  }'
```

Note the `taskId` from the response. Then poll:

```bash
curl -X GET "https://api.kie.ai/api/v1/jobs/TASK_ID_HERE" \
  -H "Authorization: Bearer YOUR_KIE_API_KEY"
```

Repeat every 15 seconds until `status` = `completed`. Download and review the video.

### Step 4: Repeat for All Segments

Generate audio + video for segments 2-6. Save all video URLs.

### Step 5: Stitch All Segments

```bash
curl -X POST "https://queue.fal.run/fal-ai/ffmpeg-api/merge-videos" \
  -H "Authorization: Key YOUR_FAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "video_urls": [
      "https://segment1-url.mp4",
      "https://segment2-url.mp4",
      "https://segment3-url.mp4",
      "https://segment4-url.mp4",
      "https://segment5-url.mp4",
      "https://segment6-url.mp4"
    ],
    "resolution": {
      "width": 1080,
      "height": 1920
    }
  }'
```

Note the `request_id`. Then poll:

```bash
# Check status
curl "https://queue.fal.run/fal-ai/ffmpeg-api/merge-videos/status/REQUEST_ID" \
  -H "Authorization: Key YOUR_FAL_API_KEY"

# Get result when COMPLETED
curl "https://queue.fal.run/fal-ai/ffmpeg-api/merge-videos/result/REQUEST_ID" \
  -H "Authorization: Key YOUR_FAL_API_KEY"
```

Download the final merged video. Review it. That's your first Torah Tai Chi video.

### Step 6: Iterate on Quality

Based on the test output:
- **Character looks wrong?** Refine your character reference image.
- **Movement too subtle?** Add more specific action words to scene prompts.
- **Lip sync off?** Try shorter segments (8-10 sec sweet spot).
- **Cuts between segments jarring?** Adjust transition descriptions.
- **Audio too fast/slow?** Adjust ElevenLabs stability setting.
- **Environment inconsistent?** Use more identical environment descriptions across segments.

Once you're happy with the test output, build the n8n workflow using the node specs above.

---

## 6. Troubleshooting

### Kie.ai returns 422 or "model not found"
- As of Feb 2026, the verified model ID is `bytedance/seedance-1.5-pro`. Seedance 2.0 may be added later — check https://kie.ai/market for current availability.
- The `SEEDANCE_MODEL` workflow variable lets you switch models without editing nodes.

### Seedance blocks the character image
- Your image is too photorealistic. Run it through a stylization filter.
- The image must be clearly illustrated/stylized.

### Audio URL not accessible by Seedance
- Google Drive sharing links don't always work as direct download URLs — they trigger virus-scan interstitials.
- **Best fix (used in this workflow):** Upload audio via Kie.ai's File Upload API (`/api/v1/files/uploadFileBase64`). Returns a direct URL that always works with Kie.ai models. Files retained 3 days.
- **Alternative 1:** Use Kie.ai URL upload: `POST /api/v1/files/uploadFileUrl` with a source URL.
- **Alternative 2:** Use fal.ai storage for audio files.
- **Alternative 3:** Use a public S3 bucket.

### fal.ai merge fails
- All input videos must be accessible public URLs.
- If Seedance output URLs expire, download them first and re-upload to persistent storage before merging.
- Check that all clips have the same resolution and aspect ratio.

### Segments arrive out of order
- The Split In Batches node processes sequentially, but if you parallelize later, the Code node in Node 16 sorts by segment_id to ensure correct order.

### Claude returns invalid JSON
- The Code node in Node 5 handles code-fence wrapping.
- If Claude adds commentary before/after the JSON, adjust the regex to extract just the JSON object.
- Note: Anthropic's API does not support `response_format` like OpenAI. The system prompt's instruction to return "ONLY valid JSON" is the primary control.
- Node 4 has "Retry On Fail" enabled (2 retries, 10s delay) to handle transient errors.

### Total cost per video
- Claude script: ~$0.05
- ElevenLabs (60 sec): ~$0.30
- Seedance 2.0 (6 segments × 10 sec avg): ~$3-6
- fal.ai merge: ~$0.01
- **Total: ~$3.50 - $6.50 per video**

---

## What This Document Does NOT Cover (Yet)

These are deferred to later phases after the core pipeline is working:

### Phase 1.5 (add immediately after first successful video)
4. **Captions/subtitles** — Generate .srt from ElevenLabs word-level timestamps, burn onto video via `fal-ai/ffmpeg-api/compose`. **Critical for social media** — 80%+ of viewers watch without sound.
5. **Crossfade transitions** — Switch from `merge-videos` to `fal-ai/ffmpeg-api/compose` with 0.5s crossfade keyframes between segments.

### Phase 2
1. **Workflow 1: Weekly Content Ideation** — Cron trigger → Claude → Supabase ideas → notification
2. **Workflow 2: Script Review/Approval** — Supabase webhook on status change → trigger Workflow 3
3. **Workflow 4: Distribution** — Approved video → post to YouTube/IG/TikTok/Facebook
6. **Logo/branding overlay** — Add Torah Tai Chi watermark via FFmpeg
7. **Intro/outro bumpers** — Pre-made 3-second clips prepended/appended during merge
8. **Background music bed** — Low-volume ambient audio mixed under the voiceover
9. **Cost tracking** — Automatic per-video cost calculation logged to Supabase

Get the core pipeline producing clean 60-second videos first. Then layer these on.
