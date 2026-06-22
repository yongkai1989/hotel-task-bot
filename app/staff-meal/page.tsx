'use client';

import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';

type Branch = 'Crown' | 'Leisure' | 'View' | 'Express';
type MealChoice = 'none' | 'lunch' | 'dinner' | 'both';

type Cycle = {
  order_week_start: string;
  order_week_end: string;
  closes_at_label: string;
};

type SubmittedOrder = {
  id: string;
  branch: Branch;
  staff_name: string;
  meals: Record<string, MealChoice>;
  order_week_start: string;
  order_week_end: string;
};

const BRANCHES: Branch[] = ['Crown', 'Leisure', 'View', 'Express'];
const EMPTY_CYCLE: Cycle = {
  order_week_start: '',
  order_week_end: '',
  closes_at_label: '',
};

function formatLongDate(value: string) {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function weekDates(cycle: Cycle) {
  if (!cycle.order_week_start) return [];
  return Array.from({ length: 7 }, (_, index) => addDays(cycle.order_week_start, index));
}

function mealLabel(choice: MealChoice) {
  if (choice === 'lunch') return 'Lunch';
  if (choice === 'dinner') return 'Dinner';
  if (choice === 'both') return 'Lunch + Dinner';
  return 'No meal';
}

function countMeals(meals: Record<string, MealChoice>) {
  return Object.values(meals).reduce(
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

export default function StaffMealPage() {
  const [cycle, setCycle] = useState<Cycle>(EMPTY_CYCLE);
  const [branch, setBranch] = useState<Branch>('Crown');
  const [staffName, setStaffName] = useState('');
  const [notes, setNotes] = useState('');
  const [meals, setMeals] = useState<Record<string, MealChoice>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [submitted, setSubmitted] = useState<SubmittedOrder | null>(null);

  const dates = useMemo(() => weekDates(cycle), [cycle]);
  const totals = useMemo(() => countMeals(meals), [meals]);

  useEffect(() => {
    let mounted = true;

    async function loadCycle() {
      try {
        setLoading(true);
        const res = await fetch('/api/staff-meal/orders', { cache: 'no-store' });
        const json = await res.json();
        if (!mounted) return;
        if (!json.ok) throw new Error(json.error || 'Failed to load order week.');
        setCycle(json.cycle);
        const nextMeals: Record<string, MealChoice> = {};
        weekDates(json.cycle).forEach((date) => {
          nextMeals[date] = 'none';
        });
        setMeals(nextMeals);
      } catch (err: any) {
        setErrorMsg(err?.message || 'Failed to load order week.');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadCycle();
    return () => {
      mounted = false;
    };
  }, []);

  function updateMeal(date: string, choice: MealChoice) {
    setMeals((prev) => ({ ...prev, [date]: choice }));
  }

  async function submitOrder() {
    try {
      setSaving(true);
      setErrorMsg('');

      const res = await fetch('/api/staff-meal/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch,
          staff_name: staffName,
          meals,
          notes,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to submit staff meal order.');
      setSubmitted(json.order);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to submit staff meal order.');
    } finally {
      setSaving(false);
    }
  }

  if (submitted) {
    const submittedTotals = countMeals(submitted.meals || {});
    return (
      <main style={styles.page}>
        <section style={styles.confirmCard}>
          <div style={styles.successIcon}>OK</div>
          <div style={styles.eyebrow}>Staff Meal Order Confirmed</div>
          <h1 style={styles.confirmTitle}>Please screenshot this page</h1>
          <p style={styles.subText}>
            Changes after submission must be handled by your manager.
          </p>

          <div style={styles.confirmGrid}>
            <div style={styles.summaryBox}>
              <span style={styles.summaryLabel}>Branch</span>
              <strong>{submitted.branch}</strong>
            </div>
            <div style={styles.summaryBox}>
              <span style={styles.summaryLabel}>Name</span>
              <strong>{submitted.staff_name}</strong>
            </div>
            <div style={styles.summaryBox}>
              <span style={styles.summaryLabel}>Order Week</span>
              <strong>{formatLongDate(submitted.order_week_start)} - {formatLongDate(submitted.order_week_end)}</strong>
            </div>
            <div style={styles.summaryBox}>
              <span style={styles.summaryLabel}>Total</span>
              <strong>{submittedTotals.lunch} lunch / {submittedTotals.dinner} dinner</strong>
            </div>
          </div>

          <div style={styles.orderList}>
            {weekDates({
              order_week_start: submitted.order_week_start,
              order_week_end: submitted.order_week_end,
              closes_at_label: '',
            }).map((date) => (
              <div key={date} style={styles.confirmRow}>
                <span>{formatLongDate(date)}</span>
                <strong>{mealLabel(submitted.meals?.[date] || 'none')}</strong>
              </div>
            ))}
          </div>

          <button type="button" style={styles.primaryBtn} onClick={() => window.location.reload()}>
            Submit Another Order
          </button>
        </section>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div>
          <div style={styles.eyebrow}>Hallmark Staff Meal</div>
          <h1 style={styles.title}>Weekly Meal Order</h1>
          <p style={styles.subText}>
            Choose your lunch and dinner for the displayed order week. One name can submit once per branch.
          </p>
        </div>
        <div style={styles.weekBadge}>
          <span>Ordering For</span>
          <strong>{formatLongDate(cycle.order_week_start)} - {formatLongDate(cycle.order_week_end)}</strong>
          <small>Cycle closes {cycle.closes_at_label}</small>
        </div>
      </section>

      {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}

      <section style={styles.card}>
        <div style={styles.formGrid}>
          <label style={styles.field}>
            <span style={styles.label}>Branch</span>
            <select value={branch} onChange={(event) => setBranch(event.target.value as Branch)} style={styles.input}>
              {BRANCHES.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Staff Name</span>
            <input
              value={staffName}
              onChange={(event) => setStaffName(event.target.value)}
              placeholder="Enter your name"
              style={styles.input}
            />
          </label>
        </div>

        <div style={styles.notice}>
          Selecting <strong>Lunch + Dinner</strong> is reserved only for staff working approved 12-hour shifts.
        </div>

        <div style={styles.mealGrid}>
          {loading ? (
            <div style={styles.emptyState}>Loading order week...</div>
          ) : (
            dates.map((date) => (
              <article key={date} style={styles.dayCard}>
                <div>
                  <div style={styles.dayTitle}>{formatLongDate(date)}</div>
                </div>
                <div style={styles.choiceGrid}>
                  {(['none', 'lunch', 'dinner', 'both'] as MealChoice[]).map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      onClick={() => updateMeal(date, choice)}
                      style={{
                        ...styles.choiceBtn,
                        ...(meals[date] === choice ? styles.choiceBtnActive : {}),
                      }}
                    >
                      {mealLabel(choice)}
                    </button>
                  ))}
                </div>
              </article>
            ))
          )}
        </div>

        <label style={styles.field}>
          <span style={styles.label}>Notes</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Optional notes for manager"
            style={{ ...styles.input, minHeight: 88, resize: 'vertical' }}
          />
        </label>

        <div style={styles.footerBar}>
          <div>
            <div style={styles.footerTotal}>{totals.lunch} lunch / {totals.dinner} dinner</div>
            <div style={styles.footerHint}>Please check carefully before submitting.</div>
          </div>
          <button type="button" disabled={saving || loading} onClick={submitOrder} style={styles.primaryBtn}>
            {saving ? 'Submitting...' : 'Submit Meal Order'}
          </button>
        </div>
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#eef4fb',
    color: '#07152f',
    padding: 'clamp(18px, 4vw, 48px)',
    fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  hero: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
    gap: 18,
    alignItems: 'stretch',
    background: 'linear-gradient(135deg, #ffffff 0%, #f8fbff 58%, #edf5ff 100%)',
    border: '1px solid #cfe0f3',
    borderRadius: 28,
    padding: 'clamp(22px, 4vw, 38px)',
    boxShadow: '0 18px 48px rgba(25, 75, 135, 0.12)',
    marginBottom: 18,
  },
  eyebrow: {
    color: '#2563eb',
    textTransform: 'uppercase',
    letterSpacing: 2,
    fontWeight: 900,
    fontSize: 12,
  },
  title: {
    margin: '8px 0',
    fontSize: 'clamp(36px, 7vw, 72px)',
    lineHeight: 0.95,
  },
  subText: {
    color: '#53657f',
    fontWeight: 700,
    fontSize: 16,
    lineHeight: 1.5,
    margin: 0,
  },
  weekBadge: {
    background: '#0f172a',
    color: '#fff',
    borderRadius: 24,
    padding: 22,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    justifyContent: 'center',
    boxShadow: '0 14px 34px rgba(15, 23, 42, 0.22)',
  },
  card: {
    background: '#fff',
    border: '1px solid #d6e3f3',
    borderRadius: 28,
    padding: 'clamp(18px, 3vw, 28px)',
    boxShadow: '0 16px 42px rgba(20, 48, 86, 0.09)',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
    gap: 14,
  },
  field: {
    display: 'grid',
    gap: 8,
    marginBottom: 16,
  },
  label: {
    fontWeight: 900,
    color: '#243653',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #c9d8eb',
    borderRadius: 16,
    padding: '15px 16px',
    fontSize: 16,
    fontWeight: 750,
    outline: 'none',
    background: '#fbfdff',
  },
  notice: {
    background: '#fff7ed',
    border: '1px solid #fed7aa',
    color: '#9a3412',
    borderRadius: 18,
    padding: 14,
    fontWeight: 850,
    margin: '4px 0 18px',
  },
  mealGrid: {
    display: 'grid',
    gap: 12,
    marginBottom: 18,
  },
  dayCard: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
    gap: 12,
    alignItems: 'center',
    border: '1px solid #dbe6f4',
    borderRadius: 18,
    padding: 14,
    background: '#fbfdff',
  },
  dayTitle: {
    fontWeight: 950,
    fontSize: 16,
  },
  choiceGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))',
    gap: 8,
  },
  choiceBtn: {
    border: '1px solid #cddcf0',
    background: '#fff',
    borderRadius: 14,
    padding: '12px 8px',
    fontWeight: 900,
    color: '#16243b',
    cursor: 'pointer',
  },
  choiceBtnActive: {
    background: '#2563eb',
    borderColor: '#2563eb',
    color: '#fff',
    boxShadow: '0 10px 24px rgba(37, 99, 235, 0.22)',
  },
  footerBar: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    alignItems: 'center',
    background: '#f4f8ff',
    borderRadius: 20,
    padding: 16,
  },
  footerTotal: {
    fontSize: 22,
    fontWeight: 950,
  },
  footerHint: {
    color: '#61728a',
    fontWeight: 800,
  },
  primaryBtn: {
    border: 0,
    borderRadius: 16,
    padding: '15px 22px',
    background: '#0f172a',
    color: '#fff',
    fontWeight: 950,
    fontSize: 15,
    cursor: 'pointer',
    boxShadow: '0 14px 30px rgba(15, 23, 42, 0.2)',
  },
  errorBox: {
    background: '#fff1f2',
    border: '1px solid #fecdd3',
    color: '#be123c',
    borderRadius: 18,
    padding: 14,
    fontWeight: 900,
    marginBottom: 16,
  },
  emptyState: {
    padding: 24,
    textAlign: 'center',
    color: '#64748b',
    fontWeight: 900,
    border: '1px dashed #cbd5e1',
    borderRadius: 18,
  },
  confirmCard: {
    maxWidth: 880,
    margin: '0 auto',
    background: '#fff',
    border: '1px solid #d6e3f3',
    borderRadius: 30,
    padding: 'clamp(22px, 4vw, 42px)',
    boxShadow: '0 18px 54px rgba(20, 48, 86, 0.14)',
  },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    background: '#dcfce7',
    color: '#047857',
    display: 'grid',
    placeItems: 'center',
    fontWeight: 950,
    marginBottom: 18,
  },
  confirmTitle: {
    fontSize: 'clamp(32px, 5vw, 56px)',
    margin: '8px 0',
    lineHeight: 1,
  },
  confirmGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
    gap: 12,
    margin: '22px 0',
  },
  summaryBox: {
    border: '1px solid #d9e5f3',
    borderRadius: 18,
    padding: 16,
    display: 'grid',
    gap: 8,
  },
  summaryLabel: {
    color: '#64748b',
    fontWeight: 900,
    textTransform: 'uppercase',
    fontSize: 12,
  },
  orderList: {
    display: 'grid',
    gap: 8,
    marginBottom: 22,
  },
  confirmRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    background: '#f8fbff',
    border: '1px solid #e2eaf5',
  },
};
