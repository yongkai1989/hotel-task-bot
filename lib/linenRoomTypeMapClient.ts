'use client';

const CACHE_KEY = 'linen-room-type-map-cache-v1';
const CACHE_TTL_MS = 5 * 60 * 1000;

type LinenRoomTypeMapResult = {
  data: any[];
  error: any | null;
};

let inFlightRequest: Promise<LinenRoomTypeMapResult> | null = null;

function readCachedMap(): any[] | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.data) || typeof parsed?.cachedAt !== 'number') return null;
    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) return null;

    return parsed.data;
  } catch {
    return null;
  }
}

function cacheMap(data: any[]) {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ cachedAt: Date.now(), data })
    );
  } catch {
    // A blocked or full sessionStorage must not prevent the page from loading.
  }
}

export function loadLinenRoomTypeMap(supabase: any): Promise<LinenRoomTypeMapResult> {
  const cached = readCachedMap();
  if (cached) return Promise.resolve({ data: cached, error: null });

  if (!inFlightRequest) {
    inFlightRequest = supabase
      .from('linen_room_type_map')
      .select(
        'room_type, bedsheet_king, bedsheet_single, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single'
      )
      .then(({ data, error }: LinenRoomTypeMapResult) => {
        const rows = Array.isArray(data) ? data : [];
        if (!error) cacheMap(rows);
        return { data: rows, error };
      })
      .finally(() => {
        inFlightRequest = null;
      });
  }

  return inFlightRequest;
}
