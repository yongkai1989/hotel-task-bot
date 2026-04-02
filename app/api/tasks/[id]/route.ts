import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function jsonNoCache(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}

function normalizeDept(value: string) {
  const v = String(value || '').trim().toUpperCase();
  if (v === 'HK') return 'HK';
  if (v === 'MT') return 'MT';
  if (v === 'FO') return 'FO';
  return null;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const taskId = params.id;

    const { user, error: authError } =
      await getDashboardUserFromRequest(req);

    if (!user) {
      return jsonNoCache(
        { ok: false, error: authError || 'Unauthorized' },
        401
      );
    }

    const body = await req.json();

    const room = String(body.room || '').trim();
    const department = normalizeDept(body.department);
    const taskText = String(body.task_text || '').trim();

    const keepImageIds: (string | number)[] =
      Array.isArray(body.keep_image_ids) ? body.keep_image_ids : [];

    const newImageUrls: string[] =
      Array.isArray(body.new_image_urls) ? body.new_image_urls : [];

    const newImageCaptions: (string | null)[] =
      Array.isArray(body.new_image_captions)
        ? body.new_image_captions
        : [];

    if (!taskId) {
      return jsonNoCache({ ok: false, error: 'Invalid task id' }, 400);
    }

    if (!room) {
      return jsonNoCache({ ok: false, error: 'Room is required' }, 400);
    }

    if (!department) {
      return jsonNoCache(
        { ok: false, error: 'Invalid department' },
        400
      );
    }

    if (!taskText) {
      return jsonNoCache(
        { ok: false, error: 'Task description required' },
        400
      );
    }

    const { data: existingTask, error: fetchError } =
      await supabaseAdmin
        .from('tasks')
        .select('id, created_by_email')
        .eq('id', taskId)
        .single();

    if (fetchError || !existingTask) {
      return jsonNoCache(
        { ok: false, error: 'Task not found' },
        404
      );
    }

    if (
      !existingTask.created_by_email ||
      existingTask.created_by_email.toLowerCase() !==
        user.email.toLowerCase()
    ) {
      return jsonNoCache(
        { ok: false, error: 'You are not allowed to edit this task' },
        403
      );
    }

    if (keepImageIds.length > 0) {
      await supabaseAdmin
        .from('task_images')
        .delete()
        .eq('task_id', taskId)
        .not('id', 'in', `(${keepImageIds.join(',')})`);
    } else {
      await supabaseAdmin
        .from('task_images')
        .delete()
        .eq('task_id', taskId);
    }

    if (newImageUrls.length > 0) {
      const rows = newImageUrls.map((url, idx) => ({
        task_id: taskId,
        image_url: url,
        caption: newImageCaptions[idx] || null,
        created_by_name: user.name,
      }));

      const { error: insertImgError } = await supabaseAdmin
        .from('task_images')
        .insert(rows);

      if (insertImgError) {
        return jsonNoCache(
          { ok: false, error: insertImgError.message },
          500
        );
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from('tasks')
      .update({
        room,
        department,
        task_text: taskText,
        edited_at: new Date().toISOString(),
        edited_by_name: user.name,
        edited_by_email: user.email,
      })
      .eq('id', taskId);

    if (updateError) {
      return jsonNoCache(
        { ok: false, error: updateError.message },
        500
      );
    }

    const { data: updatedTask } = await supabaseAdmin
      .from('tasks')
      .select(`
        id,
        task_code,
        room,
        department,
        task_text,
        status,
        created_at,
        done_at,
        done_by_name,
        last_updated_by_name,
        image_url,
        created_by_email,
        created_by_name,
        edited_at,
        edited_by_email,
        edited_by_name
      `)
      .eq('id', taskId)
      .single();

    const { data: images } = await supabaseAdmin
      .from('task_images')
      .select(`
        id,
        image_url,
        caption,
        created_at
      `)
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });

    return jsonNoCache({
      ok: true,
      task: {
        ...updatedTask,
        task_images: images || [],
      },
    });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Unknown error' },
      500
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const taskId = params.id;

    const { user, error: authError } =
      await getDashboardUserFromRequest(req);

    if (!user) {
      return jsonNoCache(
        { ok: false, error: authError || 'Unauthorized' },
        401
      );
    }

    if (user.role !== 'SUPERUSER') {
      return jsonNoCache(
        { ok: false, error: 'Only SUPERUSER can delete tasks' },
        403
      );
    }

    if (!taskId) {
      return jsonNoCache({ ok: false, error: 'Invalid task id' }, 400);
    }

    const { data: existingTask, error: fetchError } = await supabaseAdmin
      .from('tasks')
      .select('id')
      .eq('id', taskId)
      .single();

    if (fetchError || !existingTask) {
      return jsonNoCache(
        { ok: false, error: 'Task not found' },
        404
      );
    }

    const { error: imageDeleteError } = await supabaseAdmin
      .from('task_images')
      .delete()
      .eq('task_id', taskId);

    if (imageDeleteError) {
      return jsonNoCache(
        { ok: false, error: imageDeleteError.message },
        500
      );
    }

    const { error: eventDeleteError } = await supabaseAdmin
      .from('task_events')
      .delete()
      .eq('task_id', taskId);

    if (eventDeleteError) {
      return jsonNoCache(
        { ok: false, error: eventDeleteError.message },
        500
      );
    }

    const { error: taskDeleteError } = await supabaseAdmin
      .from('tasks')
      .delete()
      .eq('id', taskId);

    if (taskDeleteError) {
      return jsonNoCache(
        { ok: false, error: taskDeleteError.message },
        500
      );
    }

    return jsonNoCache({
      ok: true,
      deletedTaskId: taskId,
    });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Unknown error' },
      500
    );
  }
}
