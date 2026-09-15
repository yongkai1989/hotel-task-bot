export const DUTY_FLOORS = [
  { key: 'B1F1', block: 1, floor: 1 },
  { key: 'B1F2', block: 1, floor: 2 },
  { key: 'B1F3', block: 1, floor: 3 },
  { key: 'B1F5', block: 1, floor: 5 },
  { key: 'B2F3', block: 2, floor: 3 },
  { key: 'B2F5', block: 2, floor: 5 },
  { key: 'B2F6', block: 2, floor: 6 },
  { key: 'B2F7', block: 2, floor: 7 },
] as const;

export type DutyFloorKey = (typeof DUTY_FLOORS)[number]['key'];

export type DutyStaff = {
  id: string;
  staff_name: string;
};

export type FloorWorkload = {
  floorKey: DutyFloorKey;
  checkout: number;
  stayover: number;
};

export type MaidDutyAssignment = {
  staffId: string;
  staffName: string;
  floors: DutyFloorKey[];
};

export type SupervisorDutyAssignment = {
  floorKey: DutyFloorKey;
  staffId: string;
  staffName: string;
};

export type SuggestedDutyPlan = {
  maidAssignments: MaidDutyAssignment[];
  supervisorAssignments: SupervisorDutyAssignment[];
  linenControllerStaffIds: string[];
};

export const PREM_BACKUP_RELEASER: DutyStaff = {
  id: 'duty-backup-releaser-prem',
  staff_name: 'Prem',
};

const USUAL_MAID_BY_FLOOR: Record<DutyFloorKey, string> = {
  B1F1: 'fikri',
  B1F2: 'syahrul',
  B1F3: 'hakimi',
  B1F5: 'zarul',
  B2F3: 'lila',
  B2F5: 'faridah',
  B2F6: 'sapiah',
  B2F7: 'suhaimi',
};

const RELIEF_PRIORITY = ['jiros', 'rathika', 'dyan', 'rizky', 'arda'];

export function normalizeStaffName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function firstName(value: string) {
  return normalizeStaffName(value).split(' ')[0] || '';
}

function findByFirstName(staff: DutyStaff[], name: string) {
  return staff.find((person) => {
    const actual = firstName(person.staff_name);
    return actual === name || (name === 'lila' && actual === 'nurlila');
  });
}

export function withPremBackupReleaser(supervisors: DutyStaff[]) {
  if (supervisors.length !== 1) return supervisors;
  if (findByFirstName(supervisors, 'prem')) return supervisors;
  return [...supervisors, PREM_BACKUP_RELEASER];
}

function workloadTotal(workload: FloorWorkload | undefined) {
  return Number(workload?.checkout || 0) + Number(workload?.stayover || 0);
}

function floorBlock(floorKey: DutyFloorKey) {
  return DUTY_FLOORS.find((floor) => floor.key === floorKey)?.block || 1;
}

function assignSupervisors(available: DutyStaff[]): SupervisorDutyAssignment[] {
  if (!available.length) return [];

  const sulaiman = findByFirstName(available, 'sulaiman');
  const sofea = findByFirstName(available, 'sofea');
  const ezni = findByFirstName(available, 'ezni');
  const exactTeam = sulaiman && sofea && ezni;

  if (exactTeam) {
    const exact: Record<DutyFloorKey, DutyStaff> = {
      B1F1: sofea,
      B1F2: sofea,
      B1F3: ezni,
      B1F5: ezni,
      B2F3: sulaiman,
      B2F5: sulaiman,
      B2F6: sulaiman,
      B2F7: ezni,
    };
    return DUTY_FLOORS.map((floor) => ({
      floorKey: floor.key,
      staffId: exact[floor.key].id,
      staffName: exact[floor.key].staff_name,
    }));
  }

  if (available.length === 1) {
    return DUTY_FLOORS.map((floor) => ({
      floorKey: floor.key,
      staffId: available[0].id,
      staffName: available[0].staff_name,
    }));
  }

  const ordered = [sulaiman, sofea, ezni, ...available]
    .filter((person): person is DutyStaff => Boolean(person))
    .filter((person, index, rows) => rows.findIndex((row) => row.id === person.id) === index);
  const block2Lead = sulaiman || ordered[1];
  const block1Lead = ordered.find((person) => person.id !== block2Lead.id) || block2Lead;

  return DUTY_FLOORS.map((floor) => {
    const person = floor.block === 1 ? block1Lead : block2Lead;
    return { floorKey: floor.key, staffId: person.id, staffName: person.staff_name };
  });
}

export function generateSuggestedDutyPlan(args: {
  maids: DutyStaff[];
  supervisors: DutyStaff[];
  linenControllers: DutyStaff[];
  workloads: FloorWorkload[];
}): SuggestedDutyPlan {
  const { maids, supervisors, linenControllers, workloads } = args;
  const workloadMap = new Map(workloads.map((row) => [row.floorKey, row]));
  const activeFloors = DUTY_FLOORS
    .map((floor) => floor.key)
    .filter((floorKey) => workloadTotal(workloadMap.get(floorKey)) > 0)
    .sort((a, b) => workloadTotal(workloadMap.get(b)) - workloadTotal(workloadMap.get(a)));
  const desiredByBlock = new Map<number, number>();
  for (const block of [1, 2]) {
    const blockFloors = activeFloors.filter((floorKey) => floorBlock(floorKey) === block);
    const blockRooms = blockFloors.reduce((sum, floorKey) => sum + workloadTotal(workloadMap.get(floorKey)), 0);
    desiredByBlock.set(
      block,
      blockRooms ? Math.ceil(blockRooms / 16) : 0
    );
  }
  while ([...desiredByBlock.values()].reduce((sum, value) => sum + value, 0) > maids.length) {
    const reducible = [1, 2]
      .filter((block) => (desiredByBlock.get(block) || 0) > 1)
      .sort((a, b) => (desiredByBlock.get(b) || 0) - (desiredByBlock.get(a) || 0))[0];
    if (!reducible) break;
    desiredByBlock.set(reducible, (desiredByBlock.get(reducible) || 1) - 1);
  }

  const usedIds = new Set<string>();
  const assignments: MaidDutyAssignment[] = [];

  for (const block of [1, 2]) {
    const blockFloors = activeFloors.filter((floorKey) => floorBlock(floorKey) === block);
    const binCount = desiredByBlock.get(block) || 0;
    const bins: Array<{ floors: DutyFloorKey[]; load: number }> = Array.from(
      { length: binCount },
      () => ({ floors: [], load: 0 })
    );
    for (const floorKey of blockFloors) {
      const target = bins
        .sort((a, b) => a.load - b.load)[0];
      if (!target) continue;
      target.floors.push(floorKey);
      target.load += workloadTotal(workloadMap.get(floorKey));
    }

    const reservedForOtherBlock = new Set(
      activeFloors
        .filter((floorKey) => floorBlock(floorKey) !== block)
        .map((floorKey) => findByFirstName(maids, USUAL_MAID_BY_FLOOR[floorKey])?.id)
        .filter((id): id is string => Boolean(id))
    );
    const available = (rows: Array<DutyStaff | undefined>) => rows.find((person) => person && !usedIds.has(person.id));

    for (const bin of bins) {
      // When floors are combined, keep the usual maid from the lightest floor
      // and let that person assist the busier floors.
      const usualFloor = [...bin.floors].sort(
        (a, b) => workloadTotal(workloadMap.get(a)) - workloadTotal(workloadMap.get(b))
      )[0];
      const usualPrimary = usualFloor
        ? findByFirstName(maids, USUAL_MAID_BY_FLOOR[usualFloor])
        : undefined;
      const relief = RELIEF_PRIORITY.map((name) => findByFirstName(maids, name));
      const otherUsual = bin.floors.map((floorKey) => findByFirstName(maids, USUAL_MAID_BY_FLOOR[floorKey]));
      const unreserved = maids.filter((person) => !reservedForOtherBlock.has(person.id));
      const person = available([usualPrimary, ...relief, ...otherUsual, ...unreserved, ...maids]);
      if (!person) continue;
      usedIds.add(person.id);
      const assignedFloors = bin.floors.length
        ? bin.floors
        : blockFloors[0]
          ? [blockFloors[0]]
          : [];
      if (assignedFloors.length) {
        assignments.push({ staffId: person.id, staffName: person.staff_name, floors: assignedFloors });
      }
    }
  }

  const nagaraj = findByFirstName(linenControllers, 'nagaraj');
  return {
    maidAssignments: assignments,
    supervisorAssignments: assignSupervisors(supervisors),
    linenControllerStaffIds: nagaraj ? [nagaraj.id] : [],
  };
}

export function floorLabel(floorKey: DutyFloorKey) {
  const floor = DUTY_FLOORS.find((row) => row.key === floorKey);
  return floor ? `Block ${floor.block} · Level ${floor.floor}` : floorKey;
}
