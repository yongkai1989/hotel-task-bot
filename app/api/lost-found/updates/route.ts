import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

function noCache(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}

async function requireLostFoundAccess(req: NextRequest) {
  const { user, error } = await getDashboardUserFromRequest(req);

  if (!user) {
    return { response: noCache({ ok: false, error: error || 'Login required' }, 401) };
  }

  if (user.role !== 'SUPERUSER' && user.permissions.can_access_lost_found !== true) {
    return { response: noCache({ ok: false, error: 'Lost & Found access denied' }, 403) };
  }

  return { user };
}

export async function GET(req: NextRequest) {
  try {
    const access = await requireLostFoundAccess(req);
    if ('response' in access) return access.response;

    const { data, error } = await supabaseAdmin
      .from('lost_found_entry_updates')
      .select(
        `
        id,
        entry_id,
        previous_location,
        new_location,
        comment,
        created_by_name,
        created_at
        `
      )
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) throw error;
    return noCache({ ok: true, updates: data || [] });
  } catch (error: any) {
    return noCache({ ok: false, error: error?.message || 'Failed to load item updates' }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const access = await requireLostFoundAccess(req);
    if ('response' in access) return access.response;

    const body = await req.json();
    const entryId = String(body?.entryId || '').trim();
    const newLocation = String(body?.locationStored || '').trim();
    const comment = String(body?.comment || '').trim();

    if (!entryId) return noCache({ ok: false, error: 'Missing Lost & Found item' }, 400);
    if (!newLocation) return noCache({ ok: false, error: 'Stored location is required' }, 400);
    if (newLocation.length > 200) {
      return noCache({ ok: false, error: 'Stored location must be 200 characters or fewer' }, 400);
    }
    if (comment.length > 1000) {
      return noCache({ ok: false, error: 'Comment must be 1,000 characters or fewer' }, 400);
    }

    const { data: entry, error: entryError } = await supabaseAdmin
      .from('lost_found_entries')
      .select('id, location_stored')
      .eq('id', entryId)
      .maybeSingle();

    if (entryError) throw entryError;
    if (!entry) return noCache({ ok: false, error: 'Lost & Found item was not found' }, 404);

    const previousLocation = String(entry.location_stored || '').trim();
    if (newLocation === previousLocation && !comment) {
      return noCache({ ok: false, error: 'Change the stored location or add a comment before saving' }, 400);
    }

    const actorName = String(access.user.name || access.user.email || 'Staff');
    const updatedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('lost_found_entries')
      .update({
        location_stored: newLocation,
        updated_by_user_id: access.user.user_id,
        updated_by_name: actorName,
        updated_at: updatedAt,
      })
      .eq('id', entryId)
      .eq('location_stored', previousLocation)
      .select('id')
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updated) {
      return noCache({ ok: false, error: 'This item was updated by someone else. Refresh and try again.' }, 409);
    }

    const { data: updateRecord, error: insertError } = await supabaseAdmin
      .from('lost_found_entry_updates')
      .insert({
        entry_id: entryId,
        previous_location: previousLocation,
        new_location: newLocation,
        comment: comment || null,
        created_by_user_id: access.user.user_id,
        created_by_name: actorName,
        created_at: updatedAt,
      })
      .select(
        `
        id,
        entry_id,
        previous_location,
        new_location,
        comment,
        created_by_name,
        created_at
        `
      )
      .single();

    if (insertError) {
      await supabaseAdmin
        .from('lost_found_entries')
        .update({ location_stored: previousLocation })
        .eq('id', entryId)
        .eq('location_stored', newLocation);
      throw insertError;
    }

    return noCache({ ok: true, update: updateRecord });
  } catch (error: any) {
    return noCache({ ok: false, error: error?.message || 'Failed to update item' }, 500);
  }
}
