"""
One-shot Storyblok migration script.
1. Creates three components (article, site_text, book)
2. Creates folder stories for /articles/, /site-text/, /book/
3. Seeds all articles, site_text rows, and the book story
"""

import httpx
import json
import time

SPACE_ID = "291966442816972"
MGMT_TOKEN = "BuvEooQ42KMifAbJQub1TAtt-167863389715947-WrsregX1PkjFkp5GUCKw"
BASE = f"https://mapi.storyblok.com/v1/spaces/{SPACE_ID}"

HEADERS = {
    "Authorization": MGMT_TOKEN,
    "Content-Type": "application/json",
}


# ───────────────────────────────────────────────
# Helpers
# ───────────────────────────────────────────────

def post(path, payload):
    r = httpx.post(f"{BASE}{path}", headers=HEADERS, json=payload, timeout=30)
    if r.status_code not in (200, 201, 422):
        print(f"  ERROR {r.status_code}: {r.text[:400]}")
    return r


def put(path, payload):
    r = httpx.put(f"{BASE}{path}", headers=HEADERS, json=payload, timeout=30)
    if r.status_code not in (200, 201):
        print(f"  ERROR {r.status_code}: {r.text[:400]}")
    return r


def get(path, params=None):
    r = httpx.get(f"{BASE}{path}", headers=HEADERS, params=params or {}, timeout=30)
    return r


# ───────────────────────────────────────────────
# Step 1 — Create components
# ───────────────────────────────────────────────

def create_component(name, display_name, schema):
    print(f"  Creating component: {name}")
    r = post("/components/", {"component": {"name": name, "display_name": display_name, "schema": schema}})
    if r.status_code == 422:
        print(f"    Already exists or validation error — continuing")
    return r.json()


def setup_components():
    print("\n=== Step 1: Create Storyblok components ===")

    article_schema = {
        "title":        {"type": "text",     "required": True,  "display_name": "Title",        "pos": 0},
        "subtitle":     {"type": "text",     "required": False, "display_name": "Subtitle",     "pos": 1},
        "category":     {"type": "option",   "required": False, "display_name": "Category",     "pos": 2,
                         "options": [{"value": "Essay"}, {"value": "Teaching"}, {"value": "Reflection"}]},
        "excerpt":      {"type": "textarea", "required": False, "display_name": "Excerpt",      "pos": 3},
        "body":         {"type": "richtext", "required": False, "display_name": "Body",         "pos": 4},
        "published_at": {"type": "datetime","required": False, "display_name": "Published at",  "pos": 5},
        "read_minutes": {"type": "number",  "required": False, "display_name": "Read minutes",  "pos": 6},
    }

    site_text_schema = {
        "key":         {"type": "text",     "required": True,  "display_name": "Key",         "pos": 0},
        "value":       {"type": "textarea", "required": True,  "display_name": "Value",       "pos": 1},
        "description": {"type": "text",     "required": False, "display_name": "Description", "pos": 2},
    }

    book_schema = {
        "visible":      {"type": "boolean", "required": False, "display_name": "Visible",     "pos": 0},
        "title":        {"type": "text",    "required": False, "display_name": "Title",       "pos": 1},
        "subtitle":     {"type": "text",    "required": False, "display_name": "Subtitle",    "pos": 2},
        "description":  {"type": "textarea","required": False, "display_name": "Description", "pos": 3},
        "cover_url":    {"type": "text",    "required": False, "display_name": "Cover URL",   "pos": 4},
        "purchase_url": {"type": "text",    "required": False, "display_name": "Purchase URL","pos": 5},
        "cta_label":    {"type": "text",    "required": False, "display_name": "CTA Label",   "pos": 6},
    }

    create_component("article",   "Article",   article_schema)
    create_component("site_text", "Site Text", site_text_schema)
    create_component("book",      "Book",      book_schema)
    print("  Components done.")


# ───────────────────────────────────────────────
# TipTap → Storyblok richtext
# ───────────────────────────────────────────────

def tiptap_to_sb(doc):
    """
    TipTap and Storyblok share almost the same ProseMirror schema.
    The main difference: Storyblok wraps everything in
      { "type": "doc", "content": [...] }
    which TipTap already produces — so mostly pass-through.
    Storyblok also wants an explicit attrs.level on headings (same as TipTap).
    """
    if not doc:
        return {"type": "doc", "content": []}
    return doc   # identical schema in practice


# ───────────────────────────────────────────────
# Step 2 — Ensure folders exist, return their IDs
# ───────────────────────────────────────────────

def get_or_create_folder(slug, name):
    """Create a folder story; return its id."""
    print(f"  Ensuring folder /{slug}/")
    r = post("/stories/", {
        "story": {
            "name": name,
            "slug": slug,
            "is_folder": True,
            "content": {"component": "folder"},
        },
        "publish": 0,
    })
    data = r.json()
    if "story" in data:
        return data["story"]["id"]
    # Already exists: search
    r2 = get("/stories/", {"slug": slug})
    stories = r2.json().get("stories", [])
    for s in stories:
        if s["slug"] == slug:
            return s["id"]
    return None


# ───────────────────────────────────────────────
# Step 3 — Create stories
# ───────────────────────────────────────────────

def publish_story(story_id):
    r = get(f"/stories/{story_id}/publish")
    return r.status_code


def create_story(name, slug, parent_id, content, do_publish=True):
    payload = {
        "story": {
            "name": name,
            "slug": slug,
            "parent_id": parent_id,
            "content": content,
        },
        "publish": 1 if do_publish else 0,
    }
    r = post("/stories/", payload)
    return r.json()


# ───────────────────────────────────────────────
# Article data (from Supabase)
# ───────────────────────────────────────────────

ARTICLES = [
    {
        "id": "aa1096f9-1d3d-4357-98b3-c684f82b521d",
        "slug": "naase-vnishma",
        "title": "Na\u2019aseh V\u2019Nishma: Action Before Understanding",
        "subtitle": "The body learns first. The understanding arrives after.",
        "category": "Teaching",
        "excerpt": "At Sinai the people said we will do, and then we will hear. The sequence is strange unless you have practiced a form for years. The body learns first. The understanding arrives after.",
        "body_json": {"type":"doc","content":[{"type":"paragraph","content":[{"text":"The moment at Sinai is one of the strangest in the Torah. The people reply \u2014 before deliberating \u2014 na\u2019aseh v\u2019nishma.","type":"text"}]},{"type":"paragraph","content":[{"text":"The body first. The understanding, when it comes, will be richer for the waiting.","type":"text"}]}]},
        "read_minutes": 8,
        "published": True,
        "published_at": "2026-02-21T12:00:00+00:00",
    },
    {
        "id": "ebd49276-ffa2-488c-ac42-1685b3affca8",
        "slug": "yielding-is-not-surrender",
        "title": "Yielding Is Not Surrender",
        "subtitle": "The difference between giving way and giving up \u2014 held in Jacob\u2019s hip.",
        "category": "Essay",
        "excerpt": "Push hands teaches a distinction the dominant culture keeps missing: the difference between giving way and giving up. The parsha of Vayishlach carries the same teaching, held in Jacob\u2019s hip.",
        "body_json": {"type":"doc","content":[{"type":"paragraph","content":[{"text":"The culture we have inherited has a word for what happens when you do not fight back: defeat.","type":"text"}]},{"type":"paragraph","content":[{"text":"The culture says: if it hurts you, you lost. The traditions say: if it changes you, you were present. Yielding in the deep sense is not giving up.","type":"text"}]}]},
        "read_minutes": 6,
        "published": True,
        "published_at": "2026-02-28T12:00:00+00:00",
    },
    {
        "id": "854bfb0c-6865-4f50-bfee-b1aea39c42a5",
        "slug": "breath-as-first-blessing",
        "title": "Breath as the First Blessing",
        "subtitle": "The word neshama \u2014 soul \u2014 shares its root with breath. Long before language, there is the inhale.",
        "category": "Reflection",
        "excerpt": "The word neshama \u2014 soul \u2014 shares its root with breath. Long before language, before thought, before prayer, there is the inhale. It may be the oldest teaching either tradition carries.",
        "body_json": {"type":"doc","content":[{"type":"paragraph","content":[{"text":"The first thing the Torah says about the creation of a human being is about breath.","type":"text"}]},{"type":"paragraph","content":[{"text":"Neshama shares its root with neshima, which means breath. Breathe. This is already the practice.","type":"text"}]}]},
        "read_minutes": 5,
        "published": True,
        "published_at": "2026-03-07T12:00:00+00:00",
    },
    {
        "id": "547265eb-6eab-4e9c-bffa-6a622263adb8",
        "slug": "rooting-patriarchs",
        "title": "Rooting: What the Patriarchs Knew About Standing",
        "subtitle": "Abraham stood. Isaac stood. Jacob stood. The internal arts would recognize this posture instantly.",
        "category": "Teaching",
        "excerpt": "Abraham stood. Isaac stood. Jacob stood. In each case the Torah uses a verb that does not only mean upright \u2014 it means rooted, sunk, present at the feet. The internal arts would recognize this posture instantly.",
        "body_json": {"type":"doc","content":[{"type":"paragraph","content":[{"text":"The Hebrew Bible is obsessed with standing. Not metaphorically \u2014 literally, physically. The verb amad appears hundreds of times.","type":"text"}]},{"type":"paragraph","content":[{"text":"Root yourself before you give. Stand before you run. Sink before you extend. Amad. Stand. Find your feet.","type":"text"}]}]},
        "read_minutes": 9,
        "published": True,
        "published_at": "2026-03-14T12:00:00+00:00",
    },
    {
        "id": "940d285b-abfe-4436-b00e-2e4b0a8284e0",
        "slug": "soft-jaw-moment",
        "title": "The Soft-Jaw Moment Before Reaction",
        "subtitle": "Both the Sages and the tai chi masters have been pointing at it for millennia, in different languages.",
        "category": "Reflection",
        "excerpt": "There is a particular softening of the jaw that happens before a wise response. Both the Sages and the tai chi masters have been pointing at it for millennia, in different languages.",
        "body_json": {"type":"doc","content":[{"type":"paragraph","content":[{"text":"Notice your jaw right now. Not metaphorically. Actually notice it.","type":"text"}]},{"type":"paragraph","content":[{"text":"Before you respond to something difficult, notice the jaw. If it is clenched, soften it. Do not have the response until after the jaw has softened.","type":"text"}]}]},
        "read_minutes": 7,
        "published": True,
        "published_at": "2026-03-21T12:00:00+00:00",
    },
    {
        "id": "c159c059-2e33-46c1-a310-fe8c0b02fa42",
        "slug": "shabbat-stillness-in-motion",
        "title": "What Shabbat Taught About Stillness in Motion",
        "subtitle": "Rest is not the absence of movement. It is movement arriving where it was always headed.",
        "category": "Reflection",
        "excerpt": "For years I thought rest meant stopping. Then I started practicing tai chi on Shabbat morning \u2014 not the martial forms, but the standing. And I understood: Shabbat isn\u2019t absence of movement.",
        "body_json": {"type":"doc","content":[{"type":"paragraph","content":[{"text":"The morning of Shabbat, before the service, before the meal, before any of the words that fill the day \u2014 there is a stillness that is different from the stillness of Tuesday morning.","type":"text"}]},{"type":"heading","attrs":{"level":2},"content":[{"text":"Movement that has arrived","type":"text"}]},{"type":"paragraph","content":[{"text":"Stand still long enough, and the stillness begins to move. Let Shabbat arrive fully enough, and the rest becomes its own kind of action.","type":"text"}]}]},
        "read_minutes": 5,
        "published": True,
        "published_at": "2026-03-28T12:00:00+00:00",
    },
    {
        "id": "fce33fa0-0f3a-4b67-83b3-6a59ecdc8784",
        "slug": "song-and-anavah",
        "title": "Song and Anavah: The Shared Root of Release",
        "subtitle": "Two old vocabularies, pointing at the same quiet center.",
        "category": "Teaching",
        "excerpt": "The Chinese concept of song \u677e \u2014 deep, conscious relaxation without collapse \u2014 maps almost perfectly onto the Jewish middah of anavah, true humility. Both describe a structure that yields without losing itself.",
        "body_json": {"type":"doc","content":[{"type":"paragraph","content":[{"text":"There is a word in classical Chinese that the internal arts teachers use constantly, and it does not translate well. The word is song \u677e.","type":"text"}]},{"type":"heading","attrs":{"level":2},"content":[{"text":"Anavah is not what we think","type":"text"}]},{"type":"paragraph","content":[{"text":"The word anavah is usually translated as humility. True anavah is accurate self-appraisal.","type":"text"}]},{"type":"heading","attrs":{"level":2},"content":[{"text":"Where they meet","type":"text"}]},{"type":"paragraph","content":[{"text":"Stand without defending. Receive without collapsing. This is the practice.","type":"text"}]}]},
        "read_minutes": 8,
        "published": True,
        "published_at": "2026-04-04T12:00:00+00:00",
    },
    {
        "id": "43a273d5-acff-4ae6-8bf7-578309656f9f",
        "slug": "why-the-body-knows",
        "title": "Why the Body Knows Before the Mind",
        "subtitle": "There\u2019s a moment before you react. A breath. That breath is where Torah and tai chi speak the same sentence.",
        "category": "Essay",
        "excerpt": "There\u2019s a moment in zhan zhuang \u2014 standing meditation \u2014 where the legs begin to tremble. The mind screams quit. But something deeper holds. That something is what the Torah calls emunah.",
        "body_json": {"type":"doc","content":[{"type":"paragraph","content":[{"text":"Stand long enough in zhan zhuang \u2014 the standing post \u2014 and the knees begin to tremble. Not from weakness. From a deeper argument between effort and surrender that only the body can hear.","type":"text"}]},{"type":"paragraph","content":[{"text":"The mind arrives late to this conversation.","type":"text"}]},{"type":"heading","attrs":{"level":2},"content":[{"text":"Na\u2019aseh V\u2019nishma","type":"text"}]},{"type":"paragraph","content":[{"text":"At Sinai, the Torah records a strange answer. When Moses brings the terms of the covenant, the people reply: na\u2019aseh v\u2019nishma \u2014 we will do, and we will hear.","type":"text"}]},{"type":"heading","attrs":{"level":2},"content":[{"text":"Song, and the soft jaw","type":"text"}]},{"type":"paragraph","content":[{"text":"So: stand. Breathe. Notice the jaw. The teaching is already arriving.","type":"text"}]}]},
        "read_minutes": 6,
        "published": True,
        "published_at": "2026-04-12T12:00:00+00:00",
    },
]

SITE_TEXT_ROWS = [
    {"key": "about.how_arrives",   "value": "Every week: a short teaching, a breath to try. Occasionally: longer writings for those who want to sit with an idea.", "description": "About page: How it arrives"},
    {"key": "about.subtitle",      "value": "A practice, not a product.", "description": "About page subtitle"},
    {"key": "about.title",         "value": "Where two traditions meet the body.", "description": "About page main headline"},
    {"key": "about.what_is",       "value": "Torah Tai Chi is a weekly practice of meeting two traditions in one body. Each week\u2019s parsha carries a teaching; each Chinese internal-arts principle carries a mirror image of that teaching in the language of rooting, yielding, and release.", "description": "About page: What Torah Tai Chi is"},
    {"key": "about.why_body",      "value": "The body knows before the mind does. Torah Tai Chi reads the parsha through the spine, the breath, the soft-jaw moment before reaction.", "description": "About page: Why the body"},
    {"key": "footer.copyright",    "value": "\u00a9 2026 Torah Tai Chi \u00b7 torahtaichi.com", "description": "Footer copyright line"},
    {"key": "home.about.body",     "value": "Torah Tai Chi lives at the intersection of Jewish wisdom and the Chinese internal arts. Each week\u2019s parsha carries a teaching about character, restraint, holiness \u2014 and each of those teachings has a parallel in the body: rooting, yielding, releasing tension without collapsing structure.", "description": "About strip paragraph"},
    {"key": "home.about.title",    "value": "The practice between traditions.", "description": "About strip headline on homepage"},
    {"key": "home.hero.body",      "value": "Torah Tai Chi fuses the weekly parsha with the internal arts \u2014 rooting, yielding, song \u2014 to find the place where Jewish wisdom and the body\u2019s intelligence say the same thing.", "description": "Homepage hero paragraph"},
    {"key": "home.hero.kicker",    "value": "Weekly teachings", "description": "Small label above the hero headline"},
    {"key": "home.hero.title",     "value": "Where ancient wisdom meets the body.", "description": "Main homepage headline"},
    {"key": "home.hero.title_em",  "value": "meets the body.", "description": "Italic portion of headline (for emphasis styling)"},
]

BOOK_FIELDS = {
    "visible":      False,
    "title":        "Torah Tai Chi",
    "subtitle":     "Where two traditions meet the body",
    "description":  "A fifty-two-week journey through the Torah\u2019s weekly parsha, read through the spine. Each chapter pairs an ancient teaching with a Chinese internal-arts principle \u2014 rooting, yielding, releasing \u2014 and leaves the reader with one small practice. A book for the bookshelf and the body.",
    "cover_url":    "",
    "purchase_url": "",
    "cta_label":    "Buy the book",
}


# ───────────────────────────────────────────────
# Main
# ───────────────────────────────────────────────

def main():
    setup_components()

    print("\n=== Step 2: Create folders ===")
    articles_folder_id  = get_or_create_folder("articles",  "Articles")
    site_text_folder_id = get_or_create_folder("site-text", "Site Text")
    book_folder_id      = get_or_create_folder("book-folder", "Book Folder")
    print(f"  articles folder id:  {articles_folder_id}")
    print(f"  site-text folder id: {site_text_folder_id}")
    print(f"  book folder id:      {book_folder_id}")

    print("\n=== Step 3: Migrate articles ===")
    article_results = {}
    for a in ARTICLES:
        print(f"  > {a['slug']}")
        content = {
            "component": "article",
            "title": a["title"],
            "subtitle": a.get("subtitle") or "",
            "category": a.get("category") or "",
            "excerpt": a.get("excerpt") or "",
            "body": tiptap_to_sb(a.get("body_json")),
            "published_at": a.get("published_at") or "",
            "read_minutes": a.get("read_minutes") or 0,
        }
        result = create_story(
            name=a["title"],
            slug=a["slug"],
            parent_id=articles_folder_id,
            content=content,
            do_publish=a.get("published", True),
        )
        if "story" in result:
            article_results[a["slug"]] = result["story"]["id"]
            print(f"    created id={result['story']['id']}")
        else:
            print(f"    WARN: {result}")
        time.sleep(0.3)  # rate-limit courtesy

    print("\n=== Step 4: Migrate site_text ===")
    for row in SITE_TEXT_ROWS:
        slug = row["key"].replace(".", "-")
        print(f"  > {slug}")
        content = {
            "component": "site_text",
            "key": row["key"],
            "value": row["value"],
            "description": row.get("description") or "",
        }
        result = create_story(
            name=row["key"],
            slug=slug,
            parent_id=site_text_folder_id,
            content=content,
            do_publish=True,
        )
        if "story" in result:
            print(f"    created id={result['story']['id']}")
        else:
            print(f"    WARN: {result}")
        time.sleep(0.3)

    print("\n=== Step 5: Create book story ===")
    book_content = {
        "component": "book",
        **BOOK_FIELDS,
    }
    result = create_story(
        name="Book",
        slug="book",
        parent_id=book_folder_id,
        content=book_content,
        do_publish=True,
    )
    if "story" in result:
        print(f"  created book id={result['story']['id']}")
    else:
        print(f"  WARN: {result}")

    print("\n=== Migration complete ===")
    print(f"  Articles migrated: {len(ARTICLES)}")
    print(f"  Site text rows:    {len(SITE_TEXT_ROWS)}")
    print(f"  Book:              1")


if __name__ == "__main__":
    main()
