
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type DashboardUser = {
  user_id?: string;
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'HK' | 'MT' | 'FO';
  can_access_chambermaid_entry?: boolean;
};

type RoomRow = {
  room_number: string;
  block_no: number;
  floor_no: number;
  room_type: string;
  supervisor_status: 'CHECKOUT' | 'STAYOVER';
};

type LinenValues = {
  is_dnd: boolean;
  bedsheet_king: number;
  pillow_case: number;
  bath_towel: number;
  bath_mat: number;
  duvet_cover_king: number;
  duvet_cover_single: number;
};

type RoomEntryState = LinenValues & {
  isSaving?: boolean;
  savedAt?: string;
  updatedByName?: string;
  wasEverSaved?: boolean;
  defaultValues: LinenValues;
  lastSavedValues?: LinenValues | null;
};

type LinenMapRow = {
  room_type: string;
  bedsheet_king: number | null;
  pillow_case: number | null;
  bath_towel: number | null;
  bath_mat: number | null;
  duvet_cover_king: number | null;
  duvet_cover_single: number | null;
};

const BLOCKS = [1, 2];
const FLOORS_BY_BLOCK: Record<number, number[]> = {
  1: [1, 2, 3, 5],
  2: [3, 5, 6, 7],
};

const LINEN_FIELDS: Array<{
  key: keyof Omit<LinenValues, 'is_dnd'>;
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

function zeroLinenValues(): LinenValues {
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

function linenValuesEqual(a?: LinenValues | null, b?: LinenValues | null) {
  if (!a || !b) return false;
  return (
    a.is_dnd === b.is_dnd &&
    a.bedsheet_king === b.bedsheet_king &&
    a.pillow_case === b.pillow_case &&
    a.bath_towel === b.bath_towel &&
    a.bath_mat === b.bath_mat &&
    a.duvet_cover_king === b.duvet_cover_king &&
    a.duvet_cover_single === b.duvet_cover_single
  );
}

function cloneLinenValues(values: LinenValues): LinenValues {
  return {
    is_dnd: values.is_dnd,
    bedsheet_king: values.bedsheet_king,
    pillow_case: values.pillow_case,
    bath_towel: values.bath_towel,
    bath_mat: values.bath_mat,
    duvet_cover_king: values.duvet_cover_king,
    duvet_cover_single: values.duvet_cover_single,
  };
}

function buildDefaultValuesFromMap(roomType: string, mapByType: Record<string, LinenMapRow>): LinenValues {
  const row = mapByType[roomType];
  return {
    is_dnd: false,
    bedsheet_king: Number(row?.bedsheet_king || 0),
    pillow_case: Number(row?.pillow_case || 0),
    bath_towel: Number(row?.bath_towel || 0),
    bath_mat: Number(row?.bath_mat || 0),
    duvet_cover_king: Number(row?.duvet_cover_king || 0),
    duvet_cover_single: Number(row?.duvet_cover_single || 0),
  };
}

function buildRoomEntryState(defaultValues: LinenValues): RoomEntryState {
  return {
    ...cloneLinenValues(defaultValues),
    defaultValues: cloneLinenValues(defaultValues),
    lastSavedValues: null,
    wasEverSaved: false,
    savedAt: '',
    updatedByName: '',
    isSaving: false,
  };
}

function getEntryUiState(entry: RoomEntryState): 'DEFAULT' | 'EDITED' | 'SAVED' | 'SAVING' {
  if (entry.isSaving) return 'SAVING';
  if (entry.wasEverSaved && entry.lastSavedValues && linenValuesEqual(entry, entry.lastSavedValues)) {
    return 'SAVED';
  }
  if (!entry.wasEverSaved && linenValuesEqual(entry, entry.defaultValues)) {
    return 'DEFAULT';
  }
  return 'EDITED';
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
  const [roomSearch, setRoomSearch] = useState('');

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
          .select('user_id, email, name, role, can_access_chambermaid_entry')
          .eq('user_id', userId)
          .maybeSingle();

        if (profileError) throw profileError;

        const nextProfile: DashboardUser = {
          user_id: userId,
          email: profileRow?.email || email,
          name: profileRow?.name || email || 'User',
          role: (profileRow?.role || 'HK') as DashboardUser['role'],
          can_access_chambermaid_entry: profileRow?.can_access_chambermaid_entry ?? false,
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

    return profile.can_access_chambermaid_entry === true;
  }, [profile]);

  const roomMap = useMemo(() => {
    const map: Record<string, RoomRow> = {};
    rooms.forEach((room) => {
      map[room.room_number] = room;
    });
    return map;
  }, [rooms]);

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

      const [entryRes, mapRes] = await Promise.all([
        roomNumbers.length > 0
          ? supabase
              .from('linen_room_entry')
              .select(
                'room_number, is_dnd, bedsheet_king, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single, updated_at, updated_by_name'
              )
              .eq('service_date', serviceDate)
              .in('room_number', roomNumbers)
          : Promise.resolve({ data: [], error: null } as any),
        supabase
          .from('linen_room_type_map')
          .select('room_type, bedsheet_king, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single'),
      ]);

      if (entryRes.error) throw entryRes.error;
      if (mapRes.error) throw mapRes.error;

      const mapByType: Record<string, LinenMapRow> = {};
      (mapRes.data || []).forEach((row: LinenMapRow) => {
        mapByType[row.room_type] = row;
      });

      const savedEntryByRoom: Record<string, any> = {};
      (entryRes.data || []).forEach((row: any) => {
        savedEntryByRoom[row.room_number] = row;
      });

      const nextEntryMap: Record<string, RoomEntryState> = {};
      nextRooms.forEach((room) => {
        const defaultValues = buildDefaultValuesFromMap(room.room_type, mapByType);
        const savedRow = savedEntryByRoom[room.room_number];

        if (savedRow) {
          const savedValues: LinenValues = {
            is_dnd: !!savedRow.is_dnd,
            bedsheet_king: Number(savedRow.bedsheet_king || 0),
            pillow_case: Number(savedRow.pillow_case || 0),
            bath_towel: Number(savedRow.bath_towel || 0),
            bath_mat: Number(savedRow.bath_mat || 0),
            duvet_cover_king: Number(savedRow.duvet_cover_king || 0),
            duvet_cover_single: Number(savedRow.duvet_cover_single || 0),
          };

          nextEntryMap[room.room_number] = {
            ...cloneLinenValues(savedValues),
            defaultValues: cloneLinenValues(defaultValues),
            lastSavedValues: cloneLinenValues(savedValues),
            wasEverSaved: true,
            savedAt: savedRow.updated_at || '',
            updatedByName: savedRow.updated_by_name || '',
            isSaving: false,
          };
        } else {
          nextEntryMap[room.room_number] = buildRoomEntryState(defaultValues);
        }
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

  async function saveRoom(room: RoomRow, entryOverride?: RoomEntryState) {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return false;
    }

    if (!profile?.user_id) {
      setErrorMsg('User not found.');
      return false;
    }

    const currentEntry = entryOverride || entryMap[room.room_number];
    if (!currentEntry) return false;

    const entry: RoomEntryState = {
      ...currentEntry,
      defaultValues: cloneLinenValues(currentEntry.defaultValues),
      lastSavedValues: currentEntry.lastSavedValues ? cloneLinenValues(currentEntry.lastSavedValues) : null,
    };

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
      const payload: LinenValues & {
        service_date: string;
        room_number: string;
        block_no: number;
        floor_no: number;
        updated_by_user_id: string;
        updated_by_name: string;
      } = {
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

      const savedValues: LinenValues = {
        is_dnd: payload.is_dnd,
        bedsheet_king: payload.bedsheet_king,
        pillow_case: payload.pillow_case,
        bath_towel: payload.bath_towel,
        bath_mat: payload.bath_mat,
        duvet_cover_king: payload.duvet_cover_king,
        duvet_cover_single: payload.duvet_cover_single,
      };

      const savedAt = new Date().toISOString();
      setEntryMap((prev) => ({
        ...prev,
        [room.room_number]: {
          ...prev[room.room_number],
          ...cloneLinenValues(savedValues),
          lastSavedValues: cloneLinenValues(savedValues),
          wasEverSaved: true,
          isSaving: false,
          savedAt,
          updatedByName: payload.updated_by_name,
        },
      }));
      return true;
    } catch (err: any) {
      console.error('Failed to save chambermaid entry', err);
      setEntryMap((prev) => ({
        ...prev,
        [room.room_number]: {
          ...(prev[room.room_number] || buildRoomEntryState(zeroLinenValues())),
          isSaving: false,
        },
      }));
      setErrorMsg(err?.message || `Failed to save ${room.room_number}`);
      return false;
    }
  }

  function updateRoomField(
    roomNumber: string,
    field: keyof LinenValues,
    value: boolean | number
  ) {
    const current = entryMap[roomNumber];
    if (!current) return;

    const next: RoomEntryState = {
      ...current,
      [field]: value,
    } as RoomEntryState;

    if (field === 'is_dnd') {
      if (value === true) {
        next.bedsheet_king = 0;
        next.pillow_case = 0;
        next.bath_towel = 0;
        next.bath_mat = 0;
        next.duvet_cover_king = 0;
        next.duvet_cover_single = 0;
      } else {
        const restore = current.lastSavedValues || current.defaultValues;
        next.bedsheet_king = restore.bedsheet_king;
        next.pillow_case = restore.pillow_case;
        next.bath_towel = restore.bath_towel;
        next.bath_mat = restore.bath_mat;
        next.duvet_cover_king = restore.duvet_cover_king;
        next.duvet_cover_single = restore.duvet_cover_single;
      }
    }

    setEntryMap((prev) => ({
      ...prev,
      [roomNumber]: next,
    }));
    setSuccessMsg('');
  }

  function adjustQty(
    roomNumber: string,
    field: keyof Omit<LinenValues, 'is_dnd'>,
    delta: number
  ) {
    const current = entryMap[roomNumber];
    if (!current || current.is_dnd || current.isSaving) return;

    const next: RoomEntryState = {
      ...current,
      [field]: Math.max(0, Number(current[field] || 0) + delta),
    } as RoomEntryState;

    setEntryMap((prev) => ({
      ...prev,
      [roomNumber]: next,
    }));
    setSuccessMsg('');
  }

  async function handleSaveRoom(room: RoomRow) {
    const ok = await saveRoom(room);
    if (ok) {
      setSuccessMsg(`Saved room ${room.room_number}.`);
    }
  }

  const roomCount = rooms.length;

  const filteredRooms = useMemo(() => {
    const keyword = roomSearch.trim();
    if (!keyword) return rooms;
    return rooms.filter((room) => room.room_number === keyword);
  }, [rooms, roomSearch]);

  const roomStateCounts = useMemo(() => {
    let defaultCount = 0;
    let editedCount = 0;
    let savedCount = 0;

    filteredRooms.forEach((room) => {
      const entry = entryMap[room.room_number];
      if (!entry) return;
      const state = getEntryUiState(entry);
      if (state === 'DEFAULT') defaultCount += 1;
      if (state === 'EDITED') editedCount += 1;
      if (state === 'SAVED') savedCount += 1;
    });

    return { defaultCount, editedCount, savedCount };
  }, [filteredRooms, entryMap]);

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
          <p style={styles.centerText}>You do not have permission to access Chambermaid Entry.</p>
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
              <div style={styles.summaryLabel}>Default Ready</div>
              <div style={{ ...styles.summaryValue, color: '#64748b' }}>{roomStateCounts.defaultCount}</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Edited Not Saved</div>
              <div style={{ ...styles.summaryValue, color: '#b45309' }}>{roomStateCounts.editedCount}</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Saved</div>
              <div style={{ ...styles.summaryValue, color: '#15803d' }}>{roomStateCounts.savedCount}</div>
            </div>
          </div>

          {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}
          {successMsg ? <div style={styles.successBox}>{successMsg}</div> : null}
        </div>

        <div style={styles.searchCard}>
          <div style={styles.searchRow}>
            <div style={styles.searchBox}>
              <label style={styles.label}>Search Room</label>
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
          </div>
        </div>

        {pageLoading ? (
          <div style={styles.gridCard}>
            <div style={styles.emptyState}>Loading rooms...</div>
          </div>
        ) : rooms.length === 0 ? (
          <div style={styles.gridCard}>
            <div style={styles.emptyState}>No supervisor-marked rooms found for this floor.</div>
          </div>
        ) : filteredRooms.length === 0 ? (
          <div style={styles.gridCard}>
            <div style={styles.emptyState}>No room found for that exact room number on this floor.</div>
          </div>
        ) : (
          <div style={styles.cardsWrap}>
            {filteredRooms.map((room) => {
              const entry = entryMap[room.room_number];
              if (!entry) return null;

              const uiState = getEntryUiState(entry);
              const isSaving = !!entry.isSaving;
              const showDnd = room.supervisor_status === 'STAYOVER';

              const stateText =
                uiState === 'SAVING'
                  ? 'Saving...'
                  : uiState === 'SAVED'
                  ? `Saved ${formatTime(entry.savedAt)}${entry.updatedByName ? ` · ${entry.updatedByName}` : ''}`
                  : uiState === 'EDITED'
                  ? 'Edited · not saved'
                  : 'Default ready · not saved';

              return (
                <div
                  key={room.room_number}
                  style={{
                    ...styles.roomCard,
                    ...(uiState === 'SAVED'
                      ? styles.roomCardSaved
                      : uiState === 'EDITED'
                      ? styles.roomCardEdited
                      : {}),
                  }}
                >
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

                  <div style={styles.stateRow}>
                    {showDnd ? (
                      <label style={styles.dndLabel}>
                        <input
                          type="checkbox"
                          checked={entry.is_dnd}
                          disabled={isSaving}
                          onChange={(e) =>
                            updateRoomField(room.room_number, 'is_dnd', e.target.checked)
                          }
                        />
                        <span>Mark as DND</span>
                      </label>
                    ) : (
                      <div />
                    )}
                    <div
                      style={{
                        ...styles.statePill,
                        ...(uiState === 'SAVED'
                          ? styles.statePillSaved
                          : uiState === 'EDITED'
                          ? styles.statePillEdited
                          : uiState === 'SAVING'
                          ? styles.statePillSaving
                          : styles.statePillDefault),
                      }}
                    >
                      {stateText}
                    </div>
                  </div>

                  <div style={styles.linenList}>
                    {LINEN_FIELDS.map((item) => {
                      const defaultQty = entry.defaultValues[item.key];
                      const currentQty = entry[item.key];
                      const changed = currentQty !== defaultQty;

                      return (
                        <div key={item.key} style={styles.linenRow}>
                          <div style={styles.linenLabelWrap}>
                            <div style={styles.linenLabel}>{item.label}</div>
                            <div style={styles.defaultHint}>Default {defaultQty}</div>
                          </div>
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
                              value={currentQty}
                              disabled={entry.is_dnd || isSaving}
                              onChange={(e) => {
                                const nextValue = Math.max(0, Number(e.target.value || 0));
                                updateRoomField(room.room_number, item.key, nextValue);
                              }}
                              style={{
                                ...styles.counterInput,
                                ...(changed ? styles.counterInputChanged : {}),
                              }}
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
                      );
                    })}
                  </div>

                  <div style={styles.cardFooter}>
                    <button
                      type="button"
                      onClick={() => void handleSaveRoom(room)}
                      disabled={isSaving}
                      style={{
                        ...styles.saveBtn,
                        opacity: isSaving ? 0.6 : 1,
                      }}
                    >
                      {isSaving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
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
    overflowX: 'hidden',
  },
  shell: {
    width: '100%',
    maxWidth: '1120px',
    margin: '0 auto',
    paddingInline: '4px',
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
  primaryBtn: {
    border: 'none',
    background: '#0f172a',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 800,
    cursor: 'pointer',
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
  searchCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    padding: '16px',
    boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
    marginBottom: '16px',
  },
  searchRow: {
    display: 'flex',
    justifyContent: 'center',
    width: '100%',
  },
  searchBox: {
    width: '100%',
    maxWidth: '320px',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    margin: '0 auto',
  },
  searchInput: {
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '12px 14px',
    fontSize: '15px',
    outline: 'none',
  },
  cardsWrap: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 420px))',
    gap: '16px',
    justifyContent: 'center',
    alignItems: 'start',
  },
  roomCard: {
    width: '100%',
    maxWidth: '420px',
    boxSizing: 'border-box',
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    padding: '16px',
    boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
  },
  roomCardSaved: {
    borderColor: '#bbf7d0',
    boxShadow: '0 10px 24px rgba(21,128,61,0.08)',
  },
  roomCardEdited: {
    borderColor: '#fcd34d',
    boxShadow: '0 10px 24px rgba(180,83,9,0.08)',
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
  stateRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: '14px',
  },
  dndLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    fontWeight: 700,
    color: '#334155',
  },
  statePill: {
    borderRadius: '999px',
    padding: '7px 11px',
    fontSize: '12px',
    fontWeight: 800,
    lineHeight: 1.3,
  },
  statePillDefault: {
    background: '#f1f5f9',
    color: '#475569',
  },
  statePillEdited: {
    background: '#fff7ed',
    color: '#b45309',
  },
  statePillSaved: {
    background: '#ecfdf5',
    color: '#15803d',
  },
  statePillSaving: {
    background: '#eff6ff',
    color: '#1d4ed8',
  },
  linenList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  linenRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'center',
  },
  linenLabelWrap: {
    minWidth: 0,
    flex: 1,
  },
  linenLabel: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#334155',
  },
  defaultHint: {
    fontSize: '12px',
    color: '#94a3b8',
    marginTop: '4px',
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
    fontWeight: 800,
    fontSize: '18px',
    cursor: 'pointer',
  },
  counterInput: {
    width: '62px',
    height: '36px',
    borderRadius: '10px',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    textAlign: 'center' as const,
    fontWeight: 800,
    fontSize: '15px',
    outline: 'none',
  },
  counterInputChanged: {
    borderColor: '#f59e0b',
    background: '#fffbeb',
    color: '#92400e',
  },
  cardFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: '16px',
  },
  saveBtn: {
    border: 'none',
    background: '#0f172a',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '10px 16px',
    fontWeight: 800,
    cursor: 'pointer',
    minWidth: '92px',
  },
  gridCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    padding: '20px',
    boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
  },
  emptyState: {
    textAlign: 'center' as const,
    color: '#64748b',
    fontWeight: 600,
  },
  errorBox: {
    marginTop: '12px',
    background: '#fef2f2',
    color: '#b91c1c',
    border: '1px solid #fecaca',
    borderRadius: '12px',
    padding: '12px 14px',
    fontWeight: 600,
  },
  successBox: {
    marginTop: '12px',
    background: '#ecfdf5',
    color: '#166534',
    border: '1px solid #bbf7d0',
    borderRadius: '12px',
    padding: '12px 14px',
    fontWeight: 600,
  },
  centerCard: {
    maxWidth: '460px',
    margin: '80px auto',
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    padding: '24px',
    textAlign: 'center' as const,
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
