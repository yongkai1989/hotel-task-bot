import { NextRequest, NextResponse } from 'next/server';
import { isTaskSchedulerAuthorization } from '../../../../lib/schedulerAuth';
import { runStorageMaintenance } from '../../../../lib/storageMaintenance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  if (!isTaskSchedulerAuthorization(req.headers.get('authorization'))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runStorageMaintenance();
    console.log(JSON.stringify({
      event: 'storage_maintenance_complete',
      ...result,
      durationMs: Date.now() - startedAt,
    }));
    return NextResponse.json({ ok: true, ...result }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error: any) {
    console.error(JSON.stringify({
      event: 'storage_maintenance_failed',
      error: error?.message || String(error),
      durationMs: Date.now() - startedAt,
    }));
    return NextResponse.json(
      { ok: false, error: error?.message || 'Storage maintenance failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
