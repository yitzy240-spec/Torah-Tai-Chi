create or replace function increment_job_cost(j_id uuid, delta numeric)
returns void language sql as $$
  update jobs set total_cost_usd = coalesce(total_cost_usd, 0) + delta
  where id = j_id;
$$;
