alter table public.daily_operational_notification_runs
  drop constraint if exists daily_operational_notification_runs_notification_type_check;

alter table public.daily_operational_notification_runs
  add constraint daily_operational_notification_runs_notification_type_check
  check (notification_type in (
    'CHAMBERMAID_5PM',
    'PREVENTIVE_MAINTENANCE_9AM',
    'LINEN_VARIANCE_530PM',
    'LINEN_RECONCILIATION_1PM',
    'HK_MORNING_REVIEW_830AM',
    'MT_DAILY_REVIEW_9AM'
  ));
