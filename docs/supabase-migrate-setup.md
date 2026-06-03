# Supabase migration auto-apply — setup steps

**Status:** workflow file written ([.github/workflows/supabase-migrate.yml](.github/workflows/supabase-migrate.yml)), pending one-time secret setup.

## What this does

Every time a `dashboard/supabase/migrations/*.sql` file lands on main, GitHub Actions runs `supabase db push` against production. No more "did I remember to apply the migration?" risk.

## Your one-time setup (~10 min)

### 1. Generate a Supabase personal access token
- https://supabase.com/dashboard/account/tokens
- Name: `github-actions-migrate`
- Copy the token (shown once).

### 2. Find your project ref
- It's in your Supabase project URL: `https://supabase.com/dashboard/project/<PROJECT_REF>/settings/general`.
- For Torah Tai Chi: ref is `jswdfthmegjbhnwbgeca` (visible in the website env file).

### 3. Get your database password
- Supabase dashboard → Project Settings → Database → Database Password.
- Copy/reset as needed. (If you reset, update Vercel + Modal env too — they use it indirectly via the connection pooler.)

### 4. Add 3 secrets to GitHub
Go to: https://github.com/yitzy240-spec/Torah-Tai-Chi/settings/secrets/actions

Add **repository secrets** (not environment secrets):
- `SUPABASE_ACCESS_TOKEN` → the token from step 1
- `SUPABASE_PROJECT_REF` → `jswdfthmegjbhnwbgeca` (or whatever you confirmed in step 2)
- `SUPABASE_DB_PASSWORD` → the password from step 3

### 5. (Optional but recommended) Add a `production` environment with manual approval

Go to: https://github.com/yitzy240-spec/Torah-Tai-Chi/settings/environments

- Create environment named `production`.
- Enable "Required reviewers" → add yourself.
- Now every migration apply will wait for your one-click approval in the Actions tab before running.

The workflow already references `environment: production` so this gate activates automatically once the environment exists.

### 6. Test it

After secrets are set, trigger the workflow manually:
- https://github.com/yitzy240-spec/Torah-Tai-Chi/actions/workflows/supabase-migrate.yml
- Click "Run workflow" → main → Run.
- Should run `supabase db push --dry-run` first (showing 0 pending migrations if all caught up), then no-op the push.

## What this DOES NOT do

- **No auto-rollback.** A bad migration in main will land. To "rollback," create a NEW migration file that reverses the change, merge it, and the workflow applies it forward.
- **No staging environment.** Both `--dry-run` and the real apply hit prod. If you want a staging Supabase project, add another secret + environment + workflow.
- **No migration squashing.** As migrations accumulate, `supabase db push` still walks them all (cheap — it skips already-applied per `supabase_migrations.schema_migrations`).

## What happens if a migration fails mid-flight

Supabase `db push` is transactional per migration file. If a migration errors:
- Schema state is unchanged for THAT file (the transaction rolls back).
- Already-applied migrations from THIS run remain applied.
- The workflow exits non-zero; re-running picks up where it left off.

If a migration applies partially (a multi-statement transaction that errored mid-way) and Supabase fails to roll back: panic, check Supabase logs, manually fix the schema, then re-run.

## Monitoring

- Workflow runs are visible at https://github.com/yitzy240-spec/Torah-Tai-Chi/actions
- Failed runs show in the GitHub repo's "Actions" tab with a red ❌.
- TODO (Phase 5.6 timing): wire failure to Resend email or webhook so we don't need to check the UI.

## Backout

If the workflow misbehaves and we need to disable temporarily:
- Repo Settings → Actions → General → "Disable Actions" (kills ALL workflows).
- Or rename the workflow file to `.yml.disabled` in a PR.

The migrations still need to be applied somehow — fall back to manual:
```bash
cd dashboard
supabase link --project-ref jswdfthmegjbhnwbgeca
supabase db push
```
