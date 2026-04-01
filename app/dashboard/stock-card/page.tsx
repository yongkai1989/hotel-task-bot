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

// KEEP ALL YOUR TYPES SAME...

export default function StockCardPage() {
  const [profile, setProfile] = useState<DashboardUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [viewMode, setViewMode] = useState<'OVERALL' | 'FLOOR' | 'SUPERVISOR_STORE'>('OVERALL');
  const [selectedFloorKey, setSelectedFloorKey] = useState<string>('B1F1');

  // KEEP ALL YOUR STATES + LOGIC BELOW (UNCHANGED)

  // 🔴 DO NOT TOUCH YOUR DATA LOGIC

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

  // 🔥 FINAL RETURN (NO SIDEBAR)

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

        {/* ✅ KEEP EVERYTHING ELSE BELOW EXACTLY SAME */}
      </div>
    </main>
  );
}
