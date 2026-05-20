import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

function jsonNoCache(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}

async function allMediaCompleted(taskId: string) {
  const { data, error } = await supabaseAdmin
    .from('task_images')
    .select('id, completed_at')
    .eq('task_id', taskId);

  if (error) throw error;

  const rows = data || [];
  if (!rows.length) return true;

  return rows.every((row) => !!row.completed_at);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const taskId = params.id;
    const { user, error: authError } = await getDashboardUserFromRequest(req);

    if (!user) {
      return jsonNoCache({ ok: false, error: authError || 'Unauthorized' }, 401);
    }

    if (!user.can_edit_task) {
      return jsonNoCache({ ok: false, error: 'You are not allowed to update media subtasks' }, 403);
    }

    const body = await req.json();
    const mediaId = String(body.media_id || body.mediaId || '').trim();
    const completed = body.completed === true;

    if (!taskId) return jsonNoCache({ ok: false, error: 'Invalid task id' }, 400);
    if (!mediaId) return jsonNoCache({ ok: false, error: 'Missing media id' }, 400);

    const { data: task, error: taskError } = await supabaseAdmin
      .from('tasks')
      .select('id, status')
      .eq('id', taskId)
      .single();

    if (taskError || !task) {
      return jsonNoCache({ ok: false, error: 'Task not found' }, 404);
    }

    if (task.status === 'DONE') {
      return jsonNoCache({ ok: false, error: 'Done tasks cannot be changed' }, 400);
    }

    const updateData = completed
      ? {
          completed_at: new Date().toISOString(),
          completed_by_name: user.name,
          completed_by_email: user.email,
        }
      : {
          completed_at: null,
          completed_by_name: null,
          completed_by_email: null,
        };

    const { data: media, error: mediaError } = await supabaseAdmin
      .from('task_images')
      .update(updateData)
      .eq('id', mediaId)
      .eq('task_id', taskId)
      .select(
        `
        id,
        task_id,
        image_url,
        caption,
        media_type,
        completed_at,
        completed_by_name,
        created_at
      `
      )
      .single();

    if (mediaError || !media) {
      return jsonNoCache({ ok: false, error: mediaError?.message || 'Media not found' }, 500);
    }

    const allDone = await allMediaCompleted(taskId);

    if (task.status === 'PENDING_CHECK' && !allDone) {
      await supabaseAdmin
        .from('tasks')
        .update({
          status: 'OPEN',
          done_at: null,
          done_by_name: null,
          checked_at: null,
          checked_by_name: null,
          updated_at: new Date().toISOString(),
          last_updated_by_name: user.name,
        })
        .eq('id', taskId);
    }

    await supabaseAdmin.from('task_events').insert({
      task_id: taskId,
      event_type: completed ? 'MEDIA_COMPLETED' : 'MEDIA_REOPENED',
      event_text: `${media.caption || 'Media subtask'} ${completed ? 'completed' : 'reopened'} by ${user.name}`,
      actor_name: user.name,
    });

    return jsonNoCache({
      ok: true,
      media,
      allMediaCompleted: allDone,
    });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Failed to update media subtask' },
      500
    );
  }
}
