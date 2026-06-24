'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

export const dynamic = 'force-dynamic';

type UserRole = 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT';

type Profile = {
  user_id?: string;
  email: string;
  name: string;
  role: UserRole;
  can_access_price_guide?: boolean;
};

type RateKey = 'weekday' | 'friday' | 'saturday' | 'peak';

type PriceGuideRoom = {
  id: string;
  category: string;
  description: string;
  weekday: number;
  friday: number;
  saturday: number;
  peak: number;
};

type PriceGuideInfo = {
  id: string;
  title: string;
  body: string;
};

type PriceGuideData = {
  hotelName: string;
  title: string;
  effectiveLabel: string;
  currencyNote: string;
  cancellationPolicy: string;
  rooms: PriceGuideRoom[];
  infoCards: PriceGuideInfo[];
};

type PageMode = 'MENU' | 'DISPLAY' | 'EDIT';

const GUIDE_ID = 'hallmark-crown-2026';
const EDITOR_EMAILS = ['fenny@hotelhallmark.com'];
const RATE_KEYS: Array<{ key: RateKey; label: string }> = [
  { key: 'weekday', label: 'Weekday Sun-Thu' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'peak', label: 'Eve & Peak Season' },
];

const DEFAULT_GUIDE: PriceGuideData = {
  hotelName: 'HALLMARK CROWN HOTEL',
  title: 'Guest Room Tariff',
  effectiveLabel: 'Effective 2026',
  currencyNote: 'All rates are quoted in Malaysian Ringgit (RM)',
  cancellationPolicy:
    'Cancellation Policy: If cancelled up to 3 days before date of arrival, no cancellation fee will be charged. Late cancellation or no-show may be charged according to booking terms.',
  rooms: [
    { id: 'standard-double', category: 'Standard Double', description: 'No view, 1 queen bed', weekday: 258, friday: 308, saturday: 348, peak: 438 },
    { id: 'combined-twin', category: 'Combined Twin Bed Room', description: '2 twin combined', weekday: 278, friday: 318, saturday: 358, peak: 458 },
    { id: 'deluxe-double', category: 'Deluxe Double', description: '1 queen bed', weekday: 278, friday: 318, saturday: 358, peak: 458 },
    { id: 'deluxe-twin', category: 'Deluxe Twin', description: '2 super single beds', weekday: 268, friday: 318, saturday: 358, peak: 458 },
    { id: 'superior-triple', category: 'Superior Triple', description: '1 queen + 1 super single bed', weekday: 368, friday: 408, saturday: 488, peak: 608 },
    { id: 'family-suite', category: 'Family Suite', description: '1 queen + 2 super single beds', weekday: 458, friday: 638, saturday: 698, peak: 868 },
    { id: 'premier-family-suite', category: 'Premier Family Suite', description: '1 queen + 3 super single beds', weekday: 528, friday: 708, saturday: 758, peak: 958 },
    { id: 'standard-twin', category: 'Standard Twin', description: '2 super single beds', weekday: 258, friday: 308, saturday: 348, peak: 438 },
    { id: 'day-use-3-hours', category: 'Day Use Room', description: '3 hours and less', weekday: 58, friday: 58, saturday: 58, peak: 58 },
    { id: 'day-use-6-hours', category: 'Day Use Room', description: '3 - 6 hours', weekday: 88, friday: 88, saturday: 88, peak: 88 },
  ],
  infoCards: [
    { id: 'extra-bed', title: 'Extra Bed', body: 'RM60.00 per bed, per night. Subject to availability.' },
    { id: 'taxes', title: 'Taxes Included', body: 'Rates include 0% GST, 8% SST and RM4.00 heritage tax.' },
    { id: 'tourist-tax', title: 'Tourist Tax', body: 'Non-citizen tourists are subject to Tourist Tax where applicable.' },
    { id: 'checkin', title: 'Check-in / Check-out', body: 'Check-in from 3:00 PM. Check-out by 12:00 noon.' },
    { id: 'deposit', title: 'Deposit', body: 'A refundable deposit of RM50 is collected upon check-in.' },
  ],
};

function getSupabaseSafe() {
  if (typeof window === 'undefined') return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createBrowserSupabaseClient();
}

function normalizeEmail(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

function canViewPriceGuide(profile: Profile | null) {
  if (!profile) return false;
  if (profile.role === 'SUPERUSER' || profile.role === 'FO') return true;
  return normalizeEmail(profile.email) === 'fenny@hotelhallmark.com' || profile.can_access_price_guide === true;
}

function canEditPriceGuide(profile: Profile | null) {
  if (!profile) return false;
  if (profile.role === 'SUPERUSER') return true;
  return EDITOR_EMAILS.includes(normalizeEmail(profile.email));
}

function formatRate(value: number) {
  const amount = Number(value || 0);
  return `RM${amount.toLocaleString('en-MY', { maximumFractionDigits: 0 })}`;
}

function readGuideData(row: any): PriceGuideData {
  if (!row?.guide_json || typeof row.guide_json !== 'object') return DEFAULT_GUIDE;
  const raw = row.guide_json as Partial<PriceGuideData>;
  return {
    hotelName: String(raw.hotelName || DEFAULT_GUIDE.hotelName),
    title: String(raw.title || DEFAULT_GUIDE.title),
    effectiveLabel: String(raw.effectiveLabel || DEFAULT_GUIDE.effectiveLabel),
    currencyNote: String(raw.currencyNote || DEFAULT_GUIDE.currencyNote),
    cancellationPolicy: String(raw.cancellationPolicy || DEFAULT_GUIDE.cancellationPolicy),
    rooms: Array.isArray(raw.rooms) && raw.rooms.length ? raw.rooms.map((room, index) => ({
      id: String(room.id || `room-${index}`),
      category: String(room.category || ''),
      description: String(room.description || ''),
      weekday: Number(room.weekday || 0),
      friday: Number(room.friday || 0),
      saturday: Number(room.saturday || 0),
      peak: Number(room.peak || 0),
    })) : DEFAULT_GUIDE.rooms,
    infoCards: Array.isArray(raw.infoCards) && raw.infoCards.length ? raw.infoCards.map((card, index) => ({
      id: String(card.id || `info-${index}`),
      title: String(card.title || ''),
      body: String(card.body || ''),
    })) : DEFAULT_GUIDE.infoCards,
  };
}

async function requestFullscreenSafe() {
  if (typeof document === 'undefined') return;
  const element = document.documentElement;
  try {
    if (!document.fullscreenElement && element.requestFullscreen) {
      await element.requestFullscreen();
    }
  } catch {
    // Fullscreen is best effort on iOS/Safari.
  }
}

async function exitFullscreenSafe() {
  if (typeof document === 'undefined') return;
  try {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
  } catch {
    // Ignore fullscreen exit failures.
  }
}

export default function PriceGuidePage() {
  const supabase = useMemo(() => getSupabaseSafe(), []);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [guide, setGuide] = useState<PriceGuideData>(DEFAULT_GUIDE);
  const [draft, setDraft] = useState<PriceGuideData>(DEFAULT_GUIDE);
  const [mode, setMode] = useState<PageMode>('MENU');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const canView = canViewPriceGuide(profile);
  const canEdit = canEditPriceGuide(profile);

  async function loadGuide() {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('front_office_price_guide')
      .select('guide_json, updated_at')
      .eq('id', GUIDE_ID)
      .maybeSingle();

    if (error) throw error;
    const nextGuide = readGuideData(data);
    setGuide(nextGuide);
    setDraft(nextGuide);
  }

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        if (!supabase) throw new Error('Supabase is not configured.');
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        if (!session?.user) {
          if (mounted) setProfile(null);
          return;
        }

        const { data, error } = await supabase
          .from('user_profiles')
          .select('user_id, email, name, role, can_access_price_guide')
          .eq('user_id', session.user.id)
          .maybeSingle();
        if (error) throw error;

        if (!mounted) return;
        setProfile({
          user_id: session.user.id,
          email: data?.email || session.user.email || '',
          name: data?.name || session.user.email || 'User',
          role: (data?.role || 'FO') as UserRole,
          can_access_price_guide: data?.can_access_price_guide === true,
        });

        await loadGuide();

        const urlMode = new URLSearchParams(window.location.search).get('mode');
        if (urlMode === 'display') setMode('DISPLAY');
        if (urlMode === 'edit') setMode('EDIT');
      } catch (err: any) {
        if (mounted) setErrorMsg(err?.message || 'Failed to load price guide.');
      } finally {
        if (mounted) setAuthLoading(false);
      }
    }

    void bootstrap();
    return () => {
      mounted = false;
    };
  }, [supabase]);

  useEffect(() => {
    if (!supabase || mode !== 'DISPLAY') return;

    let cancelled = false;
    const channel = supabase
      .channel('front-office-price-guide-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'front_office_price_guide', filter: `id=eq.${GUIDE_ID}` },
        (payload) => {
          if (payload.new) {
            const nextGuide = readGuideData(payload.new);
            setGuide(nextGuide);
          } else {
            void loadGuide().catch(() => undefined);
          }
        }
      )
      .subscribe();

    const interval = window.setInterval(() => {
      if (!cancelled) void loadGuide().catch(() => undefined);
    }, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [mode, supabase]);

function updateDraftField(
  key: 'hotelName' | 'title' | 'effectiveLabel' | 'currencyNote' | 'cancellationPolicy',
  value: string
) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function updateDraftRoom(index: number, key: keyof PriceGuideRoom, value: string) {
    setDraft((prev) => ({
      ...prev,
      rooms: prev.rooms.map((room, roomIndex) => {
        if (roomIndex !== index) return room;
        if (key === 'weekday' || key === 'friday' || key === 'saturday' || key === 'peak') {
          return { ...room, [key]: Math.max(0, Number(value || 0)) };
        }
        return { ...room, [key]: value };
      }),
    }));
  }

  function updateDraftInfo(index: number, key: keyof PriceGuideInfo, value: string) {
    setDraft((prev) => ({
      ...prev,
      infoCards: prev.infoCards.map((card, cardIndex) =>
        cardIndex === index ? { ...card, [key]: value } : card
      ),
    }));
  }

  async function saveGuide() {
    if (!supabase || !profile || !canEdit) return;
    try {
      setSaving(true);
      setMessage('');
      setErrorMsg('');

      const { error } = await supabase
        .from('front_office_price_guide')
        .upsert(
          {
            id: GUIDE_ID,
            guide_json: draft,
            updated_by_user_id: profile.user_id || null,
            updated_by_name: profile.name || profile.email,
            updated_by_email: profile.email,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' }
        );

      if (error) throw error;
      setGuide(draft);
      setMessage('Price guide updated. The display screen will refresh automatically.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save price guide.');
    } finally {
      setSaving(false);
    }
  }

  async function openDisplay() {
    await requestFullscreenSafe();
    window.history.replaceState(null, '', '/dashboard/price-guide?mode=display');
    setMode('DISPLAY');
  }

  function openEdit() {
    setDraft(guide);
    window.history.replaceState(null, '', '/dashboard/price-guide?mode=edit');
    setMode('EDIT');
  }

  async function backToMenu() {
    await exitFullscreenSafe();
    window.history.replaceState(null, '', '/dashboard/price-guide');
    setMode('MENU');
  }

  async function backToDashboard() {
    await exitFullscreenSafe();
    window.location.href = '/dashboard';
  }

  if (authLoading) {
    return <main style={styles.appPage}><div style={styles.centerCard}>Loading price guide...</div></main>;
  }

  if (!profile) {
    return (
      <main style={styles.appPage}>
        <div style={styles.centerCard}>
          <h1 style={styles.centerTitle}>Login required</h1>
          <Link href="/dashboard" style={styles.darkButton}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  if (!canView) {
    return (
      <main style={styles.appPage}>
        <div style={styles.centerCard}>
          <h1 style={styles.centerTitle}>Access denied</h1>
          <p style={styles.muted}>Price Guide is available to Front Office, Superuser, and Fenny.</p>
          <Link href="/dashboard" style={styles.darkButton}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  if (mode === 'DISPLAY') {
    return <PriceGuideDisplay guide={guide} onBack={() => void backToDashboard()} />;
  }

  if (mode === 'EDIT') {
    return (
      <main style={styles.appPage}>
        <section style={styles.pageHero}>
          <div>
            <div style={styles.eyebrow}>Front Office</div>
            <h1 style={styles.pageTitle}>Edit Price Guide</h1>
            <p style={styles.pageSubtitle}>Update the guest-facing display prices and information cards.</p>
          </div>
          <div style={styles.heroActions}>
            <button type="button" onClick={() => void backToMenu()} style={styles.lightButton}>Back</button>
            <button type="button" onClick={() => void saveGuide()} disabled={saving || !canEdit} style={styles.darkButton}>
              {saving ? 'Saving...' : 'Save Price Guide'}
            </button>
          </div>
        </section>

        {message ? <div style={styles.successBox}>{message}</div> : null}
        {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}

        {!canEdit ? (
          <div style={styles.errorBox}>Only Superuser and fenny@hotelhallmark.com can edit this guide.</div>
        ) : null}

        <section style={styles.editorPanel}>
          <div style={styles.editorGrid}>
            <label style={styles.label}>
              Hotel Name
              <input value={draft.hotelName} onChange={(e) => updateDraftField('hotelName', e.target.value)} style={styles.input} />
            </label>
            <label style={styles.label}>
              Title
              <input value={draft.title} onChange={(e) => updateDraftField('title', e.target.value)} style={styles.input} />
            </label>
            <label style={styles.label}>
              Currency Note
              <input value={draft.currencyNote} onChange={(e) => updateDraftField('currencyNote', e.target.value)} style={styles.input} />
            </label>
            <label style={styles.label}>
              Effective Label
              <input value={draft.effectiveLabel} onChange={(e) => updateDraftField('effectiveLabel', e.target.value)} style={styles.input} />
            </label>
          </div>

          <div style={styles.sectionTitle}>Room Prices</div>
          <div style={styles.editTableWrap}>
            <table style={styles.editTable}>
              <thead>
                <tr>
                  <th style={styles.editTh}>Room Category</th>
                  <th style={styles.editTh}>Description</th>
                  {RATE_KEYS.map((rate) => <th key={rate.key} style={styles.editTh}>{rate.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {draft.rooms.map((room, index) => (
                  <tr key={room.id}>
                    <td style={styles.editTd}>
                      <input value={room.category} onChange={(e) => updateDraftRoom(index, 'category', e.target.value)} style={styles.tableInput} />
                    </td>
                    <td style={styles.editTd}>
                      <input value={room.description} onChange={(e) => updateDraftRoom(index, 'description', e.target.value)} style={styles.tableInput} />
                    </td>
                    {RATE_KEYS.map((rate) => (
                      <td key={rate.key} style={styles.editTd}>
                        <input
                          type="number"
                          min="0"
                          value={room[rate.key]}
                          onChange={(e) => updateDraftRoom(index, rate.key, e.target.value)}
                          style={styles.priceInput}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={styles.sectionTitle}>Guest Information Cards</div>
          <div style={styles.infoEditGrid}>
            {draft.infoCards.map((card, index) => (
              <div key={card.id} style={styles.infoEditCard}>
                <input value={card.title} onChange={(e) => updateDraftInfo(index, 'title', e.target.value)} style={styles.input} />
                <textarea value={card.body} onChange={(e) => updateDraftInfo(index, 'body', e.target.value)} style={styles.textarea} />
              </div>
            ))}
          </div>

          <label style={styles.label}>
            Cancellation Policy
            <textarea
              value={draft.cancellationPolicy}
              onChange={(e) => updateDraftField('cancellationPolicy', e.target.value)}
              style={{ ...styles.textarea, minHeight: 88 }}
            />
          </label>
        </section>
      </main>
    );
  }

  return (
    <main style={styles.appPage}>
      <section style={styles.pageHero}>
        <div>
          <div style={styles.eyebrow}>Front Office</div>
          <h1 style={styles.pageTitle}>Price Guide</h1>
          <p style={styles.pageSubtitle}>Open the guest-facing tablet display or update the room rates.</p>
        </div>
        <Link href="/dashboard" style={styles.lightButton}>Back to Dashboard</Link>
      </section>

      {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}

      <section style={styles.menuGrid}>
        <button type="button" onClick={() => void openDisplay()} style={styles.menuCard}>
          <div style={styles.menuIcon}>H</div>
          <div>
            <div style={styles.menuTitle}>Display Price Guide</div>
            <div style={styles.menuText}>Open a full-screen landscape guest display for the check-in counter tablet.</div>
          </div>
        </button>

        {canEdit ? (
          <button type="button" onClick={openEdit} style={styles.menuCard}>
            <div style={styles.menuIcon}>RM</div>
            <div>
              <div style={styles.menuTitle}>Edit Price Guide</div>
              <div style={styles.menuText}>Update rates and guest information. Display tablets update automatically.</div>
            </div>
          </button>
        ) : null}
      </section>
    </main>
  );
}

function PriceGuideDisplay({ guide, onBack }: { guide: PriceGuideData; onBack: () => void }) {
  return (
    <main style={displayStyles.displayPage}>
      <button type="button" onClick={onBack} style={displayStyles.backButton}>Back</button>
      <section style={displayStyles.sheet}>
        <header style={displayStyles.header}>
          <div style={displayStyles.brandBlock}>
            <div style={displayStyles.logo}>
              <img src="/logo.png" alt="Hallmark Crown Hotel logo" style={displayStyles.logoImage} />
            </div>
            <div>
              <div style={displayStyles.hotelName}>{guide.hotelName}</div>
              <div style={displayStyles.title}>{guide.title}</div>
            </div>
          </div>
          <div style={displayStyles.headerNote}>
            <div>{guide.currencyNote}</div>
            <strong>{guide.effectiveLabel}</strong>
          </div>
        </header>

        <section style={displayStyles.tablePanel}>
          <div style={displayStyles.tableHeader}>
            <div style={{ ...displayStyles.th, textAlign: 'left' }}>Room Category</div>
            {RATE_KEYS.map((rate) => <div key={rate.key} style={displayStyles.th}>{rate.label}</div>)}
          </div>
          {guide.rooms.map((room, index) => (
            <div key={room.id} style={{ ...displayStyles.row, background: index % 2 ? '#fbf7ef' : '#fffdf9' }}>
              <div style={displayStyles.roomCell}>
                <strong style={displayStyles.roomName}>{room.category}</strong>
                <span style={displayStyles.roomDescription}>{room.description}</span>
              </div>
              {RATE_KEYS.map((rate) => (
                <div key={rate.key} style={displayStyles.rateCell}>{formatRate(room[rate.key])}</div>
              ))}
            </div>
          ))}
        </section>

        <section style={displayStyles.infoGrid}>
          {guide.infoCards.map((card) => (
            <div key={card.id} style={displayStyles.infoCard}>
              <strong style={displayStyles.infoTitle}>{card.title}</strong>
              <span style={displayStyles.infoText}>{card.body}</span>
            </div>
          ))}
        </section>

        <footer style={displayStyles.policy}>{guide.cancellationPolicy}</footer>
      </section>
    </main>
  );
}

const styles: Record<string, any> = {
  appPage: {
    minHeight: '100vh',
    padding: 'clamp(16px, 3vw, 34px)',
    background: 'linear-gradient(135deg, #f8fbff 0%, #eef5ff 100%)',
    color: '#0f172a',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  pageHero: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 18,
    flexWrap: 'wrap',
    padding: '22px 24px',
    border: '1px solid #d8e2ef',
    borderRadius: 24,
    background: 'rgba(255,255,255,.92)',
    boxShadow: '0 20px 50px rgba(15,23,42,.08)',
    marginBottom: 18,
  },
  eyebrow: {
    color: '#9a6a2f',
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: '.14em',
    textTransform: 'uppercase',
  },
  pageTitle: {
    margin: '4px 0',
    fontSize: 'clamp(32px, 5vw, 48px)',
    letterSpacing: '-.04em',
    lineHeight: 1,
  },
  pageSubtitle: {
    margin: 0,
    color: '#64748b',
    fontSize: 16,
    fontWeight: 650,
  },
  heroActions: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
  },
  darkButton: {
    appearance: 'none',
    border: 0,
    borderRadius: 15,
    background: '#0f172a',
    color: '#fff',
    padding: '14px 18px',
    fontSize: 15,
    fontWeight: 900,
    textDecoration: 'none',
    cursor: 'pointer',
  },
  lightButton: {
    appearance: 'none',
    border: '1px solid #cbd5e1',
    borderRadius: 15,
    background: '#fff',
    color: '#0f172a',
    padding: '13px 18px',
    fontSize: 15,
    fontWeight: 900,
    textDecoration: 'none',
    cursor: 'pointer',
  },
  menuGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 18,
  },
  menuCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 18,
    width: '100%',
    minHeight: 160,
    padding: 24,
    textAlign: 'left',
    border: '1px solid #d8e2ef',
    borderRadius: 24,
    background: '#fff',
    boxShadow: '0 20px 50px rgba(15,23,42,.08)',
    cursor: 'pointer',
  },
  menuIcon: {
    width: 64,
    height: 64,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 18,
    background: '#fff7e8',
    color: '#9a6a2f',
    border: '1px solid #ead7b6',
    fontSize: 25,
    fontWeight: 900,
    fontFamily: 'Georgia, serif',
    flex: '0 0 auto',
  },
  menuTitle: {
    fontSize: 24,
    fontWeight: 950,
    letterSpacing: '-.03em',
    marginBottom: 6,
  },
  menuText: {
    color: '#64748b',
    fontSize: 15,
    lineHeight: 1.45,
    fontWeight: 650,
  },
  editorPanel: {
    padding: 22,
    border: '1px solid #d8e2ef',
    borderRadius: 24,
    background: '#fff',
    boxShadow: '0 20px 50px rgba(15,23,42,.08)',
  },
  editorGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 14,
    marginBottom: 24,
  },
  label: {
    display: 'grid',
    gap: 8,
    color: '#334155',
    fontSize: 13,
    fontWeight: 900,
  },
  input: {
    width: '100%',
    border: '1px solid #cbd5e1',
    borderRadius: 14,
    padding: '13px 14px',
    fontSize: 15,
    color: '#0f172a',
    outline: 'none',
  },
  textarea: {
    width: '100%',
    minHeight: 76,
    border: '1px solid #cbd5e1',
    borderRadius: 14,
    padding: '13px 14px',
    fontSize: 15,
    color: '#0f172a',
    outline: 'none',
    resize: 'vertical',
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: 950,
    margin: '22px 0 12px',
    letterSpacing: '-.03em',
  },
  editTableWrap: {
    overflowX: 'auto',
    border: '1px solid #e2e8f0',
    borderRadius: 18,
  },
  editTable: {
    minWidth: 980,
    width: '100%',
    borderCollapse: 'collapse',
  },
  editTh: {
    padding: 12,
    background: '#f8fafc',
    color: '#475569',
    fontSize: 12,
    textAlign: 'left',
    borderBottom: '1px solid #e2e8f0',
  },
  editTd: {
    padding: 9,
    borderBottom: '1px solid #eef2f7',
  },
  tableInput: {
    width: '100%',
    minWidth: 160,
    border: '1px solid #dbe3ee',
    borderRadius: 11,
    padding: '10px 11px',
    fontSize: 14,
  },
  priceInput: {
    width: 110,
    border: '1px solid #dbe3ee',
    borderRadius: 11,
    padding: '10px 11px',
    fontSize: 14,
    fontWeight: 800,
  },
  infoEditGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 12,
    marginBottom: 20,
  },
  infoEditCard: {
    display: 'grid',
    gap: 10,
    padding: 14,
    border: '1px solid #e2e8f0',
    borderRadius: 18,
    background: '#f8fafc',
  },
  successBox: {
    padding: 15,
    border: '1px solid #bbf7d0',
    borderRadius: 16,
    background: '#f0fdf4',
    color: '#166534',
    fontWeight: 850,
    marginBottom: 14,
  },
  errorBox: {
    padding: 15,
    border: '1px solid #fecaca',
    borderRadius: 16,
    background: '#fef2f2',
    color: '#b91c1c',
    fontWeight: 850,
    marginBottom: 14,
  },
  centerCard: {
    maxWidth: 520,
    margin: '15vh auto 0',
    padding: 28,
    border: '1px solid #d8e2ef',
    borderRadius: 24,
    background: '#fff',
    textAlign: 'center',
    boxShadow: '0 20px 50px rgba(15,23,42,.08)',
  },
  centerTitle: {
    margin: '0 0 12px',
    fontSize: 30,
  },
  muted: {
    color: '#64748b',
    fontWeight: 650,
  },
};

const displayStyles: Record<string, any> = {
  displayPage: {
    minHeight: '100vh',
    height: '100vh',
    width: '100vw',
    overflow: 'hidden',
    padding: 'clamp(5px, .8vw, 10px)',
    background:
      'radial-gradient(circle at 10% 0%, rgba(255,245,224,.72), transparent 28%), radial-gradient(circle at 98% 92%, rgba(255,249,236,.82), transparent 34%), linear-gradient(135deg, #fffaf0, #f8fbff)',
    color: '#172033',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  backButton: {
    position: 'fixed',
    right: 10,
    bottom: 10,
    zIndex: 10,
    border: '1px solid rgba(111,71,29,.2)',
    borderRadius: 999,
    background: 'rgba(255,255,255,.58)',
    color: '#6f471d',
    padding: '6px 10px',
    fontSize: 11,
    fontWeight: 900,
    backdropFilter: 'blur(10px)',
    cursor: 'pointer',
    opacity: 0.62,
  },
  sheet: {
    height: 'calc(100vh - clamp(10px, 1.6vw, 20px))',
    maxWidth: 1320,
    margin: '0 auto',
    padding: 'clamp(6px, .9vw, 10px)',
    border: '1px solid #d8c29d',
    borderRadius: 18,
    background: 'rgba(255,253,248,.96)',
    boxShadow: '0 18px 50px rgba(47,38,23,.1)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 14,
    padding: 'clamp(5px, .75vw, 8px) clamp(8px, 1.1vw, 12px)',
    border: '1px solid #ead7b6',
    borderRadius: 14,
    background: '#fffdf7',
    flex: '0 0 auto',
  },
  brandBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    minWidth: 0,
  },
  logo: {
    width: 'clamp(32px, 4vw, 42px)',
    height: 'clamp(32px, 4vw, 42px)',
    display: 'grid',
    placeItems: 'center',
    borderRadius: 12,
    background: '#fffdf8',
    border: '1px solid #d2b177',
    color: '#6f471d',
    fontFamily: 'Georgia, serif',
    fontSize: 34,
    fontWeight: 900,
    flex: '0 0 auto',
  },
  logoImage: {
    width: '82%',
    height: '82%',
    objectFit: 'contain',
    display: 'block',
  },
  hotelName: {
    color: '#6f471d',
    fontFamily: 'Georgia, serif',
    fontSize: 'clamp(11px, 1.25vw, 15px)',
    whiteSpace: 'nowrap',
  },
  title: {
    fontFamily: 'Georgia, serif',
    fontSize: 'clamp(22px, 2.7vw, 34px)',
    lineHeight: 1,
    color: '#172033',
    whiteSpace: 'nowrap',
  },
  headerNote: {
    color: '#6b7280',
    fontSize: 'clamp(9px, .9vw, 11px)',
    lineHeight: 1.25,
    textAlign: 'right',
    flex: '0 0 auto',
  },
  tablePanel: {
    marginTop: 6,
    overflow: 'hidden',
    border: '1px solid #dfd2bc',
    borderRadius: 14,
    background: '#fffdf9',
    flex: '1 1 0',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  tableHeader: {
    display: 'grid',
    gridTemplateColumns: '1.4fr repeat(4, 1fr)',
    alignItems: 'center',
    minHeight: 'clamp(22px, 3.1vh, 28px)',
    borderBottom: '1px solid #dfd2bc',
    flex: '0 0 auto',
  },
  th: {
    padding: '3px clamp(4px, .75vw, 8px)',
    color: '#6f471d',
    fontSize: 'clamp(7px, .75vw, 10px)',
    fontWeight: 900,
    textAlign: 'center',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '1.4fr repeat(4, 1fr)',
    alignItems: 'center',
    minHeight: 0,
    borderBottom: '1px solid #ece3d4',
    flex: '1 1 0',
  },
  roomCell: {
    padding: '2px clamp(6px, .9vw, 10px)',
    minWidth: 0,
  },
  roomName: {
    display: 'block',
    color: '#071426',
    fontSize: 'clamp(9px, .9vw, 12px)',
    fontWeight: 950,
    letterSpacing: '-.02em',
    lineHeight: 1.1,
  },
  roomDescription: {
    display: 'block',
    marginTop: 1,
    color: '#66758a',
    fontSize: 'clamp(7px, .68vw, 9px)',
    lineHeight: 1,
  },
  rateCell: {
    padding: '2px clamp(4px, .65vw, 8px)',
    textAlign: 'center',
    color: '#03152d',
    fontSize: 'clamp(11px, 1.12vw, 15px)',
    fontWeight: 950,
    letterSpacing: '-.03em',
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
    gap: 5,
    marginTop: 6,
    flex: '0 0 auto',
  },
  infoCard: {
    minHeight: 42,
    padding: '6px 7px',
    border: '1px solid #dfd2bc',
    borderRadius: 12,
    background: '#fffdf9',
  },
  infoTitle: {
    display: 'block',
    marginBottom: 2,
    color: '#6f471d',
    fontSize: 'clamp(7px, .75vw, 10px)',
    fontWeight: 950,
  },
  infoText: {
    display: 'block',
    color: '#66758a',
    fontSize: 'clamp(7px, .68vw, 9px)',
    lineHeight: 1.08,
  },
  policy: {
    marginTop: 5,
    color: '#66758a',
    textAlign: 'center',
    fontSize: 'clamp(7px, .68vw, 9px)',
    lineHeight: 1.05,
    flex: '0 0 auto',
  },
};
