// Seed the announcement site_text keys in Storyblok so they show up in the
// dashboard's /site-content editor for Yonah to edit.
//
// Usage (from the `dashboard/` directory):
//   set -a && . ../.env && set +a && \
//     export STORYBLOK_SPACE_ID=<id> STORYBLOK_MANAGEMENT_TOKEN=<token> STORYBLOK_PREVIEW_TOKEN=<token> && \
//     npx tsx scripts/seed-announcement.ts
//
// Idempotent: re-running won't overwrite values, only ensures the keys exist.
import { upsertSiteText, listSiteText } from '../src/lib/storyblok';

interface SeedKey {
  key: string;
  defaultValue: string;
  description: string;
}

const ANNOUNCEMENT_KEYS: SeedKey[] = [
  {
    key: 'home.announcement.visible',
    defaultValue: 'false',
    description:
      'Show the announcement banner on the home page? Type "true" to publish, "false" to hide.',
  },
  {
    key: 'home.announcement.eyebrow',
    defaultValue: 'Coming up',
    description:
      'Small label above the headline, e.g. "Coming up", "Live this Sunday", "Now booking".',
  },
  {
    key: 'home.announcement.title',
    defaultValue: 'Live class this Sunday',
    description: 'The announcement headline. Keep it short \u2014 one line. (Storyblok requires a value, so use a dash "-" if you ever want it blank.)',
  },
  {
    key: 'home.announcement.body',
    defaultValue: 'A 60-minute introduction to the practice \u2014 open to first-time students.',
    description: 'One or two sentences below the headline.',
  },
  {
    key: 'home.announcement.cta_label',
    defaultValue: '-',
    description: 'Button text, e.g. "Save your seat". Set to "-" to hide the button.',
  },
  {
    key: 'home.announcement.cta_href',
    defaultValue: '-',
    description: 'Where the button links to. Full URL or path like /contact. Ignored if the button is hidden.',
  },
  {
    key: 'home.announcement.date_pill',
    defaultValue: '-',
    description: 'Optional small text on the right, e.g. "Sun \u00b7 7:30pm ET". Set to "-" to hide.',
  },
];

async function main() {
  const existingKeys = new Set(
    (await listSiteText()).map((s) => s.content.key),
  );

  for (const seed of ANNOUNCEMENT_KEYS) {
    if (existingKeys.has(seed.key)) {
      console.log(`exists: ${seed.key}`);
      continue;
    }
    await upsertSiteText(seed.key, seed.defaultValue, seed.description);
    console.log(`created: ${seed.key}`);
  }
  console.log('Done. Edit values in the dashboard at /site-content.');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
