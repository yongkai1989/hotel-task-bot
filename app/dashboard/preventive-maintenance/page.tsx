// FULL Preventive Maintenance Page with Recurrence + Telegram

'use client';

import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

const TELEGRAM_CHAT_ID = -1003784764929; // replace

async function sendPMTaskMessage({ title, startDate, dueDate, hasChecklist }) {
  await fetch('/api/pm-telegram', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: r.pm_tasks.title,
    startDate: r.run_start_date,
    dueDate: r.due_date,
    hasChecklist: r.pm_tasks.has_room_checklist
  })
});

export default function Page() {
  const supabase = createBrowserSupabaseClient();
  const [runs, setRuns] = useState([]);

  async function load() {
    await supabase.rpc('run_pm_recurrence');

    const { data } = await supabase
      .from('pm_task_runs')
      .select('*, pm_tasks(title, has_room_checklist)')
      .order('created_at', { ascending: false });

    setRuns(data || []);

    const unsent = (data || []).filter(r => !r.telegram_sent_at);

    for (const r of unsent) {
      await sendPMTaskMessage({
        title: r.pm_tasks.title,
        startDate: r.run_start_date,
        dueDate: r.due_date,
        hasChecklist: r.pm_tasks.has_room_checklist
      });

      await supabase
        .from('pm_task_runs')
        .update({ telegram_sent_at: new Date().toISOString() })
        .eq('id', r.id);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h1>Preventive Maintenance</h1>

      {runs.map(r => (
        <div key={r.id} style={{
          border: '1px solid #ccc',
          padding: 12,
          marginBottom: 10,
          borderRadius: 8
        }}>
          <b>{r.pm_tasks.title}</b><br />
          Status: {r.status}<br />
          Start: {r.run_start_date}<br />
          Due: {r.due_date}
        </div>
      ))}
    </div>
  );
}
