create table if not exists public.staff_meal_orders (
  id uuid primary key default gen_random_uuid(),
  order_week_start date not null,
  order_week_end date not null,
  branch text not null,
  staff_name text not null,
  staff_name_normalized text not null,
  meals jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_name text,
  updated_by_email text,
  constraint staff_meal_orders_branch_check check (branch in ('Crown', 'Leisure', 'View', 'Express')),
  constraint staff_meal_orders_unique_staff_week unique (order_week_start, branch, staff_name_normalized)
);

create index if not exists staff_meal_orders_week_branch_idx
  on public.staff_meal_orders (order_week_start desc, branch, staff_name_normalized);

create or replace function public.cleanup_staff_meal_orders()
returns void
language sql
as $$
  delete from public.staff_meal_orders
  where order_week_end < (current_date - interval '14 days');
$$;

create table if not exists public.staff_meal_weekly_menus (
  id uuid primary key default gen_random_uuid(),
  set_name text not null,
  day_index integer not null,
  menu_text text not null default '',
  lunch_menu text not null default '',
  dinner_menu text not null default '',
  updated_at timestamptz not null default now(),
  updated_by_name text,
  updated_by_email text,
  constraint staff_meal_weekly_menus_set_check check (set_name in ('A', 'B')),
  constraint staff_meal_weekly_menus_day_check check (day_index between 0 and 6),
  constraint staff_meal_weekly_menus_unique_day unique (set_name, day_index)
);

create index if not exists staff_meal_weekly_menus_set_day_idx
  on public.staff_meal_weekly_menus (set_name, day_index);

alter table public.staff_meal_weekly_menus
  add column if not exists menu_text text not null default '';

update public.staff_meal_weekly_menus
set menu_text = trim(coalesce(nullif(menu_text, ''), nullif(lunch_menu, ''), nullif(dinner_menu, ''), ''))
where menu_text = ''
  and (coalesce(lunch_menu, '') <> '' or coalesce(dinner_menu, '') <> '');
