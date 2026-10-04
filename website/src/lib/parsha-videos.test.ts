// website/src/lib/parsha-videos.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hebrewYearOf,
  newestFirst,
  splitHero,
  groupByParsha,
  type VideoRow,
} from "./parsha-videos.ts";

const url = (p: string) => `https://cdn.test/${p}`;

function row(id: string, created_at: string | null, extra: Partial<VideoRow> = {}): VideoRow {
  return {
    id,
    parsha_id: "bereishit",
    thumb_path: `${id}/thumb.png`,
    mp4_path: `${id}/final.mp4`,
    website_caption: null,
    spoken_script: null,
    post_urls: null,
    title: `title-${id}`,
    subtitle: `subtitle-${id}`,
    description: null,
    created_at,
    ...extra,
  };
}

test("hebrewYearOf: either side of Rosh Hashana 5787 (2026-09-12)", () => {
  assert.equal(hebrewYearOf("2026-09-11T12:00:00Z"), "5786");
  assert.equal(hebrewYearOf("2026-09-14T12:00:00Z"), "5787");
});

test("hebrewYearOf: missing or garbage date -> null", () => {
  assert.equal(hebrewYearOf(null), null);
  assert.equal(hebrewYearOf("not a date"), null);
});

test("newestFirst: newest first, undated last", () => {
  const sorted = newestFirst([
    row("a", "2025-10-20T00:00:00Z"),
    row("undated", null),
    row("c", "2026-10-05T00:00:00Z"),
  ]);
  assert.deepEqual(sorted.map((r) => r.id), ["c", "a", "undated"]);
});

test("splitHero: no videos -> no hero, no earlier", () => {
  assert.deepEqual(splitHero([], url), { hero: null, earlier: [] });
});

test("splitHero: one video is the hero, nothing earlier", () => {
  const { hero, earlier } = splitHero([row("only", "2025-10-20T00:00:00Z")], url);
  assert.equal(hero?.id, "only");
  assert.deepEqual(earlier, []);
});

test("splitHero: this year heroes, last year is earlier — whatever order rows arrive in", () => {
  const lastYear = row("y5786", "2025-10-20T00:00:00Z", {
    post_urls: { youtube: "https://youtu.be/last" },
  });
  const thisYear = row("y5787", "2026-10-05T00:00:00Z");
  for (const rows of [[lastYear, thisYear], [thisYear, lastYear]]) {
    const { hero, earlier } = splitHero(rows, url);
    assert.equal(hero?.id, "y5787");
    assert.equal(earlier.length, 1);
    assert.equal(earlier[0].id, "y5786");
    assert.equal(earlier[0].hebrewYear, "5786");
    assert.equal(earlier[0].videoUrl, "https://cdn.test/y5786/final.mp4");
    // Last year's social links survive — "we don't want to kill those links".
    assert.deepEqual(earlier[0].postUrls, { youtube: "https://youtu.be/last" });
  }
});

test("splitHero: hero fields all come from ONE video, never mixed across rows", () => {
  // Old last-write-wins loop: `if (v.thumb_path) thumbMap.set(...)` per row
  // means a newer video WITHOUT a thumbnail kept the older one's thumbnail
  // next to its own mp4.
  const older = row("older", "2025-10-20T00:00:00Z");
  const newer = row("newer", "2026-10-05T00:00:00Z", { thumb_path: null });
  const { hero } = splitHero([newer, older], url);
  assert.equal(hero?.id, "newer");
  assert.equal(hero?.thumb_path, null);
  assert.equal(hero?.mp4_path, "newer/final.mp4");
});

test("splitHero: an earlier video with no mp4 is not listed", () => {
  const { earlier } = splitHero(
    [row("new", "2026-10-05T00:00:00Z"), row("broken", "2025-10-20T00:00:00Z", { mp4_path: null })],
    url,
  );
  assert.deepEqual(earlier, []);
});

test("groupByParsha: groups, and skips rows with no parsha", () => {
  const groups = groupByParsha([
    row("a", null, { parsha_id: "bereishit" }),
    row("b", null, { parsha_id: "noach" }),
    row("c", null, { parsha_id: "bereishit" }),
    row("d", null, { parsha_id: null }),
  ]);
  assert.deepEqual([...groups.keys()].sort(), ["bereishit", "noach"]);
  assert.deepEqual(groups.get("bereishit")?.map((r) => r.id), ["a", "c"]);
});
