export interface Article {
  slug: string;
  title: string;
  subtitle: string;
  category: 'Essay' | 'Teaching' | 'Reflection';
  excerpt: string;
  date: string; // ISO
  readMinutes: number;
  body: string; // HTML string (rendered from markdown prose)
}

export const articles: Article[] = [
  {
    slug: 'why-the-body-knows-before-the-mind',
    title: 'Why the Body Knows Before the Mind',
    subtitle: "There's a moment before you react. A breath. That breath is where Torah and tai chi speak the same sentence.",
    category: 'Essay',
    excerpt: "There's a moment before you react. A breath. That breath is where Torah and tai chi speak the same sentence, long before the mind has time to form a word about it.",
    date: '2026-04-12',
    readMinutes: 6,
    body: `<p class="lead">Stand long enough in <span class="ch">zhan zhuang</span> — the standing post — and the knees begin to tremble. Not from weakness. From a deeper argument between effort and surrender that only the body can hear.</p>

<p>The mind arrives late to this conversation. It shows up with its opinions already formed, its categories tidy, its vocabulary pre-sharpened. But the body has already known for some time. The body knew when the jaw softened or clenched. The body knew when the breath went shallow. The body knew before there were words for what it was knowing.</p>

<p>This is a hard claim for a culture that worships the mind. The modern inheritance, running roughly from Descartes forward, has trained us to trust what we can articulate and distrust what we cannot. If you cannot name it, the reasoning goes, you do not really know it. Feelings are suspect. Intuitions are unreliable. Only the proposition, clean and defensible, counts as knowledge.</p>

<p>And yet the oldest traditions keep pointing in the opposite direction.</p>

<h2>Na'aseh V'nishma</h2>

<p>At Sinai, the Torah records a strange answer. When Moses brings the terms of the covenant, the people reply: <span class="heb" lang="he" dir="rtl">נַעֲשֶׂה וְנִשְׁמָע</span> — <em>na'aseh v'nishma</em>. <em>We will do, and we will hear.</em></p>

<p>Read it slowly. The sequence is wrong. Every rational inheritance of the last four centuries would insist on the opposite order: first we hear, then we deliberate, then (perhaps, carefully, with disclaimers) we do. To commit to action before understanding what the action means is, by the lights of modern reason, a species of madness.</p>

<p>The Sages noticed. They asked the question directly: how could the people accept before they had heard? The answer they gave, across many centuries and many commentators, returns again and again to a single claim: there is a kind of knowing that precedes hearing. There is a kind of consent that lives below the neck.</p>

<div class="pullquote">The body learns the form. The understanding arrives, if it arrives at all, afterward.</div>

<p>Anyone who has practiced a form — a tai chi sequence, a musical instrument, a surgery, a prayer — recognizes this immediately. The body learns the form. The understanding arrives, if it arrives at all, afterward. And the understanding that arrives is different from the understanding that was asked for. It is thicker. It is quieter. It does not defend itself in arguments.</p>

<div class="section-break">&middot; &middot; &middot;</div>

<h2>Song, and the soft jaw</h2>

<p>The Chinese internal arts have their own word for this: <span class="ch">song 松</span>. It is usually translated as "relaxation," which is almost right and almost catastrophically wrong. <em>Song</em> is not collapse. It is not the sagging of a tired body. It is the particular quality of a structure that has stopped defending itself while remaining entirely present.</p>

<p>You can feel it in the jaw. The jaw is honest. It tells you what the mind is pretending not to feel. Under pressure, the jaw clenches. Under <em>song</em>, the jaw softens — not slackens, softens — and the soft jaw changes the breath, and the changed breath changes the shoulders, and the changed shoulders change the spine, all the way down to the heels.</p>

<p>Teachers of the internal arts do not talk about this sequence philosophically. They correct it by touch. A good teacher rests a hand on a student's shoulder, feels the bracing, and waits. The student's body understands the correction long before the student's mind has composed a sentence about what just happened.</p>

<p>This is what the parsha of Kedoshim calls <em>kedusha</em>. Not ecstasy. Not altered states. The discipline of not striking back when the ego wants to strike. The practice of one breath before response. The soft jaw, held under pressure, that makes <em>love your neighbor as yourself</em> even possible.</p>

<h2>Before the word</h2>

<p>There is a reason both traditions privilege the morning practice. The body is not yet defended in the morning. The mind has not yet armored itself in its daily positions. The breath is still long. In that small window between waking and speaking, something can be learned that will not be learnable again that day.</p>

<p>Torah reading was always a bodied thing. One stood. One swayed. One chanted with a cantillation that moved in the chest before it moved in the throat. The idea that you could read Torah with only your eyes — silently, stationary, mentally — would have struck the earlier generations as a kind of category error, like trying to eat a meal by thinking about it.</p>

<p>The return to the body is not a retreat from the text. It is a way back into the text. The body is where the text was always going.</p>

<p>So: stand. Breathe. Notice the jaw. The teaching is already arriving.</p>`,
  },
  {
    slug: 'song-and-anavah',
    title: 'Song and Anavah: The Shared Root of Release',
    subtitle: 'The Chinese concept of song — deep, conscious release without collapse — maps almost perfectly onto the Jewish middah of anavah.',
    category: 'Teaching',
    excerpt: 'The Chinese concept of song 松 — deep, conscious relaxation without collapse — maps almost perfectly onto the Jewish middah of anavah, true humility.',
    date: '2026-04-04',
    readMinutes: 8,
    body: `<p class="lead">There are two words, from two traditions separated by thousands of miles and thousands of years, that describe the same interior motion. <span class="ch">Song 松</span> in the Chinese internal arts. <em>Anavah</em> in the vocabulary of Jewish character development. Neither one means what the modern ear first hears.</p>

<p>Song is usually translated as relaxation. But relaxation in the modern sense means flopping — shedding structure, going soft, checking out. Song is the opposite. It is an active, deliberate release of holding while maintaining full structural integrity. A song body is not a collapsed body. It is a body that has stopped fighting gravity and started cooperating with it.</p>

<p>Anavah is usually translated as humility. But humility in the modern sense often carries a flavor of self-deprecation, of shrinking, of making yourself smaller so that others can feel larger. This is not what the tradition means. Moshe Rabbeinu was described as the most anav person who ever lived, and he also stood before Pharaoh and said: let my people go. Anavah is not smallness. It is accurate self-assessment — neither inflated nor deflated — held with a kind of structural ease.</p>

<h2>What yields without collapsing</h2>

<p>The test of both qualities is the same: what happens under pressure?</p>

<p>In push hands — the tai chi partnering exercise — you can feel the difference between a song partner and a tense one immediately. The tense partner braces when you push. The force bounces back, or worse, accumulates into their structure and eventually breaks it. The song partner receives. The force enters, disperses through a yielding structure, and dissipates. The partner remains standing, unharmed, fully present.</p>

<p>This is what the mussar tradition calls the test of a middah: not how you behave when circumstances support you, but what you do when circumstances press. The person with genuine anavah, pressed into a corner, does not collapse into self-abasement or erupt into defensiveness. They yield without losing their ground.</p>

<div class="pullquote">You yield without losing your ground. This is the whole practice.</div>

<h2>The root beneath the release</h2>

<p>Both traditions agree on what makes this possible: root. In tai chi, song without root is just collapse. You cannot release your structure unless you have somewhere to release it into. The practice of rooting — feeling the connection between the soles of the feet and the ground, allowing weight to sink — is what makes song possible.</p>

<p>In the vocabulary of Jewish practice, this root is sometimes called <em>da'at</em> — the deep knowledge that is not information but orientation. Before you can yield, you have to know where you are standing. Not in the sense of knowing your position or defending your interests, but in the sense of being genuinely present in your body, in your values, in your commitments.</p>

<p>Moshe could yield because he knew where he stood. He was not performing humility. He was not effortfully suppressing his ego. He was standing in something deeper than ego, and from that standing, release was natural.</p>

<h2>A practice</h2>

<p>Stand for a moment. Let your weight settle into your feet. Feel the floor beneath you — not as an idea, but as a sensation in the soles. Take three slow breaths, and with each exhale, let your shoulders drop a fraction further.</p>

<p>This is not a metaphor. This is a body learning the shape of anavah. Song and anavah are the same interior motion, expressed in different languages. The practice is real. The body is the text.</p>`,
  },
  {
    slug: 'what-shabbat-taught-about-stillness-in-motion',
    title: 'What Shabbat Taught About Stillness in Motion',
    subtitle: 'Rest is not the absence of movement. It is movement arriving where it was always headed.',
    category: 'Reflection',
    excerpt: 'Rest is not the absence of movement. It is movement arriving where it was always headed. The standing forms of tai chi and the rhythm of the seventh day describe the same quiet arrival.',
    date: '2026-03-28',
    readMinutes: 5,
    body: `<p class="lead">For years, Shabbat felt like a stopping. The week arrived at a wall, momentum was absorbed, and a kind of enforced stillness began. It was good. But it was passive.</p>

<p>Then the standing forms of tai chi began to change the understanding of what still meant.</p>

<p>In <span class="ch">zhan zhuang</span> — the standing post practice — you are not doing nothing. The body is engaged in a continuous, subtle negotiation with gravity. The spine aligns. The knee joints soften. The weight settles through the feet into the ground. Breath moves. Every few seconds, some small correction occurs: a shoulder drops, a hip releases, the jaw unclenches. This is not rest in the sense of absence. It is rest in the sense of arrival.</p>

<h2>The seventh day is not empty</h2>

<p>The Torah says God rested on the seventh day. The Hebrew word is <em>vayinafash</em> — from <em>nefesh</em>, soul. God ensouled on the seventh day. God breathed deeply. The seventh day is not the day when nothing happens. It is the day when something very specific happens: presence without agenda, aliveness without production.</p>

<p>This is the quality that both traditions are pointing at. Not the absence of movement, but movement that has arrived at its destination. Not the end of effort, but effort that has completed itself and settled into its ground.</p>

<div class="pullquote">Shabbat is not the absence of movement. It is movement that has arrived.</div>

<h2>What the body knows about rest</h2>

<p>The body knows things about rest that the mind resists. The mind tends to think of rest as a pause in productivity — a recharging station before the next output cycle. But the body, when it genuinely rests, is not pausing. It is integrating. The nervous system is processing the week's events. The joints are recovering their fluid balance. The fascia is releasing the accumulated tensions of days of effort and reactivity.</p>

<p>Standing in <span class="ch">zhan zhuang</span> on a Shabbat morning, with nowhere to go and nothing to produce, the body teaches you something about the seventh day that you could not have learned any other way: that rest is an active state, full of its own subtle industry, moving toward its own kind of completion.</p>

<p>Shabbat is not when the week ends. It is when the week arrives.</p>`,
  },
  {
    slug: 'the-soft-jaw-moment',
    title: 'The Soft-Jaw Moment Before Reaction',
    subtitle: 'There is a particular softening of the jaw that happens before a wise response.',
    category: 'Reflection',
    excerpt: 'There is a particular softening of the jaw that happens before a wise response. Both the Sages and the tai chi masters have been pointing at it for millennia, in different languages.',
    date: '2026-03-21',
    readMinutes: 7,
    body: `<p class="lead">Check your jaw right now. Not in a clinical way — just notice. Is it slightly clenched? Are the back teeth just a hair apart? Is there any holding in the hinge where the mandible meets the skull?</p>

<p>Most of us carry a low-grade jaw clench through the majority of our waking hours without noticing. The shoulders are also probably held — slightly elevated, slightly forward. The breath is probably shallow, living in the chest rather than the belly. We have adapted to this state so thoroughly that we no longer experience it as tension. It is simply the texture of being awake and functional in the world.</p>

<p>And yet every wise tradition that has thought carefully about the moment before action — about the space between stimulus and response — has pointed at this jaw.</p>

<h2>The mussar teachers on reflex</h2>

<p>The mussar masters of the 19th century were interested in what they called <em>klal</em> — the moment of impulse before thought. Rabbi Yisrael Salanter taught that the most dangerous moment in moral life was not the deliberate choice between good and evil. It was the reflex: the instant reaction, the flash of anger, the word that escapes before the mind has engaged. Character development was, in his view, primarily about slowing that reflex down.</p>

<p>How? Through practice. Through rehearsing responses. Through cultivating a particular inner spaciousness that could hold even a strong emotion without immediately translating it into action.</p>

<div class="pullquote">The jaw is the canary. When it softens, the space opens.</div>

<h2>The jaw in the internal arts</h2>

<p>In the Chinese internal arts, this same spaciousness is cultivated through the body. One of the first corrections any good teacher makes is to the jaw: soften it. Let the back teeth separate slightly. Let the tongue rest against the roof of the mouth without pressing. Let the whole jaw hang in its socket with a quality of ease.</p>

<p>This is not simply a relaxation instruction. It is a systemic instruction. The jaw is connected to the cranial base. The cranial base connects to the first cervical vertebra. The cervical spine connects to everything below. When the jaw softens, a wave of ease propagates downward through the entire spine, changing the quality of the breath, softening the diaphragm, allowing the weight to descend into the lower body and the feet.</p>

<p>The jaw is the canary. When it softens, everything softens. When it holds, everything holds.</p>

<p>The wise response — in Torah terms, in tai chi terms, in any terms — begins in the jaw. Soften. Breathe. Then speak.</p>`,
  },
  {
    slug: 'rooting-what-the-patriarchs-knew-about-standing',
    title: 'Rooting: What the Patriarchs Knew About Standing',
    subtitle: 'Abraham stood. Isaac stood. Jacob stood. The Torah uses a verb that does not only mean upright — it means rooted.',
    category: 'Teaching',
    excerpt: 'Abraham stood. Isaac stood. Jacob stood. In each case the Torah uses a verb that does not only mean upright — it means rooted, sunk, present at the feet. The internal arts would recognize this posture instantly.',
    date: '2026-03-14',
    readMinutes: 9,
    body: `<p class="lead">There is a Hebrew verb that appears at critical moments in the lives of the patriarchs: <span class="heb" lang="he" dir="rtl">וַיַּעֲמֹד</span>, <em>vaya'amod</em>. Usually translated as "and he stood." But the root is <em>amad</em>, and amad does not merely mean vertical. It means anchored. Grounded. Unmoving in the face of movement.</p>

<p>Abraham stood at the tent entrance in the heat of the day, watching for guests. Isaac stood in the field at evening, returning from a walk. Jacob stood before Pharaoh — an old man, facing the most powerful ruler in the world — and proceeded to bless him. In each case, the standing is not incidental. It is the condition of possibility for what follows.</p>

<h2>What rooting is</h2>

<p>In the Chinese internal arts, <em>rooting</em> is one of the most fundamental and most difficult skills to develop. A rooted body is not simply a body that is not falling over. It is a body that has established a genuine energetic connection with the ground — through which force can descend, through which stability can arise, and through which the practitioner can project power or absorb it without losing their center.</p>

<p>You can test rooting. A good teacher can push a rooted student and feel the push disappear into the ground rather than accumulate in the student's structure. A well-rooted person can be pushed from the front and feel their weight simply settle further downward rather than topple backward.</p>

<p>This is not a mystical claim. It is a mechanical one. The body has a structure, and when that structure is properly aligned — spine long, knees soft, weight sinking through relaxed joints rather than braced against them — forces that enter the structure can travel through it and into the ground rather than disrupting it.</p>

<div class="pullquote">Jacob stood before Pharaoh and blessed him. An old man. A shepherd. And he blessed the king. This requires root.</div>

<h2>The patriarchs as root practitioners</h2>

<p>What is striking, reading the patriarchal narratives through this lens, is how often the standing is specifically at a moment of pressure. Abraham stands at his tent in the heat of the day — heat here carrying its traditional symbolic weight of trial and challenge. Jacob stands before Pharaoh. These are not moments of ease. They are moments when the ordinary person collapses or flees or grasps.</p>

<p>The <em>amidah</em> — the central Jewish prayer — takes its name from this verb. One stands for the amidah. One does not sit. The prayer is offered from a standing body, feet together, because the prayer requires the posture of the patriarchs: rooted, present, not grasping, not collapsing.</p>

<p>Learn to stand before you learn to speak. Let the feet sink. Let the weight descend. The words will be different, after that.</p>`,
  },
  {
    slug: 'breath-as-the-first-blessing',
    title: 'Breath as the First Blessing',
    subtitle: 'The word neshama — soul — shares its root with breath. Before language, before thought, there is the inhale.',
    category: 'Reflection',
    excerpt: 'The word neshama — soul — shares its root with breath. Long before language, before thought, before prayer, there is the inhale. It may be the oldest teaching either tradition carries.',
    date: '2026-03-07',
    readMinutes: 5,
    body: `<p class="lead">The Hebrew word for soul is <em>neshama</em>. The word for breath is <em>neshima</em>. They share the same root, <em>nun-shin-mem</em>. This is not a coincidence that commentators have ignored. It is the whole point.</p>

<p>In the creation account, God breathes into the formed clay and it becomes a living soul. The soul is not inserted from outside. The soul is the breath. Or more precisely: the soul is what the breath makes possible. The breath is the medium of divine contact with the human body, and it has been that way since the first moment of human existence.</p>

<h2>The breath in tai chi</h2>

<p>The Chinese internal arts are, among other things, a science of breathing. Not breathing exercises in the conventional sense — not the disciplined pranayama of some yogic traditions, which treats the breath as a vehicle for specific techniques. Rather, a cultivation of natural, unobstructed breathing, allowing the breath to sink into the belly, to move the diaphragm fully, to arrive at the lower <span class="ch">dantian</span> — the body's center of gravity and energetic reservoir.</p>

<p>A beginning student of tai chi is typically too high. The breath is in the chest. The center of gravity is above the waist. The energy is nervous and flickering. A senior student breathes low. The center of gravity has descended. Movements arise from this lower center with a quality of rootedness and ease that is immediately visible.</p>

<div class="pullquote">Before language, before thought, before prayer, there is the inhale. Start there.</div>

<h2>Morning as the first classroom</h2>

<p>Both traditions have a liturgy for the moment of waking. In the Jewish tradition, the first words spoken on waking are <em>modeh ani</em> — I acknowledge, I give thanks. Before rising, before dressing, before speaking to anyone or thinking about the day's obligations. The first act is gratitude for the breath that returned.</p>

<p>There is a wisdom in doing this before the mind fully engages. The mind, once engaged, has opinions. It has an agenda for the day, anxieties about what is unresolved, plans for what must be accomplished. But in the first moments of waking, before the mind's machinery spins up, there is just the breath. And the breath is the soul. And the soul, unobstructed, knows something the mind will spend the rest of the day forgetting.</p>

<p>Before your morning practice, before your prayer, before your plan for the day: one breath. Long. Low. Received as the gift it is.</p>

<p>That breath is the first blessing. Start there.</p>`,
  },
  {
    slug: 'yielding-is-not-surrender',
    title: 'Yielding Is Not Surrender',
    subtitle: 'Push hands teaches a distinction the dominant culture keeps missing: the difference between giving way and giving up.',
    category: 'Essay',
    excerpt: 'Push hands teaches a distinction the dominant culture keeps missing: the difference between giving way and giving up. The parsha of Vayishlach carries the same teaching, held in Jacob\'s hip.',
    date: '2026-02-28',
    readMinutes: 6,
    body: `<p class="lead">In push hands — the tai chi partnering exercise — there is a specific moment that teaches more about character than most things. Your partner pushes. You could brace, absorb the force through your joints, hold your ground through sheer structural resistance. Or you could yield: shift your weight, redirect the incoming force, allow the push to pass through you without arriving anywhere.</p>

<p>The untrained observer, watching yield, sees weakness. Sees capitulation. Sees someone being pushed around. But the practitioner knows: the person who yields retains their center. The person who braces is the one being controlled.</p>

<h2>Jacob's hip</h2>

<p>The parsha of Vayishlach contains one of the most compressed and dense narratives in the Torah: Jacob wrestling through the night with a mysterious figure. The wrestling ends with Jacob being struck in the hip — his thigh socket is displaced — and yet he refuses to release his grip until he receives a blessing. He walks away with a limp. He walks away with a new name. He walks away transformed.</p>

<p>The wrestling is not a metaphor, though it is also a metaphor. It is a bodily event. A physical encounter with something that could not be overcome by force and could not be evaded. It had to be engaged, and the engagement cost something real.</p>

<p>Jacob does not win by being stronger than his opponent. He wins by enduring. By not letting go even when it would have been easier to let go. His yield is in the hip — he gives the hip socket — but not the grip. This is the distinction. He knows what to yield and what to hold.</p>

<div class="pullquote">Yield means: I know where I am, and from that ground, I can receive this force without being destroyed by it.</div>

<h2>What the dominant culture gets wrong</h2>

<p>The cultural inheritance most of us have received frames strength as resistance and yielding as weakness. You hold your ground or you lose it. You fight or you fold. This is a binary that the internal arts and the Torah tradition both reject.</p>

<p>In push hands, the most advanced players yield the most. They are so thoroughly relaxed, so completely unbraced, that force has almost nothing to find in them. Push them and the push dissipates. Try to control them and the control slips like water off stone. Their yielding is a form of mastery.</p>

<p>In Jewish moral tradition, yielding anger is not weakness. Yielding position in a dispute you are right about, for the sake of shalom, is not weakness. The Sages held that making peace was worth compromising truth — not because truth does not matter, but because some forms of holding truth are actually a grip on ego rather than a service to the good.</p>

<p>Jacob yielded his hip and received his name. What you yield shapes what you become.</p>`,
  },
  {
    slug: 'naase-vnishma-action-before-understanding',
    title: "Na'aseh V'Nishma: Action Before Understanding",
    subtitle: "At Sinai the people said 'we will do, and then we will hear'. The sequence is strange unless you have practiced a form for years.",
    category: 'Teaching',
    excerpt: "At Sinai the people said we will do, and then we will hear. The sequence is strange unless you have practiced a form for years. The body learns first. The understanding arrives after.",
    date: '2026-02-21',
    readMinutes: 8,
    body: `<p class="lead">The Midrash records that when the Jewish people said <span class="heb" lang="he" dir="rtl">נַעֲשֶׂה וְנִשְׁמָע</span> — we will do and then we will hear — angels came and placed two crowns on each person's head. One for the <em>na'aseh</em> and one for the <em>nishma</em>. The angels recognized something in that backwards sentence that most of us, encountering it for the first time, miss entirely.</p>

<p>What did they recognize? The same thing a teacher of the internal arts recognizes when a new student, for the first time, stops trying to understand a movement and simply does it.</p>

<h2>The epistemology of the form</h2>

<p>Learning a tai chi form is a strange experience for a person trained in conventional Western modes of learning. Conventional learning proceeds from understanding to application. You learn the principle, then you practice it. You read the manual, then you use the tool. Understanding precedes doing.</p>

<p>The form does not work this way. You learn the movements before you understand them. You copy the teacher's posture, you repeat the sequences hundreds of times, and at some point — months or years in — something clicks. Not as understanding that arrives before movement, but as understanding that arrives through movement, distilled from it, emerging from the body's long engagement with something it could not have comprehended at the start.</p>

<div class="pullquote">The form teaches what words cannot carry. The body holds what the mind cannot yet name.</div>

<h2>What the body learns first</h2>

<p>There is a particular kind of knowing that only arrives through the body, and only after a long time. You cannot shortcut it with explanations. You cannot acquire it intellectually and then apply it physically. It has to be built from the ground up, sensation by sensation, repetition by repetition.</p>

<p>Ask a senior tai chi practitioner to explain <span class="ch">jin</span> — the refined, specific quality of force that distinguishes advanced internal arts from muscular effort. They will struggle to explain it. But they can demonstrate it, and if you have practiced long enough, you can feel the difference in a single touch.</p>

<p>The people at Sinai had been slaves. Slaves have bodies. Slaves know the world through labor and endurance and the particular education of people whose bodies have been used and abused by systems they did not choose. When they said <em>na'aseh v'nishma</em>, they were not being naive. They were speaking from a bodily wisdom that knew: some things you have to do before you understand. The doing is how you get to the understanding.</p>

<p>This is not anti-intellectual. It is simply a more complete epistemology — one that includes the body as a site of genuine knowing, and that understands that doing and hearing are not in competition but in sequence. Do first. Then the hearing that follows is different in kind from hearing without doing.</p>

<p>The form teaches what words cannot carry. Start moving.</p>`,
  },
];
