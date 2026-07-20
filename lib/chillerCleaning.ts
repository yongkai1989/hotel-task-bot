import { createHash, randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { supabaseAdmin } from './supabaseAdmin';
import { DashboardUser } from './dashboardAuth';

export const CHILLER_BUCKET = 'chiller-cleaning';
export const DEFAULT_CHILLER_PASSCODE_HASH =
  '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92';
export const CHILLER_TRACKING_START = '2026-07-20';
export const CHILLER_NAMES = ['Chiller 1', 'Chiller 2', 'Chiller 3', 'Chiller 4', 'Chiller 5'] as const;

export type ChillerName = (typeof CHILLER_NAMES)[number];
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

export function tokenForHash(hash: string) {
  return createHash('sha256').update(`chiller-cleaning:${hash}`).digest('hex');
}

export function normalizeChillerName(value: unknown): ChillerName {
  const text = String(value || '').trim().toLowerCase();
  const found = CHILLER_NAMES.find((name) => name.toLowerCase() === text);
  return found || 'Chiller 1';
}

function normalizeSettings(row: any): ChillerSettings {
  const legacyHash = String(row?.passcode_hash || DEFAULT_CHILLER_PASSCODE_HASH);
  return {
    id: 'singleton',
    passcode_hash: legacyHash,
    staff_passcode_hash: String(row?.staff_passcode_hash || legacyHash),
    admin_passcode_hash: String(row?.admin_passcode_hash || legacyHash),
    updated_at: row?.updated_at || null,
  };
}

export async function getChillerSettings(): Promise<ChillerSettings> {
  const { data, error } = await supabaseAdmin
    .from('chiller_cleaning_settings')
    .select('*')
    .eq('id', 'singleton')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (data) return normalizeSettings(data);

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('chiller_cleaning_settings')
    .insert({
      id: 'singleton',
      passcode_hash: DEFAULT_CHILLER_PASSCODE_HASH,
      staff_passcode_hash: DEFAULT_CHILLER_PASSCODE_HASH,
      admin_passcode_hash: DEFAULT_CHILLER_PASSCODE_HASH,
    } as any)
    .select('*')
    .single();

  if (insertError) throw new Error(insertError.message);
  return normalizeSettings(inserted);
}

export async function verifyChillerToken(req: NextRequest, mode: ChillerTokenMode = 'either') {
  const token = req.headers.get('x-chiller-token') || '';
  if (!token) return false;

  const settings = await getChillerSettings();
  const staffToken = tokenForHash(settings.staff_passcode_hash);
  const adminToken = tokenForHash(settings.admin_passcode_hash);

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
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00+08:00`);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function mondayFor(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00+08:00`);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return localDateKey(date);
}

export function getCurrentChillerWeek() {
  const start = mondayFor(localDateKey());
  return {
    start,
    end: addDays(start, 6),
  };
}

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
  const trackingStartDate = new Date(`${startDate}T00:00:00+08:00`);
  const firstSeed = trackingStartDate > oldest ? trackingStartDate : oldest;
  const first = mondayFor(localDateKey(firstSeed));
  const weeks: Array<{ start: string; end: string }> = [];
  let cursor = first;

  while (cursor <= currentWeek.start) {
    weeks.push({ start: cursor, end: addDays(cursor, 6) });
    cursor = addDays(cursor, 7);
  }

  return weeks;
}

export async function signChillerRecord(record: any): Promise<ChillerRecord> {
  const signed: ChillerRecord = {
    id: String(record.id),
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
    const { data } = await supabaseAdmin.storage.from(CHILLER_BUCKET).createSignedUrl(path, 60 * 60);
    signed[`${key}_url`] = data?.signedUrl || null;
  }

  return signed;
}

export function chillerStoragePath(kind: ChillerKind, weekStart: string, chillerName: string) {
  const cleanChiller = normalizeChillerName(chillerName).toLowerCase().replace(/\s+/g, '-');
  return `${weekStart}/${cleanChiller}/${kind}-${Date.now()}-${randomUUID()}`;
}

export async function cleanupOldChillerSubmissions() {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 4);
  const cutoffDate = localDateKey(cutoff);

  const { data } = await supabaseAdmin
    .from('chiller_cleaning_submissions')
    .select('id, before_path, after_path')
    .lt('week_start', cutoffDate);

  const paths = (data || []).flatMap((row: any) => [row.before_path, row.after_path].filter(Boolean));
  if (paths.length) {
    await supabaseAdmin.storage.from(CHILLER_BUCKET).remove(paths as string[]);
  }

  await supabaseAdmin.from('chiller_cleaning_submissions').delete().lt('week_start', cutoffDate);
}
