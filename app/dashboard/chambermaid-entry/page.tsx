'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type DashboardUser = {
  user_id?: string;
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'HK' | 'MT' | 'FO';
};

type RoomRow = {
  room_number: string;
  block_no: number;
  floor_no: number;
  room_type: string;
  supervisor_status: 'CHECKOUT' | 'STAYOVER';
};

type RoomEntryState = {
  is_dnd: boolean;
  bedsheet_king: number;
  pillow_case: number;
  bath_towel: number;
  bath_mat: number;
  duvet_cover_king: number;
  duvet_cover_single: number;
  isSaving?: boolean;
  savedAt?: string;
};

const BLOCKS = [1, 2];
const FLOORS_BY_BLOCK: Record<number, number[]> = {
  1: [1, 2, 3, 5],
  2: [3, 5, 6, 7],
};

const LINEN_FIELDS: Array<{
  key: keyof Omit<
    RoomEntryState,
    'is_dnd' | 'isSaving' | 'savedAt'
  >;
  label: string;
}> = [
  { key: 'bedsheet_king', label: 'Bedsheet King' },
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

function emptyEntry(): RoomEntryState {
  return {
    is_dnd: false,
    bedsheet_king: 0,
    pillow_case: 0,
    bath_towel: 0,
    bath_mat: 0,
    duvet_cover_king: 0,
    duvet_cover_single: 0,
  };
}

function formatTime(value?: string) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ChambermaidEntryPage() {
  const [profile, setProfile] = useState<DashboardUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [serviceDate] = useState(getTodayLocalDateString());
  const [selectedBlock, setSelectedBlock] = useState<number>(1);
  const [selectedFloor, setSelectedFloor] = useState<number>(1);

  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [entryMap, setEntryMap] = useState<Record<string, RoomEntryState>>({});

  useEffect(() => {
    const validFloors = FLOORS_BY_BLOCK[selectedBlock] || [];
    if (!validFloors.includes(selectedFloor)) {
      setSelectedFloor(validFloors[0] || 1);
    }
  }, [selectedBlock, selectedFloor]);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const supabase = getSupabaseSafe();
        if (!supabase) {
          throw new Error(
            'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.'
          );
        }

        setAuthLoading(true);
        setErrorMsg('');

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        if (!session?.user) {
          if (!mounted) return;
          setProfile(null);
          setAuthLoading(false);
          setPageLoading(false);
          return;
        }

        const userId = session.user.id;
        const email = session.user.email || '';

        const { data: profileRow, error: profileError } = await supabase
          .from('user_profiles')
          .select('user_id, email, name, role')
          .eq('user_id', userId)
          .maybeSingle();

        if (profileError) throw profileError;

        const nextProfile: DashboardUser = {
          user_id: userId,
          email: profileRow?.email || email,
          name: profileRow?.name || email || 'User',
          role: (profileRow?.role || 'HK') as DashboardUser['role'],
        };

        if (!mounted) return;
        setProfile(nextProfile);
      } catch (err: any) {
        if (!mounted) return;
        setErrorMsg(err?.message || 'Failed to load session');
      } finally {
        if (mounted) {
          setAuthLoading(false);
        }
      }
    }

    bootstrap();

    return () => {
      mounted = false;
    };
  }, []);

  const canAccess = useMemo(() => {
    if (!profile) return false;
    return (
      profile.role === 'SUPERUSER' ||
      profile.role === 'MANAGER' ||
      profile.role === 'SUPERVISOR' ||
      profile.role === 'HK'
    );
  }, [profile]);

  async function loadFloorData(blockNo: number, floorNo: number) {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    try {
      setPageLoading(true);
      setErrorMsg('');
      setSuccessMsg('');

      const { data: statusRows, error: statusError } = await supabase
        .from('linen_room_status')
        .select('room_number, status, room_master!inner(room_number, block_no, floor_no, room_type, is_active)')
        .eq('service_date', serviceDate)
        .eq('room_master.block_no', blockNo)
        .eq('room_master.floor_no', floorNo)
        .eq('room_master.is_active', true)
        .in('status', ['CHECKOUT', 'STAYOVER'])
        .order('room_number', { ascending: true });

      if (statusError) throw statusError;

      const nextRooms: RoomRow[] = (statusRows || []).map((row: any) => ({
        room_number: row.room_number,
        block_no: row.room_master.block_no,
        floor_no: row.room_master.floor_no,
        room_type: row.room_master.room_type,
        supervisor_status: row.status,
      }));

      const roomNumbers = nextRooms.map((room) => room.room_number);
      let entryRows: any[] = [];

      if (roomNumbers.length > 0) {
        const { data, error: entryError } = await supabase
          .from('linen_room_entry')
          .select(
            'room_number, is_dnd, bedsheet_king, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single, updated_at'
          )
          .eq('service_date', serviceDate)
          .in('room_number', roomNumbers);

        if (entryError) throw entryError;
        entryRows = data || [];
      }

      const nextEntryMap: Record<string, RoomEntryState> = {};
      nextRooms.forEach((room) => {
        nextEntryMap[room.room_number] = emptyEntry();
      });

      entryRows.forEach((row: any) => {
        nextEntryMap[row.room_number] = {
          is_dnd: !!row.is_dnd,
          bedsheet_king: row.bedsheet_king || 0,
          pillow_case: row.pillow_case || 0,
          bath_towel: row.bath_towel || 0,
          bath_mat: row.bath_mat || 0,
          duvet_cover_king: row.duvet_cover_king || 0,
          duvet_cover_single: row.duvet_cover_single || 0,
          savedAt: row.updated_at || '',
        };
      });

      setRooms(nextRooms);
      setEntryMap(nextEntryMap);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load chambermaid rooms');
      setRooms([]);
      setEntryMap({});
    } finally {
      setPageLoading(false);
    }
  }

  useEffect(() => {
    if (!profile || !canAccess) {
      setRooms([]);
      setEntryMap({});
      setPageLoading(false);
      return;
    }

    void loadFloorData(selectedBlock, selectedFloor);
  }, [profile, canAccess, selectedBlock, selectedFloor, serviceDate]);

  function updateRoomField(
    roomNumber: string,
    field: keyof Omit<RoomEntryState, 'isSaving' | 'savedAt'>,
    value: boolean | number
  ) {
    setEntryMap((prev) => {
      const current = prev[roomNumber] || emptyEntry();
      const next = {
        ...current,
        [field]: value,
      } as RoomEntryState;

      if (field === 'is_dnd' && value === true) {
        next.bedsheet_king = 0;
        next.pillow_case = 0;
        next.bath_towel = 0;
        next.bath_mat = 0;
        next.duvet_cover_king = 0;
        next.duvet_cover_single = 0;
      }

      return {
        ...prev,
        [roomNumber]: next,
      };
    });

    setSuccessMsg('');
  }

  function adjustQty(
    roomNumber: string,
    field: keyof Omit<RoomEntryState, 'is_dnd' | 'isSaving' | 'savedAt'>,
    delta: number
  ) {
    setEntryMap((prev) => {
      const current = prev[roomNumber] || emptyEntry();
      if (current.is_dnd) return prev;

      const nextValue = Math.max(0, (current[field] as number) + delta);
      return {
        ...prev,
        [roomNumber]: {
          ...current,
          [field]: nextValue,
        },
      };
    });

    setSuccessMsg('');
  }

  async function saveRoom(room: RoomRow) {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    if (!profile?.user_id) {
      setErrorMsg('User not found.');
      return;
    }

    const entry = entryMap[room.room_number] || emptyEntry();

    setEntryMap((prev) => ({
      ...prev,
      [room.room_number]: {
        ...entry,
        isSaving: true,
      },
    }));
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const payload = {
        service_date: serviceDate,
        room_number: room.room_number,
        block_no: room.block_no,
        floor_no: room.floor_no,
        is_dnd: entry.is_dnd,
        bedsheet_king: entry.is_dnd ? 0 : entry.bedsheet_king,
        pillow_case: entry.is_dnd ? 0 : entry.pillow_case,
        bath_towel: entry.is_dnd ? 0 : entry.bath_towel,
        bath_mat: entry.is_dnd ? 0 : entry.bath_mat,
        duvet_cover_king: entry.is_dnd ? 0 : entry.duvet_cover_king,
        duvet_cover_single: entry.is_dnd ? 0 : entry.duvet_cover_single,
        updated_by_user_id: profile.user_id,
        updated_by_name: profile.name || profile.email,
      };

      const { error } = await supabase.from('linen_room_entry').upsert([payload], {
        onConflict: 'service_date,room_number',
      });

      if (error) throw error;

      const savedAt = new Date().toISOString();
      setEntryMap((prev) => ({
        ...prev,
        [room.room_number]: {
          ...payload,
          isSaving: false,
          savedAt,
        },
      }));
      setSuccessMsg(`Saved room ${room.room_number}.`);
    } catch (err: any) {
      setEntryMap((prev) => ({
        ...prev,
        [room.room_number]: {
          ...(prev[room.room_number] || emptyEntry()),
          isSaving: false,
        },
      }));
      setErrorMsg(err?.message || `Failed to save ${room.room_number}`);
    }
  }

  const roomCount = rooms.length;
  const savedCount = useMemo(() => {
    return rooms.filter((room) => {
      const entry = entryMap[room.room_number];
      return !!entry?.savedAt;
    }).length;
  }, [rooms, entryMap]);

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
          <p style={styles.centerText}>Please log in first, then open this page again.</p>
          <Link href="/dashboard" style={styles.linkBtn}>
            Back to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  if (!canAccess) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>
          <div style={styles.centerTitle}>Access denied</div>
          <p style={styles.centerText}>Only HK, Supervisor, Manager, and Superuser can access Chambermaid Entry.</p>
          <Link href="/dashboard" style={styles.linkBtn}>
            Back to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.topBar}>
          <div>
            <div style={styles.pageTitle}>Chambermaid Entry</div>
            <div style={styles.pageSubTitle}>
              Service Date: {serviceDate} · {profile.name} ({profile.role})
            </div>
          </div>

          <div style={styles.topBarActions}>
            <Link href="/dashboard" style={styles.secondaryBtn}>
              Back to Dashboard
            </Link>
          </div>
        </div>

        <div style={styles.controlCard}>
          <div style={styles.controlRow}>
            <div style={styles.controlGroup}>
              <label style={styles.label}>Block</label>
              <div style={styles.pillRow}>
                {BLOCKS.map((block) => (
                  <button
                    key={block}
                    type="button"
                    onClick={() => setSelectedBlock(block)}
                    style={{
                      ...styles.pillBtn,
                      ...(selectedBlock === block ? styles.pillBtnActive : {}),
                    }}
                  >
                    Block {block}
                  </button>
                ))}
              </div>
            </div>

            <div style={styles.controlGroup}>
              <label style={styles.label}>Floor</label>
              <div style={styles.pillRow}>
                {(FLOORS_BY_BLOCK[selectedBlock] || []).map((floor) => (
                  <button
                    key={floor}
                    type="button"
                    onClick={() => setSelectedFloor(floor)}
                    style={{
                      ...styles.pillBtn,
                      ...(selectedFloor === floor ? styles.pillBtnActive : {}),
                    }}
                  >
                    Floor {floor}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={styles.summaryGrid}>
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Rooms to Service</div>
              <div style={styles.summaryValue}>{roomCount}</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Rooms Submitted</div>
              <div style={{ ...styles.summaryValue, color: '#166534' }}>{savedCount}</div>
            </div>
          </div>

          {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}
          {successMsg ? <div style={styles.successBox}>{successMsg}</div> : null}
        </div>

        {pageLoading ? (
          <div style={styles.gridCard}>
            <div style={styles.emptyState}>Loading rooms...</div>
          </div>
        ) : rooms.length === 0 ? (
          <div style={styles.gridCard}>
            <div style={styles.emptyState}>No supervisor-marked rooms found for this floor.</div>
          </div>
        ) : (
          <div style={styles.cardsWrap}>
            {rooms.map((room) => {
              const entry = entryMap[room.room_number] || emptyEntry();
              const isSaving = !!entry.isSaving;

              return (
                <div key={room.room_number} style={styles.roomCard}>
                  <div style={styles.roomCardHeader}>
                    <div>
                      <div style={styles.roomNo}>{room.room_number}</div>
                      <div style={styles.roomType}>{room.room_type}</div>
                    </div>
                    <div
                      style={{
                        ...styles.statusPill,
                        background:
                          room.supervisor_status === 'CHECKOUT' ? '#dcfce7' : '#dbeafe',
                        color:
                          room.supervisor_status === 'CHECKOUT' ? '#166534' : '#1d4ed8',
                      }}
                    >
                      {room.supervisor_status === 'CHECKOUT' ? 'CHECK OUT' : 'STAY OVER'}
                    </div>
                  </div>

                  <div style={styles.dndRow}>
                    <label style={styles.dndLabel}>
                      <input
                        type="checkbox"
                        checked={entry.is_dnd}
                        onChange={(e) =>
                          updateRoomField(room.room_number, 'is_dnd', e.target.checked)
                        }
                      />
                      <span>Mark as DND</span>
                    </label>
                    {entry.savedAt ? (
                      <div style={styles.savedAtText}>Last saved {formatTime(entry.savedAt)}</div>
                    ) : null}
                  </div>

                  <div style={styles.linenList}>
                    {LINEN_FIELDS.map((item) => (
                      <div key={item.key} style={styles.linenRow}>
                        <div style={styles.linenLabel}>{item.label}</div>
                        <div style={styles.counterWrap}>
                          <button
                            type="button"
                            disabled={entry.is_dnd || isSaving}
                            onClick={() => adjustQty(room.room_number, item.key, -1)}
                            style={styles.counterBtn}
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min={0}
                            value={entry[item.key]}
                            disabled={entry.is_dnd || isSaving}
                            onChange={(e) =>
                              updateRoomField(
                                room.room_number,
                                item.key,
                                Math.max(0, Number(e.target.value || 0))
                              )
                            }
                            style={styles.counterInput}
                          />
                          <button
                            type="button"
                            disabled={entry.is_dnd || isSaving}
                            onClick={() => adjustQty(room.room_number, item.key, 1)}
                            style={styles.counterBtn}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => void saveRoom(room)}
                    disabled={isSaving}
                    style={{
                      ...styles.submitBtn,
                      opacity: isSaving ? 0.6 : 1,
                    }}
                  >
                    {isSaving ? 'Submitting...' : `Submit ${room.room_number}`}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f8fafc',
    padding: '20px',
  },
  shell: {
    width: '100%',
    maxWidth: '1200px',
    margin: '0 auto',
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '16px',
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
  controlCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    padding: '16px',
    boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
    marginBottom: '16px',
  },
  controlRow: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
    marginBottom: '14px',
  },
  controlGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  label: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#334155',
  },
  pillRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  pillBtn: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#334155',
    borderRadius: '999px',
    padding: '10px 14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  pillBtnActive: {
    background: '#0f172a',
    color: '#ffffff',
    borderColor: '#0f172a',
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
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '10px',
  },
  summaryCard: {
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '14px',
    padding: '14px',
  },
  summaryLabel: {
    fontSize: '13px',
    color: '#64748b',
    fontWeight: 700,
    marginBottom: '8px',
  },
  summaryValue: {
    fontSize: '28px',
    fontWeight: 800,
    color: '#0f172a',
    lineHeight: 1,
  },
  cardsWrap: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: '16px',
  },
  roomCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    padding: '16px',
    boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
  },
  roomCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'flex-start',
    marginBottom: '14px',
  },
  roomNo: {
    fontSize: '26px',
    fontWeight: 800,
    color: '#0f172a',
  },
  roomType: {
    fontSize: '13px',
    color: '#64748b',
    fontWeight: 700,
    marginTop: '4px',
  },
  statusPill: {
    borderRadius: '999px',
    padding: '8px 12px',
    fontSize: '12px',
    fontWeight: 800,
    whiteSpace: 'nowrap',
  },
  dndRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: '14px',
  },
  dndLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontWeight: 700,
    color: '#334155',
  },
  savedAtText: {
    fontSize: '12px',
    color: '#64748b',
    fontWeight: 700,
  },
  linenList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    marginBottom: '14px',
  },
  linenRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '10px',
    alignItems: 'center',
  },
  linenLabel: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#334155',
    flex: 1,
  },
  counterWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  counterBtn: {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    fontSize: '20px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  counterInput: {
    width: '58px',
    height: '36px',
    borderRadius: '10px',
    border: '1px solid #cbd5e1',
    textAlign: 'center',
    fontSize: '14px',
    fontWeight: 700,
    color: '#0f172a',
  },
  submitBtn: {
    width: '100%',
    border: 'none',
    background: '#0f172a',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  gridCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    padding: '16px',
    boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
  },
  errorBox: {
    marginTop: '14px',
    background: '#fef2f2',
    color: '#b91c1c',
    border: '1px solid #fecaca',
    borderRadius: '12px',
    padding: '12px 14px',
    fontWeight: 600,
  },
  successBox: {
    marginTop: '14px',
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
