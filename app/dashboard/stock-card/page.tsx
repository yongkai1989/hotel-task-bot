'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type DashboardUser = {
  user_id?: string;
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'HK' | 'MT' | 'FO';
  can_access_linen_admin?: boolean;
  can_access_chambermaid_entry?: boolean;
};

export default function StockCardPage() {
  const [profile, setProfile] = useState<DashboardUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [viewMode, setViewMode] = useState<'OVERALL' | 'FLOOR' | 'SUPERVISOR_STORE'>('OVERALL');
  const [selectedFloorKey, setSelectedFloorKey] = useState<string>('B1F1');

  if (authLoading) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>Loading...</div>
      </main>
    );
  }

  if (!profile) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>
          <div style={styles.centerTitle}>Login required</div>
          <Link href="/dashboard" style={styles.linkBtn}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.topBar}>
          <div>
            <div style={styles.pageTitle}>Stock Card</div>
            <div style={styles.pageSubTitle}>
              {profile.name} ({profile.role})
            </div>
          </div>

          <div style={styles.topBarActions}>
            <Link href="/dashboard" style={styles.secondaryBtn}>
              Back to Dashboard
            </Link>
          </div>
        </div>

        {/* KEEP YOUR ORIGINAL CONTENT BELOW */}
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f8fafc',
    padding: '20px',
  },
  shell: {
    maxWidth: '1200px',
    margin: '0 auto',
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '18px',
  },
  topBarActions: {
    display: 'flex',
    gap: '10px',
  },
  pageTitle: {
    fontSize: '28px',
    fontWeight: 800,
  },
  pageSubTitle: {
    fontSize: '14px',
    color: '#64748b',
  },
  secondaryBtn: {
    border: '1px solid #cbd5e1',
    borderRadius: '12px',
    padding: '12px 16px',
  },
  centerCard: {
    margin: '80px auto',
    textAlign: 'center',
  },
  centerTitle: {
    fontSize: '24px',
    fontWeight: 800,
    marginBottom: '10px',
  },
  linkBtn: {
    display: 'inline-block',
    marginTop: '10px',
  },
}
