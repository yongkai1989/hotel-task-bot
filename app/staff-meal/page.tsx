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
      <section style={styles.topBar}>
        <div style={styles.brandBlock}>
          <div style={styles.logoMark}>HC</div>
          <div>
            <div style={styles.brandName}>Hallmark Crown Hotel</div>
            <div style={styles.brandSub}>Staff Dining</div>
          </div>
        </div>
        <div style={styles.topMeta}>Weekly meal order</div>
      </section>

      <section style={styles.hero}>
        <div style={styles.heroCopy}>
          <div style={styles.eyebrow}>Staff Meal Concierge</div>
          <h1 style={styles.title}>Reserve your meals for the week.</h1>
          <p style={styles.subText}>
            Select lunch, dinner, or both for each working day. Your order is saved under your branch for kitchen planning.
          </p>
          <div style={styles.heroChips}>
            <span style={styles.heroChip}>One submission per branch</span>
            <span style={styles.heroChip}>Screenshot confirmation</span>
            <span style={styles.heroChip}>Manager-assisted changes</span>
          </div>
        </div>

        <aside style={styles.weekPanel}>
          <div style={styles.weekPanelTop}>
            <span style={styles.weekKicker}>Current Order Week</span>
            <span style={styles.weekStatus}>Open</span>
          </div>
          <div style={styles.weekDateLine}>
            <strong>{formatShortDate(cycle.order_week_start)}</strong>
            <span>to</span>
            <strong>{formatShortDate(cycle.order_week_end)}</strong>
          </div>
          <div style={styles.weekFinePrint}>Last call: {cycle.closes_at_label || '-'}</div>
          <div style={styles.weekRule}>
            Lunch + Dinner is only for approved 12-hour shifts.
          </div>
        </aside>
      </section>

      {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}

      <section style={styles.card}>
        <div style={styles.sectionHeader}>
          <div>
            <div style={styles.eyebrow}>Step 1</div>
            <h2 style={styles.sectionTitle}>Tell us who is ordering</h2>
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

        <div style={styles.sectionHeader}>
          <div>
            <div style={styles.eyebrow}>Step 2</div>
            <h2 style={styles.sectionTitle}>Build your weekly meal plan</h2>
          </div>
        </div>

        <div style={styles.notice}>
          <strong>Reminder:</strong> Lunch + Dinner is reserved only for staff working approved 12-hour shifts.
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
      'radial-gradient(circle at 12% 0%, rgba(241, 222, 177, 0.42) 0, rgba(241, 222, 177, 0) 34%), radial-gradient(circle at 90% 10%, rgba(191, 219, 254, 0.55) 0, rgba(191, 219, 254, 0) 32%), linear-gradient(180deg, #f7f2ea 0%, #eef4fb 38%, #ffffff 100%)',
    color: '#111827',
    padding: 'clamp(14px, 4vw, 46px)',
    fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  topBar: {
    maxWidth: 1180,
    margin: '0 auto 14px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 14,
    padding: '10px 4px',
  },
  brandBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  logoMark: {
    width: 46,
    height: 46,
    borderRadius: 18,
    display: 'grid',
    placeItems: 'center',
    background: 'linear-gradient(145deg, #18120c 0%, #3b2a18 100%)',
    color: '#f8e7bd',
    fontWeight: 950,
    letterSpacing: 0.5,
    boxShadow: '0 12px 30px rgba(59, 42, 24, 0.22)',
  },
  brandName: {
    textTransform: 'uppercase',
    letterSpacing: 1.8,
    color: '#8a5a20',
    fontWeight: 950,
    fontSize: 12,
  },
  brandSub: {
    color: '#111827',
    fontWeight: 950,
    fontSize: 18,
    lineHeight: 1.1,
  },
  topMeta: {
    border: '1px solid rgba(145, 104, 45, 0.25)',
    background: 'rgba(255, 255, 255, 0.72)',
    borderRadius: 999,
    padding: '10px 14px',
    color: '#6b4b25',
    fontWeight: 900,
    whiteSpace: 'nowrap',
  },
  hero: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))',
    gap: 16,
    alignItems: 'stretch',
    background:
      'linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(255,252,246,0.94) 48%, rgba(239,246,255,0.9) 100%)',
    border: '1px solid rgba(190, 154, 100, 0.32)',
    borderRadius: 34,
    padding: 'clamp(20px, 4vw, 40px)',
    boxShadow: '0 26px 80px rgba(71, 55, 33, 0.16)',
    margin: '0 auto 16px',
    maxWidth: 1180,
    overflow: 'hidden',
    position: 'relative',
  },
  heroCopy: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
  },
  eyebrow: {
    color: '#a16207',
    textTransform: 'uppercase',
    letterSpacing: 2.4,
    fontWeight: 900,
    fontSize: 12,
  },
  title: {
    margin: '10px 0',
    fontSize: 'clamp(40px, 7vw, 78px)',
    lineHeight: 0.9,
    letterSpacing: '-0.045em',
    maxWidth: 740,
  },
  subText: {
    color: '#516071',
    fontWeight: 700,
    fontSize: 'clamp(16px, 2vw, 19px)',
    lineHeight: 1.55,
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
    border: '1px solid rgba(145, 104, 45, 0.2)',
    background: 'rgba(255,255,255,0.74)',
    borderRadius: 999,
    padding: '9px 12px',
    color: '#50391b',
    fontSize: 13,
    fontWeight: 900,
  },
  weekPanel: {
    background: 'linear-gradient(145deg, #17110b 0%, #24304c 100%)',
    color: '#fffaf0',
    borderRadius: 30,
    padding: 'clamp(22px, 4vw, 32px)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    justifyContent: 'center',
    boxShadow: '0 20px 48px rgba(23, 17, 11, 0.3)',
    minHeight: 250,
  },
  weekPanelTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  weekKicker: {
    color: '#f6d98b',
    textTransform: 'uppercase',
    letterSpacing: 1.8,
    fontSize: 11,
    fontWeight: 950,
  },
  weekStatus: {
    border: '1px solid rgba(246, 217, 139, 0.36)',
    background: 'rgba(255, 255, 255, 0.08)',
    color: '#fef3c7',
    borderRadius: 999,
    padding: '7px 10px',
    fontWeight: 950,
    fontSize: 12,
  },
  weekDateLine: {
    display: 'grid',
    gap: 4,
    fontSize: 'clamp(22px, 4vw, 34px)',
    lineHeight: 1.05,
  },
  weekFinePrint: {
    color: '#cbd5e1',
    fontWeight: 850,
  },
  weekRule: {
    marginTop: 8,
    borderTop: '1px solid rgba(255, 255, 255, 0.14)',
    paddingTop: 14,
    color: '#fef3c7',
    fontWeight: 850,
    lineHeight: 1.45,
  },
  orderPill: {
    border: '1px solid #e8cf9f',
    background: '#fff8ea',
    color: '#9a5b0b',
    borderRadius: 999,
    padding: '10px 14px',
    fontWeight: 950,
    whiteSpace: 'nowrap',
  },
  card: {
    background: 'rgba(255,255,255,0.96)',
    border: '1px solid rgba(205, 180, 139, 0.44)',
    borderRadius: 34,
    padding: 'clamp(18px, 3vw, 34px)',
    boxShadow: '0 24px 72px rgba(71, 55, 33, 0.12)',
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
    fontSize: 'clamp(24px, 4vw, 36px)',
    lineHeight: 0.98,
    letterSpacing: '-0.025em',
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
    border: '1px solid #d9c8ad',
    borderRadius: 20,
    padding: '16px 17px',
    fontSize: 16,
    fontWeight: 750,
    outline: 'none',
    background: 'linear-gradient(180deg, #ffffff 0%, #fffdf8 100%)',
  },
  notice: {
    background: 'linear-gradient(135deg, #fff8e8 0%, #fffdf7 100%)',
    border: '1px solid #efd2a0',
    color: '#7c3f05',
    borderRadius: 22,
    padding: '14px 16px',
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
    border: '1px solid #e4d5bc',
    borderRadius: 26,
    padding: 16,
    background: 'linear-gradient(180deg, #ffffff 0%, #fffaf2 100%)',
    boxShadow: '0 16px 34px rgba(71, 55, 33, 0.08)',
  },
  dayInfo: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
  },
  dayBadge: {
    width: 44,
    height: 44,
    borderRadius: 16,
    display: 'grid',
    placeItems: 'center',
    background: '#f8ead0',
    color: '#9a5b0b',
    fontWeight: 950,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  dayTitle: {
    fontWeight: 950,
    fontSize: 16,
  },
  dayChoice: {
    color: '#6b7280',
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
    border: '1px solid #dfcfb3',
    background: 'rgba(255,255,255,0.9)',
    borderRadius: 18,
    padding: '12px 11px',
    fontWeight: 900,
    color: '#16243b',
    cursor: 'pointer',
    display: 'grid',
    gap: 3,
    textAlign: 'left',
  },
  choiceBtnActive: {
    background: 'linear-gradient(135deg, #17110b 0%, #2f2419 100%)',
    borderColor: '#17110b',
    color: '#fff',
    boxShadow: '0 12px 26px rgba(47, 36, 25, 0.25)',
  },
  footerBar: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    alignItems: 'center',
    background: 'linear-gradient(135deg, #17110b 0%, #24304c 100%)',
    border: '1px solid rgba(246, 217, 139, 0.28)',
    borderRadius: 26,
    padding: 16,
    flexWrap: 'wrap',
    color: '#fff',
  },
  footerTotal: {
    fontSize: 22,
    fontWeight: 950,
  },
  footerHint: {
    color: '#cbd5e1',
    fontWeight: 800,
  },
  primaryBtn: {
    border: 0,
    borderRadius: 20,
    padding: '15px 22px',
    background: 'linear-gradient(135deg, #f4d27b 0%, #d59a2c 100%)',
    color: '#17110b',
    fontWeight: 950,
    fontSize: 15,
    cursor: 'pointer',
    boxShadow: '0 16px 34px rgba(213, 154, 44, 0.25)',
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
    background: 'linear-gradient(180deg, #ffffff 0%, #fffaf1 100%)',
    border: '1px solid #e4d5bc',
    borderRadius: 32,
    padding: 'clamp(22px, 4vw, 42px)',
    boxShadow: '0 24px 70px rgba(71, 55, 33, 0.14)',
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
