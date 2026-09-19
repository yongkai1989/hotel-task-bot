import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { processDueTaskEscalations } from '../../../../lib/taskEscalation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

const SCHEDULER_TOKEN_SHA256 = 'cb70481797ed96935694b28ba43e631eb0ecaaec86662db7a62d3395532627f3';

function authorized(req: NextRequest) {
  const authorization = String(req.headers.get('authorization') || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) return false;
  const received = createHash('sha256').update(token).digest();
  const expected = Buffer.from(SCHEDULER_TOKEN_SHA256, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await processDueTaskEscalations({ force: true, throwOnError: true });
    console.log(JSON.stringify({
      event: 'task_alert_scheduler_complete',
      ...result,
      durationMs: Date.now() - startedAt,
    }));
    return NextResponse.json({ ok: true, ...result }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error: any) {
    console.error(JSON.stringify({
      event: 'task_alert_scheduler_failed',
      error: error?.message || String(error),
      durationMs: Date.now() - startedAt,
    }));
    return NextResponse.json(
      { ok: false, error: error?.message || 'Task alert scheduler failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
