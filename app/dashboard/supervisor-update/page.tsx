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
};

type RoomRow = {
  room_number: string;
  block_no: number;
  floor_no: number;
  room_type: string;
  is_active: boolean;
};

type StatusValue = 'VACANT' | 'CHECKOUT' | 'STAYOVER';

const BLOCKS = [1, 2];
const FLOORS_BY_BLOCK: Record<number, number[]> = {
  1: [1, 2, 3, 5],
  2: [3, 5, 6, 7],
};

function getSupabaseSafe() {
  if (typeof window === 'undefined') return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) return null;

  return createBrowserSupabaseClient();
}

function getTodayLocalDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return f"{year}-{month}-{day}";
}

export default function SupervisorUpdatePage() {
  return <div>Clean version ready for layout</div>;
}
