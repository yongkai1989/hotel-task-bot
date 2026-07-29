'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type PermissionValue = boolean | string | number | null | undefined;

type Profile = {
  role?: string;
  can_access_management_tasks?: PermissionValue;
  permissions?: Record<string, PermissionValue>;
};

type ChecklistRow = {
  source_type: string;
  template_id: string;
  title: string;
  rule_id: string | null;
  owner_name: string;
  owner_email: string | null;
  due_time: string | null;
  active_days: number[];
  submitted_by_name: string | null;
  submitted_by_email: string | null;
  submitted_at: string | null;
  updated_at: string | null;
  status: 'SUBMITTED' | 'MISSING' | 'OVERDUE';
};

type ProjectRow = {
  run_id: string;
  title: string;
  run_start_date: string;
  due_date: string;
  status: 'OPEN' | 'DONE' | 'OVERDUE';
  total_rooms: number;
  done_rooms: number;
  progress_percent: number;
  rooms_done_on_date: number;
  moving_today: boolean;
  pending_rooms: string[];
  updated_at: string;
};

type LinenItem = {
  key: string;
  label: string;
  maid_use: number;
  pa_use: number;
  total_use: number;
  in_bill: number;
  previous_in_bill: number;
  returned: number;
  previous_bill_minus_return: number;
  bill_minus_total_use: number;
};

type Summary = {
  report_date: string;
  generated_at: string;
  checklists: ChecklistRow[];
  special_projects: ProjectRow[];
  rooms: {
    linen_rooms_expected: number;
    linen_rooms_saved: number;
    linen_rooms_missing: string[];
    open_manager_room_checks: number;
    open_manager_rooms: string[];
  };
  linen: {
    bill_saved_rows: number;
    bill_expected_rows: number;
    bill_saved: boolean;
    previous_bill_service_date: string;
    return_service_date: string;
    return_saved_rows: number;
    return_expected_rows: number;
    return_saved: boolean;
    items: LinenItem[];
  };
};

type RuleDraft = {
  row: ChecklistRow;
  ownerName: string;
  ownerEmail: string;
  dueTime: string;
  activeDays: number[];
};

const SOURCE_META: Record<string, { label: string; href: string }> = {
  DAILY_FORM: { label: 'Daily Report', href: '/dashboard/daily-forms' },
  FO_CHECKLIST: { label: 'FO Checklist', href: '/dashboard/fo-checklist' },
  SUPERVISOR_CHECKLIST: { label: 'Supervisor Checklist', href: '/dashboard/supervisor-checklist' },
  PA_CHECKLIST: { label: 'PA Checklist', href: '/dashboard/pa-checklist' },
  FNB_CHECKLIST: { label: 'F&B Checklist', href: '/dashboard/fnb-checklist' },
};

const DAY_OPTIONS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

function singaporeOperationsDate() {
  const now = new Date();
  const singaporeHour = Number(new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore', hour: '2-digit', hourCycle: 'h23',
  }).format(now));
  const operationalDate = new Date(now.getTime() - (singaporeHour < 12 ? 86_400_000 : 0));
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(operationalDate);
}

function enabled(value: unknown) {
  return value === true || value === 1 || ['true', '1', 'yes'].includes(String(value || '').toLowerCase());
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-SG', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Singapore',
  }).format(new Date(`${value.slice(0, 10)}T00:00:00+08:00`));
}

function formatTime(value?: string | null) {
  if (!value) return 'No deadline set';
  if (value.includes('T')) {
    return new Intl.DateTimeFormat('en-SG', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Singapore',
    }).format(new Date(value));
  }
  const [hour, minute] = value.split(':').map(Number);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${String(hour % 12 || 12).padStart(2, '0')}:${String(minute || 0).padStart(2, '0')} ${suffix}`;
}

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function sourceMeta(source: string) {
  return SOURCE_META[source] || { label: source.replaceAll('_', ' '), href: '/dashboard' };
}

export default function DailyOperationsSummaryPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [reportDate, setReportDate] = useState(singaporeOperationsDate());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null);
  const [savingRule, setSavingRule] = useState(false);

  const role = String(profile?.role || '').trim().toUpperCase();
  const isSuperuser = role === 'SUPERUSER';
  const hasAccess = isSuperuser || role === 'MANAGER' || enabled(profile?.can_access_management_tasks) || enabled(profile?.permissions?.can_access_management_tasks);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error('Your dashboard session has expired.');
        const response = await fetch('/api/session-profile', {
          cache: 'no-store',
          credentials: 'include',
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const payload = await response.json();
        if (!response.ok || !payload?.user) throw new Error(payload?.error || 'Unable to verify access.');
        if (active) setProfile(payload.user as Profile);
      } catch (nextError: any) {
        if (active) setError(nextError?.message || 'Unable to verify access.');
      } finally {
        if (active) setAuthLoading(false);
      }
    })();
    return () => { active = false; };
  }, [supabase]);

  const loadSummary = useCallback(async () => {
    if (!hasAccess) return;
    setLoading(true);
    setError('');
    const { data, error: summaryError } = await supabase.rpc('get_daily_operations_summary', {
      p_report_date: reportDate,
    });
    if (summaryError) setError(summaryError.message);
    else setSummary(data as Summary);
    setLoading(false);
  }, [hasAccess, reportDate, supabase]);

  useEffect(() => { if (!authLoading && hasAccess) void loadSummary(); }, [authLoading, hasAccess, loadSummary]);

  const checklistRows = summary?.checklists || [];
  const missingRows = checklistRows.filter((row) => row.status !== 'SUBMITTED');
  const submittedRows = checklistRows.filter((row) => row.status === 'SUBMITTED');
  const projects = summary?.special_projects || [];
  const stalledProjects = projects.filter((project) => project.status !== 'DONE' && !project.moving_today);
  const projectExceptions = projects.filter((project) => project.status === 'OVERDUE' || !project.moving_today);
  const missingRooms = summary?.rooms?.linen_rooms_missing || [];
  const attentionCount = missingRows.length + missingRooms.length
    + (summary && !summary.linen.bill_saved ? 1 : 0)
    + (summary && !summary.linen.return_saved ? 1 : 0)
    + (summary?.rooms?.open_manager_room_checks ? 1 : 0)
    + projectExceptions.length;
  const completionPercent = checklistRows.length ? Math.round(submittedRows.length * 100 / checklistRows.length) : 100;

  function editRule(row: ChecklistRow) {
    setRuleDraft({
      row,
      ownerName: row.owner_name || '',
      ownerEmail: row.owner_email || '',
      dueTime: row.due_time?.slice(0, 5) || '',
      activeDays: row.active_days?.length ? row.active_days : [1,2,3,4,5,6,7],
    });
  }

  async function saveRule() {
    if (!ruleDraft || !ruleDraft.activeDays.length) return setError('Select at least one active day.');
    setSavingRule(true);
    setError('');
    const { error: saveError } = await supabase.rpc('upsert_daily_operations_reporting_rule', {
      p_source_type: ruleDraft.row.source_type,
      p_template_id: ruleDraft.row.template_id,
      p_owner_name: ruleDraft.ownerName,
      p_owner_email: ruleDraft.ownerEmail,
      p_due_time: ruleDraft.dueTime || null,
      p_active_days: ruleDraft.activeDays,
    });
    if (saveError) setError(saveError.message);
    else {
      setRuleDraft(null);
      await loadSummary();
    }
    setSavingRule(false);
  }

  async function resetRule() {
    if (!ruleDraft) return;
    const confirmed = window.confirm(
      `Reset the reporting rule for "${ruleDraft.row.title}" to its default settings?`
    );
    if (!confirmed) return;

    setSavingRule(true);
    setError('');
    const { error: resetError } = await supabase.rpc('reset_daily_operations_reporting_rule', {
      p_source_type: ruleDraft.row.source_type,
      p_template_id: ruleDraft.row.template_id,
    });
    if (resetError) {
      setError(resetError.message);
    } else {
      setRuleDraft(null);
      await loadSummary();
    }
    setSavingRule(false);
  }

  if (authLoading) return <main className="ops-page"><div className="state-card">Checking summary access...</div><Styles /></main>;
  if (error && !profile) return <main className="ops-page"><div className="state-card"><h1>Unable to load summary</h1><p>{error}</p></div><Styles /></main>;
  if (!hasAccess) return <main className="ops-page"><div className="state-card"><h1>Access denied</h1><p>Management access is required.</p><Link href="/dashboard">Back to Dashboard</Link></div><Styles /></main>;

  return (
    <main className="ops-page">
      <header className="ops-header">
        <div><span className="eyebrow">MANAGEMENT CONTROL CENTRE</span><h1>Daily Operations Summary</h1><p>Exceptions first. Green means no follow-up is needed.</p></div>
        <div className="header-controls"><label>Report date<input type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} /></label><button onClick={() => void loadSummary()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button><Link href="/dashboard">Dashboard</Link></div>
      </header>

      {error ? <div className="notice">{error}</div> : null}

      <section className="score-grid">
        <article className={attentionCount ? 'score danger' : 'score good'}><span>Needs attention</span><strong>{attentionCount}</strong><small>{attentionCount ? 'Items requiring follow-up' : 'No exceptions detected'}</small></article>
        <article className={completionPercent === 100 ? 'score good' : 'score warn'}><span>Reports & checklists</span><strong>{completionPercent}%</strong><small>{submittedRows.length} of {checklistRows.length} submitted</small></article>
        <article className={projects.some((row) => row.status === 'OVERDUE') ? 'score danger' : stalledProjects.length ? 'score warn' : 'score good'}><span>Special projects</span><strong>{projects.filter((row) => row.status !== 'DONE').length}</strong><small>{projects.filter((row) => row.moving_today).length} moving today - {stalledProjects.length} unchanged</small></article>
      </section>

      <section className="panel">
        <div className="panel-title"><div><span className="eyebrow">ACCOUNTABILITY</span><h2>Reports and checklists</h2></div><span>{submittedRows.length}/{checklistRows.length} submitted</span></div>
        <div className="table-wrap"><table><thead><tr><th>Status</th><th>Report / Checklist</th><th>Expected owner</th><th>Deadline</th><th>Submitted by</th>{isSuperuser ? <th>Rule</th> : null}</tr></thead><tbody>
          {checklistRows.map((row) => <tr key={`${row.source_type}-${row.template_id}-${row.owner_email || 'shared'}`}><td><span className={`status ${row.status.toLowerCase()}`}>{row.status}</span></td><td><Link href={sourceMeta(row.source_type).href}><b>{sourceMeta(row.source_type).label}</b><small>{row.title}</small></Link></td><td><b>{row.owner_name}</b><small>{row.owner_email || 'Owner inferred from history'}</small></td><td>{formatTime(row.due_time)}</td><td>{row.submitted_at ? <><b>{row.submitted_by_name || row.submitted_by_email || 'Unknown'}</b><small>{formatTime(row.updated_at || row.submitted_at)}</small></> : <span className="muted">No submission</span>}</td>{isSuperuser ? <td><button className="text-button" onClick={() => editRule(row)}>Edit</button></td> : null}</tr>)}
        </tbody></table></div>
      </section>

      <section className="two-column">
        <section className="panel">
          <div className="panel-title"><div><span className="eyebrow">MOVEMENT</span><h2>Special projects</h2></div><Link href="/dashboard/hk-special-project">Open projects</Link></div>
          <div className="project-list">{projects.length ? projects.map((project) => <article className="project" key={project.run_id}><div className="project-top"><div><strong>{project.title}</strong><span>Due {formatDate(project.due_date)}</span></div><em className={project.status.toLowerCase()}>{project.status}</em></div><div className="progress"><i style={{ width: `${Math.min(100, Math.max(0, project.progress_percent))}%` }} /></div><div className="project-meta"><b>{project.progress_percent}% - {project.done_rooms}/{project.total_rooms} rooms</b><span className={project.moving_today ? 'moving' : 'stalled'}>{project.moving_today ? `+${project.rooms_done_on_date} room(s) today` : 'No movement today'}</span></div>{project.pending_rooms.length ? <small>Pending: {project.pending_rooms.slice(0, 12).join(', ')}{project.pending_rooms.length > 12 ? ` +${project.pending_rooms.length - 12} more` : ''}</small> : null}</article>) : <div className="empty">No active special projects.</div>}</div>
        </section>

        <section className="panel">
          <div className="panel-title"><div><span className="eyebrow">ROOM CONTROL</span><h2>Rooms and saves</h2></div></div>
          <div className="room-cards"><Link href="/dashboard/laundry-count" className={missingRooms.length ? 'room-card warn' : 'room-card good'}><span>Linen rooms saved</span><strong>{summary?.rooms?.linen_rooms_saved || 0}/{summary?.rooms?.linen_rooms_expected || 0}</strong><small>{missingRooms.length ? `Missing: ${missingRooms.join(', ')}` : 'All pending rooms saved'}</small></Link><Link href="/dashboard/hk-manager-room-check" className={summary?.rooms?.open_manager_room_checks ? 'room-card warn' : 'room-card good'}><span>Open manager room checks</span><strong>{summary?.rooms?.open_manager_room_checks || 0}</strong><small>{summary?.rooms?.open_manager_rooms?.length ? `Rooms: ${summary.rooms.open_manager_rooms.join(', ')}` : 'No open room checks'}</small></Link><Link href="/dashboard/laundry-count" className={summary?.linen?.bill_saved ? 'room-card good' : 'room-card warn'}><span>In Bill saved</span><strong>{summary?.linen?.bill_saved_rows || 0}/{summary?.linen?.bill_expected_rows || 8}</strong><small>Expected floor records</small></Link><Link href="/dashboard/laundry-count" className={summary?.linen?.return_saved ? 'room-card good' : 'room-card warn'}><span>Return saved</span><strong>{summary?.linen?.return_saved_rows || 0}/{summary?.linen?.return_expected_rows || 2}</strong><small>For {formatDate(summary?.linen?.return_service_date)}</small></Link></div>
        </section>
      </section>

      <section className="panel">
        <div className="panel-title"><div><span className="eyebrow">LINEN RECONCILIATION</span><h2>Use, bill and return</h2><p>Each comparison now uses records from the correct service date.</p></div><Link href="/dashboard/laundry-count">Open Linen Count</Link></div>
        <div className="reconciliation-grid">
          <section className="reconciliation-card">
            <div className="reconciliation-heading"><div><strong>Today&apos;s use vs today&apos;s In Bill</strong><span>{formatDate(summary?.report_date)}</span></div><small>Positive means In Bill is higher than total use.</small></div>
            <div className="table-wrap"><table className="linen-table"><thead><tr><th>Linen</th><th>Maid use</th><th>PA use</th><th>Total use</th><th>Today In Bill</th><th>Difference</th></tr></thead><tbody>{(summary?.linen?.items || []).map((item) => <tr key={item.key}><td><b>{item.label}</b></td><td>{item.maid_use}</td><td>{item.pa_use}</td><td>{item.total_use}</td><td>{item.in_bill}</td><td><Diff value={item.bill_minus_total_use} /></td></tr>)}</tbody></table></div>
          </section>
          <section className="reconciliation-card return-card">
            <div className="reconciliation-heading"><div><strong>Today&apos;s Return vs yesterday&apos;s In Bill</strong><span>Bill date: {formatDate(summary?.linen?.previous_bill_service_date)} - returned today for that bill</span></div><small>Positive means yesterday&apos;s bill quantity is still higher than today&apos;s return.</small></div>
            <div className="table-wrap"><table className="linen-table"><thead><tr><th>Linen</th><th>Yesterday In Bill</th><th>Today Return</th><th>Difference</th></tr></thead><tbody>{(summary?.linen?.items || []).map((item) => <tr key={item.key}><td><b>{item.label}</b></td><td>{item.previous_in_bill}</td><td>{item.returned}</td><td><Diff value={item.previous_bill_minus_return} /></td></tr>)}</tbody></table></div>
          </section>
        </div>
      </section>

      {summary ? <p className="generated">Generated {new Date(summary.generated_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}. Refreshes only when you open the page, change date, or press Refresh.</p> : null}

      {ruleDraft ? <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setRuleDraft(null)}><section className="modal" role="dialog" aria-modal="true"><span className="eyebrow">SUPERUSER RULE</span><h2>{ruleDraft.row.title}</h2><p>{ruleDraft.row.source_type === 'SUPERVISOR_CHECKLIST' ? 'Only supervisors scheduled as WORK are expected. The housekeeping schedule decides the required days; this rule only controls the shared deadline.' : 'Set who is expected, the deadline, and which days this submission is required.'}</p>{ruleDraft.row.source_type !== 'SUPERVISOR_CHECKLIST' ? <><label>Responsible name<input value={ruleDraft.ownerName} onChange={(event) => setRuleDraft({ ...ruleDraft, ownerName: event.target.value })} /></label><label>Responsible email<input type="email" value={ruleDraft.ownerEmail} onChange={(event) => setRuleDraft({ ...ruleDraft, ownerEmail: event.target.value })} /></label></> : null}<label>Deadline<input type="time" value={ruleDraft.dueTime} onChange={(event) => setRuleDraft({ ...ruleDraft, dueTime: event.target.value })} /></label>{ruleDraft.row.source_type !== 'SUPERVISOR_CHECKLIST' ? <div className="day-grid">{DAY_OPTIONS.map((day) => <label key={day.value}><input type="checkbox" checked={ruleDraft.activeDays.includes(day.value)} onChange={(event) => setRuleDraft({ ...ruleDraft, activeDays: event.target.checked ? [...ruleDraft.activeDays, day.value].sort() : ruleDraft.activeDays.filter((value) => value !== day.value) })} />{day.label}</label>)}</div> : null}<div className="modal-actions"><button className="reset-rule" onClick={() => void resetRule()} disabled={savingRule || !ruleDraft.row.rule_id}>Reset Rule</button><button className="secondary" onClick={() => setRuleDraft(null)}>Cancel</button><button onClick={() => void saveRule()} disabled={savingRule}>{savingRule ? 'Saving...' : 'Save Rule'}</button></div></section></div> : null}
      <Styles />
    </main>
  );
}

function Diff({ value }: { value: number }) {
  return <span className={value === 0 ? 'diff zero' : value > 0 ? 'diff positive' : 'diff negative'}>{signed(value)}</span>;
}

function Styles() {
  return <style jsx global>{`
    *{box-sizing:border-box}body{margin:0;background:#f2f5f9;color:#132238;font-family:Inter,system-ui,sans-serif}.ops-page{min-height:100vh;padding:24px}.ops-header,.panel,.score,.state-card{border:1px solid #dbe3ed;border-radius:12px;background:#fff;box-shadow:0 10px 28px rgba(27,48,78,.06)}.ops-header{max-width:1500px;margin:0 auto 14px;padding:22px;display:flex;justify-content:space-between;align-items:center;gap:20px}.ops-header h1{margin:3px 0;font-size:29px}.ops-header p,.panel-title p{margin:0;color:#697a91;font-size:13px}.eyebrow{font-size:10px;font-weight:900;letter-spacing:.12em;color:#2764d8}.header-controls{display:flex;align-items:end;gap:9px}.header-controls label,.modal label{display:grid;gap:5px;font-size:11px;font-weight:800;color:#53657c}.header-controls input,.modal input{min-height:40px;border:1px solid #cbd6e3;border-radius:8px;padding:8px 10px;background:#fff}.header-controls button,.header-controls a,.modal button{min-height:40px;border:1px solid #1f5ed0;border-radius:8px;padding:9px 14px;background:#1f5ed0;color:#fff;text-decoration:none;font-weight:800;cursor:pointer}.header-controls a{border-color:#ccd7e4;background:#fff;color:#23344d}.notice{max-width:1500px;margin:0 auto 12px;padding:12px 15px;border:1px solid #f0b8b3;border-radius:9px;background:#fff4f3;color:#a62b23;font-weight:700}.score-grid{max-width:1500px;margin:0 auto 14px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.score{padding:17px;border-top:4px solid #8ca2bb;display:grid;gap:3px}.score.good{border-top-color:#17a566}.score.warn{border-top-color:#e8a11b}.score.danger{border-top-color:#d74338}.score span{font-size:11px;text-transform:uppercase;font-weight:900;color:#64758b}.score strong{font-size:29px}.score small{color:#718298}.panel{max-width:1500px;margin:0 auto 14px;padding:18px}.panel-title{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:13px}.panel-title h2{margin:3px 0 0;font-size:20px}.panel-title>a{font-size:12px;font-weight:800;color:#1f5ed0}.panel-title>span{font-size:12px;font-weight:800;color:#687a91}.empty{padding:25px;border:1px dashed #9fd4b9;border-radius:9px;text-align:center;color:#147347;background:#f2fcf7}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:12px}th{text-align:left;padding:9px;color:#607189;background:#f6f8fb;border-bottom:1px solid #dce4ee;white-space:nowrap}td{padding:10px 9px;border-bottom:1px solid #e6ebf2;vertical-align:middle}td a,td>span,td>b{display:block}td a{color:inherit;text-decoration:none}td small{display:block;margin-top:2px;color:#74859a}.status{width:max-content;border-radius:999px;padding:5px 8px;font-size:9px;font-weight:900}.status.submitted{background:#e9f9f0;color:#0c7a47}.status.missing{background:#fff3d9;color:#9a5d05}.status.overdue{background:#ffe8e6;color:#b12c24}.muted{color:#8a98aa}.text-button{border:0;background:transparent;color:#1f5ed0;font-weight:800;cursor:pointer}.two-column{max-width:1500px;margin:0 auto;display:grid;grid-template-columns:1.15fr .85fr;gap:14px}.two-column .panel{width:100%}.project-list{display:grid;gap:9px}.project{padding:12px;border:1px solid #dce4ee;border-radius:9px}.project-top,.project-meta{display:flex;justify-content:space-between;gap:12px;align-items:center}.project-top>div{display:grid;gap:2px}.project-top span,.project small{font-size:11px;color:#708198}.project-top em{font-style:normal;font-size:9px;font-weight:900}.project-top em.overdue{color:#bd3127}.project-top em.open{color:#a36108}.project-top em.done{color:#0f7c49}.progress{height:8px;margin:10px 0;border-radius:99px;background:#e5ebf2;overflow:hidden}.progress i{display:block;height:100%;background:linear-gradient(90deg,#1d62d6,#19a66a)}.project-meta{font-size:11px}.moving{color:#0d824c;font-weight:800}.stalled{color:#a76509;font-weight:800}.room-cards{display:grid;grid-template-columns:1fr 1fr;gap:9px}.room-card{padding:13px;border:1px solid #dce4ee;border-left:4px solid #91a4bb;border-radius:9px;color:inherit;text-decoration:none;display:grid;gap:3px}.room-card.good{border-left-color:#18a667;background:#f6fcf9}.room-card.warn{border-left-color:#e4a01e;background:#fffaf1}.room-card span{font-size:10px;font-weight:900;text-transform:uppercase;color:#687a91}.room-card strong{font-size:23px}.room-card small{color:#6d7e93;line-height:1.4}.reconciliation-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.reconciliation-card{min-width:0;border:1px solid #dce4ee;border-radius:10px;overflow:hidden;background:#fff}.reconciliation-card.return-card{border-color:#c9daf3}.reconciliation-heading{padding:13px 14px;border-bottom:1px solid #dce4ee;background:#f7f9fc;display:flex;justify-content:space-between;gap:12px}.return-card .reconciliation-heading{background:#f3f7fd}.reconciliation-heading div{display:grid;gap:3px}.reconciliation-heading strong{font-size:13px}.reconciliation-heading span,.reconciliation-heading small{color:#6d7e93;font-size:10px}.reconciliation-heading small{max-width:240px;text-align:right}.linen-table td:not(:first-child),.linen-table th:not(:first-child){text-align:right}.diff{display:inline-block!important;min-width:34px;padding:4px 6px;border-radius:6px;font-weight:900;text-align:center}.diff.zero{background:#eaf8f0;color:#147448}.diff.positive{background:#ffe8e6;color:#b42f26}.diff.negative{background:#e8f1ff;color:#245bad}.generated{max-width:1500px;margin:0 auto 25px;text-align:right;color:#7d8b9c;font-size:11px}.state-card{max-width:600px;margin:15vh auto;padding:30px;text-align:center}.modal-backdrop{position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:16px;background:rgba(12,25,44,.62)}.modal{width:min(540px,100%);padding:22px;border-radius:12px;background:#fff;box-shadow:0 30px 80px rgba(0,0,0,.3)}.modal h2{margin:4px 0}.modal p{color:#6c7c91;font-size:12px}.modal label{margin-top:10px}.day-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;margin-top:13px}.day-grid label{display:flex;gap:4px;align-items:center;justify-content:center;padding:7px 3px;border:1px solid #d7e0ea;border-radius:7px;font-size:10px}.modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.modal button.secondary{border-color:#ccd7e4;background:#fff;color:#23344d}button:disabled{opacity:.55;cursor:not-allowed}@media(max-width:1100px){.reconciliation-grid{grid-template-columns:1fr}}@media(max-width:980px){.score-grid{grid-template-columns:1fr 1fr}.two-column{grid-template-columns:1fr}.ops-header{align-items:flex-start;display:grid}.header-controls{flex-wrap:wrap}}@media(max-width:620px){.ops-page{padding:9px}.score-grid{grid-template-columns:1fr;gap:7px}.score{padding:12px}.score strong{font-size:24px}.panel{padding:12px}.room-cards{grid-template-columns:1fr}.reconciliation-heading{display:grid}.reconciliation-heading small{text-align:left;max-width:none}.header-controls label{width:100%}.header-controls input{width:100%}.day-grid{grid-template-columns:repeat(4,1fr)}}
    .modal button.reset-rule{margin-right:auto;border-color:#efb4ae;background:#fff4f3;color:#b42318}
  `}</style>;
}
