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

function formatShortDate(value: string) {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
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

function mealHint(choice: MealChoice) {
  if (choice === 'lunch') return 'Noon shift';
  if (choice === 'dinner') return 'Night shift';
  if (choice === 'both') return '12-hour shift only';
  return 'Rest day / no order';
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
          <div style={styles.successIcon}>✓</div>
          <div style={styles.eyebrow}>Staff Meal Order Confirmed</div>
          <h1 style={styles.confirmTitle}>Your meal order is saved</h1>
          <p style={styles.subText}>
            Please screenshot this confirmation. Changes after submission must be handled by your manager.
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
                <span>{formatShortDate(date)}</span>
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
        <div style={styles.heroCopy}>
          <div style={styles.eyebrow}>Hallmark Staff Meal</div>
          <h1 style={styles.title}>Weekly Meal Order</h1>
          <p style={styles.subText}>
            Choose your meals for the week ahead. Simple, clear, and saved under your branch.
          </p>
          <div style={styles.heroChips}>
            <span style={styles.heroChip}>One submission per name</span>
            <span style={styles.heroChip}>Screenshot after submit</span>
            <span style={styles.heroChip}>Manager edits only</span>
          </div>
        </div>
        <div style={styles.weekBadge}>
          <span style={styles.weekKicker}>Ordering Week</span>
          <strong>{formatLongDate(cycle.order_week_start)}</strong>
          <em>to</em>
          <strong>{formatLongDate(cycle.order_week_end)}</strong>
          <small>Last call: {cycle.closes_at_label || '-'}</small>
        </div>
      </section>

      {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}

      <section style={styles.card}>
        <div style={styles.sectionHeader}>
          <div>
            <div style={styles.eyebrow}>Your Details</div>
            <h2 style={styles.sectionTitle}>Start with branch and name</h2>
          </div>
          <div style={styles.orderPill}>{totals.lunch + totals.dinner} meal(s) selected</div>
        </div>

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
          <strong>Reminder:</strong> Lunch + Dinner is reserved only for staff working approved 12-hour shifts.
        </div>

        <div style={styles.sectionHeader}>
          <div>
            <div style={styles.eyebrow}>Meal Plan</div>
            <h2 style={styles.sectionTitle}>Choose your meals</h2>
          </div>
        </div>

        <div style={styles.mealGrid}>
          {loading ? (
            <div style={styles.emptyState}>Loading order week...</div>
          ) : (
            dates.map((date) => (
              <article key={date} style={styles.dayCard}>
                <div style={styles.dayInfo}>
                  <span style={styles.dayBadge}>{formatShortDate(date).split(' ')[0]}</span>
                  <div>
                    <div style={styles.dayTitle}>{formatShortDate(date).replace(',', '')}</div>
                    <div style={styles.dayChoice}>{mealLabel(meals[date] || 'none')}</div>
                  </div>
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
                      <span>{mealLabel(choice)}</span>
                      <small>{mealHint(choice)}</small>
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
            placeholder="Optional notes, for example shift changes or special remarks"
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
    background:
      'radial-gradient(circle at top left, rgba(218, 234, 255, 0.95) 0, rgba(248, 251, 255, 0) 34%), linear-gradient(180deg, #f3f7fc 0%, #eef4fb 42%, #ffffff 100%)',
    color: '#07152f',
    padding: 'clamp(14px, 4vw, 46px)',
    fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  hero: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))',
    gap: 16,
    alignItems: 'stretch',
    background: 'linear-gradient(135deg, rgba(255,255,255,0.98) 0%, rgba(250,253,255,0.94) 58%, rgba(232,242,255,0.92) 100%)',
    border: '1px solid #cfe0f3',
    borderRadius: 30,
    padding: 'clamp(20px, 4vw, 40px)',
    boxShadow: '0 22px 65px rgba(25, 75, 135, 0.13)',
    margin: '0 auto 16px',
    maxWidth: 1180,
    overflow: 'hidden',
  },
  heroCopy: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
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
    fontSize: 'clamp(34px, 7vw, 68px)',
    lineHeight: 0.92,
    letterSpacing: '-0.02em',
  },
  subText: {
    color: '#53657f',
    fontWeight: 700,
    fontSize: 16,
    lineHeight: 1.5,
    margin: 0,
    maxWidth: 620,
  },
  heroChips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 20,
  },
  heroChip: {
    border: '1px solid #d7e5f7',
    background: '#ffffff',
    borderRadius: 999,
    padding: '8px 11px',
    color: '#334155',
    fontSize: 13,
    fontWeight: 900,
  },
  weekBadge: {
    background: 'linear-gradient(145deg, #0f172a 0%, #172554 100%)',
    color: '#fff',
    borderRadius: 26,
    padding: 'clamp(18px, 3vw, 26px)',
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    justifyContent: 'center',
    boxShadow: '0 18px 42px rgba(15, 23, 42, 0.24)',
  },
  weekKicker: {
    color: '#93c5fd',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    fontSize: 11,
    fontWeight: 950,
  },
  orderPill: {
    border: '1px solid #bfdbfe',
    background: '#eff6ff',
    color: '#1d4ed8',
    borderRadius: 999,
    padding: '9px 13px',
    fontWeight: 950,
    whiteSpace: 'nowrap',
  },
  card: {
    background: '#fff',
    border: '1px solid #d6e3f3',
    borderRadius: 30,
    padding: 'clamp(16px, 3vw, 30px)',
    boxShadow: '0 18px 54px rgba(20, 48, 86, 0.1)',
    maxWidth: 1180,
    margin: '0 auto',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 14,
  },
  sectionTitle: {
    margin: '4px 0 0',
    fontSize: 'clamp(22px, 4vw, 32px)',
    lineHeight: 1,
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
    borderRadius: 18,
    padding: '15px 16px',
    fontSize: 16,
    fontWeight: 750,
    outline: 'none',
    background: 'linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)',
  },
  notice: {
    background: 'linear-gradient(135deg, #fff7ed 0%, #fffaf4 100%)',
    border: '1px solid #fed7aa',
    color: '#9a3412',
    borderRadius: 18,
    padding: '13px 15px',
    fontWeight: 850,
    margin: '4px 0 22px',
  },
  mealGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(330px, 100%), 1fr))',
    gap: 12,
    marginBottom: 18,
  },
  dayCard: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: 12,
    border: '1px solid #dbe6f4',
    borderRadius: 22,
    padding: 14,
    background: 'linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)',
    boxShadow: '0 10px 26px rgba(20, 48, 86, 0.06)',
  },
  dayInfo: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
  },
  dayBadge: {
    width: 44,
    height: 44,
    borderRadius: 15,
    display: 'grid',
    placeItems: 'center',
    background: '#eaf2ff',
    color: '#1d4ed8',
    fontWeight: 950,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  dayTitle: {
    fontWeight: 950,
    fontSize: 16,
  },
  dayChoice: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: 850,
    marginTop: 2,
  },
  choiceGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 8,
  },
  choiceBtn: {
    border: '1px solid #cddcf0',
    background: '#ffffff',
    borderRadius: 16,
    padding: '11px 10px',
    fontWeight: 900,
    color: '#16243b',
    cursor: 'pointer',
    display: 'grid',
    gap: 3,
    textAlign: 'left',
  },
  choiceBtnActive: {
    background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
    borderColor: '#2563eb',
    color: '#fff',
    boxShadow: '0 10px 24px rgba(37, 99, 235, 0.22)',
  },
  footerBar: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    alignItems: 'center',
    background: 'linear-gradient(135deg, #f4f8ff 0%, #eef6ff 100%)',
    border: '1px solid #d9e9ff',
    borderRadius: 22,
    padding: 16,
    flexWrap: 'wrap',
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
    borderRadius: 18,
    padding: '15px 22px',
    background: 'linear-gradient(135deg, #0f172a 0%, #172554 100%)',
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
    maxWidth: 1180,
    marginLeft: 'auto',
    marginRight: 'auto',
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
    borderRadius: 32,
    padding: 'clamp(22px, 4vw, 42px)',
    boxShadow: '0 18px 54px rgba(20, 48, 86, 0.14)',
  },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 26,
    background: '#dcfce7',
    color: '#047857',
    display: 'grid',
    placeItems: 'center',
    fontWeight: 950,
    fontSize: 34,
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
