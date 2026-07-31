'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';
import css from './maintenanceOt.module.css';

type DashboardUser = {
  user_id?: string;
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'HK' | 'MT' | 'FO';
};

type MaintenanceOtEntry = {
  id: string;
  staff_name: string;
  ot_date: string;
  start_time: string;
  end_time: string;
  total_hours: number;
  reason: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

type MaintenanceOtStaff = {
  id: string;
  staff_name: string;
  created_at?: string;
};

type ViewMode = 'ENTRY' | 'PAST' | 'REPORT';
type EntryMode = 'SINGLE' | 'BULK';
type TimeSlot = { start: string; end: string };

const DEFAULT_STAFF_OPTIONS = ['Izzuddin', 'Yazid', 'Panjang', 'Jimmy', 'Paiz', 'Ezwan', 'Harraz'];

const TIME_OPTIONS = [
  '00:00', '00:30', '01:00', '01:30', '02:00', '02:30',
  '03:00', '03:30', '04:00', '04:30', '05:00', '05:30',
  '06:00', '06:30', '07:00', '07:30', '08:00', '08:30',
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
  '18:00', '18:30', '19:00', '19:30', '20:00', '20:30',
  '21:00', '21:30', '22:00', '22:30', '23:00', '23:30',
] as const;

function getSupabaseSafe() {
  if (typeof window === 'undefined') return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createBrowserSupabaseClient();
}

function getTodayLocalDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getYesterdayLocalDateString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCurrentMonthString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function safeNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}

function formatDateLong(value?: string | null) {
  if (!value) return '-';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function calculateHours(startTime: string, endTime: string): number {
  if (!startTime || !endTime) return 0;
  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);
  if ([startHour, startMin, endHour, endMin].some(Number.isNaN)) return 0;
  const startTotal = startHour * 60 + startMin;
  let endTotal = endHour * 60 + endMin;
  if (endTotal === startTotal) return 0;
  if (endTotal < startTotal) endTotal += 24 * 60;
  return Math.round((((endTotal - startTotal) / 60) * 100)) / 100;
}

function sumSlotHours(slots: TimeSlot[]) {
  return Math.round(slots.reduce((sum, slot) => sum + calculateHours(slot.start, slot.end), 0) * 100) / 100;
}

function isOvernightSlot(slot: TimeSlot) {
  if (!slot.start || !slot.end) return false;
  const [startHour, startMin] = slot.start.split(':').map(Number);
  const [endHour, endMin] = slot.end.split(':').map(Number);
  if ([startHour, startMin, endHour, endMin].some(Number.isNaN)) return false;
  return endHour * 60 + endMin < startHour * 60 + startMin;
}

function serializeSlot(slot: TimeSlot) {
  return `${slot.start}-${slot.end}${isOvernightSlot(slot) ? '+1' : ''}`;
}

function formatSlot(slot: TimeSlot) {
  return `${slot.start} - ${slot.end}${isOvernightSlot(slot) ? ' +1' : ''}`;
}

function SlotDisplay({ slots }: { slots: TimeSlot[] }) {
  return (
    <>
      {slots.map((slot, index) => (
        <span key={`${slot.start}-${slot.end}-${index}`}>
          {index > 0 ? ', ' : ''}
          {slot.start} - {slot.end}
          {isOvernightSlot(slot) ? <sup style={{ marginLeft: '3px', color: '#b45309', fontWeight: 900 }}>+1</sup> : null}
        </span>
      ))}
    </>
  );
}

function formatHours(hours: number) {
  return safeNumber(hours).toFixed(2);
}

function monthRange(monthStr: string) {
  const [yearStr, monthStrNum] = monthStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStrNum);
  if (!year || !month) return { start: '', end: '' };
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDate = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDate).padStart(2, '0')}`;
  return { start, end };
}

function entryToSlots(entry: MaintenanceOtEntry): TimeSlot[] {
  const raw = `${entry.start_time || ''}`.split('|').map((s) => s.trim()).filter(Boolean);
  if (raw.length > 0 && raw.every((part) => part.includes('-'))) {
    return raw.map((part) => {
      const [start, end] = part.split('-').map((s) => s.trim());
      return { start: start || '', end: (end || '').replace(/\+1$/, '') };
    });
  }
  return [{ start: entry.start_time || '', end: entry.end_time || '' }];
}

function isFutureDate(value: string) {
  return value > getTodayLocalDateString();
}

function monthCalendar(monthValue: string) {
  const [year, month] = monthValue.split('-').map(Number);
  if (!year || !month) return [] as Array<string | null>;
  const firstWeekdayMondayBased = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const lastDay = new Date(year, month, 0).getDate();
  const cells: Array<string | null> = Array(firstWeekdayMondayBased).fill(null);
  for (let day = 1; day <= lastDay; day += 1) {
    cells.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function normalizeStaffList(values: string[]) {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  values.forEach((value) => {
    const trimmed = String(value || '').trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) return;
    seen.add(key);
    cleaned.push(trimmed);
  });

  return cleaned;
}

export default function MaintenanceOtPage() {
  const [profile, setProfile] = useState<DashboardUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [viewMode, setViewMode] = useState<ViewMode>('ENTRY');
  const [entryMode, setEntryMode] = useState<EntryMode>('SINGLE');
  const [entries, setEntries] = useState<MaintenanceOtEntry[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [staffOptions, setStaffOptions] = useState<string[]>(DEFAULT_STAFF_OPTIONS);
  const [newStaffName, setNewStaffName] = useState('');
  const [staffManageBusy, setStaffManageBusy] = useState(false);
  const [staffName, setStaffName] = useState('');
  const [otDate, setOtDate] = useState(getTodayLocalDateString());
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([{ start: '', end: '' }]);
  const [reason, setReason] = useState('');
  const [bulkMonth, setBulkMonth] = useState(getCurrentMonthString());
  const [bulkDates, setBulkDates] = useState<string[]>([]);
  const [bulkTimeSlots, setBulkTimeSlots] = useState<TimeSlot[]>([{ start: '', end: '' }]);
  const [bulkReason, setBulkReason] = useState('');

  const [pastDate, setPastDate] = useState(getYesterdayLocalDateString());
  const [reportMonth, setReportMonth] = useState(getCurrentMonthString());

  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      try {
        const supabase = getSupabaseSafe();
        if (!supabase) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.');
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session?.user) {
          if (mounted) setProfile(null);
          return;
        }
        const { data: profileRow, error: profileError } = await supabase
          .from('user_profiles')
          .select('user_id, email, name, role')
          .eq('user_id', session.user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!mounted) return;
        setProfile({
          user_id: session.user.id,
          email: profileRow?.email || session.user.email || '',
          name: profileRow?.name || session.user.email || 'User',
          role: (profileRow?.role || 'MT') as DashboardUser['role'],
        });
      } catch (err: any) {
        if (mounted) setErrorMsg(err?.message || 'Failed to load session');
      } finally {
        if (mounted) setAuthLoading(false);
      }
    }
    void bootstrap();
    return () => { mounted = false; };
  }, []);

  const canAccess = useMemo(() => !!profile && (profile.role === 'SUPERUSER' || profile.role === 'MANAGER' || profile.role === 'MT'), [profile]);
  const isSuperuser = profile?.role === 'SUPERUSER';
  const today = getTodayLocalDateString();
  const yesterday = getYesterdayLocalDateString();
  const totalHours = useMemo(() => sumSlotHours(timeSlots), [timeSlots]);
  const needsReason = totalHours > 3;
  const bulkTotalHours = useMemo(() => sumSlotHours(bulkTimeSlots), [bulkTimeSlots]);
  const bulkNeedsReason = bulkTotalHours > 3;
  const bulkCalendarCells = useMemo(() => monthCalendar(bulkMonth), [bulkMonth]);
  const bulkExistingDates = useMemo(() => new Set(
    entries
      .filter((entry) => entry.staff_name.toLowerCase() === staffName.trim().toLowerCase())
      .map((entry) => entry.ot_date)
  ), [entries, staffName]);

  async function loadStaffOptions() {
    const supabase = getSupabaseSafe();
    if (!supabase) return;

    const { data, error } = await supabase
      .from('maintenance_ot_staff')
      .select('id, staff_name, created_at')
      .order('staff_name', { ascending: true });

    if (error) throw error;

    const nextNames = normalizeStaffList(
      ((data || []) as MaintenanceOtStaff[]).map((row) => row.staff_name)
    );

    setStaffOptions(nextNames.length ? nextNames : DEFAULT_STAFF_OPTIONS);
  }

  async function loadEntries() {
    const supabase = getSupabaseSafe();
    if (!supabase) return setErrorMsg('Supabase is not configured.');
    try {
      setPageLoading(true);
      setErrorMsg('');
      const { data, error } = await supabase
        .from('maintenance_ot_entries')
        .select('*')
        .order('ot_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      setEntries((data || []) as MaintenanceOtEntry[]);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load OT entries');
    } finally {
      setPageLoading(false);
    }
  }

  useEffect(() => {
    if (!profile || !canAccess) {
      setPageLoading(false);
      return;
    }
    void (async () => {
      await loadEntries();
      try {
        await loadStaffOptions();
      } catch (err: any) {
        setErrorMsg(err?.message || 'Failed to load OT staff list');
      }
    })();
  }, [profile, canAccess]);

  function resetForm() {
    setEditingId(null);
    setStaffName('');
    setOtDate(getTodayLocalDateString());
    setTimeSlots([{ start: '', end: '' }]);
    setReason('');
    setBulkDates([]);
    setBulkTimeSlots([{ start: '', end: '' }]);
    setBulkReason('');
  }

  function updateSlot(index: number, field: keyof TimeSlot, value: string) {
    setTimeSlots((prev) => prev.map((slot, i) => i === index ? { ...slot, [field]: value } : slot));
  }

  function addSlot() {
    setTimeSlots((prev) => [...prev, { start: '', end: '' }]);
  }

  function removeSlot(index: number) {
    setTimeSlots((prev) => prev.length === 1 ? prev : prev.filter((_, i) => i !== index));
  }

  function updateBulkSlot(index: number, field: keyof TimeSlot, value: string) {
    setBulkTimeSlots((prev) => prev.map((slot, i) => i === index ? { ...slot, [field]: value } : slot));
  }

  function addBulkSlot() {
    setBulkTimeSlots((prev) => [...prev, { start: '', end: '' }]);
  }

  function removeBulkSlot(index: number) {
    setBulkTimeSlots((prev) => prev.length === 1 ? prev : prev.filter((_, i) => i !== index));
  }

  function toggleBulkDate(date: string) {
    if (isFutureDate(date)) return;
    setBulkDates((prev) => prev.includes(date)
      ? prev.filter((item) => item !== date)
      : [...prev, date].sort());
  }

  async function handleAddStaffName() {
    const supabase = getSupabaseSafe();
    if (!supabase) return setErrorMsg('Supabase is not configured.');
    if (!isSuperuser) return;

    const trimmed = newStaffName.trim();
    if (!trimmed) {
      setErrorMsg('Please enter a name to add.');
      return;
    }

    setStaffManageBusy(true);
    setErrorMsg('');
    setSuccessMsg('');

    const exists = staffOptions.some((option) => option.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      setStaffManageBusy(false);
      setErrorMsg('That staff name already exists.');
      return;
    }

    try {
      const { error } = await supabase
        .from('maintenance_ot_staff')
        .insert([{ staff_name: trimmed }]);

      if (error) throw error;

      await loadStaffOptions();
      setNewStaffName('');
      setSuccessMsg(`Added ${trimmed} to Maintenance OT staff list.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to add staff name.');
    } finally {
      setStaffManageBusy(false);
    }
  }

  async function handleRemoveStaffName(name: string) {
    const supabase = getSupabaseSafe();
    if (!supabase) return setErrorMsg('Supabase is not configured.');
    if (!isSuperuser) return;

    const confirmed = window.confirm(`Remove ${name} from the available OT name list?`);
    if (!confirmed) return;

    setStaffManageBusy(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const { error } = await supabase
        .from('maintenance_ot_staff')
        .delete()
        .ilike('staff_name', name);

      if (error) throw error;

      await loadStaffOptions();
      if (staffName.toLowerCase() === name.toLowerCase()) {
        setStaffName('');
      }
      setSuccessMsg(`Removed ${name} from Maintenance OT staff list.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to remove staff name.');
    } finally {
      setStaffManageBusy(false);
    }
  }

  async function sendTelegramIfNeeded(name: string, hours: number, submitReason: string) {
    if (hours <= 3) return;
    const res = await fetch('/api/maintenance-ot-telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, hours, reason: submitReason }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.ok === false) throw new Error(data?.error || 'Failed to send Telegram alert');
  }

  function validateSubmission(
    dates: string[],
    slots: TimeSlot[],
    submitReason: string
  ) {
    if (!staffName.trim()) return 'Please select a staff name.';
    if (dates.length === 0) return 'Please select at least one OT date.';
    if (dates.some((date) => !date)) return 'Please select a valid OT date.';
    if (dates.some(isFutureDate)) return 'Future OT dates cannot be submitted.';
    if (slots.some((slot) => !slot.start || !slot.end)) return 'Please complete all OT time rows.';
    if (slots.some((slot) => calculateHours(slot.start, slot.end) <= 0)) {
      return 'Start and end time cannot be the same.';
    }
    const hours = sumSlotHours(slots);
    if (hours > 3 && !submitReason.trim()) return 'Reason is required for OT exceeding 3 hours.';
    return '';
  }

  async function saveOtDates(
    dates: string[],
    slots: TimeSlot[],
    submitReason: string,
    successText: string
  ) {
    const supabase = getSupabaseSafe();
    if (!supabase) throw new Error('Supabase is not configured.');
    if (!profile?.user_id) throw new Error('User not found.');

    const trimmedStaff = staffName.trim();
    const trimmedReason = submitReason.trim();
    const hours = sumSlotHours(slots);
    const startTimeStore = slots.map(serializeSlot).join(' | ');
    const endTimeStore = slots[slots.length - 1]?.end || '';
    const uniqueDates = Array.from(new Set(dates)).sort();

    if (editingId) {
      const { error } = await supabase
        .from('maintenance_ot_entries')
        .update({
          staff_name: trimmedStaff,
          ot_date: uniqueDates[0],
          start_time: startTimeStore,
          end_time: endTimeStore,
          total_hours: hours,
          reason: trimmedReason || null,
        })
        .eq('id', editingId);
      if (error) throw error;
    } else {
      const dateSet = new Set(uniqueDates);
      const existingRows = entries.filter((entry) =>
        entry.staff_name.trim().toLowerCase() === trimmedStaff.toLowerCase()
        && dateSet.has(entry.ot_date)
      );
      const existingDates = new Set(existingRows.map((entry) => entry.ot_date));
      const existingIds = existingRows.map((entry) => entry.id);

      if (existingIds.length > 0) {
        const { error } = await supabase
          .from('maintenance_ot_entries')
          .update({
            start_time: startTimeStore,
            end_time: endTimeStore,
            total_hours: hours,
            reason: trimmedReason || null,
          })
          .in('id', existingIds);
        if (error) throw error;
      }

      const newDates = uniqueDates.filter((date) => !existingDates.has(date));
      if (newDates.length > 0) {
        const { error } = await supabase
          .from('maintenance_ot_entries')
          .insert(newDates.map((date) => ({
            staff_name: trimmedStaff,
            ot_date: date,
            start_time: startTimeStore,
            end_time: endTimeStore,
            total_hours: hours,
            reason: trimmedReason || null,
            created_by_user_id: profile.user_id,
            created_by_name: profile.name || profile.email,
          })));
        if (error) throw error;
      }
    }

    await sendTelegramIfNeeded(trimmedStaff, hours, trimmedReason);
    setSuccessMsg(successText);
    setEditingId(null);
    setTimeSlots([{ start: '', end: '' }]);
    setReason('');
    setBulkDates([]);
    setBulkTimeSlots([{ start: '', end: '' }]);
    setBulkReason('');
    await loadEntries();
  }

  async function handleSubmit(slotsOverride?: TimeSlot[]) {
    if (saving) return;
    const slots = slotsOverride || timeSlots;
    const validationError = validateSubmission([otDate], slots, reason);
    if (validationError) return setErrorMsg(validationError);

    try {
      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');
      await saveOtDates(
        [otDate],
        slots,
        reason,
        editingId ? 'OT entry updated successfully.' : 'OT entry saved successfully.'
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save OT entry');
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickSubmit(start: string, end: string) {
    const quickSlots = [{ start, end }];
    await handleSubmit(quickSlots);
  }

  async function handleBulkSubmit() {
    if (saving) return;
    const validationError = validateSubmission(bulkDates, bulkTimeSlots, bulkReason);
    if (validationError) return setErrorMsg(validationError);

    try {
      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');
      const count = bulkDates.length;
      await saveOtDates(
        bulkDates,
        bulkTimeSlots,
        bulkReason,
        `${count} OT ${count === 1 ? 'date' : 'dates'} saved successfully. Existing dates were updated.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save bulk OT entries');
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(entry: MaintenanceOtEntry) {
    setEditingId(entry.id);
    setStaffName(entry.staff_name);
    setOtDate(entry.ot_date);
    setTimeSlots(entryToSlots(entry));
    setReason(entry.reason || '');
    setEntryMode('SINGLE');
    setViewMode('ENTRY');
    setErrorMsg('');
    setSuccessMsg('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleDelete(entry: MaintenanceOtEntry) {
    const supabase = getSupabaseSafe();
    if (!supabase) return setErrorMsg('Supabase is not configured.');
    const confirmed = window.confirm(`Delete OT entry for ${entry.staff_name} on ${formatDate(entry.ot_date)}?`);
    if (!confirmed) return;
    try {
      setDeletingId(entry.id);
      setErrorMsg('');
      setSuccessMsg('');
      const { error } = await supabase.from('maintenance_ot_entries').delete().eq('id', entry.id);
      if (error) throw error;
      if (editingId === entry.id) resetForm();
      setSuccessMsg('OT entry deleted.');
      await loadEntries();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to delete OT entry');
    } finally {
      setDeletingId(null);
    }
  }

  const overThreeCount = useMemo(() => entries.filter((entry) => safeNumber(entry.total_hours) > 3).length, [entries]);
  const todayEntries = useMemo(() => entries.filter((entry) => entry.ot_date === today), [entries, today]);
  const yesterdayEntries = useMemo(() => entries.filter((entry) => entry.ot_date === yesterday), [entries, yesterday]);
  const selectedDateEntries = useMemo(() => entries.filter((entry) => entry.ot_date === otDate), [entries, otDate]);
  const pastEntries = useMemo(() => entries.filter((entry) => entry.ot_date === pastDate), [entries, pastDate]);

  const reportEntries = useMemo(() => {
    const { start, end } = monthRange(reportMonth);
    if (!start || !end) return [];
    return entries.filter((entry) => entry.ot_date >= start && entry.ot_date <= end);
  }, [entries, reportMonth]);

  const reportSummary = useMemo(() => {
    const grouped = new Map<string, { totalHours: number; entries: MaintenanceOtEntry[] }>();
    for (const entry of reportEntries) {
      const existing = grouped.get(entry.staff_name) || { totalHours: 0, entries: [] };
      existing.totalHours += safeNumber(entry.total_hours);
      existing.entries.push(entry);
      grouped.set(entry.staff_name, existing);
    }
    return Array.from(grouped.entries())
      .map(([staffName, data]) => ({
        staffName,
        totalHours: Math.round(data.totalHours * 100) / 100,
        entries: data.entries.sort((a, b) => `${a.ot_date} ${a.start_time}`.localeCompare(`${b.ot_date} ${b.start_time}`)),
      }))
      .sort((a, b) => a.staffName.localeCompare(b.staffName));
  }, [reportEntries]);

  function handleDownloadReport() {
    const reportWindow = window.open('', '_blank', 'width=1000,height=800');
    if (!reportWindow) return setErrorMsg('Popup blocked. Please allow popups to download report.');
    const totalMonthHours = reportSummary.reduce((sum, staff) => sum + safeNumber(staff.totalHours), 0);

    const body = reportSummary.length
      ? reportSummary.map((staff, index) => {
          const rows = staff.entries.map((entry) => {
            const slotText = entryToSlots(entry).map(formatSlot).join(', ');
            return `
              <tr>
                <td>${formatDate(entry.ot_date)}</td>
                <td>${slotText}</td>
                <td>${formatHours(entry.total_hours)}</td>
                <td>${entry.reason || '-'}</td>
              </tr>
            `;
          }).join('');
          return `
            <section class="staff-page ${index > 0 ? 'page-break' : ''}">
              <h2>${staff.staffName}</h2>
              <div class="meta">Month: ${reportMonth}</div>
              <div class="meta strong">Total OT for ${staff.staffName}: ${formatHours(staff.totalHours)} hours</div>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>OT Time</th>
                    <th>OT Hours</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </section>
          `;
        }).join('')
      : '<div class="empty">No entries for this month.</div>';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Maintenance OT Report ${reportMonth}</title>
        <style>
          body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #111827; }
          h1 { margin: 0 0 8px; font-size: 26px; }
          h2 { margin: 0 0 8px; font-size: 22px; }
          .sub { margin: 0 0 10px; color: #475569; font-size: 14px; }
          .meta { margin: 0 0 8px; color: #334155; font-size: 14px; }
          .strong { font-weight: 700; }
          .overall { margin: 0 0 18px; font-size: 15px; font-weight: 700; }
          .staff-page { margin-top: 18px; }
          .page-break { page-break-before: always; break-before: page; }
          .empty { padding: 20px 0; color: #64748b; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 10px; }
          th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; vertical-align: top; }
          th { background: #f8fafc; font-weight: 700; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <h1>Maintenance OT Monthly Report</h1>
        <div class="sub">Month: ${reportMonth}</div>
        <div class="overall">Total OT Hours for Selected Month: ${formatHours(totalMonthHours)} hours</div>
        ${body}
        <script>window.onload = function(){ window.print(); };</script>
      </body>
      </html>
    `;
    reportWindow.document.open();
    reportWindow.document.write(html);
    reportWindow.document.close();
  }

  if (authLoading) return <main style={styles.page}><div style={styles.centerCard}>Loading...</div></main>;

  if (!profile) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>
          <div style={styles.centerTitle}>Login required</div>
          <p style={styles.centerText}>Please log in first, then open this page again.</p>
          <Link href="/dashboard" style={styles.linkBtn}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  if (!canAccess) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>
          <div style={styles.centerTitle}>Access denied</div>
          <p style={styles.centerText}>You do not have permission to access Maintenance OT.</p>
          <Link href="/dashboard" style={styles.linkBtn}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.topBar}>
          <div>
            <div style={styles.pageTitle}>Maintenance OT</div>
            <div style={styles.pageSubTitle}>{profile.name} ({profile.role}) · Record and manage maintenance overtime</div>
          </div>
          <div style={styles.topBarActions}>
            <Link href="/dashboard" style={styles.secondaryBtn}>Back to Dashboard</Link>
          </div>
        </div>

        <div style={styles.summaryGrid}>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Today Entries</div>
            <div style={styles.summaryValue}>{todayEntries.length}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Yesterday Entries</div>
            <div style={styles.summaryValue}>{yesterdayEntries.length}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Above 3 Hours</div>
            <div style={{ ...styles.summaryValue, color: '#b91c1c' }}>{overThreeCount}</div>
          </div>
        </div>

        <section style={styles.panel}>
          <div style={styles.modeRow}>
            <button type="button" onClick={() => setViewMode('ENTRY')} style={{ ...styles.modeBtn, ...(viewMode === 'ENTRY' ? styles.modeBtnActive : {}) }}>Entry</button>
            <button type="button" onClick={() => setViewMode('PAST')} style={{ ...styles.modeBtn, ...(viewMode === 'PAST' ? styles.modeBtnActive : {}) }}>Past Entries</button>
            <button type="button" onClick={() => setViewMode('REPORT')} style={{ ...styles.modeBtn, ...(viewMode === 'REPORT' ? styles.modeBtnActive : {}) }}>Report</button>
          </div>
        </section>

        {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}
        {successMsg ? <div style={styles.successBox}>{successMsg}</div> : null}

        {viewMode === 'ENTRY' ? (
          <>
            <section style={styles.panel}>
              <div style={styles.sectionTitle}>{editingId ? 'Edit OT Entry' : 'Add OT Entry'}</div>

              {!editingId ? (
                <div style={styles.entryModeRow}>
                  <button
                    type="button"
                    onClick={() => setEntryMode('SINGLE')}
                    style={{ ...styles.entryModeBtn, ...(entryMode === 'SINGLE' ? styles.entryModeBtnActive : {}) }}
                  >
                    <span style={styles.entryModeTitle}>Single date</span>
                    <span style={styles.entryModeHint}>Quick preset or custom time</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEntryMode('BULK')}
                    style={{ ...styles.entryModeBtn, ...(entryMode === 'BULK' ? styles.entryModeBtnActive : {}) }}
                  >
                    <span style={styles.entryModeTitle}>Bulk dates</span>
                    <span style={styles.entryModeHint}>One time for many dates</span>
                  </button>
                </div>
              ) : (
                <div style={styles.editNotice}>Editing an existing submission. Change the details below and save.</div>
              )}

              {isSuperuser ? (
                <div style={styles.staffManagerBox}>
                  <div style={styles.staffManagerTitle}>Manage Staff Names</div>
                  <div style={styles.staffManagerSubTitle}>Only superuser can add or remove names from the OT list.</div>
                  <div style={styles.staffManagerRow}>
                    <input
                      type="text"
                      value={newStaffName}
                      onChange={(e) => setNewStaffName(e.target.value)}
                      style={styles.input}
                      placeholder="Add new staff name"
                      disabled={staffManageBusy || saving}
                    />
                    <button
                      type="button"
                      onClick={handleAddStaffName}
                      style={styles.primaryBtn}
                      disabled={staffManageBusy || saving}
                    >
                      Add Name
                    </button>
                  </div>
                  <div style={styles.staffTagWrap}>
                    {staffOptions.map((name) => (
                      <div key={name} style={styles.staffTag}>
                        <span>{name}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveStaffName(name)}
                          style={styles.staffTagRemoveBtn}
                          disabled={staffManageBusy || saving}
                          title={`Remove ${name}`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div style={styles.formGroup}>
                <label style={styles.label}>Staff Name</label>
                <select value={staffName} onChange={(e) => setStaffName(e.target.value)} style={styles.select} disabled={saving}>
                  <option value="">Select staff</option>
                  {normalizeStaffList(staffName && !staffOptions.includes(staffName) ? [...staffOptions, staffName] : staffOptions).map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>

              {entryMode === 'SINGLE' ? (
                <>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>OT Date</label>
                    <input
                      type="date"
                      value={otDate}
                      max={today}
                      onChange={(e) => setOtDate(e.target.value)}
                      style={styles.dateInput}
                      disabled={saving}
                    />
                  </div>

                  {!editingId ? (
                    <div style={styles.quickSection}>
                      <div style={styles.quickHeading}>
                        <div>
                          <div style={styles.quickTitle}>One-tap submission</div>
                          <div style={styles.quickHint}>Choose the staff and date, then tap the usual time.</div>
                        </div>
                        <span style={styles.quickBadge}>3 hours</span>
                      </div>
                      <div style={styles.quickGrid}>
                        <button type="button" onClick={() => void handleQuickSubmit('18:00', '21:00')} style={styles.quickBtn} disabled={saving}>
                          <strong>6:00 PM – 9:00 PM</strong>
                          <span>{saving ? 'Saving…' : 'Tap to submit'}</span>
                        </button>
                        <button type="button" onClick={() => void handleQuickSubmit('20:00', '23:00')} style={styles.quickBtn} disabled={saving}>
                          <strong>8:00 PM – 11:00 PM</strong>
                          <span>{saving ? 'Saving…' : 'Tap to submit'}</span>
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div style={styles.customDivider}><span>{editingId ? 'OT time' : 'Or customise the time'}</span></div>

              <div style={styles.formGroup}>
                <label style={styles.label}>OT Time</label>
                <div style={styles.slotList}>
                  {timeSlots.map((slot, index) => (
                    <div key={index} style={styles.slotWrap}>
                      <div style={styles.slotRow}>
                      <select value={slot.start} onChange={(e) => updateSlot(index, 'start', e.target.value)} style={styles.slotSelect} disabled={saving}>
                        <option value="">From</option>
                        {TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}
                      </select>

                      <span style={styles.toLabel}>to</span>

                      <select value={slot.end} onChange={(e) => updateSlot(index, 'end', e.target.value)} style={styles.slotSelect} disabled={saving}>
                        <option value="">To</option>
                        {TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}
                      </select>

                      <button type="button" onClick={addSlot} style={styles.iconBtn} disabled={saving} title="Add another OT row">+</button>

                      <button
                        type="button"
                        onClick={() => removeSlot(index)}
                        style={{ ...styles.iconBtn, opacity: timeSlots.length === 1 ? 0.45 : 1 }}
                        disabled={saving || timeSlots.length === 1}
                        title="Remove this OT row"
                      >
                        −
                      </button>
                      </div>
                      {isOvernightSlot(slot) ? <div style={styles.nextDayHint}>Ends next day <strong>+1</strong></div> : null}
                    </div>
                  ))}
                </div>
              </div>

              <div style={styles.totalRow}>
                <span style={styles.totalLabel}>Total OT Hours</span>
                <span style={styles.totalValue}>{formatHours(totalHours)}</span>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>{needsReason ? 'Reason for Exceeding 3 Hours' : 'Reason (Optional)'}</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  style={styles.textarea}
                  placeholder={needsReason ? 'This field is compulsory when OT exceeds 3 hours' : 'Optional if OT is 3 hours or below'}
                  disabled={saving}
                />
              </div>

              <div style={styles.actionRow}>
                {editingId ? <button type="button" onClick={resetForm} style={styles.secondaryActionBtn} disabled={saving}>Cancel Edit</button> : null}
                <button type="button" onClick={() => void handleSubmit()} style={styles.primaryBtn} disabled={saving}>
                  {saving ? 'Saving...' : editingId ? 'Update Entry' : 'Submit Custom Time'}
                </button>
              </div>
                </>
              ) : (
                <>
                  <div style={styles.bulkIntro}>
                    <strong>1. Set the OT time</strong>
                    <span>The same time will be applied to every green date selected below.</span>
                  </div>

                  <div style={styles.formGroup}>
                    <label style={styles.label}>OT Time</label>
                    <div style={styles.slotList}>
                      {bulkTimeSlots.map((slot, index) => (
                        <div key={index} style={styles.slotWrap}>
                          <div style={styles.slotRow}>
                            <select value={slot.start} onChange={(e) => updateBulkSlot(index, 'start', e.target.value)} style={styles.slotSelect} disabled={saving}>
                              <option value="">From</option>
                              {TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}
                            </select>
                            <span style={styles.toLabel}>to</span>
                            <select value={slot.end} onChange={(e) => updateBulkSlot(index, 'end', e.target.value)} style={styles.slotSelect} disabled={saving}>
                              <option value="">To</option>
                              {TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}
                            </select>
                            <button type="button" onClick={addBulkSlot} style={styles.iconBtn} disabled={saving} title="Add another OT row">+</button>
                            <button
                              type="button"
                              onClick={() => removeBulkSlot(index)}
                              style={{ ...styles.iconBtn, opacity: bulkTimeSlots.length === 1 ? 0.45 : 1 }}
                              disabled={saving || bulkTimeSlots.length === 1}
                              title="Remove this OT row"
                            >
                              −
                            </button>
                          </div>
                          {isOvernightSlot(slot) ? <div style={styles.nextDayHint}>Ends next day <strong>+1</strong></div> : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={styles.totalRow}>
                    <span style={styles.totalLabel}>Hours applied to each date</span>
                    <span style={styles.totalValue}>{formatHours(bulkTotalHours)}</span>
                  </div>

                  <div style={styles.bulkCalendarHeader}>
                    <div>
                      <strong>2. Choose the dates</strong>
                      <span>Selected dates turn green. Future dates cannot be selected.</span>
                    </div>
                    <input
                      type="month"
                      value={bulkMonth}
                      max={getCurrentMonthString()}
                      onChange={(e) => {
                        setBulkMonth(e.target.value);
                        setBulkDates([]);
                      }}
                      style={styles.monthInput}
                      disabled={saving}
                    />
                  </div>

                  <div className={css.calendarCard}>
                    <div className={css.weekdays}>
                      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}
                    </div>
                    <div className={css.calendarGrid}>
                      {bulkCalendarCells.map((date, index) => {
                        if (!date) return <span key={`blank-${index}`} className={css.blankDate} />;
                        const selected = bulkDates.includes(date);
                        const disabled = isFutureDate(date);
                        const existing = bulkExistingDates.has(date);
                        return (
                          <button
                            key={date}
                            type="button"
                            onClick={() => toggleBulkDate(date)}
                            disabled={disabled || saving}
                            className={[
                              css.dateButton,
                              selected ? css.dateSelected : '',
                              existing && !selected ? css.dateExisting : '',
                            ].filter(Boolean).join(' ')}
                            aria-pressed={selected}
                            title={existing ? 'An OT entry already exists. Saving will update it.' : undefined}
                          >
                            <span>{Number(date.slice(-2))}</span>
                            {selected ? <small>✓</small> : existing ? <small>Saved</small> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div style={styles.selectionSummary}>
                    <strong>{bulkDates.length}</strong>
                    <span>{bulkDates.length === 1 ? 'date selected' : 'dates selected'}</span>
                  </div>

                  <div style={styles.formGroup}>
                    <label style={styles.label}>{bulkNeedsReason ? 'Reason for Exceeding 3 Hours' : 'Reason (Optional)'}</label>
                    <textarea
                      value={bulkReason}
                      onChange={(e) => setBulkReason(e.target.value)}
                      style={styles.textarea}
                      placeholder={bulkNeedsReason ? 'This reason will apply to all selected dates' : 'Optional note applied to all selected dates'}
                      disabled={saving}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleBulkSubmit()}
                    style={{ ...styles.primaryBtn, ...styles.bulkSaveBtn }}
                    disabled={saving || bulkDates.length === 0}
                  >
                    {saving ? 'Saving dates...' : `Save ${bulkDates.length || ''} Selected ${bulkDates.length === 1 ? 'Date' : 'Dates'}`}
                  </button>
                </>
              )}
            </section>

            {entryMode === 'SINGLE' ? <section style={styles.panel}>
              <div style={styles.sectionTitle}>Entries for {formatDateLong(otDate)}</div>
              {pageLoading ? <div style={styles.emptyState}>Loading OT entries...</div> : selectedDateEntries.length === 0 ? <div style={styles.emptyState}>No OT entries for {formatDate(otDate)}.</div> : (
                <div style={styles.cardsWrap}>
                  {selectedDateEntries.map((entry) => {
                    const slots = entryToSlots(entry);
                    return (
                      <article key={entry.id} style={styles.entryCard}>
                        <div style={styles.entryTopRow}>
                          <div>
                            <div style={styles.entryTitle}>{entry.staff_name}</div>
                            <div style={styles.entrySubTitle}><SlotDisplay slots={slots} /></div>
                          </div>
                          <div style={{ ...styles.hourBadge, ...(safeNumber(entry.total_hours) > 3 ? styles.hourBadgeAlert : styles.hourBadgeNormal) }}>
                            {formatHours(entry.total_hours)} hrs
                          </div>
                        </div>

                        <div style={styles.metaGrid}>
                          <div style={styles.metaItem}>
                            <div style={styles.metaLabel}>Created By</div>
                            <div style={styles.metaValue}>{entry.created_by_name || '-'}</div>
                          </div>
                          <div style={styles.metaItem}>
                            <div style={styles.metaLabel}>Created At</div>
                            <div style={styles.metaValue}>{formatDateTime(entry.created_at)}</div>
                          </div>
                        </div>

                        {entry.reason ? (
                          <div style={styles.reasonBox}>
                            <div style={styles.reasonLabel}>Reason</div>
                            <div style={styles.reasonText}>{entry.reason}</div>
                          </div>
                        ) : null}

                        <div style={styles.cardActions}>
                          <button type="button" onClick={() => handleEdit(entry)} style={styles.secondaryActionBtn} disabled={saving}>Edit</button>
                          <button type="button" onClick={() => void handleDelete(entry)} style={styles.deleteBtn} disabled={deletingId === entry.id}>
                            {deletingId === entry.id ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section> : null}
          </>
        ) : null}

        {viewMode === 'PAST' ? (
          <section style={styles.panel}>
            <div style={styles.sectionTitle}>Past Entries</div>
            <div style={styles.filterRow}>
              <div style={styles.formGroupCompact}>
                <label style={styles.label}>Select Date</label>
                <input type="date" value={pastDate} onChange={(e) => setPastDate(e.target.value)} style={styles.dateInput} />
              </div>
            </div>

            {pageLoading ? <div style={styles.emptyState}>Loading past entries...</div> : pastEntries.length === 0 ? <div style={styles.emptyState}>No OT entries for {formatDate(pastDate)}.</div> : (
              <div style={styles.cardsWrap}>
                {pastEntries.map((entry) => {
                  const slots = entryToSlots(entry);
                  return (
                    <article key={entry.id} style={styles.entryCard}>
                      <div style={styles.entryTopRow}>
                        <div>
                          <div style={styles.entryTitle}>{entry.staff_name}</div>
                          <div style={styles.entrySubTitle}>{formatDate(entry.ot_date)} · <SlotDisplay slots={slots} /></div>
                        </div>
                        <div style={{ ...styles.hourBadge, ...(safeNumber(entry.total_hours) > 3 ? styles.hourBadgeAlert : styles.hourBadgeNormal) }}>
                          {formatHours(entry.total_hours)} hrs
                        </div>
                      </div>

                      {entry.reason ? (
                        <div style={styles.reasonBox}>
                          <div style={styles.reasonLabel}>Reason</div>
                          <div style={styles.reasonText}>{entry.reason}</div>
                        </div>
                      ) : null}

                      <div style={styles.cardActions}>
                        <button type="button" onClick={() => handleEdit(entry)} style={styles.secondaryActionBtn} disabled={saving}>Edit</button>
                        <button type="button" onClick={() => void handleDelete(entry)} style={styles.deleteBtn} disabled={deletingId === entry.id}>
                          {deletingId === entry.id ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}

        {viewMode === 'REPORT' ? (
          <section style={styles.panel}>
            <div style={styles.sectionTitle}>Monthly Report</div>
            <div style={styles.filterRow}>
              <div style={styles.formGroupCompact}>
                <label style={styles.label}>Month</label>
                <input type="month" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} style={styles.dateInput} />
              </div>
              <button type="button" onClick={handleDownloadReport} style={styles.primaryBtn}>Download Report</button>
            </div>

            <div style={styles.reportTableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Name</th>
                    <th style={styles.th}>Total OT This Month</th>
                    <th style={styles.th}>Entries</th>
                  </tr>
                </thead>
                <tbody>
                  {reportSummary.length === 0 ? <tr><td colSpan={3} style={styles.emptyTableCell}>No entries for this month.</td></tr> : reportSummary.map((staff) => (
                    <tr key={staff.staffName}>
                      <td style={styles.td}>{staff.staffName}</td>
                      <td style={styles.tdStrong}>{formatHours(staff.totalHours)} hrs</td>
                      <td style={styles.td}>
                        <div style={styles.reportEntryList}>
                          {staff.entries.map((entry) => (
                            <div key={entry.id} style={styles.reportEntryRow}>
                              {formatDate(entry.ot_date)} · <SlotDisplay slots={entryToSlots(entry)} /> · {formatHours(entry.total_hours)} hrs{entry.reason ? ` · ${entry.reason}` : ''}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f8fafc', padding: '16px 10px 36px', overflowX: 'hidden' },
  shell: { width: '100%', maxWidth: '1200px', margin: '0 auto', minWidth: 0 },
  topBar: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '16px', minWidth: 0 },
  topBarActions: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', minWidth: 0 },
  pageTitle: { fontSize: '28px', fontWeight: 800, color: '#0f172a', lineHeight: 1.1 },
  pageSubTitle: { fontSize: '14px', color: '#64748b', marginTop: '6px', overflowWrap: 'anywhere' },
  summaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(140px, 100%), 1fr))', gap: '10px', marginBottom: '14px' },
  summaryCard: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '14px', boxShadow: '0 10px 24px rgba(15,23,42,0.05)', minWidth: 0 },
  summaryLabel: { fontSize: '13px', color: '#64748b', fontWeight: 700, marginBottom: '8px' },
  summaryValue: { fontSize: '28px', fontWeight: 800, color: '#0f172a' },
  panel: { background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '20px', padding: '14px', boxShadow: '0 10px 24px rgba(15,23,42,0.05)', marginBottom: '14px', minWidth: 0, overflow: 'hidden' },
  sectionTitle: { fontSize: '22px', fontWeight: 800, color: '#0f172a', marginBottom: '14px' },
  modeRow: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' },
  modeBtn: { border: '1px solid #cbd5e1', background: '#ffffff', color: '#334155', borderRadius: '999px', padding: '11px 10px', fontWeight: 800, cursor: 'pointer', minWidth: 0, whiteSpace: 'normal' },
  modeBtnActive: { background: '#0f172a', color: '#ffffff', borderColor: '#0f172a' },
  entryModeRow: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px', marginBottom: '16px' },
  entryModeBtn: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '3px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#334155', borderRadius: '14px', padding: '12px 14px', cursor: 'pointer', textAlign: 'left', minWidth: 0 },
  entryModeBtnActive: { background: '#eff6ff', color: '#1d4ed8', borderColor: '#3b82f6', boxShadow: '0 0 0 2px rgba(59,130,246,0.12)' },
  entryModeTitle: { fontSize: '15px', fontWeight: 800 },
  entryModeHint: { fontSize: '12px', fontWeight: 600, opacity: 0.8, lineHeight: 1.35 },
  editNotice: { marginBottom: '14px', border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1e40af', borderRadius: '12px', padding: '11px 13px', fontWeight: 700, fontSize: '13px' },
  todayBar: { display: 'inline-flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', border: '1px solid #e2e8f0', background: '#f8fafc', borderRadius: '14px', padding: '10px 14px', marginBottom: '14px' },
  todayLabel: { fontSize: '14px', fontWeight: 700, color: '#475569' },
  todayValue: { fontSize: '16px', fontWeight: 800, color: '#0f172a' },
  dateSelect: { minWidth: 'min(250px, 100%)', boxSizing: 'border-box', border: '1px solid #cbd5e1', background: '#ffffff', color: '#0f172a', borderRadius: '12px', padding: '10px 12px', fontSize: '15px', fontWeight: 800, outline: 'none', cursor: 'pointer' },
  staffManagerBox: { border: '1px solid #dbeafe', background: '#f8fbff', borderRadius: '16px', padding: '14px', marginBottom: '14px' },
  staffManagerTitle: { fontSize: '16px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' },
  staffManagerSubTitle: { fontSize: '13px', color: '#64748b', fontWeight: 600, lineHeight: 1.45, marginBottom: '12px' },
  staffManagerRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '10px', alignItems: 'center', marginBottom: '12px' },
  staffTagWrap: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
  staffTag: { display: 'inline-flex', alignItems: 'center', gap: '8px', border: '1px solid #bfdbfe', background: '#ffffff', color: '#1e3a8a', borderRadius: '999px', padding: '8px 12px', fontWeight: 700 },
  staffTagRemoveBtn: { width: '24px', height: '24px', borderRadius: '999px', border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer', fontWeight: 800, lineHeight: 1 },
  formGroup: { display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px', minWidth: 0 },
  formGroupCompact: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0, width: '100%', maxWidth: '260px' },
  label: { fontSize: '14px', color: '#334155', fontWeight: 700 },
  input: { width: '100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', border: '1px solid #cbd5e1', background: '#ffffff', color: '#0f172a', borderRadius: '12px', padding: '12px 14px', fontSize: '15px', outline: 'none' },
  dateInput: { width: '100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', border: '1px solid #cbd5e1', background: '#ffffff', color: '#0f172a', borderRadius: '12px', padding: '10px 10px', fontSize: '14px', outline: 'none', WebkitAppearance: 'none' },
  select: { width: '100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', border: '1px solid #cbd5e1', background: '#ffffff', color: '#0f172a', borderRadius: '12px', padding: '12px 10px', fontSize: '15px', outline: 'none', cursor: 'pointer' },
  textarea: { width: '100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', minHeight: '110px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#0f172a', borderRadius: '12px', padding: '12px 14px', fontSize: '15px', outline: 'none', resize: 'vertical' },
  quickSection: { border: '1px solid #bfdbfe', background: 'linear-gradient(135deg, #eff6ff 0%, #f8fbff 100%)', borderRadius: '16px', padding: '13px', marginBottom: '16px' },
  quickHeading: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '11px' },
  quickTitle: { fontSize: '15px', color: '#0f172a', fontWeight: 800 },
  quickHint: { marginTop: '3px', fontSize: '12px', color: '#64748b', fontWeight: 600, lineHeight: 1.35 },
  quickBadge: { flexShrink: 0, borderRadius: '999px', background: '#dbeafe', color: '#1d4ed8', padding: '5px 8px', fontSize: '11px', fontWeight: 800 },
  quickGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '9px' },
  quickBtn: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px', border: '1px solid #2563eb', background: '#2563eb', color: '#ffffff', borderRadius: '13px', padding: '12px', minHeight: '62px', cursor: 'pointer', textAlign: 'left', boxShadow: '0 8px 18px rgba(37,99,235,0.18)' },
  customDivider: { display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '3px 0 14px' },
  slotList: { display: 'flex', flexDirection: 'column', gap: '10px' },
  slotWrap: { minWidth: 0 },
  slotRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 20px minmax(0, 1fr) 38px 38px', gap: '6px', alignItems: 'center' },
  slotSelect: { width: '100%', minWidth: 0, boxSizing: 'border-box', border: '1px solid #cbd5e1', background: '#ffffff', color: '#0f172a', borderRadius: '12px', padding: '11px 8px', fontSize: '14px', outline: 'none', cursor: 'pointer' },
  toLabel: { fontWeight: 700, color: '#475569' },
  iconBtn: { width: '38px', height: '38px', borderRadius: '10px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#0f172a', fontSize: '22px', lineHeight: 1, cursor: 'pointer' },
  nextDayHint: { display: 'inline-flex', gap: '5px', alignItems: 'center', marginTop: '6px', marginLeft: 'calc(50% + 14px)', borderRadius: '999px', background: '#fef3c7', color: '#92400e', padding: '5px 9px', fontSize: '11px', fontWeight: 700 },
  totalRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '12px 14px', marginBottom: '14px' },
  totalLabel: { fontSize: '14px', fontWeight: 700, color: '#475569' },
  totalValue: { fontSize: '22px', fontWeight: 800, color: '#0f172a' },
  filterRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: '12px', flexWrap: 'wrap', marginBottom: '14px', minWidth: 0 },
  actionRow: { display: 'flex', justifyContent: 'flex-end', gap: '10px', flexWrap: 'wrap', marginTop: '6px', minWidth: 0 },
  bulkIntro: { display: 'flex', flexDirection: 'column', gap: '4px', borderLeft: '4px solid #2563eb', background: '#eff6ff', color: '#1e3a8a', borderRadius: '10px', padding: '11px 13px', marginBottom: '14px', fontSize: '13px', lineHeight: 1.4 },
  bulkCalendarHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', margin: '4px 0 10px', color: '#0f172a' },
  monthInput: { minWidth: '165px', boxSizing: 'border-box', border: '1px solid #cbd5e1', background: '#ffffff', color: '#0f172a', borderRadius: '12px', padding: '10px', fontSize: '14px', fontWeight: 800, outline: 'none' },
  selectionSummary: { display: 'flex', alignItems: 'baseline', gap: '7px', margin: '11px 0 14px', color: '#166534' },
  bulkSaveBtn: { width: '100%', minHeight: '48px', fontSize: '15px', background: '#166534' },
  primaryBtn: { border: 'none', background: '#0f172a', color: '#ffffff', borderRadius: '12px', padding: '12px 14px', fontWeight: 700, cursor: 'pointer', minWidth: 0 },
  secondaryBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', border: '1px solid #cbd5e1', background: '#ffffff', color: '#0f172a', borderRadius: '12px', padding: '12px 14px', fontWeight: 700, minWidth: 0 },
  secondaryActionBtn: { border: '1px solid #cbd5e1', background: '#ffffff', color: '#0f172a', borderRadius: '12px', padding: '10px 14px', fontWeight: 700, cursor: 'pointer' },
  deleteBtn: { border: '1px solid #ef4444', background: '#fff', color: '#ef4444', borderRadius: '12px', padding: '10px 14px', fontWeight: 700, cursor: 'pointer' },
  errorBox: { marginBottom: '14px', background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: '12px', padding: '12px 14px', fontWeight: 600 },
  successBox: { marginBottom: '14px', background: '#ecfdf5', color: '#166534', border: '1px solid #bbf7d0', borderRadius: '12px', padding: '12px 14px', fontWeight: 600 },
  emptyState: { border: '1px dashed #cbd5e1', background: '#f8fafc', borderRadius: '14px', padding: '24px', textAlign: 'center', color: '#64748b', fontWeight: 600 },
  cardsWrap: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: '12px' },
  entryCard: { border: '1px solid #e2e8f0', borderRadius: '18px', background: '#ffffff', padding: '14px', minWidth: 0 },
  entryTopRow: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap', minWidth: 0 },
  entryTitle: { fontSize: '20px', fontWeight: 800, color: '#0f172a', lineHeight: 1.2 },
  entrySubTitle: { fontSize: '14px', color: '#475569', marginTop: '6px', overflowWrap: 'anywhere' },
  hourBadge: { borderRadius: '999px', padding: '8px 12px', fontWeight: 800, fontSize: '12px', whiteSpace: 'nowrap' },
  hourBadgeNormal: { background: '#ecfdf5', color: '#166534' },
  hourBadgeAlert: { background: '#fef2f2', color: '#b91c1c' },
  metaGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px', marginTop: '14px' },
  metaItem: { border: '1px solid #e2e8f0', borderRadius: '12px', padding: '10px', background: '#f8fafc' },
  metaLabel: { fontSize: '12px', color: '#64748b', fontWeight: 700, marginBottom: '4px' },
  metaValue: { fontSize: '14px', color: '#0f172a', fontWeight: 800, wordBreak: 'break-word' },
  reasonBox: { marginTop: '12px', border: '1px solid #fde68a', background: '#fffbeb', borderRadius: '12px', padding: '12px 14px' },
  reasonLabel: { fontSize: '12px', color: '#92400e', fontWeight: 800, marginBottom: '4px' },
  reasonText: { fontSize: '14px', color: '#78350f', lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  cardActions: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '14px' },
  reportTableWrap: { overflowX: 'auto', WebkitOverflowScrolling: 'touch' },
  table: { width: '100%', minWidth: '520px', borderCollapse: 'collapse' },
  th: { textAlign: 'left', borderBottom: '1px solid #cbd5e1', padding: '12px 10px', fontSize: '13px', color: '#334155', background: '#f8fafc' },
  td: { borderBottom: '1px solid #e2e8f0', padding: '12px 10px', fontSize: '14px', color: '#0f172a', verticalAlign: 'top' },
  tdStrong: { borderBottom: '1px solid #e2e8f0', padding: '12px 10px', fontSize: '14px', color: '#0f172a', verticalAlign: 'top', fontWeight: 800, whiteSpace: 'nowrap' },
  emptyTableCell: { borderBottom: '1px solid #e2e8f0', padding: '18px 10px', fontSize: '14px', color: '#64748b', textAlign: 'center' },
  reportEntryList: { display: 'flex', flexDirection: 'column', gap: '8px' },
  reportEntryRow: { lineHeight: 1.5 },
  centerCard: { maxWidth: '460px', margin: '80px auto', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '18px', padding: '24px', textAlign: 'center', boxShadow: '0 10px 24px rgba(15,23,42,0.05)' },
  centerTitle: { fontSize: '24px', fontWeight: 800, color: '#0f172a', marginBottom: '10px' },
  centerText: { fontSize: '15px', color: '#64748b', lineHeight: 1.5, marginBottom: '16px' },
  linkBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', border: '1px solid #0f172a', background: '#0f172a', color: '#ffffff', borderRadius: '12px', padding: '12px 16px', fontWeight: 700 },
};
