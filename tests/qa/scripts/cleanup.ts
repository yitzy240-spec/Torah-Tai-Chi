import { config as loadEnv } from 'dotenv';
import { deleteTestUser } from '../fixtures/auth';
import { wipeSeed } from '../fixtures/seed-data';

loadEnv({ path: '../.env.qa' });

(async () => {
  const email = process.env.QA_TEST_EMAIL;
  try {
    await wipeSeed();
    console.log('[qa] seed data wiped');
  } catch (err) {
    console.error('[qa] wipeSeed failed:', err);
    process.exitCode = 1;
  }
  if (email) {
    try {
      await deleteTestUser(email);
      console.log('[qa] test user deleted');
    } catch (err) {
      console.error('[qa] deleteTestUser failed:', err);
      process.exitCode = 1;
    }
  }
  console.log('[qa] manual cleanup complete');
})();
