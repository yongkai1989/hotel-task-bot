import { NextRequest, NextResponse } from 'next/server';
import { getDashboardUserFromRequest } from '../../../lib/dashboardAuth';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { sendTelegramTaskCard } from '../../../lib/telegram';
import { sendTaskPushNotifications } from '../../../lib/taskPush';
import { broadcastTaskChange } from '../../../lib/taskBroadcastServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

const MT_CHAT_ID = -1003860980789;
const MAX_MEDIA = 30;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;

function jsonNoCache(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate' },
  });
}

function malaysiaDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function extensionForMedia(type: string) {
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('quicktime')) return 'mov';
  if (type.includes('webm')) return 'webm';
  if (type.includes('mp4')) return 'mp4';
  return type.startsWith('video/') ? 'mp4' : 'jpg';
}

async function removeUploadedFiles(paths: string[]) {
  if (!paths.length) return;
  await supabaseAdmin.storage.from('task-images').remove(paths);
}

export async function POST(req: NextRequest) {
  const uploadedPaths: string[] = [];
  let createdTaskId = '';

  try {
    const { user, error: authError } = await getDashboardUserFromRequest(req);
    if (!user) return jsonNoCache({ ok: false, error: authError || 'Unauthorized' }, 401);
    if (!user.can_access_chambermaid_entry) {
      return jsonNoCache({ ok: false, error: 'Chambermaid Entry access is required' }, 403);
    }

    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return jsonNoCache({ ok: false, error: 'Photos or videos are required' }, 400);
    }

    const form = await req.formData();
    const room = String(form.get('room') || '').trim();
    const serviceDate = String(form.get('service_date') || '').trim();
    const files = form.getAll('media').filter((item): item is File => {
      const candidate = item as any;
      return candidate && typeof candidate.arrayBuffer === 'function' && typeof candidate.size === 'number';
    });

    if (!/^\d{3,5}$/.test(room)) {
      return jsonNoCache({ ok: false, error: 'Invalid room number' }, 400);
    }
    if (serviceDate !== malaysiaDateString()) {
      return jsonNoCache({ ok: false, error: 'Defects can only be submitted for today’s room list' }, 400);
    }
    if (!files.length) {
      return jsonNoCache({ ok: false, error: 'Take at least one photo or video of the defect' }, 400);
    }
    if (files.length > MAX_MEDIA) {
      return jsonNoCache({ ok: false, error: `Maximum ${MAX_MEDIA} photos or videos per task` }, 400);
    }
    if (files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES) {
      return jsonNoCache({ ok: false, error: 'Combined upload must be 60 MB or smaller' }, 400);
    }

    const { data: serviceRoom, error: serviceRoomError } = await supabaseAdmin
      .from('linen_room_status')
      .select('room_number')
      .eq('service_date', serviceDate)
      .eq('room_number', room)
      .in('status', ['CHECKOUT', 'STAYOVER'])
      .maybeSingle();

    if (serviceRoomError) return jsonNoCache({ ok: false, error: serviceRoomError.message }, 500);
    if (!serviceRoom) {
      return jsonNoCache({ ok: false, error: 'Room is not on today’s chambermaid service list' }, 400);
    }

    const uploadedMedia: Array<{ url: string; caption: null }> = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const type = file.type || 'application/octet-stream';
      const isImage = type.startsWith('image/');
      const isVideo = type.startsWith('video/');
      if (!isImage && !isVideo) throw new Error('Only image and video files are allowed');
      if (isImage && file.size > MAX_IMAGE_BYTES) throw new Error('Each photo must be 8 MB or smaller');
      if (isVideo && file.size > MAX_VIDEO_BYTES) throw new Error('Each video must be 12 MB or smaller');

      const extension = extensionForMedia(type);
      const storagePath = `task-media/chambermaid-defects/${serviceDate}/${room}/${Date.now()}-${index}-${Math.random().toString(36).slice(2)}.${extension}`;
      const { error: uploadError } = await supabaseAdmin.storage
        .from('task-images')
        .upload(storagePath, Buffer.from(await file.arrayBuffer()), { contentType: type, upsert: false });
      if (uploadError) throw uploadError;
      uploadedPaths.push(storagePath);
      const { data: publicData } = supabaseAdmin.storage.from('task-images').getPublicUrl(storagePath);
      uploadedMedia.push({ url: publicData.publicUrl, caption: null });
    }

    const taskText = 'Defect reported by chambermaid — see attached photos/videos.';
    const userEmail = String(user.email || '').trim().toLowerCase() || null;
    const { data: task, error: taskError } = await supabaseAdmin
      .from('tasks')
      .insert({
        room,
        department: 'MT',
        task_text: taskText,
        status: 'OPEN',
        created_by_name: user.name,
        created_by_email: userEmail,
        source_page: 'CHAMBERMAID_ENTRY',
        chat_id: MT_CHAT_ID,
        image_url: uploadedMedia[0].url,
        customer_waiting: false,
        customer_waiting_due_at: null,
        customer_waiting_follow_up_count: 0,
        customer_waiting_reminder_sent_at: null,
        urgent: false,
        urgent_due_at: null,
        alert_cycle: 1,
        reopened_at: null,
      })
      .select('id, task_code, room, department, task_text, status, created_by_name, created_by_email, image_url, done_by_name, done_at, reopened_at, last_updated_by_name')
      .single();

    if (taskError || !task) throw taskError || new Error('Failed to create Maintenance task');
    createdTaskId = task.id;

    const { error: imageRowsError } = await supabaseAdmin.from('task_images').insert(
      uploadedMedia.map((item) => ({
        task_id: task.id,
        image_url: item.url,
        caption: item.caption,
        created_by_name: user.name,
      }))
    );
    if (imageRowsError) throw imageRowsError;

    const { error: eventError } = await supabaseAdmin.from('task_events').insert({
      task_id: task.id,
      event_type: 'CREATED',
      event_text: `${taskText} (created from Chambermaid Entry)`,
      actor_name: user.name,
    });
    if (eventError) throw eventError;

    const warnings: string[] = [];
    const pushResult = await sendTaskPushNotifications(task);
    if (pushResult.warning) warnings.push(pushResult.warning);
    await broadcastTaskChange(task.id, 'INSERT');

    try {
      const telegramMessageId = await sendTelegramTaskCard({
        chatId: MT_CHAT_ID,
        task: {
          id: task.id,
          task_code: task.task_code,
          room: task.room,
          department: 'MT',
          task_text: task.task_text,
          created_by_name: task.created_by_name,
          image_url: task.image_url,
          status: task.status,
          done_by_name: task.done_by_name,
          done_at: task.done_at,
          reopened_at: task.reopened_at,
          last_updated_by_name: task.last_updated_by_name,
        },
      });

      if (telegramMessageId) {
        await supabaseAdmin.from('tasks').update({ telegram_task_message_id: telegramMessageId }).eq('id', task.id);
        await supabaseAdmin.from('telegram_messages').insert({
          telegram_message_id: telegramMessageId,
          chat_id: MT_CHAT_ID,
          task_id: task.id,
          message_type: 'TASK_CARD',
        });
      } else {
        warnings.push('MT Telegram did not confirm delivery');
      }
    } catch (telegramError: any) {
      warnings.push(telegramError?.message || 'MT Telegram notification failed');
    }

    return jsonNoCache({
      ok: true,
      task_id: task.id,
      task_code: task.task_code,
      warning: warnings.length ? warnings.join(' | ') : undefined,
    });
  } catch (error: any) {
    if (createdTaskId) {
      await supabaseAdmin.from('tasks').delete().eq('id', createdTaskId);
    }
    await removeUploadedFiles(uploadedPaths);
    return jsonNoCache({ ok: false, error: error?.message || 'Unable to submit defect' }, 500);
  }
}
