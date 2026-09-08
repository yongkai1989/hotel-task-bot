'use client';

const PROFILE_CACHE_KEY = 'dashboard-session-profile';
const PROFILE_CACHE_TS_KEY = 'dashboard-session-profile-ts';
const PROFILE_CACHE_TTL_MS = 30 * 60 * 1000;
const PROFILE_REQUEST_TIMEOUT_MS = 8_000;

const inFlightProfiles = new Map<string, Promise<unknown>>();

function tokenSubject(accessToken: string) {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return '';
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return String(JSON.parse(window.atob(padded))?.sub || '');
  } catch {
    return '';
  }
}

export function clearDashboardSessionProfileCache() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(PROFILE_CACHE_KEY);
  window.sessionStorage.removeItem(PROFILE_CACHE_TS_KEY);
}

export async function loadDashboardSessionProfile<T extends object>(
  accessToken: string,
  options: { force?: boolean } = {}
): Promise<T> {
  if (typeof window === 'undefined' || !accessToken) {
    throw new Error('Authentication required');
  }

  const subject = tokenSubject(accessToken);
  let matchingCachedProfile: T | null = null;
  let matchingCachedAt = 0;
  const cachedRaw = window.sessionStorage.getItem(PROFILE_CACHE_KEY);
  const cachedAt = Number(window.sessionStorage.getItem(PROFILE_CACHE_TS_KEY) || '0');
  if (cachedRaw && cachedAt > 0) {
    try {
      const cached = JSON.parse(cachedRaw) as T;
      const cachedUserId = (cached as { user_id?: string }).user_id;
      if (!subject || !cachedUserId || String(cachedUserId) === subject) {
        matchingCachedProfile = cached;
        matchingCachedAt = cachedAt;
      }
    } catch {
      clearDashboardSessionProfileCache();
    }
  }

  if (!options.force) {
    if (matchingCachedProfile && Date.now() - matchingCachedAt < PROFILE_CACHE_TTL_MS) {
      return matchingCachedProfile;
    }
  }

  const requestKey = subject || accessToken.slice(-24);
  const existing = inFlightProfiles.get(requestKey);
  if (existing) return existing as Promise<T>;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), PROFILE_REQUEST_TIMEOUT_MS);
  const request = fetch('/api/session-profile', {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: 'include',
    cache: 'no-store',
    signal: controller.signal,
  })
    .then(async (response) => {
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok || !payload?.user) {
        const error = new Error(payload?.error || `Request failed (${response.status})`);
        Object.assign(error, { status: response.status });
        throw error;
      }
      const profile = payload.user as T;
      const profileUserId = (profile as { user_id?: string }).user_id;
      if (subject && profileUserId && String(profileUserId) !== subject) {
        throw new Error('Session profile mismatch');
      }
      window.sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
      window.sessionStorage.setItem(PROFILE_CACHE_TS_KEY, String(Date.now()));
      return profile;
    })
    .catch((error) => {
      const status = Number((error as { status?: number })?.status || 0);
      if (status === 401 || status === 403) {
        clearDashboardSessionProfileCache();
        throw error;
      }
      if (matchingCachedProfile) return matchingCachedProfile;
      throw error;
    })
    .finally(() => {
      window.clearTimeout(timeout);
      inFlightProfiles.delete(requestKey);
    });

  inFlightProfiles.set(requestKey, request);
  return request;
}
