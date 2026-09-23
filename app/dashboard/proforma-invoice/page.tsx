'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

type UserRole = 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT';
type Profile = { user_id: string; email: string; name: string; role: UserRole };
type Tab = 'CREATE' | 'SUMMARY' | 'CLIENTS';
type EditMode = 'NEW' | 'EDIT' | 'AMEND';
type InvoiceStatus = 'ISSUED' | 'CHECKED_IN' | 'DECLINED';
type RateBand = 'weekday' | 'weekend' | 'peak';

type ClientProfile = {
  id: number;
  company_name: string;
  address: string;
  contact_person: string;
  contact_number: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type RoomCatalogItem = {
  id: string;
  label: string;
  description: string;
  breakfast: string;
  kind: 'ROOM' | 'ADDON';
  rates: Record<RateBand, number>;
};

type InvoiceLine = {
  id: string;
  catalog_id: string;
  quantity: number;
  foc: boolean;
  custom_rate: number | null;
};

type InvoiceRecord = {
  id: number;
  invoice_number: string;
  client_id: number;
  client_company_name: string;
  client_address: string;
  client_contact_person: string;
  client_contact_number: string;
  proforma_date: string;
  check_in_date: string;
  check_out_date: string;
  stay_nights: number;
  tour_code: string | null;
  line_items: InvoiceLine[];
  total_room_count: number;
  total_room_nights: number;
  grand_total: number;
  deposit_paid: number;
  payments_received: number;
  balance_outstanding: number;
  status: InvoiceStatus;
  amendment_no: number;
  amendment_date: string | null;
  amendment_note: string | null;
  checked_in_at: string | null;
  declined_at: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

type PaymentRecord = {
  id: number;
  invoice_id: number;
  amount: number;
  transaction_id: string;
  payment_date: string;
  created_by_name: string | null;
  created_at: string;
};

type ExpandedLine = {
  description: string;
  rateLabel: string;
  nights: number;
  quantity: number;
  unitRate: number;
  subtotal: number;
  foc: boolean;
};

const HOTEL = {
  name: 'Hallmark Crown Hotel',
  address: '170 & 172 Jalan Parameswara, 75000 Melaka, Malaysia',
  telephone: '+606-281-8555',
  fax: '+606-286-6855',
  website: 'www.hotelhallmark.com',
  email: 'reservation.crown@hotelhallmark.com',
};

const BANK = {
  name: 'Public Bank Berhad',
  branch: 'Taman Melaka Raya Branch (Melaka)',
  account: '3179775528',
  holder: 'Hotel Hallmark Leisure Sdn. Bhd.',
  swift: 'PBBEMYKL',
};

const ROOM_CATALOG: RoomCatalogItem[] = [
  {
    id: 'twin-double',
    label: 'Twin / Double Room',
    description: '2 Super Single Beds / 1 Queen Bed',
    breakfast: '2 Breakfast',
    kind: 'ROOM',
    rates: { weekday: 100, weekend: 125, peak: 185 },
  },
  {
    id: 'triple',
    label: 'Triple Room',
    description: '1 Super Single Bed + 1 Queen Bed',
    breakfast: '3 Breakfast',
    kind: 'ROOM',
    rates: { weekday: 160, weekend: 215, peak: 265 },
  },
  {
    id: 'family',
    label: 'Family Room',
    description: '2 Super Single Beds + 1 Queen Bed',
    breakfast: '4 Breakfast',
    kind: 'ROOM',
    rates: { weekday: 215, weekend: 290, peak: 380 },
  },
  {
    id: 'premier-family',
    label: 'Premier Family Room',
    description: '3 Super Single Beds + 1 Queen Bed',
    breakfast: '5 Breakfast',
    kind: 'ROOM',
    rates: { weekday: 245, weekend: 320, peak: 420 },
  },
  {
    id: 'tour-guide-twin-double',
    label: 'Tour Guide Additional Room Twin / Double',
    description: 'With Group',
    breakfast: '2 Breakfast',
    kind: 'ROOM',
    rates: { weekday: 90, weekend: 100, peak: 120 },
  },
  {
    id: 'additional-person',
    label: 'Additional Person',
    description: 'Inclusive Extra Bed',
    breakfast: '1 Breakfast',
    kind: 'ADDON',
    rates: { weekday: 60, weekend: 60, peak: 60 },
  },
];

const PEAK_DATES = new Set([
  '2026-01-01',
  '2026-01-31', '2026-02-01',
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21',
  '2026-03-07',
  '2026-03-20', '2026-03-21', '2026-03-22', '2026-03-23',
  '2026-04-30', '2026-05-01', '2026-05-02',
  '2026-05-30', '2026-05-31',
  '2026-06-01',
  '2026-08-29', '2026-08-30',
  '2026-11-07', '2026-11-08',
  '2026-12-24', '2026-12-25', '2026-12-26',
  '2026-12-31', '2027-01-01', '2027-01-02',
]);

const PEAK_PERIOD_LABEL =
  '2026 peak dates: 1 Jan; 31 Jan-1 Feb; 16-21 Feb; 7 Mar; 20-23 Mar; 30 Apr-2 May; 30 May-1 Jun; 29-30 Aug; 7-8 Nov; 24-26 Dec; 31 Dec 2026-2 Jan 2027.';

const NOTES = [
  'Room Charges include 8% SST, 10% Service Charge and RM 4 Heritage Tax.',
  'TTX Not Included.',
  'Includes Morning Buffet Breakfast and Unlimited WiFi.',
  'Price and number of FOC rooms are strictly confidential.',
  'Should Deluxe Twin be unavailable, we will offer a higher category to replace (Triple / Quad Room).',
];

function getSupabaseSafe() {
  if (typeof window === 'undefined') return null;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  return createBrowserSupabaseClient();
}

function canAccess(profile: Profile | null) {
  if (!profile) return false;
  const email = profile.email.toLowerCase();
  return (
    profile.role === 'SUPERUSER' ||
    profile.role === 'MANAGER' ||
    profile.role === 'FO' ||
    email === 'fenny@hotelhallmark.com' ||
    email === 'walter@hotelhallmark.com'
  );
}

function singaporeDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateValue: string, days: number) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function dateDiff(checkIn: string, checkOut: string) {
  if (!checkIn || !checkOut) return 0;
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function stayDates(checkIn: string, checkOut: string) {
  const nights = dateDiff(checkIn, checkOut);
  return Array.from({ length: nights }, (_, index) => addDays(checkIn, index));
}

function rateBandForDate(dateValue: string): RateBand {
  if (PEAK_DATES.has(dateValue)) return 'peak';
  const [year, month, day] = dateValue.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 5 || weekday === 6 ? 'weekend' : 'weekday';
}

function catalogItem(id: string) {
  return ROOM_CATALOG.find((item) => item.id === id) || ROOM_CATALOG[0];
}

function expandLines(lines: InvoiceLine[], checkIn: string, checkOut: string): ExpandedLine[] {
  const dates = stayDates(checkIn, checkOut);
  return lines.flatMap((line) => {
    const item = catalogItem(line.catalog_id);
    const counts: Record<RateBand, number> = { weekday: 0, weekend: 0, peak: 0 };
    for (const date of dates) counts[rateBandForDate(date)] += 1;
    return (Object.keys(counts) as RateBand[])
      .filter((band) => counts[band] > 0)
      .map((band) => {
        const unitRate = line.foc ? 0 : line.custom_rate ?? item.rates[band];
        return {
          description: `${item.label}${line.foc ? ' (FOC)' : ''}`,
          rateLabel: line.foc
            ? 'FOC'
            : line.custom_rate !== null
              ? 'Agreed Rate'
              : `${band === 'peak' ? 'Peak Season' : band === 'weekend' ? 'Weekend' : 'Weekday'} - ${item.breakfast}`,
          nights: counts[band],
          quantity: Math.max(1, Number(line.quantity || 1)),
          unitRate,
          subtotal: unitRate * counts[band] * Math.max(1, Number(line.quantity || 1)),
          foc: line.foc,
        };
      });
  });
}

function calculateTotals(lines: InvoiceLine[], checkIn: string, checkOut: string) {
  const nights = dateDiff(checkIn, checkOut);
  const expanded = expandLines(lines, checkIn, checkOut);
  const roomCount = lines.reduce((total, line) => {
    return catalogItem(line.catalog_id).kind === 'ROOM' ? total + Math.max(1, Number(line.quantity || 1)) : total;
  }, 0);
  return {
    nights,
    expanded,
    roomCount,
    roomNights: roomCount * nights,
    grandTotal: expanded.reduce((total, line) => total + line.subtotal, 0),
  };
}

function money(value: number | string | null | undefined) {
  return `RM ${Number(value || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

function parseStoredLines(value: unknown): InvoiceLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw: any) => ({
    id: String(raw?.id || crypto.randomUUID()),
    catalog_id: String(raw?.catalog_id || 'twin-double'),
    quantity: Math.max(1, Number(raw?.quantity || 1)),
    foc: raw?.foc === true,
    custom_rate: raw?.custom_rate === null || raw?.custom_rate === undefined || raw?.custom_rate === ''
      ? null
      : Math.max(0, Number(raw.custom_rate)),
  }));
}

async function logoDataUrl() {
  const response = await fetch('/logo.png', { cache: 'force-cache' });
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function safeFilename(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '');
}

function drawLetterhead(doc: any, logo: string) {
  doc.addImage(logo, 'PNG', 18, 10, 29, 29);
  doc.setTextColor(31, 41, 55);
  doc.setFont('times', 'bold');
  doc.setFontSize(18);
  doc.text(HOTEL.name, 105, 17, { align: 'center' });
  doc.setFont('times', 'normal');
  doc.setFontSize(9.2);
  doc.text(`Add: ${HOTEL.address}`, 105, 23, { align: 'center' });
  doc.text(`Tel: ${HOTEL.telephone}  |  Fax: ${HOTEL.fax}`, 105, 28, { align: 'center' });
  doc.text(`Website: ${HOTEL.website}  |  Email: ${HOTEL.email}`, 105, 33, { align: 'center' });
  doc.setDrawColor(126, 82, 40);
  doc.setLineWidth(0.6);
  doc.line(18, 39, 192, 39);
}

async function downloadInvoicePdf(invoice: InvoiceRecord, preparedBy: string) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const logo = await logoDataUrl();
  const expanded = expandLines(parseStoredLines(invoice.line_items), invoice.check_in_date, invoice.check_out_date);
  const left = 18;
  const right = 192;
  const contentWidth = right - left;
  let y = 45;

  const addPage = () => {
    doc.addPage();
    drawLetterhead(doc, logo);
    y = 45;
  };

  drawLetterhead(doc, logo);
  doc.setTextColor(17, 24, 39);
  doc.setFont('times', 'bold');
  doc.setFontSize(16);
  doc.text('PROFORMA INVOICE', 105, y, { align: 'center' });
  y += 8;
  doc.setFontSize(9.5);
  doc.text(`Invoice No: ${invoice.invoice_number}`, left, y);
  doc.text(`Dated: ${formatDate(invoice.proforma_date).replace(/, \w+$/, '')}`, right, y, { align: 'right' });
  y += 5;
  if (invoice.amendment_no > 0 && invoice.amendment_date) {
    doc.setTextColor(169, 91, 24);
    doc.text(`AMENDMENT ${invoice.amendment_no} - ${formatDate(invoice.amendment_date).replace(/, \w+$/, '')}`, right, y, { align: 'right' });
    y += 5;
    doc.setTextColor(17, 24, 39);
  }
  if (invoice.tour_code) {
    doc.text(`Tour Code: ${invoice.tour_code}`, left, y);
    y += 5;
  }

  doc.setFont('times', 'normal');
  doc.setFontSize(10.5);
  doc.text(invoice.client_company_name, left, y);
  y += 5;
  for (const line of doc.splitTextToSize(invoice.client_address || '', 90)) {
    doc.text(line, left, y);
    y += 4.5;
  }
  doc.text(`Attn: ${invoice.client_contact_person}`, left, y);
  y += 4.5;
  doc.text(`Contact: ${invoice.client_contact_number}`, left, y);
  y += 8;
  doc.text(`Dear ${invoice.client_contact_person},`, left, y);
  y += 8;
  doc.setFont('times', 'bold');
  doc.text('Room Reservation', left, y);
  y += 5;
  doc.setFont('times', 'normal');
  doc.text(`Check In: ${formatDate(invoice.check_in_date)}`, left, y);
  y += 5;
  doc.text(`Check Out: ${formatDate(invoice.check_out_date)}`, left, y);
  y += 5;
  doc.text(`No. of Nights: ${invoice.stay_nights} Night${invoice.stay_nights === 1 ? '' : 's'}`, left, y);
  y += 8;

  const widths = [64, 19, 26, 31, 34];
  const headers = ['Rate Schedule / Room Category', 'Nights', 'Quantity', 'Unit Price', 'Subtotal'];
  const drawTableHeader = () => {
    doc.setFillColor(244, 238, 229);
    doc.setDrawColor(80, 80, 80);
    doc.rect(left, y, contentWidth, 10, 'FD');
    doc.setFont('times', 'bold');
    doc.setFontSize(8.3);
    let x = left;
    headers.forEach((header, index) => {
      if (index) doc.line(x, y, x, y + 10);
      doc.text(header, x + widths[index] / 2, y + 6.2, { align: 'center' });
      x += widths[index];
    });
    y += 10;
  };
  drawTableHeader();

  for (const line of expanded) {
    if (y > 235) {
      addPage();
      drawTableHeader();
    }
    const rowHeight = 13;
    doc.rect(left, y, contentWidth, rowHeight);
    let x = left;
    widths.slice(0, -1).forEach((width) => {
      x += width;
      doc.line(x, y, x, y + rowHeight);
    });
    doc.setFont('times', 'normal');
    doc.setFontSize(8.5);
    doc.text(line.description, left + 2, y + 4.5);
    doc.setFontSize(7.5);
    doc.text(line.rateLabel, left + 2, y + 9.2);
    let cellX = left + widths[0];
    doc.setFontSize(8.7);
    doc.text(String(line.nights), cellX + widths[1] / 2, y + 7.2, { align: 'center' });
    cellX += widths[1];
    doc.text(String(line.quantity), cellX + widths[2] / 2, y + 7.2, { align: 'center' });
    cellX += widths[2];
    doc.text(money(line.unitRate), cellX + widths[3] / 2, y + 7.2, { align: 'center' });
    cellX += widths[3];
    doc.text(money(line.subtotal), cellX + widths[4] - 2, y + 7.2, { align: 'right' });
    y += rowHeight;
  }

  doc.setFont('times', 'bold');
  doc.setFontSize(9.5);
  doc.rect(left, y, contentWidth, 9);
  doc.text(`Total: ${invoice.total_room_count} Room${invoice.total_room_count === 1 ? '' : 's'} / ${invoice.total_room_nights} Room Nights`, left + 2, y + 6);
  y += 9;
  const totalRows = [
    ['Grand Total', money(invoice.grand_total)],
    ['Less: Deposit Paid', money(invoice.deposit_paid)],
    ['Balance Payable Before Check-In', money(Number(invoice.grand_total) - Number(invoice.deposit_paid))],
  ];
  totalRows.forEach(([label, value], index) => {
    doc.setFillColor(index === 2 ? 236 : 250, index === 2 ? 245 : 250, index === 2 ? 255 : 250);
    doc.rect(left + 70, y, contentWidth - 70, 8, 'FD');
    doc.text(label, left + 72, y + 5.5);
    doc.text(value, right - 2, y + 5.5, { align: 'right' });
    y += 8;
  });

  if (y > 214) addPage();
  y += 4;
  doc.setFont('times', 'normal');
  doc.setFontSize(8.8);
  NOTES.forEach((note) => {
    const wrapped = doc.splitTextToSize(`* ${note}`, contentWidth);
    doc.text(wrapped, left, y);
    y += wrapped.length * 4.2;
  });
  if (invoice.amendment_note) {
    doc.setTextColor(169, 91, 24);
    const wrapped = doc.splitTextToSize(`Amendment note: ${invoice.amendment_note}`, contentWidth);
    doc.text(wrapped, left, y);
    y += wrapped.length * 4.2;
    doc.setTextColor(17, 24, 39);
  }

  if (y > 240) addPage();
  y += 4;
  doc.setFont('times', 'bolditalic');
  doc.setFontSize(10);
  doc.text('Company Bank Account Information:', left, y);
  y += 5;
  doc.setFont('times', 'normal');
  doc.setFontSize(9.2);
  doc.text(`Name of Bank: ${BANK.name}`, left, y); y += 4.5;
  doc.text(`Bank Branch: ${BANK.branch}`, left, y); y += 4.5;
  doc.text(`Account No: ${BANK.account}`, left, y); y += 4.5;
  doc.text(`Account Holder's Name: ${BANK.holder}`, left, y); y += 4.5;
  doc.text(`SWIFT CODE: ${BANK.swift}`, left, y); y += 7;
  doc.text('Should you have any enquiries, please do not hesitate to contact us.', left, y);
  y += 10;
  if (y > 270) addPage();
  doc.text('Thank you.', left, y); y += 5;
  doc.text('Yours faithfully,', left, y);
  doc.text('Confirmed By:', 142, y);
  y += 14;
  doc.line(left, y, 70, y);
  doc.line(142, y, right, y);
  y += 4;
  doc.text(preparedBy || 'Front Office', left, y);
  doc.text('Sign & Company Stamp', 142, y);

  doc.save(`${safeFilename(invoice.invoice_number)}-${safeFilename(invoice.client_company_name)}.pdf`);
}

async function downloadStatementPdf(invoice: InvoiceRecord, payments: PaymentRecord[]) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const logo = await logoDataUrl();
  drawLetterhead(doc, logo);
  let y = 47;
  doc.setFont('times', 'bold');
  doc.setFontSize(16);
  doc.text('STATEMENT OF ACCOUNT', 105, y, { align: 'center' });
  y += 10;
  doc.setFontSize(10);
  doc.text(invoice.client_company_name, 18, y);
  doc.text(`Invoice: ${invoice.invoice_number}`, 192, y, { align: 'right' });
  y += 5;
  doc.setFont('times', 'normal');
  doc.text(`Contact: ${invoice.client_contact_person} (${invoice.client_contact_number})`, 18, y);
  y += 9;
  const rows: Array<[string, string, number]> = [
    [invoice.proforma_date, `Proforma Invoice ${invoice.invoice_number}`, Number(invoice.grand_total)],
    [invoice.proforma_date, 'Deposit Paid', -Number(invoice.deposit_paid)],
    ...payments.map((payment) => [payment.payment_date, `Payment - ${payment.transaction_id}`, -Number(payment.amount)] as [string, string, number]),
  ];
  doc.setFillColor(244, 238, 229);
  doc.rect(18, y, 174, 9, 'FD');
  doc.text('Date', 20, y + 6);
  doc.text('Description', 55, y + 6);
  doc.text('Debit / (Credit)', 190, y + 6, { align: 'right' });
  y += 9;
  rows.forEach((row) => {
    doc.rect(18, y, 174, 9);
    doc.text(row[0], 20, y + 6);
    doc.text(row[1], 55, y + 6);
    doc.text(row[2] < 0 ? `(${money(Math.abs(row[2]))})` : money(row[2]), 190, y + 6, { align: 'right' });
    y += 9;
  });
  doc.setFont('times', 'bold');
  doc.rect(105, y, 87, 10, 'FD');
  doc.text('Outstanding Balance', 108, y + 6.5);
  doc.text(money(invoice.balance_outstanding), 190, y + 6.5, { align: 'right' });
  y += 18;
  doc.setFont('times', 'normal');
  doc.text('This statement is computer generated from the Hallmark Crown Hotel Front Office records.', 18, y);
  doc.save(`SOA-${safeFilename(invoice.invoice_number)}-${safeFilename(invoice.client_company_name)}.pdf`);
}

function blankLine(): InvoiceLine {
  return { id: crypto.randomUUID(), catalog_id: 'twin-double', quantity: 1, foc: false, custom_rate: null };
}

export default function ProformaInvoicePage() {
  const supabase = useMemo(() => getSupabaseSafe(), []);
  const today = useMemo(() => singaporeDate(), []);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>('CREATE');
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [editMode, setEditMode] = useState<EditMode>('NEW');
  const [editingInvoiceId, setEditingInvoiceId] = useState<number | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<number | ''>('');
  const [proformaDate, setProformaDate] = useState(today);
  const [checkIn, setCheckIn] = useState(today);
  const [checkOut, setCheckOut] = useState(addDays(today, 1));
  const [tourCode, setTourCode] = useState('');
  const [lines, setLines] = useState<InvoiceLine[]>([blankLine()]);
  const [depositPaid, setDepositPaid] = useState(0);
  const [amendmentNote, setAmendmentNote] = useState('');
  const [clientModal, setClientModal] = useState<ClientProfile | 'NEW' | null>(null);
  const [clientDraft, setClientDraft] = useState({ company_name: '', address: '', contact_person: '', contact_number: '' });
  const [detailInvoice, setDetailInvoice] = useState<InvoiceRecord | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<InvoiceRecord | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [statementInvoice, setStatementInvoice] = useState<InvoiceRecord | null>(null);
  const [statementPayments, setStatementPayments] = useState<PaymentRecord[]>([]);
  const [statementLoading, setStatementLoading] = useState(false);

  const totals = useMemo(() => calculateTotals(lines, checkIn, checkOut), [lines, checkIn, checkOut]);
  const selectedClient = clients.find((client) => client.id === Number(selectedClientId)) || null;
  const balanceBeforeCheckIn = Math.max(0, totals.grandTotal - Number(depositPaid || 0));
  const filteredInvoices = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return invoices;
    return invoices.filter((invoice) =>
      [invoice.invoice_number, invoice.client_company_name, invoice.client_contact_person, invoice.tour_code]
        .some((value) => String(value || '').toLowerCase().includes(query))
    );
  }, [invoices, search]);
  const filteredClients = useMemo(() => {
    const query = clientSearch.trim().toLowerCase();
    if (!query) return clients;
    return clients.filter((client) =>
      [client.company_name, client.contact_person, client.contact_number]
        .some((value) => value.toLowerCase().includes(query))
    );
  }, [clients, clientSearch]);

  async function loadData() {
    if (!supabase) return;
    const [clientResult, invoiceResult] = await Promise.all([
      supabase
        .from('proforma_clients')
        .select('id, company_name, address, contact_person, contact_number, active, created_at, updated_at')
        .eq('active', true)
        .order('company_name', { ascending: true })
        .limit(500),
      supabase
        .from('proforma_invoices')
        .select('*')
        .order('proforma_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500),
    ]);
    if (clientResult.error) throw clientResult.error;
    if (invoiceResult.error) throw invoiceResult.error;
    setClients((clientResult.data || []) as ClientProfile[]);
    setInvoices((invoiceResult.data || []).map((row: any) => ({
      ...row,
      line_items: parseStoredLines(row.line_items),
      grand_total: Number(row.grand_total || 0),
      deposit_paid: Number(row.deposit_paid || 0),
      payments_received: Number(row.payments_received || 0),
      balance_outstanding: Number(row.balance_outstanding || 0),
    })) as InvoiceRecord[]);
  }

  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      try {
        if (!supabase) throw new Error('Supabase is not configured.');
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!sessionData.session?.user) return;
        const { data, error: profileError } = await supabase
          .from('user_profiles')
          .select('user_id, email, name, role')
          .eq('user_id', sessionData.session.user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!mounted) return;
        const nextProfile: Profile = {
          user_id: sessionData.session.user.id,
          email: data?.email || sessionData.session.user.email || '',
          name: data?.name || sessionData.session.user.email || 'Front Office',
          role: (data?.role || 'FO') as UserRole,
        };
        setProfile(nextProfile);
        if (canAccess(nextProfile)) await loadData();
      } catch (err: any) {
        if (mounted) setError(err?.message || 'Unable to load Proforma Invoice.');
      } finally {
        if (mounted) {
          setAuthLoading(false);
          setLoading(false);
        }
      }
    }
    void bootstrap();
    return () => { mounted = false; };
  }, [supabase]);

  function resetForm() {
    setEditMode('NEW');
    setEditingInvoiceId(null);
    setSelectedClientId('');
    setProformaDate(today);
    setCheckIn(today);
    setCheckOut(addDays(today, 1));
    setTourCode('');
    setLines([blankLine()]);
    setDepositPaid(0);
    setAmendmentNote('');
    setError('');
  }

  function openClientModal(client: ClientProfile | 'NEW') {
    setClientModal(client);
    setClientDraft(client === 'NEW'
      ? { company_name: '', address: '', contact_person: '', contact_number: '' }
      : {
          company_name: client.company_name,
          address: client.address,
          contact_person: client.contact_person,
          contact_number: client.contact_number,
        });
  }

  async function saveClient() {
    if (!supabase || !profile || !clientModal) return;
    if (!clientDraft.company_name.trim() || !clientDraft.address.trim() || !clientDraft.contact_person.trim() || !clientDraft.contact_number.trim()) {
      setError('Company/client name, address, contact person and contact number are required.');
      return;
    }
    try {
      setSaving(true);
      setError('');
      const payload = {
        company_name: clientDraft.company_name.trim(),
        address: clientDraft.address.trim(),
        contact_person: clientDraft.contact_person.trim(),
        contact_number: clientDraft.contact_number.trim(),
        created_by_name: profile.name,
        updated_at: new Date().toISOString(),
      };
      const result = clientModal === 'NEW'
        ? await supabase.from('proforma_clients').insert(payload).select().single()
        : await supabase.from('proforma_clients').update(payload).eq('id', clientModal.id).select().single();
      if (result.error) throw result.error;
      await loadData();
      setSelectedClientId(Number(result.data.id));
      setClientModal(null);
      setMessage(clientModal === 'NEW' ? 'Client profile created.' : 'Client profile updated.');
    } catch (err: any) {
      setError(err?.message || 'Unable to save client profile.');
    } finally {
      setSaving(false);
    }
  }

  function updateLine(id: string, patch: Partial<InvoiceLine>) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));
  }

  function invoicePayload() {
    if (!profile || !selectedClient) throw new Error('Select a company/client profile.');
    if (totals.nights <= 0) throw new Error('Check-out date must be after check-in date.');
    if (!lines.length) throw new Error('Add at least one room or charge line.');
    if (Number(depositPaid || 0) < 0 || Number(depositPaid || 0) > totals.grandTotal) {
      throw new Error('Deposit paid cannot be more than the grand total.');
    }
    return {
      client_id: selectedClient.id,
      client_company_name: selectedClient.company_name,
      client_address: selectedClient.address,
      client_contact_person: selectedClient.contact_person,
      client_contact_number: selectedClient.contact_number,
      check_in_date: checkIn,
      check_out_date: checkOut,
      stay_nights: totals.nights,
      tour_code: tourCode.trim() || null,
      line_items: lines.map((line) => ({
        ...line,
        quantity: Math.max(1, Number(line.quantity || 1)),
        custom_rate: line.custom_rate === null ? null : Math.max(0, Number(line.custom_rate || 0)),
      })),
      total_room_count: totals.roomCount,
      total_room_nights: totals.roomNights,
      grand_total: totals.grandTotal,
      deposit_paid: Number(depositPaid || 0),
      updated_by_user_id: profile.user_id,
      updated_by_name: profile.name,
      updated_at: new Date().toISOString(),
    };
  }

  async function saveInvoice() {
    if (!supabase || !profile) return;
    try {
      setSaving(true);
      setError('');
      setMessage('');
      const payload = invoicePayload();
      let saved: any;
      if (editMode === 'NEW') {
        const { data, error: insertError } = await supabase
          .from('proforma_invoices')
          .insert({ ...payload, proforma_date: proformaDate, created_by_user_id: profile.user_id, created_by_name: profile.name })
          .select()
          .single();
        if (insertError) throw insertError;
        saved = data;
      } else if (editMode === 'EDIT') {
        const { data, error: updateError } = await supabase
          .from('proforma_invoices')
          .update(payload)
          .eq('id', editingInvoiceId)
          .select()
          .single();
        if (updateError) throw updateError;
        saved = data;
      } else {
        if (!amendmentNote.trim()) throw new Error('Enter the customer-requested amendment reason.');
        const { data, error: amendError } = await supabase.rpc('amend_proforma_invoice', {
          p_invoice_id: editingInvoiceId,
          p_client_id: payload.client_id,
          p_client_company_name: payload.client_company_name,
          p_client_address: payload.client_address,
          p_client_contact_person: payload.client_contact_person,
          p_client_contact_number: payload.client_contact_number,
          p_check_in_date: payload.check_in_date,
          p_check_out_date: payload.check_out_date,
          p_stay_nights: payload.stay_nights,
          p_tour_code: payload.tour_code,
          p_line_items: payload.line_items,
          p_total_room_count: payload.total_room_count,
          p_total_room_nights: payload.total_room_nights,
          p_grand_total: payload.grand_total,
          p_deposit_paid: payload.deposit_paid,
          p_amendment_note: amendmentNote.trim(),
          p_amended_by_name: profile.name,
        });
        if (amendError) throw amendError;
        saved = Array.isArray(data) ? data[0] : data;
      }
      await loadData();
      setMessage(`${saved?.invoice_number || 'Proforma invoice'} saved successfully.`);
      resetForm();
      setTab('SUMMARY');
    } catch (err: any) {
      setError(err?.message || 'Unable to save proforma invoice.');
    } finally {
      setSaving(false);
    }
  }

  function editInvoice(invoice: InvoiceRecord, mode: EditMode) {
    setEditMode(mode);
    setEditingInvoiceId(invoice.id);
    setSelectedClientId(invoice.client_id);
    setProformaDate(invoice.proforma_date);
    setCheckIn(invoice.check_in_date);
    setCheckOut(invoice.check_out_date);
    setTourCode(invoice.tour_code || '');
    setLines(parseStoredLines(invoice.line_items));
    setDepositPaid(Number(invoice.deposit_paid || 0));
    setAmendmentNote('');
    setDetailInvoice(null);
    setTab('CREATE');
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function updateInvoiceStatus(invoice: InvoiceRecord, status: InvoiceStatus) {
    if (!supabase || !profile) return;
    try {
      setStatusBusy(true);
      setError('');
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('proforma_invoices')
        .update({
          status,
          checked_in_at: status === 'CHECKED_IN' ? now : null,
          declined_at: status === 'DECLINED' ? now : null,
          updated_by_user_id: profile.user_id,
          updated_by_name: profile.name,
          updated_at: now,
        })
        .eq('id', invoice.id);
      if (updateError) throw updateError;
      await loadData();
      setDetailInvoice(null);
      setMessage(`${invoice.invoice_number} marked as ${status === 'CHECKED_IN' ? 'checked in' : status.toLowerCase()}.`);
    } catch (err: any) {
      setError(err?.message || 'Unable to update invoice status.');
    } finally {
      setStatusBusy(false);
    }
  }

  function openPayment(invoice: InvoiceRecord) {
    setPaymentInvoice(invoice);
    setPaymentAmount(Number(invoice.balance_outstanding).toFixed(2));
    setTransactionId('');
    setDetailInvoice(null);
  }

  async function recordPayment() {
    if (!supabase || !profile || !paymentInvoice) return;
    try {
      setSaving(true);
      setError('');
      const amount = Number(paymentAmount);
      if (!transactionId.trim()) throw new Error('Transaction ID is required.');
      if (!(amount > 0)) throw new Error('Payment amount must be greater than zero.');
      const { error: paymentError } = await supabase.rpc('record_proforma_payment', {
        p_invoice_id: paymentInvoice.id,
        p_amount: amount,
        p_transaction_id: transactionId.trim(),
        p_entered_by_name: profile.name,
      });
      if (paymentError) throw paymentError;
      await loadData();
      setPaymentInvoice(null);
      setMessage(`Payment recorded for ${paymentInvoice.invoice_number}.`);
    } catch (err: any) {
      setError(err?.message || 'Unable to record payment.');
    } finally {
      setSaving(false);
    }
  }

  async function openStatement(invoice: InvoiceRecord) {
    if (!supabase) return;
    try {
      setStatementLoading(true);
      setError('');
      const { data, error: paymentError } = await supabase
        .from('proforma_payments')
        .select('id, invoice_id, amount, transaction_id, payment_date, created_by_name, created_at')
        .eq('invoice_id', invoice.id)
        .order('payment_date', { ascending: true })
        .order('created_at', { ascending: true });
      if (paymentError) throw paymentError;
      setStatementInvoice(invoice);
      setStatementPayments((data || []).map((payment: any) => ({ ...payment, amount: Number(payment.amount || 0) })));
      setDetailInvoice(null);
    } catch (err: any) {
      setError(err?.message || 'Unable to load statement of account.');
    } finally {
      setStatementLoading(false);
    }
  }

  if (authLoading || loading) return <main className={styles.page}><div className={styles.stateCard}>Opening Proforma Invoice...</div></main>;
  if (!profile) return <main className={styles.page}><div className={styles.stateCard}><h1>Login required</h1><Link href="/dashboard">Back to Dashboard</Link></div></main>;
  if (!canAccess(profile)) return <main className={styles.page}><div className={styles.stateCard}><h1>Access denied</h1><p>Front Office access is required.</p><Link href="/dashboard">Back to Dashboard</Link></div></main>;

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>Front Office Workspace</span>
          <h1>Proforma Invoice</h1>
          <p>Create professional group quotations, track amendments, check-ins and outstanding accounts.</p>
        </div>
        <Link className={styles.secondaryButton} href="/dashboard">Back to Dashboard</Link>
      </header>

      <nav className={styles.tabs} aria-label="Proforma invoice sections">
        <button className={tab === 'CREATE' ? styles.activeTab : ''} onClick={() => setTab('CREATE')}>Create Invoice</button>
        <button className={tab === 'SUMMARY' ? styles.activeTab : ''} onClick={() => setTab('SUMMARY')}>Summary <span>{invoices.length}</span></button>
        <button className={tab === 'CLIENTS' ? styles.activeTab : ''} onClick={() => setTab('CLIENTS')}>Client Profiles <span>{clients.length}</span></button>
      </nav>

      {message ? <div className={styles.success}>{message}</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}

      {tab === 'CREATE' ? (
        <section className={styles.workspace}>
          <div className={styles.sectionHeading}>
            <div>
              <span>{editMode === 'NEW' ? 'New document' : editMode === 'EDIT' ? 'Internal correction' : 'Customer amendment'}</span>
              <h2>{editMode === 'NEW' ? 'Create Proforma Invoice' : `${editMode === 'EDIT' ? 'Edit' : 'Amend'} Invoice`}</h2>
            </div>
            {editMode !== 'NEW' ? <button className={styles.secondaryButton} onClick={resetForm}>Cancel Editing</button> : null}
          </div>

          <div className={styles.formGrid}>
            <label className={styles.fieldWide}>
              <span>Company / Client Profile *</span>
              <div className={styles.inlineField}>
                <select value={selectedClientId} onChange={(event) => setSelectedClientId(event.target.value ? Number(event.target.value) : '')}>
                  <option value="">Select a saved client</option>
                  {clients.map((client) => <option key={client.id} value={client.id}>{client.company_name} - {client.contact_person}</option>)}
                </select>
                <button type="button" className={styles.secondaryButton} onClick={() => openClientModal('NEW')}>+ Client</button>
              </div>
            </label>
            <label>
              <span>Proforma Date (Singapore)</span>
              <input value={proformaDate} readOnly />
            </label>
            <label>
              <span>Tour Code</span>
              <input value={tourCode} onChange={(event) => setTourCode(event.target.value)} placeholder="Optional tour/group code" />
            </label>
            <label>
              <span>Check-In Date *</span>
              <input type="date" value={checkIn} onChange={(event) => {
                const next = event.target.value;
                setCheckIn(next);
                if (dateDiff(next, checkOut) <= 0) setCheckOut(addDays(next, 1));
              }} />
            </label>
            <label>
              <span>Check-Out Date *</span>
              <input type="date" min={addDays(checkIn, 1)} value={checkOut} onChange={(event) => setCheckOut(event.target.value)} />
            </label>
          </div>

          {selectedClient ? (
            <div className={styles.clientPreview}>
              <div><strong>{selectedClient.company_name}</strong><span>{selectedClient.address || 'No address entered'}</span></div>
              <div><strong>{selectedClient.contact_person}</strong><span>{selectedClient.contact_number}</span></div>
              <button className={styles.textButton} onClick={() => openClientModal(selectedClient)}>Edit Profile</button>
            </div>
          ) : null}

          <div className={styles.metricRow}>
            <Metric label="Stay" value={`${totals.nights} night${totals.nights === 1 ? '' : 's'}`} />
            <Metric label="Rooms" value={String(totals.roomCount)} />
            <Metric label="Room Nights" value={String(totals.roomNights)} />
            <Metric label="Grand Total" value={money(totals.grandTotal)} />
          </div>

          <div className={styles.lineHeader}>
            <div><span>Accommodation</span><h3>Room and Charge Lines</h3></div>
            <button className={styles.secondaryButton} onClick={() => setLines((current) => [...current, blankLine()])}>+ Add Line</button>
          </div>
          <div className={styles.lineList}>
            {lines.map((line, index) => {
              const item = catalogItem(line.catalog_id);
              const lineTotal = expandLines([line], checkIn, checkOut).reduce((sum, row) => sum + row.subtotal, 0);
              return (
                <article className={styles.lineCard} key={line.id}>
                  <div className={styles.lineNumber}>{index + 1}</div>
                  <label className={styles.lineType}>
                    <span>Room / Charge Type</span>
                    <select value={line.catalog_id} onChange={(event) => updateLine(line.id, { catalog_id: event.target.value })}>
                      {ROOM_CATALOG.map((room) => <option key={room.id} value={room.id}>{room.label}</option>)}
                    </select>
                    <small>{item.description} · {item.breakfast}</small>
                  </label>
                  <label>
                    <span>{item.kind === 'ROOM' ? 'Rooms' : 'Persons'}</span>
                    <input type="number" min="1" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: Math.max(1, Number(event.target.value || 1)) })} />
                  </label>
                  <label>
                    <span>Agreed Rate / Night</span>
                    <input type="number" min="0" step="0.01" value={line.custom_rate ?? ''} onChange={(event) => updateLine(line.id, { custom_rate: event.target.value === '' ? null : Math.max(0, Number(event.target.value)) })} placeholder="Auto rate" disabled={line.foc} />
                  </label>
                  <label className={styles.checkboxField}>
                    <input type="checkbox" checked={line.foc} onChange={(event) => updateLine(line.id, { foc: event.target.checked, custom_rate: event.target.checked ? null : line.custom_rate })} />
                    <span>FOC / Complimentary</span>
                  </label>
                  <div className={styles.lineTotal}><span>Subtotal</span><strong>{money(lineTotal)}</strong></div>
                  <button className={styles.removeButton} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((entry) => entry.id !== line.id))}>Remove</button>
                </article>
              );
            })}
          </div>

          <div className={styles.rateNote}>
            <strong>Automatic rate schedule</strong>
            <span>Weekday: Sunday-Thursday · Weekend: Friday-Saturday · Peak dates override both. {PEAK_PERIOD_LABEL}</span>
          </div>

          <div className={styles.totalPanel}>
            <label>
              <span>Deposit Paid</span>
              <input type="number" min="0" max={totals.grandTotal} step="0.01" value={depositPaid} onChange={(event) => setDepositPaid(Math.max(0, Number(event.target.value || 0)))} />
            </label>
            <div><span>Grand Total</span><strong>{money(totals.grandTotal)}</strong></div>
            <div><span>Less Deposit</span><strong>- {money(depositPaid)}</strong></div>
            <div className={styles.balance}><span>Payable Before Check-In</span><strong>{money(balanceBeforeCheckIn)}</strong></div>
          </div>

          {editMode === 'AMEND' ? (
            <label className={styles.amendmentField}>
              <span>Customer Amendment Reason *</span>
              <textarea value={amendmentNote} onChange={(event) => setAmendmentNote(event.target.value)} placeholder="Example: Customer reduced the group from 15 rooms to 12 rooms." />
              <small>The amendment date will be recorded automatically in Singapore time and printed on the revised invoice.</small>
            </label>
          ) : null}

          <div className={styles.footerActions}>
            <button className={styles.primaryButton} disabled={saving || !selectedClient || totals.nights <= 0} onClick={() => void saveInvoice()}>
              {saving ? 'Saving...' : editMode === 'NEW' ? 'Save Proforma Invoice' : editMode === 'EDIT' ? 'Save Correction' : 'Save Customer Amendment'}
            </button>
          </div>
        </section>
      ) : null}

      {tab === 'SUMMARY' ? (
        <section className={styles.workspace}>
          <div className={styles.sectionHeading}>
            <div><span>Document register</span><h2>Proforma Summary</h2></div>
            <button className={styles.primaryButton} onClick={() => { resetForm(); setTab('CREATE'); }}>+ New Invoice</button>
          </div>
          <input className={styles.searchInput} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search invoice number, client, contact or tour code" />
          <div className={styles.summaryList}>
            {!filteredInvoices.length ? <div className={styles.empty}>No proforma invoices found.</div> : null}
            {filteredInvoices.map((invoice) => (
              <article className={styles.summaryCard} key={invoice.id}>
                <div className={styles.summaryTop}>
                  <div><span>{invoice.invoice_number}</span><h3>{invoice.client_company_name}</h3><small>{invoice.client_contact_person} · {invoice.tour_code || 'No tour code'}</small></div>
                  <StatusBadge status={invoice.status} paid={Number(invoice.balance_outstanding) === 0} />
                </div>
                <div className={styles.summaryMetrics}>
                  <Metric label="Stay" value={`${invoice.stay_nights} nights`} />
                  <Metric label="Rooms" value={String(invoice.total_room_count)} />
                  <Metric label="Grand Total" value={money(invoice.grand_total)} />
                  <Metric label="Outstanding" value={money(invoice.balance_outstanding)} attention={Number(invoice.balance_outstanding) > 0 && invoice.status === 'CHECKED_IN'} />
                </div>
                <div className={styles.summaryDates}><span>{formatDate(invoice.check_in_date)}</span><span>to</span><span>{formatDate(invoice.check_out_date)}</span></div>
                <div className={styles.cardActions}>
                  <button className={styles.primaryButton} onClick={() => void downloadInvoicePdf(invoice, invoice.created_by_name || profile.name)}>Download PDF</button>
                  <button className={styles.secondaryButton} onClick={() => setDetailInvoice(invoice)}>Manage</button>
                  {invoice.status === 'CHECKED_IN' ? <button className={styles.secondaryButton} onClick={() => void openStatement(invoice)}>Statement</button> : null}
                  {invoice.status === 'CHECKED_IN' && Number(invoice.balance_outstanding) > 0 ? <button className={styles.paymentButton} onClick={() => openPayment(invoice)}>Record Payment</button> : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {tab === 'CLIENTS' ? (
        <section className={styles.workspace}>
          <div className={styles.sectionHeading}>
            <div><span>Reusable database</span><h2>Company & Client Profiles</h2></div>
            <button className={styles.primaryButton} onClick={() => openClientModal('NEW')}>+ New Client</button>
          </div>
          <input className={styles.searchInput} value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Search company, contact person or phone" />
          <div className={styles.clientGrid}>
            {filteredClients.map((client) => (
              <article className={styles.clientCard} key={client.id}>
                <h3>{client.company_name}</h3>
                <p>{client.address || 'No address entered'}</p>
                <strong>{client.contact_person}</strong>
                <span>{client.contact_number}</span>
                <div className={styles.cardActions}>
                  <button className={styles.secondaryButton} onClick={() => openClientModal(client)}>Edit</button>
                  <button className={styles.primaryButton} onClick={() => { resetForm(); setSelectedClientId(client.id); setTab('CREATE'); }}>Use Profile</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {clientModal ? (
        <Modal title={clientModal === 'NEW' ? 'Create Client Profile' : 'Edit Client Profile'} onClose={() => setClientModal(null)}>
          <div className={styles.modalForm}>
            <label><span>Company / Client Name *</span><input value={clientDraft.company_name} onChange={(event) => setClientDraft((current) => ({ ...current, company_name: event.target.value }))} /></label>
            <label><span>Address *</span><textarea value={clientDraft.address} onChange={(event) => setClientDraft((current) => ({ ...current, address: event.target.value }))} /></label>
            <label><span>Contact Person *</span><input value={clientDraft.contact_person} onChange={(event) => setClientDraft((current) => ({ ...current, contact_person: event.target.value }))} /></label>
            <label><span>Contact Number *</span><input value={clientDraft.contact_number} onChange={(event) => setClientDraft((current) => ({ ...current, contact_number: event.target.value }))} inputMode="tel" /></label>
          </div>
          <div className={styles.footerActions}><button className={styles.primaryButton} disabled={saving} onClick={() => void saveClient()}>{saving ? 'Saving...' : 'Save Client Profile'}</button></div>
        </Modal>
      ) : null}

      {detailInvoice ? (
        <Modal title={`${detailInvoice.invoice_number} · ${detailInvoice.client_company_name}`} onClose={() => setDetailInvoice(null)} wide>
          <div className={styles.detailGrid}>
            <Metric label="Status" value={detailInvoice.status.replace('_', ' ')} />
            <Metric label="Grand Total" value={money(detailInvoice.grand_total)} />
            <Metric label="Deposit" value={money(detailInvoice.deposit_paid)} />
            <Metric label="Outstanding" value={money(detailInvoice.balance_outstanding)} />
          </div>
          {detailInvoice.amendment_no > 0 ? <div className={styles.amendmentNotice}>Amendment {detailInvoice.amendment_no} dated {formatDate(detailInvoice.amendment_date)}: {detailInvoice.amendment_note}</div> : null}
          <div className={styles.manageSections}>
            <div><h3>Document</h3><div className={styles.cardActions}><button className={styles.primaryButton} onClick={() => void downloadInvoicePdf(detailInvoice, detailInvoice.created_by_name || profile.name)}>Download PDF</button><button className={styles.secondaryButton} onClick={() => editInvoice(detailInvoice, 'EDIT')}>Edit Our Mistake</button><button className={styles.secondaryButton} onClick={() => editInvoice(detailInvoice, 'AMEND')}>Customer Amendment</button></div></div>
            <div><h3>Client Decision</h3><div className={styles.cardActions}><button className={styles.checkInButton} disabled={statusBusy} onClick={() => void updateInvoiceStatus(detailInvoice, 'CHECKED_IN')}>Checked In</button><button className={styles.declineButton} disabled={statusBusy} onClick={() => void updateInvoiceStatus(detailInvoice, 'DECLINED')}>Declined</button><button className={styles.secondaryButton} disabled={statusBusy} onClick={() => void updateInvoiceStatus(detailInvoice, 'ISSUED')}>Reset to Issued</button></div></div>
            {detailInvoice.status === 'CHECKED_IN' ? <div><h3>Statement of Account</h3><div className={styles.cardActions}><button className={styles.secondaryButton} onClick={() => void openStatement(detailInvoice)}>Open Statement</button>{Number(detailInvoice.balance_outstanding) > 0 ? <button className={styles.paymentButton} onClick={() => openPayment(detailInvoice)}>Record Payment</button> : null}</div></div> : null}
          </div>
        </Modal>
      ) : null}

      {paymentInvoice ? (
        <Modal title={`Record Payment · ${paymentInvoice.invoice_number}`} onClose={() => setPaymentInvoice(null)}>
          <div className={styles.paymentSummary}><span>Outstanding balance</span><strong>{money(paymentInvoice.balance_outstanding)}</strong></div>
          <div className={styles.modalForm}>
            <label><span>Payment Amount *</span><input type="number" min="0.01" max={paymentInvoice.balance_outstanding} step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></label>
            <label><span>Transaction ID *</span><input value={transactionId} onChange={(event) => setTransactionId(event.target.value)} placeholder="Bank/reference transaction ID" autoFocus /></label>
          </div>
          <div className={styles.footerActions}><button className={styles.paymentButton} disabled={saving} onClick={() => void recordPayment()}>{saving ? 'Recording...' : 'Confirm Payment'}</button></div>
        </Modal>
      ) : null}

      {statementInvoice ? (
        <Modal title={`Statement of Account · ${statementInvoice.client_company_name}`} onClose={() => setStatementInvoice(null)} wide>
          <div className={styles.statementHeader}><div><span>Invoice</span><strong>{statementInvoice.invoice_number}</strong></div><div><span>Outstanding</span><strong>{money(statementInvoice.balance_outstanding)}</strong></div></div>
          <div className={styles.statementTable}>
            <div className={styles.statementRow}><strong>Date</strong><strong>Description</strong><strong>Amount</strong></div>
            <div className={styles.statementRow}><span>{statementInvoice.proforma_date}</span><span>Proforma Invoice</span><span>{money(statementInvoice.grand_total)}</span></div>
            <div className={styles.statementRow}><span>{statementInvoice.proforma_date}</span><span>Deposit Paid</span><span>- {money(statementInvoice.deposit_paid)}</span></div>
            {statementPayments.map((payment) => <div className={styles.statementRow} key={payment.id}><span>{payment.payment_date}</span><span>Payment · {payment.transaction_id}</span><span>- {money(payment.amount)}</span></div>)}
          </div>
          <div className={styles.footerActions}><button className={styles.primaryButton} onClick={() => void downloadStatementPdf(statementInvoice, statementPayments)}>Download Statement PDF</button>{Number(statementInvoice.balance_outstanding) > 0 ? <button className={styles.paymentButton} onClick={() => { setStatementInvoice(null); openPayment(statementInvoice); }}>Record Payment</button> : null}</div>
        </Modal>
      ) : null}

      {statementLoading ? <div className={styles.loadingOverlay}>Loading statement...</div> : null}
    </main>
  );
}

function Metric({ label, value, attention = false }: { label: string; value: string; attention?: boolean }) {
  return <div className={`${styles.metric} ${attention ? styles.metricAttention : ''}`}><span>{label}</span><strong>{value}</strong></div>;
}

function StatusBadge({ status, paid }: { status: InvoiceStatus; paid: boolean }) {
  const label = status === 'CHECKED_IN' ? (paid ? 'Checked In · Paid' : 'Checked In') : status === 'DECLINED' ? 'Declined' : 'Issued';
  return <span className={`${styles.statusBadge} ${styles[`status${status}`]}`}>{label}</span>;
}

function Modal({ title, onClose, wide = false, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  return (
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className={`${styles.modal} ${wide ? styles.modalWide : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button onClick={onClose} aria-label="Close">×</button></header>
        <div className={styles.modalBody}>{children}</div>
      </section>
    </div>
  );
}
