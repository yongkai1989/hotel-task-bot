'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';
import { formatDateDDMMYYYY, formatMonthRangeDDMMYYYY } from '../../../lib/dateDisplay';
import styles from './schedule.module.css';

type Profile = {
  user_id: string;
  email: string;
  name: string;
  role: string;
  can_access_hk_schedule: boolean;
  hk_schedule_view_only: boolean;
};

type Staff = {
  id: string;
  staff_name: string;
  staff_role: StaffRole;
  fixed_off_day: number | null;
  is_active: boolean;
  sort_order: number;
};

type Shift = {
  id: string;
  shift_name: string;
  shift_code: string;
  start_time: string;
  end_time: string;
  color: ShiftColor;
  is_active: boolean;
};

type EntryStatus = 'WORK' | 'AL' | 'UPL' | 'NO_SHOW' | 'MC' | 'OFF';
type ShiftColor = 'BLUE' | 'TEAL' | 'PURPLE' | 'AMBER' | 'PINK' | 'SLATE';
type StaffRole = 'SUPERVISOR' | 'MAID' | 'LINEN_CONTROLLER' | 'PA';

type Entry = {
  id: string;
  staff_id: string;
  schedule_date: string;
  status: EntryStatus;
  shift_id: string | null;
  shift_name_snapshot: string | null;
  shift_code_snapshot: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  is_late: boolean;
  overtime_minutes: number;
  notes: string | null;
  updated_by_name: string;
  updated_at: string;
};

type CellSelection = {
  staff: Staff;
  date: string;
  entry: Entry | null;
};

type ReportRow = {
  staff: Staff;
  workDays: number;
  noShowDays: number;
  lateDays: number;
  overtimeDays: number;
  overtimeMinutes: number;
  alDays: number;
  uplDays: number;
  mcDays: number;
  offDays: number;
};

const STATUS_OPTIONS: Array<{ value: EntryStatus; label: string; short: string }> = [
  { value: 'WORK', label: 'Working shift', short: 'Work' },
  { value: 'AL', label: 'Annual Leave', short: 'AL' },
  { value: 'UPL', label: 'Unpaid Leave', short: 'UPL' },
  { value: 'NO_SHOW', label: 'No Show', short: 'NS' },
  { value: 'MC', label: 'Medical Certificate', short: 'MC' },
  { value: 'OFF', label: 'Off Day', short: 'Off' },
];

const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

const SHIFT_COLORS: ShiftColor[] = ['BLUE', 'TEAL', 'PURPLE', 'AMBER', 'PINK', 'SLATE'];
const STAFF_ROLES: Array<{ value: StaffRole; label: string }> = [
  { value: 'SUPERVISOR', label: 'Supervisor' },
  { value: 'MAID', label: 'Maid' },
  { value: 'LINEN_CONTROLLER', label: 'Linen Controller' },
  { value: 'PA', label: 'P.A.' },
];
const STAFF_ROLE_ORDER: StaffRole[] = ['SUPERVISOR', 'MAID', 'LINEN_CONTROLLER', 'PA'];

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function addMonths(value: string, amount: number) {
  const [year, month] = value.split('-').map(Number);
  return monthKey(new Date(year, month - 1 + amount, 1));
}

function monthBounds(value: string) {
  const [year, month] = value.split('-').map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return { start: dateKey(start), end: dateKey(end), days: end.getDate() };
}

function displayDate(value: string) {
  return formatDateDDMMYYYY(value);
}

function timeText(value: string | null) {
  if (!value) return '';
  const [hour, minute] = value.slice(0, 5).split(':').map(Number);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${pad(minute)} ${suffix}`;
}

function durationText(total: number) {
  if (!total) return '0 min';
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${hours ? `${hours} hr${hours === 1 ? '' : 's'} ` : ''}${minutes ? `${minutes} min` : ''}`.trim();
}

function getSupabaseSafe() {
  if (typeof window === 'undefined') return null;
  try {
    return createBrowserSupabaseClient();
  } catch {
    return null;
  }
}

export default function HousekeepingSchedulePage() {
  const supabase = useMemo(() => getSupabaseSafe(), []);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [tab, setTab] = useState<'SCHEDULE' | 'REPORT'>('SCHEDULE');
  const [month, setMonth] = useState(monthKey());
  const [monthHalf, setMonthHalf] = useState<'FULL' | 'FIRST' | 'SECOND'>('FULL');
  const [reportRange, setReportRange] = useState<'MONTH' | 'SIX_MONTHS'>('MONTH');
  const [misconductOnly, setMisconductOnly] = useState(false);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cell, setCell] = useState<CellSelection | null>(null);
  const [showStaff, setShowStaff] = useState(false);
  const [showShifts, setShowShifts] = useState(false);
  const [bulkStaff, setBulkStaff] = useState<Staff | null>(null);
  const [fitAllStaff, setFitAllStaff] = useState(true);
  const [gridHeight, setGridHeight] = useState(520);
  const [fitRowCorrection, setFitRowCorrection] = useState(0);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);

  const canAccess = !!profile && (
    profile.role.toUpperCase() === 'SUPERUSER' || profile.can_access_hk_schedule
  );
  const canEdit = !!profile && canAccess && !profile.hk_schedule_view_only;

  useEffect(() => {
    let active = true;
    async function loadProfile() {
      try {
        if (!supabase) throw new Error('Supabase is not configured');
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const user = sessionData.session?.user;
        if (!user) throw new Error('Please sign in to continue');
        const { data, error: profileError } = await supabase
          .from('user_profiles')
          .select('user_id,email,name,role,can_access_hk_schedule,hk_schedule_view_only')
          .eq('user_id', user.id)
          .single();
        if (profileError) throw profileError;
        if (active) {
          const row = data as Profile;
          setProfile({
            ...row,
            email: row.email || user.email || '',
            name: row.name || user.email || 'User',
            can_access_hk_schedule:
              String(row.role || '').toUpperCase() === 'SUPERUSER' ||
              row.can_access_hk_schedule === true,
            hk_schedule_view_only: row.hk_schedule_view_only === true,
          });
        }
      } catch (err: any) {
        if (active) setError(err?.message || 'Unable to verify access');
      } finally {
        if (active) setAuthLoading(false);
      }
    }
    void loadProfile();
    return () => { active = false; };
  }, [supabase]);

  const dataBounds = useMemo(() => {
    if (tab === 'REPORT' && reportRange === 'SIX_MONTHS') {
      return { start: `${addMonths(month, -5)}-01`, end: monthBounds(month).end };
    }
    return monthBounds(month);
  }, [month, reportRange, tab]);

  const loadData = useCallback(async () => {
    if (!supabase || !canAccess) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [staffResult, shiftResult, entryResult] = await Promise.all([
        supabase.from('hk_schedule_staff').select('*').order('sort_order').order('staff_name'),
        supabase.from('hk_schedule_shifts').select('*').order('shift_name'),
        supabase
          .from('hk_schedule_entries')
          .select('*')
          .gte('schedule_date', dataBounds.start)
          .lte('schedule_date', dataBounds.end)
          .order('schedule_date'),
      ]);
      if (staffResult.error) throw staffResult.error;
      if (shiftResult.error) throw shiftResult.error;
      if (entryResult.error) throw entryResult.error;
      setStaff((staffResult.data || []) as Staff[]);
      setShifts((shiftResult.data || []) as Shift[]);
      setEntries((entryResult.data || []) as Entry[]);
    } catch (err: any) {
      setError(err?.message || 'Unable to load the schedule');
    } finally {
      setLoading(false);
    }
  }, [canAccess, dataBounds.end, dataBounds.start, supabase]);

  useEffect(() => {
    if (!supabase || !canAccess) return;
    void loadData();
  }, [canAccess, loadData, supabase]);

  const entryMap = useMemo(() => {
    const map = new Map<string, Entry>();
    for (const entry of entries) map.set(`${entry.staff_id}:${entry.schedule_date}`, entry);
    return map;
  }, [entries]);

  const days = useMemo(() => {
    const bounds = monthBounds(month);
    return Array.from({ length: bounds.days }, (_, index) => {
      const value = `${month}-${pad(index + 1)}`;
      const date = new Date(`${value}T00:00:00`);
      return {
        value,
        day: index + 1,
        weekday: new Intl.DateTimeFormat('en-MY', { weekday: 'short' }).format(date).slice(0, 2),
        weekend: date.getDay() === 0 || date.getDay() === 6,
        today: value === dateKey(new Date()),
      };
    }).filter((day) =>
      monthHalf === 'FULL' ||
      (monthHalf === 'FIRST' && day.day <= 15) ||
      (monthHalf === 'SECOND' && day.day >= 16)
    );
  }, [month, monthHalf]);

  const activeStaffCount = useMemo(
    () => staff.filter((person) => person.is_active).length,
    [staff]
  );
  const activeRoleCount = useMemo(
    () => STAFF_ROLES.filter((role) =>
      staff.some((person) => person.is_active && person.staff_role === role.value)
    ).length,
    [staff]
  );
  const calculatedRowHeight = useMemo(() => {
    const tableHeader = 44;
    const roleRows = activeRoleCount * 21;
    const borderAllowance = activeStaffCount + activeRoleCount + 8;
    const available = Math.max(
      activeStaffCount * 14,
      gridHeight - tableHeader - roleRows - borderAllowance
    );
    return Math.max(14, Math.min(58, Math.floor(available / Math.max(activeStaffCount, 1))));
  }, [activeRoleCount, activeStaffCount, gridHeight]);
  const fittedRowHeight = Math.max(12, calculatedRowHeight - fitRowCorrection);

  useEffect(() => {
    if (!fitAllStaff || tab !== 'SCHEDULE' || loading) return;
    const grid = gridRef.current;
    if (!grid) return;
    const updateGridHeight = () => setGridHeight(Math.floor(grid.getBoundingClientRect().height));
    updateGridHeight();
    const observer = new ResizeObserver(updateGridHeight);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [fitAllStaff, loading, tab]);

  useEffect(() => {
    setFitRowCorrection(0);
  }, [activeStaffCount, calculatedRowHeight, monthHalf]);

  useLayoutEffect(() => {
    if (!fitAllStaff || tab !== 'SCHEDULE' || loading || !activeStaffCount) return;
    const frame = window.requestAnimationFrame(() => {
      const grid = gridRef.current;
      const table = tableRef.current;
      if (!grid || !table) return;
      const overflow = Math.ceil(table.scrollHeight - grid.clientHeight);
      if (overflow <= 0) return;
      const reduction = Math.ceil(overflow / activeStaffCount) + 1;
      setFitRowCorrection((current) =>
        Math.min(calculatedRowHeight - 12, current + reduction)
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeStaffCount,
    calculatedRowHeight,
    fitAllStaff,
    fittedRowHeight,
    loading,
    tab,
  ]);

  const reportRows = useMemo<ReportRow[]>(() => {
    return staff.map((person) => {
      const rows = entries.filter((entry) => entry.staff_id === person.id);
      return {
        staff: person,
        workDays: rows.filter((entry) => entry.status === 'WORK').length,
        noShowDays: rows.filter((entry) => entry.status === 'NO_SHOW').length,
        lateDays: rows.filter((entry) => entry.status === 'WORK' && entry.is_late).length,
        overtimeDays: rows.filter((entry) => entry.overtime_minutes > 0).length,
        overtimeMinutes: rows.reduce((sum, entry) => sum + Number(entry.overtime_minutes || 0), 0),
        alDays: rows.filter((entry) => entry.status === 'AL').length,
        uplDays: rows.filter((entry) => entry.status === 'UPL').length,
        mcDays: rows.filter((entry) => entry.status === 'MC').length,
        offDays: rows.filter((entry) => entry.status === 'OFF').length,
      };
    }).filter((row) => !misconductOnly || row.noShowDays > 0 || row.lateDays > 0)
      .sort((a, b) =>
        STAFF_ROLE_ORDER.indexOf(a.staff.staff_role) - STAFF_ROLE_ORDER.indexOf(b.staff.staff_role) ||
        b.noShowDays - a.noShowDays ||
        b.lateDays - a.lateDays ||
        a.staff.staff_name.localeCompare(b.staff.staff_name)
      );
  }, [entries, misconductOnly, staff]);

  const reportTotals = useMemo(() => reportRows.reduce((totals, row) => ({
    noShow: totals.noShow + row.noShowDays,
    lateDays: totals.lateDays + row.lateDays,
    overtimeMinutes: totals.overtimeMinutes + row.overtimeMinutes,
  }), { noShow: 0, lateDays: 0, overtimeMinutes: 0 }), [reportRows]);

  function flash(message: string) {
    setSuccess(message);
    setError('');
    window.setTimeout(() => setSuccess(''), 3500);
  }

  async function autoFillMonth() {
    if (!supabase || !canEdit) return;
    const monthName = formatMonthRangeDDMMYYYY(month, month);
    const confirmed = window.confirm(
      `Auto fill ${monthName} for every active staff member?\n\n` +
      'Existing entries for the month will be overwritten. Fixed off days will be marked Off, and all other days will use the shift matching each staff role.\n\n' +
      'P.A. staff will follow the Night/Noon rotation, use Mid on Friday and Saturday, and use the 12-hour shift when their partner is off.'
    );
    if (!confirmed) return;

    setBusy(true);
    setError('');
    const { data, error: fillError } = await supabase.rpc('autofill_hk_schedule_month', {
      p_month: `${month}-01`,
    });
    setBusy(false);
    if (fillError) {
      setError(fillError.message);
      return;
    }
    flash(`${Number(data || 0)} schedule entries were auto filled for ${monthName}.`);
    await loadData();
  }

  if (authLoading) return <PageState title="Checking access..." />;
  if (!profile || !canAccess) {
    return <PageState title="Housekeeping Schedule" message={error || 'You do not have access to this page.'} />;
  }

  return (
    <main className={`${styles.page} ${tab === 'SCHEDULE' && fitAllStaff ? styles.fitMode : ''}`}>
      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>HOUSEKEEPING WORKFORCE</span>
          <h1>Schedule</h1>
          <p>Plan monthly shifts, record attendance, and review punctuality from one timetable.</p>
        </div>
        {canEdit ? (
          <div className={styles.heroActions}>
            <button className={styles.autoFillButton} disabled={busy || !staff.some((person) => person.is_active)}
              onClick={() => void autoFillMonth()}>
              {busy ? 'Filling...' : '⚡ Auto Fill Month'}
            </button>
            <button className={styles.secondaryButton} onClick={() => setShowStaff(true)}>Staff</button>
            <button className={styles.secondaryButton} onClick={() => setShowShifts(true)}>Shift setup</button>
          </div>
        ) : <span className={styles.viewOnlyBadge}>View only</span>}
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}
      {success ? <div className={styles.success}>{success}</div> : null}

      <section className={styles.toolbar}>
        <div className={styles.tabs}>
          <button className={tab === 'SCHEDULE' ? styles.activeTab : ''} onClick={() => setTab('SCHEDULE')}>
            Schedule
          </button>
          <button className={tab === 'REPORT' ? styles.activeTab : ''} onClick={() => setTab('REPORT')}>
            Report
          </button>
        </div>
        <div className={styles.dateControls}>
          {tab === 'SCHEDULE' ? (
            <div className={styles.halfButtons}>
              <button aria-pressed={monthHalf === 'FIRST'}
                className={monthHalf === 'FIRST' ? styles.selected : ''}
                onClick={() => setMonthHalf((current) => current === 'FIRST' ? 'FULL' : 'FIRST')}>
                First Half
              </button>
              <button aria-pressed={monthHalf === 'SECOND'}
                className={monthHalf === 'SECOND' ? styles.selected : ''}
                onClick={() => setMonthHalf((current) => current === 'SECOND' ? 'FULL' : 'SECOND')}>
                Second Half
              </button>
            </div>
          ) : null}
          <div className={styles.monthControl}>
            <button aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>‹</button>
            <input type="month" value={month} min={addMonths(monthKey(), -6)} max={addMonths(monthKey(), 12)}
              onChange={(event) => setMonth(event.target.value || monthKey())} />
            <button aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>›</button>
          </div>
        </div>
      </section>

      {tab === 'SCHEDULE' ? (
        <>
          <section className={styles.legend}>
            <span><i className={styles.workDot} /> Work shift</span>
            <span><i className={styles.alDot} /> AL</span>
            <span><i className={styles.uplDot} /> UPL</span>
            <span><i className={styles.mcDot} /> MC</span>
            <span><i className={styles.offDot} /> Off</span>
            <span><i className={styles.noShowDot} /> No Show</span>
            <span className={styles.staffCount}>{activeStaffCount} staff</span>
            <small>{canEdit ? 'Tap any date to schedule or update attendance.' : 'View-only schedule. Editing is disabled.'}</small>
            <button
              type="button"
              className={styles.fitToggle}
              aria-pressed={fitAllStaff}
              onClick={() => setFitAllStaff((current) => !current)}
            >
              {fitAllStaff ? 'Roomier rows' : 'Fit all staff'}
            </button>
          </section>

          <section className={styles.scheduleCard}>
            {loading ? <PageState title="Loading timetable..." compact /> : (
              staff.length ? (
                <div
                  ref={gridRef}
                  className={styles.gridWrap}
                  style={{ '--fit-row-height': `${fittedRowHeight}px` } as CSSProperties}
                >
                  <table ref={tableRef} className={styles.scheduleTable}>
                    <thead>
                      <tr>
                        <th className={styles.staffColumn}>Staff member</th>
                        {days.map((day) => (
                          <th key={day.value} className={`${day.weekend ? styles.weekend : ''} ${day.today ? styles.today : ''}`}>
                            <span>{day.weekday}</span>{day.day}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {STAFF_ROLES.flatMap((role) => {
                        const people = staff.filter((person) => person.is_active && person.staff_role === role.value);
                        if (!people.length) return [];
                        return [
                          <tr className={styles.roleDivider} key={`role-${role.value}`}>
                            <th className={styles.staffColumn}>{role.label}</th>
                            <td colSpan={days.length} aria-hidden="true" />
                          </tr>,
                          ...people.map((person) => (
                            <tr key={person.id}>
                              <th className={styles.staffColumn}>
                                <strong>{person.staff_name}</strong>
                                {canEdit ? (
                                  <button onClick={() => setBulkStaff(person)}>
                                    {fitAllStaff ? 'Fill' : 'Fill dates'}
                                  </button>
                                ) : null}
                              </th>
                              {days.map((day) => {
                                const entry = entryMap.get(`${person.id}:${day.value}`) || null;
                                const late = entry?.status === 'WORK' && entry.is_late;
                                return (
                                  <td key={day.value} className={day.weekend ? styles.weekend : ''}>
                                    <button
                                      className={`${styles.dayCell} ${entry ? styles[`status_${entry.status}`] : ''} ${late ? styles.lateDay : ''}`}
                                      title={entry ? cellTitle(entry) : `Schedule ${person.staff_name}`}
                                      disabled={!canEdit}
                                      onClick={() => canEdit && setCell({ staff: person, date: day.value, entry })}
                                    >
                                      <strong>{entryLabel(entry)}</strong>
                                      {late ? <small>LATE</small> : null}
                                      {entry?.overtime_minutes ? <small>OT</small> : null}
                                    </button>
                                  </td>
                                );
                              })}
                            </tr>
                          )),
                        ];
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={styles.empty}>
                  <h2>Add your housekeeping team</h2>
                  <p>Create staff names first, then assign shifts directly in the timetable.</p>
                  {canEdit ? <button className={styles.primaryButton} onClick={() => setShowStaff(true)}>+ Add staff</button> : null}
                </div>
              )
            )}
          </section>
        </>
      ) : (
        <section className={styles.reportArea}>
          <div className={styles.reportControls}>
            <div>
              <strong>Reporting period</strong>
              <div className={styles.segment}>
                <button className={reportRange === 'MONTH' ? styles.selected : ''} onClick={() => setReportRange('MONTH')}>
                  Selected month
                </button>
                <button className={reportRange === 'SIX_MONTHS' ? styles.selected : ''} onClick={() => setReportRange('SIX_MONTHS')}>
                  Last 6 months
                </button>
              </div>
            </div>
            <label className={styles.checkLabel}>
              <input type="checkbox" checked={misconductOnly} onChange={(event) => setMisconductOnly(event.target.checked)} />
              Show misconduct only
            </label>
          </div>

          <div className={styles.summaryGrid}>
            <SummaryCard label="No Show" value={`${reportTotals.noShow} day${reportTotals.noShow === 1 ? '' : 's'}`} tone="red" />
            <SummaryCard label="Late arrivals" value={`${reportTotals.lateDays} day${reportTotals.lateDays === 1 ? '' : 's'}`} tone="amber" />
            <SummaryCard label="Overtime recorded" value={durationText(reportTotals.overtimeMinutes)} tone="blue" />
          </div>

          <div className={styles.reportTableWrap}>
            {loading ? <PageState title="Preparing report..." compact /> : (
              <table className={styles.reportTable}>
                <thead>
                  <tr>
                    <th>Staff</th><th>Work</th><th>No Show</th><th>Late days</th>
                    <th>OT days</th><th>Total OT</th><th>AL</th><th>UPL</th><th>MC</th><th>Off</th>
                  </tr>
                </thead>
                <tbody>
                  {reportRows.map((row) => (
                    <tr key={row.staff.id}>
                      <th>{row.staff.staff_name}<small className={styles.reportRole}>{roleLabel(row.staff.staff_role)}</small></th>
                      <td>{row.workDays}</td>
                      <td className={row.noShowDays ? styles.dangerValue : ''}>{row.noShowDays}</td>
                      <td className={row.lateDays ? styles.warningValue : ''}>{row.lateDays}</td>
                      <td>{row.overtimeDays}</td><td>{durationText(row.overtimeMinutes)}</td>
                      <td>{row.alDays}</td><td>{row.uplDays}</td><td>{row.mcDays}</td><td>{row.offDays}</td>
                    </tr>
                  ))}
                  {!reportRows.length ? <tr><td colSpan={10} className={styles.noRows}>No records in this period.</td></tr> : null}
                </tbody>
              </table>
            )}
          </div>
          <p className={styles.reportNote}>
            Late arrivals are counted by occurrence. Only six months of historical entries are retained.
          </p>
        </section>
      )}

      {cell ? (
        <EntryModal
          selection={cell}
          shifts={shifts}
          busy={busy}
          onClose={() => setCell(null)}
          onSave={async (form) => {
            if (!supabase) return;
            setBusy(true);
            setError('');
            const { error: saveError } = await supabase.rpc('save_hk_schedule_entry', {
              p_staff_id: cell.staff.id,
              p_schedule_date: cell.date,
              p_status: form.status,
              p_shift_id: form.status === 'WORK' && !form.useCustomHours ? form.shiftId : null,
              p_arrival_time: null,
              p_overtime_minutes: form.status === 'WORK' ? form.overtimeMinutes : 0,
              p_notes: form.notes || null,
              p_custom_start: form.status === 'WORK' && form.useCustomHours ? form.customStart : null,
              p_custom_end: form.status === 'WORK' && form.useCustomHours ? form.customEnd : null,
              p_is_late: form.status === 'WORK' && form.isLate,
            });
            setBusy(false);
            if (saveError) return setError(saveError.message);
            setCell(null);
            flash(`${cell.staff.staff_name}'s schedule was saved.`);
            await loadData();
          }}
          onClear={async () => {
            if (!supabase) return;
            setBusy(true);
            const { error: clearError } = await supabase.rpc('delete_hk_schedule_entry', {
              p_staff_id: cell.staff.id,
              p_schedule_date: cell.date,
            });
            setBusy(false);
            if (clearError) return setError(clearError.message);
            setCell(null);
            flash('Schedule entry cleared.');
            await loadData();
          }}
        />
      ) : null}

      {showStaff ? (
        <StaffModal
          staff={staff}
          busy={busy}
          onClose={() => setShowStaff(false)}
          onSave={async (person, name, role, fixedOffDay, active) => {
            if (!supabase) return;
            setBusy(true);
            const { error: saveError } = await supabase.rpc('save_hk_schedule_staff', {
              p_staff_id: person?.id || null,
              p_staff_name: name,
              p_staff_role: role,
              p_fixed_off_day: fixedOffDay,
              p_is_active: active,
            });
            setBusy(false);
            if (saveError) return setError(saveError.message);
            flash(person ? 'Staff record updated.' : 'Staff member added.');
            await loadData();
          }}
          onDelete={async (person) => {
            if (!supabase) return;
            if (!window.confirm(`Delete ${person.staff_name} from the staff list? Existing schedule history will be retained.`)) return;
            setBusy(true);
            const { data, error: deleteError } = await supabase.rpc('delete_hk_schedule_staff', {
              p_staff_id: person.id,
            });
            setBusy(false);
            if (deleteError) return setError(deleteError.message);
            flash(data === 'ARCHIVED' ? 'Staff removed from scheduling. Historical records were retained.' : 'Staff deleted.');
            await loadData();
          }}
        />
      ) : null}

      {showShifts ? (
        <ShiftModal
          shifts={shifts}
          busy={busy}
          onClose={() => setShowShifts(false)}
          onSave={async (shift) => {
            if (!supabase) return;
            setBusy(true);
            const { error: saveError } = await supabase.rpc('save_hk_schedule_shift', {
              p_shift_id: shift.id,
              p_shift_name: shift.name,
              p_shift_code: shift.code,
              p_start_time: shift.start,
              p_end_time: shift.end,
              p_color: shift.color,
              p_is_active: shift.active,
            });
            setBusy(false);
            if (saveError) return setError(saveError.message);
            flash(shift.id ? 'Shift updated.' : 'Shift created.');
            await loadData();
          }}
          onDelete={async (shift) => {
            if (!supabase) return;
            if (!window.confirm(`Delete the ${shift.shift_name} shift? Existing schedule history will be retained.`)) return;
            setBusy(true);
            const { data, error: deleteError } = await supabase.rpc('delete_hk_schedule_shift', {
              p_shift_id: shift.id,
            });
            setBusy(false);
            if (deleteError) return setError(deleteError.message);
            flash(data === 'ARCHIVED' ? 'Shift removed from future scheduling. Historical records were retained.' : 'Shift deleted.');
            await loadData();
          }}
        />
      ) : null}

      {bulkStaff ? (
        <BulkModal
          staff={bulkStaff}
          month={month}
          shifts={shifts}
          busy={busy}
          onClose={() => setBulkStaff(null)}
          onSave={async (form) => {
            if (!supabase) return;
            setBusy(true);
            const { data, error: saveError } = await supabase.rpc('fill_hk_schedule_range', {
              p_staff_id: bulkStaff.id,
              p_start_date: form.start,
              p_end_date: form.end,
              p_weekdays: form.weekdays,
              p_status: form.status,
              p_shift_id: form.status === 'WORK' ? form.shiftId : null,
              p_apply_fixed_off: form.applyFixedOff,
            });
            setBusy(false);
            if (saveError) return setError(saveError.message);
            setBulkStaff(null);
            flash(`${Number(data || 0)} day${Number(data || 0) === 1 ? '' : 's'} scheduled.`);
            await loadData();
          }}
        />
      ) : null}
    </main>
  );
}

function PageState({ title, message, compact = false }: { title: string; message?: string; compact?: boolean }) {
  return <div className={`${styles.pageState} ${compact ? styles.compactState : ''}`}><strong>{title}</strong>{message ? <p>{message}</p> : null}</div>;
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: 'red' | 'amber' | 'blue' }) {
  return <article className={`${styles.summaryCard} ${styles[`summary_${tone}`]}`}><span>{label}</span><strong>{value}</strong></article>;
}

function entryLabel(entry: Entry | null) {
  if (!entry) return '+';
  if (entry.status === 'WORK') return entry.shift_code_snapshot || 'Work';
  return STATUS_OPTIONS.find((item) => item.value === entry.status)?.short || entry.status;
}

function cellTitle(entry: Entry) {
  if (entry.status !== 'WORK') return STATUS_OPTIONS.find((item) => item.value === entry.status)?.label || entry.status;
  return [
    entry.shift_name_snapshot,
    `${timeText(entry.scheduled_start)} – ${timeText(entry.scheduled_end)}`,
    entry.is_late ? 'Late' : 'On time',
    entry.overtime_minutes ? `OT ${durationText(entry.overtime_minutes)}` : '',
  ].filter(Boolean).join(' · ');
}

function roleLabel(role: StaffRole) {
  return STAFF_ROLES.find((item) => item.value === role)?.label || role;
}

function weekdayLabel(day: number | null) {
  if (!day) return 'No fixed off day';
  return WEEKDAYS.find((item) => item.value === day)?.label || 'No fixed off day';
}

function ModalShell({ title, subtitle, children, onClose }: {
  title: string; subtitle?: string; children: ReactNode; onClose: () => void;
}) {
  return (
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label={title}>
        <header><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div><button onClick={onClose} aria-label="Close">×</button></header>
        {children}
      </section>
    </div>
  );
}

function EntryModal({ selection, shifts, busy, onClose, onSave, onClear }: {
  selection: CellSelection;
  shifts: Shift[];
  busy: boolean;
  onClose: () => void;
  onSave: (form: {
    status: EntryStatus;
    shiftId: string;
    useCustomHours: boolean;
    customStart: string;
    customEnd: string;
    isLate: boolean;
    overtimeMinutes: number;
    notes: string;
  }) => void;
  onClear: () => void;
}) {
  const activeShifts = shifts.filter((shift) => shift.is_active || shift.id === selection.entry?.shift_id);
  const existingCustomHours = selection.entry?.status === 'WORK' && !selection.entry.shift_id;
  const [status, setStatus] = useState<EntryStatus>(selection.entry?.status || 'WORK');
  const [shiftId, setShiftId] = useState(selection.entry?.shift_id || activeShifts[0]?.id || '');
  const [useCustomHours, setUseCustomHours] = useState(existingCustomHours);
  const [customStart, setCustomStart] = useState(selection.entry?.scheduled_start?.slice(0, 5) || '08:30');
  const [customEnd, setCustomEnd] = useState(selection.entry?.scheduled_end?.slice(0, 5) || '17:00');
  const [isLate, setIsLate] = useState(selection.entry?.is_late === true);
  const [overtime, setOvertime] = useState(String(selection.entry?.overtime_minutes || ''));
  const [notes, setNotes] = useState(selection.entry?.notes || '');

  return (
    <ModalShell title={selection.staff.staff_name} subtitle={displayDate(selection.date)} onClose={onClose}>
      <div className={styles.modalBody}>
        <label>Work status</label>
        <div className={styles.statusPicker}>
          {STATUS_OPTIONS.map((option) => (
            <button key={option.value} className={`${styles[`status_${option.value}`]} ${status === option.value ? styles.statusSelected : ''}`}
              onClick={() => setStatus(option.value)}>{option.short}<small>{option.label}</small></button>
          ))}
        </div>
        {status === 'WORK' ? (
          <>
            <label>Scheduled shift</label>
            <div className={styles.scheduleMode}>
              <button className={!useCustomHours ? styles.selected : ''} onClick={() => setUseCustomHours(false)}>Saved shift</button>
              <button className={useCustomHours ? styles.selected : ''} onClick={() => setUseCustomHours(true)}>Ad hoc hours</button>
            </div>
            {useCustomHours ? (
              <div className={styles.customHours}>
                <div><label>Starts</label><input type="time" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></div>
                <span>to</span>
                <div><label>Ends</label><input type="time" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></div>
              </div>
            ) : (
              <select value={shiftId} onChange={(event) => setShiftId(event.target.value)}>
                <option value="">Choose shift</option>
                {activeShifts.map((shift) => (
                  <option key={shift.id} value={shift.id}>{shift.shift_name} ({timeText(shift.start_time)} – {timeText(shift.end_time)})</option>
                ))}
              </select>
            )}
            <div className={styles.entryWorkDetails}>
              <div><label>Attendance</label>
                <div className={styles.attendanceToggle}>
                  <button type="button" className={`${styles.attendanceChoice} ${!isLate ? styles.onTimeSelected : ''}`}
                    aria-pressed={!isLate} onClick={() => setIsLate(false)}>
                    <span className={styles.attendanceIcon}>✓</span>
                    <span><strong>On time</strong><small>Thumbprint verified</small></span>
                  </button>
                  <button type="button" className={`${styles.attendanceChoice} ${isLate ? styles.lateSelected : ''}`}
                    aria-pressed={isLate} onClick={() => setIsLate(true)}>
                    <span className={styles.attendanceIcon}>!</span>
                    <span><strong>Late</strong><small>Count as one late arrival</small></span>
                  </button>
                </div>
              </div>
              <div><label>Overtime (minutes)</label><input type="number" min="0" max="1440" step="15" value={overtime}
                placeholder="0" onChange={(event) => setOvertime(event.target.value)} /></div>
            </div>
          </>
        ) : null}
        <label>Notes (optional)</label>
        <textarea rows={2} value={notes} maxLength={500} placeholder="Add any useful attendance note"
          onChange={(event) => setNotes(event.target.value)} />
      </div>
      <footer className={styles.modalFooter}>
        {selection.entry ? <button className={styles.dangerButton} disabled={busy} onClick={onClear}>Clear</button> : <span />}
        <div><button className={styles.secondaryButton} onClick={onClose}>Cancel</button>
          <button className={styles.primaryButton} disabled={busy || (
            status === 'WORK' && (useCustomHours ? (!customStart || !customEnd) : !shiftId)
            )}
            onClick={() => onSave({
              status, shiftId, useCustomHours, customStart, customEnd,
              isLate, overtimeMinutes: Number(overtime || 0), notes,
            })}>
            {busy ? 'Saving...' : 'Save'}
          </button></div>
      </footer>
    </ModalShell>
  );
}

function StaffModal({ staff, busy, onClose, onSave, onDelete }: {
  staff: Staff[]; busy: boolean; onClose: () => void;
  onSave: (person: Staff | null, name: string, role: StaffRole, fixedOffDay: number | null, active: boolean) => void;
  onDelete: (person: Staff) => void;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<StaffRole>('MAID');
  const [fixedOffDay, setFixedOffDay] = useState('');
  return (
    <ModalShell title="Housekeeping staff" subtitle="Add staff or hide former staff without losing records." onClose={onClose}>
      <div className={styles.modalBody}>
        <div className={styles.staffAddForm}>
          <input value={name} maxLength={100} placeholder="Staff full name" onChange={(event) => setName(event.target.value)} />
          <select value={role} onChange={(event) => setRole(event.target.value as StaffRole)}>
            {STAFF_ROLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <select value={fixedOffDay} onChange={(event) => setFixedOffDay(event.target.value)}>
            <option value="">No fixed off day</option>
            {WEEKDAYS.map((day) => <option key={day.value} value={day.value}>Off every {day.label}</option>)}
          </select>
          <button className={styles.primaryButton} disabled={busy || !name.trim()} onClick={() => {
            onSave(null, name.trim(), role, fixedOffDay ? Number(fixedOffDay) : null, true); setName('');
          }}>+ Add staff</button>
        </div>
        <div className={styles.manageList}>
          {staff.map((person) => (
            <div key={person.id}><span><strong>{person.staff_name}</strong><small>{roleLabel(person.staff_role)} · {weekdayLabel(person.fixed_off_day)} · {person.is_active ? 'Shown in timetable' : 'Hidden from timetable'}</small></span>
              <div>
                <select className={styles.roleSelect} value={person.staff_role} disabled={busy}
                  onChange={(event) => onSave(person, person.staff_name, event.target.value as StaffRole, person.fixed_off_day, person.is_active)}>
                  {STAFF_ROLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
                <select className={styles.roleSelect} value={person.fixed_off_day || ''} disabled={busy}
                  onChange={(event) => onSave(person, person.staff_name, person.staff_role, event.target.value ? Number(event.target.value) : null, person.is_active)}>
                  <option value="">No fixed off</option>
                  {WEEKDAYS.map((day) => <option key={day.value} value={day.value}>Off: {day.label}</option>)}
                </select>
                {!person.is_active ? <button disabled={busy} className={styles.secondaryButton}
                  onClick={() => onSave(person, person.staff_name, person.staff_role, person.fixed_off_day, true)}>Restore</button> : null}
                <button disabled={busy} className={styles.dangerOutline}
                  onClick={() => onDelete(person)}>Delete</button>
              </div></div>
          ))}
          {!staff.length ? <p>No staff added yet.</p> : null}
        </div>
      </div>
    </ModalShell>
  );
}

function ShiftModal({ shifts, busy, onClose, onSave, onDelete }: {
  shifts: Shift[]; busy: boolean; onClose: () => void;
  onSave: (shift: { id: string | null; name: string; code: string; start: string; end: string; color: ShiftColor; active: boolean }) => void;
  onDelete: (shift: Shift) => void;
}) {
  const [editing, setEditing] = useState<Shift | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [start, setStart] = useState('07:00');
  const [end, setEnd] = useState('15:00');
  const [color, setColor] = useState<ShiftColor>('BLUE');
  function reset() { setEditing(null); setName(''); setCode(''); setStart('07:00'); setEnd('15:00'); setColor('BLUE'); }
  function edit(shift: Shift) {
    setEditing(shift); setName(shift.shift_name); setCode(shift.shift_code);
    setStart(shift.start_time.slice(0, 5)); setEnd(shift.end_time.slice(0, 5)); setColor(shift.color);
  }
  return (
    <ModalShell title="Shift setup" subtitle="Create reusable working hours for fast monthly scheduling." onClose={onClose}>
      <div className={styles.modalBody}>
        <div className={styles.twoColumns}><div><label>Shift name</label><input value={name} placeholder="Morning"
          onChange={(event) => setName(event.target.value)} /></div><div><label>Short code</label><input value={code} maxLength={20}
          placeholder="8:30AM-5:00PM" onChange={(event) => setCode(event.target.value.toUpperCase())} /></div></div>
        <div className={styles.twoColumns}><div><label>Starts</label><input type="time" value={start} onChange={(event) => setStart(event.target.value)} /></div>
          <div><label>Ends</label><input type="time" value={end} onChange={(event) => setEnd(event.target.value)} /></div></div>
        <label>Colour</label>
        <div className={styles.colorPicker}>{SHIFT_COLORS.map((item) => <button key={item} aria-label={item}
          className={`${styles[`shift_${item}`]} ${color === item ? styles.colorSelected : ''}`} onClick={() => setColor(item)} />)}</div>
        <div className={styles.formActions}>
          {editing ? <button className={styles.secondaryButton} onClick={reset}>Cancel edit</button> : <span />}
          <button className={styles.primaryButton} disabled={busy || !name.trim() || !code.trim() || !start || !end}
            onClick={() => { onSave({ id: editing?.id || null, name: name.trim(), code: code.trim(), start, end, color, active: editing?.is_active ?? true }); if (!editing) reset(); }}>
            {editing ? 'Save shift' : '+ Add shift'}
          </button>
        </div>
        <div className={styles.manageList}>
          {shifts.map((shift) => (
            <div key={shift.id}><span className={styles.shiftLine}><i className={styles[`shift_${shift.color}`]} />
              <span><strong>{shift.shift_code} · {shift.shift_name}</strong><small>{timeText(shift.start_time)} – {timeText(shift.end_time)} · {shift.is_active ? 'Active' : 'Hidden'}</small></span></span>
              <div><button className={styles.secondaryButton} onClick={() => edit(shift)}>Edit</button>
                {!shift.is_active ? <button className={styles.secondaryButton} disabled={busy}
                  onClick={() => onSave({ id: shift.id, name: shift.shift_name, code: shift.shift_code, start: shift.start_time, end: shift.end_time, color: shift.color, active: true })}>
                  Restore
                </button> : null}
                <button className={styles.dangerOutline} disabled={busy} onClick={() => onDelete(shift)}>Delete</button></div>
            </div>
          ))}
        </div>
      </div>
    </ModalShell>
  );
}

function BulkModal({ staff, month, shifts, busy, onClose, onSave }: {
  staff: Staff; month: string; shifts: Shift[]; busy: boolean; onClose: () => void;
  onSave: (form: { start: string; end: string; weekdays: number[]; status: EntryStatus; shiftId: string; applyFixedOff: boolean }) => void;
}) {
  const bounds = monthBounds(month);
  const activeShifts = shifts.filter((shift) => shift.is_active);
  const [start, setStart] = useState(bounds.start);
  const [end, setEnd] = useState(bounds.end);
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [status, setStatus] = useState<EntryStatus>('WORK');
  const [shiftId, setShiftId] = useState(activeShifts[0]?.id || '');
  const [applyFixedOff, setApplyFixedOff] = useState(true);
  return (
    <ModalShell title={`Fill dates · ${staff.staff_name}`} subtitle="Apply the same status or shift to selected weekdays." onClose={onClose}>
      <div className={styles.modalBody}>
        <div className={styles.twoColumns}><div><label>From</label><input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></div>
          <div><label>To</label><input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></div></div>
        <label>Apply on</label>
        <div className={styles.weekdayPicker}>{WEEKDAYS.map((day) => <button key={day.value}
          className={weekdays.includes(day.value) ? styles.selected : ''} onClick={() => setWeekdays((current) =>
            current.includes(day.value) ? current.filter((value) => value !== day.value) : [...current, day.value]
          )}>{day.label}</button>)}</div>
        <label>Status</label>
        <select value={status} onChange={(event) => setStatus(event.target.value as EntryStatus)}>
          {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        {status === 'WORK' ? <><label>Shift</label><select value={shiftId} onChange={(event) => setShiftId(event.target.value)}>
          <option value="">Choose shift</option>{activeShifts.map((shift) => <option key={shift.id} value={shift.id}>
            {shift.shift_name} ({timeText(shift.start_time)} – {timeText(shift.end_time)})
          </option>)}</select></> : null}
        {staff.fixed_off_day ? (
          <label className={styles.fixedOffOption}>
            <input type="checkbox" checked={applyFixedOff} onChange={(event) => setApplyFixedOff(event.target.checked)} />
            <span><strong>Set every {weekdayLabel(staff.fixed_off_day)} as Off</strong>
              <small>This overrides the selected shift on the fixed off day.</small></span>
          </label>
        ) : <div className={styles.infoBox}>No fixed off day is set for this staff member. You can set one under Staff.</div>}
        <div className={styles.infoBox}>Existing entries in the chosen dates will be replaced. Arrival time and overtime are entered per day.</div>
      </div>
      <footer className={styles.modalFooter}><span /><div><button className={styles.secondaryButton} onClick={onClose}>Cancel</button>
        <button className={styles.primaryButton} disabled={busy || !start || !end || !weekdays.length || (status === 'WORK' && !shiftId)}
          onClick={() => onSave({ start, end, weekdays, status, shiftId, applyFixedOff })}>{busy ? 'Applying...' : 'Apply schedule'}</button></div></footer>
    </ModalShell>
  );
}
