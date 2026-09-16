'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createBrowserSupabaseClient } from '../lib/supabaseBrowser';
import {
  DUTY_FLOORS,
  generateSuggestedDutyPlan,
  PREM_BACKUP_RELEASER,
  withPremBackupReleaser,
  type DutyFloorKey,
  type DutyStaff,
  type FloorWorkload,
  type MaidDutyAssignment,
  type SupervisorDutyAssignment,
} from '../lib/hkDutyAssignment';
import styles from '../app/dashboard/hk-schedule/duty-assignment.module.css';
import extras from '../app/dashboard/hk-schedule/duty-assignment-extras.module.css';

type ScheduleStaff = DutyStaff & {
  staff_role: 'SUPERVISOR' | 'MAID' | 'LINEN_CONTROLLER' | 'PA';
  is_active: boolean;
};

type SpecialDuty = {
  id: string;
  focus: string;
  scope: string;
  assignedTo: string;
};

type SavedDutyRow = {
  service_date: string;
  maid_assignments: MaidDutyAssignment[];
  supervisor_assignments: SupervisorDutyAssignment[];
  linen_controller_staff_ids: string[];
  special_duties: SpecialDuty[];
  part_time_maids?: DutyStaff[];
  special_priority_presets?: string[];
  version: number;
  updated_by_name: string;
  updated_at: string;
};

type Props = {
  canEdit: boolean;
};

const EMPTY_WORKLOADS: FloorWorkload[] = DUTY_FLOORS.map((floor) => ({
  floorKey: floor.key,
  checkout: 0,
  stayover: 0,
}));

const DEFAULT_SPECIAL_PRESETS = [
  'Room Fixtures',
  'Bathroom Deep Clean',
  'Guest Amenities',
];

function todayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDutyDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat('en-MY', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function formatReadableList(values: Array<string | number>) {
  const labels = values.map(String);
  if (labels.length <= 1) return labels[0] || '';
  if (labels.length === 2) return `${labels[0]} & ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} & ${labels[labels.length - 1]}`;
}

function isFloorKey(value: unknown): value is DutyFloorKey {
  return DUTY_FLOORS.some((floor) => floor.key === value);
}

function safeMaidAssignments(value: unknown): MaidDutyAssignment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: any) => {
    if (!row || typeof row.staffId !== 'string' || typeof row.staffName !== 'string') return [];
    return [{
      staffId: row.staffId,
      staffName: row.staffName,
      floors: Array.isArray(row.floors) ? row.floors.filter(isFloorKey) : [],
    }];
  });
}

function safeSupervisorAssignments(value: unknown): SupervisorDutyAssignment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: any) => {
    if (!row || !isFloorKey(row.floorKey) || typeof row.staffId !== 'string' || typeof row.staffName !== 'string') return [];
    return [{ floorKey: row.floorKey, staffId: row.staffId, staffName: row.staffName }];
  });
}

function safeSpecialDuties(value: unknown): SpecialDuty[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: any, index) => {
    if (!row || typeof row.focus !== 'string') return [];
    return [{
      id: typeof row.id === 'string' ? row.id : `saved-${index}`,
      focus: row.focus,
      scope: typeof row.scope === 'string' ? row.scope : '',
      assignedTo: typeof row.assignedTo === 'string' ? row.assignedTo : '',
    }];
  });
}

function safePartTimeMaids(value: unknown): DutyStaff[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: any, index) => {
    const staffName = typeof row?.staff_name === 'string' ? row.staff_name.trim() : '';
    if (!staffName) return [];
    return [{
      id: typeof row.id === 'string' && row.id ? row.id : `part-time-saved-${index}`,
      staff_name: staffName,
    }];
  });
}

function safePriorityPresets(value: unknown) {
  if (!Array.isArray(value)) return [...DEFAULT_SPECIAL_PRESETS];
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
}

export default function HkDutyAssignmentTab({ canEdit }: Props) {
  const supabase = useMemo(() => {
    try {
      return createBrowserSupabaseClient();
    } catch {
      return null;
    }
  }, []);
  const [serviceDate, setServiceDate] = useState(todayKey());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [availableMaids, setAvailableMaids] = useState<ScheduleStaff[]>([]);
  const [availableFloorSupervisors, setAvailableFloorSupervisors] = useState<ScheduleStaff[]>([]);
  const [availableSupervisors, setAvailableSupervisors] = useState<DutyStaff[]>([]);
  const [availableLinenControllers, setAvailableLinenControllers] = useState<ScheduleStaff[]>([]);
  const [partTimeMaids, setPartTimeMaids] = useState<DutyStaff[]>([]);
  const [partTimeName, setPartTimeName] = useState('');
  const [workloads, setWorkloads] = useState<FloorWorkload[]>(EMPTY_WORKLOADS);
  const [maidAssignments, setMaidAssignments] = useState<MaidDutyAssignment[]>([]);
  const [supervisorAssignments, setSupervisorAssignments] = useState<SupervisorDutyAssignment[]>([]);
  const [linenControllerStaffIds, setLinenControllerStaffIds] = useState<string[]>([]);
  const [specialDuties, setSpecialDuties] = useState<SpecialDuty[]>([]);
  const [specialPriorityPresets, setSpecialPriorityPresets] = useState<string[]>(DEFAULT_SPECIAL_PRESETS);
  const [newPriorityPreset, setNewPriorityPreset] = useState('');
  const [version, setVersion] = useState(0);
  const [lastSaved, setLastSaved] = useState<{ name: string; at: string } | null>(null);

  const workloadMap = useMemo(
    () => new Map(workloads.map((row) => [row.floorKey, row])),
    [workloads]
  );
  const activeFloorKeys = useMemo(
    () => new Set(workloads.filter((row) => row.checkout + row.stayover > 0).map((row) => row.floorKey)),
    [workloads]
  );
  const allMaids = useMemo(() => [...availableMaids, ...partTimeMaids], [availableMaids, partTimeMaids]);
  const allFloorAssignees = useMemo(
    () => [...availableMaids, ...availableFloorSupervisors, ...partTimeMaids],
    [availableFloorSupervisors, availableMaids, partTimeMaids]
  );

  const applyDefault = useCallback((data?: {
    maids?: DutyStaff[];
    supervisors?: DutyStaff[];
    linenControllers?: ScheduleStaff[];
    floorWorkloads?: FloorWorkload[];
  }) => {
    const automaticReleaseSupervisors = withPremBackupReleaser(
      data?.supervisors || availableFloorSupervisors
    );
    const plan = generateSuggestedDutyPlan({
      maids: data?.maids || allMaids,
      supervisors: automaticReleaseSupervisors,
      linenControllers: data?.linenControllers || availableLinenControllers,
      workloads: data?.floorWorkloads || workloads,
    });
    setMaidAssignments(plan.maidAssignments);
    setSupervisorAssignments(plan.supervisorAssignments);
    setLinenControllerStaffIds(plan.linenControllerStaffIds);
    setSuccess('Default assignment loaded. Review the suggestions before saving.');
    setError('');
  }, [allMaids, availableFloorSupervisors, availableLinenControllers, workloads]);

  const loadData = useCallback(async () => {
    if (!supabase) {
      setError('Supabase is not configured.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const [staffResult, entryResult, roomResult, statusResult, savedResult, presetResult] = await Promise.all([
        supabase.from('hk_schedule_staff').select('id,staff_name,staff_role,is_active').eq('is_active', true).order('sort_order').order('staff_name'),
        supabase.from('hk_schedule_entries').select('staff_id,status').eq('schedule_date', serviceDate),
        supabase.from('room_master').select('room_number,block_no,floor_no').eq('is_active', true),
        supabase.from('linen_room_status').select('room_number,status').eq('service_date', serviceDate),
        supabase.from('hk_daily_duty_assignments').select('*').eq('service_date', serviceDate).maybeSingle(),
        supabase.from('hk_daily_duty_assignments').select('special_priority_presets').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (staffResult.error) throw staffResult.error;
      if (entryResult.error) throw entryResult.error;
      if (roomResult.error) throw roomResult.error;
      if (statusResult.error) throw statusResult.error;
      if (savedResult.error) throw savedResult.error;
      if (presetResult.error) throw presetResult.error;

      const staffRows = (staffResult.data || []) as ScheduleStaff[];
      const workingIds = new Set(
        (entryResult.data || [])
          .filter((entry: any) => entry.status === 'WORK')
          .map((entry: any) => String(entry.staff_id))
      );
      const working = staffRows.filter((person) => workingIds.has(person.id));
      const maids = working.filter((person) => person.staff_role === 'MAID');
      const supervisors = working.filter((person) => person.staff_role === 'SUPERVISOR');
      const automaticReleaseSupervisors = withPremBackupReleaser(supervisors);
      const releaseSupervisorChoices = supervisors.some(
        (person) => person.staff_name.trim().toLowerCase() === 'prem'
      ) ? supervisors : [...supervisors, PREM_BACKUP_RELEASER];
      const linenControllers = working.filter((person) => person.staff_role === 'LINEN_CONTROLLER');
      const linenControllerChoices = working.filter((person) => person.staff_role === 'LINEN_CONTROLLER' || person.staff_role === 'MAID');

      const roomFloor = new Map<string, DutyFloorKey>();
      for (const room of roomResult.data || []) {
        const key = `B${Number(room.block_no)}F${Number(room.floor_no)}`;
        if (isFloorKey(key)) roomFloor.set(String(room.room_number), key);
      }
      const nextWorkloads = EMPTY_WORKLOADS.map((row) => ({ ...row }));
      const workloadByFloor = new Map(nextWorkloads.map((row) => [row.floorKey, row]));
      for (const status of statusResult.data || []) {
        const floorKey = roomFloor.get(String(status.room_number));
        const row = floorKey ? workloadByFloor.get(floorKey) : null;
        if (!row) continue;
        if (status.status === 'CHECKOUT') row.checkout += 1;
        if (status.status === 'STAYOVER') row.stayover += 1;
      }

      setAvailableMaids(maids);
      setAvailableFloorSupervisors(supervisors);
      setAvailableSupervisors(releaseSupervisorChoices);
      setAvailableLinenControllers(linenControllerChoices);
      setWorkloads(nextWorkloads);

      const saved = savedResult.data as SavedDutyRow | null;
      if (saved) {
        const savedPartTimers = safePartTimeMaids(saved.part_time_maids);
        const autoMaidRows = [...maids, ...savedPartTimers];
        const floorAssigneeRows = [...autoMaidRows, ...supervisors];
        const maidIds = new Set(floorAssigneeRows.map((person) => person.id));
        const supervisorIds = new Set(releaseSupervisorChoices.map((person) => person.id));
        const linenIds = new Set(linenControllerChoices.map((person) => person.id));
        const activeFloors = new Set(nextWorkloads.filter((row) => row.checkout + row.stayover > 0).map((row) => row.floorKey));
        const suggested = generateSuggestedDutyPlan({ maids: autoMaidRows, supervisors: automaticReleaseSupervisors, linenControllers, workloads: nextWorkloads });
        const savedSupervisors = safeSupervisorAssignments(saved.supervisor_assignments)
          .filter((assignment) => supervisorIds.has(assignment.staffId));
        const supervisorByFloor = new Map(savedSupervisors.map((assignment) => [assignment.floorKey, assignment]));
        for (const assignment of suggested.supervisorAssignments) {
          if (!supervisorByFloor.has(assignment.floorKey)) supervisorByFloor.set(assignment.floorKey, assignment);
        }
        const nextMaids = safeMaidAssignments(saved.maid_assignments)
          .filter((assignment) => maidIds.has(assignment.staffId))
          .map((assignment) => ({
            ...assignment,
            staffName: floorAssigneeRows.find((person) => person.id === assignment.staffId)?.staff_name || assignment.staffName,
            floors: assignment.floors.filter((floor) => activeFloors.has(floor)),
          }))
          .filter((assignment) => assignment.floors.length > 0);
        const covered = new Set(nextMaids.flatMap((assignment) => assignment.floors));
        for (const suggestion of suggested.maidAssignments) {
          const missingFloors = suggestion.floors.filter((floor) => !covered.has(floor));
          if (!missingFloors.length) continue;
          const existing = nextMaids.find((assignment) => assignment.staffId === suggestion.staffId);
          if (existing) {
            for (const floor of missingFloors) {
              existing.floors.push(floor);
              covered.add(floor);
            }
          } else {
            const floors = missingFloors;
            nextMaids.push({ ...suggestion, floors });
            floors.forEach((floor) => covered.add(floor));
          }
        }
        setMaidAssignments(nextMaids);
        setPartTimeMaids(savedPartTimers);
        setSupervisorAssignments([...supervisorByFloor.values()]);
        setLinenControllerStaffIds(
          Array.isArray(saved.linen_controller_staff_ids)
            ? saved.linen_controller_staff_ids.filter((id) => typeof id === 'string' && linenIds.has(id))
            : []
        );
        setSpecialDuties(safeSpecialDuties(saved.special_duties));
        setSpecialPriorityPresets(safePriorityPresets(saved.special_priority_presets));
        setVersion(Number(saved.version || 0));
        setLastSaved({ name: saved.updated_by_name, at: saved.updated_at });
      } else {
        const suggested = generateSuggestedDutyPlan({ maids, supervisors: automaticReleaseSupervisors, linenControllers, workloads: nextWorkloads });
        setMaidAssignments(suggested.maidAssignments);
        setPartTimeMaids([]);
        setSupervisorAssignments(suggested.supervisorAssignments);
        setLinenControllerStaffIds(suggested.linenControllerStaffIds);
        setSpecialDuties([]);
        setSpecialPriorityPresets(safePriorityPresets(presetResult.data?.special_priority_presets));
        setVersion(0);
        setLastSaved(null);
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to load the duty assignment.');
    } finally {
      setLoading(false);
    }
  }, [serviceDate, supabase]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const assignmentByMaid = useMemo(
    () => new Map(maidAssignments.map((assignment) => [assignment.staffId, assignment])),
    [maidAssignments]
  );
  const assignedFloorKeys = useMemo(
    () => new Set(maidAssignments.flatMap((assignment) => assignment.floors)),
    [maidAssignments]
  );
  const specialDutyPool = useMemo(
    () => allMaids.filter((person) => !assignmentByMaid.get(person.id)?.floors.length),
    [allMaids, assignmentByMaid]
  );
  const totalWorkload = useMemo(
    () => workloads.reduce((sum, row) => sum + row.checkout + row.stayover, 0),
    [workloads]
  );
  const totalCheckout = useMemo(() => workloads.reduce((sum, row) => sum + row.checkout, 0), [workloads]);
  const totalStayover = useMemo(() => workloads.reduce((sum, row) => sum + row.stayover, 0), [workloads]);

  function toggleMaidFloor(person: DutyStaff, floorKey: DutyFloorKey) {
    if (!canEdit || !activeFloorKeys.has(floorKey)) return;
    setMaidAssignments((current) => {
      const existing = current.find((row) => row.staffId === person.id);
      if (!existing) return [...current, { staffId: person.id, staffName: person.staff_name, floors: [floorKey] }];
      const selected = existing.floors.includes(floorKey);
      const floors = selected
        ? existing.floors.filter((floor) => floor !== floorKey)
        : [...existing.floors, floorKey];
      return current
        .map((row) => row.staffId === person.id ? { ...row, floors } : row)
        .filter((row) => row.floors.length > 0);
    });
  }

  function addPartTimer() {
    if (!canEdit) return;
    const name = partTimeName.trim();
    if (!name) return;
    if (allFloorAssignees.some((person) => person.staff_name.toLowerCase() === name.toLowerCase())) {
      setError(`${name} is already available for assignment.`);
      return;
    }
    const id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? `part-time-${crypto.randomUUID()}`
      : `part-time-${Date.now()}`;
    setPartTimeMaids((current) => [...current, { id, staff_name: name }]);
    setPartTimeName('');
    setError('');
  }

  function removePartTimer(staffId: string) {
    setPartTimeMaids((current) => current.filter((person) => person.id !== staffId));
    setMaidAssignments((current) => current.filter((assignment) => assignment.staffId !== staffId));
  }

  function toggleLinenController(staffId: string) {
    if (!canEdit) return;
    setLinenControllerStaffIds((current) => current.includes(staffId)
      ? current.filter((id) => id !== staffId)
      : [...current, staffId]);
  }

  function addPriorityPreset() {
    if (!canEdit) return;
    const preset = newPriorityPreset.trim();
    if (!preset) return;
    setSpecialPriorityPresets((current) => current.some((item) => item.toLowerCase() === preset.toLowerCase())
      ? current
      : [...current, preset]);
    setNewPriorityPreset('');
  }

  function changeSupervisor(floorKey: DutyFloorKey, staffId: string) {
    const person = availableSupervisors.find((row) => row.id === staffId);
    setSupervisorAssignments((current) => [
      ...current.filter((row) => row.floorKey !== floorKey),
      ...(person ? [{ floorKey, staffId: person.id, staffName: person.staff_name }] : []),
    ]);
  }

  function addSpecialDuty(focus = '') {
    if (!canEdit) return;
    setSpecialDuties((current) => [...current, {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `duty-${Date.now()}`,
      focus,
      scope: '',
      assignedTo: '',
    }]);
  }

  function updateSpecialDuty(id: string, patch: Partial<SpecialDuty>) {
    setSpecialDuties((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  const reportText = useMemo(() => {
    const lines = [
      '*HOUSEKEEPING DAILY DUTY BRIEFING*',
      formatDutyDate(serviceDate),
      '',
      '*DAILY WORKLOAD*',
      `• Checkouts: *${totalCheckout}*`,
      `• Stayovers: *${totalStayover}*`,
      `• Active floors: *${activeFloorKeys.size}*`,
      '',
      '*SUPERVISOR RELEASE CONTROL*',
    ];

    const releaseBySupervisor = new Map<string, { name: string; blocks: Map<number, number[]> }>();
    for (const floor of DUTY_FLOORS) {
      const assignment = supervisorAssignments.find((row) => row.floorKey === floor.key);
      const staffId = assignment?.staffId || 'unassigned';
      const group = releaseBySupervisor.get(staffId) || {
        name: assignment?.staffName || 'Unassigned',
        blocks: new Map<number, number[]>(),
      };
      group.blocks.set(floor.block, [...(group.blocks.get(floor.block) || []), floor.floor]);
      releaseBySupervisor.set(staffId, group);
    }
    for (const group of releaseBySupervisor.values()) {
      lines.push(`• *${group.name}*`);
      for (const [block, floors] of group.blocks) {
        lines.push(`  Block ${block} — Level${floors.length === 1 ? '' : 's'} ${formatReadableList(floors)}`);
      }
    }

    lines.push('', '*FLOOR OPERATIONS*');
    for (const block of [1, 2]) {
      const activeBlockFloors = DUTY_FLOORS.filter((floor) => {
        const workload = workloadMap.get(floor.key);
        return floor.block === block && Boolean(workload && workload.checkout + workload.stayover > 0);
      });
      if (!activeBlockFloors.length) continue;
      lines.push(`_Block ${block}_`);
      for (const floor of activeBlockFloors) {
        const workload = workloadMap.get(floor.key);
        if (!workload) continue;
        const names = maidAssignments.filter((row) => row.floors.includes(floor.key)).map((row) => row.staffName);
        const parts = [`${workload.checkout} C/O`, `${workload.stayover} Stayover${workload.stayover === 1 ? '' : 's'}`];
        lines.push(`• Level ${floor.floor} — *${names.join(' & ') || 'Unassigned'}*`);
        lines.push(`  ${parts.join(' · ')}`);
      }
    }
    const linenNames = availableLinenControllers
      .filter((person) => linenControllerStaffIds.includes(person.id))
      .map((person) => person.staff_name);
    lines.push('', '*SUPPORT DUTY*', `• Linen Control — *${linenNames.join(' & ') || 'Unassigned'}*`);
    if (specialDutyPool.length) {
      lines.push(`• Available for Special Duty — *${specialDutyPool.map((row) => row.staff_name).join(', ')}*`);
    }
    if (specialDuties.some((row) => row.focus.trim())) {
      lines.push('', '*SPECIAL CLEANING PRIORITIES*');
      for (const duty of specialDuties.filter((row) => row.focus.trim())) {
        lines.push(`• *${duty.focus.trim()}*`);
        if (duty.assignedTo.trim()) lines.push(`  Assigned to: ${duty.assignedTo.trim()}`);
        if (duty.scope.trim()) lines.push(`  Area/Rooms: ${duty.scope.trim()}`);
      }
    }
    lines.push('', '_C/O = Checkout_');
    return lines.join('\n');
  }, [activeFloorKeys.size, availableLinenControllers, linenControllerStaffIds, maidAssignments, serviceDate, specialDuties, specialDutyPool, supervisorAssignments, totalCheckout, totalStayover, workloadMap]);

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(reportText);
      setSuccess('Duty briefing copied for WhatsApp.');
      setError('');
    } catch {
      setError('Unable to copy automatically. Select the report text and copy it manually.');
    }
  }

  async function saveDuty(copyAfter = false) {
    if (!supabase || !canEdit) return;
    setSaving(true);
    setError('');
    try {
      const { data, error: saveError } = await supabase.rpc('save_hk_daily_duty_assignment', {
        p_service_date: serviceDate,
        p_maid_assignments: maidAssignments,
        p_supervisor_assignments: supervisorAssignments,
        p_linen_controller_staff_ids: linenControllerStaffIds,
        p_special_duties: specialDuties,
        p_part_time_maids: partTimeMaids,
        p_special_priority_presets: specialPriorityPresets,
        p_expected_version: version,
      });
      if (saveError) throw saveError;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.saved) {
        setError('Another supervisor updated this date while you were editing. The latest assignment has been reloaded.');
        await loadData();
        return;
      }
      setVersion(Number(result.new_version || version + 1));
      setLastSaved({ name: 'You', at: new Date().toISOString() });
      setSuccess('Duty assignment saved.');
      if (copyAfter) await copyReport();
    } catch (err: any) {
      setError(err?.message || 'Unable to save the duty assignment.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <section className={styles.stateCard}>Preparing the duty assignment...</section>;

  return (
    <section className={styles.pageArea}>
      <div className={styles.dutyHeader}>
        <div>
          <span className={styles.eyebrow}>DAILY HOUSEKEEPING PLAN</span>
          <h2>Duty Assignment</h2>
          <p>Available staff and room workload are taken automatically from Schedule and Supervisor Update.</p>
        </div>
        <div className={styles.headerActions}>
          <label>Date<input type="date" value={serviceDate} onChange={(event) => setServiceDate(event.target.value || todayKey())} /></label>
          <button type="button" className={styles.defaultButton} disabled={!canEdit || saving} onClick={() => applyDefault()}>
            ↻ Load Default Assignment
          </button>
        </div>
      </div>

      {!canEdit ? <div className={styles.infoBanner}>View only. Only supervisors, managers and superusers can edit duty assignments.</div> : null}
      {error ? <div className={styles.errorBanner}>{error}</div> : null}
      {success ? <div className={styles.successBanner}>{success}</div> : null}

      <div className={styles.metrics}>
        <Metric label="Available floor staff" value={allFloorAssignees.length} />
        <Metric label="Cleaning rooms" value={totalWorkload} />
        <Metric label="Assigned floor staff" value={maidAssignments.length} />
        <Metric label="Floors covered" value={`${assignedFloorKeys.size}/${activeFloorKeys.size}`} warning={assignedFloorKeys.size < activeFloorKeys.size} />
      </div>

      <div className={styles.workspace}>
        <div className={styles.editorColumn}>
          <section className={styles.card}>
            <header className={styles.cardHeader}>
              <div><span>1</span><h3>Floor Cleaning Assignment</h3></div>
              <small>Target: approximately 16 rooms per maid · assign as many floors as needed</small>
            </header>
            {canEdit ? <div className={extras.partTimerBar}>
              <div><strong>Part-time maids</strong><span>Add today’s temporary staff, then assign their floors below.</span></div>
              <div><input aria-label="Part-timer name" value={partTimeName} placeholder="Enter part-timer name" onChange={(event) => setPartTimeName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addPartTimer(); }} /><button type="button" onClick={addPartTimer}>+ Add</button></div>
            </div> : null}
            {!allFloorAssignees.length ? <p className={styles.empty}>No floor staff are available for this date.</p> : (
              <div className={styles.maidList}>
                {allFloorAssignees.map((person) => {
                  const assignment = assignmentByMaid.get(person.id);
                  const selectedFloors = assignment?.floors || [];
                  const personWorkload = selectedFloors.reduce((sum, floor) => {
                    const row = workloadMap.get(floor);
                    return sum + Number(row?.checkout || 0) + Number(row?.stayover || 0);
                  }, 0);
                  return (
                    <article key={person.id} className={`${styles.maidCard} ${extras.maidCardExtended} ${selectedFloors.length ? '' : styles.specialPoolCard}`}>
                      <div className={styles.maidSummary}>
                        <div><strong>{person.staff_name}</strong>{availableFloorSupervisors.some((row) => row.id === person.id) ? <em>Supervisor</em> : null}{partTimeMaids.some((row) => row.id === person.id) ? <em>Part-time</em> : null}{selectedFloors.length > 1 ? <em>{selectedFloors.length} floors</em> : null}</div>
                        <b>{selectedFloors.length ? selectedFloors.join(' + ') : 'Special duty pool'}</b>
                        <small>{selectedFloors.length ? `${personWorkload} room${personWorkload === 1 ? '' : 's'}` : 'No floor cleaning assigned'}</small>
                      </div>
                      <div className={styles.floorPicker}>
                        {DUTY_FLOORS.map((floor) => {
                          const row = workloadMap.get(floor.key);
                          const active = activeFloorKeys.has(floor.key);
                          const selected = selectedFloors.includes(floor.key);
                          return (
                            <button key={floor.key} type="button" disabled={!canEdit || !active}
                              aria-pressed={selected} className={selected ? styles.floorSelected : ''} onClick={() => toggleMaidFloor(person, floor.key)}
                              title={active ? `${row?.checkout || 0} checkout, ${row?.stayover || 0} stayover` : 'No checkout or stayover rooms'}>
                              <strong>{floor.key}</strong><small>{active ? `${row?.checkout || 0} CO · ${row?.stayover || 0} SO` : 'No rooms'}</small>
                            </button>
                          );
                        })}
                      </div>
                      {canEdit && partTimeMaids.some((row) => row.id === person.id) ? <button type="button" className={extras.removePartTimer} aria-label={`Remove part-timer ${person.staff_name}`} onClick={() => removePartTimer(person.id)}>Remove</button> : null}
                    </article>
                  );
                })}
              </div>
            )}
            {specialDutyPool.length ? (
              <div className={styles.specialPool}><strong>Available for special duty</strong><span>{specialDutyPool.map((person) => person.staff_name).join(', ')}</span></div>
            ) : null}
          </section>

          <section className={styles.card}>
            <header className={styles.cardHeader}><div><span>2</span><h3>Supervisor Release Duty</h3></div><small>{supervisorAssignments.length}/8 floors assigned</small></header>
            {!availableSupervisors.length ? <p className={styles.empty}>No supervisors are scheduled as WORK.</p> : (
              <div className={styles.supervisorGrid}>
                {[1, 2].map((block) => (
                  <div key={block}><h4>Block {block}</h4>{DUTY_FLOORS.filter((floor) => floor.block === block).map((floor) => (
                    <label key={floor.key}><span>Level {floor.floor}</span><select disabled={!canEdit}
                      value={supervisorAssignments.find((row) => row.floorKey === floor.key)?.staffId || ''}
                      onChange={(event) => changeSupervisor(floor.key, event.target.value)}>
                      <option value="">Unassigned</option>
                      {availableSupervisors.map((person) => <option key={person.id} value={person.id}>{person.staff_name}</option>)}
                    </select></label>
                  ))}</div>
                ))}
              </div>
            )}
          </section>

          <section className={styles.card}>
            <header className={styles.cardHeader}><div><span>3</span><h3>Support Duty</h3></div><small>P.A. staff are not included</small></header>
            <div className={styles.linenControl}><span>Linen Controller(s)</span><div className={extras.linenChoices}>
              {availableLinenControllers.map((person) => {
                const selected = linenControllerStaffIds.includes(person.id);
                return <button type="button" key={person.id} disabled={!canEdit} aria-pressed={selected} className={selected ? extras.linenSelected : ''} onClick={() => toggleLinenController(person.id)}>{person.staff_name}</button>;
              })}
              {!availableLinenControllers.length ? <small>No eligible staff are working today.</small> : null}
            </div></div>
          </section>

          <section className={styles.card}>
            <header className={styles.cardHeader}><div><span>4</span><h3>Special Cleaning Priorities <i>Optional</i></h3></div><button type="button" disabled={!canEdit} onClick={() => addSpecialDuty()}>+ Add Priority</button></header>
            {canEdit ? <div className={extras.quickAddEditor}>
              <div className={styles.quickAdd}><span>Quick add</span>{specialPriorityPresets.map((preset) => <div className={extras.quickPreset} key={preset}><button type="button" onClick={() => addSpecialDuty(preset)}>{preset}</button><button type="button" aria-label={`Remove quick item ${preset}`} onClick={() => setSpecialPriorityPresets((current) => current.filter((item) => item !== preset))}>×</button></div>)}</div>
              <div className={extras.addQuickItem}><input aria-label="New quick-add item" value={newPriorityPreset} placeholder="New quick-add item" onChange={(event) => setNewPriorityPreset(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addPriorityPreset(); }} /><button type="button" onClick={addPriorityPreset}>+ Add Quick Item</button></div>
            </div> : null}
            {!specialDuties.length ? <p className={styles.empty}>No special priorities added. Unassigned maids remain available for the supervisor to allocate.</p> : (
              <div className={styles.specialList}>{specialDuties.map((duty) => (
                <div key={duty.id} className={styles.specialRow}>
                  <label><span>Focus</span><input disabled={!canEdit} value={duty.focus} placeholder="e.g. Bathroom deep clean" onChange={(event) => updateSpecialDuty(duty.id, { focus: event.target.value })} /></label>
                  <label><span>Scope</span><input disabled={!canEdit} value={duty.scope} placeholder="Rooms, floors or all checkouts" onChange={(event) => updateSpecialDuty(duty.id, { scope: event.target.value })} /></label>
                  <label><span>Assigned to</span><input disabled={!canEdit} value={duty.assignedTo} placeholder="Staff name(s)" onChange={(event) => updateSpecialDuty(duty.id, { assignedTo: event.target.value })} /></label>
                  {canEdit ? <button type="button" aria-label="Remove priority" onClick={() => setSpecialDuties((current) => current.filter((row) => row.id !== duty.id))}>×</button> : null}
                </div>
              ))}</div>
            )}
          </section>
        </div>

        <aside className={styles.briefingCard}>
          <header><div><span className={styles.eyebrow}>READY FOR WHATSAPP</span><h3>Daily Duty Briefing</h3></div><button type="button" onClick={() => void copyReport()}>Copy Report</button></header>
          <pre>{reportText}</pre>
        </aside>
      </div>

      <div className={styles.actionBar}>
        <small>{lastSaved ? `Last saved by ${lastSaved.name} · ${new Date(lastSaved.at).toLocaleString('en-MY')}` : 'Not saved yet'}</small>
        {canEdit ? <div><button type="button" className={styles.secondaryAction} disabled={saving} onClick={() => applyDefault()}>Reset to Default</button><button type="button" className={styles.primaryAction} disabled={saving} onClick={() => void saveDuty(false)}>{saving ? 'Saving...' : 'Save Assignment'}</button><button type="button" className={styles.copyAction} disabled={saving} onClick={() => void saveDuty(true)}>Save & Copy Briefing</button></div> : <button type="button" className={styles.copyAction} onClick={() => void copyReport()}>Copy Briefing</button>}
      </div>
    </section>
  );
}

function Metric({ label, value, warning = false }: { label: string; value: string | number; warning?: boolean }) {
  return <div className={`${styles.metric} ${warning ? styles.metricWarning : ''}`}><span>{label}</span><strong>{value}</strong></div>;
}
