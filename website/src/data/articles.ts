export type ArticleCategory = "Essay" | "Teaching" | "Reflection";

export interface Article {
  slug: string;
  title: string;
  subtitle: string;
  category: ArticleCategory;
  excerpt: string;
  date: string;
  readMinutes: number;
  body: string;
}

export const ARTICLES: Article[] = [
  {
    slug: "why-the-body-knows",
    title: "Why the Body Knows Before the Mind",
    subtitle: "There's a moment before you react. A breath. That breath is where Torah and tai chi speak the same sentence.",
    category: "Essay",
    excerpt: "There's a moment in zhan zhuang — standing meditation — where the legs begin to tremble. The mind screams quit. But something deeper holds. That something is what the Torah calls emunah.",
    date: "April 12",
    readMinutes: 6,
    body: `Stand long enough in *zhan zhuang* — the standing post — and the knees begin to tremble. Not from weakness. From a deeper argument between effort and surrender that only the body can hear.

The mind arrives late to this conversation. It shows up with its opinions already formed, its categories tidy, its vocabulary pre-sharpened. But the body has already known for some time. The body knew when the jaw softened or clenched. The body knew when the breath went shallow. The body knew before there were words for what it was knowing.

## Na'aseh V'nishma

At Sinai, the Torah records a strange answer. When Moses brings the terms of the covenant, the people reply: *na'aseh v'nishma* — we will do, and we will hear.

Read it slowly. The sequence is wrong. Every rational inheritance of the last four centuries would insist on the opposite order: first we hear, then we deliberate, then we do. To commit to action before understanding what the action means is, by the lights of modern reason, a species of madness.

The Sages noticed. They asked the question directly: how could the people accept before they had heard? The answer they gave, across many centuries and many commentators, returns again and again to a single claim: there is a kind of knowing that precedes hearing. There is a kind of consent that lives below the neck.

Anyone who has practiced a form — a tai chi sequence, a musical instrument, a prayer — recognizes this immediately. The body learns the form. The understanding arrives, if it arrives at all, afterward. And the understanding that arrives is different from the understanding that was asked for. It is thicker. It is quieter. It does not defend itself in arguments.

## Song, and the soft jaw

The Chinese internal arts have their own word for this: *song* 松. It is usually translated as "relaxation," which is almost right and almost catastrophically wrong. *Song* is not collapse. It is not the sagging of a tired body. It is the particular quality of a structure that has stopped defending itself while remaining entirely present.

You can feel it in the jaw. The jaw is honest. It tells you what the mind is pretending not to feel. Under pressure, the jaw clenches. Under *song*, the jaw softens — not slackens, softens — and the soft jaw changes the breath, and the changed breath changes the shoulders, and the changed shoulders change the spine, all the way down to the heels.

This is what the parsha of Kedoshim calls *kedusha*. Not ecstasy. Not altered states. The discipline of not striking back when the ego wants to strike. The practice of one breath before response.

## Before the word

There is a reason both traditions privilege the morning practice. The body is not yet defended in the morning. The mind has not yet armored itself in its daily positions. The breath is still long. In that small window between waking and speaking, something can be learned that will not be learnable again that day.

Torah reading was always a bodied thing. One stood. One swayed. One chanted with a cantillation that moved in the chest before it moved in the throat. The idea that you could read Torah with only your eyes — silently, stationary, mentally — would have struck the earlier generations as a category error.

The return to the body is not a retreat from the text. It is a way back into the text. The body is where the text was always going.

So: stand. Breathe. Notice the jaw. The teaching is already arriving.`,
  },
  {
    slug: "song-and-anavah",
    title: "Song and Anavah: The Shared Root of Release",
    subtitle: "Two old vocabularies, pointing at the same quiet center.",
    category: "Teaching",
    excerpt: "The Chinese concept of song 松 — deep, conscious relaxation without collapse — maps almost perfectly onto the Jewish middah of anavah, true humility. Both describe a structure that yields without losing itself.",
    date: "April 4",
    readMinutes: 8,
    body: `There is a word in classical Chinese that the internal arts teachers use constantly, and it does not translate well. The word is *song* 松. Most dictionaries give you "loose" or "relaxed," and these are not wrong, but they are not quite right either.

*Song* is what happens when a structure stops defending itself. Not when it collapses, not when it gives up — when it releases the unnecessary tension while keeping the necessary structure. A tree in wind is *song*. A cat waiting to spring is *song*. A great musician at the peak of performance is *song*.

## Anavah is not what we think

The word anavah is usually translated as humility. In Jewish ethical literature — the mussar tradition, in particular — it is considered among the most important middot, character traits. Moses is the paradigm: the most humble man who ever lived, we are told.

But the popular understanding of humility is almost exactly wrong. We tend to think of a humble person as someone who thinks little of themselves, who hangs back, who defers. This is not anavah. This is self-erasure. The Sages were quite clear: a person who collapses inward, who makes themselves nothing, is not humble. They are simply absent.

True anavah is *accurate* self-appraisal. It is knowing precisely what you are and what you are not — neither inflated nor deflated. It is a kind of structural honesty. The humble person does not puff up under pressure, and does not crumple. They remain what they are.

## The push-hands test

In the tai chi practice of push hands, two practitioners stand close and try to uproot each other. The unskilled practitioner does one of two things when pushed: they resist with brute force, or they collapse and lose their root. Neither works.

The skilled practitioner does something different. They receive the push — actually receive it, let it arrive — without bracing against it. The incoming force is not fought and not surrendered to. It is redirected, because the practitioner remains rooted even in the reception. This is *song*. The structure is intact. The defense is down.

Anavah, in practice, looks like this. Under praise, the humble person does not puff up. Under criticism, they do not collapse. They receive both, feel both, and remain.

## Where they meet

The tradition says that before you pray, you must stand in *awe* — but awe is not terror, and it is not self-erasure. It is the particular quality of someone who knows exactly who they are standing before, and knows exactly what they are. Present, rooted, awake.

The tradition of the internal arts says: before you move, find your *song*. Release the unnecessary tension. Keep the root. Be exactly what you are.

This is not two different instructions. This is one instruction, arriving through two vocabularies across two traditions. Stand without defending. Receive without collapsing. This is the practice. This is the teaching. This is the place where both traditions say the same thing.`,
  },
  {
    slug: "shabbat-stillness-in-motion",
    title: "What Shabbat Taught About Stillness in Motion",
    subtitle: "Rest is not the absence of movement. It is movement arriving where it was always headed.",
    category: "Reflection",
    excerpt: "For years I thought rest meant stopping. Then I started practicing tai chi on Shabbat morning — not the martial forms, but the standing. And I understood: Shabbat isn't absence of movement.",
    date: "March 28",
    readMinutes: 5,
    body: `The morning of Shabbat, before the service, before the meal, before any of the words that fill the day — there is a stillness that is different from the stillness of Tuesday morning.

It is not quiet in the sense of empty. Something is present in it. The tradition has always known this, which is why the literature speaks of an extra soul arriving on Shabbat, a *neshama yeteirah* — a supplement to the ordinary self. The day does not subtract. It adds.

## Movement that has arrived

The standing forms of tai chi — *zhan zhuang*, the standing post — are often mistaken for stillness. The practitioner stands, sometimes for a long time. Nothing appears to happen. But inside, quite a lot is happening. The body is finding its root. The breath is finding its depth. The unnecessary tension is quietly draining away. This is not the stillness of a stopped clock. This is the stillness of a river that has found its banks.

Shabbat is like this. The tradition prohibits a long list of *melachot* — labors, acts of creation and transformation. Not because creation is bad. Because six days of creation leads, by its own logic, to a seventh day that is different in kind. The rest of Shabbat is not recovery. It is arrival.

## The form that teaches rest

When you practice tai chi over years, there comes a point where the forms stop feeling like effort. Not because they require less — they require more, but differently. The effort becomes invisible because it has been absorbed into structure. You move, and it does not cost you the way it once did, because the movement has found its proper channel.

This is one way to understand *menucha* — the Shabbat rest. It is not the absence of aliveness. It is aliveness that has found its channel. The body knows this. On Shabbat morning, something in the organism settles in a way it does not settle on other mornings. The week's accumulated tension has somewhere to go.

## One practice

Stand still long enough, and the stillness begins to move. Let Shabbat arrive fully enough, and the rest becomes its own kind of action. The two traditions, pointing at the same teaching from opposite directions: the deepest rest is the most alive.

So on Shabbat morning, stand. Let the week's effort find its root. Let the movement arrive where it was always going. This is not the end of the practice. This is the practice completing itself.`,
  },
  {
    slug: "soft-jaw-moment",
    title: "The Soft-Jaw Moment Before Reaction",
    subtitle: "Both the Sages and the tai chi masters have been pointing at it for millennia, in different languages.",
    category: "Reflection",
    excerpt: "There is a particular softening of the jaw that happens before a wise response. Both the Sages and the tai chi masters have been pointing at it for millennia, in different languages.",
    date: "March 21",
    readMinutes: 7,
    body: `Notice your jaw right now.

Not metaphorically. Actually notice it. Is it clenched? Slightly held? Or genuinely soft — the molars not quite touching, the hinge of the jaw loose, the tongue resting on the floor of the mouth rather than pressed to the roof?

Most people, most of the time, are holding their jaw. We do not notice this because the holding has been there so long it has become background. But the jaw knows what the mind is doing. It is one of the most honest organs in the body.

## What the masters said about it

The great teachers of the internal arts — the lineages that carried push hands and standing practice through centuries — were obsessed with the jaw. Specifically with releasing it. They knew that a clenched jaw meant a clenched mind, and a clenched mind could not receive incoming force without fighting it. The jaw was the last place the ego held on.

The instruction, in most lineages, goes something like: before you can be a practitioner, you must learn to practice with a soft jaw. Not slack — a slack jaw means the mind has drifted into passivity. Soft. Present, but not defending.

The Talmud has a phrase that lands in the same place. It speaks of the person who knows how to answer a question and the person who does not — but the deeper teaching is about what happens in the moment before the answer arrives. The Sages called the wise response the one that does not spring immediately from the ego's store. It comes from a place that had to be cleared first.

## The gap before the word

There is a moment, and everyone who has trained in any contemplative tradition knows it, between stimulus and response. Viktor Frankl famously located human freedom in this gap. The Jewish tradition calls something like this the *pause before reaction* — the breath that the wise person takes, not out of indecision, but out of discipline.

The tai chi version of this is more physical. When a push arrives — a literal physical push in the push-hands practice — the untrained practitioner responds immediately. They brace or they collapse. The trained practitioner has learned to receive the push into a soft jaw, a soft chest, a soft root. The push arrives. The practitioner is present to it. The response comes from that presence, not from the ego's reflex.

## The instruction

So here it is, as simply as it can be given: before you respond to something difficult — an email, a conversation, a piece of news — notice the jaw. If it is clenched, soften it. Do not have the response until after the jaw has softened.

This is not advice about being slow or passive. It is advice about where the response comes from. The response that comes from a soft jaw is still decisive. It is just not reactive. And that difference, in the traditions that have thought about this, is the whole difference.`,
  },
  {
    slug: "rooting-patriarchs",
    title: "Rooting: What the Patriarchs Knew About Standing",
    subtitle: "Abraham stood. Isaac stood. Jacob stood. The internal arts would recognize this posture instantly.",
    category: "Teaching",
    excerpt: "Abraham stood. Isaac stood. Jacob stood. In each case the Torah uses a verb that does not only mean upright — it means rooted, sunk, present at the feet. The internal arts would recognize this posture instantly.",
    date: "March 14",
    readMinutes: 9,
    body: `The Hebrew Bible is obsessed with standing.

Not metaphorically — literally, physically. The verb *amad* appears hundreds of times. And in the stories of the Patriarchs, it appears at the most significant moments: Abraham stands before the Divine, Isaac stands in contemplation in the field, Jacob stands and dreams. The standing is not incidental. It is the medium of the encounter.

## What amad actually means

The root *amad* carries more weight than its English equivalent. To stand, in this sense, is not merely to be upright. It implies rootedness — a connection downward as much as a position upward. The related forms of the word appear in *amidah* — the standing prayer — and in words that suggest durability, permanence, the quality of something that does not move even under pressure.

The internal arts have their own vocabulary for this. *Zhan zhuang* — literally "standing like a post" or "standing like a stake in the ground" — is the foundational practice of the Chinese internal martial arts. Before you learn to move, you learn to stand. Before you learn to yield, you learn to root.

The instruction in most lineages is the same: sink. Imagine you have roots going into the earth. The weight of the body drops downward, not upward. The spine rises, but the feet deepen. The center of gravity descends. This is *chan jin* — silk reeling energy — finding its source.

## Abraham stands

The scene is at Mamre. Three strangers arrive. The Torah says Abraham was sitting at the entrance of his tent, and when he saw them, he *ran* to greet them — but before the running, there is the sitting, and beneath the sitting, the standing. The posture of Abraham in the midrashic imagination is always one of presence, of rootedness.

The teachers of *mussar* — the Jewish character-development tradition — read the Patriarchs as embodiments of specific character traits. Abraham is identified with *chesed*, loving-kindness. But the embodiment is not abstract. *Chesed* as Abraham practices it is grounded. It is hospitality from a rooted place. You can only give fully when you are not about to be blown over.

## The practice between them

The tai chi instruction and the Torah instruction converge here: root yourself before you give. Stand before you run. Sink before you extend.

This is not about being slow. Abraham ran. The internal arts practitioners move, often faster than seems possible. But the movement comes from a rooted place. The generosity comes from a full vessel. The action arises from a person who is, at the base, standing.

*Amad*. Stand. Find your feet. Let the weight drop. Then see what kind of *chesed* becomes available.`,
  },
  {
    slug: "breath-as-first-blessing",
    title: "Breath as the First Blessing",
    subtitle: "The word neshama — soul — shares its root with breath. Long before language, there is the inhale.",
    category: "Reflection",
    excerpt: "The word neshama — soul — shares its root with breath. Long before language, before thought, before prayer, there is the inhale. It may be the oldest teaching either tradition carries.",
    date: "March 7",
    readMinutes: 5,
    body: `The first thing the Torah says about the creation of a human being is about breath.

God forms the earthling from the soil, and then — *vayipach b'apav nishmat chayyim* — breathes into the nostrils the breath of life. This is the moment of becoming. Not the shaping of the body, but the breath entering it. The *neshama*, the soul, is breath-shaped. The word and the act are one.

## The same root

*Neshama* shares its root with *neshima*, which means breath. Not metaphorically — linguistically, etymologically, materially. The soul of a human being and the breath of a human being come from the same place in the language, because they come from the same place in the body.

The tradition knows this. The morning prayer begins not with theology but with breath: *Neshama shenatata bi, tehora hi* — the soul you have placed in me is pure. It is the first blessing of the morning, before the blessing for the restoration of the body, before the blessing for the removal of sleep, before anything. The soul — the breath — is the first gratitude.

## How the internal arts receive this

The Chinese internal arts place the breath at the center of the practice differently than most Western training traditions. In most athletic contexts, breath is managed — controlled, timed, regulated. In the internal arts, breath is listened to.

The instruction is: breathe naturally, and notice what gets in the way of breathing naturally. The holding in the chest, the restriction in the abdomen, the bracing that prevents the breath from completing its arc into the lower *dantian* — these are not problems to be fixed but information to be received. The breath tells you where the holding is. The breath is always more honest than the mind.

## The oldest practice

The morning standing practice — *zhan zhuang* at dawn — and the morning blessing practice share this. Before the words of prayer, before the intention you bring to the form, there is the breath. The breath arrived before you did. It will continue after you have composed yourself. It is the most honest thing in the room.

To notice the breath — really notice it, as a practice, not as an afterthought — is to touch something the two traditions agree is foundational. The *neshama* that was breathed into the first human being is still arriving. Every morning. Before the blessings. Before the form. Before the words.

Breathe. This is already the practice.`,
  },
  {
    slug: "yielding-is-not-surrender",
    title: "Yielding Is Not Surrender",
    subtitle: "The difference between giving way and giving up — held in Jacob's hip.",
    category: "Essay",
    excerpt: "Push hands teaches a distinction the dominant culture keeps missing: the difference between giving way and giving up. The parsha of Vayishlach carries the same teaching, held in Jacob's hip.",
    date: "February 28",
    readMinutes: 6,
    body: `The culture we have inherited has a word for what happens when you do not fight back: defeat.

If someone pushes you and you do not push back, you have lost. If you soften when you should brace, you are weak. If you yield, you surrender. The equation is assumed to be simple.

The internal martial arts spend years, and the Torah spends a chapter, demonstrating that this equation is wrong.

## Push hands

In the tai chi practice of push hands, the beginner's impulse is to resist. Someone pushes your chest, you push back. The result is that the stronger or heavier person wins, which means the practice becomes a test of force, which means the whole point is lost.

The advanced practitioner does something different. When pushed, they yield — but yielding here does not mean giving ground in a defeated way. It means receiving the incoming force into the structure, redirecting it, using the attacker's momentum. The push arrives, is received, and is channeled into a response. The practitioner has not resisted, and has not been overcome.

This takes years to learn, because every instinct in the body and every lesson from the culture says to brace. The training is a reprogramming of the reflex.

## Jacob at the Jabbok

The night before he is to meet Esau — the brother who might want to kill him — Jacob is alone at the river. A figure comes and wrestles him until dawn. Jacob does not win the wrestling match in any simple sense. He is injured: the hip, the *gid hanasheh*, the sciatic sinew, is struck. He will walk with a limp for the rest of his life.

But he does not lose. The figure tries to break away at dawn, and Jacob holds on: *ki im berachtani* — I will not release you unless you bless me. And he receives the blessing. The injury and the blessing come together. The name change — from Jacob to Israel, *yisrael*, one who wrestles with God — comes from the very moment of being wounded.

This is not surrender. This is the advanced move. He yields enough to receive the impact. He holds enough to remain. The result is both injury and transformation.

## The distinction

The culture says: if it hurts you, you lost. The traditions say: if it changes you, you were present.

Yielding in the deep sense is not giving up. It is not the absence of resistance. It is the presence of *rooted receptivity* — a willingness to receive what arrives without being destroyed by it, and without the brittle bracing that prevents you from being changed.

Jacob walks with a limp after the Jabbok. This is not evidence that he failed. The limp is the mark of the encounter. It is what happens when you yield with integrity instead of fighting with ego.

The internal arts spend years teaching this. The Torah puts it in a single night at a river. The teaching is the same.`,
  },
  {
    slug: "naase-vnishma",
    title: "Na'aseh V'Nishma: Action Before Understanding",
    subtitle: "The body learns first. The understanding arrives after.",
    category: "Teaching",
    excerpt: "At Sinai the people said we will do, and then we will hear. The sequence is strange unless you have practiced a form for years. The body learns first. The understanding arrives after.",
    date: "February 21",
    readMinutes: 8,
    body: `The moment at Sinai is one of the strangest in the Torah.

Moses descends with the terms of the covenant. The people hear them. And they reply — before deliberating, before committee, before even fully understanding what is being asked — *na'aseh v'nishma*. We will do, and we will hear.

The sequence is backwards. Every rational tradition built since Descartes says: understand first, commit after. Information, then decision. Hearing, then doing. The people reverse it. And the tradition receives this reversal not as rashness but as the most elevated response in the Torah.

Why?

## The body's epistemology

Anyone who has practiced a physical art for years understands this from the inside. The first time you try to do a tai chi form, you do not understand it. You cannot understand it. Understanding is not available at the beginning. What is available is doing.

You do the form. You do it badly. You do it again. You begin to feel something — not understand, feel. A quality of connection between the feet and the center. A way the weight transfers. A moment where the arm is an extension of the root rather than something attached to the shoulder. The feeling arrives before the vocabulary for the feeling exists.

This is not preparation for understanding. This is a different kind of understanding. It is thicker than the propositional kind. It does not debate itself. It does not require defense.

## What the Sages said

The Talmud discusses the moment at Sinai with a reverence that almost never attaches to intellectual propositions. The angels, it says, were amazed. How could the people commit without knowing? The answer given by various teachers is always some version of the same thing: because they recognized, in the asking, something their bodies already knew.

This is not mystical hand-waving. It is a precise claim about the order of knowing. There are commitments the body can make before the mind has caught up, because the body carries a wisdom that the mind will spend years trying to articulate.

## For practice

The instruction this gives us is both simple and difficult: begin. Do not wait until you understand. The understanding you are waiting for is only available through the doing.

Begin the standing practice without knowing what it is for. Begin the parsha study without knowing what it will teach you. Begin the Shabbat without knowing what rest means. The tradition is not asking you to be irrational. It is asking you to trust a sequence it has tested across generations.

*Na'aseh v'nishma.* We will do, and then we will hear. The body first. The understanding, when it comes, will be richer for the waiting.`,
  },
];
