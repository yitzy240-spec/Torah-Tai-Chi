-- Kie low-balance warning threshold (USD), read by:
--   - the Modal balance pre-flight (src/kie_balance.py) -> kie.balance_low event
--   - /api/kie-balance -> dashboard low-balance banner + sidebar indicator
--   - /api/cron/kie-balance -> daily email when below threshold
-- Lookup order everywhere: this row -> KIE_LOW_BALANCE_USD env -> 20.
-- The row is optional (code defaults to $20 without it); seeding it just
-- makes the knob discoverable. Edit the value to change the threshold
-- without a deploy. ON CONFLICT DO NOTHING keeps an operator-set value.
insert into site_content (key, value, description) values
  ('settings.kie_low_balance_usd', '20',
   'Kie balance (USD) below which the dashboard, daily cron and pipeline warn')
on conflict (key) do nothing;
