'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type PageTab = 'daily' | 'excess' | 'small-change' | 'history';
type SourceMode = 'DAILY' | 'EXCESS' | 'SMALL_CHANGE';
type PermissionValue = boolean | string | number | null | undefined;

type DashboardProfile = {
  user_id?: string;
  email?: string;
  name?: string;
  role?: string;
  user_role?: string;
  app_role?: string;
  is_superuser?: PermissionValue;
  isSuperUser?: PermissionValue;
  can_access_management_tasks?: PermissionValue;
  permissions?: Record<string, PermissionValue>;
};

type CashEntry = {
  id: string;
  submission_id: string;
  shift_title: string;
  service_date: string;
  submitted_by_name: string;
  submitted_by_email: string;
  person_name: string;
  cash_amount: number;
  excess_amount: number;
  cash_bank_in_id: string | null;
  excess_bank_in_id: string | null;
  created_at: string;
};

type ManualCashEntry = {
  id: string;
  service_date: string;
  description: string;
  amount: number;
  bank_in_id: string | null;
  created_by_name: string;
  created_by_email: string;
  created_at: string;
};

type CashEntryAmendment = {
  id: string;
  cash_entry_id: string;
  previous_amount: number;
  new_amount: number;
  reason: string;
  amended_by_name: string;
  amended_by_email: string;
  amended_at: string;
};

type BankInSource = {
  id: string;
  bank_in_id: string;
  source_type: 'SHIFT_CASH' | 'MANUAL_CASH' | 'EXCESS' | 'SMALL_CHANGE';
  source_id: string;
  source_amount: number;
};

type DailyCashRow = {
  id: string;
  sourceType: 'SHIFT_CASH' | 'MANUAL_CASH';
  service_date: string;
  title: string;
  person_name: string;
  amount: number;
  bank_in_id: string | null;
  cashEntry?: CashEntry;
};

type SmallChangeEntry = {
  id: string;
  source_bank_in_id: string;
  bank_in_date: string;
  amount: number;
  consumed_by_bank_in_id: string | null;
  created_at: string;
};

type BankInRecord = {
  id: string;
  bank_in_date: string;
  source_mode: SourceMode;
  selected_total: number;
  banked_amount: number;
  balance_to_small_change: number;
  receipt_paths: unknown;
  created_by_name: string;
  created_by_email: string;
  created_at: string;
  reversed_at: string | null;
  reversed_by_name: string | null;
  reversal_reason: string | null;
};

type DailyGroup = {
  date: string;
  rows: DailyCashRow[];
  declared: number;
  available: number;
  availableIds: string[];
  bankedCount: number;
};

const money = new Intl.NumberFormat('en-MY', {
  style: 'currency',
  currency: 'MYR',
  minimumFractionDigits: 2,
});

function singaporeDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function normalizeRole(value: unknown) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function isPermissionEnabled(value: unknown) {
  if (value === true || value === 1) return true;
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'allowed';
}

function formatDate(value: string) {
  if (!value) return '-';
  const date = new Date(`${value.slice(0, 10)}T00:00:00+08:00`);
  return new Intl.DateTimeFormat('en-MY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Singapore',
  }).format(date);
}

function formatDateTime(value: string) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-MY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Singapore',
  }).format(new Date(value));
}

function monthStartTwelveMonthsAgo() {
  const date = new Date();
  date.setMonth(date.getMonth() - 11, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

function normaliseReceiptPaths(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

async function compressReceipt(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not an image.`);

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
      nextImage.src = objectUrl;
    });

    const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = longestSide > 1800 ? 1800 / longestSide : 1;
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image compression is unavailable on this device.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error(`Unable to compress ${file.name}.`))),
        'image/jpeg',
        0.82,
      );
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function BankInCashPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [profile, setProfile] = useState<DashboardProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [cashEntries, setCashEntries] = useState<CashEntry[]>([]);
  const [manualEntries, setManualEntries] = useState<ManualCashEntry[]>([]);
  const [amendments, setAmendments] = useState<CashEntryAmendment[]>([]);
  const [bankInSources, setBankInSources] = useState<BankInSource[]>([]);
  const [smallChange, setSmallChange] = useState<SmallChangeEntry[]>([]);
  const [bankIns, setBankIns] = useState<BankInRecord[]>([]);
  const [tab, setTab] = useState<PageTab>('daily');
  const [month, setMonth] = useState(singaporeDate().slice(0, 7));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bankedAmount, setBankedAmount] = useState('');
  const [bankInDate, setBankInDate] = useState(singaporeDate());
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [authError, setAuthError] = useState('');
  const [reverseTarget, setReverseTarget] = useState<BankInRecord | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reversing, setReversing] = useState(false);
  const [manualDate, setManualDate] = useState(singaporeDate());
  const [manualDescription, setManualDescription] = useState('');
  const [manualAmount, setManualAmount] = useState('');
  const [addingManual, setAddingManual] = useState(false);
  const [amendTarget, setAmendTarget] = useState<CashEntry | null>(null);
  const [amendAmount, setAmendAmount] = useState('');
  const [amendReason, setAmendReason] = useState('');
  const [amending, setAmending] = useState(false);

  const role = normalizeRole(profile?.role || profile?.user_role || profile?.app_role);
  const isSuperuser =
    role === 'SUPERUSER' ||
    role.includes('SUPERUSER') ||
    isPermissionEnabled(profile?.is_superuser) ||
    isPermissionEnabled(profile?.isSuperUser);
  const hasAccess =
    isSuperuser ||
    isPermissionEnabled(profile?.can_access_management_tasks) ||
    isPermissionEnabled(profile?.permissions?.can_access_management_tasks);

  const loadData = useCallback(async () => {
    setDataLoading(true);
    setError('');
    const retentionStart = monthStartTwelveMonthsAgo();
    const [cashResult, manualResult, smallChangeResult, bankInResult, amendmentResult, sourceResult] = await Promise.all([
      supabase
        .from('fo_checklist_cash_entries')
        .select('*')
        .gte('service_date', retentionStart)
        .order('service_date', { ascending: false })
        .order('line_number', { ascending: true }),
      supabase
        .from('cash_manual_entries')
        .select('*')
        .gte('service_date', retentionStart)
        .order('service_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('cash_small_change')
        .select('*')
        .gte('bank_in_date', retentionStart)
        .order('bank_in_date', { ascending: false }),
      supabase
        .from('cash_bank_ins')
        .select('*')
        .gte('bank_in_date', retentionStart)
        .order('bank_in_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('cash_entry_amendments')
        .select('*')
        .gte('amended_at', retentionStart)
        .order('amended_at', { ascending: false }),
      supabase
        .from('cash_bank_in_sources')
        .select('*'),
    ]);

    const firstError = cashResult.error || manualResult.error || smallChangeResult.error || bankInResult.error || amendmentResult.error || sourceResult.error;
    if (firstError) {
      setError(firstError.message);
    } else {
      setCashEntries((cashResult.data || []) as CashEntry[]);
      setManualEntries((manualResult.data || []) as ManualCashEntry[]);
      setSmallChange((smallChangeResult.data || []) as SmallChangeEntry[]);
      setBankIns((bankInResult.data || []) as BankInRecord[]);
      setAmendments((amendmentResult.data || []) as CashEntryAmendment[]);
      setBankInSources((sourceResult.data || []) as BankInSource[]);
    }
    setDataLoading(false);
  }, [supabase]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (active) setAuthError('');
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        if (sessionError || !session?.access_token) {
          throw new Error('Your dashboard session has expired. Please sign in again.');
        }
        const response = await fetch(`/api/session-profile?t=${Date.now()}`, {
          cache: 'no-store',
          credentials: 'include',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });
        const payload = await response.json();
        const sessionProfile = payload?.user || payload?.profile || payload?.data?.user;
        if (!response.ok || !sessionProfile) throw new Error(payload?.error || 'Unable to verify access.');
        if (active) setProfile(sessionProfile as DashboardProfile);
      } catch (nextError: any) {
        if (active) setAuthError(nextError?.message || 'Unable to verify access.');
      } finally {
        if (active) setAuthLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  useEffect(() => {
    if (!authLoading && hasAccess) void loadData();
  }, [authLoading, hasAccess, loadData]);

  useEffect(() => {
    setSelectedIds([]);
    setBankedAmount('');
    setReceiptFiles([]);
    setMessage('');
    setError('');
  }, [tab, month]);

  const dailyCashRows = useMemo<DailyCashRow[]>(
    () => [
      ...cashEntries.map((entry) => ({
        id: entry.id,
        sourceType: 'SHIFT_CASH' as const,
        service_date: entry.service_date,
        title: entry.shift_title,
        person_name: entry.person_name,
        amount: Number(entry.cash_amount || 0),
        bank_in_id: entry.cash_bank_in_id,
        cashEntry: entry,
      })),
      ...manualEntries.map((entry) => ({
        id: entry.id,
        sourceType: 'MANUAL_CASH' as const,
        service_date: entry.service_date,
        title: 'Manual Cash',
        person_name: entry.description,
        amount: Number(entry.amount || 0),
        bank_in_id: entry.bank_in_id,
      })),
    ],
    [cashEntries, manualEntries],
  );

  const filteredDailyCash = useMemo(
    () => dailyCashRows.filter((entry) => entry.service_date.slice(0, 7) === month),
    [dailyCashRows, month],
  );

  const dailyGroups = useMemo<DailyGroup[]>(() => {
    const grouped = new Map<string, DailyCashRow[]>();
    filteredDailyCash.forEach((entry) => {
      const current = grouped.get(entry.service_date) || [];
      current.push(entry);
      grouped.set(entry.service_date, current);
    });
    return Array.from(grouped.entries())
      .map(([date, rows]) => {
        const positiveRows = rows.filter((row) => row.amount > 0);
        const availableRows = positiveRows.filter((row) => !row.bank_in_id);
        return {
          date,
          rows,
          declared: positiveRows.reduce((sum, row) => sum + row.amount, 0),
          available: availableRows.reduce((sum, row) => sum + row.amount, 0),
          availableIds: availableRows.map((row) => row.id),
          bankedCount: positiveRows.filter((row) => !!row.bank_in_id).length,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [filteredDailyCash]);

  const excessRows = useMemo(
    () =>
      cashEntries
        .filter((entry) => entry.service_date.slice(0, 7) === month)
        .filter((entry) => Number(entry.excess_amount) > 0)
        .sort((a, b) => b.service_date.localeCompare(a.service_date)),
    [cashEntries, month],
  );

  const filteredSmallChange = useMemo(
    () => smallChange.filter((entry) => entry.bank_in_date.slice(0, 7) === month),
    [smallChange, month],
  );

  const filteredBankIns = useMemo(
    () => bankIns.filter((entry) => entry.bank_in_date.slice(0, 7) === month),
    [bankIns, month],
  );

  const filteredAmendments = useMemo(
    () =>
      amendments.filter((amendment) => {
        const entry = cashEntries.find((cashEntry) => cashEntry.id === amendment.cash_entry_id);
        return entry?.service_date.slice(0, 7) === month;
      }),
    [amendments, cashEntries, month],
  );

  const selectedTotal = useMemo(() => {
    if (tab === 'daily') {
      return dailyCashRows
        .filter((entry) => selectedIds.includes(entry.id) && !entry.bank_in_id)
        .reduce((sum, entry) => sum + entry.amount, 0);
    }
    if (tab === 'excess') {
      return cashEntries
        .filter((entry) => selectedIds.includes(entry.id) && !entry.excess_bank_in_id)
        .reduce((sum, entry) => sum + Number(entry.excess_amount || 0), 0);
    }
    if (tab === 'small-change') {
      return smallChange
        .filter((entry) => selectedIds.includes(entry.id) && !entry.consumed_by_bank_in_id)
        .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    }
    return 0;
  }, [cashEntries, dailyCashRows, selectedIds, smallChange, tab]);

  useEffect(() => {
    setBankedAmount(selectedTotal > 0 ? selectedTotal.toFixed(2) : '');
  }, [selectedTotal]);

  const cashOnHand = useMemo(() => {
    const daily = cashEntries
      .filter((entry) => !entry.cash_bank_in_id)
      .reduce((sum, entry) => sum + Number(entry.cash_amount || 0), 0);
    const manual = manualEntries
      .filter((entry) => !entry.bank_in_id)
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const excess = cashEntries
      .filter((entry) => !entry.excess_bank_in_id)
      .reduce((sum, entry) => sum + Number(entry.excess_amount || 0), 0);
    const change = smallChange
      .filter((entry) => !entry.consumed_by_bank_in_id)
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    return daily + manual + excess + change;
  }, [cashEntries, manualEntries, smallChange]);

  const monthBanked = useMemo(
    () =>
      filteredBankIns
        .filter((entry) => !entry.reversed_at)
        .reduce((sum, entry) => sum + Number(entry.banked_amount || 0), 0),
    [filteredBankIns],
  );

  const toggleIds = (ids: string[], checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => (checked ? next.add(id) : next.delete(id)));
      return Array.from(next);
    });
  };

  const handleReceipts = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    setReceiptFiles(files);
    event.target.value = '';
  };

  const addManualCash = async () => {
    const amount = Number(manualAmount);
    setError('');
    setMessage('');
    if (!manualDate) return setError('Choose the date the cash was received.');
    if (!manualDescription.trim()) return setError('Describe the missing Front Office declaration.');
    if (!Number.isFinite(amount) || amount <= 0) return setError('Manual cash amount must be more than zero.');

    setAddingManual(true);
    const { error: addError } = await supabase.rpc('add_manual_cash_entry', {
      p_service_date: manualDate,
      p_description: manualDescription.trim(),
      p_amount: amount,
    });
    if (addError) {
      setError(addError.message);
    } else {
      setMessage(`${money.format(amount)} added to the daily cash ledger.`);
      setManualDescription('');
      setManualAmount('');
      setMonth(manualDate.slice(0, 7));
      await loadData();
    }
    setAddingManual(false);
  };

  const openAmendment = (entry: CashEntry) => {
    setAmendTarget(entry);
    setAmendAmount(Number(entry.cash_amount).toFixed(2));
    setAmendReason('');
    setError('');
  };

  const amendFoCash = async () => {
    if (!amendTarget) return;
    const amount = Number(amendAmount);
    if (!Number.isFinite(amount) || amount < 0) return setError('New cash amount cannot be negative.');
    if (!amendReason.trim()) return setError('Enter a reason for the amendment.');

    setAmending(true);
    setError('');
    const { error: amendError } = await supabase.rpc('amend_fo_cash_entry', {
      p_cash_entry_id: amendTarget.id,
      p_new_amount: amount,
      p_reason: amendReason.trim(),
    });
    if (amendError) {
      setError(amendError.message);
    } else {
      setMessage(
        `${amendTarget.person_name}'s FO cash was amended from ${money.format(Number(amendTarget.cash_amount))} to ${money.format(amount)}.`,
      );
      setAmendTarget(null);
      setAmendAmount('');
      setAmendReason('');
      await loadData();
    }
    setAmending(false);
  };

  const sourceMode: SourceMode = tab === 'daily' ? 'DAILY' : tab === 'excess' ? 'EXCESS' : 'SMALL_CHANGE';

  const submitBankIn = async () => {
    setError('');
    setMessage('');
    const amount = Number(bankedAmount);
    if (!selectedIds.length || selectedTotal <= 0) return setError('Select at least one available cash source.');
    if (!Number.isFinite(amount) || amount <= 0 || amount > selectedTotal) {
      return setError(`Banked amount must be between RM0.01 and ${money.format(selectedTotal)}.`);
    }
    if (!bankInDate) return setError('Choose the bank-in date.');
    if (!receiptFiles.length) return setError('At least one clear bank-in receipt photo is required.');

    setSubmitting(true);
    const uploadedPaths: string[] = [];
    try {
      for (const file of receiptFiles) {
        const compressed = await compressReceipt(file);
        const path = `${bankInDate}/${crypto.randomUUID()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('bank-in-receipts')
          .upload(path, compressed, { contentType: 'image/jpeg', upsert: false });
        if (uploadError) throw uploadError;
        uploadedPaths.push(path);
      }

      const { error: rpcError } = await supabase.rpc('create_cash_bank_in', {
        p_source_mode: sourceMode,
        p_source_ids: selectedIds,
        p_banked_amount: amount,
        p_bank_in_date: bankInDate,
        p_receipt_paths: uploadedPaths,
      });
      if (rpcError) throw rpcError;

      const remainder = Math.max(0, selectedTotal - amount);
      setMessage(
        remainder > 0
          ? `${money.format(amount)} recorded. ${money.format(remainder)} moved to Small Change.`
          : `${money.format(amount)} bank-in recorded successfully.`,
      );
      setSelectedIds([]);
      setReceiptFiles([]);
      setBankedAmount('');
      await loadData();
    } catch (nextError: any) {
      if (uploadedPaths.length) await supabase.storage.from('bank-in-receipts').remove(uploadedPaths);
      setError(nextError?.message || 'Unable to save bank-in.');
    } finally {
      setSubmitting(false);
    }
  };

  const viewReceipt = async (path: string) => {
    const popup = window.open('', '_blank');
    const { data, error: signedError } = await supabase.storage
      .from('bank-in-receipts')
      .createSignedUrl(path, 120);
    if (signedError || !data?.signedUrl) {
      popup?.close();
      setError(signedError?.message || 'Unable to open receipt.');
      return;
    }
    if (popup) popup.location.href = data.signedUrl;
    else window.location.href = data.signedUrl;
  };

  const reverseBankIn = async () => {
    if (!reverseTarget || !reverseReason.trim()) return setError('Enter a reversal reason.');
    setReversing(true);
    setError('');
    const { error: reverseError } = await supabase.rpc('reverse_cash_bank_in', {
      p_bank_in_id: reverseTarget.id,
      p_reason: reverseReason.trim(),
    });
    if (reverseError) {
      setError(reverseError.message);
    } else {
      setMessage(`${money.format(Number(reverseTarget.banked_amount))} bank-in reversed.`);
      setReverseTarget(null);
      setReverseReason('');
      await loadData();
    }
    setReversing(false);
  };

  if (authLoading) {
    return <main className="cash-page"><div className="state-card">Checking cash access...</div><Styles /></main>;
  }

  if (authError) {
    return (
      <main className="cash-page">
        <div className="state-card">
          <h1>Unable to verify access</h1>
          <p>{authError}</p>
          <button type="button" className="primary-button" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
        <Styles />
      </main>
    );
  }

  if (!hasAccess) {
    return (
      <main className="cash-page">
        <div className="state-card">
          <h1>Access denied</h1>
          <p>Bank In Cash is available to users with Management Tasks access.</p>
          <Link href="/dashboard" className="primary-button">Back to Dashboard</Link>
        </div>
        <Styles />
      </main>
    );
  }

  return (
    <main className="cash-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">MANAGEMENT WORKSPACE</span>
          <h1>Bank In Cash</h1>
          <p>Reconcile Front Office cash, excess collections, small change, and receipt evidence.</p>
        </div>
        <div className="header-actions">
          <button type="button" className="icon-button" title="Refresh cash records" onClick={() => void loadData()} disabled={dataLoading}>↻</button>
          <Link href="/dashboard" className="secondary-button">Dashboard</Link>
        </div>
      </header>

      {error ? <div className="notice error">{error}</div> : null}
      {message ? <div className="notice success">{message}</div> : null}

      <section className="manual-panel" aria-labelledby="manual-cash-title">
        <div>
          <span className="eyebrow">MISSED FO DECLARATION</span>
          <h2 id="manual-cash-title">Add cash to the daily ledger</h2>
          <p>Use this only when Front Office received cash but omitted it from the FO Checklist.</p>
        </div>
        <div className="manual-form">
          <label>Cash date<input type="date" value={manualDate} onChange={(event) => setManualDate(event.target.value)} /></label>
          <label>Description<input type="text" value={manualDescription} onChange={(event) => setManualDescription(event.target.value)} placeholder="Shift, staff, or reason it was missed" /></label>
          <label>Amount (RM)<input inputMode="decimal" type="number" min="0.01" step="0.01" value={manualAmount} onChange={(event) => setManualAmount(event.target.value)} /></label>
          <button type="button" className="primary-button" onClick={() => void addManualCash()} disabled={addingManual}>{addingManual ? 'Adding...' : 'Add Cash'}</button>
        </div>
      </section>

      <section className="summary-grid" aria-label="Cash summary">
        <article className="summary-card important"><span>Cash On Hand</span><strong>{money.format(cashOnHand)}</strong><small>All unbanked sources</small></article>
        <article className="summary-card"><span>Selected</span><strong>{money.format(selectedTotal)}</strong><small>{selectedIds.length} source(s)</small></article>
        <article className="summary-card"><span>Banked This Month</span><strong>{money.format(monthBanked)}</strong><small>Excludes reversals</small></article>
      </section>

      <section className="workspace-card">
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label="Cash ledgers">
            <button className={tab === 'daily' ? 'active' : ''} onClick={() => setTab('daily')}>Daily Cash</button>
            <button className={tab === 'excess' ? 'active' : ''} onClick={() => setTab('excess')}>Excess Cash</button>
            <button className={tab === 'small-change' ? 'active' : ''} onClick={() => setTab('small-change')}>Small Change</button>
            <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>History</button>
          </div>
          <label className="month-field">Month<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
        </div>

        {dataLoading ? <div className="empty-state">Refreshing ledger...</div> : null}

        {!dataLoading && tab === 'daily' ? (
          <div className="ledger-list">
            <div className="section-heading"><div><span className="eyebrow">SHIFT DECLARATIONS</span><h2>Daily cash submitted to Accounts</h2></div><span>{dailyGroups.length} day(s)</span></div>
            {!dailyGroups.length ? <div className="empty-state">No Front Office cash declarations for this month.</div> : null}
            {dailyGroups.map((group) => {
              const checked = group.availableIds.length > 0 && group.availableIds.every((id) => selectedIds.includes(id));
              const positiveCount = group.rows.filter((row) => row.amount > 0).length;
              const state = positiveCount > 0 && group.bankedCount === positiveCount ? 'complete' : group.bankedCount > 0 ? 'partial' : '';
              return (
                <article className={`ledger-row ${state}`} key={group.date}>
                  <label className="select-box">
                    <input type="checkbox" checked={checked} disabled={!group.availableIds.length} onChange={(event) => toggleIds(group.availableIds, event.target.checked)} />
                    <span>{formatDate(group.date)}</span>
                  </label>
                  <div className="shift-lines">
                    {group.rows.filter((row) => row.amount > 0).map((row) => (
                      <span className="shift-line" key={row.id}>
                        <span><b>{row.title}</b> · {row.person_name} · {money.format(row.amount)}{row.sourceType === 'MANUAL_CASH' ? ' · Added manually' : ''}</span>
                        {row.cashEntry && !row.bank_in_id ? <button type="button" className="amend-button" onClick={() => openAmendment(row.cashEntry!)}>Amend</button> : null}
                      </span>
                    ))}
                    {!positiveCount ? <span>No cash declared for this day.</span> : null}
                  </div>
                  <div className="row-total"><small>Daily total</small><strong>{money.format(group.declared)}</strong><small>Available {money.format(group.available)}</small><em>{state === 'complete' ? 'Banked' : state === 'partial' ? 'Partly banked' : 'Open'}</em></div>
                </article>
              );
            })}
          </div>
        ) : null}

        {!dataLoading && tab === 'excess' ? (
          <div className="ledger-list">
            <div className="section-heading"><div><span className="eyebrow">EXCESS REGISTER</span><h2>Dated excess cash declarations</h2></div><span>{excessRows.length} entry(s)</span></div>
            {!excessRows.length ? <div className="empty-state">No excess cash declared for this month.</div> : null}
            {excessRows.map((row) => (
              <article className={`compact-row ${row.excess_bank_in_id ? 'complete' : ''}`} key={row.id}>
                <input type="checkbox" aria-label={`Select ${row.person_name}`} disabled={!!row.excess_bank_in_id} checked={selectedIds.includes(row.id)} onChange={(event) => toggleIds([row.id], event.target.checked)} />
                <div><strong>{row.person_name}</strong><span>{formatDate(row.service_date)} · {row.shift_title}</span></div>
                <b>{money.format(Number(row.excess_amount))}</b>
                <em>{row.excess_bank_in_id ? 'Banked' : 'Open'}</em>
              </article>
            ))}
          </div>
        ) : null}

        {!dataLoading && tab === 'small-change' ? (
          <div className="ledger-list">
            <div className="section-heading"><div><span className="eyebrow">SMALL CHANGE</span><h2>Balances retained after partial bank-ins</h2></div><span>{filteredSmallChange.length} entry(s)</span></div>
            {!filteredSmallChange.length ? <div className="empty-state">No small-change entries for this month.</div> : null}
            {filteredSmallChange.map((row) => (
              <article className={`compact-row ${row.consumed_by_bank_in_id ? 'complete' : ''}`} key={row.id}>
                <input type="checkbox" aria-label={`Select small change from ${row.bank_in_date}`} disabled={!!row.consumed_by_bank_in_id} checked={selectedIds.includes(row.id)} onChange={(event) => toggleIds([row.id], event.target.checked)} />
                <div><strong>Balance from {formatDate(row.bank_in_date)}</strong><span>Bank-in reference {row.source_bank_in_id.slice(0, 8).toUpperCase()}</span></div>
                <b>{money.format(Number(row.amount))}</b>
                <em>{row.consumed_by_bank_in_id ? 'Banked' : 'Open'}</em>
              </article>
            ))}
          </div>
        ) : null}

        {!dataLoading && tab === 'history' ? (
          <div className="ledger-list">
            <div className="section-heading"><div><span className="eyebrow">AUDIT HISTORY</span><h2>Bank-ins and supporting receipts</h2></div><span>{filteredBankIns.length} record(s)</span></div>
            {!filteredBankIns.length ? <div className="empty-state">No bank-ins recorded for this month.</div> : null}
            {filteredBankIns.map((record) => {
              const paths = normaliseReceiptPaths(record.receipt_paths);
              const recordSources = bankInSources.filter((source) => source.bank_in_id === record.id);
              const manualSourceCount = recordSources.filter((source) => source.source_type === 'MANUAL_CASH').length;
              return (
                <article className={`history-row ${record.reversed_at ? 'reversed' : ''}`} key={record.id}>
                  <div className="history-main"><span className="mode-pill">{record.source_mode.replace('_', ' ')}</span><strong>{money.format(Number(record.banked_amount))}</strong><span>{formatDate(record.bank_in_date)} · {record.created_by_name}</span></div>
                  <div className="history-detail"><span>Selected {money.format(Number(record.selected_total))}</span><span>Small change {money.format(Number(record.balance_to_small_change))}</span>{manualSourceCount ? <span>{manualSourceCount} manual cash source(s)</span> : null}<span>{formatDateTime(record.created_at)}</span></div>
                  <div className="history-actions">
                    {paths.map((path, index) => <button type="button" className="receipt-button" onClick={() => void viewReceipt(path)} key={path}>Receipt {index + 1}</button>)}
                    {isSuperuser && !record.reversed_at ? <button type="button" className="danger-button" onClick={() => setReverseTarget(record)}>Reverse</button> : null}
                    {record.reversed_at ? <span className="reversed-label">Reversed · {record.reversal_reason}</span> : null}
                  </div>
                </article>
              );
            })}
            {filteredAmendments.length ? (
              <section className="amendment-history" aria-label="FO cash amendment audit trail">
                <div className="section-heading"><div><span className="eyebrow">AMENDMENT AUDIT</span><h2>FO cash corrections</h2></div><span>{filteredAmendments.length} record(s)</span></div>
                {filteredAmendments.map((amendment) => {
                  const entry = cashEntries.find((cashEntry) => cashEntry.id === amendment.cash_entry_id);
                  return (
                    <article className="amendment-row" key={amendment.id}>
                      <div><strong>{entry?.person_name || 'FO cash entry'}</strong><span>{entry ? `${formatDate(entry.service_date)} · ${entry.shift_title}` : amendment.cash_entry_id.slice(0, 8).toUpperCase()}</span></div>
                      <div><span>Previous</span><b>{money.format(Number(amendment.previous_amount))}</b></div>
                      <div><span>New</span><b>{money.format(Number(amendment.new_amount))}</b></div>
                      <div><strong>{amendment.reason}</strong><span>{amendment.amended_by_name} ({amendment.amended_by_email}) · {formatDateTime(amendment.amended_at)}</span></div>
                    </article>
                  );
                })}
              </section>
            ) : null}
          </div>
        ) : null}
      </section>

      {tab !== 'history' ? (
        <section className="bank-panel">
          <div className="bank-panel-title"><div><span className="eyebrow">RECORD BANK-IN</span><h2>{selectedIds.length ? `${selectedIds.length} source(s) selected` : 'Select cash rows above'}</h2></div><strong>{money.format(selectedTotal)}</strong></div>
          <div className="bank-form">
            <label>Amount to bank in (RM)<input inputMode="decimal" type="number" min="0.01" step="0.01" value={bankedAmount} onChange={(event) => setBankedAmount(event.target.value)} /></label>
            <label>Date of bank in<input type="date" value={bankInDate} onChange={(event) => setBankInDate(event.target.value)} /></label>
            <label className="receipt-upload">Receipt photo(s)<input type="file" accept="image/*" multiple onChange={handleReceipts} /><span>{receiptFiles.length ? `${receiptFiles.length} photo(s) ready` : 'Choose clear receipt photos'}</span></label>
            <button type="button" className="primary-button" onClick={() => void submitBankIn()} disabled={submitting || !selectedIds.length}>{submitting ? 'Saving evidence...' : 'Submit Bank-In'}</button>
          </div>
          <p className="accounting-note">Only the actual banked amount reduces Cash On Hand. Any selected balance is retained automatically as a dated Small Change entry.</p>
        </section>
      ) : null}

      {reverseTarget ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setReverseTarget(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="reverse-title">
            <span className="danger-kicker">SUPERUSER CONTROL</span>
            <h2 id="reverse-title">Reverse this bank-in?</h2>
            <p>This restores the original cash sources. The action is refused if its Small Change balance has already been used.</p>
            <div className="reverse-amount">{money.format(Number(reverseTarget.banked_amount))}</div>
            <label>Reason for reversal<textarea value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} placeholder="Explain why this bank-in must be reopened" /></label>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setReverseTarget(null)}>Cancel</button><button type="button" className="danger-solid" onClick={() => void reverseBankIn()} disabled={reversing}>{reversing ? 'Reversing...' : 'Confirm Reversal'}</button></div>
          </section>
        </div>
      ) : null}

      {amendTarget ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setAmendTarget(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="amend-title">
            <span className="eyebrow">AUDITED CORRECTION</span>
            <h2 id="amend-title">Amend FO cash amount</h2>
            <p>{formatDate(amendTarget.service_date)} · {amendTarget.shift_title} · {amendTarget.person_name}</p>
            <div className="amend-comparison"><span>Previous<strong>{money.format(Number(amendTarget.cash_amount))}</strong></span><span>New<strong>{money.format(Number(amendAmount || 0))}</strong></span></div>
            <label>New amount (RM)<input inputMode="decimal" type="number" min="0" step="0.01" value={amendAmount} onChange={(event) => setAmendAmount(event.target.value)} /></label>
            <label>Reason for amendment<textarea value={amendReason} onChange={(event) => setAmendReason(event.target.value)} placeholder="Explain why the FO declaration is incorrect" /></label>
            <p className="accounting-note">A banked row cannot be amended until its bank-in is reversed by a superuser.</p>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setAmendTarget(null)}>Cancel</button><button type="button" className="primary-button" onClick={() => void amendFoCash()} disabled={amending}>{amending ? 'Saving audit...' : 'Save Amendment'}</button></div>
          </section>
        </div>
      ) : null}

      <Styles />
    </main>
  );
}

function Styles() {
  return (
    <style jsx global>{`
      * { box-sizing: border-box; }
      body { margin: 0; background: #f3f7fc; color: #0b1733; }
      button, input, textarea { font: inherit; }
      .cash-page { min-height: 100vh; padding: 28px; background: #f3f7fc; }
      .page-header, .workspace-card, .bank-panel, .manual-panel, .summary-card, .state-card { border: 1px solid #d7e2f1; background: #fff; border-radius: 8px; box-shadow: 0 12px 30px rgba(34, 66, 120, .07); }
      .page-header { max-width: 1440px; margin: 0 auto 14px; padding: 22px 24px; display: flex; align-items: center; justify-content: space-between; gap: 20px; }
      .page-header h1 { margin: 3px 0 4px; font-size: 30px; line-height: 1; }
      .page-header p { margin: 0; color: #60718f; font-size: 14px; }
      .eyebrow, .danger-kicker { display: block; color: #245eea; font-size: 11px; font-weight: 900; letter-spacing: 0; }
      .danger-kicker { color: #b42318; }
      .header-actions, .modal-actions { display: flex; align-items: center; gap: 10px; }
      .icon-button, .secondary-button, .primary-button, .danger-button, .danger-solid, .receipt-button { min-height: 42px; border-radius: 8px; border: 1px solid #ccd9eb; padding: 10px 15px; font-weight: 800; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
      .icon-button { width: 42px; padding: 0; color: #215ce8; background: #edf4ff; font-size: 21px; }
      .secondary-button { color: #101a32; background: #fff; }
      .primary-button { color: #fff; background: #175be8; border-color: #175be8; }
      .danger-button { color: #b42318; border-color: #f4b8b3; background: #fff5f4; }
      .danger-solid { color: #fff; border-color: #b42318; background: #b42318; }
      button:disabled { opacity: .55; cursor: not-allowed; }
      .notice { max-width: 1440px; margin: 0 auto 12px; border: 1px solid; border-radius: 8px; padding: 13px 16px; font-weight: 800; }
      .notice.error { color: #b42318; border-color: #fecaca; background: #fff1f2; }
      .notice.success { color: #067647; border-color: #a7f3d0; background: #ecfdf3; }
      .manual-panel { max-width: 1440px; margin: 0 auto 14px; padding: 18px 20px; display: grid; grid-template-columns: minmax(240px, .7fr) minmax(520px, 1.5fr); gap: 24px; align-items: end; }
      .manual-panel h2 { margin: 3px 0 5px; font-size: 19px; }
      .manual-panel p { margin: 0; color: #60718f; font-size: 12px; line-height: 1.45; }
      .manual-form { display: grid; grid-template-columns: 155px minmax(220px, 1fr) 140px auto; gap: 10px; align-items: end; }
      .manual-form label { display: grid; gap: 6px; color: #344563; font-size: 12px; font-weight: 850; }
      .manual-form input, .modal input { min-height: 42px; min-width: 0; border: 1px solid #cbd8ea; border-radius: 8px; background: #fff; color: #101a32; padding: 9px 12px; }
      .summary-grid { max-width: 1440px; margin: 0 auto 14px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .summary-card { padding: 18px 20px; display: grid; gap: 3px; border-top: 3px solid #80a7f7; }
      .summary-card.important { border-top-color: #175be8; }
      .summary-card span { color: #536887; font-size: 12px; font-weight: 900; text-transform: uppercase; }
      .summary-card strong { font-size: 27px; }
      .summary-card small { color: #70819d; }
      .workspace-card, .bank-panel { max-width: 1440px; margin: 0 auto 14px; overflow: hidden; }
      .toolbar { padding: 14px 16px; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; border-bottom: 1px solid #e4ebf5; }
      .tabs { display: flex; gap: 5px; padding: 4px; border: 1px solid #d8e3f1; border-radius: 8px; background: #f5f8fc; overflow-x: auto; }
      .tabs button { white-space: nowrap; border: 0; border-radius: 6px; background: transparent; padding: 9px 13px; color: #536887; font-weight: 850; cursor: pointer; }
      .tabs button.active { background: #10213e; color: #fff; }
      .month-field, .bank-form label, .modal label { display: grid; gap: 6px; color: #344563; font-size: 12px; font-weight: 850; }
      .month-field input, .bank-form input, .modal textarea { min-height: 42px; border: 1px solid #cbd8ea; border-radius: 8px; background: #fff; color: #101a32; padding: 9px 12px; }
      .ledger-list { padding: 16px; display: grid; gap: 9px; }
      .section-heading { display: flex; align-items: end; justify-content: space-between; gap: 14px; margin-bottom: 2px; }
      .section-heading h2 { margin: 3px 0 0; font-size: 19px; }
      .section-heading > span { color: #60718f; font-size: 12px; font-weight: 800; }
      .ledger-row, .compact-row, .history-row { border: 1px solid #dbe5f2; border-left: 4px solid #adc5ed; border-radius: 8px; background: #fff; }
      .ledger-row { padding: 13px 14px; display: grid; grid-template-columns: minmax(175px, .8fr) minmax(300px, 2fr) minmax(120px, .6fr); gap: 18px; align-items: center; }
      .ledger-row.complete, .compact-row.complete { background: #f0fdf4; border-color: #a7e6c0; border-left-color: #16a15f; }
      .ledger-row.partial { background: #fffbeb; border-color: #f8d88b; border-left-color: #f59e0b; }
      .select-box { display: flex; align-items: center; gap: 10px; font-weight: 900; }
      .select-box input, .compact-row > input { width: 19px; height: 19px; accent-color: #175be8; }
      .shift-lines { display: flex; flex-wrap: wrap; gap: 6px 12px; color: #60718f; font-size: 12px; }
      .shift-lines > span { padding: 5px 8px; background: #f5f8fc; border-radius: 6px; }
      .shift-line { display: inline-flex; align-items: center; gap: 7px; }
      .shift-line > span { padding: 0; }
      .amend-button { border: 0; border-radius: 5px; padding: 3px 6px; background: #dfeaff; color: #175be8; font-size: 10px; font-weight: 900; cursor: pointer; }
      .row-total { display: grid; justify-items: end; gap: 1px; }
      .row-total small { color: #60718f; }
      .row-total strong { font-size: 18px; }
      .row-total em, .compact-row em { color: #60718f; font-size: 11px; font-style: normal; font-weight: 900; text-transform: uppercase; }
      .compact-row { padding: 12px 14px; display: grid; grid-template-columns: 24px minmax(220px, 1fr) 120px 90px; align-items: center; gap: 12px; }
      .compact-row > div { display: grid; gap: 2px; }
      .compact-row > div span { color: #667995; font-size: 12px; }
      .compact-row > b, .compact-row > em { text-align: right; }
      .history-row { padding: 14px; display: grid; grid-template-columns: minmax(220px, .8fr) minmax(280px, 1.2fr) minmax(220px, 1fr); gap: 16px; align-items: center; }
      .history-row.reversed { opacity: .72; border-left-color: #d92d20; background: #fff7f6; }
      .history-main { display: grid; gap: 3px; }
      .history-main strong { font-size: 20px; }
      .history-main > span:last-child, .history-detail span { color: #667995; font-size: 12px; }
      .mode-pill { width: max-content; padding: 4px 7px; border-radius: 5px; background: #e8f1ff; color: #175be8; font-size: 10px; font-weight: 900; }
      .history-detail { display: flex; flex-wrap: wrap; gap: 7px 14px; }
      .history-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 7px; }
      .amendment-history { display: grid; gap: 8px; margin-top: 16px; padding-top: 16px; border-top: 1px solid #dbe5f2; }
      .amendment-row { display: grid; grid-template-columns: minmax(190px, 1fr) 110px 110px minmax(230px, 1.3fr); gap: 14px; align-items: center; padding: 12px 14px; border: 1px solid #dbe5f2; border-left: 4px solid #7c5ce7; border-radius: 8px; background: #fbfaff; }
      .amendment-row > div { display: grid; gap: 2px; }
      .amendment-row span { color: #667995; font-size: 12px; }
      .receipt-button { min-height: 36px; padding: 7px 10px; background: #f4f7fb; color: #1e4fb7; }
      .reversed-label { color: #b42318; font-size: 12px; font-weight: 800; }
      .empty-state { margin: 16px; min-height: 80px; border: 1px dashed #cbd8e9; border-radius: 8px; color: #687b98; background: #f8fafd; display: grid; place-items: center; text-align: center; padding: 20px; }
      .bank-panel { padding: 18px; }
      .bank-panel-title { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 13px; }
      .bank-panel-title h2 { margin: 3px 0 0; font-size: 19px; }
      .bank-panel-title > strong { font-size: 25px; color: #175be8; }
      .bank-form { display: grid; grid-template-columns: minmax(170px, .7fr) minmax(170px, .7fr) minmax(240px, 1.2fr) auto; gap: 12px; align-items: end; }
      .receipt-upload { position: relative; }
      .receipt-upload input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
      .receipt-upload span { min-height: 42px; border: 1px dashed #87a9e8; border-radius: 8px; background: #f1f6ff; display: flex; align-items: center; padding: 9px 12px; color: #2159c7; }
      .accounting-note { margin: 12px 0 0; color: #60718f; font-size: 12px; }
      .state-card { max-width: 620px; margin: 15vh auto; padding: 32px; text-align: center; display: grid; justify-items: center; gap: 13px; }
      .state-card h1, .state-card p { margin: 0; }
      .modal-backdrop { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 18px; background: rgba(8, 18, 38, .62); }
      .modal { width: min(520px, 100%); border-radius: 8px; background: #fff; padding: 24px; box-shadow: 0 28px 80px rgba(0, 0, 0, .28); }
      .modal h2 { margin: 5px 0 7px; }
      .modal p { color: #60718f; line-height: 1.5; }
      .modal textarea { min-height: 95px; resize: vertical; }
      .amend-comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 14px 0; }
      .amend-comparison span { display: grid; gap: 3px; padding: 11px; border-radius: 8px; background: #f4f7fb; color: #60718f; font-size: 11px; font-weight: 850; }
      .amend-comparison strong { color: #10213e; font-size: 20px; }
      .reverse-amount { margin: 16px 0; padding: 13px; border-radius: 8px; background: #fff1f2; color: #b42318; font-size: 25px; font-weight: 900; text-align: center; }
      .modal-actions { justify-content: flex-end; margin-top: 16px; }
      @media (max-width: 900px) {
        .cash-page { padding: 14px; }
        .page-header { align-items: flex-start; }
        .summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .summary-card { padding: 13px; }
        .summary-card strong { font-size: 21px; }
        .ledger-row { grid-template-columns: 1fr auto; gap: 10px; }
        .shift-lines { grid-column: 1 / -1; order: 3; }
        .history-row { grid-template-columns: 1fr 1fr; }
        .history-actions { grid-column: 1 / -1; justify-content: flex-start; }
        .manual-panel { grid-template-columns: 1fr; }
        .manual-form { grid-template-columns: 1fr 1fr; }
        .amendment-row { grid-template-columns: 1fr 1fr; }
        .bank-form { grid-template-columns: 1fr 1fr; }
      }
      @media (max-width: 620px) {
        .cash-page { padding: 10px; }
        .page-header { padding: 17px; display: grid; }
        .page-header h1 { font-size: 25px; }
        .header-actions { width: 100%; justify-content: flex-end; }
        .summary-grid { grid-template-columns: 1fr 1fr; gap: 8px; }
        .summary-card:first-child { grid-column: 1 / -1; }
        .toolbar { align-items: stretch; flex-direction: column-reverse; padding: 10px; }
        .tabs { width: 100%; }
        .tabs button { flex: 1; }
        .month-field { width: 100%; }
        .ledger-list { padding: 10px; }
        .section-heading { align-items: flex-start; }
        .section-heading h2 { font-size: 17px; }
        .ledger-row { padding: 12px; grid-template-columns: 1fr; }
        .row-total { justify-items: start; grid-template-columns: auto auto; align-items: baseline; gap: 5px 10px; }
        .row-total em { grid-column: 1 / -1; }
        .shift-lines { grid-column: auto; order: initial; display: grid; }
        .compact-row { grid-template-columns: 22px minmax(0, 1fr) auto; gap: 9px; }
        .compact-row > em { grid-column: 2 / -1; text-align: left; }
        .history-row { grid-template-columns: 1fr; }
        .history-actions { grid-column: auto; }
        .manual-panel { padding: 14px; }
        .manual-form { grid-template-columns: 1fr; }
        .manual-form .primary-button { width: 100%; }
        .amendment-row { grid-template-columns: 1fr 1fr; }
        .amendment-row > div:first-child, .amendment-row > div:last-child { grid-column: 1 / -1; }
        .bank-panel { padding: 14px; }
        .bank-panel-title { align-items: flex-start; }
        .bank-panel-title > strong { font-size: 21px; }
        .bank-form { grid-template-columns: 1fr; }
        .bank-form .primary-button { width: 100%; }
        .modal-actions { display: grid; grid-template-columns: 1fr 1fr; }
      }
    `}</style>
  );
}
