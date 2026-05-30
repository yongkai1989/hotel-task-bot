'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type UserRole = 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'HK' | 'MT' | 'FO';

type Profile = {
  user_id?: string;
  email: string;
  name: string;
  role: UserRole;
};

type RoomRow = {
  room_number: string;
  block_no: number;
  floor_no: number;
  room_type: string;
};

type LinenTotals = {
  bedsheet_king: number;
  bedsheet_single: number;
  pillow_case: number;
  bath_towel: number;
  bath_mat: number;
  duvet_cover_king: number;
  duvet_cover_single: number;
};

const PA_ALLOWED_EMAILS = [
  'pa@hotelhallmark.com',
  'laundry@hotelhallmark.com',
  'fenny@hotelhallmark.com',
  'manager@hotelhallmark.com',
  'hksup1@hotelhallmark.com',
  'hksup2@hotelhallmark.com',
  'hksup3@hotelhallmark.com',
];

const ITEM_DEFS: Array<{ key: keyof LinenTotals; label: string }> = [
  { key: 'bedsheet_king', label: 'Bedsheet King' },
  { key: 'bedsheet_single', label: 'Bedsheet Single' },
  { key: 'pillow_case', label: 'Pillow Case' },
  { key: 'bath_towel', label: 'Bath Towel' },
  { key: 'bath_mat', label: 'Bath Mat' },
  { key: 'duvet_cover_king', label: 'Duvet Cover King' },
  { key: 'duvet_cover_single', label: 'Duvet Cover Single' },
];

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

function shiftDateString(baseDate: string, offsetDays: number) {
  const d = new Date(`${baseDate}T00:00:00`);
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function zeroTotals(): LinenTotals {
  return {
    bedsheet_king: 0,
    bedsheet_single: 0,
    pillow_case: 0,
    bath_towel: 0,
    bath_mat: 0,
    duvet_cover_king: 0,
    duvet_cover_single: 0,
  };
}

function normalizeRoomNumber(value: string) {
  return value.trim().replace(/\s+/g, '');
}

export default function PaLinenEntryPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loadingRoom, setLoadingRoom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(1200);
  const [roomSearch, setRoomSearch] = useState('');
  const [room, setRoom] = useState<RoomRow | null>(null);
  const [entry, setEntry] = useState<LinenTotals>(zeroTotals());
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const today = getTodayLocalDateString();
  const laundryServiceDate = shiftDateString(today, 1);
  const isMobile = viewportWidth < 720;

  const canAccess = useMemo(() => {
    if (!profile) return false;
    if (profile.role === 'SUPERUSER') return true;
    return PA_ALLOWED_EMAILS.includes(String(profile.email || '').toLowerCase());
  }, [profile]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setViewportWidth(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const supabase = getSupabaseSafe();
        if (!supabase) throw new Error('Supabase is not configured.');

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        if (!session?.user) {
          if (mounted) setProfile(null);
          return;
        }

        const { data, error } = await supabase
          .from('user_profiles')
          .select('user_id, email, name, role')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (error) throw error;
        if (!mounted) return;

        setProfile({
          user_id: session.user.id,
          email: data?.email || session.user.email || '',
          name: data?.name || session.user.email || 'User',
          role: (data?.role || 'HK') as UserRole,
        });
      } catch (err: any) {
        if (mounted) setErrorMsg(err?.message || 'Failed to load session.');
      } finally {
        if (mounted) setAuthLoading(false);
      }
    }

    void bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  async function searchRoom() {
    const roomNumber = normalizeRoomNumber(roomSearch);
    if (!roomNumber) {
      setErrorMsg('Please enter a room number.');
      return;
    }

    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    try {
      setLoadingRoom(true);
      setErrorMsg('');
      setSuccessMsg('');
      setRoom(null);
      setEntry(zeroTotals());

      const { data: foundRoom, error: roomError } = await supabase
        .from('room_master')
        .select('room_number, block_no, floor_no, room_type')
        .eq('room_number', roomNumber)
        .eq('is_active', true)
        .maybeSingle();

      if (roomError) throw roomError;
      if (!foundRoom) {
        setErrorMsg(`Room ${roomNumber} was not found.`);
        return;
      }

      const { data: savedEntry, error: entryError } = await supabase
        .from('linen_pa_entry')
        .select('bedsheet_king, bedsheet_single, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single')
        .eq('service_date', laundryServiceDate)
        .eq('room_number', foundRoom.room_number)
        .maybeSingle();

      if (entryError) throw entryError;

      setRoom(foundRoom as RoomRow);
      setEntry({
        bedsheet_king: Number(savedEntry?.bedsheet_king || 0),
        bedsheet_single: Number(savedEntry?.bedsheet_single || 0),
        pillow_case: Number(savedEntry?.pillow_case || 0),
        bath_towel: Number(savedEntry?.bath_towel || 0),
        bath_mat: Number(savedEntry?.bath_mat || 0),
        duvet_cover_king: Number(savedEntry?.duvet_cover_king || 0),
        duvet_cover_single: Number(savedEntry?.duvet_cover_single || 0),
      });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to search room.');
    } finally {
      setLoadingRoom(false);
    }
  }

  function adjustQty(key: keyof LinenTotals, delta: number) {
    setEntry((prev) => ({
      ...prev,
      [key]: Math.max(0, Number(prev[key] || 0) + delta),
    }));
    setSuccessMsg('');
  }

  async function saveEntry() {
    if (!profile?.user_id || !room) return;

    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    try {
      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');

      const payload = {
        service_date: laundryServiceDate,
        entered_date: today,
        room_number: room.room_number,
        block_no: room.block_no,
        floor_no: room.floor_no,
        bedsheet_king: entry.bedsheet_king,
        bedsheet_single: entry.bedsheet_single,
        pillow_case: entry.pillow_case,
        bath_towel: entry.bath_towel,
        bath_mat: entry.bath_mat,
        duvet_cover_king: entry.duvet_cover_king,
        duvet_cover_single: entry.duvet_cover_single,
        updated_by_user_id: profile.user_id,
        updated_by_name: profile.name || profile.email,
        updated_by_email: profile.email,
      };

      const { error } = await supabase
        .from('linen_pa_entry')
        .upsert([payload], { onConflict: 'service_date,room_number' });

      if (error) throw error;

      setSuccessMsg(`Saved PA linen used for room ${room.room_number}. It will appear in Laundry Count for ${laundryServiceDate}.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save PA linen entry.');
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>Loading...</div>
      </main>
    );
  }

  if (!profile) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>
          <div style={styles.centerTitle}>Login required</div>
          <Link href="/dashboard" style={styles.secondaryBtn}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  if (!canAccess) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>
          <div style={styles.centerTitle}>Access denied</div>
          <p style={styles.mutedText}>Only authorised Public Area users and superusers can access PA Linen Entry.</p>
          <Link href="/dashboard" style={styles.secondaryBtn}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  return (
    <main style={{ ...styles.page, padding: isMobile ? '12px 10px 28px' : styles.page.padding }}>
      <div style={styles.shell}>
        <div style={{ ...styles.header, ...(isMobile ? styles.headerMobile : {}) }}>
          <div>
            <div style={styles.eyebrow}>Public Area</div>
            <div style={styles.pageTitle}>PA Linen Entry</div>
            <div style={styles.pageSubTitle}>
              {profile.name} ({profile.role}) - Extra linen changes added to next day's laundry count
            </div>
          </div>
          <Link href="/dashboard" style={{ ...styles.secondaryBtn, ...(isMobile ? styles.mobileBtn : {}) }}>
            Back to Dashboard
          </Link>
        </div>

        {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}
        {successMsg ? <div style={styles.successBox}>{successMsg}</div> : null}

        <section style={styles.panel}>
          <div style={styles.sectionTitle}>Find Room</div>
          <div style={{ ...styles.searchRow, ...(isMobile ? styles.searchRowMobile : {}) }}>
            <input
              value={roomSearch}
              onChange={(event) => setRoomSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void searchRoom();
              }}
              style={styles.input}
              inputMode="numeric"
              placeholder="Enter room number"
            />
            <button
              type="button"
              onClick={() => void searchRoom()}
              disabled={loadingRoom}
              style={{ ...styles.primaryBtn, ...(isMobile ? styles.mobileBtn : {}) }}
            >
              {loadingRoom ? 'Searching...' : 'Search'}
            </button>
          </div>
          <div style={styles.hintText}>
            Entries saved here are kept separate from Chambermaid Entry and will be counted as PA Used on {laundryServiceDate}.
          </div>
        </section>

        {room ? (
          <section style={styles.panel}>
            <div style={styles.roomHeader}>
              <div>
                <div style={styles.roomTitle}>Room {room.room_number}</div>
                <div style={styles.roomMeta}>Block {room.block_no} - Floor {room.floor_no} - {room.room_type}</div>
              </div>
              <div style={styles.statusPill}>Next laundry day: {laundryServiceDate}</div>
            </div>

            <div style={styles.linenList}>
              {ITEM_DEFS.map((item) => (
                <div key={item.key} style={styles.linenRow}>
                  <div>
                    <div style={styles.linenLabel}>{item.label}</div>
                    <div style={styles.linenSubLabel}>Extra PA change</div>
                  </div>
                  <div style={styles.qtyControl}>
                    <button type="button" onClick={() => adjustQty(item.key, -1)} style={styles.qtyBtn}>-</button>
                    <div style={styles.qtyValue}>{entry[item.key]}</div>
                    <button type="button" onClick={() => adjustQty(item.key, 1)} style={styles.qtyBtn}>+</button>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ ...styles.actionRow, ...(isMobile ? styles.actionRowMobile : {}) }}>
              <button
                type="button"
                onClick={() => {
                  setRoom(null);
                  setEntry(zeroTotals());
                  setRoomSearch('');
                }}
                style={{ ...styles.secondaryBtn, ...(isMobile ? styles.mobileBtn : {}) }}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => void saveEntry()}
                disabled={saving}
                style={{
                  ...styles.primaryBtn,
                  ...(isMobile ? styles.mobileBtn : {}),
                  opacity: saving ? 0.55 : 1,
                }}
              >
                {saving ? 'Saving...' : 'Save PA Used'}
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(180deg, #f3f7ff 0%, #f8fafc 42%, #ffffff 100%)',
    padding: '20px 16px 40px',
  },
  shell: {
    width: '100%',
    maxWidth: '980px',
    margin: '0 auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '16px',
    alignItems: 'center',
    flexWrap: 'wrap',
    background: 'rgba(255,255,255,0.92)',
    border: '1px solid #dbe7f7',
    borderRadius: '24px',
    padding: '18px 20px',
    boxShadow: '0 18px 42px rgba(37,99,235,0.08)',
    marginBottom: '16px',
  },
  headerMobile: {
    alignItems: 'stretch',
    borderRadius: '18px',
    padding: '16px',
  },
  eyebrow: {
    fontSize: '11px',
    color: '#2563eb',
    fontWeight: 900,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: '6px',
  },
  pageTitle: {
    fontSize: 'clamp(28px, 4vw, 38px)',
    fontWeight: 900,
    color: '#0f172a',
    lineHeight: 1.05,
  },
  pageSubTitle: {
    fontSize: '14px',
    color: '#64748b',
    marginTop: '6px',
  },
  panel: {
    background: 'rgba(255,255,255,0.94)',
    border: '1px solid #dbe7f7',
    borderRadius: '22px',
    padding: '18px',
    boxShadow: '0 18px 46px rgba(15,23,42,0.06)',
    marginBottom: '16px',
  },
  sectionTitle: {
    fontSize: '22px',
    fontWeight: 900,
    color: '#0f172a',
    marginBottom: '12px',
  },
  searchRow: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: '10px',
    alignItems: 'center',
  },
  searchRowMobile: {
    gridTemplateColumns: '1fr',
  },
  input: {
    width: '100%',
    minHeight: '52px',
    border: '1px solid #cbd5e1',
    borderRadius: '14px',
    padding: '0 16px',
    fontSize: '16px',
    outline: 'none',
    background: '#fff',
  },
  primaryBtn: {
    minHeight: '52px',
    border: 0,
    borderRadius: '14px',
    padding: '0 18px',
    background: '#2563eb',
    color: '#fff',
    fontWeight: 900,
    cursor: 'pointer',
    boxShadow: '0 14px 26px rgba(37,99,235,0.24)',
  },
  secondaryBtn: {
    minHeight: '48px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid #cbd5e1',
    borderRadius: '14px',
    padding: '0 16px',
    background: '#fff',
    color: '#0f172a',
    fontWeight: 900,
    textDecoration: 'none',
    cursor: 'pointer',
  },
  mobileBtn: {
    width: '100%',
  },
  hintText: {
    color: '#64748b',
    fontSize: '13px',
    fontWeight: 700,
    marginTop: '10px',
  },
  roomHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap',
    borderBottom: '1px solid #e2e8f0',
    paddingBottom: '12px',
    marginBottom: '8px',
  },
  roomTitle: {
    color: '#0f172a',
    fontSize: '24px',
    fontWeight: 900,
  },
  roomMeta: {
    color: '#64748b',
    fontSize: '13px',
    fontWeight: 800,
    marginTop: '4px',
  },
  statusPill: {
    border: '1px solid #bfdbfe',
    background: '#eff6ff',
    color: '#1d4ed8',
    borderRadius: '999px',
    padding: '8px 11px',
    fontSize: '12px',
    fontWeight: 900,
  },
  linenList: {
    display: 'grid',
    gap: '10px',
  },
  linenRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    borderBottom: '1px solid #e2e8f0',
    padding: '12px 0',
  },
  linenLabel: {
    fontSize: '16px',
    fontWeight: 900,
    color: '#0f172a',
  },
  linenSubLabel: {
    fontSize: '12px',
    color: '#64748b',
    fontWeight: 700,
    marginTop: '3px',
  },
  qtyControl: {
    display: 'grid',
    gridTemplateColumns: '42px 52px 42px',
    gap: '8px',
    alignItems: 'center',
  },
  qtyBtn: {
    width: '42px',
    height: '42px',
    border: '1px solid #cbd5e1',
    borderRadius: '13px',
    background: '#f8fafc',
    color: '#0f172a',
    fontSize: '20px',
    fontWeight: 900,
    cursor: 'pointer',
  },
  qtyValue: {
    textAlign: 'center',
    color: '#0f172a',
    fontSize: '22px',
    fontWeight: 900,
  },
  actionRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    flexWrap: 'wrap',
    marginTop: '16px',
  },
  actionRowMobile: {
    display: 'grid',
    gridTemplateColumns: '1fr',
  },
  errorBox: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#b91c1c',
    borderRadius: '14px',
    padding: '12px 14px',
    fontWeight: 900,
    marginBottom: '12px',
  },
  successBox: {
    background: '#ecfdf5',
    border: '1px solid #bbf7d0',
    color: '#047857',
    borderRadius: '14px',
    padding: '12px 14px',
    fontWeight: 900,
    marginBottom: '12px',
  },
  centerCard: {
    width: 'min(520px, calc(100vw - 32px))',
    margin: '80px auto',
    background: '#fff',
    border: '1px solid #dbe7f7',
    borderRadius: '22px',
    padding: '24px',
    textAlign: 'center',
    boxShadow: '0 18px 46px rgba(15,23,42,0.08)',
  },
  centerTitle: {
    fontSize: '24px',
    fontWeight: 900,
    color: '#0f172a',
    marginBottom: '12px',
  },
  mutedText: {
    color: '#64748b',
    fontWeight: 700,
  },
};
