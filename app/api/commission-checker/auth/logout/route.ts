import { NextResponse } from 'next/server';
import { COMMISSION_CHECKER_COOKIE } from '../../../../../lib/commissionCheckerAuth';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COMMISSION_CHECKER_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}

