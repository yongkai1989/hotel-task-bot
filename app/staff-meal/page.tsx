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
  notes?: string;
  created_at?: string;
};

type MealMenuDay = {
  day_index: number;
  menu_text: string;
};

const BRANCHES: Branch[] = ['Crown', 'Leisure', 'View', 'Express'];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
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

function mealShortLabel(choice: MealChoice) {
  if (choice === 'lunch') return 'Lunch';
  if (choice === 'dinner') return 'Dinner';
  if (choice === 'both') return 'Both';
  return 'Off';
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

function orderHasMeal(order: SubmittedOrder) {
  const totals = countMeals(order.meals || {});
  return totals.lunch + totals.dinner > 0;
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
  const [listingOpen, setListingOpen] = useState(false);
  const [listingLoading, setListingLoading] = useState(false);
  const [listingOrders, setListingOrders] = useState<SubmittedOrder[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuSet, setMenuSet] = useState<'A' | 'B'>('A');
  const [weeklyMenu, setWeeklyMenu] = useState<MealMenuDay[]>([]);

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
        setMenuSet(json.menu_set || 'A');
        setWeeklyMenu(json.menu || []);
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

  async function loadOrderListing() {
    try {
      setListingOpen(true);
      setListingLoading(true);
      setErrorMsg('');
      const res = await fetch('/api/staff-meal/orders?public_listing=1', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load order listing.');
      setCycle(json.cycle || cycle);
      setListingOrders(json.orders || []);
      setMenuSet(json.menu_set || 'A');
      setWeeklyMenu(json.menu || []);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load order listing.');
    } finally {
      setListingLoading(false);
    }
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

          <div style={styles.confirmActions}>
            <button type="button" style={styles.primaryBtn} onClick={() => window.location.reload()}>
              Submit Another Order
            </button>
            <button type="button" style={styles.secondaryWideBtn} onClick={loadOrderListing}>
              Order Listing
            </button>
          </div>

          {listingOpen ? (
            <div style={{ marginTop: 16 }}>
              {listingLoading ? (
                <div style={styles.emptyState}>Loading order listing...</div>
              ) : (
                <div style={styles.branchListingGrid}>
                  {BRANCHES.map((branchName) => {
                    const branchOrders = listingOrders
                      .filter((order) => order.branch === branchName)
                      .filter(orderHasMeal);
                    return (
                      <article key={branchName} style={styles.branchListingCard}>
                        <div style={styles.branchName}>{branchName}</div>
                        {branchOrders.length === 0 ? (
                          <div style={styles.branchEmpty}>No orders yet.</div>
                        ) : (
                          <div style={styles.staffOrderList}>
                            {branchOrders.map((order) => (
                              <div key={order.id} style={styles.staffOrderCard}>
                                <div style={styles.staffOrderTop}>
                                  <strong>{order.staff_name}</strong>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div style={styles.heroCopy}>
          <div style={styles.brandBlock}>
            <div style={styles.logoMark}>HC</div>
            <div>
              <div style={styles.brandName}>Hallmark Crown Hotel</div>
              <div style={styles.brandSub}>Staff Meal Order</div>
            </div>
          </div>
          <h1 style={styles.title}>Select your meals for the week</h1>
          <p style={styles.subText}>Choose lunch, dinner, or both. Please screenshot the confirmation after submitting.</p>
          <div style={styles.heroButtonRow}>
            <button type="button" style={styles.secondaryHeroBtn} onClick={loadOrderListing}>
              Order Listing
            </button>
            <button type="button" style={styles.secondaryHeroBtn} onClick={() => setMenuOpen((value) => !value)}>
              Weekly Menu
            </button>
          </div>
        </div>

        <aside style={styles.weekPanel}>
          <span style={styles.weekKicker}>Current Order Week</span>
          <div style={styles.weekDateLine}>
            <strong>{formatShortDate(cycle.order_week_start)}</strong>
            <span>to</span>
            <strong>{formatShortDate(cycle.order_week_end)}</strong>
          </div>
          <div style={styles.weekFinePrint}>Last call: {cycle.closes_at_label || '-'}</div>
        </aside>
      </section>

      {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}

      {menuOpen ? (
        <section style={styles.menuPanel}>
          <div style={styles.listingHeader}>
            <div>
              <div style={styles.eyebrow}>Weekly Menu</div>
              <h2 style={styles.sectionTitle}>Set {menuSet}</h2>
              <p style={styles.listingSub}>
                Assigned for {formatLongDate(cycle.order_week_start)} - {formatLongDate(cycle.order_week_end)}
              </p>
            </div>
            <button type="button" style={styles.smallDarkBtn} onClick={() => setMenuOpen(false)}>
              Close
            </button>
          </div>
          <div style={styles.menuGrid}>
            {DAY_NAMES.map((dayName, index) => {
              const item = weeklyMenu.find((row) => Number(row.day_index) === index);
              return (
                <article key={dayName} style={styles.menuDayCard}>
                  <div style={styles.menuDayName}>{dayName}</div>
                  <div style={styles.menuLine}>
                    <strong>{item?.menu_text || 'Menu not set'}</strong>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {listingOpen ? (
        <section style={styles.listingPanel}>
          <div style={styles.listingHeader}>
            <div>
              <div style={styles.eyebrow}>Order Listing</div>
              <h2 style={styles.sectionTitle}>All submitted staff meal orders</h2>
              <p style={styles.listingSub}>
                {formatLongDate(cycle.order_week_start)} - {formatLongDate(cycle.order_week_end)}
              </p>
            </div>
            <div style={styles.listingActions}>
              <button type="button" style={styles.smallGhostBtn} onClick={loadOrderListing}>
                Refresh
              </button>
              <button type="button" style={styles.smallDarkBtn} onClick={() => setListingOpen(false)}>
                Close
              </button>
            </div>
          </div>

          {listingLoading ? (
            <div style={styles.emptyState}>Loading order listing...</div>
          ) : listingOrders.filter(orderHasMeal).length === 0 ? (
            <div style={styles.emptyState}>No staff meal orders submitted for this week yet.</div>
          ) : (
            <div style={styles.branchListingGrid}>
              {BRANCHES.map((branchName) => {
                const branchOrders = listingOrders
                  .filter((order) => order.branch === branchName)
                  .filter(orderHasMeal);
                return (
                  <article key={branchName} style={styles.branchListingCard}>
                    <div style={styles.branchListingTop}>
                      <div>
                        <div style={styles.branchName}>{branchName}</div>
                        <div style={styles.branchCount}>{branchOrders.length} order(s)</div>
                      </div>
                    </div>

                    {branchOrders.length === 0 ? (
                      <div style={styles.branchEmpty}>No orders yet.</div>
                    ) : (
                      <div style={styles.staffOrderList}>
                        {branchOrders.map((order) => (
                          <div key={order.id} style={styles.staffOrderCard}>
                            <div style={styles.staffOrderTop}>
                              <strong>{order.staff_name}</strong>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      <section style={styles.orderShell}>
        <aside style={styles.sideCard}>
          <div style={styles.eyebrow}>Your Details</div>
          <h2 style={styles.sideTitle}>Submission</h2>
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

          <label style={styles.field}>
            <span style={styles.label}>Notes</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional"
              style={{ ...styles.input, minHeight: 58, resize: 'vertical' }}
            />
          </label>

          <div style={styles.compactNotice}>Lunch + Dinner is for approved 12-hour shifts only.</div>

          <div style={styles.summaryStrip}>
            <div style={styles.summaryMetric}>
              <span>Lunch</span>
              <strong>{totals.lunch}</strong>
            </div>
            <div style={styles.summaryMetric}>
              <span>Dinner</span>
              <strong>{totals.dinner}</strong>
            </div>
          </div>

          <button type="button" disabled={saving || loading} onClick={submitOrder} style={styles.primaryBtn}>
            {saving ? 'Submitting...' : 'Submit Order'}
          </button>
        </aside>

        <section style={styles.mealPanel}>
          <div style={styles.panelTop}>
            <div>
              <div style={styles.eyebrow}>Meal Plan</div>
              <h2 style={styles.sectionTitle}>Choose by day</h2>
            </div>
            <div style={styles.orderPill}>{totals.lunch + totals.dinner} selected</div>
          </div>

          <div style={styles.mealList}>
            {loading ? (
              <div style={styles.emptyState}>Loading order week...</div>
            ) : (
              dates.map((date) => (
                <article key={date} style={styles.dayRow}>
                  <div style={styles.dayInfo}>
                    <span style={styles.dayBadge}>{formatShortDate(date).slice(0, 3)}</span>
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
                        title={mealHint(choice)}
                        style={{
                          ...styles.choiceBtn,
                          ...(meals[date] === choice ? styles.choiceBtnActive : {}),
                        }}
                      >
                        {mealShortLabel(choice)}
                      </button>
                    ))}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background:
      'radial-gradient(circle at 12% 0%, rgba(244, 211, 148, 0.28) 0, rgba(244, 211, 148, 0) 31%), radial-gradient(circle at 90% 8%, rgba(191, 219, 254, 0.45) 0, rgba(191, 219, 254, 0) 30%), linear-gradient(180deg, #f7f2ea 0%, #eef4fb 45%, #ffffff 100%)',
    color: '#0f172a',
    padding: 'clamp(8px, 2.4vw, 24px)',
    fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  hero: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
    gap: 10,
    alignItems: 'stretch',
    background: 'rgba(255, 255, 255, 0.9)',
    border: '1px solid rgba(190, 154, 100, 0.28)',
    borderRadius: 20,
    padding: 'clamp(12px, 2.2vw, 20px)',
    boxShadow: '0 14px 40px rgba(51, 65, 85, 0.11)',
    margin: '0 auto 10px',
    maxWidth: 1120,
  },
  heroCopy: {
    display: 'grid',
    gap: 8,
    alignContent: 'center',
  },
  brandBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  logoMark: {
    width: 36,
    height: 36,
    borderRadius: 12,
    display: 'grid',
    placeItems: 'center',
    background: 'linear-gradient(145deg, #18120c 0%, #3b2a18 100%)',
    color: '#f8e7bd',
    fontWeight: 950,
    fontSize: 12,
    letterSpacing: 0.4,
    boxShadow: '0 10px 24px rgba(59, 42, 24, 0.2)',
  },
  brandName: {
    textTransform: 'uppercase',
    letterSpacing: 1.6,
    color: '#9a5b0b',
    fontWeight: 950,
    fontSize: 11,
  },
  brandSub: {
    color: '#0f172a',
    fontWeight: 950,
    fontSize: 16,
    lineHeight: 1.1,
  },
  title: {
    margin: 0,
    fontSize: 'clamp(28px, 7vw, 44px)',
    lineHeight: 1,
    letterSpacing: '-0.03em',
    maxWidth: 600,
  },
  subText: {
    color: '#475569',
    fontWeight: 750,
    fontSize: 14,
    lineHeight: 1.35,
    margin: 0,
    maxWidth: 610,
  },
  secondaryHeroBtn: {
    width: 'fit-content',
    border: '1px solid #d8c3a3',
    borderRadius: 999,
    padding: '9px 13px',
    background: 'rgba(255, 255, 255, 0.82)',
    color: '#1f2937',
    fontWeight: 950,
    fontSize: 13,
    cursor: 'pointer',
    boxShadow: '0 10px 22px rgba(71, 55, 33, 0.08)',
  },
  heroButtonRow: {
    display: 'flex',
    gap: 7,
    flexWrap: 'wrap',
    marginTop: 2,
  },
  menuPanel: {
    maxWidth: 1120,
    margin: '0 auto 12px',
    background: 'linear-gradient(135deg, #fffaf3 0%, #ffffff 62%, #f4f8ff 100%)',
    border: '1px solid rgba(216, 195, 163, 0.9)',
    borderRadius: 18,
    padding: 'clamp(12px, 2vw, 16px)',
    boxShadow: '0 12px 34px rgba(71, 55, 33, 0.09)',
  },
  menuGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
    gap: 8,
  },
  menuDayCard: {
    border: '1px solid #e8d8bf',
    borderRadius: 15,
    background: 'rgba(255, 255, 255, 0.9)',
    padding: 10,
    display: 'grid',
    gap: 7,
  },
  menuDayName: {
    color: '#9a5b0b',
    fontWeight: 950,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontSize: 11,
  },
  menuLine: {
    display: 'grid',
    gap: 3,
    color: '#0f172a',
  },
  weekPanel: {
    background: 'linear-gradient(145deg, #15110d 0%, #26314a 100%)',
    color: '#fffaf0',
    borderRadius: 18,
    padding: 'clamp(13px, 2vw, 18px)',
    display: 'grid',
    gap: 8,
    alignContent: 'center',
    boxShadow: '0 14px 34px rgba(23, 17, 11, 0.24)',
  },
  weekKicker: {
    color: '#f6d98b',
    textTransform: 'uppercase',
    letterSpacing: 1.8,
    fontSize: 10,
    fontWeight: 950,
  },
  weekDateLine: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    fontSize: 'clamp(17px, 4vw, 24px)',
    lineHeight: 1.05,
  },
  weekFinePrint: {
    color: '#cbd5e1',
    fontWeight: 850,
    fontSize: 13,
  },
  orderShell: {
    maxWidth: 1120,
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(290px, 100%), 1fr))',
    gap: 10,
    alignItems: 'start',
  },
  sideCard: {
    background: 'rgba(255, 255, 255, 0.94)',
    border: '1px solid rgba(203, 213, 225, 0.95)',
    borderRadius: 18,
    padding: 'clamp(12px, 2vw, 16px)',
    boxShadow: '0 12px 34px rgba(51, 65, 85, 0.09)',
  },
  mealPanel: {
    background: 'rgba(255, 255, 255, 0.94)',
    border: '1px solid rgba(203, 213, 225, 0.95)',
    borderRadius: 18,
    padding: 'clamp(12px, 2vw, 16px)',
    boxShadow: '0 12px 34px rgba(51, 65, 85, 0.09)',
  },
  panelTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  eyebrow: {
    color: '#2563eb',
    textTransform: 'uppercase',
    letterSpacing: 1.9,
    fontWeight: 950,
    fontSize: 10,
  },
  sideTitle: {
    margin: '3px 0 12px',
    fontSize: 22,
    lineHeight: 1,
    letterSpacing: '-0.025em',
  },
  sectionTitle: {
    margin: '3px 0 0',
    fontSize: 22,
    lineHeight: 1,
    letterSpacing: '-0.025em',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))',
    gap: 8,
  },
  field: {
    display: 'grid',
    gap: 6,
    marginBottom: 10,
  },
  label: {
    fontWeight: 900,
    color: '#334155',
    fontSize: 13,
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #cbd5e1',
    borderRadius: 13,
    padding: '10px 11px',
    fontSize: 14,
    fontWeight: 750,
    outline: 'none',
    background: '#ffffff',
  },
  compactNotice: {
    background: '#fff7ed',
    border: '1px solid #fed7aa',
    color: '#9a3412',
    borderRadius: 13,
    padding: '9px 11px',
    fontWeight: 850,
    fontSize: 13,
    lineHeight: 1.35,
    margin: '2px 0 10px',
  },
  summaryStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 8,
    marginBottom: 12,
  },
  summaryMetric: {
    display: 'grid',
    gap: 3,
    border: '1px solid #dbeafe',
    borderRadius: 13,
    background: '#f8fbff',
    padding: '9px 10px',
    color: '#334155',
    fontSize: 12,
    fontWeight: 900,
  },
  orderPill: {
    border: '1px solid #bfdbfe',
    background: '#eff6ff',
    color: '#1d4ed8',
    borderRadius: 999,
    padding: '7px 10px',
    fontWeight: 950,
    whiteSpace: 'nowrap',
    fontSize: 13,
  },
  mealList: {
    display: 'grid',
    gap: 7,
  },
  dayRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(205px, 100%), 1fr))',
    gap: 8,
    alignItems: 'center',
    border: '1px solid #e2e8f0',
    borderRadius: 14,
    padding: 8,
    background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)',
  },
  dayInfo: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    minWidth: 0,
  },
  dayBadge: {
    width: 34,
    height: 34,
    borderRadius: 11,
    display: 'grid',
    placeItems: 'center',
    background: '#eff6ff',
    color: '#2563eb',
    fontWeight: 950,
    fontSize: 11,
    textTransform: 'uppercase',
    flex: '0 0 auto',
  },
  dayTitle: {
    fontWeight: 950,
    fontSize: 14,
  },
  dayChoice: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: 850,
    marginTop: 1,
  },
  choiceGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 5,
  },
  choiceBtn: {
    border: '1px solid #dbe4ef',
    background: '#ffffff',
    borderRadius: 11,
    padding: '8px 5px',
    fontWeight: 950,
    color: '#172033',
    cursor: 'pointer',
    textAlign: 'center',
    fontSize: 12,
    minHeight: 35,
  },
  choiceBtnActive: {
    background: 'linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%)',
    borderColor: '#1d4ed8',
    color: '#ffffff',
    boxShadow: '0 10px 22px rgba(29, 78, 216, 0.2)',
  },
  primaryBtn: {
    width: '100%',
    border: 0,
    borderRadius: 13,
    padding: '12px 16px',
    background: 'linear-gradient(135deg, #f4d27b 0%, #d59a2c 100%)',
    color: '#17110b',
    fontWeight: 950,
    fontSize: 14,
    cursor: 'pointer',
    boxShadow: '0 12px 28px rgba(213, 154, 44, 0.22)',
  },
  secondaryWideBtn: {
    width: '100%',
    border: '1px solid #cbd5e1',
    borderRadius: 15,
    padding: '13px 18px',
    background: '#ffffff',
    color: '#172033',
    fontWeight: 950,
    fontSize: 15,
    cursor: 'pointer',
  },
  errorBox: {
    background: '#fff1f2',
    border: '1px solid #fecdd3',
    color: '#be123c',
    borderRadius: 16,
    padding: 12,
    fontWeight: 900,
    margin: '0 auto 12px',
    maxWidth: 1120,
  },
  listingPanel: {
    maxWidth: 1120,
    margin: '0 auto 12px',
    background: 'rgba(255, 255, 255, 0.95)',
    border: '1px solid rgba(203, 213, 225, 0.95)',
    borderRadius: 22,
    padding: 'clamp(14px, 2vw, 18px)',
    boxShadow: '0 16px 44px rgba(51, 65, 85, 0.1)',
  },
  listingHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  listingSub: {
    margin: '5px 0 0',
    color: '#64748b',
    fontWeight: 850,
    fontSize: 13,
  },
  listingActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  smallGhostBtn: {
    border: '1px solid #cbd5e1',
    borderRadius: 999,
    background: '#ffffff',
    color: '#172033',
    padding: '9px 13px',
    fontWeight: 950,
    cursor: 'pointer',
  },
  smallDarkBtn: {
    border: '1px solid #0f172a',
    borderRadius: 999,
    background: '#0f172a',
    color: '#ffffff',
    padding: '9px 13px',
    fontWeight: 950,
    cursor: 'pointer',
  },
  branchListingGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(250px, 100%), 1fr))',
    gap: 10,
  },
  branchListingCard: {
    border: '1px solid #e2e8f0',
    borderRadius: 18,
    background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)',
    padding: 12,
    display: 'grid',
    gap: 10,
  },
  branchListingTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  branchName: {
    fontWeight: 950,
    fontSize: 18,
  },
  branchCount: {
    color: '#64748b',
    fontWeight: 850,
    fontSize: 12,
    marginTop: 2,
  },
  branchTotals: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  branchEmpty: {
    padding: 12,
    borderRadius: 14,
    background: '#f8fafc',
    color: '#64748b',
    fontWeight: 850,
    textAlign: 'center',
  },
  staffOrderList: {
    display: 'grid',
    gap: 8,
  },
  staffOrderCard: {
    border: '1px solid #dbeafe',
    borderRadius: 15,
    background: '#ffffff',
    padding: 10,
  },
  staffOrderTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    alignItems: 'center',
    color: '#0f172a',
    fontSize: 14,
    marginBottom: 8,
  },
  staffMealGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 5,
  },
  staffMealPill: {
    borderRadius: 999,
    background: '#f1f5f9',
    color: '#64748b',
    padding: '5px 7px',
    fontWeight: 900,
    fontSize: 11,
    lineHeight: 1,
  },
  staffMealPillActive: {
    background: '#eff6ff',
    color: '#1d4ed8',
  },
  emptyState: {
    padding: 18,
    textAlign: 'center',
    color: '#64748b',
    fontWeight: 900,
    border: '1px dashed #cbd5e1',
    borderRadius: 16,
  },
  confirmCard: {
    maxWidth: 820,
    margin: '0 auto',
    background: 'linear-gradient(180deg, #ffffff 0%, #fffaf1 100%)',
    border: '1px solid #e4d5bc',
    borderRadius: 26,
    padding: 'clamp(18px, 3vw, 30px)',
    boxShadow: '0 20px 60px rgba(71, 55, 33, 0.13)',
  },
  successIcon: {
    width: 58,
    height: 58,
    borderRadius: 20,
    background: '#dcfce7',
    color: '#047857',
    display: 'grid',
    placeItems: 'center',
    fontWeight: 950,
    fontSize: 20,
    marginBottom: 14,
  },
  confirmTitle: {
    fontSize: 'clamp(28px, 4vw, 44px)',
    margin: '8px 0',
    lineHeight: 1,
  },
  confirmGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))',
    gap: 10,
    margin: '18px 0',
  },
  summaryBox: {
    border: '1px solid #d9e5f3',
    borderRadius: 16,
    padding: 13,
    display: 'grid',
    gap: 6,
    background: '#ffffff',
  },
  summaryLabel: {
    color: '#64748b',
    fontWeight: 900,
    textTransform: 'uppercase',
    fontSize: 11,
  },
  orderList: {
    display: 'grid',
    gap: 7,
    marginBottom: 18,
  },
  confirmActions: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))',
    gap: 10,
  },
  confirmRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    padding: 12,
    borderRadius: 13,
    background: '#f8fbff',
    border: '1px solid #e2eaf5',
  },
};
