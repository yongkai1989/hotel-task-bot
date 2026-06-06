import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';

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

function normalizeDept(value: string) {
  const v = String(value || '').trim().toUpperCase();
  if (v === 'HK') return 'HK';
  if (v === 'MT') return 'MT';
  if (v === 'FO') return 'FO';
  return null;
}

function departmentLabel(department: string) {
  return department === 'HK' ? 'Housekeeping' : 'Maintenance';
}

function managerRoomCheckDashboardTaskText(department: string, roomNumber: string) {
  return `Urgent Manager Room Check for room ${roomNumber}. Please open ${departmentLabel(department)} Manager Room Check to review.`;
}

function isManagerRoomCheckDashboardTask(task: {
  room?: string | null;
  department?: string | null;
  task_text?: string | null;
}) {
  const department = normalizeDept(String(task.department || ''));
  if (department !== 'HK' && department !== 'MT') return false;
  const room = String(task.room || '').trim();
  if (!room) return false;
  return String(task.task_text || '') === managerRoomCheckDashboardTaskText(department, room);
}

async function deleteLinkedManagerRoomCheck(task: {
  room?: string | null;
  department?: string | null;
  task_text?: string | null;
  status?: string | null;
}) {
  if (!isManagerRoomCheckDashboardTask(task)) return;

  let query = supabaseAdmin
    .from('manager_room_checks')
    .select('id')
    .eq('room_number', String(task.room || '').trim())
    .eq('department', normalizeDept(String(task.department || '')));

  query = task.status === 'DONE' ? query.eq('status', 'DONE') : query.neq('status', 'DONE');

  const { data: checks, error: fetchCheckError } = await query;
  if (fetchCheckError) throw fetchCheckError;

  const checkIds = (checks || []).map((check) => check.id);
  if (!checkIds.length) return;

  const mediaDeleteResult = await supabaseAdmin
    .from('manager_room_check_media')
    .delete()
    .in('check_id', checkIds);
  if (mediaDeleteResult.error) throw mediaDeleteResult.error;

  const checkDeleteResult = await supabaseAdmin
    .from('manager_room_checks')
    .delete()
    .in('id', checkIds);
  if (checkDeleteResult.error) throw checkDeleteResult.error;
}

export async function PATCH(
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
    const newImageUrls: string[] = Array.isArray(body.new_image_urls)
      ? body.new_image_urls.map((url: any) => String(url || '').trim()).filter(Boolean)
      : [];
    const newImageCaptions: (string | null)[] = Array.isArray(body.new_image_captions)
      ? body.new_image_captions.map((caption: any) => {
          const value = String(caption || '').trim();
          return value || null;
        })
      : [];

    if (!taskId) {
      return jsonNoCache({ ok: false, error: 'Invalid task id' }, 400);
    }

    if (!newImageUrls.length) {
      return jsonNoCache({ ok: false, error: 'No media to append' }, 400);
    }

    const { data: existingTask, error: fetchError } = await supabaseAdmin
      .from('tasks')
      .select('id, status, created_by_email')
      .eq('id', taskId)
      .single();

    if (fetchError || !existingTask) {
      return jsonNoCache({ ok: false, error: 'Task not found' }, 404);
    }

    if (existingTask.status !== 'OPEN') {
      return jsonNoCache({ ok: false, error: 'Only OPEN tasks can receive media' }, 400);
    }

    const userEmail = String(user.email || '').trim().toLowerCase();
    const creatorEmail = String(existingTask.created_by_email || '').trim().toLowerCase();
    const canAppend = !!user.can_edit_task || (!!user.can_create_task && userEmail === creatorEmail);

    if (!canAppend) {
      return jsonNoCache({ ok: false, error: 'You are not allowed to add media to this task' }, 403);
    }

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
      return jsonNoCache({ ok: false, error: insertImgError.message }, 500);
    }

    const { data: firstImageAfterAppend, error: firstImageError } = await supabaseAdmin
      .from('task_images')
      .select('image_url')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (firstImageError) {
      return jsonNoCache({ ok: false, error: firstImageError.message }, 500);
    }

    const { error: updateError } = await supabaseAdmin
      .from('tasks')
      .update({
        image_url: firstImageAfterAppend?.image_url || newImageUrls[0] || null,
      })
      .eq('id', taskId);

    if (updateError) {
      return jsonNoCache({ ok: false, error: updateError.message }, 500);
    }

    const { data: images } = await supabaseAdmin
      .from('task_images')
      .select(
        `
        id,
        image_url,
        caption,
        created_at
      `
      )
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });

    return jsonNoCache({
      ok: true,
      task_images: images || [],
    });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Unknown error' },
      500
    );
  }
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
    const taskText = String(body.task_text || room || '').trim();

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
      return jsonNoCache({ ok: false, error: 'Room/area and description is required' }, 400);
    }

    if (!department) {
      return jsonNoCache(
        { ok: false, error: 'Invalid department' },
        400
      );
    }

    if (!taskText) {
      return jsonNoCache(
        { ok: false, error: 'Room/area and description is required' },
        400
      );
    }

    const { data: existingTask, error: fetchError } =
      await supabaseAdmin
        .from('tasks')
        .select('id, status')
        .eq('id', taskId)
        .single();

    if (fetchError || !existingTask) {
      return jsonNoCache(
        { ok: false, error: 'Task not found' },
        404
      );
    }

    if (!user.can_edit_task) {
      return jsonNoCache(
        { ok: false, error: 'You are not allowed to edit this task' },
        403
      );
    }

    if (existingTask.status !== 'OPEN') {
      return jsonNoCache(
        { ok: false, error: 'Only OPEN tasks can be edited' },
        400
      );
    }

    const { data: existingImages, error: existingImagesError } = await supabaseAdmin
      .from('task_images')
      .select('id')
      .eq('task_id', taskId);

    if (existingImagesError) {
      return jsonNoCache(
        { ok: false, error: existingImagesError.message },
        500
      );
    }

    const keepIdSet = new Set(keepImageIds.map((id) => String(id)));
    const removeImageIds = (existingImages || [])
      .filter((image) => !keepIdSet.has(String(image.id)))
      .map((image) => image.id);

    if (removeImageIds.length > 0) {
      const { error: deleteImagesError } = await supabaseAdmin
        .from('task_images')
        .delete()
        .in('id', removeImageIds);

      if (deleteImagesError) {
        return jsonNoCache(
          { ok: false, error: deleteImagesError.message },
          500
        );
      }
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

    const { data: firstImageAfterEdit, error: firstImageError } = await supabaseAdmin
      .from('task_images')
      .select('image_url')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (firstImageError) {
      return jsonNoCache(
        { ok: false, error: firstImageError.message },
        500
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from('tasks')
      .update({
        room,
        department,
        task_text: taskText,
        image_url: firstImageAfterEdit?.image_url || null,
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

    if (!user.can_delete_task) {
      return jsonNoCache(
        { ok: false, error: 'You are not allowed to delete tasks' },
        403
      );
    }

    if (!taskId) {
      return jsonNoCache({ ok: false, error: 'Invalid task id' }, 400);
    }

    const { data: existingTask, error: fetchError } = await supabaseAdmin
      .from('tasks')
      .select('id, room, department, task_text, status')
      .eq('id', taskId)
      .maybeSingle();

    if (fetchError) {
      return jsonNoCache(
        { ok: false, error: fetchError.message },
        500
      );
    }

    if (!existingTask) {
      return jsonNoCache(
        { ok: true, deletedTaskId: taskId, alreadyDeleted: true }
      );
    }

    const [imageDeleteResult, eventDeleteResult] = await Promise.all([
      supabaseAdmin.from('task_images').delete().eq('task_id', taskId),
      supabaseAdmin
        .from('task_events')
        .delete()
        .eq('task_id', taskId),
    ]);

    if (imageDeleteResult.error) {
      return jsonNoCache(
        { ok: false, error: imageDeleteResult.error.message },
        500
      );
    }

    if (eventDeleteResult.error) {
      return jsonNoCache(
        { ok: false, error: eventDeleteResult.error.message },
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

    try {
      await deleteLinkedManagerRoomCheck(existingTask);
    } catch (syncError: any) {
      return jsonNoCache(
        { ok: false, error: syncError?.message || 'Linked Manager Room Check delete failed' },
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
