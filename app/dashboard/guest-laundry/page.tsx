'use client';

import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type UserRole = 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT';
type ServiceType = 'standard' | 'express';
type LaundryStatus = 'PENDING_PICK_UP' | 'TAKEN' | 'PENDING_GUEST_COLLECTION' | 'GUEST_COLLECTED' | 'SENT_BACK';

type Profile = {
  user_id: string;
  email: string;
  name: string;
  role: UserRole;
  permissions?: Record<string, any>;
  can_access_guest_laundry?: boolean;
};

type GuestLaundryEntry = {
  id: string;
  room_number: string;
  service_type: ServiceType;
  weight_kg: number;
  rounded_weight_kg: number;
  charge_myr: number;
  turnaround_text: string;
  paid: boolean;
  invoice_number: string | null;
  status: LaundryStatus;
  scale_photo_url: string;
  scale_photo_path: string | null;
  created_by_name: string | null;
  updated_by_name: string | null;
  sent_back_at: string | null;
  collected_at: string | null;
  created_at: string;
  updated_at: string;
};

type EntryDraft = {
  id?: string;
  roomNumber: string;
  serviceType: ServiceType;
  weightInput: string;
  paid: boolean;
  invoiceNumber: string;
  photoFile: File | null;
  existingPhotoUrl?: string;
  existingPhotoPath?: string | null;
};

const BASE_KG = 2;
const STANDARD_BASE = 30;
const EXPRESS_BASE = 40;
const ADDITIONAL_RATE = 15;

const EMPTY_DRAFT: EntryDraft = {
  roomNumber: '',
  serviceType: 'standard',
  weightInput: '',
  paid: false,
  invoiceNumber: '',
  photoFile: null,
};

const STATUS_META: Record<LaundryStatus, { label: string; color: string; bg: string }> = {
  PENDING_PICK_UP: { label: 'Pending Pick Up', color: '#7c3aed', bg: '#f3e8ff' },
  TAKEN: { label: 'Taken', color: '#1d4ed8', bg: '#eff6ff' },
  PENDING_GUEST_COLLECTION: { label: 'Pending Guest Collection', color: '#b45309', bg: '#fffbeb' },
  SENT_BACK: { label: 'Pending Guest Collection', color: '#b45309', bg: '#fffbeb' },
  GUEST_COLLECTED: { label: 'Guest Collected', color: '#047857', bg: '#ecfdf5' },
};

const ACTIVE_STATUS_FILTERS: Array<'ALL' | LaundryStatus> = [
  'ALL',
  'PENDING_PICK_UP',
  'TAKEN',
  'PENDING_GUEST_COLLECTION',
  'GUEST_COLLECTED',
];

function normalizeLaundryStatus(status: LaundryStatus): LaundryStatus {
  return status === 'SENT_BACK' ? 'PENDING_GUEST_COLLECTION' : status;
}

function normalizeEmail(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

function canUseGuestLaundry(profile: Profile | null) {
  if (!profile) return false;
  const role = String(profile.role || '').trim().toUpperCase();
  if (role === 'SUPERUSER' || role === 'FO') return true;
  const email = normalizeEmail(profile.email);
  return (
    email === 'walter@hotelhallmark.com' ||
    email === 'fenny@hotelhallmark.com' ||
    profile.can_access_guest_laundry === true ||
    profile.permissions?.can_access_guest_laundry === true
  );
}

function normalizeProfileFromSession(rawUser: any): Profile {
  const permissions = rawUser?.permissions || {};
  const role = String(rawUser?.role || permissions?.role || '').trim().toUpperCase();
  return {
    user_id: String(rawUser?.user_id || rawUser?.id || ''),
    email: String(rawUser?.email || '').trim().toLowerCase(),
    name: String(rawUser?.name || rawUser?.email || 'User'),
    role: (role || 'FO') as UserRole,
    permissions,
    can_access_guest_laundry:
      rawUser?.can_access_guest_laundry === true ||
      permissions?.can_access_guest_laundry === true,
  };
}

function parseWeight(value: string) {
  const parsed = Number(String(value || '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function roundOneDecimal(value: number) {
  return Math.round(value * 10) / 10;
}

function calculateCharge(serviceType: ServiceType, rawWeight: number | null) {
  if (rawWeight === null) return null;
  const base = serviceType === 'express' ? EXPRESS_BASE : STANDARD_BASE;
  if (rawWeight <= BASE_KG) return base;
  return base + (rawWeight - BASE_KG) * ADDITIONAL_RATE;
}

function serviceLabel(serviceType: ServiceType) {
  return serviceType === 'express' ? 'Express Service' : 'Standard Service';
}

function serviceTurnaround(serviceType: ServiceType) {
  return serviceType === 'express' ? '~4 hours' : '~7 hours';
}

function formatMoney(value: number | null) {
  if (value === null) return 'RM0.00';
  return `RM${Number(value).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(value));
}

function sevenDaysAgoIso() {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function todayLocalDate() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dataUrlFromFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function imageToCompressedDataUrl(file: File) {
  const dataUrl = await dataUrlFromFile(file);
  const img = await loadImage(dataUrl);
  const maxSide = 1400;
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.78);
}

function Icon({
  name,
}: {
  name: 'receipt' | 'scale' | 'clock' | 'spark' | 'reset' | 'print' | 'camera' | 'edit' | 'trash' | 'check';
}) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  } as const;

  if (name === 'receipt') {
    return <svg {...common}><path d="M6 3h12v18l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2L6 21V3Z" /><path d="M9 8h6" /><path d="M9 12h6" /><path d="M9 16h4" /></svg>;
  }
  if (name === 'scale') {
    return <svg {...common}><path d="M7 20h10" /><path d="M12 4v16" /><path d="M5 7h14" /><path d="m7 7-3 6h6L7 7Z" /><path d="m17 7-3 6h6l-3-6Z" /></svg>;
  }
  if (name === 'clock') {
    return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>;
  }
  if (name === 'print') {
    return <svg {...common}><path d="M7 8V4h10v4" /><path d="M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" /><path d="M7 14h10v7H7z" /></svg>;
  }
  if (name === 'reset') {
    return <svg {...common}><path d="M4 12a8 8 0 1 0 2.3-5.7" /><path d="M4 5v5h5" /></svg>;
  }
  if (name === 'camera') {
    return <svg {...common}><path d="M7 7h.01" /><path d="M6 20h12a3 3 0 0 0 3-3V9a3 3 0 0 0-3-3h-2l-1.5-2h-5L8 6H6a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3Z" /><circle cx="12" cy="13" r="4" /></svg>;
  }
  if (name === 'edit') {
    return <svg {...common}><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" /><path d="m14 7 3 3" /></svg>;
  }
  if (name === 'trash') {
    return <svg {...common}><path d="M4 7h16" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M6 7l1 14h10l1-14" /><path d="M9 7V4h6v3" /></svg>;
  }
  if (name === 'check') {
    return <svg {...common}><path d="m5 13 4 4L19 7" /></svg>;
  }
  return <svg {...common}><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z" /><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z" /></svg>;
}

export default function GuestLaundryPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [entries, setEntries] = useState<GuestLaundryEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<EntryDraft>(EMPTY_DRAFT);
  const [editing, setEditing] = useState<EntryDraft | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | LaundryStatus>('ALL');

  const rawWeight = useMemo(() => parseWeight(draft.weightInput), [draft.weightInput]);
  const roundedWeight = rawWeight === null ? null : roundOneDecimal(rawWeight);
  const charge = calculateCharge(draft.serviceType, rawWeight);
  const canUse = canUseGuestLaundry(profile);
  const isSuperuser = profile?.role === 'SUPERUSER';

  useEffect(() => {
    let mounted = true;
    async function loadProfile() {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error('Login required');

        const res = await fetch('/api/session-profile', {
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const json = await res.json();
        if (!res.ok || !json?.ok) throw new Error(json?.error || 'Unable to load profile');
        if (!mounted) return;
        setProfile(normalizeProfileFromSession(json.user));
      } catch (error: any) {
        if (mounted) setErrorMsg(error?.message || 'Unable to load profile');
      } finally {
        if (mounted) setLoadingProfile(false);
      }
    }
    void loadProfile();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (canUse) void loadEntries();
  }, [canUse]);

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token || '';
  }

  async function loadEntries() {
    try {
      setLoadingEntries(true);
      const { data, error } = await supabase
        .from('guest_laundry_entries')
        .select('*')
        .gte('created_at', sevenDaysAgoIso())
        .order('created_at', { ascending: false });
      if (error) throw error;
      setEntries((data || []) as GuestLaundryEntry[]);
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to load Guest Laundry entries');
    } finally {
      setLoadingEntries(false);
    }
  }

  function updateDraft<K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function updateEditing<K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) {
    setEditing((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function setQuickWeight(value: number) {
    updateDraft('weightInput', String(value));
  }

  function addWeight(value: number) {
    const current = rawWeight || 0;
    updateDraft('weightInput', Math.max(0, roundOneDecimal(current + value)).toFixed(1));
  }

  function resetDraft() {
    setDraft(EMPTY_DRAFT);
    const input = document.getElementById('guest-laundry-photo') as HTMLInputElement | null;
    if (input) input.value = '';
  }

  async function uploadPhoto(file: File) {
    const token = await getAccessToken();
    if (!token) throw new Error('Login required');
    const image = await imageToCompressedDataUrl(file);
    const res = await fetch('/api/guest-laundry/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ image }),
    });
    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error || 'Photo upload failed');
    return {
      url: String(json.url || ''),
      path: String(json.path || ''),
    };
  }

  function validateDraft(nextDraft: EntryDraft, requirePhoto: boolean) {
    const weight = parseWeight(nextDraft.weightInput);
    const nextCharge = calculateCharge(nextDraft.serviceType, weight);
    if (!nextDraft.roomNumber.trim()) throw new Error('Room number is required');
    if (weight === null || nextCharge === null) throw new Error('Laundry weight is required');
    if (requirePhoto && !nextDraft.photoFile) throw new Error('Photo of weighing scale is required');
    return {
      weight,
      rounded: roundOneDecimal(weight),
      charge: nextCharge,
    };
  }

  async function createEntry() {
    try {
      if (!profile?.user_id) throw new Error('Login required');
      if (!canUse) throw new Error('Access denied');
      const calculated = validateDraft(draft, true);
      if (!draft.photoFile) throw new Error('Photo of weighing scale is required');

      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');

      const uploaded = await uploadPhoto(draft.photoFile);
      const payload = {
        room_number: draft.roomNumber.trim(),
        service_type: draft.serviceType,
        weight_kg: calculated.weight,
        rounded_weight_kg: calculated.rounded,
        charge_myr: calculated.charge,
        turnaround_text: serviceTurnaround(draft.serviceType),
        paid: draft.paid,
        invoice_number: draft.invoiceNumber.trim() || null,
        status: 'PENDING_PICK_UP' as LaundryStatus,
        scale_photo_url: uploaded.url,
        scale_photo_path: uploaded.path,
        created_by_user_id: profile.user_id,
        created_by_name: profile.name || profile.email,
        updated_by_user_id: profile.user_id,
        updated_by_name: profile.name || profile.email,
      };

      const { error } = await supabase.from('guest_laundry_entries').insert([payload]);
      if (error) throw error;
      setSuccessMsg('Guest laundry entry created.');
      resetDraft();
      await loadEntries();
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to create entry');
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    if (!editing?.id || !profile?.user_id) return;
    try {
      const calculated = validateDraft(editing, false);
      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');

      let photoUrl = editing.existingPhotoUrl || '';
      let photoPath = editing.existingPhotoPath || null;
      if (editing.photoFile) {
        const uploaded = await uploadPhoto(editing.photoFile);
        photoUrl = uploaded.url;
        photoPath = uploaded.path;
      }
      if (!photoUrl) throw new Error('Photo of weighing scale is required');

      const payload = {
        room_number: editing.roomNumber.trim(),
        service_type: editing.serviceType,
        weight_kg: calculated.weight,
        rounded_weight_kg: calculated.rounded,
        charge_myr: calculated.charge,
        turnaround_text: serviceTurnaround(editing.serviceType),
        paid: editing.paid,
        invoice_number: editing.invoiceNumber.trim() || null,
        scale_photo_url: photoUrl,
        scale_photo_path: photoPath,
        updated_by_user_id: profile.user_id,
        updated_by_name: profile.name || profile.email,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('guest_laundry_entries')
        .update(payload)
        .eq('id', editing.id);
      if (error) throw error;
      setSuccessMsg('Guest laundry entry updated.');
      setEditing(null);
      await loadEntries();
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to update entry');
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(entry: GuestLaundryEntry, nextStatus: LaundryStatus) {
    try {
      if (!profile?.user_id) throw new Error('Login required');
      if (nextStatus === 'GUEST_COLLECTED') {
        if (!entry.invoice_number?.trim()) throw new Error('Invoice number is required before Guest Collected');
        if (!entry.paid) throw new Error('Payment must be marked as collected before Guest Collected');
      }

      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');
      const now = new Date().toISOString();
      const payload: any = {
        status: nextStatus,
        updated_by_user_id: profile.user_id,
        updated_by_name: profile.name || profile.email,
        updated_at: now,
      };
      if (nextStatus === 'PENDING_GUEST_COLLECTION') payload.sent_back_at = entry.sent_back_at || now;
      if (nextStatus === 'GUEST_COLLECTED') payload.collected_at = entry.collected_at || now;

      const { error } = await supabase
        .from('guest_laundry_entries')
        .update(payload)
        .eq('id', entry.id);
      if (error) throw error;
      setSuccessMsg(`Status updated to ${STATUS_META[nextStatus].label}.`);
      await loadEntries();
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to update status');
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(entry: GuestLaundryEntry) {
    if (!isSuperuser) return;
    if (!window.confirm(`Delete guest laundry entry for room ${entry.room_number}?`)) return;
    try {
      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');
      const { error } = await supabase.from('guest_laundry_entries').delete().eq('id', entry.id);
      if (error) throw error;
      setSuccessMsg('Entry deleted.');
      await loadEntries();
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to delete entry');
    } finally {
      setSaving(false);
    }
  }

  function openEdit(entry: GuestLaundryEntry) {
    setEditing({
      id: entry.id,
      roomNumber: entry.room_number,
      serviceType: entry.service_type,
      weightInput: String(entry.weight_kg),
      paid: entry.paid,
      invoiceNumber: entry.invoice_number || '',
      photoFile: null,
      existingPhotoUrl: entry.scale_photo_url,
      existingPhotoPath: entry.scale_photo_path,
    });
  }

  const filteredEntries = entries.filter((entry) => {
    const normalized = normalizeLaundryStatus(entry.status);
    return statusFilter === 'ALL' ? true : normalized === statusFilter;
  });
  const pendingPickupCount = entries.filter((entry) => normalizeLaundryStatus(entry.status) === 'PENDING_PICK_UP').length;
  const takenCount = entries.filter((entry) => entry.status === 'TAKEN').length;
  const pendingCollectionCount = entries.filter((entry) => normalizeLaundryStatus(entry.status) === 'PENDING_GUEST_COLLECTION').length;
  const collectedCount = entries.filter((entry) => entry.status === 'GUEST_COLLECTED').length;

  if (loadingProfile) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>Loading Guest Laundry...</div>
      </main>
    );
  }

  if (!canUse) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>
          <h1 style={styles.deniedTitle}>Access denied</h1>
          <p style={styles.muted}>Guest Laundry is available to Superuser, Front Office, Walter, and Fenny.</p>
          <Link href="/dashboard" style={styles.primaryButton}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div style={styles.heroBrand}>
          <div style={styles.logoFrame}>
            <img src="/logo.png" alt="Hallmark Crown Hotel logo" style={styles.logo} />
          </div>
          <div>
            <div style={styles.eyebrow}>Front Office POS</div>
            <h1 style={styles.title}>Guest Laundry</h1>
            <p style={styles.subtitle}>Create laundry entries, track payment, invoice, and collection status.</p>
          </div>
        </div>
        <Link href="/dashboard" style={styles.secondaryButton}>Back to Dashboard</Link>
      </section>

      {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}
      {successMsg ? <div style={styles.successBox}>{successMsg}</div> : null}

      <section style={styles.statsGrid}>
        <StatCard label="Pending Pick Up" value={pendingPickupCount} tone="purple" />
        <StatCard label="Taken" value={takenCount} tone="blue" />
        <StatCard label="Pending Guest Collection" value={pendingCollectionCount} tone="amber" />
        <StatCard label="Guest Collected" value={collectedCount} tone="green" />
      </section>

      <section style={styles.workspace}>
        <section style={styles.calculatorCard}>
          <div style={styles.cardHeader}>
            <div>
              <div style={styles.cardLabel}>New Entry</div>
              <h2 style={styles.cardTitle}>Laundry intake</h2>
            </div>
            <div style={styles.iconBadge}><Icon name="scale" /></div>
          </div>

          <EntryForm
            draft={draft}
            updateDraft={updateDraft}
            rawWeight={rawWeight}
            roundedWeight={roundedWeight}
            charge={charge}
            setQuickWeight={setQuickWeight}
            addWeight={addWeight}
            inputId="guest-laundry-photo"
            showPaymentControl={false}
          />

          <div style={styles.actionRow}>
            <button type="button" onClick={resetDraft} disabled={saving} style={styles.secondaryAction}>
              <Icon name="reset" /> Reset
            </button>
            <button type="button" onClick={() => void createEntry()} disabled={saving} style={styles.primaryAction}>
              <Icon name="check" /> {saving ? 'Saving...' : 'Submit Entry'}
            </button>
          </div>
        </section>

        <aside style={styles.receiptCard}>
          <div style={styles.receiptTop}>
            <div>
              <div style={styles.cardLabel}>Customer Quote</div>
              <h2 style={styles.receiptTitle}>Laundry Charge</h2>
            </div>
            <div style={styles.iconBadgeGold}><Icon name="receipt" /></div>
          </div>

          <div style={styles.totalPanel}>
            <span style={styles.totalLabel}>Total Amount</span>
            <strong style={styles.totalValue}>{formatMoney(charge)}</strong>
            <span style={styles.totalHint}>
              {rawWeight === null
                ? 'Enter weight to calculate'
                : `${serviceLabel(draft.serviceType)} - ${serviceTurnaround(draft.serviceType)}`}
            </span>
          </div>

          <label style={styles.receiptPaymentRow}>
            <input
              type="checkbox"
              checked={draft.paid}
              onChange={(event) => updateDraft('paid', event.target.checked)}
            />
            <span>Payment collected</span>
          </label>

          <div style={styles.breakdown}>
            <Row label="Room" value={draft.roomNumber.trim() || '-'} />
            <Row label="Service" value={serviceLabel(draft.serviceType)} />
            <Row label="Rounded Weight" value={roundedWeight === null ? '-' : `${roundedWeight.toFixed(1)} kg`} />
            <Row label="Base" value={formatMoney(draft.serviceType === 'express' ? EXPRESS_BASE : STANDARD_BASE)} />
            <Row label="Extra Weight" value={rawWeight === null ? '-' : `${Math.max(0, rawWeight - BASE_KG).toFixed(2)} kg`} />
            <Row label="Turnaround" value={serviceTurnaround(draft.serviceType)} />
          </div>

          <div style={styles.noticeGrid}>
            <div style={styles.noticeCard}><Icon name="clock" /><span>Collection 9AM - 6PM only</span></div>
            <div style={styles.noticeCard}><Icon name="spark" /><span>Invoice required before collection</span></div>
          </div>
        </aside>
      </section>

      <section style={styles.historyPanel}>
        <div style={styles.historyHead}>
          <div>
            <div style={styles.cardLabel}>7 Days History</div>
            <h2 style={styles.cardTitle}>Laundry entries</h2>
          </div>
          <div style={styles.filterPills}>
            {ACTIVE_STATUS_FILTERS.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                style={{
                  ...styles.filterPill,
                  ...(statusFilter === status ? styles.filterPillActive : {}),
                }}
              >
                {status === 'ALL' ? 'All' : STATUS_META[status].label}
              </button>
            ))}
          </div>
        </div>

        {loadingEntries ? (
          <div style={styles.emptyBox}>Loading entries...</div>
        ) : filteredEntries.length ? (
          <div style={styles.entryList}>
            {filteredEntries.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                saving={saving}
                isSuperuser={!!isSuperuser}
                onEdit={() => openEdit(entry)}
                onDelete={() => void deleteEntry(entry)}
                onStatus={(status) => void updateStatus(entry, status)}
                onPrint={() => printAcknowledgementSlip(entry)}
              />
            ))}
          </div>
        ) : (
          <div style={styles.emptyBox}>No guest laundry entries found for this filter.</div>
        )}
      </section>

      {editing ? (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            <div style={styles.modalHead}>
              <div>
                <div style={styles.cardLabel}>Edit Entry</div>
                <h2 style={styles.cardTitle}>Room {editing.roomNumber || '-'}</h2>
              </div>
              <button type="button" onClick={() => setEditing(null)} style={styles.closeButton}>x</button>
            </div>
            <EntryForm
              draft={editing}
              updateDraft={updateEditing}
              rawWeight={parseWeight(editing.weightInput)}
              roundedWeight={parseWeight(editing.weightInput) === null ? null : roundOneDecimal(parseWeight(editing.weightInput) as number)}
              charge={calculateCharge(editing.serviceType, parseWeight(editing.weightInput))}
              setQuickWeight={(value) => updateEditing('weightInput', String(value))}
              addWeight={(value) => {
                const current = parseWeight(editing.weightInput) || 0;
                updateEditing('weightInput', Math.max(0, roundOneDecimal(current + value)).toFixed(1));
              }}
              inputId="guest-laundry-edit-photo"
              editMode
            />
            <div style={styles.actionRow}>
              <button type="button" onClick={() => setEditing(null)} disabled={saving} style={styles.secondaryAction}>Cancel</button>
              <button type="button" onClick={() => void saveEdit()} disabled={saving} style={styles.primaryAction}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'purple' | 'blue' | 'amber' | 'green' }) {
  const toneStyle = tone === 'purple' ? styles.purpleTone : tone === 'green' ? styles.greenTone : tone === 'amber' ? styles.amberTone : styles.blueTone;
  return (
    <div style={styles.statCard}>
      <div style={{ ...styles.statIcon, ...toneStyle }}><Icon name={tone === 'green' ? 'check' : tone === 'amber' ? 'clock' : tone === 'purple' ? 'spark' : 'receipt'} /></div>
      <div>
        <div style={styles.statLabel}>{label}</div>
        <div style={styles.statValue}>{value}</div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.breakdownRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const LAUNDRY_TERMS = [
  'Laundry service is provided at the guest request and at the guest own risk.',
  'The hotel is not liable for any damages, shrinkage, colour run, fading, torn fabric, loose buttons, damaged zips, ornaments, prints, beads, lace, leather, delicate material, or pre-existing garment defects.',
  'The hotel is not liable for missing items.',
  'The hotel is not responsible for valuables, cash, documents, room keys, or personal items left inside laundry pockets.',
  'Stain removal is not guaranteed.',
  'Estimated return time is an estimate only and may change due to laundry load, weather, equipment issues, or contractor delay.',
  'Any concern must be raised immediately upon collection before leaving the counter.',
];

function escapeHtml(value: any) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function printAcknowledgementSlip(entry: GuestLaundryEntry) {
  const win = window.open('', '_blank', 'width=900,height=1100');
  if (!win) return;
  const terms = LAUNDRY_TERMS.map((term) => `<li>${escapeHtml(term)}</li>`).join('');
  const logoUrl = `${window.location.origin}/logo.png`;
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Guest Laundry Acknowledgement - Room ${entry.room_number}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 28px; color: #0f172a; font-family: Arial, sans-serif; background: #fff; }
    .page { max-width: 820px; margin: 0 auto; border: 1px solid #d8c7a7; border-radius: 18px; padding: 28px; }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 18px; border-bottom: 2px solid #d8c7a7; padding-bottom: 18px; }
    .brand { display: flex; align-items: center; gap: 14px; }
    .logo { width: 58px; height: 58px; object-fit: contain; border: 1px solid #d8c7a7; border-radius: 14px; padding: 6px; }
    .hotel { font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: #8a6337; font-weight: 800; }
    h1 { margin: 3px 0 0; font-size: 25px; }
    .date { color: #64748b; font-weight: 700; text-align: right; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 22px 0; }
    .box { border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px; }
    .label { color: #64748b; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .value { margin-top: 5px; font-size: 18px; font-weight: 900; }
    .price { color: #1d4ed8; font-size: 28px; }
    h2 { margin: 20px 0 8px; font-size: 17px; }
    ol { margin: 8px 0 0 20px; padding: 0; line-height: 1.45; font-size: 13px; }
    .signatures { display: grid; grid-template-columns: 1fr; gap: 14px; margin-top: 22px; }
    .sig { min-height: 112px; border: 1px solid #cbd5e1; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; justify-content: flex-end; }
    .line { border-top: 1px solid #0f172a; padding-top: 8px; font-weight: 800; }
    .small { margin-top: 6px; color: #64748b; font-size: 12px; font-weight: 700; }
    .collection { margin-top: 18px; padding: 14px; border: 1px solid #bfdbfe; background: #eff6ff; border-radius: 14px; font-size: 13px; font-weight: 800; }
    @media print { body { padding: 0; } .page { border: 0; border-radius: 0; } }
  </style>
</head>
<body>
  <main class="page">
    <section class="head">
      <div class="brand">
        <img class="logo" src="${logoUrl}" />
        <div>
          <div class="hotel">Hallmark Crown Hotel</div>
          <h1>Guest Laundry Acknowledgement</h1>
        </div>
      </div>
      <div class="date">${new Date().toLocaleString('en-SG')}</div>
    </section>
    <section class="grid">
      <div class="box"><div class="label">Room</div><div class="value">${escapeHtml(entry.room_number)}</div></div>
      <div class="box"><div class="label">Service</div><div class="value">${escapeHtml(serviceLabel(entry.service_type))}</div></div>
      <div class="box"><div class="label">Weight</div><div class="value">${Number(entry.rounded_weight_kg).toFixed(1)} kg</div></div>
      <div class="box"><div class="label">Expected Return</div><div class="value">${escapeHtml(entry.turnaround_text || serviceTurnaround(entry.service_type))}</div></div>
      <div class="box"><div class="label">Invoice</div><div class="value">${escapeHtml(entry.invoice_number || 'Pending')}</div></div>
      <div class="box"><div class="label">Price</div><div class="value price">${formatMoney(Number(entry.charge_myr))}</div></div>
    </section>
    <h2>Terms and Conditions</h2>
    <ol>${terms}</ol>
    <section class="signatures">
      <div class="sig"><div class="line">Guest signature at laundry handover</div><div class="small">I agree to the laundry terms above.</div></div>
    </section>
    <div class="collection">Collection confirmation: I acknowledge that the laundry has been returned to me in full and in satisfactory condition at the time of collection.</div>
    <section class="signatures">
      <div class="sig"><div class="line">Guest signature upon collection</div></div>
    </section>
  </main>
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`;
  win.document.write(html);
  win.document.close();
}

function EntryForm({
  draft,
  updateDraft,
  rawWeight,
  roundedWeight,
  charge,
  setQuickWeight,
  addWeight,
  inputId,
  editMode = false,
  showPaymentControl = true,
}: {
  draft: EntryDraft;
  updateDraft: <K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) => void;
  rawWeight: number | null;
  roundedWeight: number | null;
  charge: number | null;
  setQuickWeight: (value: number) => void;
  addWeight: (value: number) => void;
  inputId: string;
  editMode?: boolean;
  showPaymentControl?: boolean;
}) {
  return (
    <>
      <div style={styles.formGrid}>
        <label style={styles.label}>
          Room Number
          <input
            value={draft.roomNumber}
            onChange={(event) => updateDraft('roomNumber', event.target.value.replace(/[^\d]/g, '').slice(0, 5))}
            placeholder="Example: 1205"
            inputMode="numeric"
            style={styles.input}
          />
        </label>

        <label style={styles.label}>
          Invoice Number
          <input
            value={draft.invoiceNumber}
            onChange={(event) => updateDraft('invoiceNumber', event.target.value.toUpperCase().slice(0, 40))}
            placeholder="Required before Guest Collected"
            style={styles.input}
          />
        </label>
      </div>

      <div style={styles.labelText}>Service Type</div>
      <div style={styles.serviceGrid}>
        {(['standard', 'express'] as ServiceType[]).map((service) => (
          <button
            key={service}
            type="button"
            onClick={() => updateDraft('serviceType', service)}
            style={{
              ...styles.serviceButton,
              ...(draft.serviceType === service ? styles.serviceButtonActive : {}),
            }}
          >
            <span style={styles.serviceTop}>{service === 'express' ? 'Express' : 'Standard'}</span>
            <strong style={styles.servicePrice}>{service === 'express' ? 'RM40' : 'RM30'}</strong>
            <span style={styles.serviceMeta}>First 2kg - {serviceTurnaround(service)}</span>
          </button>
        ))}
      </div>

      <label style={styles.label}>
        Weight (kg)
        <div style={styles.weightInputWrap}>
          <input
            value={draft.weightInput}
            onChange={(event) => updateDraft('weightInput', event.target.value.replace(/[^\d.]/g, '').slice(0, 6))}
            placeholder="0.0"
            inputMode="decimal"
            style={styles.weightInput}
          />
          <span style={styles.kgPill}>kg</span>
        </div>
      </label>

      <div style={styles.quickGrid}>
        {[1, 1.5, 2, 2.5, 3, 4].map((value) => (
          <button key={value} type="button" onClick={() => setQuickWeight(value)} style={styles.quickButton}>
            {value}kg
          </button>
        ))}
      </div>

      <div style={styles.stepperRow}>
        <button type="button" onClick={() => addWeight(-0.1)} style={styles.stepperButton}>-0.1</button>
        <button type="button" onClick={() => addWeight(0.1)} style={styles.stepperButton}>+0.1</button>
        <button type="button" onClick={() => addWeight(0.5)} style={styles.stepperButton}>+0.5</button>
      </div>

      <div style={styles.miniSummary}>
        <Row label="Rounded Weight" value={roundedWeight === null ? '-' : `${roundedWeight.toFixed(1)} kg`} />
        <Row label="Charge" value={formatMoney(charge)} />
        <Row label="Turnaround" value={serviceTurnaround(draft.serviceType)} />
      </div>

      {showPaymentControl ? (
        <label style={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={draft.paid}
            onChange={(event) => updateDraft('paid', event.target.checked)}
          />
          <span>Payment collected</span>
        </label>
      ) : null}

      <label style={styles.photoDrop}>
        <Icon name="camera" />
        <span>{editMode ? 'Replace weighing-scale photo' : 'Snap weighing-scale photo'}</span>
        <small>{draft.photoFile ? draft.photoFile.name : draft.existingPhotoUrl ? 'Existing photo saved' : 'Required before submission'}</small>
        <input
          id={inputId}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => updateDraft('photoFile', event.target.files?.[0] || null)}
          style={styles.hiddenInput}
        />
      </label>

      {draft.existingPhotoUrl ? (
        <a href={draft.existingPhotoUrl} target="_blank" rel="noreferrer" style={styles.photoLink}>View current photo</a>
      ) : null}

      {rawWeight !== null && rawWeight > BASE_KG ? (
        <div style={styles.hintBox}>
          Additional charge: {(rawWeight - BASE_KG).toFixed(2)}kg x RM{ADDITIONAL_RATE}
        </div>
      ) : null}
    </>
  );
}

function EntryCard({
  entry,
  saving,
  isSuperuser,
  onEdit,
  onDelete,
  onStatus,
  onPrint,
}: {
  entry: GuestLaundryEntry;
  saving: boolean;
  isSuperuser: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onStatus: (status: LaundryStatus) => void;
  onPrint: () => void;
}) {
  const currentStatus = normalizeLaundryStatus(entry.status);
  const meta = STATUS_META[currentStatus];
  const canCollect = !!entry.invoice_number?.trim() && entry.paid;
  return (
    <article style={styles.entryCard}>
      <div style={styles.entryMain}>
        <a href={entry.scale_photo_url} target="_blank" rel="noreferrer" style={styles.photoThumb}>
          <img src={entry.scale_photo_url} alt={`Room ${entry.room_number} weighing scale`} style={styles.photoThumbImg} />
        </a>
        <div style={styles.entryBody}>
          <div style={styles.entryTopLine}>
            <strong style={styles.entryRoom}>Room {entry.room_number}</strong>
            <span style={{ ...styles.statusPill, color: meta.color, background: meta.bg }}>{meta.label}</span>
          </div>
          <div style={styles.entryMeta}>
            {serviceLabel(entry.service_type)} - {Number(entry.rounded_weight_kg).toFixed(1)}kg - {formatMoney(entry.charge_myr)}
          </div>
          <div style={styles.entryMeta}>
            Invoice: <strong>{entry.invoice_number || 'Pending'}</strong> - Payment: <strong>{entry.paid ? 'Paid' : 'Unpaid'}</strong>
          </div>
          <div style={styles.entryTiny}>
            Created {formatDateTime(entry.created_at)} by {entry.created_by_name || '-'}
          </div>
        </div>
      </div>

      <div style={styles.entryActions}>
        <button type="button" onClick={onPrint} disabled={saving} style={styles.smallButton}><Icon name="print" /> Print Slip</button>
        <button type="button" onClick={onEdit} disabled={saving} style={styles.smallButton}><Icon name="edit" /> Edit</button>
        <select
          value={currentStatus}
          onChange={(event) => onStatus(event.target.value as LaundryStatus)}
          disabled={saving}
          style={styles.statusSelect}
          title={!canCollect ? 'Invoice number and payment collected are required before Guest Collected' : undefined}
        >
          <option value="PENDING_PICK_UP">Pending Pick Up</option>
          <option value="TAKEN">Taken</option>
          <option value="PENDING_GUEST_COLLECTION">Pending Guest Collection</option>
          <option value="GUEST_COLLECTED">Guest Collected</option>
        </select>
        {isSuperuser ? (
          <button type="button" onClick={onDelete} disabled={saving} style={styles.deleteButton}><Icon name="trash" /> Delete</button>
        ) : null}
      </div>
    </article>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    padding: 'clamp(16px, 3vw, 34px)',
    background:
      'radial-gradient(circle at 8% 0%, rgba(37,99,235,.10), transparent 28%), linear-gradient(135deg, #f6f9ff 0%, #edf4ff 100%)',
    color: '#0f172a',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    boxSizing: 'border-box',
  },
  hero: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 18,
    flexWrap: 'wrap',
    padding: 'clamp(16px, 2.2vw, 24px)',
    border: '1px solid #d7e3f4',
    borderRadius: 24,
    background: 'rgba(255,255,255,.92)',
    boxShadow: '0 18px 45px rgba(15,23,42,.08)',
    marginBottom: 18,
    maxWidth: 1180,
    marginLeft: 'auto',
    marginRight: 'auto',
    boxSizing: 'border-box',
  },
  heroBrand: { display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: '1 1 280px' },
  logoFrame: {
    width: 58,
    height: 58,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 18,
    background: '#fffaf0',
    border: '1px solid #e4cfaa',
    flex: '0 0 auto',
  },
  logo: { width: '82%', height: '82%', objectFit: 'contain' },
  eyebrow: {
    color: '#2563eb',
    fontSize: 12,
    fontWeight: 950,
    letterSpacing: '.12em',
    textTransform: 'uppercase',
  },
  title: {
    margin: '2px 0',
    fontSize: 'clamp(30px, 4vw, 44px)',
    lineHeight: 1,
    letterSpacing: '-.05em',
  },
  subtitle: { margin: 0, color: '#64748b', fontSize: 'clamp(13px, 1.6vw, 15px)', fontWeight: 700 },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
    gap: 12,
    marginBottom: 16,
    maxWidth: 1180,
    marginLeft: 'auto',
    marginRight: 'auto',
  },
  statCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 13,
    padding: 16,
    border: '1px solid #d7e3f4',
    borderRadius: 20,
    background: '#fff',
    boxShadow: '0 14px 34px rgba(15,23,42,.06)',
    boxSizing: 'border-box',
  },
  statIcon: { width: 42, height: 42, display: 'grid', placeItems: 'center', borderRadius: 14 },
  blueTone: { color: '#2563eb', background: '#eff6ff' },
  purpleTone: { color: '#7c3aed', background: '#f3e8ff' },
  amberTone: { color: '#b45309', background: '#fffbeb' },
  greenTone: { color: '#047857', background: '#ecfdf5' },
  statLabel: { color: '#64748b', fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '.08em' },
  statValue: { fontSize: 30, fontWeight: 950, letterSpacing: '-.05em' },
  workspace: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 430px), 1fr))',
    gap: 18,
    alignItems: 'start',
    maxWidth: 1180,
    marginLeft: 'auto',
    marginRight: 'auto',
  },
  calculatorCard: {
    padding: 'clamp(18px, 2.3vw, 28px)',
    border: '1px solid #d7e3f4',
    borderRadius: 24,
    background: '#fff',
    boxShadow: '0 18px 45px rgba(15,23,42,.08)',
    minWidth: 0,
    boxSizing: 'border-box',
    overflow: 'hidden',
  },
  receiptCard: {
    position: 'relative',
    top: 18,
    padding: 'clamp(18px, 2.3vw, 28px)',
    border: '1px solid #d7e3f4',
    borderRadius: 24,
    background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)',
    boxShadow: '0 18px 45px rgba(15,23,42,.10)',
    minWidth: 0,
    boxSizing: 'border-box',
  },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginBottom: 18 },
  receiptTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginBottom: 16 },
  cardLabel: { color: '#2563eb', fontSize: 12, fontWeight: 950, letterSpacing: '.1em', textTransform: 'uppercase' },
  cardTitle: { margin: '2px 0 0', fontSize: 28, letterSpacing: '-.04em' },
  receiptTitle: { margin: '2px 0 0', fontSize: 25, letterSpacing: '-.04em' },
  iconBadge: { width: 44, height: 44, display: 'grid', placeItems: 'center', borderRadius: 14, color: '#2563eb', background: '#eaf2ff' },
  iconBadgeGold: { width: 44, height: 44, display: 'grid', placeItems: 'center', borderRadius: 14, color: '#9a6a2f', background: '#fff4df' },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12 },
  label: { display: 'grid', gap: 8, marginBottom: 16, color: '#334155', fontSize: 13, fontWeight: 900, minWidth: 0 },
  labelText: { color: '#334155', fontSize: 13, fontWeight: 900, marginBottom: 8 },
  input: {
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    border: '1px solid #cbd9eb',
    borderRadius: 16,
    padding: '14px 15px',
    fontSize: 16,
    fontWeight: 800,
    color: '#0f172a',
    outline: 'none',
    background: '#fbfdff',
  },
  weightInputWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    border: '1px solid #cbd9eb',
    borderRadius: 18,
    padding: '5px 7px 5px 14px',
    background: '#fbfdff',
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
    overflow: 'hidden',
  },
  weightInput: {
    flex: 1,
    minWidth: 0,
    width: '100%',
    boxSizing: 'border-box',
    border: 0,
    outline: 'none',
    background: 'transparent',
    fontSize: 'clamp(30px, 8vw, 46px)',
    fontWeight: 950,
    letterSpacing: '-.05em',
    color: '#0f172a',
  },
  kgPill: { display: 'grid', placeItems: 'center', minWidth: 52, height: 42, borderRadius: 14, background: '#eef5ff', color: '#2563eb', fontWeight: 950 },
  serviceGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: 12, marginBottom: 16 },
  serviceButton: { appearance: 'none', border: '1px solid #d7e3f4', borderRadius: 18, background: '#f8fbff', padding: 15, textAlign: 'left', cursor: 'pointer', color: '#0f172a', width: '100%', boxSizing: 'border-box' },
  serviceButtonActive: { borderColor: '#2563eb', background: 'linear-gradient(135deg, #eff6ff 0%, #ffffff 100%)', boxShadow: '0 14px 30px rgba(37,99,235,.13)' },
  serviceTop: { display: 'block', color: '#64748b', fontSize: 12, fontWeight: 950, letterSpacing: '.08em', textTransform: 'uppercase' },
  servicePrice: { display: 'block', marginTop: 5, fontSize: 28, letterSpacing: '-.05em' },
  serviceMeta: { display: 'block', marginTop: 3, color: '#64748b', fontSize: 13, fontWeight: 750 },
  quickGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(74px, 1fr))', gap: 8, marginBottom: 10 },
  quickButton: { border: '1px solid #d7e3f4', borderRadius: 14, background: '#fff', color: '#0f172a', padding: '11px 8px', fontWeight: 900, cursor: 'pointer', boxSizing: 'border-box' },
  stepperRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 1fr))', gap: 8 },
  stepperButton: { border: '1px solid #bfdbfe', borderRadius: 14, background: '#eff6ff', color: '#1d4ed8', padding: '11px 8px', fontWeight: 950, cursor: 'pointer', boxSizing: 'border-box' },
  miniSummary: { marginTop: 12, border: '1px solid #e2e8f0', borderRadius: 16, overflow: 'hidden' },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    padding: 13,
    borderRadius: 16,
    background: '#f8fafc',
    color: '#0f172a',
    fontWeight: 900,
  },
  receiptPaymentRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    padding: 13,
    border: '1px solid #dbeafe',
    borderRadius: 16,
    background: '#eff6ff',
    color: '#0f172a',
    fontWeight: 950,
    boxSizing: 'border-box',
  },
  photoDrop: {
    display: 'grid',
    placeItems: 'center',
    gap: 8,
    marginTop: 14,
    padding: 18,
    border: '1px dashed #93c5fd',
    borderRadius: 18,
    background: '#eff6ff',
    color: '#1d4ed8',
    fontWeight: 950,
    textAlign: 'center',
    cursor: 'pointer',
    boxSizing: 'border-box',
  },
  hiddenInput: { display: 'none' },
  photoLink: { display: 'inline-flex', marginTop: 8, color: '#2563eb', fontWeight: 900, textDecoration: 'none' },
  hintBox: { marginTop: 12, padding: 12, borderRadius: 14, background: '#fffbeb', color: '#92400e', fontWeight: 850 },
  totalPanel: {
    padding: 'clamp(16px, 2.2vw, 20px)',
    borderRadius: 22,
    background: 'linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%)',
    color: '#fff',
    boxShadow: '0 18px 38px rgba(37,99,235,.24)',
    boxSizing: 'border-box',
  },
  totalLabel: { display: 'block', color: 'rgba(255,255,255,.74)', fontSize: 12, fontWeight: 950, letterSpacing: '.1em', textTransform: 'uppercase' },
  totalValue: { display: 'block', marginTop: 7, fontSize: 'clamp(38px, 7vw, 56px)', lineHeight: 1, letterSpacing: '-.06em' },
  totalHint: { display: 'block', marginTop: 9, color: 'rgba(255,255,255,.78)', fontWeight: 750 },
  breakdown: { marginTop: 16, border: '1px solid #e2e8f0', borderRadius: 18, overflow: 'hidden', background: '#fff' },
  breakdownRow: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderBottom: '1px solid #eef2f7', color: '#64748b', fontWeight: 750, minWidth: 0 },
  noticeGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 10, marginTop: 14 },
  noticeCard: { display: 'flex', alignItems: 'center', gap: 8, padding: 12, borderRadius: 16, background: '#f8fafc', color: '#334155', fontSize: 13, fontWeight: 800 },
  actionRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 132px), 1fr))', gap: 9, marginTop: 14 },
  primaryAction: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: 0, borderRadius: 15, background: '#2563eb', color: '#fff', padding: '13px 12px', fontWeight: 950, cursor: 'pointer', boxSizing: 'border-box' },
  secondaryAction: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: '1px solid #cbd9eb', borderRadius: 15, background: '#fff', color: '#0f172a', padding: '13px 12px', fontWeight: 950, cursor: 'pointer', boxSizing: 'border-box' },
  historyPanel: { marginTop: 18, padding: 'clamp(16px, 2vw, 22px)', border: '1px solid #d7e3f4', borderRadius: 24, background: 'rgba(255,255,255,.88)', boxShadow: '0 18px 45px rgba(15,23,42,.06)', maxWidth: 1180, marginLeft: 'auto', marginRight: 'auto', boxSizing: 'border-box' },
  historyHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 },
  filterPills: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  filterPill: { border: '1px solid #cbd9eb', borderRadius: 999, background: '#fff', color: '#334155', padding: '10px 13px', fontWeight: 900, cursor: 'pointer', boxSizing: 'border-box' },
  filterPillActive: { background: '#0f172a', color: '#fff', borderColor: '#0f172a' },
  entryList: { display: 'grid', gap: 10 },
  entryCard: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
    gap: 12,
    alignItems: 'center',
    padding: 12,
    border: '1px solid #dbe7f6',
    borderRadius: 18,
    background: '#fff',
    boxSizing: 'border-box',
  },
  entryMain: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 },
  photoThumb: { width: 76, height: 76, borderRadius: 16, overflow: 'hidden', background: '#eef2f7', flex: '0 0 auto' },
  photoThumbImg: { width: '100%', height: '100%', objectFit: 'cover' },
  entryBody: { minWidth: 0 },
  entryTopLine: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  entryRoom: { fontSize: 20, letterSpacing: '-.03em' },
  statusPill: { display: 'inline-flex', borderRadius: 999, padding: '6px 10px', fontSize: 12, fontWeight: 950 },
  entryMeta: { marginTop: 3, color: '#334155', fontWeight: 800 },
  entryTiny: { marginTop: 3, color: '#64748b', fontSize: 12, fontWeight: 700 },
  entryActions: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', minWidth: 0 },
  smallButton: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: '1px solid #cbd9eb', borderRadius: 13, background: '#fff', color: '#0f172a', padding: '10px 12px', fontWeight: 900, cursor: 'pointer', boxSizing: 'border-box' },
  statusSelect: { border: '1px solid #cbd9eb', borderRadius: 13, background: '#fff', color: '#0f172a', padding: '10px 12px', fontWeight: 900, cursor: 'pointer', minHeight: 42, maxWidth: '100%', boxSizing: 'border-box' },
  collectButton: { background: '#ecfdf5', color: '#047857', borderColor: '#bbf7d0' },
  disabledButton: { opacity: .5, cursor: 'not-allowed' },
  deleteButton: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: '1px solid #fecaca', borderRadius: 13, background: '#fff5f5', color: '#b91c1c', padding: '10px 12px', fontWeight: 900, cursor: 'pointer', boxSizing: 'border-box' },
  emptyBox: { padding: 24, border: '1px dashed #cbd9eb', borderRadius: 18, background: '#f8fbff', color: '#64748b', textAlign: 'center', fontWeight: 850 },
  modalOverlay: { position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', padding: 16, background: 'rgba(15,23,42,.45)' },
  modalCard: { width: 'min(920px, 100%)', maxHeight: '92vh', overflow: 'auto', padding: 'clamp(18px, 2.4vw, 28px)', borderRadius: 24, background: '#fff', boxShadow: '0 24px 70px rgba(15,23,42,.24)', boxSizing: 'border-box' },
  modalHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 },
  closeButton: { width: 42, height: 42, border: '1px solid #cbd9eb', borderRadius: 14, background: '#fff', color: '#0f172a', fontWeight: 950, cursor: 'pointer' },
  primaryButton: { display: 'inline-flex', justifyContent: 'center', borderRadius: 15, background: '#0f172a', color: '#fff', padding: '14px 18px', fontWeight: 950, textDecoration: 'none', boxSizing: 'border-box' },
  secondaryButton: { display: 'inline-flex', justifyContent: 'center', borderRadius: 15, border: '1px solid #cbd9eb', background: '#fff', color: '#0f172a', padding: '13px 16px', fontWeight: 950, textDecoration: 'none', boxSizing: 'border-box' },
  centerCard: { maxWidth: 520, margin: '16vh auto 0', padding: 28, border: '1px solid #d7e3f4', borderRadius: 24, background: '#fff', textAlign: 'center', boxShadow: '0 18px 45px rgba(15,23,42,.08)', boxSizing: 'border-box' },
  deniedTitle: { margin: '0 0 10px', fontSize: 30 },
  muted: { color: '#64748b', fontWeight: 750 },
  errorBox: { maxWidth: 1180, margin: '0 auto 14px', padding: 14, border: '1px solid #fecaca', borderRadius: 16, background: '#fef2f2', color: '#b91c1c', fontWeight: 850, boxSizing: 'border-box' },
  successBox: { maxWidth: 1180, margin: '0 auto 14px', padding: 14, border: '1px solid #bbf7d0', borderRadius: 16, background: '#f0fdf4', color: '#166534', fontWeight: 850, boxSizing: 'border-box' },
};
