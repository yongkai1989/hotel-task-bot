'use client';

import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type Branch = 'All' | 'Crown' | 'Leisure' | 'Express' | 'View';
type RealBranch = Exclude<Branch, 'All'>;
type MealChoice = 'none' | 'lunch' | 'dinner' | 'both';

type Cycle = {
  order_week_start: string;
  order_week_end: string;
  service_week_start?: string;
  service_week_end?: string;
  closes_at_label: string;
};

type StaffMealOrder = {
  id: string;
  order_week_start: string;
  order_week_end: string;
  branch: RealBranch;
  staff_name: string;
  meals: Record<string, MealChoice>;
  notes?: string | null;
  created_at?: string;
  updated_by_name?: string | null;
};

type MenuSetName = 'A' | 'B';
type MealMenuDay = {
  day_index: number;
  menu_text: string;
};

const BRANCHES: Branch[] = ['All', 'Crown', 'Leisure', 'Express', 'View'];
const REAL_BRANCHES: RealBranch[] = ['Crown', 'Leisure', 'Express', 'View'];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function mondayForDate(value: string) {
  const parts = dateParts(value);
  if (!parts) return value;
  const date = new Date(parts.year, parts.month - 1, parts.day);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return formatDateInput(date);
}

function weekDates(start: string) {
  if (!start) return [];
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function formatShort(value: string) {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function formatLong(value: string) {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

function mealText(choice: MealChoice) {
  if (choice === 'lunch') return 'Lunch';
  if (choice === 'dinner') return 'Dinner';
  if (choice === 'both') return 'Lunch + Dinner';
  return '-';
}

function countMeals(meals: Record<string, MealChoice>) {
  return Object.values(meals || {}).reduce(
    (acc, choice) => {
      if (choice === 'lunch') acc.lunch += 1;
      if (choice === 'dinner') acc.dinner += 1;
      if (choice === 'both') {
        acc.lunch += 1;
        acc.dinner += 1;
      }
      return acc;
    },
    { lunch: 0, dinner: 0 }
  );
}

function hasLunch(choice: MealChoice) {
  return choice === 'lunch' || choice === 'both';
}

function hasDinner(choice: MealChoice) {
  return choice === 'dinner' || choice === 'both';
}

function countDayMeals(orders: StaffMealOrder[], date: string) {
  return orders.reduce(
    (acc, order) => {
      const choice = order.meals?.[date] || 'none';
      if (hasLunch(choice)) acc.lunch += 1;
      if (hasDinner(choice)) acc.dinner += 1;
      return acc;
    },
    { lunch: 0, dinner: 0 }
  );
}

function branchSortValue(branch: RealBranch) {
  const index = REAL_BRANCHES.indexOf(branch);
  return index === -1 ? REAL_BRANCHES.length : index;
}

function sortMealOrders(a: StaffMealOrder, b: StaffMealOrder) {
  const branchDiff = branchSortValue(a.branch) - branchSortValue(b.branch);
  if (branchDiff !== 0) return branchDiff;
  return a.staff_name.localeCompare(b.staff_name, undefined, { sensitivity: 'base' });
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function emptyMeals(start: string) {
  return weekDates(start).reduce<Record<string, MealChoice>>((acc, date) => {
    acc[date] = 'none';
    return acc;
  }, {});
}

function emptyMenuRows(): MealMenuDay[] {
  return DAY_NAMES.map((_, dayIndex) => ({
    day_index: dayIndex,
    menu_text: '',
  }));
}

function normalizeMenuRows(rows: any): MealMenuDay[] {
  const incoming = Array.isArray(rows) ? rows : [];
  return emptyMenuRows().map((row) => {
    const match = incoming.find((item) => Number(item?.day_index) === row.day_index);
    return {
      day_index: row.day_index,
      menu_text: String(match?.menu_text || match?.lunch_menu || match?.dinner_menu || ''),
    };
  });
}

export default function StaffMealAdminPage() {
  const [orders, setOrders] = useState<StaffMealOrder[]>([]);
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [branch, setBranch] = useState<Branch>('All');
  const [weekStart, setWeekStart] = useState('');
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<StaffMealOrder | null>(null);
  const [activeMenuSet, setActiveMenuSet] = useState<MenuSetName>('A');
  const [assignedMenuSet, setAssignedMenuSet] = useState<MenuSetName>('A');
  const [menus, setMenus] = useState<Record<MenuSetName, MealMenuDay[]>>({
    A: emptyMenuRows(),
    B: emptyMenuRows(),
  });
  const [menuEditorOpen, setMenuEditorOpen] = useState(false);
  const [savingMenu, setSavingMenu] = useState(false);

  async function loadOrders(targetWeek?: string) {
    setLoading(true);
    setError('');
    try {
      const supabase = createBrowserSupabaseClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Missing login session.');

      const params = new URLSearchParams({ admin: '1' });
      params.set('mode', 'report');
      if (targetWeek) params.set('week_start', mondayForDate(targetWeek));

      const res = await fetch(`/api/staff-meal/orders?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Unable to load staff meal orders.');

      setOrders([...(json.orders || [])].sort(sortMealOrders));
      setCycle(json.cycle || null);
      setWeekStart(json.week_start || json.cycle?.service_week_start || json.cycle?.order_week_start || '');
      setCanManage(!!json.can_manage);
      const nextMenuSet: MenuSetName = json.menu_set === 'B' ? 'B' : 'A';
      setAssignedMenuSet(nextMenuSet);
      setActiveMenuSet(nextMenuSet);
      setMenus({
        A: normalizeMenuRows(json.menus?.A),
        B: normalizeMenuRows(json.menus?.B),
      });
    } catch (err: any) {
      setError(err?.message || 'Unable to load staff meal orders.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOrders();
  }, []);

  const dates = useMemo(() => weekDates(weekStart || cycle?.order_week_start || ''), [weekStart, cycle]);
  const displayWeekStart = weekStart || cycle?.order_week_start || '';
  const displayWeekEnd = displayWeekStart ? addDays(displayWeekStart, 6) : '';
  const filteredOrders = useMemo(
    () => orders.filter((order) => branch === 'All' || order.branch === branch),
    [orders, branch]
  );

  const dailyTotals = useMemo(() => {
    return dates.map((date) => ({
      date,
      ...countDayMeals(filteredOrders, date),
    }));
  }, [dates, filteredOrders]);

  async function saveEdit() {
    if (!editing) return;
    setError('');
    setMessage('');
    try {
      const supabase = createBrowserSupabaseClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Missing login session.');

      const res = await fetch('/api/staff-meal/orders', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(editing),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Unable to save order.');

      setMessage('Staff meal order updated.');
      setEditing(null);
      await loadOrders(weekStart);
    } catch (err: any) {
      setError(err?.message || 'Unable to save order.');
    }
  }

  async function deleteOrder(order: StaffMealOrder) {
    if (!window.confirm(`Delete staff meal order for ${order.staff_name}?`)) return;
    setError('');
    setMessage('');
    try {
      const supabase = createBrowserSupabaseClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Missing login session.');

      const res = await fetch(`/api/staff-meal/orders?id=${encodeURIComponent(order.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Unable to delete order.');

      setMessage('Staff meal order deleted.');
      await loadOrders(weekStart);
    } catch (err: any) {
      setError(err?.message || 'Unable to delete order.');
    }
  }

  function updateEditMeal(date: string, choice: MealChoice) {
    if (!editing) return;
    setEditing({
      ...editing,
      meals: {
        ...emptyMeals(editing.order_week_start),
        ...(editing.meals || {}),
        [date]: choice,
      },
    });
  }

  function updateMenuRow(dayIndex: number, value: string) {
    setMenus((prev) => ({
      ...prev,
      [activeMenuSet]: prev[activeMenuSet].map((row) =>
        row.day_index === dayIndex ? { ...row, menu_text: value } : row
      ),
    }));
  }

  async function saveMenuSet() {
    setSavingMenu(true);
    setError('');
    setMessage('');
    try {
      const supabase = createBrowserSupabaseClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Missing login session.');

      const res = await fetch('/api/staff-meal/orders', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'save_menu',
          set_name: activeMenuSet,
          menu: menus[activeMenuSet],
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Unable to save menu set.');

      setMenus({
        A: normalizeMenuRows(json.menus?.A),
        B: normalizeMenuRows(json.menus?.B),
      });
      setMessage(`Set ${activeMenuSet} menu saved.`);
    } catch (err: any) {
      setError(err?.message || 'Unable to save menu set.');
    } finally {
      setSavingMenu(false);
    }
  }

  function printStaffMealReport() {
    const title = `Staff Meal Weekly Report - ${formatShort(displayWeekStart)} to ${formatShort(displayWeekEnd)}`;
    const reportOrders = [...orders].sort(sortMealOrders);
    const printBranchOrder: RealBranch[] = ['Crown', 'Leisure', 'Express', 'View'];
    const mealCode = (choice: MealChoice) => {
      if (choice === 'lunch') return 'L';
      if (choice === 'dinner') return 'D';
      if (choice === 'both') return 'L+D';
      return '-';
    };
    const dayClass = (choice: MealChoice) => (choice === 'none' ? 'meal-none' : `meal-${choice}`);
    const printDateLabel = (date: string) => {
      const parsed = new Date(`${date}T00:00:00`);
      if (Number.isNaN(parsed.getTime())) return escapeHtml(date);
      const day = parsed.toLocaleDateString('en-GB', { weekday: 'short' });
      const dateNo = parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      return `${escapeHtml(day)}<br /><span>${escapeHtml(dateNo)}</span>`;
    };
    const renderMealCells = (order: StaffMealOrder) =>
      dates
        .map((date) => {
          const choice = order.meals?.[date] || 'none';
          return `<td class="meal-cell"><span class="meal-pill ${dayClass(choice)}">${escapeHtml(mealCode(choice))}</span></td>`;
        })
        .join('');
    const renderTotalsRow = (label: string, values: number[]) => `
      <tr class="total-row">
        <td colspan="2">${escapeHtml(label)}</td>
        ${values.map((value) => `<td>${value}</td>`).join('')}
        <td></td>
      </tr>
    `;
    const allBranchLunchTotals = dates.map((date) => countDayMeals(reportOrders, date).lunch);
    const allBranchDinnerTotals = dates.map((date) => countDayMeals(reportOrders, date).dinner);
    const allBranchTotalsSection = `
      <div class="daily-total-panel">
        <div class="mini-section-title">
          <span>All branches daily total</span>
          <strong>Crown + Leisure + Express + View</strong>
        </div>
        <table class="totals-table">
          <thead>
            <tr>
              <th class="total-label-head">Meal</th>
              ${dates.map((date) => `<th class="date-head">${printDateLabel(date)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="total-label">Lunch</td>
              ${allBranchLunchTotals.map((value) => `<td class="daily-total">${value}</td>`).join('')}
            </tr>
            <tr>
              <td class="total-label">Dinner</td>
              ${allBranchDinnerTotals.map((value) => `<td class="daily-total">${value}</td>`).join('')}
            </tr>
          </tbody>
        </table>
      </div>
    `;
    const branchPages = printBranchOrder
      .map((branchName) => {
        const branchOrders = reportOrders.filter((order) => order.branch === branchName);
        const branchLunchTotals = dates.map((date) => countDayMeals(branchOrders, date).lunch);
        const branchDinnerTotals = dates.map((date) => countDayMeals(branchOrders, date).dinner);
        const rows = branchOrders
          .map(
            (order, index) => `
              <tr>
                <td class="row-number">${index + 1}</td>
                <td class="staff-name">${escapeHtml(order.staff_name)}</td>
                ${renderMealCells(order)}
                <td class="notes-cell">${escapeHtml(order.notes || '')}</td>
              </tr>
            `
          )
          .join('');

        return `
          <section class="print-page branch-page">
            <div class="page-header">
              <div>
                <div class="kicker">Branch packing page</div>
                <h1>${escapeHtml(branchName)} Staff Meal</h1>
                <p>${escapeHtml(formatLong(displayWeekStart))} to ${escapeHtml(formatLong(displayWeekEnd))}</p>
              </div>
              <div class="page-meta">
                <strong>${branchOrders.length}</strong>
                <span>staff order(s)</span>
              </div>
            </div>
            ${branchName === 'Crown' ? allBranchTotalsSection : ''}
            <table class="weekly-table">
              <thead>
                <tr>
                  <th class="number-head">#</th>
                  <th class="staff-head">Staff Name</th>
                  ${dates.map((date) => `<th class="date-head">${printDateLabel(date)}</th>`).join('')}
                  <th class="notes-head">Remarks</th>
                </tr>
              </thead>
              <tbody>
                ${rows || `<tr><td colspan="${dates.length + 3}" class="empty-cell">No orders for ${escapeHtml(branchName)}.</td></tr>`}
                ${renderTotalsRow('Total Lunch', branchLunchTotals)}
                ${renderTotalsRow('Total Dinner', branchDinnerTotals)}
              </tbody>
            </table>
            <div class="legend">L = Lunch | D = Dinner | L+D = Lunch and Dinner | - = No meal</div>
          </section>
        `;
      })
      .join('');
    const popup = window.open('', '_blank', 'width=1200,height=800');
    if (!popup) return;

    popup.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>${escapeHtml(title)}</title>
          <style>
            * {
              box-sizing: border-box;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            body {
              margin: 0;
              padding: 0;
              color: #07142d;
              font-family: Arial, sans-serif;
              background: #fff;
              font-size: 11px;
            }
            .print-page {
              min-height: 100vh;
              padding: 8mm;
              page-break-after: always;
            }
            .print-page:last-child {
              page-break-after: auto;
            }
            .page-header {
              display: flex;
              justify-content: space-between;
              gap: 12px;
              align-items: center;
              border: 1px solid #cbd5e1;
              border-radius: 14px;
              padding: 9px 12px;
              margin-bottom: 8px;
              background: linear-gradient(135deg, #f8fbff 0%, #ffffff 56%, #fef7ed 100%);
            }
            .kicker {
              color: #1d4ed8;
              font-size: 8px;
              font-weight: 800;
              letter-spacing: 1.1px;
              text-transform: uppercase;
            }
            h1 {
              margin: 3px 0;
              font-size: 22px;
              line-height: 1.05;
            }
            p {
              margin: 0;
              color: #475569;
              font-weight: 700;
            }
            .page-meta {
              text-align: right;
              color: #0f172a;
              font-weight: 700;
            }
            .page-meta strong {
              display: block;
              font-size: 24px;
              line-height: 1;
            }
            .legend {
              margin-top: 6px;
              color: #475569;
              font-size: 10px;
              font-weight: 700;
            }
            .daily-total-panel {
              margin-bottom: 8px;
              border: 1px solid #cbd5e1;
              border-radius: 12px;
              padding: 7px;
              background: #f8fafc;
            }
            .mini-section-title {
              display: flex;
              justify-content: space-between;
              gap: 12px;
              align-items: center;
              margin-bottom: 5px;
              color: #475569;
              font-size: 9px;
              font-weight: 900;
            }
            .mini-section-title span {
              color: #1d4ed8;
              letter-spacing: .7px;
              text-transform: uppercase;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
              font-size: 10.2px;
              line-height: 1.2;
              border: 1px solid #dbe4f0;
              border-radius: 10px;
              overflow: hidden;
            }
            th, td {
              border: 1px solid #d9e2ec;
              padding: 5px 6px;
              vertical-align: middle;
              word-break: break-word;
            }
            th {
              background: #edf4ff;
              color: #1e3a8a;
              text-transform: uppercase;
              font-size: 8px;
              letter-spacing: .35px;
              text-align: center;
              white-space: nowrap;
            }
            .date-head {
              width: 52px;
              line-height: 1.05;
            }
            .date-head span {
              display: block;
              font-size: 7px;
              color: #475569;
              letter-spacing: 0;
              text-transform: none;
            }
            .number-head,
            .row-number {
              width: 28px;
              text-align: center;
              color: #64748b;
              font-weight: 800;
            }
            th.staff-head,
            .staff-name {
              text-align: left;
              width: 140px;
            }
            .notes-head,
            .notes-cell {
              width: 230px;
            }
            .meal-cell {
              text-align: center;
              padding-left: 3px;
              padding-right: 3px;
            }
            .meal-pill {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              min-width: 26px;
              min-height: 20px;
              padding: 2px 5px;
              border-radius: 999px;
              font-weight: 900;
              white-space: nowrap;
            }
            .meal-lunch { background: #e0f2fe; color: #075985; border: 1px solid #bae6fd; }
            .meal-dinner { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
            .meal-both { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
            .meal-none { color: #94a3b8; background: #f8fafc; border: 1px solid #e2e8f0; }
            .notes-cell {
              color: #334155;
              font-size: 9.5px;
            }
            .empty-cell {
              text-align: center;
              color: #64748b;
              font-weight: 800;
              padding: 18px;
            }
            .total-row td {
              background: #f8fafc;
              font-weight: 900;
              color: #0f172a;
              text-align: center;
            }
            .totals-table {
              font-size: 10px;
            }
            .totals-table th,
            .totals-table td {
              padding: 5px 6px;
            }
            .total-label-head,
            .total-label {
              width: 72px;
              text-align: left;
            }
            .total-label {
              font-size: 10.5px;
              font-weight: 900;
              color: #0f172a;
              background: #f8fafc;
            }
            .daily-total {
              text-align: center;
              font-size: 16px;
              font-weight: 900;
              color: #0f172a;
            }
            thead { display: table-header-group; }
            tr { break-inside: avoid; }
            @page { size: A4 landscape; margin: 0; }
            @media print {
              .print-page {
                min-height: auto;
                padding: 7mm;
              }
              .branch-page { break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          ${branchPages}
        </body>
      </html>
    `);
    popup.document.close();
    popup.focus();
    popup.print();
  }

  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div>
          <div style={styles.kicker}>F&B Workspace</div>
          <h1 style={styles.title}>Staff Meal</h1>
          <p style={styles.subtitle}>
            Weekly meal orders by branch, with clear totals for kitchen and packing.
          </p>
        </div>
        <div style={styles.heroActions}>
          <button type="button" onClick={() => loadOrders(weekStart)} style={styles.secondaryBtn}>
            Refresh
          </button>
          <Link href="/dashboard" style={styles.secondaryBtn}>
            Back to Dashboard
          </Link>
        </div>
      </section>

      {error ? <div style={styles.errorBox}>{error}</div> : null}
      {message ? <div style={styles.successBox}>{message}</div> : null}

      <section style={styles.panel}>
        <div style={styles.panelHead}>
          <div>
            <div style={styles.kicker}>Order Week</div>
            <h2 style={styles.sectionTitle}>
              {formatLong(displayWeekStart)} to {formatLong(displayWeekEnd)}
            </h2>
            <p style={styles.muted}>Public submission page: <Link href="/staff-meal">/staff-meal</Link></p>
          </div>
          <div style={styles.weekPicker}>
            <label style={styles.label}>Week start</label>
            <input
              type="date"
              value={weekStart}
              min="2026-01-05"
              step={7}
              onChange={(event) => {
                const monday = mondayForDate(event.target.value);
                setWeekStart(monday);
                loadOrders(monday);
              }}
              style={styles.input}
            />
            <div style={styles.weekQuickActions}>
              <button
                type="button"
                onClick={() => loadOrders(cycle?.service_week_start || weekStart)}
                style={styles.smallGhostBtn}
              >
                Current Week
              </button>
              <button
                type="button"
                onClick={() => loadOrders(cycle?.order_week_start || weekStart)}
                style={styles.smallGhostBtn}
              >
                Ordering Week
              </button>
            </div>
          </div>
        </div>

        <div style={styles.summaryGrid}>
          {dailyTotals.map((item) => (
            <div key={item.date} style={styles.summaryCard}>
              <div style={styles.summaryBranch}>{formatShort(item.date)}</div>
              <div style={styles.summaryNumbers}>
                <div style={styles.mealCountBox}>
                  <span style={styles.mealCountLabel}>Lunch</span>
                  <strong style={styles.mealCountNumber}>{item.lunch}</strong>
                </div>
                <div style={styles.mealCountBox}>
                  <span style={styles.mealCountLabel}>Dinner</span>
                  <strong style={styles.mealCountNumber}>{item.dinner}</strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={styles.panel}>
        <div style={styles.panelHead}>
          <div>
            <div style={styles.kicker}>Weekly Menu</div>
            <h2 style={styles.sectionTitle}>Set {assignedMenuSet} is assigned for this order week</h2>
            <p style={styles.muted}>Set A and Set B alternate automatically every week. Open Menu only when you need to update the weekly dishes.</p>
          </div>
          <button
            type="button"
            onClick={() => setMenuEditorOpen((value) => !value)}
            style={{ ...styles.secondaryBtn, ...(menuEditorOpen ? styles.secondaryBtnActive : null) }}
          >
            {menuEditorOpen ? 'Hide Menu' : 'Menu'}
          </button>
        </div>

        {menuEditorOpen ? (
          <>
            <div style={styles.menuSetTabs}>
              {(['A', 'B'] as MenuSetName[]).map((setName) => (
                <button
                  key={setName}
                  type="button"
                  onClick={() => setActiveMenuSet(setName)}
                  style={{ ...styles.tab, ...(activeMenuSet === setName ? styles.tabActive : null) }}
                >
                  Set {setName}
                </button>
              ))}
            </div>

            <div style={styles.menuEditorGrid}>
              {DAY_NAMES.map((dayName, dayIndex) => {
                const row = menus[activeMenuSet][dayIndex] || {
                  day_index: dayIndex,
                  menu_text: '',
                };
                return (
                  <article key={dayName} style={styles.menuEditorCard}>
                    <div style={styles.menuDayHead}>
                      <span>{dayName}</span>
                      <strong>Set {activeMenuSet}</strong>
                    </div>
                    <label style={styles.field}>
                      <span style={styles.label}>Menu</span>
                      <textarea
                        value={row.menu_text}
                        onChange={(event) => updateMenuRow(dayIndex, event.target.value)}
                        placeholder="Example: Chicken rice, vegetable, soup"
                        style={{ ...styles.input, minHeight: 84, resize: 'vertical' }}
                      />
                    </label>
                  </article>
                );
              })}
            </div>

            <div style={styles.menuSaveBar}>
              <span>Staff will see Set {assignedMenuSet} on the public order page for the selected week.</span>
              <button type="button" onClick={saveMenuSet} disabled={savingMenu} style={styles.primaryBtn}>
                {savingMenu ? 'Saving...' : `Save Set ${activeMenuSet}`}
              </button>
            </div>
          </>
        ) : (
          <div style={styles.collapsedMenuNote}>
            Menu editor is hidden to keep this page compact. Tap Menu to edit Set A or Set B.
          </div>
        )}
      </section>

      <section style={styles.panel}>
        <div style={styles.tabs}>
          {BRANCHES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setBranch(item)}
              style={{ ...styles.tab, ...(branch === item ? styles.tabActive : null) }}
            >
              {item}
            </button>
          ))}
          <button type="button" onClick={printStaffMealReport} style={styles.printBtn}>
            Print Report
          </button>
        </div>

        <div style={styles.totalBar}>
          <span>{filteredOrders.length} order(s)</span>
          <strong>Report groups each day by Crown, Leisure, Express, View</strong>
        </div>

        {loading ? (
          <div style={styles.empty}>Loading staff meal orders...</div>
        ) : filteredOrders.length === 0 ? (
          <div style={styles.empty}>No staff meal orders for this branch and week.</div>
        ) : (
          <div style={styles.orderList}>
            {filteredOrders.map((order) => {
              const totals = countMeals(order.meals);
              return (
                <article key={order.id} style={styles.orderCard}>
                  <div style={styles.orderTop}>
                    <div>
                      <div style={styles.staffName}>{order.staff_name}</div>
                      <div style={styles.muted}>{order.branch} | {totals.lunch} lunch | {totals.dinner} dinner</div>
                    </div>
                    {canManage ? (
                      <div style={styles.cardActions}>
                        <button type="button" onClick={() => setEditing(order)} style={styles.smallBtn}>Edit</button>
                        <button type="button" onClick={() => deleteOrder(order)} style={styles.dangerBtn}>Delete</button>
                      </div>
                    ) : null}
                  </div>
                  <div style={styles.dayGrid}>
                    {dates.map((date) => (
                      <div key={date} style={styles.dayCell}>
                        <span>{formatShort(date)}</span>
                        <strong>{mealText(order.meals?.[date] || 'none')}</strong>
                      </div>
                    ))}
                  </div>
                  {order.notes ? <div style={styles.note}>Note: {order.notes}</div> : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {editing ? (
        <div style={styles.modalOverlay}>
          <section style={styles.modal}>
            <div style={styles.modalHead}>
              <h2 style={styles.sectionTitle}>Edit Staff Meal Order</h2>
              <button type="button" onClick={() => setEditing(null)} style={styles.closeBtn}>x</button>
            </div>

            <div style={styles.formGrid}>
              <label style={styles.field}>
                <span style={styles.label}>Branch</span>
                <select
                  value={editing.branch}
                  onChange={(event) => setEditing({ ...editing, branch: event.target.value as RealBranch })}
                  style={styles.input}
                >
                  {REAL_BRANCHES.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label style={styles.field}>
                <span style={styles.label}>Staff name</span>
                <input
                  value={editing.staff_name}
                  onChange={(event) => setEditing({ ...editing, staff_name: event.target.value })}
                  style={styles.input}
                />
              </label>
            </div>

            <div style={styles.editMeals}>
              {weekDates(editing.order_week_start).map((date) => (
                <div key={date} style={styles.editMealRow}>
                  <strong>{formatLong(date)}</strong>
                  <div style={styles.choiceGroup}>
                    {(['none', 'lunch', 'dinner', 'both'] as MealChoice[]).map((choice) => (
                      <button
                        key={choice}
                        type="button"
                        onClick={() => updateEditMeal(date, choice)}
                        style={{
                          ...styles.choiceBtn,
                          ...((editing.meals?.[date] || 'none') === choice ? styles.choiceBtnActive : null),
                        }}
                      >
                        {mealText(choice)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <label style={styles.field}>
              <span style={styles.label}>Notes</span>
              <textarea
                value={editing.notes || ''}
                onChange={(event) => setEditing({ ...editing, notes: event.target.value })}
                style={{ ...styles.input, minHeight: 92, resize: 'vertical' }}
              />
            </label>

            <div style={styles.modalActions}>
              <button type="button" onClick={() => setEditing(null)} style={styles.secondaryBtn}>Cancel</button>
              <button type="button" onClick={saveEdit} style={styles.primaryBtn}>Save Changes</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(180deg, #eef5ff 0%, #f8fbff 42%, #ffffff 100%)',
    color: '#07142d',
    padding: 'clamp(16px, 4vw, 42px)',
    fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  hero: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 20,
    alignItems: 'center',
    background: 'rgba(255,255,255,0.92)',
    border: '1px solid #d4e2f3',
    borderRadius: 28,
    padding: 'clamp(20px, 4vw, 36px)',
    boxShadow: '0 18px 60px rgba(16, 48, 90, 0.12)',
    marginBottom: 18,
    flexWrap: 'wrap',
  },
  kicker: {
    color: '#2563eb',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    fontSize: 12,
    fontWeight: 950,
  },
  title: {
    margin: '6px 0',
    fontSize: 'clamp(36px, 6vw, 64px)',
    lineHeight: 0.95,
  },
  subtitle: {
    color: '#58708f',
    fontWeight: 750,
    margin: 0,
  },
  heroActions: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
  },
  panel: {
    background: 'rgba(255,255,255,0.96)',
    border: '1px solid #d8e5f4',
    borderRadius: 24,
    padding: 'clamp(16px, 3vw, 28px)',
    boxShadow: '0 16px 44px rgba(16, 48, 90, 0.08)',
    marginBottom: 18,
  },
  panelHead: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 18,
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    marginBottom: 18,
  },
  sectionTitle: {
    margin: '4px 0',
    fontSize: 'clamp(24px, 4vw, 34px)',
  },
  muted: {
    color: '#61728a',
    fontWeight: 750,
    margin: 0,
  },
  weekPicker: {
    minWidth: 220,
  },
  weekQuickActions: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
    marginTop: 8,
  },
  menuSetTabs: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  menuEditorGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(250px, 100%), 1fr))',
    gap: 12,
  },
  menuEditorCard: {
    border: '1px solid #dbe7f5',
    borderRadius: 18,
    padding: 14,
    background: 'linear-gradient(135deg, #ffffff 0%, #f8fbff 100%)',
    boxShadow: '0 10px 28px rgba(16, 48, 90, 0.05)',
  },
  menuDayHead: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'center',
    marginBottom: 12,
    color: '#07142d',
    fontWeight: 950,
  },
  menuSaveBar: {
    marginTop: 14,
    border: '1px solid #d6e7ff',
    borderRadius: 18,
    padding: 14,
    background: '#eff6ff',
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
    flexWrap: 'wrap',
    color: '#1e3a8a',
    fontWeight: 850,
  },
  collapsedMenuNote: {
    border: '1px dashed #bfdbfe',
    borderRadius: 18,
    padding: '14px 16px',
    background: 'linear-gradient(135deg, #f8fbff 0%, #eff6ff 100%)',
    color: '#35537a',
    fontWeight: 850,
    lineHeight: 1.45,
  },
  smallGhostBtn: {
    border: '1px solid #cbd8e8',
    borderRadius: 999,
    padding: '9px 12px',
    background: '#f8fbff',
    color: '#0b1730',
    fontWeight: 950,
    cursor: 'pointer',
    fontSize: 12,
  },
  label: {
    display: 'block',
    color: '#334762',
    fontWeight: 950,
    marginBottom: 8,
    fontSize: 13,
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #cbd8e8',
    borderRadius: 14,
    padding: '13px 14px',
    fontSize: 16,
    fontWeight: 750,
    background: '#fff',
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(210px, 100%), 1fr))',
    gap: 12,
  },
  summaryCard: {
    border: '1px solid #dce8f6',
    borderRadius: 18,
    padding: 14,
    background: 'linear-gradient(135deg, #ffffff 0%, #f8fbff 100%)',
    boxShadow: '0 10px 28px rgba(16, 48, 90, 0.06)',
  },
  summaryBranch: {
    fontWeight: 950,
    fontSize: 18,
    marginBottom: 12,
  },
  summaryNumbers: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 10,
  },
  mealCountBox: {
    minWidth: 0,
    border: '1px solid #dbe7f5',
    borderRadius: 14,
    padding: '10px 12px',
    background: '#fff',
    display: 'grid',
    gap: 4,
  },
  mealCountLabel: {
    color: '#536985',
    fontSize: 12,
    fontWeight: 950,
    textTransform: 'uppercase',
    letterSpacing: '.04em',
  },
  mealCountNumber: {
    color: '#07142d',
    fontSize: 'clamp(24px, 5vw, 32px)',
    lineHeight: 1,
    fontWeight: 950,
  },
  tabs: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
    marginBottom: 14,
  },
  tab: {
    border: '1px solid #cbd8e8',
    borderRadius: 999,
    padding: '11px 16px',
    background: '#fff',
    fontWeight: 950,
    cursor: 'pointer',
  },
  tabActive: {
    background: '#0f172a',
    color: '#fff',
    borderColor: '#0f172a',
  },
  printBtn: {
    marginLeft: 'auto',
    border: '1px solid #bfdbfe',
    borderRadius: 999,
    padding: '11px 16px',
    background: '#eff6ff',
    color: '#1d4ed8',
    fontWeight: 950,
    cursor: 'pointer',
  },
  totalBar: {
    display: 'flex',
    gap: 14,
    flexWrap: 'wrap',
    background: '#eff6ff',
    border: '1px solid #d6e7ff',
    borderRadius: 16,
    padding: 14,
    fontWeight: 950,
    marginBottom: 14,
  },
  empty: {
    padding: 28,
    border: '1px dashed #cbd5e1',
    borderRadius: 18,
    textAlign: 'center',
    color: '#64748b',
    fontWeight: 900,
  },
  orderList: {
    display: 'grid',
    gap: 14,
  },
  orderCard: {
    border: '1px solid #dbe7f5',
    borderRadius: 20,
    padding: 16,
    background: 'linear-gradient(135deg, #ffffff 0%, #fbfdff 100%)',
    boxShadow: '0 10px 28px rgba(16, 48, 90, 0.06)',
  },
  orderTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 14,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  staffName: {
    fontSize: 22,
    fontWeight: 950,
  },
  cardActions: {
    display: 'flex',
    gap: 8,
  },
  smallBtn: {
    border: '1px solid #cbd8e8',
    borderRadius: 12,
    padding: '9px 12px',
    background: '#fff',
    fontWeight: 900,
    cursor: 'pointer',
  },
  dangerBtn: {
    border: '1px solid #fecaca',
    borderRadius: 12,
    padding: '9px 12px',
    background: '#fff1f2',
    color: '#dc2626',
    fontWeight: 900,
    cursor: 'pointer',
  },
  dayGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))',
    gap: 8,
  },
  dayCell: {
    border: '1px solid #e2e8f0',
    borderRadius: 14,
    padding: 12,
    display: 'grid',
    gap: 4,
  },
  note: {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    background: '#fff7ed',
    color: '#9a3412',
    fontWeight: 800,
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 12,
  },
  field: {
    display: 'grid',
    gap: 6,
    marginBottom: 12,
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 80,
    background: 'rgba(15, 23, 42, 0.46)',
    display: 'grid',
    placeItems: 'center',
    padding: 14,
  },
  modal: {
    width: 'min(960px, 100%)',
    maxHeight: '92vh',
    overflow: 'auto',
    background: '#fff',
    borderRadius: 26,
    border: '1px solid #d8e5f4',
    padding: 'clamp(18px, 4vw, 30px)',
    boxShadow: '0 26px 80px rgba(15, 23, 42, 0.28)',
  },
  modalHead: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  closeBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    border: '1px solid #cbd8e8',
    background: '#fff',
    fontWeight: 950,
    cursor: 'pointer',
  },
  editMeals: {
    display: 'grid',
    gap: 10,
    margin: '16px 0',
  },
  editMealRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
    gap: 10,
    alignItems: 'center',
  },
  choiceGroup: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))',
    gap: 8,
  },
  choiceBtn: {
    border: '1px solid #cbd8e8',
    borderRadius: 12,
    padding: '10px 8px',
    background: '#fff',
    fontWeight: 900,
    cursor: 'pointer',
  },
  choiceBtnActive: {
    background: '#2563eb',
    borderColor: '#2563eb',
    color: '#fff',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    flexWrap: 'wrap',
  },
  primaryBtn: {
    border: 0,
    borderRadius: 14,
    padding: '13px 18px',
    background: '#0f172a',
    color: '#fff',
    fontWeight: 950,
    cursor: 'pointer',
  },
  secondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    textDecoration: 'none',
    border: '1px solid #cbd8e8',
    borderRadius: 14,
    padding: '13px 18px',
    background: '#fff',
    color: '#07142d',
    fontWeight: 950,
    cursor: 'pointer',
  },
  secondaryBtnActive: {
    background: '#0f172a',
    borderColor: '#0f172a',
    color: '#ffffff',
  },
  errorBox: {
    background: '#fff1f2',
    border: '1px solid #fecdd3',
    color: '#be123c',
    borderRadius: 16,
    padding: 14,
    fontWeight: 900,
    marginBottom: 16,
  },
  successBox: {
    background: '#ecfdf5',
    border: '1px solid #bbf7d0',
    color: '#047857',
    borderRadius: 16,
    padding: 14,
    fontWeight: 900,
    marginBottom: 16,
  },
};
