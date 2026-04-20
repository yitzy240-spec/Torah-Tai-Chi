import { config as loadEnv } from 'dotenv';
import { deleteTestUser } from './fixtures/auth';
import { wipeSeed } from './fixtures/seed-data';

loadEnv({ path: '.env.qa' });

export default async function globalTeardown() {
  const email = process.env.QA_TEST_EMAIL;
  if (!email) {
    console.warn('[qa] teardown: QA_TEST_EMAIL missing, skipping user delete');
  }
  try {
    console.log('[qa] wiping seed data');
    await wipeSeed();
  } catch (err) {
    console.error('[qa] wipeSeed failed:', err);
  }
  if (email) {
    try {
      console.log('[qa] deleting test user', email);
      await deleteTestUser(email);
    } catch (err) {
      console.error('[qa] deleteTestUser failed:', err);
    }
  }
  console.log('[qa] teardown complete');
}
