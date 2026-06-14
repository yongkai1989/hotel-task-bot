'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

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
      .map((item: any) => `${Number(item?.quantity || 1)}x ${String(item?.name || 'Breakfast Voucher')}`)
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
  const [activeTab, setActiveTab] = useState<'redeem' | 'types'>('redeem');
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
    return () => stopScanner();
  }, []);

  useEffect(() => {
    if (activeTab === 'types' && isSuperuser) loadTypes();
  }, [activeTab, isSuperuser]);

  async function loadProfile() {
    try {
      const token = await getToken();
      if (!token) throw new Error('Your login session is still loading. Please refresh once and try again.');

      const res = await fetch('/api/session-profile', {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      const role = String(json?.user?.role || '').trim().toUpperCase();
      setIsSuperuser(role === 'SUPERUSER');
    } catch {
      setIsSuperuser(false);
    }
  }

  async function loadTypes() {
    setTypesLoading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Your login session is still loading. Please refresh once and try again.');

      const res = await fetch('/api/restaurant-kiosk/voucher-types?admin=1', {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
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
      await loadTypes();
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
      await loadTypes();
    } catch (error: any) {
      setMessage(error?.message || 'Unable to delete voucher type');
      setTone('danger');
    }
  }

  function reprintTicket(voucher: Voucher) {
    if (!voucher.voucher_code) {
      setMessage('Voucher code is not ready yet.');
      setTone('danger');
      return;
    }

    const itemLines = Array.isArray(voucher.items_json) && voucher.items_json.length
      ? voucher.items_json
          .map((item: any) => `${Number(item?.quantity || 1)}x ${escapeHtml(item?.name || 'Breakfast Voucher')}`)
          .join('<br />')
      : `${voucher.voucher_quantity || 1}x Breakfast Voucher`;

    const printWindow = window.open('', '_blank', 'width=760,height=920');
    if (!printWindow) {
      setMessage('Popup blocked. Please allow popups to reprint ticket.');
      setTone('danger');
      return;
    }

    printWindow.document.write(`<!doctype html>
      <html>
        <head>
          <title>Breakfast Voucher ${escapeHtml(voucher.voucher_code)}</title>
          <style>
            body { margin: 0; background: #f7f2ea; color: #15120e; font-family: Arial, sans-serif; }
            .ticket { max-width: 680px; margin: 28px auto; padding: 34px; border: 1px solid #d9bd8c; border-radius: 28px; background: #fffdf8; text-align: center; }
            .brand { color: #9b6428; font-size: 12px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; }
            h1 { margin: 10px 0 18px; font-size: 42px; }
            img { width: 260px; height: 260px; border: 1px dashed #d9bd8c; border-radius: 24px; padding: 16px; background: #fffaf1; }
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
            <img src="${qrUrl(voucher.voucher_code)}" alt="Breakfast voucher QR" />
            <div class="code">${escapeHtml(voucher.voucher_code)}</div>
            <div class="grid">
              <div class="box"><small>Room</small><b>${escapeHtml(voucher.room_number || '-')}</b></div>
              <div class="box"><small>Quantity</small><b>${voucher.voucher_quantity || 1}</b></div>
              <div class="box"><small>Total</small><b>${money(voucher.total_myr)}</b></div>
              <div class="box"><small>Paid</small><b>${escapeHtml(formatTime(voucher.paid_at))}</b></div>
            </div>
            <div class="items">${itemLines}</div>
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

      setMessage(`Voucher redeemed for ${json.voucher?.guest_name || 'guest'} (${json.voucher?.voucher_code || voucherCode})`);
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

  return (
    <main className="page">
      <section className="hero">
        <div>
          <p>Restaurant Kiosk</p>
          <h1>Breakfast Vouchers</h1>
          <span>Scan, redeem, or manually verify paid breakfast tickets.</span>
        </div>
        <div className="heroActions">
          <button type="button" onClick={load}>Refresh</button>
          <Link href="/dashboard">Back</Link>
        </div>
      </section>

      <section className="stats">
        <div><span>Paid</span><strong>{paidCount}</strong></div>
        <div><span>Redeemed</span><strong>{redeemedCount}</strong></div>
        <div><span>Pending use</span><strong>{Math.max(0, paidCount - redeemedCount)}</strong></div>
      </section>

      <section className="tabBar">
        <button className={activeTab === 'redeem' ? 'active' : ''} type="button" onClick={() => setActiveTab('redeem')}>
          Scan & Redeem
        </button>
        {isSuperuser ? (
          <button className={activeTab === 'types' ? 'active' : ''} type="button" onClick={() => setActiveTab('types')}>
            Voucher Types
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
            <p>Paid voucher records</p>
            <h2>Lookup by date or room</h2>
          </div>
          <div className="filters">
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            <input value={room} onChange={(event) => setRoom(event.target.value)} placeholder="Room search" />
            <button type="button" onClick={load}>Search</button>
          </div>
        </div>

        <div className="voucherList">
          {loading ? <div className="empty">Loading vouchers...</div> : null}
          {!loading && !vouchers.length ? <div className="empty">No breakfast vouchers found for this date.</div> : null}
          {vouchers.map((voucher) => (
            <article className={`voucherRow ${isRedeemed(voucher) ? 'redeemed' : ''}`} key={voucher.id}>
              <div>
                <p>{voucher.voucher_code || 'Code pending'}</p>
                <h3>Room {voucher.room_number || '-'} - {voucher.guest_name || '-'}</h3>
                <span>{voucher.voucher_quantity || 1} voucher(s) - {money(voucher.total_myr)} - Paid {formatTime(voucher.paid_at)}</span>
                <small className="itemBreakdown">{voucherItemText(voucher)}</small>
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
              </div>
            </article>
          ))}
        </div>
      </section>
        </>
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
        .tabBar {
          display: inline-flex;
          gap: 8px;
          margin: 0 0 14px;
          padding: 6px;
          border: 1px solid #cfe0f6;
          border-radius: 18px;
          background: #eaf3ff;
        }
        .tabBar button {
          border: 0;
          background: transparent;
        }
        .tabBar button.active {
          background: #245deb;
          color: #fff;
          box-shadow: 0 12px 26px rgba(36, 93, 235, 0.22);
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
        .voucherList {
          display: grid;
          gap: 12px;
          margin-top: 14px;
        }
        .voucherRow {
          display: flex;
          justify-content: space-between;
          gap: 14px;
          border: 1px solid #d5e3f5;
          border-radius: 18px;
          padding: 16px;
          background: #fbfdff;
        }
        .voucherRow.redeemed {
          border-color: #bdeacb;
          background: #f1fff6;
        }
        .voucherRow h3 {
          margin: 4px 0;
          font-size: 19px;
        }
        .voucherRow small {
          display: block;
          margin-top: 8px;
          color: #08733d;
        }
        .voucherRow small.itemBreakdown {
          color: #245deb;
          font-weight: 950;
        }
        .rowActions {
          display: grid;
          justify-items: end;
          gap: 10px;
          align-content: center;
        }
        .rowActions span {
          border-radius: 999px;
          background: #eef4ff;
          color: #245deb;
          padding: 8px 12px;
          font-size: 12px;
          font-weight: 950;
          text-transform: uppercase;
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
          .voucherRow,
          .listHead {
            align-items: stretch;
            flex-direction: column;
          }
          .stats {
            grid-template-columns: 1fr;
          }
          .tabBar,
          .tabBar button {
            width: 100%;
          }
          .typeEditor {
            grid-template-columns: 1fr;
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
