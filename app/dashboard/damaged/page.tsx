'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';
import { formatDateTimeDDMMYYYY } from '../../../lib/dateDisplay';

type DashboardUser = {
  user_id?: string;
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'HK' | 'MT' | 'FO';

  // ✅ NEW
  can_access_linen_admin?: boolean;
};

type DamageRow = {
  id: string;
  linen_type: string;
  qty: number;
  block_no?: number | null;
  floor_no?: number | null;
  replaced?: boolean | null;
  notes?: string | null;
  updated_by_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type FloorOption = {
  key: string;
  block: number | null;
  floor: number | null;
  label: string;
};

const FLOOR_OPTIONS: FloorOption[] = [
  { key: 'B1F1', block: 1, floor: 1, label: 'Block 1 Floor 1' },
  { key: 'B1F2', block: 1, floor: 2, label: 'Block 1 Floor 2' },
  { key: 'B1F3', block: 1, floor: 3, label: 'Block 1 Floor 3' },
  { key: 'B1F5', block: 1, floor: 5, label: 'Block 1 Floor 5' },
  { key: 'B2F3', block: 2, floor: 3, label: 'Block 2 Floor 3' },
  { key: 'B2F5', block: 2, floor: 5, label: 'Block 2 Floor 5' },
  { key: 'B2F6', block: 2, floor: 6, label: 'Block 2 Floor 6' },
  { key: 'B2F7', block: 2, floor: 7, label: 'Block 2 Floor 7' },
  { key: 'SUPERVISOR_STORE', block: null, floor: null, label: 'Supervisor Store' },
];

const LINEN_TYPES = [
  'Bedsheet King',
  'Pillow Case',
  'Bath Towel',
  'Bath Mat',
  'Duvet Cover King',
  'Duvet Cover Single',
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

function formatDateTime(value?: string | null) {
  return formatDateTimeDDMMYYYY(value);
}

function safeNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function floorKey(blockNo?: number | null, floorNo?: number | null) {
  if (blockNo == null || floorNo == null) return 'SUPERVISOR_STORE';
  return `B${blockNo}F${floorNo}`;
}

function floorLabel(blockNo?: number | null, floorNo?: number | null) {
  if (blockNo == null || floorNo == null) return 'Supervisor Store';
  return FLOOR_OPTIONS.find((floor) => floor.block === blockNo && floor.floor === floorNo)?.label || '-';
}

export default function DamagedPage() {
  const [profile, setProfile] = useState<DashboardUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [selectedDate, setSelectedDate] = useState(getTodayLocalDateString());
  const [damageRows, setDamageRows] = useState<DamageRow[]>([]);

  const [formLinenType, setFormLinenType] = useState<string>(LINEN_TYPES[0]);
  const [formFloorKey, setFormFloorKey] = useState<string>(FLOOR_OPTIONS[0].key);
  const [formQty, setFormQty] = useState<string>('');
  const [formNotes, setFormNotes] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const supabase = getSupabaseSafe();
        if (!supabase) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.');

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        if (!session?.user) {
          if (!mounted) return;
          setProfile(null);
          return;
        }

        const { data: profileRow, error: profileError } = await supabase
          .from('user_profiles')
          .select('user_id, email, name, role, can_access_linen_admin')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (profileError) throw profileError;
        if (!mounted) return;

        setProfile({
  user_id: session.user.id,
  email: profileRow?.email || session.user.email || '',
  name: profileRow?.name || session.user.email || 'User',
  role: (profileRow?.role || 'HK') as DashboardUser['role'],
  can_access_linen_admin: profileRow?.can_access_linen_admin ?? false,
});
      } catch (err: any) {
        if (!mounted) return;
        setErrorMsg(err?.message || 'Failed to load session');
      } finally {
        if (mounted) setAuthLoading(false);
      }
    }

    void bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  const canAccess = useMemo(() => {
  if (!profile) return false;

  if (
    profile.role === 'SUPERUSER' ||
    profile.role === 'MANAGER' ||
    profile.role === 'SUPERVISOR'
  ) {
    return true;
  }

  return profile.can_access_linen_admin === true;
}, [profile]);

  async function loadDamageRows() {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    try {
      setLoading(true);
      setErrorMsg('');

      const { data, error } = await supabase
        .from('linen_damage_log')
        .select('id, linen_type, qty, block_no, floor_no, replaced, notes, updated_by_name, created_at, updated_at, log_date')
        .or(`log_date.eq.${selectedDate},replaced.eq.false`)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDamageRows((data || []) as DamageRow[]);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load damage log');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!profile || !canAccess) {
      setLoading(false);
      return;
    }
    void loadDamageRows();
  }, [profile, canAccess, selectedDate]);

  function resetForm() {
    setEditingId(null);
    setFormLinenType(LINEN_TYPES[0]);
    setFormFloorKey(FLOOR_OPTIONS[0].key);
    setFormQty('');
    setFormNotes('');
  }

  async function submitDamage() {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    if (!profile?.user_id) {
      setErrorMsg('User not found.');
      return;
    }

    const qty = Math.max(0, safeNumber(formQty));
    if (!formLinenType) {
      setErrorMsg('Please select a linen type.');
      return;
    }
    if (qty <= 0) {
      setErrorMsg('Please enter a damage quantity above 0.');
      return;
    }

    const selectedFloor = FLOOR_OPTIONS.find((floor) => floor.key === formFloorKey) || FLOOR_OPTIONS[0];

    try {
      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');

      if (editingId) {
        const { error } = await supabase
          .from('linen_damage_log')
          .update({
            linen_type: formLinenType,
            qty,
            block_no: selectedFloor.block,
            floor_no: selectedFloor.floor,
            notes: formNotes.trim() || null,
            updated_by_user_id: profile.user_id,
            updated_by_name: profile.name || profile.email,
            log_date: selectedDate,
          })
          .eq('id', editingId);

        if (error) throw error;
        setSuccessMsg('Damage entry updated.');
      } else {
        const { error } = await supabase
          .from('linen_damage_log')
          .insert([
            {
              linen_type: formLinenType,
              qty,
              block_no: selectedFloor.block,
              floor_no: selectedFloor.floor,
              replaced: false,
              notes: formNotes.trim() || null,
              log_date: selectedDate,
              updated_by_user_id: profile.user_id,
              updated_by_name: profile.name || profile.email,
            },
          ]);

        if (error) throw error;
        setSuccessMsg('Damage entry submitted.');
      }

      resetForm();
      await loadDamageRows();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save damage entry');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(row: DamageRow) {
    setEditingId(row.id);
    setFormLinenType(row.linen_type);
    setFormFloorKey(floorKey(row.block_no, row.floor_no));
    setFormQty(String(row.qty));
    setFormNotes(row.notes || '');
    setSuccessMsg('');
    setErrorMsg('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function deleteRow(rowId: string) {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    try {
      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');

      const { error } = await supabase.from('linen_damage_log').delete().eq('id', rowId);
      if (error) throw error;

      if (editingId === rowId) resetForm();
      setSuccessMsg('Damage entry deleted.');
      await loadDamageRows();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to delete damage entry');
    } finally {
      setSaving(false);
    }
  }

  async function toggleReplaced(row: DamageRow, nextReplaced: boolean) {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    if (!profile?.user_id) {
      setErrorMsg('User not found.');
      return;
    }

    const targetFloor = FLOOR_OPTIONS.find(
      (floor) => floor.block === row.block_no && floor.floor === row.floor_no
    );
    const isSupervisorStoreDamage = targetFloor?.key === 'SUPERVISOR_STORE';

    if (nextReplaced && !targetFloor) {
      setErrorMsg('Please edit this damage entry and select the floor before marking it replaced.');
      return;
    }

    if (nextReplaced) {
      const ok = window.confirm(
        isSupervisorStoreDamage
          ? `Confirm replacement?\n\n${row.qty} ${row.linen_type} will be marked as replaced from Supervisor Store. Floor stock will not be adjusted.`
          : `Confirm replacement?\n\n${row.qty} ${row.linen_type} will be deducted from Supervisor Store and placed back into ${targetFloor?.label}.`
      );

      if (!ok) return;
    }

    try {
      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');

      if (nextReplaced && !isSupervisorStoreDamage) {
        const { data: stockRow, error: stockError } = await supabase
          .from('linen_stock')
          .select('linen_type, in_room_par, floor_store_stock, contractor_stock')
          .eq('linen_type', row.linen_type)
          .maybeSingle();

        if (stockError) throw stockError;

        const supervisorStore = safeNumber(stockRow?.floor_store_stock);
        const qty = safeNumber(row.qty);

        if (supervisorStore < qty) {
          throw new Error(`Supervisor Store only has ${supervisorStore} ${row.linen_type}. Cannot replace ${qty}.`);
        }

        const { error: storeError } = await supabase
          .from('linen_stock')
          .upsert(
            [
              {
                linen_type: row.linen_type,
                in_room_par: safeNumber(stockRow?.in_room_par),
                contractor_stock: safeNumber(stockRow?.contractor_stock),
                floor_store_stock: supervisorStore - qty,
              },
            ],
            { onConflict: 'linen_type' }
          );

        if (storeError) throw storeError;

        const { data: floorRows, error: floorFetchError } = await supabase
          .from('linen_floor_stock')
          .select('block_no, floor_no, linen_type, qty')
          .eq('block_no', targetFloor!.block)
          .eq('floor_no', targetFloor!.floor)
          .eq('linen_type', row.linen_type);

        if (floorFetchError) throw floorFetchError;

        const currentFloorQty = safeNumber((floorRows || [])[0]?.qty);
        const { error: floorError } = await supabase
          .from('linen_floor_stock')
          .upsert(
            [
              {
                block_no: targetFloor!.block,
                floor_no: targetFloor!.floor,
                linen_type: row.linen_type,
                qty: currentFloorQty + qty,
              },
            ],
            { onConflict: 'block_no,floor_no,linen_type' }
          );

        if (floorError) throw floorError;
      }

      const { error } = await supabase
        .from('linen_damage_log')
        .update({
          replaced: nextReplaced,
          updated_by_user_id: profile.user_id,
          updated_by_name: profile.name || profile.email,
        })
        .eq('id', row.id);

      if (error) throw error;

      setDamageRows((rows) =>
        rows.map((item) =>
          item.id === row.id ? { ...item, replaced: nextReplaced } : item
        )
      );
      setSuccessMsg(nextReplaced ? 'Marked as replaced.' : 'Marked as not replaced.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to update replacement status');
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) {
    return <main style={styles.page}><div style={styles.centerCard}>Loading...</div></main>;
  }

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
          <p style={styles.centerText}>You do not have permission to access this page.</p>
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
            <div style={styles.pageTitle}>Damaged Linen</div>
            <div style={styles.pageSubTitle}>{profile.name} ({profile.role})</div>
          </div>
          <div style={styles.topBarActions}>
            <Link href="/dashboard" style={styles.secondaryBtn}>Back to Dashboard</Link>
          </div>
        </div>

        {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}
        {successMsg ? <div style={styles.successBox}>{successMsg}</div> : null}

        <section style={styles.panel}>
          <div style={styles.sectionTitle}>{editingId ? 'Edit Damage' : 'Add Damage'}</div>

          <div style={styles.formGrid}>
            <div style={styles.fieldWrap}>
              <label style={styles.label}>Date</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={styles.input}
                disabled={saving}
              />
            </div>

            <div style={styles.fieldWrap}>
              <label style={styles.label}>Linen Type</label>
              <select
                value={formLinenType}
                onChange={(e) => setFormLinenType(e.target.value)}
                style={styles.input}
                disabled={saving}
              >
                {LINEN_TYPES.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>

            <div style={styles.fieldWrap}>
              <label style={styles.label}>Floor</label>
              <select
                value={formFloorKey}
                onChange={(e) => setFormFloorKey(e.target.value)}
                style={styles.input}
                disabled={saving}
              >
                {FLOOR_OPTIONS.map((floor) => (
                  <option key={floor.key} value={floor.key}>{floor.label}</option>
                ))}
              </select>
            </div>

            <div style={styles.fieldWrap}>
              <label style={styles.label}>Quantity</label>
              <input
                type="number"
                min="1"
                inputMode="numeric"
                value={formQty}
                onChange={(e) => setFormQty(e.target.value)}
                placeholder="Enter quantity"
                style={styles.input}
                disabled={saving}
              />
            </div>
          </div>

          <div style={{ ...styles.fieldWrap, marginTop: 14 }}>
            <label style={styles.label}>Notes</label>
            <textarea
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="Optional notes"
              style={styles.textarea}
              disabled={saving}
            />
          </div>

          <div style={styles.actionRow}>
            <button
              type="button"
              onClick={submitDamage}
              disabled={saving}
              style={{ ...styles.primaryBtn, opacity: saving ? 0.6 : 1 }}
            >
              {saving ? 'Saving...' : editingId ? 'Update Entry' : 'Submit Damaged Linen'}
            </button>

            {editingId ? (
              <button
                type="button"
                onClick={resetForm}
                disabled={saving}
                style={styles.secondaryGhostBtn}
              >
                Cancel Edit
              </button>
            ) : null}
          </div>
        </section>

        <section style={styles.panel}>
          <div style={styles.sectionTitle}>Damaged Linen Log</div>

          {loading ? (
            <div style={styles.emptyState}>Loading damage log...</div>
          ) : damageRows.length === 0 ? (
            <div style={styles.emptyState}>No damage entries for this date.</div>
          ) : (
            <div style={styles.logList}>
              {damageRows.map((row) => (
                <article key={row.id} style={styles.logCard}>
                  <div style={styles.logHeader}>
                    <div style={styles.logInfo}>
                      <div style={styles.logTitle}>{row.linen_type}</div>
                      <div style={styles.logMeta}>Qty: {row.qty}</div>
                      <div style={styles.logMeta}>Floor: {floorLabel(row.block_no, row.floor_no)}</div>
                      <label style={styles.replacedCheck}>
                        <input
                          type="checkbox"
                          checked={row.replaced === true}
                          onChange={(e) => void toggleReplaced(row, e.target.checked)}
                          disabled={saving}
                          style={styles.replacedInput}
                        />
                        <span style={row.replaced === true ? styles.replacedTextDone : styles.replacedText}>
                          Replaced
                        </span>
                      </label>
                      <div style={styles.logMeta}>By: {row.updated_by_name || '-'}</div>
                      <div style={styles.logMeta}>{formatDateTime(row.updated_at || row.created_at)}</div>
                    </div>

                    <div style={styles.logActions}>
                      <button
                        type="button"
                        onClick={() => startEdit(row)}
                        disabled={saving}
                        style={styles.editBtn}
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        onClick={() => void deleteRow(row.id)}
                        disabled={saving}
                        style={styles.deleteBtn}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {row.notes ? <div style={styles.notesBox}>{row.notes}</div> : null}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f8fafc',
    padding: '20px 14px 40px',
  },
  shell: {
    width: '100%',
    maxWidth: '980px',
    margin: '0 auto',
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '14px',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: '18px',
  },
  topBarActions: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  pageTitle: {
    fontSize: '28px',
    fontWeight: 800,
    color: '#0f172a',
    lineHeight: 1.1,
  },
  pageSubTitle: {
    fontSize: '14px',
    color: '#64748b',
    marginTop: '6px',
  },
  panel: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '22px',
    padding: '18px',
    boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
    marginBottom: '16px',
    overflow: 'hidden',
  },
  sectionTitle: {
    fontSize: '22px',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '16px',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '14px',
  },
  fieldWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    minWidth: 0,
  },
  label: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#334155',
  },
  input: {
    width: '100%',
    minWidth: 0,
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '12px 14px',
    fontSize: '15px',
    outline: 'none',
    boxSizing: 'border-box',
    appearance: 'none',
    WebkitAppearance: 'none',
  },
  textarea: {
    width: '100%',
    minHeight: '120px',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '12px 14px',
    fontSize: '15px',
    outline: 'none',
    resize: 'vertical',
    boxSizing: 'border-box',
  },
  actionRow: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
    marginTop: '16px',
  },
  primaryBtn: {
    border: 'none',
    background: '#0f172a',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryGhostBtn: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#334155',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    textDecoration: 'none',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 700,
  },
  logList: {
    display: 'grid',
    gap: '12px',
  },
  logCard: {
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    background: '#ffffff',
    padding: '16px',
  },
  logHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '14px',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  logInfo: {
    minWidth: 0,
    flex: 1,
  },
  logTitle: {
    fontSize: '20px',
    fontWeight: 800,
    color: '#0f172a',
    lineHeight: 1.2,
    marginBottom: '8px',
    wordBreak: 'break-word',
  },
  logMeta: {
    fontSize: '13px',
    color: '#64748b',
    fontWeight: 600,
    marginTop: '3px',
    wordBreak: 'break-word',
  },
  replacedCheck: {
    marginTop: '8px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    width: 'fit-content',
    border: '1px solid #dbeafe',
    background: '#eff6ff',
    color: '#1d4ed8',
    borderRadius: '999px',
    padding: '8px 10px',
    fontSize: '13px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  replacedInput: {
    width: '16px',
    height: '16px',
    accentColor: '#16a34a',
    cursor: 'pointer',
  },
  replacedText: {
    color: '#1d4ed8',
  },
  replacedTextDone: {
    color: '#15803d',
  },
  logActions: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  editBtn: {
    border: '1px solid #2563eb',
    background: '#eff6ff',
    color: '#1d4ed8',
    borderRadius: '10px',
    padding: '10px 12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  deleteBtn: {
    border: '1px solid #dc2626',
    background: '#fef2f2',
    color: '#b91c1c',
    borderRadius: '10px',
    padding: '10px 12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  notesBox: {
    marginTop: '12px',
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '12px 14px',
    color: '#334155',
    fontSize: '14px',
    lineHeight: 1.5,
    wordBreak: 'break-word',
  },
  errorBox: {
    marginBottom: '14px',
    background: '#fef2f2',
    color: '#b91c1c',
    border: '1px solid #fecaca',
    borderRadius: '12px',
    padding: '12px 14px',
    fontWeight: 600,
  },
  successBox: {
    marginBottom: '14px',
    background: '#ecfdf5',
    color: '#166534',
    border: '1px solid #bbf7d0',
    borderRadius: '12px',
    padding: '12px 14px',
    fontWeight: 600,
  },
  emptyState: {
    border: '1px dashed #cbd5e1',
    background: '#f8fafc',
    borderRadius: '14px',
    padding: '24px',
    textAlign: 'center',
    color: '#64748b',
    fontWeight: 600,
  },
  centerCard: {
    maxWidth: '460px',
    margin: '80px auto',
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    padding: '24px',
    textAlign: 'center',
    boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
  },
  centerTitle: {
    fontSize: '24px',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '10px',
  },
  centerText: {
    fontSize: '15px',
    color: '#64748b',
    lineHeight: 1.5,
    marginBottom: '16px',
  },
  linkBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    textDecoration: 'none',
    border: '1px solid #0f172a',
    background: '#0f172a',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 700,
  },
};
