import { NextResponse } from 'next/server';
import { getWebPushPublicKey } from '../../../../lib/taskPush';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const publicKey = getWebPushPublicKey();
  return NextResponse.json(
    {
      ok: Boolean(publicKey),
      publicKey,
      error: publicKey ? undefined : 'Web Push is not configured',
    },
    {
      status: publicKey ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
