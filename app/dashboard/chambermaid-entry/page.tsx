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
};

type EntryForm = {
  room_number: string;
  is_dnd: boolean;
  bedsheet_king: number;
  pillow_case: number;
  bath_towel: number;
  bath_mat: number;
  duvet_cover_king: number;
  duvet_cover_single: number;
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const BLOCKS = [1, 2];
const FLOORS_BY_BLOCK: Record<number, number[]> = {
  1: [1, 2, 3, 5],
  2: [3, 5, 6, 7],
};

const EMPTY_ENTRY = (roomNumber: string): EntryForm => ({
  room_number: roomNumber,
  is_dnd: false,
  bedsheet_king: 0,
  pillow_case: 0,
  bath_towel: 0,
  bath_mat: 0,
  duvet_cover_king: 0,
  duvet_cover_single: 0,
});

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

function canAccess(role?: DashboardUser['role']) {
  return (
    role === 'SUPERUSER' ||
    role === 'MANAGER' ||
    role === 'SUPERVISOR' ||
    role === 'HK'
  );
}

function fieldLabel(field: keyof Omit<EntryForm, 'room_number' | 'is_dnd'>) {
  const labels: Record<string, string> = {
    bedsheet_king: 'Bedsheet King',
    pillow_case: 'Pillow Case',
    bath_towel: 'Bath Towel',
    bath_mat: 'Bath Mat',
    duvet_cover_king: 'Duvet Cover King',
    duvet_cover_single: 'Duvet Cover Single',
  };
  return labels[field] || field;
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
  const [roomSearch, setRoomSearch] = useState('');

  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [entryMap, setEntryMap] = useState<Record<string, EntryForm>>({});
  const [saveStateMap, setSaveStateMap] = useState<Record<string, SaveState>>({});

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
          throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.');
        }

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
        if (mounted) setAuthLoading(false);
      }
    }

    bootstrap();

    return () => {
      mounted = false;
    };
  }, []);

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

      const { data: roomRows, error: roomError } = await supabase
        .from('room_master')
        .select('room_number, block_no, floor_no, room_type')
        .eq('block_no', blockNo)
        .eq('floor_no', floorNo)
        .eq('is_active', true)
        .order('room_number', { ascending: true });

      if (roomError) throw roomError;

      const floorRoomNumbers = (roomRows || []).map((r: any) => r.room_number);

      if (floorRoomNumbers.length === 0) {
        setRooms([]);
        setEntryMap({});
        setSaveStateMap({});
        return;
      }

      const { data: statusRows, error: statusError } = await supabase
        .from('linen_room_status')
        .select('room_number, status')
        .eq('service_date', serviceDate)
        .in('room_number', floorRoomNumbers)
        .in('status', ['CHECKOUT', 'STAYOVER']);

      if (statusError) throw statusError;

      const visibleSet = new Set((statusRows || []).map((row: any) => row.room_number));
      const visibleRooms = (roomRows || []).filter((room: any) => visibleSet.has(room.room_number));
      const visibleRoomNumbers = visibleRooms.map((room: any) => room.room_number);

      let entryRows: any[] = [];
      if (visibleRoomNumbers.length > 0) {
        const { data, error: entryError } = await supabase
          .from('linen_room_entry')
          .select(
            'room_number, is_dnd, bedsheet_king, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single'
          )
          .eq('service_date', serviceDate)
          .in('room_number', visibleRoomNumbers);

        if (entryError) throw entryError;
        entryRows = data || [];
      }

      const nextEntryMap: Record<string, EntryForm> = {};
      visibleRooms.forEach((room: any) => {
        nextEntryMap[room.room_number] = EMPTY_ENTRY(room.room_number);
      });

      entryRows.forEach((row: any) => {
        nextEntryMap[row.room_number] = {
          room_number: row.room_number,
          is_dnd: !!row.is_dnd,
          bedsheet_king: row.bedsheet_king || 0,
          pillow_case: row.pillow_case || 0,
          bath_towel: row.bath_towel || 0,
          bath_mat: row.bath_mat || 0,
          duvet_cover_king: row.duvet_cover_king || 0,
          duvet_cover_single: row.duvet_cover_single || 0,
        };
      });

      setRooms(visibleRooms as RoomRow[]);
      setEntryMap(nextEntryMap);
      setSaveStateMap({});
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load chambermaid rooms');
      setRooms([]);
      setEntryMap({});
      setSaveStateMap({});
    } finally {
      setPageLoading(false);
    }
  }

  useEffect(() => {
    if (!profile || !canAccess(profile.role)) {
      setRooms([]);
      setEntryMap({});
      setPageLoading(false);
      return;
    }

    void loadFloorData(selectedBlock, selectedFloor);
  }, [profile, selectedBlock, selectedFloor, serviceDate]);

  const filteredRooms = useMemo(() => {
    const keyword = roomSearch.trim();
    if (!keyword) return rooms;
    return rooms.filter((room) => room.room_number === keyword);
  }, [rooms, roomSearch]);

  function updateCount(roomNumber: string, field: keyof Omit<EntryForm, 'room_number' | 'is_dnd'>, delta: number) {
    setEntryMap((prev) => {
      const current = prev[roomNumber] || EMPTY_ENTRY(roomNumber);
      if (current.is_dnd) return prev;

      return {
        ...prev,
        [roomNumber]: {
          ...current,
          [field]: Math.max(0, (current[field] || 0) + delta),
        },
      };
    });
  }

  function toggleDnd(roomNumber: string) {
    setEntryMap((prev) => {
      const current = prev[roomNumber] || EMPTY_ENTRY(roomNumber);
      const nextIsDnd = !current.is_dnd;

      return {
        ...prev,
        [roomNumber]: nextIsDnd
          ? {
              ...current,
              is_dnd: true,
              bedsheet_king: 0,
              pillow_case: 0,
              bath_towel: 0,
              bath_mat: 0,
              duvet_cover_king: 0,
              duvet_cover_single: 0,
            }
          : {
              ...current,
              is_dnd: false,
            },
      };
    });
  }

  async function submitRoom(room: RoomRow) {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    if (!profile?.user_id) {
      setErrorMsg('User not found.');
      return;
    }

    const entry = entryMap[room.room_number] || EMPTY_ENTRY(room.room_number);

    try {
      setSaveStateMap((prev) => ({ ...prev, [room.room_number]: 'saving' }));
      setErrorMsg('');
      setSuccessMsg('');

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

      const { error } = await supabase
        .from('linen_room_entry')
        .upsert([payload], {
          onConflict: 'service_date,room_number',
        });

      if (error) throw error;

      setSaveStateMap((prev) => ({ ...prev, [room.room_number]: 'saved' }));
      setSuccessMsg(`Saved ${room.room_number}.`);

      window.setTimeout(() => {
        setSaveStateMap((prev) => ({
          ...prev,
          [room.room_number]: prev[room.room_number] === 'saved' ? 'idle' : prev[room.room_number],
        }));
      }, 1800);
    } catch (err: any) {
      setSaveStateMap((prev) => ({ ...prev, [room.room_number]: 'error' }));
      setErrorMsg(err?.message || `Failed to save ${room.room_number}`);
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
          <p style={styles.centerText}>Please log in first, then open this page again.</p>
          <Link href="/dashboard" style={styles.linkBtn}>
            Back to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  if (!canAccess(profile.role)) {
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

          <div style={styles.searchWrap}>
            <input
              type="text"
              value={roomSearch}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, '').slice(0, 4);
                setRoomSearch(value);
              }}
              placeholder="Enter exact room number"
              style={styles.searchInput}
            />
          </div>

          {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}
          {successMsg ? <div style={styles.successBox}>{successMsg}</div> : null}
        </div>

        <div style={styles.gridCard}>
          <div style={styles.gridHeader}>
            Block {selectedBlock} · Floor {selectedFloor}
          </div>

          {pageLoading ? (
            <div style={styles.emptyState}>Loading rooms...</div>
          ) : filteredRooms.length === 0 ? (
            <div style={styles.emptyState}>
              {roomSearch.trim()
                ? 'No matching room found on this floor that was marked by supervisor.'
                : 'No rooms marked by supervisor for this floor.'}
            </div>
          ) : (
            <div style={styles.roomList}>
              {filteredRooms.map((room) => {
                const entry = entryMap[room.room_number] || EMPTY_ENTRY(room.room_number);
                const saveState = saveStateMap[room.room_number] || 'idle';

                return (
                  <article key={room.room_number} style={styles.roomCard}>
                    <div style={styles.roomCardHeader}>
                      <div>
                        <div style={styles.roomNo}>{room.room_number}</div>
                        <div style={styles.roomType}>{room.room_type}</div>
                      </div>

                      <div style={styles.roomHeaderRight}>
                        <label style={styles.dndWrap}>
                          <input
                            type="checkbox"
                            checked={entry.is_dnd}
                            onChange={() => toggleDnd(room.room_number)}
                          />
                          <span>DND</span>
                        </label>

                        <button
                          type="button"
                          onClick={() => void submitRoom(room)}
                          style={{
                            ...styles.submitBtn,
                            ...(saveState === 'saving' ? styles.submitBtnMuted : {}),
                          }}
                          disabled={saveState === 'saving'}
                        >
                          {saveState === 'saving' ? 'Saving...' : 'Submit'}
                        </button>
                      </div>
                    </div>

                    <div style={styles.itemGrid}>
                      {(
                        [
                          'bedsheet_king',
                          'pillow_case',
                          'bath_towel',
                          'bath_mat',
                          'duvet_cover_king',
                          'duvet_cover_single',
                        ] as (keyof Omit<EntryForm, 'room_number' | 'is_dnd'>)[]
                      ).map((field) => (
                        <div key={field} style={styles.itemRow}>
                          <div style={styles.itemLabel}>{fieldLabel(field)}</div>
                          <div style={styles.counterWrap}>
                            <button
                              type="button"
                              onClick={() => updateCount(room.room_number, field, -1)}
                              style={styles.counterBtn}
                              disabled={entry.is_dnd}
                            >
                              −
                            </button>
                            <div style={styles.counterValue}>{entry[field]}</div>
                            <button
                              type="button"
                              onClick={() => updateCount(room.room_number, field, 1)}
                              style={styles.counterBtn}
                              disabled={entry.is_dnd}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {saveState === 'saved' ? (
                      <div style={styles.savedTag}>Saved</div>
                    ) : saveState === 'error' ? (
                      <div style={styles.errorTag}>Save failed</div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </div>
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
  searchWrap: {
    marginTop: '6px',
  },
  searchInput: {
    width: '100%',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '12px 14px',
    fontSize: '15px',
    outline: 'none',
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
  gridCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    padding: '16px',
    boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
  },
  gridHeader: {
    fontSize: '18px',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '14px',
  },
  roomList: {
    display: 'grid',
    gap: '14px',
  },
  roomCard: {
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    padding: '16px',
    background: '#f8fafc',
  },
  roomCardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    flexWrap: 'wrap',
    marginBottom: '14px',
  },
  roomHeaderRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  roomNo: {
    fontSize: '24px',
    fontWeight: 800,
    color: '#0f172a',
    lineHeight: 1,
  },
  roomType: {
    fontSize: '13px',
    color: '#64748b',
    marginTop: '6px',
    fontWeight: 600,
  },
  dndWrap: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    fontWeight: 700,
    color: '#334155',
  },
  submitBtn: {
    border: 'none',
    background: '#0f172a',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  submitBtnMuted: {
    opacity: 0.7,
    cursor: 'not-allowed',
  },
  itemGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '12px',
  },
  itemRow: {
    border: '1px solid #e2e8f0',
    background: '#ffffff',
    borderRadius: '14px',
    padding: '12px',
  },
  itemLabel: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#334155',
    marginBottom: '10px',
  },
  counterWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
  },
  counterBtn: {
    width: '40px',
    height: '40px',
    borderRadius: '12px',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    fontSize: '22px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  counterValue: {
    minWidth: '48px',
    textAlign: 'center',
    fontSize: '22px',
    fontWeight: 800,
    color: '#0f172a',
  },
  savedTag: {
    marginTop: '12px',
    color: '#166534',
    fontWeight: 700,
    fontSize: '13px',
  },
  errorTag: {
    marginTop: '12px',
    color: '#b91c1c',
    fontWeight: 700,
    fontSize: '13px',
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
