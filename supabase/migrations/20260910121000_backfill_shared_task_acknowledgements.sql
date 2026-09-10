with first_acknowledgement as (
  select distinct on (recipient.task_id)
    recipient.task_id,
    recipient.acknowledged_at,
    recipient.acknowledged_name,
    recipient.acknowledged_email
  from public.task_alert_recipients recipient
  join public.tasks task
    on task.id = recipient.task_id
   and task.alert_cycle = recipient.alert_cycle
  where recipient.acknowledged_at is not null
  order by recipient.task_id, recipient.acknowledged_at asc
)
update public.tasks task
set alert_acknowledged_at = acknowledgement.acknowledged_at,
    alert_acknowledged_by_name = acknowledgement.acknowledged_name,
    alert_acknowledged_by_email = acknowledgement.acknowledged_email
from first_acknowledgement acknowledgement
where task.id = acknowledgement.task_id
  and task.alert_acknowledged_at is null;
