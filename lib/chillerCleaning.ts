import { createHash, randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { supabaseAdmin } from './supabaseAdmin';
import { DashboardUser } from './dashboardAuth';

export const CHILLER_BUCKET = 'chiller-cleaning';
export const DEFAULT_CHILLER_PASSCODE_HASH =
  '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92';

export type ChillerKind = 'before' | 'after';

export type ChillerRecord = {
  id: string;
  week_start: string;
  week_end: string;
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

export type ChillerWeek = {
  today: string;
  weekStart: string;
  weekEnd: string;
  label: string;
};

function yyyyMmDd(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDisplayDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function hashPasscode(passcode: string) {
  return createHash('sha256').update(String(passcode || '')).digest('hex');
}

export function tokenForHash(passcodeHash: string) {
  return createHash('sha256')
    .update(`${passcodeHash}:chiller-cleaning-access`)
    .digest('hex');
}

export function getCurrentSingaporeWeek(): ChillerWeek {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  const todayDate = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = todayDate.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStartDate = addDays(todayDate, mondayOffset);
  const weekEndDate = addDays(weekStartDate, 6);
  const weekStart = yyyyMmDd(weekStartDate);
  const weekEnd = yyyyMmDd(weekEndDate);

  return {
    today: yyyyMmDd(todayDate),
    weekStart,
    weekEnd,
    label: `${formatDisplayDate(weekStart)} - ${formatDisplayDate(weekEnd)}`,
  };
}

export async function getChillerSettings() {
  const { data, error } = await supabaseAdmin
    .from('chiller_cleaning_settings')
    .select('id, passcode_hash, updated_at')
    .eq('id', 'singleton')
    .maybeSingle();

  if (error) throw error;

  if (data?.passcode_hash) return data;

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('chiller_cleaning_settings')
    .upsert(
      {
        id: 'singleton',
        passcode_hash: DEFAULT_CHILLER_PASSCODE_HASH,
      },
      { onConflict: 'id' }
    )
    .select('id, passcode_hash, updated_at')
    .single();

  if (insertError) throw insertError;
  return inserted;
}

export async function verifyChillerToken(req: NextRequest) {
  const token = req.headers.get('x-chiller-token') || '';
  const settings = await getChillerSettings();
  return token && token === tokenForHash(settings.passcode_hash);
}

export function canManageChiller(user: DashboardUser | null) {
  return user?.role === 'SUPERUSER';
}

export function chillerExtensionFor(type: string) {
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  return 'jpg';
}

export function chillerStoragePath(kind: ChillerKind, weekStart: string) {
  return `${weekStart}/${kind}-${Date.now()}-${randomUUID()}`;
}

export async function signChillerRecord(record: ChillerRecord | null) {
  if (!record) return null;

  async function signedUrl(path: string | null) {
    if (!path) return null;

    const { data, error } = await supabaseAdmin.storage
      .from(CHILLER_BUCKET)
      .createSignedUrl(path, 60 * 60);

    if (error) return null;
    return data?.signedUrl || null;
  }

  return {
    ...record,
    before_url: await signedUrl(record.before_path),
    after_url: await signedUrl(record.after_path),
  };
}

export async function cleanupOldChillerSubmissions() {
  const week = getCurrentSingaporeWeek();
  const cutoffDate = new Date(`${week.weekStart}T00:00:00Z`);
  cutoffDate.setUTCMonth(cutoffDate.getUTCMonth() - 4);
  const cutoff = yyyyMmDd(cutoffDate);

  const { data: oldRows, error } = await supabaseAdmin
    .from('chiller_cleaning_submissions')
    .select('id, before_path, after_path')
    .lt('week_start', cutoff);

  if (error || !oldRows?.length) return;

  const paths = oldRows
    .flatMap((row: any) => [row.before_path, row.after_path])
    .filter(Boolean);

  if (paths.length) {
    await supabaseAdmin.storage.from(CHILLER_BUCKET).remove(paths);
  }

  await supabaseAdmin
    .from('chiller_cleaning_submissions')
    .delete()
    .in(
      'id',
      oldRows.map((row: any) => row.id)
    );
}
