'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';
import { loadDashboardSessionProfile } from '../../../lib/dashboardSessionProfileClient';

type Voucher = {
  id: string;
  room_number: string;
  guest_name: string;
  status: string;
  payment_reference: string;
  total_myr: number;
  items_json?: any[];
  paid_at: string | null;
  created_at: string | null;
  voucher_code: string;
  voucher_quantity: number;
  voucher_redeemed_quantity: number;
  voucher_status: string;
  voucher_redeemed_at: string | null;
  voucher_redeemed_by: string;
  tickets?: Array<{
    code: string;
    entry_date: string;
    voucher_type_id?: string;
    name: string;
    status?: string;
    redeemed_at?: string | null;
    redeemed_by?: string;
  }>;
  manual_sale_channel?: string;
  manual_payment_type?: string;
  manual_amount_received?: number | null;
  manual_sold_by_name?: string;
  manual_issued_by_name?: string;
  manual_issued_by_email?: string;
  manual_issued_at?: string | null;
};

type VoucherType = {
  id: string;
  name: string;
  description: string;
  price_myr: number;
  is_active: boolean;
  display_order: number;
};

const blankTypeForm = {
  id: '',
  name: '',
  description: '',
  price_myr: '20.00',
  is_active: true,
  display_order: '1',
};

const blankManualForm = {
  room_number: '',
  entry_date: todayIso(),
  manual_payment_type: 'CASH',
  manual_amount_received: '',
  manual_sold_by_name: '',
};

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function formatTime(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-MY', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function money(value: number) {
  return `RM${Number(value || 0).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function isRedeemed(voucher: Voucher) {
  return voucher.voucher_status === 'REDEEMED' || voucher.status === 'FULFILLED';
}

function qrUrl(value: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=14&data=${encodeURIComponent(value)}`;
}

function formatEntryDate(value: string | null | undefined) {
  if (!value) return '-';
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return String(value);
  return new Date(year, month - 1, day).toLocaleDateString('en-MY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function voucherTickets(voucher: Voucher) {
  if (Array.isArray(voucher.tickets) && voucher.tickets.length) return voucher.tickets;

  const tickets: Voucher['tickets'] = [];
  if (Array.isArray(voucher.items_json)) {
    voucher.items_json.forEach((item: any) => {
      if (Array.isArray(item?.tickets)) {
        item.tickets.forEach((ticket: any) => {
          tickets.push({
            code: String(ticket?.code || ''),
            entry_date: String(ticket?.entry_date || item?.entry_date || ''),
            voucher_type_id: String(ticket?.voucher_type_id || item?.voucher_type_id || ''),
            name: String(ticket?.name || item?.name || 'Breakfast Voucher'),
            status: String(ticket?.status || 'ACTIVE'),
            redeemed_at: ticket?.redeemed_at || null,
            redeemed_by: String(ticket?.redeemed_by || ''),
          });
        });
      }
    });
  }

  if (!tickets.length && voucher.voucher_code) {
    tickets.push({
      code: voucher.voucher_code,
      entry_date: '',
      name: 'Breakfast Voucher',
      status: isRedeemed(voucher) ? 'REDEEMED' : 'ACTIVE',
      redeemed_at: voucher.voucher_redeemed_at,
      redeemed_by: voucher.voucher_redeemed_by,
    });
  }

  return tickets.filter((ticket) => ticket.code);
}

function escapeHtml(value: unknown) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function voucherItemText(voucher: Voucher) {
  if (Array.isArray(voucher.items_json) && voucher.items_json.length) {
    return voucher.items_json
      .map((item: any) => {
        const entryDate = item?.entry_date ? ` - ${formatEntryDate(item.entry_date)}` : '';
        return `${Number(item?.quantity || 1)}x ${String(item?.name || 'Breakfast Voucher')}${entryDate}`;
      })
      .join(' | ');
  }

  return `${voucher.voucher_quantity || 1}x Breakfast Voucher`;
}

function loadJsQr(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Camera scanner is not available here.'));
  if ((window as any).jsQR) return Promise.resolve((window as any).jsQR);

  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-jsqr-loader="true"]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve((window as any).jsQR), { once: true });
      existing.addEventListener('error', () => reject(new Error('Unable to load QR scanner. Please type the voucher code manually.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
    script.async = true;
    script.dataset.jsqrLoader = 'true';
    script.onload = () => {
      if ((window as any).jsQR) resolve((window as any).jsQR);
      else reject(new Error('QR scanner did not load. Please type the voucher code manually.'));
    };
    script.onerror = () => reject(new Error('Unable to load QR scanner. Please type the voucher code manually.'));
    document.head.appendChild(script);
  });
}

export default function BreakfastVouchersPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [activeTab, setActiveTab] = useState<'redeem' | 'manual' | 'types'>('redeem');
  const [isSuperuser, setIsSuperuser] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [room, setRoom] = useState('');
  const [code, setCode] = useState('');
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'neutral' | 'success' | 'danger'>('neutral');
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [voucherTypes, setVoucherTypes] = useState<VoucherType[]>([]);
  const [typeForm, setTypeForm] = useState(blankTypeForm);
  const [typesLoading, setTypesLoading] = useState(false);
  const [manualForm, setManualForm] = useState(blankManualForm);
  const [manualQuantities, setManualQuantities] = useState<Record<string, number>>({});
  const [manualSaving, setManualSaving] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanStopRef = useRef(false);

  async function getToken() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.access_token) return session.access_token;

      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    return '';
  }

  async function load() {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Your login session is still loading. Please refresh once and try again.');

      const params = new URLSearchParams({ date });
      if (room.trim()) params.set('room', room.trim());
      const res = await fetch(`/api/restaurant-kiosk/vouchers?${params.toString()}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Unable to load vouchers');
      setVouchers(json.vouchers || []);
    } catch (error: any) {
      setMessage(error?.message || 'Unable to load vouchers');
      setTone('danger');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProfile();
    load();
    loadTypes(false);
    return () => stopScanner();
  }, []);

  useEffect(() => {
    if (activeTab === 'types' && isSuperuser) loadTypes(true);
    if (activeTab === 'manual' && !voucherTypes.length) loadTypes(false);
  }, [activeTab, isSuperuser]);

  async function loadProfile() {
    try {
      const token = await getToken();
      if (!token) throw new Error('Your login session is still loading. Please refresh once and try again.');

      const nextProfile = await loadDashboardSessionProfile<{ user_id?: string; role?: string }>(token);
      const role = String(nextProfile?.role || '').trim().toUpperCase();
      setIsSuperuser(role === 'SUPERUSER');
    } catch {
      setIsSuperuser(false);
    }
  }

  async function loadTypes(admin = false) {
    setTypesLoading(true);
    try {
      const token = admin ? await getToken() : '';
      if (admin && !token) throw new Error('Your login session is still loading. Please refresh once and try again.');

      const res = await fetch(admin ? '/api/restaurant-kiosk/voucher-types?admin=1' : '/api/restaurant-kiosk/voucher-types', {
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Unable to load voucher types');
      setVoucherTypes(Array.isArray(json.types) ? json.types : []);
    } catch (error: any) {
      setMessage(error?.message || 'Unable to load voucher types');
      setTone('danger');
    } finally {
      setTypesLoading(false);
    }
  }

  function editType(type: VoucherType) {
    setTypeForm({
      id: type.id,
      name: type.name,
      description: type.description,
      price_myr: String(Number(type.price_myr || 0).toFixed(2)),
      is_active: type.is_active,
      display_order: String(type.display_order || 0),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetTypeForm() {
    setTypeForm(blankTypeForm);
  }

  async function saveType() {
    try {
      const token = await getToken();
      if (!token) throw new Error('Your login session is still loading. Please refresh once and try again.');

      const method = typeForm.id ? 'PUT' : 'POST';
      const res = await fetch('/api/restaurant-kiosk/voucher-types', {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: typeForm.id,
          name: typeForm.name,
          description: typeForm.description,
          price_myr: Number(typeForm.price_myr || 0),
          is_active: typeForm.is_active,
          display_order: Number(typeForm.display_order || 0),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Unable to save voucher type');
      setMessage(typeForm.id ? 'Voucher type updated.' : 'Voucher type created.');
      setTone('success');
      resetTypeForm();
      await loadTypes(true);
    } catch (error: any) {
      setMessage(error?.message || 'Unable to save voucher type');
      setTone('danger');
    }
  }

  async function deleteType(id: string) {
    if (!window.confirm('Delete this breakfast voucher type?')) return;
    try {
      const token = await getToken();
      if (!token) throw new Error('Your login session is still loading. Please refresh once and try again.');

      const res = await fetch(`/api/restaurant-kiosk/voucher-types?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Unable to delete voucher type');
      setMessage('Voucher type deleted.');
      setTone('success');
      await loadTypes(true);
    } catch (error: any) {
      setMessage(error?.message || 'Unable to delete voucher type');
      setTone('danger');
    }
  }

  function reprintTicket(voucher: Voucher) {
    const tickets = voucherTickets(voucher);
    if (!tickets.length) {
      setMessage('Voucher code is not ready yet.');
      setTone('danger');
      return;
    }

    const itemLines = Array.isArray(voucher.items_json) && voucher.items_json.length
      ? voucher.items_json
          .map((item: any) => `${Number(item?.quantity || 1)}x ${escapeHtml(item?.name || 'Breakfast Voucher')}`)
          .join('<br />')
      : `${voucher.voucher_quantity || 1}x Breakfast Voucher`;

    const ticketCards = tickets
      .map(
        (ticket) => `
          <section class="ticketBlock">
            <img src="${qrUrl(ticket.code)}" alt="Breakfast voucher QR" />
            <div class="code">${escapeHtml(ticket.code)}</div>
            <div class="grid">
              <div class="box"><small>Entry Date</small><b>${escapeHtml(formatEntryDate(ticket.entry_date))}</b></div>
              <div class="box"><small>Ticket Type</small><b>${escapeHtml(ticket.name)}</b></div>
            </div>
          </section>
        `
      )
      .join('');

    const printWindow = window.open('', '_blank', 'width=760,height=920');
    if (!printWindow) {
      setMessage('Popup blocked. Please allow popups to reprint ticket.');
      setTone('danger');
      return;
    }

    printWindow.document.write(`<!doctype html>
      <html>
        <head>
          <title>Breakfast Voucher ${escapeHtml(tickets[0]?.code || voucher.voucher_code)}</title>
          <style>
            body { margin: 0; background: #f7f2ea; color: #15120e; font-family: Arial, sans-serif; }
            .ticket { max-width: 680px; margin: 28px auto; padding: 34px; border: 1px solid #d9bd8c; border-radius: 28px; background: #fffdf8; text-align: center; }
            .brand { color: #9b6428; font-size: 12px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; }
            h1 { margin: 10px 0 18px; font-size: 42px; }
            .ticketBlock { break-inside: avoid; border: 1px solid #ead9bd; border-radius: 22px; padding: 18px; margin-top: 16px; }
            img { width: 220px; height: 220px; border: 1px dashed #d9bd8c; border-radius: 24px; padding: 16px; background: #fffaf1; }
            .code { margin: 18px 0; font-size: 26px; font-weight: 900; overflow-wrap: anywhere; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 20px; text-align: left; }
            .box { border: 1px solid #ead9bd; border-radius: 16px; padding: 14px; background: #fffaf1; }
            small { display: block; color: #6a5b48; font-weight: 800; margin-bottom: 5px; }
            b { font-size: 18px; }
            .items { margin-top: 18px; padding: 16px; border-radius: 16px; background: #15120e; color: #fff8ea; font-weight: 800; }
            @media print { body { background: #fff; } .ticket { margin: 0; border: 0; } }
          </style>
        </head>
        <body>
          <main class="ticket">
            <div class="brand">Hallmark Crown Hotel</div>
            <h1>Breakfast Voucher</h1>
            <div class="grid">
              <div class="box"><small>Room</small><b>${escapeHtml(voucher.room_number || '-')}</b></div>
              <div class="box"><small>Tickets</small><b>${tickets.length}</b></div>
              <div class="box"><small>Total</small><b>${money(voucher.total_myr)}</b></div>
              <div class="box"><small>Paid</small><b>${escapeHtml(formatTime(voucher.paid_at))}</b></div>
            </div>
            <div class="items">${itemLines}</div>
            ${ticketCards}
          </main>
          <script>window.onload = () => setTimeout(() => window.print(), 300);</script>
        </body>
      </html>`);
    printWindow.document.close();
  }

  async function redeem(value: string, orderId = '') {
    const voucherCode = value.trim();
    if (!voucherCode && !orderId) {
      setMessage('Please enter or scan a voucher code.');
      setTone('danger');
      return;
    }

    try {
      const token = await getToken();
      if (!token) throw new Error('Your login session is still loading. Please refresh once and try again.');

      const res = await fetch('/api/restaurant-kiosk/vouchers', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: voucherCode, order_id: orderId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setMessage(json?.error || 'Voucher cannot be redeemed');
        setTone('danger');
        if (json?.voucher) {
          setVouchers((rows) =>
            rows.map((row) => (row.id === json.voucher.id ? json.voucher : row))
          );
        }
        return;
      }

      const ticketLabel = json?.ticket
        ? `${json.ticket.name || 'Breakfast Voucher'} for ${formatEntryDate(json.ticket.entry_date)}`
        : json.voucher?.voucher_code || voucherCode;
      setMessage(`Voucher redeemed: ${ticketLabel}`);
      setTone('success');
      setCode('');
      setVouchers((rows) => {
        const exists = rows.some((row) => row.id === json.voucher.id);
        if (exists) return rows.map((row) => (row.id === json.voucher.id ? json.voucher : row));
        return [json.voucher, ...rows];
      });
    } catch (error: any) {
      setMessage(error?.message || 'Unable to redeem voucher');
      setTone('danger');
    }
  }

  async function deleteVoucher(id: string) {
    if (!isSuperuser) return;
    if (!window.confirm('Delete this breakfast voucher order permanently?')) return;

    try {
      const token = await getToken();
      if (!token) throw new Error('Your login session is still loading. Please refresh once and try again.');

      const res = await fetch(`/api/restaurant-kiosk/vouchers?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Unable to delete voucher order');

      setVouchers((rows) => rows.filter((row) => row.id !== id));
      setMessage('Breakfast voucher order deleted.');
      setTone('success');
    } catch (error: any) {
      setMessage(error?.message || 'Unable to delete voucher order');
      setTone('danger');
    }
  }

  function setManualQuantity(typeId: string, nextValue: number) {
    setManualQuantities((current) => ({
      ...current,
      [typeId]: Math.max(0, Math.min(20, Math.floor(nextValue || 0))),
    }));
  }

  const manualLines = useMemo(() => {
    return voucherTypes
      .map((type) => {
        const quantity = Math.max(0, Number(manualQuantities[type.id] || 0));
        return {
          type,
          quantity,
          lineTotal: Number((quantity * Number(type.price_myr || 0)).toFixed(2)),
        };
      })
      .filter((line) => line.quantity > 0);
  }, [manualQuantities, voucherTypes]);

  const manualTotal = useMemo(
    () => Number(manualLines.reduce((sum, line) => sum + line.lineTotal, 0).toFixed(2)),
    [manualLines]
  );

  async function issueManualVoucher() {
    try {
      setManualSaving(true);
      setMessage('');
      setTone('neutral');

      const token = await getToken();
      if (!token) throw new Error('Your login session is still loading. Please refresh once and try again.');
      if (!manualLines.length) throw new Error('Please add at least one voucher.');
      if (!manualForm.room_number.trim()) throw new Error('Room number is required.');
      if (!manualForm.manual_sold_by_name.trim()) throw new Error('Selling staff name is required.');

      const amountReceived =
        manualForm.manual_payment_type === 'COMPLIMENTARY'
          ? 0
          : Number(manualForm.manual_amount_received || manualTotal);

      const res = await fetch('/api/restaurant-kiosk/vouchers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          room_number: manualForm.room_number.trim(),
          manual_payment_type: manualForm.manual_payment_type,
          manual_amount_received: amountReceived,
          manual_sold_by_name: manualForm.manual_sold_by_name.trim(),
          items: manualLines.map((line) => ({
            voucherTypeId: line.type.id,
            entryDate: manualForm.entry_date,
            quantity: line.quantity,
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Unable to issue manual voucher');

      setVouchers((rows) => [json.voucher, ...rows]);
      setManualForm({ ...blankManualForm, entry_date: todayIso() });
      setManualQuantities({});
      setMessage(`Manual breakfast voucher issued for Room ${json.voucher?.room_number || manualForm.room_number}.`);
      setTone('success');
      setActiveTab('redeem');
    } catch (error: any) {
      setMessage(error?.message || 'Unable to issue manual voucher');
      setTone('danger');
    } finally {
      setManualSaving(false);
    }
  }

  function stopScanner() {
    scanStopRef.current = true;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    streamRef.current = null;
    setScanning(false);
  }

  async function startScanner() {
    setMessage('');
    setTone('neutral');
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage('This browser cannot open the camera. Please type the voucher code manually.');
      setTone('danger');
      return;
    }

    try {
      scanStopRef.current = false;
      setScanning(true);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (!videoRef.current) throw new Error('Camera preview is not ready. Please tap Scan QR again.');

      videoRef.current.setAttribute('playsinline', 'true');
      videoRef.current.muted = true;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      const BarcodeDetectorCtor = (window as any).BarcodeDetector;
      const detector = BarcodeDetectorCtor ? new BarcodeDetectorCtor({ formats: ['qr_code'] }) : null;
      const jsQR = detector ? null : await loadJsQr();
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });

      const scan = async () => {
        if (scanStopRef.current || !videoRef.current) return;
        try {
          let raw = '';
          if (detector) {
            const codes = await detector.detect(videoRef.current);
            raw = String(codes?.[0]?.rawValue || '').trim();
          } else if (jsQR && context && videoRef.current.videoWidth && videoRef.current.videoHeight) {
            canvas.width = videoRef.current.videoWidth;
            canvas.height = videoRef.current.videoHeight;
            context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            const result = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'attemptBoth',
            });
            raw = String(result?.data || '').trim();
          }

          if (raw) {
            stopScanner();
            await redeem(raw);
            return;
          }
        } catch {
          // Keep the scanner running; manual entry is available if scanning fails.
        }
        window.setTimeout(scan, detector ? 450 : 650);
      };
      scan();
    } catch (error: any) {
      setMessage(error?.message || 'Unable to open camera');
      setTone('danger');
      stopScanner();
    }
  }

  const paidCount = vouchers.filter((voucher) => voucher.status === 'PAID' || voucher.status === 'FULFILLED').length;
  const redeemedCount = vouchers.filter(isRedeemed).length;
  const pendingCount = Math.max(0, paidCount - redeemedCount);
  const manualSelectedCount = manualLines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <main className="page">
      <section className="hero">
        <div>
          <p>Restaurant Kiosk Control</p>
          <h1>Breakfast Vouchers</h1>
          <span>Redeem QR tickets, issue counter-paid vouchers, and review breakfast sales from one counter workspace.</span>
        </div>
        <div className="heroActions">
          <button type="button" onClick={load}>Refresh</button>
          <Link href="/dashboard">Back to Dashboard</Link>
        </div>
      </section>

      <section className="stats">
        <div><span>Paid Today</span><strong>{paidCount}</strong><small>Verified tickets</small></div>
        <div><span>Redeemed</span><strong>{redeemedCount}</strong><small>Used at restaurant</small></div>
        <div><span>Pending Use</span><strong>{pendingCount}</strong><small>Still valid</small></div>
      </section>

      <section className="tabBar">
        <button className={activeTab === 'redeem' ? 'active' : ''} type="button" onClick={() => setActiveTab('redeem')}>
          <strong>Scan & Redeem</strong>
          <span>Restaurant entry</span>
        </button>
        <button className={activeTab === 'manual' ? 'active' : ''} type="button" onClick={() => setActiveTab('manual')}>
          <strong>Manual Issue</strong>
          <span>Counter payment</span>
        </button>
        {isSuperuser ? (
          <button className={activeTab === 'types' ? 'active' : ''} type="button" onClick={() => setActiveTab('types')}>
            <strong>Voucher Types</strong>
            <span>Superuser setup</span>
          </button>
        ) : null}
      </section>

      {activeTab === 'redeem' ? (
        <>
      <section className="scannerCard">
        <div className="scannerHead">
          <div>
            <p>Voucher scan</p>
            <h2>Redeem ticket</h2>
            <span>Use this phone or tablet camera to scan the guest QR code.</span>
          </div>
          {scanning ? (
            <button type="button" onClick={stopScanner}>Stop camera</button>
          ) : (
            <button type="button" onClick={startScanner}>Scan QR</button>
          )}
        </div>
        {scanning ? (
          <div className="cameraFrame">
            <video ref={videoRef} playsInline muted autoPlay />
            <div className="scanGuide">
              <span />
              <b>Align QR inside the frame</b>
            </div>
          </div>
        ) : null}
        <div className="manualRow">
          <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Enter voucher code manually" />
          <button type="button" onClick={() => redeem(code)}>Redeem</button>
        </div>
        {message ? <div className={`message ${tone}`}>{message}</div> : null}
      </section>

      <section className="listCard">
        <div className="listHead">
          <div>
            <p>Staff breakfast report</p>
            <h2>Voucher records</h2>
            <span>Readable sales, redemption, and reprint view for the selected date.</span>
          </div>
          <div className="filters">
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            <input value={room} onChange={(event) => setRoom(event.target.value)} placeholder="Room search" />
            <button type="button" onClick={load}>Search</button>
          </div>
        </div>

        <div className="reportStrip">
          <div>
            <span>Records</span>
            <strong>{vouchers.length}</strong>
          </div>
          <div>
            <span>Paid</span>
            <strong>{paidCount}</strong>
          </div>
          <div>
            <span>Redeemed</span>
            <strong>{redeemedCount}</strong>
          </div>
          <div>
            <span>Pending</span>
            <strong>{pendingCount}</strong>
          </div>
        </div>

        <div className="voucherList">
          {loading ? <div className="empty">Loading vouchers...</div> : null}
          {!loading && !vouchers.length ? <div className="empty">No breakfast vouchers found for this date.</div> : null}
          {!loading && vouchers.length ? (
            <div className="reportHeader" aria-hidden="true">
              <span>Guest / Room</span>
              <span>Ticket Details</span>
              <span>Payment / Audit</span>
              <span>Status</span>
            </div>
          ) : null}
          {vouchers.map((voucher) => (
            <article className={`voucherRow ${isRedeemed(voucher) ? 'redeemed' : ''}`} key={voucher.id}>
              <div className="guestCell">
                <p>Room {voucher.room_number || '-'}</p>
                <h3>{voucher.guest_name || 'Guest name not recorded'}</h3>
                <span>Ref {voucher.payment_reference || voucher.voucher_code || 'Pending'}</span>
              </div>
              <div className="ticketCell">
                <strong>{voucher.voucher_quantity || 1} ticket(s)</strong>
                <small className="itemBreakdown">{voucherItemText(voucher)}</small>
                <div className="ticketChips">
                  {voucherTickets(voucher).map((ticket) => (
                    <span className={String(ticket.status || '').toUpperCase() === 'REDEEMED' ? 'used' : ''} key={ticket.code}>
                      {formatEntryDate(ticket.entry_date)} - {ticket.name}
                    </span>
                  ))}
                </div>
              </div>
              <div className="auditCell">
                <strong>{money(voucher.total_myr)}</strong>
                <span>Paid {formatTime(voucher.paid_at)}</span>
                {voucher.manual_sale_channel === 'FRONT_OFFICE' ? (
                  <small className="auditBreakdown">
                    Manual sale - {String(voucher.manual_payment_type || '').replace(/_/g, ' ') || '-'}
                    <br />
                    Sold by {voucher.manual_sold_by_name || '-'} - Received {money(voucher.manual_amount_received ?? voucher.total_myr)}
                    <br />
                    Issued by {voucher.manual_issued_by_name || voucher.manual_issued_by_email || '-'} on {formatTime(voucher.manual_issued_at || null)}
                  </small>
                ) : null}
                {isRedeemed(voucher) ? <small>Redeemed by {voucher.voucher_redeemed_by || '-'} on {formatTime(voucher.voucher_redeemed_at)}</small> : null}
              </div>
              <div className="rowActions">
                <span>{isRedeemed(voucher) ? 'Redeemed' : voucher.status === 'PAID' ? 'Ready' : voucher.status}</span>
                {!isRedeemed(voucher) && voucher.status === 'PAID' ? (
                  <button type="button" onClick={() => redeem('', voucher.id)}>Redeem</button>
                ) : null}
                {voucher.status === 'PAID' || voucher.status === 'FULFILLED' ? (
                  <button type="button" onClick={() => reprintTicket(voucher)}>Reprint Ticket</button>
                ) : null}
                {isSuperuser ? (
                  <button className="dangerBtn" type="button" onClick={() => deleteVoucher(voucher.id)}>Delete</button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>
        </>
      ) : null}

      {activeTab === 'manual' ? (
        <section className="manualIssueCard">
          <div className="listHead">
            <div>
              <p>Front office sale</p>
              <h2>Issue paid breakfast ticket</h2>
              <span>Use only after payment has been collected. Every manual ticket is saved with selling staff, payment type, and amount received.</span>
            </div>
            <div className="totalBadge">
              <span>Total</span>
              <strong>{money(manualTotal)}</strong>
            </div>
          </div>

          {message ? <div className={`message ${tone}`}>{message}</div> : null}

          <div className="manualWorkflow">
            <div className="manualPanel">
              <div className="panelHead">
                <span>1</span>
                <div>
                  <p>Voucher selection</p>
                  <h3>Choose quantity</h3>
                </div>
              </div>

              <div className="manualVoucherPicker">
                {typesLoading ? <div className="empty">Loading voucher types...</div> : null}
                {!typesLoading && !voucherTypes.length ? <div className="empty">No active voucher types found.</div> : null}
                {voucherTypes.map((type) => {
                  const quantity = Math.max(0, Number(manualQuantities[type.id] || 0));
                  return (
                    <article className={quantity ? 'manualType selected' : 'manualType'} key={type.id}>
                      <div className="voucherMeta">
                        <p>{type.is_active ? 'Available' : 'Hidden'}</p>
                        <h3>{type.name}</h3>
                        <span>{type.description || 'Breakfast voucher'}</span>
                      </div>
                      <strong>{money(type.price_myr)}</strong>
                      <div className="qtyStepper" aria-label={`${type.name} quantity`}>
                        <button type="button" onClick={() => setManualQuantity(type.id, quantity - 1)}>-</button>
                        <b>{quantity}</b>
                        <button type="button" onClick={() => setManualQuantity(type.id, quantity + 1)}>+</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>

            <div className="manualPanel">
              <div className="panelHead">
                <span>2</span>
                <div>
                  <p>Sale details</p>
                  <h3>Record payment</h3>
                </div>
              </div>

              <div className="manualIssueGrid">
                <label>
                  Room Number
                  <input
                    value={manualForm.room_number}
                    onChange={(event) => setManualForm((form) => ({ ...form, room_number: event.target.value }))}
                    placeholder="Example: 1522"
                  />
                </label>
                <label>
                  Breakfast Date
                  <input
                    type="date"
                    min={todayIso()}
                    value={manualForm.entry_date}
                    onChange={(event) => setManualForm((form) => ({ ...form, entry_date: event.target.value || todayIso() }))}
                  />
                </label>
                <label>
                  Selling Staff Name
                  <input
                    value={manualForm.manual_sold_by_name}
                    onChange={(event) => setManualForm((form) => ({ ...form, manual_sold_by_name: event.target.value }))}
                    placeholder="Name written by FO"
                  />
                </label>
                <label>
                  Payment Type
                  <select
                    value={manualForm.manual_payment_type}
                    onChange={(event) => setManualForm((form) => ({ ...form, manual_payment_type: event.target.value }))}
                  >
                    <option value="CASH">Cash</option>
                    <option value="CARD_TERMINAL">Card Terminal</option>
                    <option value="MANUAL_QR">Manual QR / TNG</option>
                    {isSuperuser ? <option value="COMPLIMENTARY">Complimentary</option> : null}
                  </select>
                </label>
                <label>
                  Amount Received
                  <input
                    inputMode="decimal"
                    value={manualForm.manual_amount_received}
                    onChange={(event) => setManualForm((form) => ({ ...form, manual_amount_received: event.target.value }))}
                    placeholder={manualForm.manual_payment_type === 'COMPLIMENTARY' ? '0.00' : money(manualTotal).replace('RM', '')}
                    disabled={manualForm.manual_payment_type === 'COMPLIMENTARY'}
                  />
                </label>
              </div>
            </div>

            <aside className="manualCheckout">
              <p>Ready to issue</p>
              <h3>{manualSelectedCount} ticket(s)</h3>
              <strong>{money(manualTotal)}</strong>
              <div className="checkoutLines">
                {manualLines.length ? manualLines.map((line) => (
                  <span key={line.type.id}>
                    <b>{line.quantity}x {line.type.name}</b>
                    <em>{money(line.lineTotal)}</em>
                  </span>
                )) : <span><b>No vouchers selected</b><em>-</em></span>}
              </div>
              <small>Audit trail: room, payment type, selling staff, amount received, and issuer are saved with this voucher.</small>
              <button type="button" onClick={issueManualVoucher} disabled={manualSaving || !manualSelectedCount}>
                {manualSaving ? 'Issuing...' : 'Issue & Print Ticket'}
              </button>
            </aside>
          </div>
        </section>
      ) : null}

      {activeTab === 'types' && isSuperuser ? (
        <section className="typeManager">
          <div className="listHead">
            <div>
              <p>Superuser setup</p>
              <h2>Breakfast voucher types</h2>
            </div>
            <button type="button" onClick={resetTypeForm}>New Type</button>
          </div>

          <div className="typeEditor">
            <label>
              Voucher Type
              <input value={typeForm.name} onChange={(event) => setTypeForm((form) => ({ ...form, name: event.target.value }))} placeholder="Example: Adult Breakfast" />
            </label>
            <label>
              Price (RM)
              <input inputMode="decimal" value={typeForm.price_myr} onChange={(event) => setTypeForm((form) => ({ ...form, price_myr: event.target.value }))} placeholder="25.00" />
            </label>
            <label>
              Display Order
              <input inputMode="numeric" value={typeForm.display_order} onChange={(event) => setTypeForm((form) => ({ ...form, display_order: event.target.value }))} placeholder="1" />
            </label>
            <label className="wide">
              Description
              <input value={typeForm.description} onChange={(event) => setTypeForm((form) => ({ ...form, description: event.target.value }))} placeholder="Shown on the kiosk voucher card" />
            </label>
            <label className="checkLine">
              <input type="checkbox" checked={typeForm.is_active} onChange={(event) => setTypeForm((form) => ({ ...form, is_active: event.target.checked }))} />
              Active on kiosk
            </label>
            <button type="button" onClick={saveType}>{typeForm.id ? 'Save Changes' : 'Create Type'}</button>
          </div>

          {message ? <div className={`message ${tone}`}>{message}</div> : null}

          <div className="typeList">
            {typesLoading ? <div className="empty">Loading voucher types...</div> : null}
            {!typesLoading && !voucherTypes.length ? <div className="empty">No voucher types created yet.</div> : null}
            {voucherTypes.map((type) => (
              <article className="typeRow" key={type.id}>
                <div>
                  <p>{type.is_active ? 'Active' : 'Hidden'}</p>
                  <h3>{type.name}</h3>
                  <span>{type.description || 'No description'} - Order {type.display_order}</span>
                </div>
                <div className="rowActions">
                  <strong>{money(type.price_myr)}</strong>
                  <button type="button" onClick={() => editType(type)}>Edit</button>
                  <button className="dangerBtn" type="button" onClick={() => deleteType(type.id)}>Delete</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <style jsx>{`
        :global(body) {
          margin: 0;
          background: #eef4fb;
          color: #071225;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .page {
          padding: clamp(16px, 3vw, 34px);
        }
        .hero,
        .scannerCard,
        .listCard,
        .typeManager {
          border: 1px solid #cfe0f6;
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.88);
          box-shadow: 0 22px 60px rgba(39, 73, 118, 0.12);
        }
        .hero {
          padding: 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }
        p {
          margin: 0 0 6px;
          color: #245deb;
          font-size: 12px;
          font-weight: 950;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        h1,
        h2,
        h3 {
          margin: 0;
          letter-spacing: 0;
        }
        h1 {
          font-size: clamp(34px, 6vw, 58px);
        }
        .hero span,
        .voucherRow span,
        .voucherRow small {
          color: #5d6b83;
          font-weight: 750;
        }
        .heroActions,
        .filters,
        .manualRow,
        .scannerHead,
        .listHead {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }
        button,
        a {
          min-height: 46px;
          border-radius: 14px;
          border: 1px solid #c8d8ef;
          background: #fff;
          color: #071225;
          padding: 0 18px;
          text-decoration: none;
          font: inherit;
          font-weight: 950;
        }
        button:first-child,
        .manualRow button,
        .rowActions button {
          background: #245deb;
          border-color: #245deb;
          color: #fff;
        }
        .stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          margin: 16px 0;
        }
        .stats div {
          border: 1px solid #d4e3f6;
          border-radius: 20px;
          background: #fff;
          padding: 18px;
        }
        .stats span {
          display: block;
          color: #5d6b83;
          font-size: 12px;
          font-weight: 950;
          text-transform: uppercase;
        }
        .stats strong {
          display: block;
          margin-top: 6px;
          font-size: 32px;
        }
        .stats small {
          display: block;
          margin-top: 2px;
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
        }
        .tabBar {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, auto));
          gap: 8px;
          margin: 0 0 14px;
          padding: 6px;
          border: 1px solid #cfe0f6;
          border-radius: 18px;
          background: #eaf3ff;
          width: fit-content;
        }
        .tabBar button {
          border: 0;
          background: transparent;
          display: grid;
          gap: 2px;
          align-content: center;
          min-width: 150px;
          text-align: left;
        }
        .tabBar button.active {
          background: #245deb;
          color: #fff;
          box-shadow: 0 12px 26px rgba(36, 93, 235, 0.22);
        }
        .tabBar button span {
          color: inherit;
          opacity: 0.72;
          font-size: 11px;
          font-weight: 800;
        }
        .scannerCard,
        .listCard,
        .typeManager {
          padding: 18px;
          margin-top: 14px;
        }
        .scannerHead,
        .listHead {
          justify-content: space-between;
        }
        .scannerHead span {
          display: block;
          margin-top: 6px;
          color: #5d6b83;
          font-weight: 750;
        }
        .listHead span {
          display: block;
          margin-top: 6px;
          color: #5d6b83;
          font-weight: 800;
        }
        .cameraFrame {
          position: relative;
          overflow: hidden;
          width: 100%;
          min-height: min(68vh, 620px);
          margin-top: 14px;
          border-radius: 24px;
          background: #071225;
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
        }
        video {
          display: block;
          width: 100%;
          height: min(68vh, 620px);
          min-height: 420px;
          object-fit: cover;
          background: #071225;
        }
        .scanGuide {
          pointer-events: none;
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          color: #fff;
          text-align: center;
        }
        .scanGuide span {
          width: min(58vw, 360px);
          aspect-ratio: 1;
          border: 3px solid rgba(255, 255, 255, 0.82);
          border-radius: 28px;
          box-shadow:
            0 0 0 999px rgba(7, 18, 37, 0.28),
            0 18px 50px rgba(0, 0, 0, 0.18);
        }
        .scanGuide b {
          position: absolute;
          bottom: 22px;
          left: 50%;
          transform: translateX(-50%);
          border-radius: 999px;
          padding: 10px 14px;
          background: rgba(7, 18, 37, 0.72);
          font-size: 13px;
          white-space: nowrap;
        }
        input {
          min-height: 48px;
          border-radius: 14px;
          border: 1px solid #c8d8ef;
          background: #fff;
          padding: 0 14px;
          font: inherit;
          font-weight: 800;
          color: #071225;
        }
        select {
          min-height: 48px;
          border-radius: 14px;
          border: 1px solid #c8d8ef;
          background: #fff;
          padding: 0 14px;
          font: inherit;
          font-weight: 900;
          color: #071225;
        }
        .manualRow {
          margin-top: 14px;
        }
        .manualRow input {
          flex: 1 1 260px;
        }
        .message {
          margin-top: 14px;
          border-radius: 16px;
          padding: 16px;
          font-weight: 950;
        }
        .message.success {
          background: #e9fff2;
          border: 1px solid #a8edc4;
          color: #04703a;
        }
        .message.danger {
          background: #fff0f0;
          border: 1px solid #ffc4c4;
          color: #b6121b;
        }
        .typeEditor {
          display: grid;
          grid-template-columns: 1.2fr 0.7fr 0.6fr;
          gap: 12px;
          margin-top: 16px;
          padding: 16px;
          border: 1px solid #d5e3f5;
          border-radius: 20px;
          background: #fbfdff;
        }
        .manualIssueCard {
          margin-top: 14px;
          padding: 18px;
          border: 1px solid #cfe0f6;
          border-radius: 24px;
          background:
            linear-gradient(135deg, rgba(255, 255, 255, 0.94), rgba(244, 249, 255, 0.92)),
            #fff;
          box-shadow: 0 22px 60px rgba(39, 73, 118, 0.12);
        }
        .totalBadge {
          border-radius: 18px;
          padding: 14px 18px;
          background: #071225;
          color: #fff;
          min-width: 180px;
          text-align: right;
          white-space: nowrap;
        }
        .totalBadge span {
          display: block;
          color: rgba(255, 255, 255, 0.68);
          font-size: 11px;
          font-weight: 950;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .totalBadge strong {
          display: block;
          margin-top: 4px;
          font-size: 28px;
        }
        .manualIssueCard .listHead span {
          display: block;
          margin-top: 6px;
          color: #5d6b83;
          font-weight: 750;
        }
        .manualIssueCard .listHead .totalBadge span {
          margin-top: 0;
          color: rgba(255, 255, 255, 0.68);
          font-size: 11px;
          font-weight: 950;
        }
        .manualIssueCard .listHead .totalBadge strong {
          margin-top: 4px;
          color: #fff;
        }
        .manualWorkflow {
          display: grid;
          grid-template-columns: minmax(0, 1.25fr) minmax(300px, 0.75fr);
          grid-template-areas:
            "pick checkout"
            "details checkout";
          gap: 14px;
          margin-top: 16px;
        }
        .manualPanel {
          border: 1px solid #d5e3f5;
          border-radius: 22px;
          background: #fbfdff;
          padding: 16px;
        }
        .manualPanel:first-child {
          grid-area: pick;
        }
        .manualPanel:nth-child(2) {
          grid-area: details;
        }
        .panelHead {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 14px;
        }
        .panelHead > span {
          display: grid;
          place-items: center;
          width: 42px;
          height: 42px;
          border-radius: 14px;
          background: #eaf3ff;
          color: #245deb;
          font-weight: 950;
        }
        .panelHead h3 {
          font-size: 22px;
        }
        .manualIssueGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        .manualVoucherPicker {
          display: grid;
          gap: 10px;
        }
        .manualType {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto auto;
          gap: 12px;
          align-items: center;
          border: 1px solid #d5e3f5;
          border-radius: 20px;
          padding: 12px;
          background: #fff;
        }
        .manualType.selected {
          border-color: #79a9ff;
          background: #f3f8ff;
        }
        .manualType > strong {
          font-size: 19px;
          white-space: nowrap;
        }
        .manualType h3 {
          margin: 4px 0;
          font-size: 18px;
        }
        .manualType span {
          color: #5d6b83;
          font-weight: 800;
        }
        .qtyStepper {
          display: grid;
          grid-template-columns: 44px 42px 44px;
          align-items: center;
          justify-items: center;
          border-radius: 999px;
          padding: 6px;
          background: #eef4ff;
        }
        .qtyStepper button {
          min-height: 38px;
          width: 38px;
          border-radius: 999px;
          padding: 0;
          background: #fff;
          color: #071225;
        }
        .qtyStepper strong {
          font-size: 20px;
        }
        .qtyStepper b {
          font-size: 20px;
        }
        .manualCheckout {
          grid-area: checkout;
          position: sticky;
          top: 16px;
          align-self: start;
          border: 1px solid #bbd5ff;
          border-radius: 24px;
          background:
            linear-gradient(145deg, #071225 0%, #102655 48%, #245deb 100%);
          color: #fff;
          padding: 18px;
          box-shadow: 0 24px 54px rgba(36, 93, 235, 0.2);
        }
        .manualCheckout p {
          color: #bfdbfe;
        }
        .manualCheckout h3 {
          font-size: 22px;
        }
        .manualCheckout > strong {
          display: block;
          margin: 8px 0 12px;
          font-size: 40px;
        }
        .checkoutLines {
          display: grid;
          gap: 8px;
          margin: 12px 0;
        }
        .checkoutLines span {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          border-radius: 14px;
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
          font-size: 13px;
          font-weight: 850;
        }
        .checkoutLines em {
          font-style: normal;
          white-space: nowrap;
        }
        .manualCheckout small {
          display: block;
          color: rgba(255, 255, 255, 0.72);
          font-weight: 750;
          line-height: 1.45;
        }
        .manualCheckout button {
          width: 100%;
          margin-top: 14px;
          border: 0;
          background: #f8d77a;
          color: #071225;
          box-shadow: 0 12px 28px rgba(248, 215, 122, 0.24);
        }
        .manualCheckout button:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }
        .manualSummary {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          margin-top: 16px;
          border-radius: 20px;
          padding: 16px;
          background: #eef4ff;
          border: 1px solid #d5e3f5;
        }
        .manualSummary span {
          color: #5d6b83;
          font-weight: 800;
        }
        .manualSummary button {
          background: #245deb;
          border-color: #245deb;
          color: #fff;
          min-width: 220px;
        }
        label {
          display: grid;
          gap: 7px;
          color: #5d6b83;
          font-size: 12px;
          font-weight: 950;
          text-transform: uppercase;
        }
        label.wide {
          grid-column: 1 / -1;
        }
        .checkLine {
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: 48px;
          text-transform: none;
          font-size: 14px;
          color: #071225;
        }
        .checkLine input {
          min-height: 0;
          width: 18px;
          height: 18px;
        }
        .typeList {
          display: grid;
          gap: 12px;
          margin-top: 14px;
        }
        .typeRow {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          border: 1px solid #d5e3f5;
          border-radius: 18px;
          padding: 16px;
          background: #fbfdff;
        }
        .typeRow h3 {
          margin: 4px 0;
          font-size: 20px;
        }
        .typeRow span {
          color: #5d6b83;
          font-weight: 750;
        }
        .rowActions strong {
          font-size: 24px;
          white-space: nowrap;
        }
        .dangerBtn {
          border-color: #ffc4c4;
          background: #fff0f0 !important;
          color: #b6121b !important;
        }
        .reportStrip {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          margin-top: 16px;
        }
        .reportStrip div {
          border: 1px solid #d5e3f5;
          border-radius: 18px;
          background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
          padding: 14px 16px;
        }
        .reportStrip span,
        .reportHeader span {
          display: block;
          color: #5d6b83;
          font-size: 11px;
          font-weight: 950;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .reportStrip strong {
          display: block;
          margin-top: 4px;
          color: #071225;
          font-size: 28px;
          line-height: 1;
        }
        .voucherList {
          display: grid;
          gap: 12px;
          margin-top: 14px;
        }
        .reportHeader {
          display: grid;
          grid-template-columns: 1.05fr 1.45fr 1.25fr 0.86fr;
          gap: 14px;
          padding: 0 8px;
        }
        .voucherRow {
          display: grid;
          grid-template-columns: 1.05fr 1.45fr 1.25fr 0.86fr;
          gap: 14px;
          align-items: start;
          border: 1px solid #d5e3f5;
          border-radius: 20px;
          padding: 18px;
          background: #fbfdff;
          box-shadow: 0 12px 28px rgba(39, 73, 118, 0.08);
        }
        .voucherRow.redeemed {
          border-color: #bdeacb;
          background: #f1fff6;
        }
        .guestCell,
        .ticketCell,
        .auditCell {
          min-width: 0;
        }
        .guestCell p {
          margin-bottom: 8px;
        }
        .voucherRow h3 {
          margin: 4px 0;
          color: #071225;
          font-size: 22px;
          line-height: 1.15;
        }
        .voucherRow strong {
          display: block;
          color: #071225;
          font-size: 22px;
          line-height: 1.15;
        }
        .voucherRow span {
          display: block;
          margin-top: 6px;
          font-size: 14px;
          line-height: 1.35;
        }
        .voucherRow small {
          display: block;
          margin-top: 8px;
          color: #08733d;
          font-size: 13px;
          line-height: 1.4;
        }
        .voucherRow small.itemBreakdown {
          color: #245deb;
          font-weight: 950;
          font-size: 14px;
        }
        .voucherRow small.auditBreakdown {
          color: #9b6428;
          background: #fff8e8;
          border: 1px solid #f3d6a3;
          border-radius: 12px;
          padding: 10px;
          line-height: 1.45;
        }
        .ticketChips {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 10px;
        }
        .ticketChips span {
          border-radius: 999px;
          border: 1px solid #bfd5f5;
          background: #eef5ff;
          color: #0d3d91;
          padding: 7px 10px;
          font-size: 12px;
          font-weight: 950;
        }
        .ticketChips span.used {
          border-color: #bdeacb;
          background: #eafff1;
          color: #04703a;
        }
        .rowActions {
          display: grid;
          justify-items: end;
          gap: 10px;
          align-content: start;
        }
        .rowActions span {
          border-radius: 999px;
          background: #eef4ff;
          color: #245deb;
          padding: 8px 12px;
          font-size: 12px;
          font-weight: 950;
          text-transform: uppercase;
          margin-top: 0;
        }
        .redeemed .rowActions span {
          background: #dff9e8;
          color: #04703a;
        }
        .empty {
          border: 1px dashed #c6d9ef;
          border-radius: 18px;
          padding: 24px;
          text-align: center;
          color: #5d6b83;
          font-weight: 900;
        }
        @media (max-width: 760px) {
          .hero,
          .listHead {
            align-items: stretch;
            flex-direction: column;
          }
          .voucherRow {
            grid-template-columns: 1fr;
            gap: 12px;
            padding: 14px;
            border-radius: 18px;
          }
          .reportHeader {
            display: none;
          }
          .reportStrip {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
          }
          .reportStrip div {
            padding: 12px;
            border-radius: 16px;
          }
          .reportStrip strong {
            font-size: 24px;
          }
          .voucherRow h3,
          .voucherRow strong {
            font-size: 20px;
          }
          .voucherRow span,
          .voucherRow small,
          .voucherRow small.itemBreakdown {
            font-size: 13px;
          }
          .stats {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
          }
          .stats div {
            padding: 12px;
            border-radius: 16px;
          }
          .stats span {
            font-size: 10px;
          }
          .stats strong {
            font-size: 26px;
          }
          .stats small {
            display: none;
          }
          .tabBar,
          .tabBar button {
            width: 100%;
          }
          .tabBar {
            grid-template-columns: 1fr;
          }
          .tabBar button {
            min-width: 0;
          }
          .typeEditor {
            grid-template-columns: 1fr;
          }
          .manualWorkflow {
            grid-template-columns: 1fr;
            grid-template-areas:
              "pick"
              "details"
              "checkout";
          }
          .manualCheckout {
            position: static;
          }
          .manualIssueGrid {
            grid-template-columns: 1fr;
          }
          .manualType {
            grid-template-columns: 1fr;
            align-items: stretch;
          }
          .manualType > strong {
            font-size: 20px;
          }
          .manualSummary {
            grid-template-columns: 1fr;
            flex-direction: column;
            align-items: stretch;
          }
          .manualSummary button {
            width: 100%;
            min-width: 0;
          }
          .filters input,
          .filters button,
          .manualRow button,
          .heroActions a,
          .heroActions button {
            width: 100%;
          }
          .rowActions {
            justify-items: stretch;
          }
          .rowActions button {
            width: 100%;
          }
          .scannerCard {
            padding: 12px;
          }
          .cameraFrame {
            min-height: 64vh;
            border-radius: 20px;
          }
          video {
            height: 64vh;
            min-height: 360px;
          }
          .scanGuide span {
            width: min(72vw, 280px);
            border-radius: 24px;
          }
        }
      `}</style>
    </main>
  );
}
