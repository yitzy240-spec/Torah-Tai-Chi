-- Seed fixture articles into Supabase
-- Run once via Supabase dashboard SQL editor or CLI: supabase db execute < seed_articles.sql

INSERT INTO articles (slug, title, subtitle, category, excerpt, body_json, body_html, read_minutes, published, published_at, created_at, updated_at)
VALUES

(
  'why-the-body-knows',
  'Why the Body Knows Before the Mind',
  'There''s a moment before you react. A breath. That breath is where Torah and tai chi speak the same sentence.',
  'Essay',
  'There''s a moment in zhan zhuang — standing meditation — where the legs begin to tremble. The mind screams quit. But something deeper holds. That something is what the Torah calls emunah.',
  '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Stand long enough in zhan zhuang — the standing post — and the knees begin to tremble. Not from weakness. From a deeper argument between effort and surrender that only the body can hear."}]},{"type":"paragraph","content":[{"type":"text","text":"The mind arrives late to this conversation. It shows up with its opinions already formed, its categories tidy, its vocabulary pre-sharpened. But the body has already known for some time."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Na''aseh V''nishma"}]},{"type":"paragraph","content":[{"type":"text","text":"At Sinai, the Torah records a strange answer. When Moses brings the terms of the covenant, the people reply: na''aseh v''nishma — we will do, and we will hear."}]},{"type":"paragraph","content":[{"type":"text","text":"There is a kind of knowing that precedes hearing. There is a kind of consent that lives below the neck."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Song, and the soft jaw"}]},{"type":"paragraph","content":[{"type":"text","text":"The Chinese internal arts have their own word for this: song 松. It is usually translated as relaxation, which is almost right and almost catastrophically wrong. Song is not collapse. It is the particular quality of a structure that has stopped defending itself while remaining entirely present."}]},{"type":"paragraph","content":[{"type":"text","text":"So: stand. Breathe. Notice the jaw. The teaching is already arriving."}]}]}',
  '<p>Stand long enough in zhan zhuang — the standing post — and the knees begin to tremble. Not from weakness. From a deeper argument between effort and surrender that only the body can hear.</p><p>The mind arrives late to this conversation. It shows up with its opinions already formed, its categories tidy, its vocabulary pre-sharpened. But the body has already known for some time.</p><h2>Na''aseh V''nishma</h2><p>At Sinai, the Torah records a strange answer. When Moses brings the terms of the covenant, the people reply: na''aseh v''nishma — we will do, and we will hear.</p><p>There is a kind of knowing that precedes hearing. There is a kind of consent that lives below the neck.</p><h2>Song, and the soft jaw</h2><p>The Chinese internal arts have their own word for this: song 松. It is usually translated as relaxation, which is almost right and almost catastrophically wrong. Song is not collapse. It is the particular quality of a structure that has stopped defending itself while remaining entirely present.</p><p>So: stand. Breathe. Notice the jaw. The teaching is already arriving.</p>',
  6,
  true,
  '2026-04-12T12:00:00Z',
  now(),
  now()
),

(
  'song-and-anavah',
  'Song and Anavah: The Shared Root of Release',
  'Two old vocabularies, pointing at the same quiet center.',
  'Teaching',
  'The Chinese concept of song 松 — deep, conscious relaxation without collapse — maps almost perfectly onto the Jewish middah of anavah, true humility. Both describe a structure that yields without losing itself.',
  '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"There is a word in classical Chinese that the internal arts teachers use constantly, and it does not translate well. The word is song 松. Most dictionaries give you loose or relaxed, and these are not wrong, but they are not quite right either."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Anavah is not what we think"}]},{"type":"paragraph","content":[{"type":"text","text":"The word anavah is usually translated as humility. True anavah is accurate self-appraisal. It is knowing precisely what you are and what you are not — neither inflated nor deflated."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"The push-hands test"}]},{"type":"paragraph","content":[{"type":"text","text":"In the tai chi practice of push hands, the skilled practitioner receives the push — actually receives it, lets it arrive — without bracing against it. This is song. The structure is intact. The defense is down."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Where they meet"}]},{"type":"paragraph","content":[{"type":"text","text":"This is not two different instructions. This is one instruction, arriving through two vocabularies across two traditions. Stand without defending. Receive without collapsing. This is the practice."}]}]}',
  '<p>There is a word in classical Chinese that the internal arts teachers use constantly, and it does not translate well. The word is song 松.</p><h2>Anavah is not what we think</h2><p>The word anavah is usually translated as humility. True anavah is accurate self-appraisal. It is knowing precisely what you are and what you are not — neither inflated nor deflated.</p><h2>The push-hands test</h2><p>In the tai chi practice of push hands, the skilled practitioner receives the push — actually receives it, lets it arrive — without bracing against it. This is song. The structure is intact. The defense is down.</p><h2>Where they meet</h2><p>This is not two different instructions. This is one instruction, arriving through two vocabularies across two traditions. Stand without defending. Receive without collapsing. This is the practice.</p>',
  8,
  true,
  '2026-04-04T12:00:00Z',
  now(),
  now()
),

(
  'shabbat-stillness-in-motion',
  'What Shabbat Taught About Stillness in Motion',
  'Rest is not the absence of movement. It is movement arriving where it was always headed.',
  'Reflection',
  'For years I thought rest meant stopping. Then I started practicing tai chi on Shabbat morning — not the martial forms, but the standing. And I understood: Shabbat isn''t absence of movement.',
  '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"The morning of Shabbat, before the service, before the meal, before any of the words that fill the day — there is a stillness that is different from the stillness of Tuesday morning."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Movement that has arrived"}]},{"type":"paragraph","content":[{"type":"text","text":"The standing forms of tai chi — zhan zhuang, the standing post — are often mistaken for stillness. This is not the stillness of a stopped clock. This is the stillness of a river that has found its banks."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"One practice"}]},{"type":"paragraph","content":[{"type":"text","text":"Stand still long enough, and the stillness begins to move. Let Shabbat arrive fully enough, and the rest becomes its own kind of action."}]}]}',
  '<p>The morning of Shabbat, before the service, before the meal, before any of the words that fill the day — there is a stillness that is different from the stillness of Tuesday morning.</p><h2>Movement that has arrived</h2><p>The standing forms of tai chi — zhan zhuang, the standing post — are often mistaken for stillness. This is not the stillness of a stopped clock. This is the stillness of a river that has found its banks.</p><h2>One practice</h2><p>Stand still long enough, and the stillness begins to move. Let Shabbat arrive fully enough, and the rest becomes its own kind of action.</p>',
  5,
  true,
  '2026-03-28T12:00:00Z',
  now(),
  now()
),

(
  'soft-jaw-moment',
  'The Soft-Jaw Moment Before Reaction',
  'Both the Sages and the tai chi masters have been pointing at it for millennia, in different languages.',
  'Reflection',
  'There is a particular softening of the jaw that happens before a wise response. Both the Sages and the tai chi masters have been pointing at it for millennia, in different languages.',
  '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Notice your jaw right now. Not metaphorically. Actually notice it. Is it clenched? Slightly held? Or genuinely soft?"}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"What the masters said about it"}]},{"type":"paragraph","content":[{"type":"text","text":"The great teachers of the internal arts were obsessed with the jaw. They knew that a clenched jaw meant a clenched mind, and a clenched mind could not receive incoming force without fighting it."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"The instruction"}]},{"type":"paragraph","content":[{"type":"text","text":"Before you respond to something difficult — an email, a conversation, a piece of news — notice the jaw. If it is clenched, soften it. Do not have the response until after the jaw has softened."}]}]}',
  '<p>Notice your jaw right now. Not metaphorically. Actually notice it. Is it clenched? Slightly held? Or genuinely soft?</p><h2>What the masters said about it</h2><p>The great teachers of the internal arts were obsessed with the jaw. They knew that a clenched jaw meant a clenched mind, and a clenched mind could not receive incoming force without fighting it.</p><h2>The instruction</h2><p>Before you respond to something difficult — an email, a conversation, a piece of news — notice the jaw. If it is clenched, soften it. Do not have the response until after the jaw has softened.</p>',
  7,
  true,
  '2026-03-21T12:00:00Z',
  now(),
  now()
),

(
  'rooting-patriarchs',
  'Rooting: What the Patriarchs Knew About Standing',
  'Abraham stood. Isaac stood. Jacob stood. The internal arts would recognize this posture instantly.',
  'Teaching',
  'Abraham stood. Isaac stood. Jacob stood. In each case the Torah uses a verb that does not only mean upright — it means rooted, sunk, present at the feet. The internal arts would recognize this posture instantly.',
  '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"The Hebrew Bible is obsessed with standing. Not metaphorically — literally, physically. The verb amad appears hundreds of times."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"What amad actually means"}]},{"type":"paragraph","content":[{"type":"text","text":"The root amad carries more weight than its English equivalent. To stand, in this sense, is not merely to be upright. It implies rootedness — a connection downward as much as a position upward."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"The practice between them"}]},{"type":"paragraph","content":[{"type":"text","text":"The tai chi instruction and the Torah instruction converge here: root yourself before you give. Stand before you run. Sink before you extend. Amad. Stand. Find your feet."}]}]}',
  '<p>The Hebrew Bible is obsessed with standing. Not metaphorically — literally, physically. The verb amad appears hundreds of times.</p><h2>What amad actually means</h2><p>The root amad carries more weight than its English equivalent. To stand, in this sense, is not merely to be upright. It implies rootedness — a connection downward as much as a position upward.</p><h2>The practice between them</h2><p>The tai chi instruction and the Torah instruction converge here: root yourself before you give. Stand before you run. Sink before you extend. Amad. Stand. Find your feet.</p>',
  9,
  true,
  '2026-03-14T12:00:00Z',
  now(),
  now()
),

(
  'breath-as-first-blessing',
  'Breath as the First Blessing',
  'The word neshama — soul — shares its root with breath. Long before language, there is the inhale.',
  'Reflection',
  'The word neshama — soul — shares its root with breath. Long before language, before thought, before prayer, there is the inhale. It may be the oldest teaching either tradition carries.',
  '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"The first thing the Torah says about the creation of a human being is about breath."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"The same root"}]},{"type":"paragraph","content":[{"type":"text","text":"Neshama shares its root with neshima, which means breath. Not metaphorically — linguistically, etymologically, materially. The soul of a human being and the breath of a human being come from the same place."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"The oldest practice"}]},{"type":"paragraph","content":[{"type":"text","text":"Breathe. This is already the practice."}]}]}',
  '<p>The first thing the Torah says about the creation of a human being is about breath.</p><h2>The same root</h2><p>Neshama shares its root with neshima, which means breath. Not metaphorically — linguistically, etymologically, materially. The soul of a human being and the breath of a human being come from the same place.</p><h2>The oldest practice</h2><p>Breathe. This is already the practice.</p>',
  5,
  true,
  '2026-03-07T12:00:00Z',
  now(),
  now()
),

(
  'yielding-is-not-surrender',
  'Yielding Is Not Surrender',
  'The difference between giving way and giving up — held in Jacob''s hip.',
  'Essay',
  'Push hands teaches a distinction the dominant culture keeps missing: the difference between giving way and giving up. The parsha of Vayishlach carries the same teaching, held in Jacob''s hip.',
  '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"The culture we have inherited has a word for what happens when you do not fight back: defeat."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Push hands"}]},{"type":"paragraph","content":[{"type":"text","text":"In the tai chi practice of push hands, the beginner''s impulse is to resist. The advanced practitioner yields — but yielding here does not mean giving ground in a defeated way."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Jacob at the Jabbok"}]},{"type":"paragraph","content":[{"type":"text","text":"The night before he is to meet Esau, Jacob is alone at the river. A figure comes and wrestles him until dawn. He is injured. But he does not lose."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"The distinction"}]},{"type":"paragraph","content":[{"type":"text","text":"The culture says: if it hurts you, you lost. The traditions say: if it changes you, you were present. Yielding in the deep sense is not giving up."}]}]}',
  '<p>The culture we have inherited has a word for what happens when you do not fight back: defeat.</p><h2>Push hands</h2><p>In the tai chi practice of push hands, the beginner''s impulse is to resist. The advanced practitioner yields — but yielding here does not mean giving ground in a defeated way.</p><h2>Jacob at the Jabbok</h2><p>The night before he is to meet Esau, Jacob is alone at the river. A figure comes and wrestles him until dawn. He is injured. But he does not lose.</p><h2>The distinction</h2><p>The culture says: if it hurts you, you lost. The traditions say: if it changes you, you were present. Yielding in the deep sense is not giving up.</p>',
  6,
  true,
  '2026-02-28T12:00:00Z',
  now(),
  now()
),

(
  'naase-vnishma',
  'Na''aseh V''Nishma: Action Before Understanding',
  'The body learns first. The understanding arrives after.',
  'Teaching',
  'At Sinai the people said we will do, and then we will hear. The sequence is strange unless you have practiced a form for years. The body learns first. The understanding arrives after.',
  '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"The moment at Sinai is one of the strangest in the Torah. Moses descends with the terms of the covenant. The people reply — before deliberating — na''aseh v''nishma. We will do, and we will hear."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"The body''s epistemology"}]},{"type":"paragraph","content":[{"type":"text","text":"Anyone who has practiced a physical art for years understands this from the inside. The first time you try to do a tai chi form, you do not understand it. You cannot understand it. Understanding is not available at the beginning. What is available is doing."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"For practice"}]},{"type":"paragraph","content":[{"type":"text","text":"Na''aseh v''nishma. We will do, and then we will hear. The body first. The understanding, when it comes, will be richer for the waiting."}]}]}',
  '<p>The moment at Sinai is one of the strangest in the Torah. Moses descends with the terms of the covenant. The people reply — before deliberating — na''aseh v''nishma. We will do, and we will hear.</p><h2>The body''s epistemology</h2><p>Anyone who has practiced a physical art for years understands this from the inside. The first time you try to do a tai chi form, you do not understand it. You cannot understand it. Understanding is not available at the beginning. What is available is doing.</p><h2>For practice</h2><p>Na''aseh v''nishma. We will do, and then we will hear. The body first. The understanding, when it comes, will be richer for the waiting.</p>',
  8,
  true,
  '2026-02-21T12:00:00Z',
  now(),
  now()
)

ON CONFLICT (slug) DO NOTHING;
