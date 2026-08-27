'use client';

import { useEffect, useMemo, useState, type MouseEvent, type ReactNode, type SVGProps } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
// DashboardSidebar is inside /components, so /lib is exactly one level up.
import { createBrowserSupabaseClient } from '../lib/supabaseBrowser';

type SidebarProfile = {
  user_id?: string;
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT';
  can_create_task?: boolean;
  can_update_task_status?: boolean;
  can_edit_task?: boolean;
  can_delete_task?: boolean;
  can_access_preventive_maintenance?: boolean;
  can_access_maintenance_manager_room_check?: boolean;
  can_access_maintenance_ot?: boolean;
  can_access_maintenance_stock_card?: boolean;
  can_access_maintenance_damaged?: boolean;
  can_access_hk_schedule?: boolean;
  can_access_hk_special_project?: boolean;
  can_access_hk_manager_room_check?: boolean;
  can_access_chambermaid_entry?: boolean;
  chambermaid_access_until?: string | null;
  can_access_supervisor_update?: boolean;
  can_access_laundry_count?: boolean;
  can_access_laundry_received?: boolean;
  can_access_stock_card?: boolean;
  can_access_damaged?: boolean;
  can_access_linen_history?: boolean;
  can_access_supervisor_checklist?: boolean;
  can_access_daily_forms?: boolean;
  can_access_management_tasks?: boolean;
  can_access_online_purchasing?: boolean;
  can_access_daily_operations_summary?: boolean;
  can_access_bank_in_cash?: boolean;
  can_access_commission_checker?: boolean;
  can_access_admin_settings?: boolean;
  can_access_guest_shop_admin?: boolean;
  can_access_linen_admin?: boolean;
  can_access_lost_found?: boolean;
  can_access_fo_checklist?: boolean;
  can_access_fo_quick_actions?: boolean;
  can_access_fo_schedule?: boolean;
  can_access_price_guide?: boolean;
  can_access_guest_laundry?: boolean;
  can_access_fnb_checklist?: boolean;
  can_access_fnb_menu_admin?: boolean;
  can_access_fnb_orders?: boolean;
  can_access_guest_shop_orders?: boolean;
  can_access_breakfast_vouchers?: boolean;
  can_access_staff_meal?: boolean;
  can_access_pa_checklist?: boolean;
  can_access_pa_linen_entry?: boolean;
  permissions?: Partial<Record<
    | 'can_create_task'
    | 'can_update_task_status'
    | 'can_edit_task'
    | 'can_delete_task'
    | 'can_access_preventive_maintenance'
    | 'can_access_maintenance_manager_room_check'
    | 'can_access_maintenance_ot'
    | 'can_access_maintenance_stock_card'
    | 'can_access_maintenance_damaged'
    | 'can_access_hk_schedule'
    | 'can_access_hk_special_project'
    | 'can_access_hk_manager_room_check'
    | 'can_access_chambermaid_entry'
    | 'can_access_supervisor_update'
    | 'can_access_laundry_count'
    | 'can_access_laundry_received'
    | 'can_access_stock_card'
    | 'can_access_damaged'
    | 'can_access_linen_history'
    | 'can_access_supervisor_checklist'
    | 'can_access_daily_forms'
    | 'can_access_management_tasks'
    | 'can_access_online_purchasing'
    | 'can_access_daily_operations_summary'
    | 'can_access_bank_in_cash'
    | 'can_access_commission_checker'
    | 'can_access_admin_settings'
    | 'can_access_guest_shop_admin'
    | 'can_access_linen_admin'
    | 'can_access_lost_found'
    | 'can_access_fo_checklist'
    | 'can_access_fo_quick_actions'
    | 'can_access_fo_schedule'
    | 'can_access_price_guide'
    | 'can_access_guest_laundry'
    | 'can_access_fnb_checklist'
    | 'can_access_fnb_menu_admin'
    | 'can_access_fnb_orders'
    | 'can_access_guest_shop_orders'
    | 'can_access_breakfast_vouchers'
    | 'can_access_staff_meal'
    | 'can_access_pa_checklist'
    | 'can_access_pa_linen_entry',
    unknown
  >>;
};

type AdminUser = {
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT';
};

type SidebarIconName =
  | 'dashboard'
  | 'archive'
  | 'maintenance'
  | 'calendar'
  | 'clock'
  | 'package'
  | 'alert'
  | 'housekeeping'
  | 'publicArea'
  | 'fnb'
  | 'sparkle'
  | 'bed'
  | 'clipboard'
  | 'laundry'
  | 'history'
  | 'management'
  | 'frontOffice'
  | 'lostFound'
  | 'file'
  | 'list'
  | 'settings'
  | 'lock'
  | 'logout'
  | 'login'
  | 'user'
  | 'close'
  | 'chevron';

type EffectiveProfile = Required<
  Pick<
    SidebarProfile,
    | 'email'
    | 'name'
    | 'role'
    | 'can_create_task'
    | 'can_update_task_status'
    | 'can_edit_task'
    | 'can_delete_task'
    | 'can_access_preventive_maintenance'
    | 'can_access_maintenance_manager_room_check'
    | 'can_access_maintenance_ot'
    | 'can_access_maintenance_stock_card'
    | 'can_access_maintenance_damaged'
    | 'can_access_hk_schedule'
    | 'can_access_hk_special_project'
    | 'can_access_hk_manager_room_check'
    | 'can_access_chambermaid_entry'
    | 'can_access_supervisor_update'
    | 'can_access_laundry_count'
    | 'can_access_laundry_received'
    | 'can_access_stock_card'
    | 'can_access_damaged'
    | 'can_access_linen_history'
    | 'can_access_supervisor_checklist'
    | 'can_access_daily_forms'
    | 'can_access_management_tasks'
    | 'can_access_online_purchasing'
    | 'can_access_daily_operations_summary'
    | 'can_access_bank_in_cash'
    | 'can_access_commission_checker'
    | 'can_access_admin_settings'
    | 'can_access_guest_shop_admin'
    | 'can_access_lost_found'
    | 'can_access_fo_checklist'
    | 'can_access_fo_quick_actions'
    | 'can_access_fo_schedule'
    | 'can_access_price_guide'
    | 'can_access_guest_laundry'
    | 'can_access_fnb_checklist'
    | 'can_access_fnb_menu_admin'
    | 'can_access_fnb_orders'
    | 'can_access_guest_shop_orders'
    | 'can_access_breakfast_vouchers'
    | 'can_access_staff_meal'
    | 'can_access_pa_checklist'
    | 'can_access_pa_linen_entry'
  >
> & {
  user_id: string;
  chambermaid_access_until: string | null;
};

function normalizeTimeValue(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeProfile(profile: SidebarProfile | null): EffectiveProfile | null {
  if (!profile) return null;

  const role = profile.role;
  const isSuperuser = role === 'SUPERUSER';
  const email = String(profile.email || '').toLowerCase();
  const hasAccess = (value: unknown) =>
    value === true || value === 'true' || value === 1 || value === '1';
  const permissionValue = (key: Exclude<keyof EffectiveProfile, 'user_id' | 'email' | 'name' | 'role'>) =>
    profile.permissions?.[key] !== undefined ? profile.permissions[key] : profile[key];

  return {
    user_id: String(profile.user_id || ''),
    chambermaid_access_until: normalizeTimeValue(profile.chambermaid_access_until),
    email,
    name: String(profile.name || ''),
    role,
    can_create_task: isSuperuser || hasAccess(permissionValue('can_create_task')),
    can_update_task_status: isSuperuser || hasAccess(permissionValue('can_update_task_status')),
    can_edit_task: isSuperuser || hasAccess(permissionValue('can_edit_task')),
    can_delete_task: isSuperuser || hasAccess(permissionValue('can_delete_task')),
    can_access_preventive_maintenance:
      isSuperuser || hasAccess(permissionValue('can_access_preventive_maintenance')),
    can_access_maintenance_manager_room_check:
      isSuperuser || hasAccess(permissionValue('can_access_maintenance_manager_room_check')),
    can_access_maintenance_ot:
      isSuperuser || hasAccess(permissionValue('can_access_maintenance_ot')),
    can_access_maintenance_stock_card:
      isSuperuser || hasAccess(permissionValue('can_access_maintenance_stock_card')),
    can_access_maintenance_damaged:
      isSuperuser || hasAccess(permissionValue('can_access_maintenance_damaged')),
    can_access_hk_schedule:
      isSuperuser || hasAccess(permissionValue('can_access_hk_schedule')),
    can_access_hk_special_project:
      isSuperuser || hasAccess(permissionValue('can_access_hk_special_project')),
    can_access_hk_manager_room_check:
      isSuperuser || hasAccess(permissionValue('can_access_hk_manager_room_check')),
    can_access_chambermaid_entry:
      isSuperuser || hasAccess(permissionValue('can_access_chambermaid_entry')),
    can_access_supervisor_update:
      isSuperuser || hasAccess(permissionValue('can_access_supervisor_update')),
    can_access_laundry_count:
      isSuperuser || hasAccess(permissionValue('can_access_laundry_count')),
    can_access_laundry_received:
      isSuperuser || hasAccess(permissionValue('can_access_laundry_received')),
    can_access_stock_card:
      isSuperuser || hasAccess(permissionValue('can_access_stock_card')),
    can_access_damaged:
      isSuperuser || hasAccess(permissionValue('can_access_damaged')),
    can_access_linen_history:
      isSuperuser || hasAccess(permissionValue('can_access_linen_history')),
    can_access_supervisor_checklist:
      isSuperuser || hasAccess(permissionValue('can_access_supervisor_checklist')),
    can_access_daily_forms:
      isSuperuser || hasAccess(permissionValue('can_access_daily_forms')),
    can_access_management_tasks:
      isSuperuser || hasAccess(permissionValue('can_access_management_tasks')),
    can_access_online_purchasing:
      isSuperuser || hasAccess(permissionValue('can_access_online_purchasing')),
    can_access_daily_operations_summary:
      isSuperuser || hasAccess(permissionValue('can_access_daily_operations_summary')),
    can_access_bank_in_cash:
      isSuperuser || hasAccess(permissionValue('can_access_bank_in_cash')),
    can_access_commission_checker:
      isSuperuser || hasAccess(permissionValue('can_access_commission_checker')),
    can_access_admin_settings:
      isSuperuser || hasAccess(permissionValue('can_access_admin_settings')),
    can_access_guest_shop_admin:
      isSuperuser || hasAccess(permissionValue('can_access_guest_shop_admin')),
    can_access_guest_shop_orders:
      isSuperuser || email === 'fenny@hotelhallmark.com' || hasAccess(permissionValue('can_access_guest_shop_orders')),
    can_access_lost_found:
      isSuperuser || hasAccess(permissionValue('can_access_lost_found')),
    can_access_fo_checklist:
      isSuperuser ||
      (
        hasAccess(permissionValue('can_access_fo_checklist')) &&
        (role === 'FO' || email === 'walter@hotelhallmark.com' || email === 'fenny@hotelhallmark.com')
      ),
    can_access_fo_quick_actions:
      isSuperuser || hasAccess(permissionValue('can_access_fo_quick_actions')),
    can_access_fo_schedule:
      isSuperuser || hasAccess(permissionValue('can_access_fo_schedule')),
    can_access_price_guide:
      isSuperuser ||
      role === 'FO' ||
      email === 'fenny@hotelhallmark.com' ||
      hasAccess(permissionValue('can_access_price_guide')),
    can_access_guest_laundry:
      isSuperuser ||
      role === 'FO' ||
      email === 'walter@hotelhallmark.com' ||
      email === 'fenny@hotelhallmark.com' ||
      hasAccess(permissionValue('can_access_guest_laundry')),
    can_access_fnb_checklist:
      isSuperuser || email === 'fnb@hotelhallmark.com' || email === 'fenny@hotelhallmark.com',
    can_access_fnb_menu_admin:
      isSuperuser ||
      email === 'fnb@hotelhallmark.com' ||
      email === 'fenny@hotelhallmark.com' ||
      hasAccess(permissionValue('can_access_fnb_menu_admin')),
    can_access_fnb_orders:
      isSuperuser ||
      email === 'fnb@hotelhallmark.com' ||
      email === 'fenny@hotelhallmark.com' ||
      hasAccess(permissionValue('can_access_fnb_orders')),
    can_access_breakfast_vouchers:
      isSuperuser || hasAccess(permissionValue('can_access_breakfast_vouchers')),
    can_access_staff_meal:
      isSuperuser || hasAccess(permissionValue('can_access_staff_meal')),
    can_access_pa_checklist:
      isSuperuser ||
      email === 'pa@hotelhallmark.com' ||
      email === 'fenny@hotelhallmark.com' ||
      email === 'manager@hotelhallmark.com' ||
      email === 'hksup1@hotelhallmark.com' ||
      email === 'hksup2@hotelhallmark.com' ||
      hasAccess(permissionValue('can_access_pa_checklist')),
    can_access_pa_linen_entry:
      isSuperuser ||
      email === 'pa@hotelhallmark.com' ||
      email === 'laundry@hotelhallmark.com' ||
      email === 'fenny@hotelhallmark.com' ||
      email === 'manager@hotelhallmark.com' ||
      email === 'hksup1@hotelhallmark.com' ||
      email === 'hksup2@hotelhallmark.com' ||
      email === 'hksup3@hotelhallmark.com' ||
      hasAccess(permissionValue('can_access_pa_linen_entry')),
  };
}

function getEffectiveProfile(profile: EffectiveProfile | null): EffectiveProfile | null {
  return profile;
}

const FO_SUPERVISOR_UPDATE_EMAIL = 'fo@hotelhallmark.com';
const FO_UPDATE_START_HOUR = 3;
const FO_UPDATE_END_HOUR = 8;

function getSingaporeHour(now = new Date()) {
  const hourPart = new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    hour: '2-digit',
    hour12: false,
  })
    .formatToParts(now)
    .find((part) => part.type === 'hour');

  const hour = Number(hourPart?.value);
  return Number.isFinite(hour) ? hour % 24 : now.getHours();
}

function isFoSupervisorUpdateUser(profile: EffectiveProfile | null) {
  const email = String(profile?.email || '').trim().toLowerCase();
  return profile?.role === 'FO' || email === FO_SUPERVISOR_UPDATE_EMAIL;
}

function canUseSupervisorUpdateNow(profile: EffectiveProfile | null, nowMs: number) {
  if (!profile?.can_access_supervisor_update) return false;
  if (profile.role === 'SUPERUSER') return true;
  if (!isFoSupervisorUpdateUser(profile)) return true;

  const hour = getSingaporeHour(new Date(nowMs));
  return hour >= FO_UPDATE_START_HOUR && hour < FO_UPDATE_END_HOUR;
}

const PROFILE_CACHE_KEY = 'dashboard-session-profile';
const PROFILE_CACHE_TS_KEY = 'dashboard-session-profile-ts';

function clearBrowserAuthState() {
  if (typeof window === 'undefined') return;

  window.sessionStorage.removeItem(PROFILE_CACHE_KEY);
  window.sessionStorage.removeItem(PROFILE_CACHE_TS_KEY);

  Object.keys(window.localStorage).forEach((key) => {
    if (key.startsWith('sb-') || key.includes('supabase.auth.token')) {
      window.localStorage.removeItem(key);
    }
  });
}

function SidebarIcon({
  name,
  size = 18,
}: {
  name: SidebarIconName;
  size?: number;
}) {
  const common: SVGProps<SVGSVGElement> = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.15,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: false,
  };

  if (name === 'dashboard') {
    return (
      <svg {...common}>
        <rect x="4" y="4" width="7" height="7" rx="2" />
        <rect x="13" y="4" width="7" height="7" rx="2" />
        <rect x="4" y="13" width="7" height="7" rx="2" />
        <rect x="13" y="13" width="7" height="7" rx="2" />
      </svg>
    );
  }

  if (name === 'archive') {
    return (
      <svg {...common}>
        <path d="M4 7h16" />
        <path d="M5 7l1 13h12l1-13" />
        <path d="M8 4h8l1 3H7l1-3Z" />
        <path d="M9 12h6" />
      </svg>
    );
  }

  if (name === 'maintenance') {
    return (
      <svg {...common}>
        <path d="M14.7 6.3a4 4 0 0 0-5.1 5.1L4.5 16.5a2.1 2.1 0 0 0 3 3l5.1-5.1a4 4 0 0 0 5.1-5.1l-2.6 2.6-3-3 2.6-2.6Z" />
      </svg>
    );
  }

  if (name === 'calendar') {
    return (
      <svg {...common}>
        <rect x="4" y="5" width="16" height="15" rx="3" />
        <path d="M8 3v4" />
        <path d="M16 3v4" />
        <path d="M4 10h16" />
        <path d="m9 15 2 2 4-4" />
      </svg>
    );
  }

  if (name === 'clock') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2" />
      </svg>
    );
  }

  if (name === 'package') {
    return (
      <svg {...common}>
        <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
        <path d="m4.5 8 7.5 4 7.5-4" />
        <path d="M12 12v9" />
      </svg>
    );
  }

  if (name === 'alert') {
    return (
      <svg {...common}>
        <path d="M12 8v5" />
        <path d="M12 17h.01" />
        <path d="M10.4 3.8 2.7 17.2A2 2 0 0 0 4.4 20h15.2a2 2 0 0 0 1.7-2.8L13.6 3.8a1.85 1.85 0 0 0-3.2 0Z" />
      </svg>
    );
  }

  if (name === 'housekeeping') {
    return (
      <svg {...common}>
        <path d="M15 4 4 15" />
        <path d="m14 5 5 5" />
        <path d="M5 14c2 0 5 3 5 5" />
        <path d="M4 20h7" />
      </svg>
    );
  }

  if (name === 'publicArea') {
    return (
      <svg {...common}>
        <path d="M4 20h16" />
        <path d="M8 20v-7" />
        <path d="M16 20v-7" />
        <path d="M7 13h10" />
        <path d="M9 13V8a3 3 0 0 1 6 0v5" />
        <path d="M6 7h12" />
        <path d="M7.5 4h9" />
      </svg>
    );
  }

  if (name === 'fnb') {
    return (
      <svg {...common}>
        <path d="M7 3v18" />
        <path d="M4 3v5a3 3 0 0 0 6 0V3" />
        <path d="M17 3v18" />
        <path d="M17 3c2.2 1.6 3 3.6 3 6v2h-3" />
      </svg>
    );
  }

  if (name === 'sparkle') {
    return (
      <svg {...common}>
        <path d="M12 3l1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z" />
        <path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14Z" />
      </svg>
    );
  }

  if (name === 'bed') {
    return (
      <svg {...common}>
        <path d="M4 19V7" />
        <path d="M20 19v-6a3 3 0 0 0-3-3H4" />
        <path d="M4 14h16" />
        <path d="M7 10V8h4v2" />
      </svg>
    );
  }

  if (name === 'clipboard') {
    return (
      <svg {...common}>
        <path d="M9 5h6" />
        <path d="M9 3h6a2 2 0 0 1 2 2v1H7V5a2 2 0 0 1 2-2Z" />
        <path d="M7 6H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-1" />
        <path d="M8 12h8" />
        <path d="M8 16h5" />
      </svg>
    );
  }

  if (name === 'laundry') {
    return (
      <svg {...common}>
        <rect x="5" y="3" width="14" height="18" rx="3" />
        <path d="M8 7h.01" />
        <path d="M12 7h4" />
        <circle cx="12" cy="14" r="4" />
        <path d="M9.5 14c1.6-1.2 3.4 1.2 5 0" />
      </svg>
    );
  }

  if (name === 'history') {
    return (
      <svg {...common}>
        <path d="M4 12a8 8 0 1 0 2.3-5.7" />
        <path d="M4 5v5h5" />
        <path d="M12 8v5l3 2" />
      </svg>
    );
  }

  if (name === 'management') {
    return (
      <svg {...common}>
        <rect x="4" y="7" width="16" height="13" rx="2" />
        <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
        <path d="M4 12h16" />
      </svg>
    );
  }

  if (name === 'frontOffice') {
    return (
      <svg {...common}>
        <path d="M4 20V8.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2V20" />
        <path d="M8 20v-6h8v6" />
        <path d="M8 10h.01" />
        <path d="M12 10h.01" />
        <path d="M16 10h.01" />
        <path d="M3 20h18" />
      </svg>
    );
  }

  if (name === 'lostFound') {
    return (
      <svg {...common}>
        <path d="M5 8.5V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v1.5" />
        <path d="M4 8.5h16l-1 11H5L4 8.5Z" />
        <path d="M9.5 13a2.5 2.5 0 1 1 4.2 1.8c-.8.7-1.2 1.1-1.2 2" />
        <path d="M12.5 18.8h.01" />
      </svg>
    );
  }

  if (name === 'file') {
    return (
      <svg {...common}>
        <path d="M7 3h7l4 4v14H7V3Z" />
        <path d="M14 3v5h5" />
        <path d="M9 13h6" />
        <path d="M9 17h4" />
      </svg>
    );
  }

  if (name === 'list') {
    return (
      <svg {...common}>
        <path d="M8 6h12" />
        <path d="M8 12h12" />
        <path d="M8 18h12" />
        <path d="M4 6h.01" />
        <path d="M4 12h.01" />
        <path d="M4 18h.01" />
      </svg>
    );
  }

  if (name === 'settings') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2 3.4-.2-.1a1.8 1.8 0 0 0-2 .1 1.8 1.8 0 0 0-.9 1.7V22H9.3v-.2a1.8 1.8 0 0 0-.9-1.7 1.8 1.8 0 0 0-2-.1l-.2.1-2-3.4.1-.1a1.7 1.7 0 0 0 .3-1.9 1.8 1.8 0 0 0-1.5-1.1H3V10h.2a1.8 1.8 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2-3.4.2.1a1.8 1.8 0 0 0 2-.1 1.8 1.8 0 0 0 .9-1.7V2h5.4v.2a1.8 1.8 0 0 0 .9 1.7 1.8 1.8 0 0 0 2 .1l.2-.1 2 3.4-.1.1a1.7 1.7 0 0 0-.3 1.9 1.8 1.8 0 0 0 1.5 1.1h.2V14h-.2a1.8 1.8 0 0 0-1.6 1Z" />
      </svg>
    );
  }

  if (name === 'lock') {
    return (
      <svg {...common}>
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
    );
  }

  if (name === 'logout') {
    return (
      <svg {...common}>
        <path d="M10 17l5-5-5-5" />
        <path d="M15 12H3" />
        <path d="M12 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
      </svg>
    );
  }

  if (name === 'login') {
    return (
      <svg {...common}>
        <path d="M14 7l5 5-5 5" />
        <path d="M19 12H7" />
        <path d="M12 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6" />
      </svg>
    );
  }

  if (name === 'user') {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    );
  }

  if (name === 'close') {
    return (
      <svg {...common}>
        <path d="M6 6l12 12" />
        <path d="M18 6 6 18" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function SidebarNavContent({
  icon,
  children,
  sub = false,
}: {
  icon: SidebarIconName;
  children: ReactNode;
  sub?: boolean;
}) {
  return (
    <>
      <span style={sub ? styles.subNavIcon : styles.navIcon}>
        <SidebarIcon name={icon} size={sub ? 15 : 17} />
      </span>
      <span style={sub ? styles.subNavText : styles.navText}>{children}</span>
    </>
  );
}

export default function DashboardSidebar({
  profile,
  sidebarOpen,
  setSidebarOpen,
}: {
  profile: SidebarProfile | null;
  sidebarOpen: boolean;
  setSidebarOpen: (value: boolean) => void;
}) {
  const pathname = usePathname();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);

  const [resolvedProfile, setResolvedProfile] = useState<EffectiveProfile | null>(
    normalizeProfile(profile)
  );

  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');

  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [logoutBusy, setLogoutBusy] = useState(false);

  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [passwordTargetEmail, setPasswordTargetEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [housekeepingOpen, setHousekeepingOpen] = useState(false);
  const [publicAreaOpen, setPublicAreaOpen] = useState(false);
  const [frontOfficeOpen, setFrontOfficeOpen] = useState(false);
  const [fnbOpen, setFnbOpen] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const [timeGateTick, setTimeGateTick] = useState(Date.now());

  useEffect(() => {
    const next = normalizeProfile(profile);
    setResolvedProfile(next);

    if (!next && typeof window !== 'undefined') {
      const cached = window.sessionStorage.getItem(PROFILE_CACHE_KEY);
      if (cached) {
        try {
          setResolvedProfile(normalizeProfile(JSON.parse(cached) as SidebarProfile));
        } catch {}
      }
    }
  }, [profile]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname, setSidebarOpen]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTimeGateTick(Date.now());
    }, 60000);

    return () => window.clearInterval(timer);
  }, []);

  const currentProfile = resolvedProfile;
  const effectiveProfile = getEffectiveProfile(currentProfile);

  const canSeeDashboard = true;
  const canSeePastTask = true;

  const canSeePM = !!effectiveProfile?.can_access_preventive_maintenance;
  const canSeeMaintenanceManagerRoomCheck =
    !!effectiveProfile?.can_access_maintenance_manager_room_check;
  const canSeeMaintenanceOT = !!effectiveProfile?.can_access_maintenance_ot;
  const canSeeMaintenanceStockCard = !!effectiveProfile?.can_access_maintenance_stock_card;
  const canSeeMaintenanceDamaged = !!effectiveProfile?.can_access_maintenance_damaged;

  const canSeeHkSchedule = !!effectiveProfile?.can_access_hk_schedule;
  const canSeeHkSpecialProject = !!effectiveProfile?.can_access_hk_special_project;
  const canSeeHkManagerRoomCheck = !!effectiveProfile?.can_access_hk_manager_room_check;
  const canSeeChambermaid = !!effectiveProfile?.can_access_chambermaid_entry;
  const canSeeSupervisorUpdate = canUseSupervisorUpdateNow(effectiveProfile, timeGateTick);
  const canSeeLaundryCount = !!effectiveProfile?.can_access_laundry_count;
  const canSeeLaundryReceived = !!effectiveProfile?.can_access_laundry_received;
  const canSeeStockCard = !!effectiveProfile?.can_access_stock_card;
  const canSeeDamaged = !!effectiveProfile?.can_access_damaged;
  const canSeeLinenHistory = !!effectiveProfile?.can_access_linen_history;
  const canSeeSupervisorChecklist = !!effectiveProfile?.can_access_supervisor_checklist;
  const canSeePAChecklist = !!effectiveProfile?.can_access_pa_checklist;
  const canSeePALinenEntry = !!effectiveProfile?.can_access_pa_linen_entry;

  const canSeeDailyForms = !!effectiveProfile?.can_access_daily_forms;
  const canSeeManagementTasks = !!effectiveProfile?.can_access_management_tasks;
  const canSeeOnlinePurchasing = !!effectiveProfile?.can_access_online_purchasing;
  const canSeeDailyOperationsSummary = !!effectiveProfile?.can_access_daily_operations_summary;
  const canSeeBankInCash = !!effectiveProfile?.can_access_bank_in_cash;
  const effectiveEmail = String(effectiveProfile?.email || '').trim().toLowerCase();
  const effectiveRole = String(effectiveProfile?.role || '').trim().toUpperCase();
  const canSeeStaffMeal = !!effectiveProfile?.can_access_staff_meal;
  const canSeeCommissionChecker =
    effectiveRole === 'SUPERUSER' ||
    !!effectiveProfile?.can_access_commission_checker ||
    effectiveEmail === 'walter@hotelhallmark.com' ||
    effectiveEmail === 'fenny@hotelhallmark.com';
  const canSeeAdminSettings = !!effectiveProfile?.can_access_admin_settings;
  const canSeeLostFound =
    effectiveRole === 'SUPERUSER' ||
    !!effectiveProfile?.can_access_lost_found;
  const canSeePriceGuide = !!effectiveProfile?.can_access_price_guide;
  const canSeeGuestLaundry = !!effectiveProfile?.can_access_guest_laundry;
  const canSeeFoGuestShopAdmin =
    effectiveRole === 'SUPERUSER' ||
    !!effectiveProfile?.can_access_guest_shop_admin ||
    effectiveEmail === 'walter@hotelhallmark.com' ||
    effectiveEmail === 'fenny@hotelhallmark.com';
  const canSeeGuestShopOrders =
    effectiveRole === 'SUPERUSER' ||
    !!effectiveProfile?.can_access_guest_shop_orders ||
    effectiveEmail === 'fenny@hotelhallmark.com';
  const canSeeFnbMenuAdmin =
    effectiveRole === 'SUPERUSER' ||
    !!effectiveProfile?.can_access_fnb_menu_admin ||
    effectiveEmail === 'fenny@hotelhallmark.com' ||
    effectiveEmail === 'fnb@hotelhallmark.com';
  const canSeeFnbChecklist = !!effectiveProfile?.can_access_fnb_checklist;
  const canSeeFnbOrders =
    effectiveRole === 'SUPERUSER' ||
    !!effectiveProfile?.can_access_fnb_orders ||
    effectiveEmail === 'fnb@hotelhallmark.com' ||
    effectiveEmail === 'fenny@hotelhallmark.com';
  const canSeeBreakfastVouchers = !!effectiveProfile?.can_access_breakfast_vouchers;
  const canSeeBreakfastPublicLinks = effectiveRole === 'SUPERUSER';
  const canSeeFoChecklist =
    effectiveProfile?.role === 'SUPERUSER' ||
    (
      !!effectiveProfile?.can_access_fo_checklist &&
      (
        effectiveProfile?.role === 'FO' ||
        effectiveProfile?.email === 'walter@hotelhallmark.com' ||
        effectiveProfile?.email === 'fenny@hotelhallmark.com'
      )
    );
  const canSeeFoQuickActions = !!effectiveProfile?.can_access_fo_quick_actions;
  const canSeeFoSchedule = !!effectiveProfile?.can_access_fo_schedule;

  const showMaintenanceGroup =
    canSeePM ||
    canSeeMaintenanceManagerRoomCheck ||
    canSeeMaintenanceOT ||
    canSeeMaintenanceStockCard ||
    canSeeMaintenanceDamaged;
  const showHousekeepingGroup =
    canSeeHkSchedule ||
    canSeeHkSpecialProject ||
    canSeeHkManagerRoomCheck ||
    canSeeChambermaid ||
    canSeeSupervisorUpdate ||
    canSeeLaundryCount ||
    canSeeLaundryReceived ||
    canSeeStockCard ||
    canSeeDamaged ||
    canSeeLinenHistory ||
    canSeeSupervisorChecklist;
  const showPublicAreaGroup = canSeePAChecklist || canSeePALinenEntry;
  const showManagementGroup =
    canSeePastTask ||
    canSeeDailyForms ||
    canSeeDailyOperationsSummary ||
    canSeeManagementTasks ||
    canSeeOnlinePurchasing ||
    canSeeBankInCash ||
    canSeeCommissionChecker ||
    canSeeAdminSettings;
  const showFrontOfficeGroup =
    canSeeFoSchedule ||
    canSeeFoQuickActions ||
    canSeeLostFound ||
    canSeeFoChecklist ||
    canSeePriceGuide ||
    canSeeGuestLaundry ||
    canSeeFoGuestShopAdmin ||
    canSeeGuestShopOrders;
  const showFnbGroup =
    canSeeFnbChecklist ||
    canSeeFnbMenuAdmin ||
    canSeeFnbOrders ||
    canSeeBreakfastVouchers ||
    canSeeStaffMeal ||
    canSeeBreakfastPublicLinks;

  const sidebarAccessFlags = [
    effectiveProfile?.can_access_preventive_maintenance,
    effectiveProfile?.can_access_maintenance_manager_room_check,
    effectiveProfile?.can_access_maintenance_ot,
    effectiveProfile?.can_access_maintenance_stock_card,
    effectiveProfile?.can_access_maintenance_damaged,
    effectiveProfile?.can_access_hk_schedule,
    effectiveProfile?.can_access_fo_schedule,
    effectiveProfile?.can_access_hk_special_project,
    effectiveProfile?.can_access_hk_manager_room_check,
    effectiveProfile?.can_access_chambermaid_entry,
    effectiveProfile?.can_access_supervisor_update,
    effectiveProfile?.can_access_laundry_count,
    effectiveProfile?.can_access_laundry_received,
    effectiveProfile?.can_access_stock_card,
    effectiveProfile?.can_access_damaged,
    effectiveProfile?.can_access_linen_history,
    effectiveProfile?.can_access_supervisor_checklist,
    canSeePAChecklist,
    canSeePALinenEntry,
    effectiveProfile?.can_access_daily_forms,
    effectiveProfile?.can_access_management_tasks,
    effectiveProfile?.can_access_online_purchasing,
    effectiveProfile?.can_access_daily_operations_summary,
    effectiveProfile?.can_access_bank_in_cash,
    effectiveProfile?.can_access_commission_checker,
    effectiveProfile?.can_access_admin_settings,
    effectiveProfile?.can_access_guest_shop_admin,
    effectiveProfile?.can_access_guest_shop_orders,
    effectiveProfile?.can_access_lost_found,
    effectiveProfile?.can_access_price_guide,
    effectiveProfile?.can_access_guest_laundry,
    effectiveProfile?.can_access_fnb_checklist,
    effectiveProfile?.can_access_fnb_menu_admin,
    effectiveProfile?.can_access_fnb_orders,
    effectiveProfile?.can_access_breakfast_vouchers,
    effectiveProfile?.can_access_staff_meal,
    effectiveProfile?.can_access_fo_checklist,
    effectiveProfile?.can_access_fo_quick_actions,
    effectiveProfile?.can_access_fo_schedule,
    effectiveProfile?.can_create_task,
    effectiveProfile?.can_update_task_status,
    effectiveProfile?.can_edit_task,
    effectiveProfile?.can_delete_task,
  ];
  const enabledAccessCount = sidebarAccessFlags.filter(Boolean).length;
  const totalAccessCount = sidebarAccessFlags.length;

  const canOpenPasswordModal = !!currentProfile;
  const isSuperuser = currentProfile?.role === 'SUPERUSER';

  function closeSidebar() {
    setSidebarOpen(false);
  }

  function navigateGuestShopAdminScope(
    event: MouseEvent<HTMLAnchorElement>,
    targetHref: string
  ) {
    if (pathname === '/dashboard/guest-shop-admin' && typeof window !== 'undefined') {
      event.preventDefault();
      closeSidebar();
      window.location.assign(targetHref);
      return;
    }

    closeSidebar();
  }

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    return session?.access_token || '';
  }

  async function fetchJson(
    input: RequestInfo | URL,
    init?: RequestInit,
    timeoutMs = 15000
  ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(input, {
        ...init,
        signal: controller.signal,
        cache: 'no-store',
      });

      const contentType = res.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');

      if (!isJson) {
        const text = await res.text();
        throw new Error(text || `Request failed (${res.status})`);
      }

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Request failed (${res.status})`);
      }

      return json;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function openLoginModal() {
    setLoginError('');
    setLoginEmail('');
    setLoginPassword('');
    setLoginModalOpen(true);
    closeSidebar();
  }

  function closeLoginModal() {
    if (loginBusy) return;
    setLoginModalOpen(false);
    setLoginError('');
    setLoginEmail('');
    setLoginPassword('');
  }

  async function handleLogin() {
    try {
      const email = loginEmail.trim();
      if (!email) throw new Error('Please enter email');
      if (!loginPassword) throw new Error('Please enter password');

      setLoginBusy(true);
      setLoginError('');

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: loginPassword,
      });

      if (error) throw error;

      closeLoginModal();
      window.location.href = '/dashboard';
    } catch (error: any) {
      setLoginError(error?.message || 'Login failed');
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleLogout() {
    setLogoutBusy(true);
    clearBrowserAuthState();
    setResolvedProfile(null);
    closeSidebar();

    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (error: any) {
      console.warn('Logout completed with local cache clear after signOut warning:', error?.message || error);
    } finally {
      window.location.replace('/dashboard');
    }
  }

  async function openPasswordModal() {
    if (!canOpenPasswordModal) return;

    try {
      setPasswordError('');
      setPasswordSuccess('');
      setNewPassword('');
      setAdminUsers([]);
      setPasswordTargetEmail(currentProfile?.email || '');
      setPasswordModalOpen(true);
      closeSidebar();

      if (isSuperuser) {
        const token = await getAccessToken();

        const json = await fetchJson('/api/admin/users', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const users = (json.users || []) as AdminUser[];
        setAdminUsers(users);
        setPasswordTargetEmail(users[0]?.email || currentProfile?.email || '');
      }
    } catch (error: any) {
      setPasswordError(error?.message || 'Failed to load users');
    }
  }

  function closePasswordModal() {
    if (passwordBusy) return;
    setPasswordModalOpen(false);
    setPasswordError('');
    setPasswordSuccess('');
    setNewPassword('');
    setAdminUsers([]);
    setPasswordTargetEmail('');
  }

  async function handleChangePassword() {
    try {
      if (!currentProfile) {
        throw new Error('Login required');
      }

      const trimmed = newPassword.trim();

      if (!trimmed) {
        throw new Error('Please enter a new password');
      }

      if (trimmed.length < 6) {
        throw new Error('Password must be at least 6 characters');
      }

      setPasswordBusy(true);
      setPasswordError('');
      setPasswordSuccess('');

      if (isSuperuser) {
        if (!passwordTargetEmail) {
          throw new Error('Please select a user');
        }

        const token = await getAccessToken();

        await fetchJson('/api/admin/change-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            targetEmail: passwordTargetEmail,
            newPassword: trimmed,
          }),
        });
      } else {
        const { error } = await supabase.auth.updateUser({
          password: trimmed,
        });

        if (error) throw error;
      }

      setPasswordSuccess('Password updated successfully');
      setNewPassword('');
    } catch (error: any) {
      setPasswordError(error?.message || 'Failed to update password');
    } finally {
      setPasswordBusy(false);
    }
  }

  function GroupSection({
    title,
    icon,
    open,
    setOpen,
    children,
  }: {
    title: string;
    icon: SidebarIconName;
    open: boolean;
    setOpen: (value: boolean) => void;
    children: ReactNode;
  }) {
    return (
      <div style={styles.groupWrap}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          style={styles.groupBtn}
        >
          <span
            style={{
              ...styles.groupChevronIcon,
              transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            }}
          >
            <SidebarIcon name="chevron" size={15} />
          </span>
          <span style={styles.groupBtnLeft}>
            <span style={styles.navIcon}>
              <SidebarIcon name={icon} size={17} />
            </span>
            <span style={styles.navText}>{title}</span>
          </span>
          <span style={styles.groupChevron}>{open ? '▾' : '▸'}</span>
        </button>
        {open ? <div style={styles.groupContent}>{children}</div> : null}
      </div>
    );
  }

  return (
    <>
      {sidebarOpen ? <div onClick={closeSidebar} style={styles.overlay} /> : null}

      <aside
        style={{
          ...styles.drawer,
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
          pointerEvents: sidebarOpen ? 'auto' : 'none',
        }}
      >
        <div style={styles.headerRow}>
          <div style={styles.menuTitle}>
            <span style={styles.menuTitleIcon}>
              <SidebarIcon name="dashboard" size={17} />
            </span>
            <span>Menu</span>
          </div>
          <button
            type="button"
            onClick={closeSidebar}
            style={styles.closeBtn}
            aria-label="Close menu"
          >
            <SidebarIcon name="close" size={18} />
            ✕
          </button>
        </div>

        {!currentProfile ? (
          <div style={styles.loadingBox}>Loading access...</div>
        ) : null}

        <nav style={styles.nav}>
          {canSeeDashboard ? (
            <Link href="/dashboard" prefetch={false} onClick={closeSidebar} style={styles.navBtn}>
              <SidebarNavContent icon="dashboard">Dashboard</SidebarNavContent>
            </Link>
          ) : null}

          {showHousekeepingGroup ? (
            <GroupSection
              title="Housekeeping"
              icon="housekeeping"
              open={housekeepingOpen}
              setOpen={setHousekeepingOpen}
            >
              {canSeeHkSchedule ? (
                <Link
                  href="/dashboard/hk-schedule"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="calendar" sub>Schedule</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeHkSpecialProject ? (
                <Link
                  href="/dashboard/hk-special-project"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="sparkle" sub>HK Special Project</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeHkManagerRoomCheck ? (
                <Link
                  href="/dashboard/hk-manager-room-check"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="clipboard" sub>Manager Room Check</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeChambermaid ? (
                <Link
                  href="/dashboard/chambermaid-entry"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="bed" sub>Chambermaid Entry</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeSupervisorUpdate ? (
                <Link
                  href="/dashboard/supervisor-update"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="clipboard" sub>Supervisor Update</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeLaundryCount || canSeeLaundryReceived ? (
                <Link
                  href="/dashboard/laundry-count"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="laundry" sub>Laundry Count</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeStockCard ? (
                <Link
                  href="/dashboard/stock-card"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="package" sub>Stock Card</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeDamaged ? (
                <Link
                  href="/dashboard/damaged"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="alert" sub>Damaged Linen</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeLinenHistory ? (
                <Link
                  href="/dashboard/linen-history"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="history" sub>Linen History</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeSupervisorChecklist ? (
                <Link
                  href="/dashboard/supervisor-checklist"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="clipboard" sub>Supervisor Checklist</SidebarNavContent>
                </Link>
              ) : null}

            </GroupSection>
          ) : null}

          {showMaintenanceGroup ? (
            <GroupSection
              title="Maintenance"
              icon="maintenance"
              open={maintenanceOpen}
              setOpen={setMaintenanceOpen}
            >
              {canSeePM ? (
                <Link
                  href="/dashboard/preventive-maintenance"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="calendar" sub>Preventive Maintenance</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeMaintenanceManagerRoomCheck ? (
                <Link
                  href="/dashboard/maintenance-manager-room-check"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="clipboard" sub>Manager Room Check</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeMaintenanceOT ? (
                <Link
                  href="/dashboard/maintenance-ot"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="clock" sub>Maintenance OT</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeMaintenanceStockCard ? (
                <Link
                  href="/dashboard/maintenance-stock-card"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="package" sub>Maintenance Stock Card</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeMaintenanceDamaged ? (
                <Link
                  href="/dashboard/maintenance-damaged"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="alert" sub>Maintenance Damaged</SidebarNavContent>
                </Link>
              ) : null}
            </GroupSection>
          ) : null}

          {showFrontOfficeGroup ? (
            <GroupSection
              title="Front Office"
              icon="frontOffice"
              open={frontOfficeOpen}
              setOpen={setFrontOfficeOpen}
            >
              {canSeeFoSchedule ? (
                <Link
                  href="/dashboard/fo-schedule"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="calendar" sub>Schedule</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeFoQuickActions ? (
                <Link
                  href="/dashboard/fo-quick-actions"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="frontOffice" sub>FO Quick Actions</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeLostFound ? (
                <Link
                  href="/dashboard/lost-found"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="lostFound" sub>Lost & Found</SidebarNavContent>
                </Link>
              ) : null}

              {canSeePriceGuide ? (
                <Link
                  href="/dashboard/price-guide"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="file" sub>Price Guide</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeGuestLaundry ? (
                <Link
                  href="/dashboard/guest-laundry"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="laundry" sub>Guest Laundry</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeFoGuestShopAdmin ? (
                <Link
                  href="/dashboard/guest-shop-admin?scope=shop"
                  prefetch={false}
                  onClick={(event) => navigateGuestShopAdminScope(event, '/dashboard/guest-shop-admin?scope=shop')}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="package" sub>Guest Shop Admin</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeGuestShopOrders ? (
                <Link
                  href="/dashboard/guest-shop-orders"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="package" sub>Guest Shop Orders</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeFoChecklist ? (
                <Link
                  href="/dashboard/fo-checklist"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="clipboard" sub>FO Checklist</SidebarNavContent>
                </Link>
              ) : null}
            </GroupSection>
          ) : null}

          {showPublicAreaGroup ? (
            <GroupSection
              title="Public Area"
              icon="publicArea"
              open={publicAreaOpen}
              setOpen={setPublicAreaOpen}
            >
              {canSeePAChecklist ? (
                <Link
                  href="/dashboard/pa-checklist"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="clipboard" sub>PA Checklist</SidebarNavContent>
                </Link>
              ) : null}

              {canSeePALinenEntry ? (
                <Link
                  href="/dashboard/pa-linen-entry"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="laundry" sub>PA Linen Entry</SidebarNavContent>
                </Link>
              ) : null}
            </GroupSection>
          ) : null}

          {showFnbGroup ? (
            <GroupSection
              title="F&B"
              icon="fnb"
              open={fnbOpen}
              setOpen={setFnbOpen}
            >
              {canSeeFnbChecklist ? (
                <Link
                  href="/dashboard/fnb-checklist"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="clipboard" sub>F&B Check List</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeFnbOrders ? (
                <Link
                  href="/dashboard/fnb-orders"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="fnb" sub>F&B Orders</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeBreakfastVouchers ? (
                <Link
                  href="/dashboard/breakfast-vouchers"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="clipboard" sub>Breakfast Vouchers</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeBreakfastPublicLinks ? (
                <Link
                  href="/breakfast-guest"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="clipboard" sub>Breakfast Guest Link</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeBreakfastPublicLinks ? (
                <Link
                  href="/breakfast-kiosk"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="clipboard" sub>Breakfast Kiosk Link</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeStaffMeal ? (
                <Link
                  href="/dashboard/staff-meal"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="clipboard" sub>Staff Meal</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeFnbMenuAdmin ? (
                <Link
                  href="/dashboard/guest-shop-admin?scope=fnb"
                  prefetch={false}
                  onClick={(event) => navigateGuestShopAdminScope(event, '/dashboard/guest-shop-admin?scope=fnb')}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="fnb" sub>F&B Menu Admin</SidebarNavContent>
                </Link>
              ) : null}
            </GroupSection>
          ) : null}

          {showManagementGroup ? (
            <GroupSection
              title="Management"
              icon="management"
              open={managementOpen}
              setOpen={setManagementOpen}
            >
              {canSeePastTask ? (
                <Link
                  href="/dashboard?view=past"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="archive" sub>Past Task</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeDailyForms ? (
                <Link
                  href="/dashboard/daily-forms"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="file" sub>Daily Forms</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeDailyOperationsSummary ? (
                <Link
                  href="/dashboard/daily-operations-summary"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="list" sub>Daily Operations Summary</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeManagementTasks ? (
                <Link
                  href="/dashboard/management-tasks"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="list" sub>Management Tasks</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeOnlinePurchasing ? (
                <Link
                  href="/dashboard/online-purchasing"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="package" sub>Online Purchasing</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeBankInCash ? (
                <Link
                  href="/dashboard/bank-in-cash"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="file" sub>Bank In Cash</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeCommissionChecker ? (
                <Link
                  href="/dashboard/commission-checker"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="file" sub>Commission Checker</SidebarNavContent>
                </Link>
              ) : null}

              {effectiveRole === 'SUPERUSER' ? (
                <Link
                  href="/dashboard/commission-checker-access"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="settings" sub>Commission Access</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeAdminSettings ? (
                <Link
                  href="/dashboard/admin-settings"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="settings" sub>Admin Settings</SidebarNavContent>
                </Link>
              ) : null}
            </GroupSection>
          ) : null}

          {currentProfile ? (
            <GroupSection
              title="Links"
              icon="list"
              open={linksOpen}
              setOpen={setLinksOpen}
            >
              <Link
                href="/guest-shop"
                prefetch={false}
                onClick={closeSidebar}
                style={styles.subNavBtn}
              >
                <SidebarNavContent icon="package" sub>Guest Shop</SidebarNavContent>
              </Link>

              <Link
                href="/staff-meal"
                prefetch={false}
                onClick={closeSidebar}
                style={styles.subNavBtn}
              >
                <SidebarNavContent icon="fnb" sub>Staff Meal Public</SidebarNavContent>
              </Link>
            </GroupSection>
          ) : null}
        </nav>

        <div style={styles.footer}>
          {currentProfile ? (
            <>
              <div style={styles.userBox}>
                <div style={styles.userName}>{currentProfile.name}</div>
                <div style={styles.userRole}>{currentProfile.role}</div>
                <div style={styles.userEmail}>{currentProfile.email}</div>
                <div style={styles.userAccessCount}>Access: {enabledAccessCount}/{totalAccessCount}</div>
              </div>

              <button
                type="button"
                onClick={openPasswordModal}
                style={styles.secondaryAction}
              >
                <span style={styles.actionIcon}>
                  <SidebarIcon name="lock" size={16} />
                </span>
                <span>{isSuperuser ? 'Change User Password' : 'Change Password'}</span>
              </button>

              <button
                type="button"
                onClick={handleLogout}
                style={{
                  ...styles.primaryAction,
                  opacity: logoutBusy ? 0.7 : 1,
                }}
                disabled={logoutBusy}
              >
                <span style={styles.actionIcon}>
                  <SidebarIcon name="logout" size={16} />
                </span>
                <span>{logoutBusy ? 'Logging out...' : 'Log Out'}</span>
              </button>
            </>
          ) : (
            <>
              <div style={styles.userBox}>
                <div style={styles.userName}>Not logged in</div>
                <div style={styles.userEmail}>Use the button below to sign in.</div>
              </div>

              <button
                type="button"
                onClick={openLoginModal}
                style={styles.primaryAction}
              >
                <span style={styles.actionIcon}>
                  <SidebarIcon name="login" size={16} />
                </span>
                <span>Log In</span>
              </button>
            </>
          )}
        </div>
      </aside>

      {loginModalOpen ? (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            <div style={styles.modalTitle}>Log In</div>

            <div style={styles.modalLabel}>Email</div>
            <input
              type="email"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="Enter email"
              style={styles.input}
              disabled={loginBusy}
            />

            <div style={{ ...styles.modalLabel, marginTop: 12 }}>Password</div>
            <input
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="Enter password"
              style={styles.input}
              disabled={loginBusy}
            />

            {loginError ? <div style={styles.errorBox}>{loginError}</div> : null}

            <div style={styles.modalActions}>
              <button
                type="button"
                onClick={closeLoginModal}
                style={styles.modalSecondaryBtn}
                disabled={loginBusy}
              >
                Close
              </button>

              <button
                type="button"
                onClick={handleLogin}
                style={{
                  ...styles.modalPrimaryBtn,
                  opacity: loginBusy ? 0.7 : 1,
                }}
                disabled={loginBusy}
              >
                {loginBusy ? 'Logging in...' : 'Log In'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {passwordModalOpen ? (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            <div style={styles.modalTitle}>
              {isSuperuser ? 'Change User Password' : 'Change Password'}
            </div>

            {isSuperuser ? (
              <>
                <div style={styles.modalLabel}>User</div>
                <select
                  value={passwordTargetEmail}
                  onChange={(e) => setPasswordTargetEmail(e.target.value)}
                  style={styles.input}
                  disabled={passwordBusy}
                >
                  <option value="">Select user</option>
                  {adminUsers.map((user) => (
                    <option key={user.email} value={user.email}>
                      {user.name} ({user.role}) - {user.email}
                    </option>
                  ))}
                </select>
              </>
            ) : null}

            <div style={{ ...styles.modalLabel, marginTop: isSuperuser ? 12 : 0 }}>
              New Password
            </div>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
              style={styles.input}
              disabled={passwordBusy}
            />

            {passwordError ? <div style={styles.errorBox}>{passwordError}</div> : null}
            {passwordSuccess ? <div style={styles.successBox}>{passwordSuccess}</div> : null}

            <div style={styles.modalActions}>
              <button
                type="button"
                onClick={closePasswordModal}
                style={styles.modalSecondaryBtn}
                disabled={passwordBusy}
              >
                Close
              </button>

              <button
                type="button"
                onClick={handleChangePassword}
                style={{
                  ...styles.modalPrimaryBtn,
                  opacity: passwordBusy ? 0.7 : 1,
                }}
                disabled={passwordBusy}
              >
                {passwordBusy ? 'Saving...' : 'Save Password'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(3, 8, 23, 0.56)',
    backdropFilter: 'blur(6px)',
    zIndex: 40,
  },
  drawer: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '270px',
    maxWidth: '86vw',
    height: '100vh',
    background: '#08162f',
    borderRight: '1px solid rgba(148, 163, 184, 0.24)',
    padding: '18px 14px',
    boxSizing: 'border-box',
    overflowY: 'auto',
    zIndex: 50,
    transition: 'transform 0.22s ease',
    boxShadow: '0 18px 44px rgba(15,23,42,0.34)',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '20px',
  },
  menuTitle: {
    fontSize: '20px',
    fontWeight: 800,
    color: '#ffffff',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
  },
  menuTitleIcon: {
    width: '34px',
    height: '34px',
    borderRadius: '12px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(37, 99, 235, 0.20)',
    color: '#93c5fd',
    border: '1px solid rgba(147, 197, 253, 0.26)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
  },
  closeBtn: {
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(255,255,255,0.08)',
    color: '#ffffff',
    borderRadius: '12px',
    width: '36px',
    height: '36px',
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingBox: {
    marginBottom: '10px',
    background: 'rgba(255,255,255,0.08)',
    color: '#dbeafe',
    border: '1px solid rgba(147,197,253,0.28)',
    borderRadius: '12px',
    padding: '10px 12px',
    fontWeight: 700,
    fontSize: '13px',
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  navBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    textDecoration: 'none',
    border: '1px solid rgba(148, 163, 184, 0.12)',
    background: 'rgba(255,255,255,0.035)',
    color: '#e2e8f0',
    borderRadius: '13px',
    padding: '10px 12px',
    fontWeight: 800,
    fontSize: '14px',
    boxSizing: 'border-box',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
  },
  navIcon: {
    width: '28px',
    height: '28px',
    borderRadius: '10px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(59, 130, 246, 0.14)',
    color: '#93c5fd',
    border: '1px solid rgba(147, 197, 253, 0.14)',
    flexShrink: 0,
  },
  navText: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  subNavText: {
    flex: 1,
    minWidth: 0,
    color: '#dbeafe',
    lineHeight: 1.25,
    overflowWrap: 'anywhere',
  },
  groupWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  groupBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    border: '1px solid rgba(147, 197, 253, 0.18)',
    background: 'rgba(15, 42, 85, 0.72)',
    color: '#ffffff',
    borderRadius: '13px',
    padding: '10px 12px',
    fontWeight: 800,
    fontSize: '14px',
    cursor: 'pointer',
    boxSizing: 'border-box',
  },
  groupBtnLeft: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    minWidth: 0,
    flex: 1,
    order: 1,
  },
  groupChevron: {
    display: 'none',
  },
  groupChevronIcon: {
    color: '#bfdbfe',
    width: '22px',
    height: '22px',
    borderRadius: '8px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'transform 0.18s ease',
    order: 2,
  },
  groupContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    margin: '2px 0 6px 14px',
    paddingLeft: '10px',
    borderLeft: '1px solid rgba(147, 197, 253, 0.18)',
  },
  subNavBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '9px',
    width: '100%',
    textDecoration: 'none',
    border: '1px solid transparent',
    background: 'transparent',
    color: '#dbeafe',
    borderRadius: '10px',
    padding: '8px 8px',
    fontWeight: 700,
    fontSize: '13px',
    boxSizing: 'border-box',
  },
  subNavIcon: {
    width: '24px',
    height: '24px',
    borderRadius: '9px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255,255,255,0.045)',
    color: '#bfdbfe',
    border: '1px solid rgba(147, 197, 253, 0.10)',
    flexShrink: 0,
  },
  footer: {
    marginTop: '20px',
    borderTop: '1px solid rgba(148, 163, 184, 0.18)',
    paddingTop: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  userBox: {
    border: '1px solid rgba(148, 163, 184, 0.18)',
    borderRadius: '16px',
    padding: '14px',
    background: 'rgba(255,255,255,0.05)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
  },
  userName: {
    fontSize: '14px',
    fontWeight: 800,
    color: '#ffffff',
  },
  userRole: {
    fontSize: '12px',
    color: '#bfdbfe',
    fontWeight: 700,
    marginTop: '2px',
  },
  userEmail: {
    fontSize: '12px',
    color: '#cbd5e1',
    marginTop: '4px',
    wordBreak: 'break-word',
  },
  userAccessCount: {
    fontSize: '12px',
    color: '#ffffff',
    marginTop: '8px',
    fontWeight: 800,
  },
  secondaryAction: {
    border: '1px solid rgba(191,219,254,0.24)',
    background: 'rgba(255,255,255,0.05)',
    color: '#ffffff',
    borderRadius: '14px',
    padding: '12px 14px',
    fontWeight: 800,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  primaryAction: {
    border: 'none',
    background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
    color: '#ffffff',
    borderRadius: '14px',
    padding: '12px 14px',
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: '0 14px 24px rgba(29,78,216,0.34)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  actionIcon: {
    width: '24px',
    height: '24px',
    borderRadius: '8px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255,255,255,0.14)',
    color: '#ffffff',
    flexShrink: 0,
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.45)',
    zIndex: 60,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
  },
  modalCard: {
    width: '100%',
    maxWidth: '460px',
    background: '#ffffff',
    borderRadius: '18px',
    border: '1px solid #e2e8f0',
    boxShadow: '0 20px 40px rgba(15,23,42,0.18)',
    padding: '18px',
  },
  modalTitle: {
    fontSize: '22px',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '14px',
  },
  modalLabel: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#334155',
    marginBottom: '8px',
  },
  input: {
    width: '100%',
    border: '1px solid #cbd5e1',
    borderRadius: '12px',
    padding: '12px 14px',
    fontSize: '15px',
    outline: 'none',
    boxSizing: 'border-box',
    background: '#ffffff',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    marginTop: '14px',
  },
  modalSecondaryBtn: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '12px 14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  modalPrimaryBtn: {
    border: 'none',
    background: '#0f172a',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '12px 14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  errorBox: {
    marginTop: '12px',
    background: '#fef2f2',
    color: '#b91c1c',
    border: '1px solid #fecaca',
    borderRadius: '12px',
    padding: '10px 12px',
    fontWeight: 600,
    fontSize: '14px',
  },
  successBox: {
    marginTop: '12px',
    background: '#ecfdf5',
    color: '#166534',
    border: '1px solid #bbf7d0',
    borderRadius: '12px',
    padding: '10px 12px',
    fontWeight: 600,
    fontSize: '14px',
  },
};


