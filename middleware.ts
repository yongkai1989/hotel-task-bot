import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  if (pathname === '/restaurant-kiosk/payment-status' && !searchParams.get('order_id')) {
    const url = req.nextUrl.clone();
    url.pathname = '/restaurant-kiosk';
    url.search = '?mode=kiosk';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/restaurant-kiosk/payment-status'],
};
