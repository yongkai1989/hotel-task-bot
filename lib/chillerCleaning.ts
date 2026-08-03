import { createHash, randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { supabaseAdmin } from './supabaseAdmin';
import { DashboardUser } from './dashboardAuth';

export const CHILLER_BUCKET = 'chiller-cleaning';
export const GRAND_CHILLER_BUCKET = 'grand-fnb-routine-duties';
export const DEFAULT_CHILLER_PASSCODE_HASH =
  '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92';
export const CHILLER_TRACKING_START = '2026-07-20';
export const CHILLER_NAMES = [
  'Chiller 1',
  'Chiller 2',
  'Chiller 3',
  'Chiller 4',
  'Chiller 5',
  'Grease Trap 1',
  'Grease Trap 2',
  'Grease Trap 3',
  'Microwave 1',
  'Microwave 2',
] as const;

export const CHILLER_BRANCHES = [
  { id: 'regency', name: 'Regency F&B Routine Duties', url: '/regency-fnb-routine-duties' },
  { id: 'grand', name: 'Grand F&B Routine Duties', url: '/grand-fnb-routine-duties' },
] as const;

export type ChillerName = (typeof CHILLER_NAMES)[number];
export type ChillerBranch = (typeof CHILLER_BRANCHES)[number]['id'];
export type ChillerKind = 'before' | 'after';
export type ChillerTokenMode = 'staff' | 'admin' | 'either';

export type ChillerSettings = {
  id: string;
  passcode_hash: string;
  staff_passcode_hash: string;
  admin_passcode_hash: string;
  updated_at: string | null;
};

export type ChillerRecord = {
  id: string;
  branch: ChillerBranch;
  week_start: string;
  week_end: string;
  chiller_name: string;
  staff_name: string | null;
  before_path: string | null;
  before_submitted_at: string | null;
  after_path: string | null;
  after_submitted_at: string | null;
  created_at: string;
  updated_at: string;
  before_url?: string | null;
  after_url?: string | null;
};

export function hashPasscode(passcode: string) {
  return createHash('sha256').update(passcode.trim()).digest('hex');
}

export function tokenForHash(hash: string, scope = 'admin') {
  return createHash('sha256').update(`chiller-cleaning:${scope}:${hash}`).digest('hex');
}

export function normalizeChillerBranch(value: unknown): ChillerBranch {
  return String(value || '').trim().toLowerCase() === 'grand' ? 'grand' : 'regency';
}

export function chillerBranchDetails(branch: ChillerBranch) {
  return CHILLER_BRANCHES.find((item) => item.id === branch) || CHILLER_BRANCHES[0];
}

export function chillerBucketForBranch(branch: ChillerBranch) {
  return branch === 'grand' ? GRAND_CHILLER_BUCKET : CHILLER_BUCKET;
}

export function normalizeChillerName(value: unknown): ChillerName {
  const text = String(value || '').trim().toLowerCase();
  const found = CHILLER_NAMES.find((name) => name.toLowerCase() === text);
  return found || 'Chiller 1';
}

function normalizeSettings(row: any, id = 'singleton'): ChillerSettings {
  const legacyHash = String(row?.passcode_hash || DEFAULT_CHILLER_PASSCODE_HASH);
  return {
    id,
    passcode_hash: legacyHash,
    staff_passcode_hash: String(row?.staff_passcode_hash || legacyHash),
    admin_passcode_hash: String(row?.admin_passcode_hash || legacyHash),
    updated_at: row?.updated_at || null,
  };
}

export async function getChillerSettings(branch: ChillerBranch = 'regency'): Promise<ChillerSettings> {
  const id = normalizeChillerBranch(branch);
  const { data, error } = await supabaseAdmin
    .from('chiller_cleaning_settings')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (data) return normalizeSettings(data, id);

  const { data: legacy } = await supabaseAdmin
    .from('chiller_cleaning_settings')
    .select('*')
    .eq('id', 'singleton')
    .maybeSingle();
  const fallback = normalizeSettings(legacy, id);

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('chiller_cleaning_settings')
    .insert({
      id,
      passcode_hash: fallback.staff_passcode_hash,
      staff_passcode_hash: fallback.staff_passcode_hash,
      admin_passcode_hash: fallback.admin_passcode_hash,
    } as any)
    .select('*')
    .single();

  if (insertError) throw new Error(insertError.message);
  return normalizeSettings(inserted, id);
}

export async function getChillerAdminSettings(): Promise<ChillerSettings> {
  const { data, error } = await supabaseAdmin
    .from('chiller_cleaning_settings')
    .select('*')
    .eq('id', 'singleton')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return normalizeSettings(data, 'singleton');

  const regency = await getChillerSettings('regency');
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('chiller_cleaning_settings')
    .insert({
      id: 'singleton',
      passcode_hash: regency.staff_passcode_hash,
      staff_passcode_hash: regency.staff_passcode_hash,
      admin_passcode_hash: regency.admin_passcode_hash,
    } as any)
    .select('*')
    .single();
  if (insertError) throw new Error(insertError.message);
  return normalizeSettings(inserted, 'singleton');
}

export async function verifyChillerToken(
  req: NextRequest,
  mode: ChillerTokenMode = 'either',
  branch: ChillerBranch = 'regency',
) {
  const token = req.headers.get('x-chiller-token') || '';
  if (!token) return false;

  const [settings, adminSettings] = await Promise.all([
    getChillerSettings(branch),
    getChillerAdminSettings(),
  ]);
  const staffToken = tokenForHash(settings.staff_passcode_hash, `staff:${branch}`);
  const adminToken = tokenForHash(adminSettings.admin_passcode_hash, 'admin');

  if (mode === 'staff') return token === staffToken || token === adminToken;
  if (mode === 'admin') return token === adminToken;
  return token === staffToken || token === adminToken;
}

export function canManageChillerCleaning(user: DashboardUser | null) {
  if (!user) return false;
  const role = String(user.role || '').toUpperCase();
  return role === 'SUPERUSER' || role === 'MANAGER';
}

export const canManageChiller = canManageChillerCleaning;

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateKeyToUtc(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function utcDateKey(date: Date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function addDays(dateKey: string, days: number) {
  const date = dateKeyToUtc(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDateKey(date);
}

function mondayFor(dateKey: string) {
  const date = dateKeyToUtc(dateKey);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return utcDateKey(date);
}

export function getCurrentChillerWeek() {
  const calculatedStart = mondayFor(localDateKey());
  const start =
    calculatedStart < CHILLER_TRACKING_START ? CHILLER_TRACKING_START : calculatedStart;
  return {
    start,
    end: addDays(start, 6),
  };
}

export const getCurrentSingaporeWeek = getCurrentChillerWeek;

export function getChillerWeekFor(dateKey: string) {
  const start = mondayFor(dateKey);
  return {
    start,
    end: addDays(start, 6),
  };
}

export function enumerateChillerWeeks(startDate = CHILLER_TRACKING_START, months = 4) {
  const currentWeek = getCurrentChillerWeek();
  const oldest = new Date();
  oldest.setMonth(oldest.getMonth() - months);
  const oldestWeek = mondayFor(localDateKey(oldest));
  const first = startDate > oldestWeek ? startDate : oldestWeek;
  const weeks: Array<{ start: string; end: string }> = [];
  let cursor = first;

  while (cursor <= currentWeek.start) {
    weeks.push({ start: cursor, end: addDays(cursor, 6) });
    cursor = addDays(cursor, 7);
  }

  return weeks;
}

export async function signChillerRecord(record: any): Promise<ChillerRecord> {
  const branch = normalizeChillerBranch(record.branch);
  const signed: ChillerRecord = {
    id: String(record.id),
    branch,
    week_start: String(record.week_start),
    week_end: String(record.week_end),
    chiller_name: normalizeChillerName(record.chiller_name),
    staff_name: record.staff_name || null,
    before_path: record.before_path || null,
    before_submitted_at: record.before_submitted_at || null,
    after_path: record.after_path || null,
    after_submitted_at: record.after_submitted_at || null,
    created_at: String(record.created_at || ''),
    updated_at: String(record.updated_at || ''),
    before_url: null,
    after_url: null,
  };

  for (const key of ['before', 'after'] as const) {
    const path = signed[`${key}_path`];
    if (!path) continue;
    const { data } = await supabaseAdmin.storage
      .from(chillerBucketForBranch(branch))
      .createSignedUrl(path, 60 * 60);
    signed[`${key}_url`] = data?.signedUrl || null;
  }

  return signed;
}

export function chillerExtensionFor(value: unknown) {
  const raw =
    typeof value === 'string'
      ? value
      : String((value as any)?.name || (value as any)?.type || '');
  const lower = raw.toLowerCase();

  if (lower.includes('image/png') || lower.endsWith('.png')) return '.png';
  if (lower.includes('image/webp') || lower.endsWith('.webp')) return '.webp';
  if (lower.includes('image/heic') || lower.endsWith('.heic')) return '.heic';
  if (lower.includes('image/heif') || lower.endsWith('.heif')) return '.heif';
  if (lower.includes('image/gif') || lower.endsWith('.gif')) return '.gif';
  if (
    lower.includes('image/jpeg') ||
    lower.includes('image/jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.jpg')
  ) {
    return '.jpg';
  }

  const match = lower.match(/\.[a-z0-9]+$/);
  return match?.[0] || '.jpg';
}

export function chillerStoragePath(
  branch: ChillerBranch,
  kind: ChillerKind,
  weekStart: string,
  chillerName: string,
  extension = '',
) {
  const cleanChiller = normalizeChillerName(chillerName).toLowerCase().replace(/\s+/g, '-');
  const ext = extension ? (extension.startsWith('.') ? extension : `.${extension}`) : '';
  return `${branch}/${weekStart}/${cleanChiller}/${kind}-${Date.now()}-${randomUUID()}${ext}`;
}

export async function cleanupOldChillerSubmissions() {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 4);
  const cutoffDate = localDateKey(cutoff);

  const { data } = await supabaseAdmin
    .from('chiller_cleaning_submissions')
    .select('id, branch, before_path, after_path')
    .lt('week_start', cutoffDate);

  for (const branch of ['regency', 'grand'] as ChillerBranch[]) {
    const paths = (data || [])
      .filter((row: any) => normalizeChillerBranch(row.branch) === branch)
      .flatMap((row: any) => [row.before_path, row.after_path].filter(Boolean));
    if (paths.length) {
      await supabaseAdmin.storage.from(chillerBucketForBranch(branch)).remove(paths as string[]);
    }
  }

  await supabaseAdmin.from('chiller_cleaning_submissions').delete().lt('week_start', cutoffDate);
}
