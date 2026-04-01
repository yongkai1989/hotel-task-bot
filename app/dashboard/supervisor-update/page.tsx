'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type DashboardUser = {
  user_id?: string;
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'HK' | 'MT' | 'FO';

  // ✅ NEW
  can_access_linen_admin?: boolean;
};

type RoomRow = {
  room_number: string;
  block_no: number;
  floor_no: number;
  room_type: string;
  is_active: boolean;
};

type StatusValue = 'VACANT' | 'CHECKOUT' | 'STAYOVER';

const BLOCKS = [1, 2];
const FLOORS_BY_BLOCK: Record<number, number[]> = {
  1: [1, 2, 3, 5],
  2: [3, 5, 6, 7],
};

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

function statusLabel(status: StatusValue) {
  if (status === 'CHECKOUT') return 'CHECK OUT';
  if (status === 'STAYOVER') return 'STAY OVER';
  return 'VACANT';
}

function nextStatus(status: StatusValue): StatusValue {
  if (status === 'CHECKOUT') return 'STAYOVER';
  if (status === 'STAYOVER') return 'VACANT';
  return 'CHECKOUT';
}

function statusTileStyle(status: StatusValue): React.CSSProperties {
  if (status === 'CHECKOUT') {
    return {
      ...styles.roomTile,
      background: '#dcfce7',
      borderColor: '#16a34a',
      color: '#166534',
      boxShadow: '0 8px 18px rgba(22,163,74,0.10)',
    };
  }

  if (status === 'STAYOVER') {
    return {
      ...styles.roomTile,
      background: '#dbeafe',
      borderColor: '#2563eb',
      color: '#1d4ed8',
      boxShadow: '0 8px 18px rgba(37,99,235,0.10)',
    };
  }

  return {
    ...styles.roomTile,
    background: '#f8fafc',
    borderColor: '#cbd5e1',
    color: '#475569',
    boxShadow: '0 8px 18px rgba(15,23,42,0.04)',
  };
}

export default function SupervisorUpdatePage() {
  const [profile, setProfile] = useState<DashboardUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [serviceDate] = useState(getTodayLocalDateString());
  const [selectedBlock, setSelectedBlock] = useState<number>(1);
  const [selectedFloor, setSelectedFloor] = useState<number>(1);

  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, StatusValue>>({});

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
          .select('user_id, email, name, role, can_access_linen_admin')
          .eq('user_id', userId)
          .maybeSingle();

        if (profileError) throw profileError;

       const nextProfile: DashboardUser = {
  user_id: userId,
  email: profileRow?.email || email,
  name: profileRow?.name || email || 'User',
  role: (profileRow?.role || 'HK') as DashboardUser['role'],
  can_access_linen_admin: profileRow?.can_access_linen_admin ?? false,
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

  // ✅ Admin roles always allowed
  if (
    profile.role === 'SUPERUSER' ||
    profile.role === 'MANAGER' ||
    profile.role === 'SUPERVISOR'
  ) {
    return true;
  }

  // ✅ fallback to permission flag
  return profile.can_access_linen_admin === true;
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

      const { data: roomRows, error: roomError } = await supabase
        .from('room_master')
        .select('room_number, block_no, floor_no, room_type, is_active')
        .eq('block_no', blockNo)
        .eq('floor_no', floorNo)
        .eq('is_active', true)
        .order('room_number', { ascending: true });

      if (roomError) throw roomError;

      const roomNumbers = (roomRows || []).map((r: any) => r.room_number);
      let statusRows: any[] = [];

      if (roomNumbers.length > 0) {
        const { data, error: statusError } = await supabase
          .from('linen_room_status')
          .select('room_number, status')
          .eq('service_date', serviceDate)
          .in('room_number', roomNumbers);

        if (statusError) throw statusError;
        statusRows = data || [];
      }

      const nextStatusMap: Record<string, StatusValue> = {};
      (roomRows || []).forEach((room: any) => {
        nextStatusMap[room.room_number] = 'VACANT';
      });
      statusRows.forEach((row: any) => {
        nextStatusMap[row.room_number] =
          (row.status as StatusValue) || 'VACANT';
      });

      setRooms((roomRows || []) as RoomRow[]);
      setStatusMap(nextStatusMap);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load rooms');
      setRooms([]);
      setStatusMap({});
    } finally {
      setPageLoading(false);
    }
  }

  useEffect(() => {
    if (!profile || !canAccess) {
      setRooms([]);
      setStatusMap({});
      setPageLoading(false);
      return;
    }

    void loadFloorData(selectedBlock, selectedFloor);
  }, [profile, canAccess, selectedBlock, selectedFloor, serviceDate]);

  async function handleTileClick(roomNumber: string) {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    if (!profile?.user_id) {
      setErrorMsg('User not found.');
      return;
    }

    const currentStatus = statusMap[roomNumber] || 'VACANT';
    const newStatus = nextStatus(currentStatus);

    setStatusMap((prev) => ({
      ...prev,
      [roomNumber]: newStatus,
    }));

    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      if (newStatus === 'VACANT') {
        const { error } = await supabase
          .from('linen_room_status')
          .delete()
          .eq('service_date', serviceDate)
          .eq('room_number', roomNumber);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('linen_room_status')
          .upsert(
            [
              {
                service_date: serviceDate,
                room_number: roomNumber,
                status: newStatus,
                updated_by_user_id: profile.user_id,
                updated_by_name: profile.name || profile.email,
              },
            ],
            {
              onConflict: 'service_date,room_number',
            }
          );

        if (error) throw error;
      }

      setSuccessMsg(`Saved ${roomNumber} as ${statusLabel(newStatus)}.`);
    } catch (err: any) {
      setStatusMap((prev) => ({
        ...prev,
        [roomNumber]: currentStatus,
      }));
      setErrorMsg(err?.message || `Failed to save ${roomNumber}`);
    } finally {
      setSaving(false);
    }
  }

  async function markAllCheckout() {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    if (!profile?.user_id) {
      setErrorMsg('User not found.');
      return;
    }

    try {
      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');

      const nextMap: Record<string, StatusValue> = {};
      const rows = rooms.map((room) => {
        nextMap[room.room_number] = 'CHECKOUT';
        return {
          service_date: serviceDate,
          room_number: room.room_number,
          status: 'CHECKOUT' as StatusValue,
          updated_by_user_id: profile.user_id,
          updated_by_name: profile.name || profile.email,
        };
      });

      if (rows.length > 0) {
        const { error } = await supabase
          .from('linen_room_status')
          .upsert(rows, {
            onConflict: 'service_date,room_number',
          });

        if (error) throw error;
      }

      setStatusMap(nextMap);
      setSuccessMsg(
        `Marked all rooms on Block ${selectedBlock} Floor ${selectedFloor} as Check Out.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to mark all as check out');
    } finally {
      setSaving(false);
    }
  }

  async function clearFloor() {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    try {
      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');

      const roomNumbers = rooms.map((room) => room.room_number);

      if (roomNumbers.length > 0) {
        const { error } = await supabase
          .from('linen_room_status')
          .delete()
          .eq('service_date', serviceDate)
          .in('room_number', roomNumbers);

        if (error) throw error;
      }

      const nextMap: Record<string, StatusValue> = {};
      rooms.forEach((room) => {
        nextMap[room.room_number] = 'VACANT';
      });

      setStatusMap(nextMap);
      setSuccessMsg(`Cleared Block ${selectedBlock} Floor ${selectedFloor}.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to clear floor');
    } finally {
      setSaving(false);
    }
  }

  const counts = useMemo(() => {
    let checkout = 0;
    let stayover = 0;
    let vacant = 0;

    rooms.forEach((room) => {
      const status = statusMap[room.room_number] || 'VACANT';
      if (status === 'CHECKOUT') checkout += 1;
      else if (status === 'STAYOVER') stayover += 1;
      else vacant += 1;
    });

    return {
      checkout,
      stayover,
      vacant,
      total: rooms.length,
    };
  }, [rooms, statusMap]);

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
          <p style={styles.centerText}>
            Please log in first, then open this page again.
          </p>
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
          <p style={styles.centerText}>
            Current role read by this page:{' '}
            <strong>{profile?.role || 'NONE'}</strong>
          </p>
          <p style={styles.centerText}>
            Current email: <strong>{profile?.email || 'NONE'}</strong>
          </p>
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
            <div style={styles.pageTitle}>Supervisor Update</div>
            <div style={styles.pageSubTitle}>
              Service Date: {serviceDate} · {profile.name} ({profile.role}){' '}
              {saving ? '· Saving...' : ''}
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

          <div style={styles.actionRow}>
            <button
              type="button"
              onClick={markAllCheckout}
              disabled={pageLoading || rooms.length === 0 || saving}
              style={{
                ...styles.checkoutBtn,
                opacity: pageLoading || rooms.length === 0 || saving ? 0.6 : 1,
              }}
            >
              Mark All as Check Out
            </button>

            <button
              type="button"
              onClick={clearFloor}
              disabled={pageLoading || rooms.length === 0 || saving}
              style={{
                ...styles.clearBtn,
                opacity: pageLoading || rooms.length === 0 || saving ? 0.6 : 1,
              }}
            >
              Clear This Floor
            </button>
          </div>

          <div style={styles.summaryGrid}>
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Total Rooms</div>
              <div style={styles.summaryValue}>{counts.total}</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Check Out</div>
              <div style={{ ...styles.summaryValue, color: '#166534' }}>
                {counts.checkout}
              </div>
            </div>
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Stay Over</div>
              <div style={{ ...styles.summaryValue, color: '#1d4ed8' }}>
                {counts.stayover}
              </div>
            </div>
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Vacant</div>
              <div style={{ ...styles.summaryValue, color: '#475569' }}>
                {counts.vacant}
              </div>
            </div>
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
          ) : rooms.length === 0 ? (
            <div style={styles.emptyState}>No rooms found for this floor.</div>
          ) : (
            <div style={styles.roomGrid}>
              {rooms.map((room) => {
                const status = statusMap[room.room_number] || 'VACANT';

                return (
                  <button
                    key={room.room_number}
                    type="button"
                    onClick={() => void handleTileClick(room.room_number)}
                    disabled={saving}
                    style={{
                      ...statusTileStyle(status),
                      opacity: saving ? 0.75 : 1,
                    }}
                  >
                    <div style={styles.roomNo}>{room.room_number}</div>
                    <div style={styles.roomType}>{room.room_type}</div>
                    <div style={styles.roomStatus}>{statusLabel(status)}</div>
                  </button>
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
  actionRow: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
    marginBottom: '16px',
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
  checkoutBtn: {
    border: '1px solid #16a34a',
    background: '#16a34a',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  clearBtn: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#334155',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 700,
    cursor: 'pointer',
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
  roomGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
    gap: '12px',
  },
  roomTile: {
    border: '2px solid #cbd5e1',
    borderRadius: '16px',
    padding: '16px 12px',
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    minHeight: '120px',
  },
  roomNo: {
    fontSize: '22px',
    fontWeight: 800,
    marginBottom: '6px',
  },
  roomType: {
    fontSize: '12px',
    lineHeight: 1.35,
    minHeight: '34px',
    fontWeight: 600,
    opacity: 0.92,
    marginBottom: '10px',
  },
  roomStatus: {
    fontSize: '12px',
    fontWeight: 800,
    letterSpacing: '0.05em',
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
