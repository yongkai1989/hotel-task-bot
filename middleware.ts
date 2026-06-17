import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  const cleanPathname = pathname.replace(/\/+$/, '');

  if (cleanPathname === '/restaurant-kiosk/payment-status' && !String(searchParams.get('order_id') || '').trim()) {
    const url = req.nextUrl.clone();
    url.pathname = '/restaurant-kiosk';
    url.search = '?mode=kiosk';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/restaurant-kiosk/payment-status/:path*'],
};
