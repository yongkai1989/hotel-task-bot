import { NextRequest, NextResponse } from 'next/server';
import { processDueTaskEscalations } from '../../../../lib/taskEscalation';
import { isTaskSchedulerAuthorization } from '../../../../lib/schedulerAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

function authorized(req: NextRequest) {
  return isTaskSchedulerAuthorization(req.headers.get('authorization'));
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
