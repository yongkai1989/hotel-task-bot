import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { sendTelegramTaskCard, Dept } from '../../../lib/telegram';
import { getDashboardUserFromRequest } from '../../../lib/dashboardAuth';
import { reconcileManagerRoomCheckTasks } from '../../../lib/managerRoomCheckTaskSync';
import { broadcastTaskChange } from '../../../lib/taskBroadcastServer';
import { attachTaskAlertAcknowledgements } from '../../../lib/taskAlertAcknowledgements';
import { sendTaskPushNotifications } from '../../../lib/taskPush';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const GET_TASK_LIMIT = 300;
const CUSTOMER_WAITING_REMINDER_BUDGET_MS = 1200;
const TELEGRAM_SEND_TIMEOUT_MS = 5000;
const MAX_MEDIA = 30;
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Department-specific Telegram group chat IDs
const MT_CHAT_ID = -1003860980789;
const HK_CHAT_ID = -1003784764929;
const DEPARTMENT_KEYWORDS: Record<Dept, string[]> = {
  MT: [
    'aircond',
    'air con',
    'ac',
    'tak sejuk',
    'panas',
    'guest complain panas',
    'lampu',
    'light',
    'tv',
    'remote',
    'paip',
    'pipe',
    'sink',
    'toilet',
    'tandas',
    'flush',
    'heater',
    'water heater',
    'tak panas',
    'socket',
    'plug',
    'bocor',
    'leaking',
    'tersumbat',
    'rosak',
    'pintu',
    'kunci',
    'lock',
    'jammed',
    'electric',
    'elektrik',
    'tak ada air',
    'x ada air',
    'tak ada supply',
    'supply',
    'pressure',
    'shower',
    'minibar',
    'banjir',
    'tak boleh buka',
    'tak ada channel',
    'channel',
    'trip',
    'tak ada electric',
    'tingkap',
    'tak ada lampu',
    'ceiling basah',
    'safety box',
    'safe box',
    'katil rosak',
    'kerusi rosak',
    'chair rosak',
    'patah',
    'floor trap',
    'sumbat',
    'sinki',
    'flush rosak',
    'tak boleh flush',
    'battery',
    'tak function',
    'kettle',
    'longgar',
  ],
  HK: [
    'towel',
    'bath towel',
    'bath mat',
    'bathmat',
    'bedsheet',
    'bed sheet',
    'selimut',
    'duvet',
    'blanket',
    'bantal',
    'pillow',
    'linen',
    'room not cleaned',
    'bilik kotor',
    'make up room',
    'makeup room',
    'topup',
    'sabun',
    'shampoo',
    'sampah',
    'clean',
    'housekeeping',
    'amenities',
    'tukar',
    'kotor',
    'stain',
    'tak ada shampoo',
    'bathfoam',
    'carpet kotor',
    'toilet kotor',
    'ada bau',
    'bau',
    'sejadah',
    'toilet paper',
    'extra pillow',
    'extra bed',
    'katil asing',
    'keringkan lantai',
    'guest extend',
    'make up room',
    'jagan kemas',
    'jangan kemas',
    'nak kemas',
    'lantai licin',
    'bedbug',
    'semut',
    'cicak',
    'tangkap cicak',
    'lipas',
    'nyamuk',
    'tukar bilik',
  ],
  FO: [
    'guest marah',
    'minta tukar bilik',
    'guest minta tukar bilik',
    'minta extend',
    'guest minta extend',
    'nak extend',
    'guest nak extend',
    'translate',
    'guest minta translate',
    'bilik block',
    'guest complain',
    'check in',
    'check-in',
    'check out',
    'checkout',
    'booking',
    'reservation',
    'payment',
    'deposit',
    'refund',
    'receipt',
    'resit',
    'extend stay',
    'late checkout',
    'guest complain service',
    'front office',
    'bilik release',
    'bilik boleh jual',
    'bilik ok',
    'hold dulu jangan jual',
    'hold dulu jgn jual',
  ],
};

function normalizeDept(value: string): Dept | null {
  const v = String(value || '').trim().toUpperCase();

  if (v === 'HK') return 'HK';
  if (v === 'MT') return 'MT';
  if (v === 'FO') return 'FO';

  return null;
}

function normalizeDeptList(value: any): Dept[] {
  if (!Array.isArray(value)) return [];

  const unique = new Set<Dept>();

  value.forEach((item) => {
    const dept = normalizeDept(item);
    if (dept) unique.add(dept);
  });

  return Array.from(unique);
}

function normalizeParserText(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/\bjgn\b/g, 'jangan')
    .replace(/\bx\b/g, 'tak')
    .replace(/\bxda\b/g, 'tak ada')
    .replace(/\bblm\b/g, 'belum')
    .replace(/\bac\b/g, 'aircond')
    .replace(/\baircon\b/g, 'aircond')
    .replace(/\bair cond\b/g, 'aircond')
    .replace(/\bsinki\b/g, 'sink')
    .replace(/\bsafebox\b/g, 'safe box')
    .replace(/\bbathmat\b/g, 'bath mat')
    .replace(/[^\w\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractRoomFromText(value: string) {
  const match = String(value || '').match(/\b\d{3,5}\b/);
  return match ? match[0] : '';
}

function inferDepartmentFromText(value: string): Dept | null {
  const normalized = normalizeParserText(value);
  const scores: Record<Dept, number> = { HK: 0, MT: 0, FO: 0 };
  const weakKeywords = new Set([
    'guest complain',
    'guest marah',
    'guest extend',
    'nak extend',
    'minta extend',
  ]);

  (Object.keys(DEPARTMENT_KEYWORDS) as Dept[]).forEach((dept) => {
    DEPARTMENT_KEYWORDS[dept].forEach((keyword) => {
      if (normalized.includes(keyword)) {
        const weight = weakKeywords.has(keyword)
          ? 1
          : keyword.split(' ').length >= 3
          ? 3
          : keyword.includes(' ')
          ? 2
          : 1;
        scores[dept] += weight;
      }
    });
  });

  const ranked = (Object.keys(scores) as Dept[])
    .map((dept) => ({ dept, score: scores[dept] }))
    .sort((a, b) => b.score - a.score);

  if (!ranked[0] || ranked[0].score <= 0) {
    return null;
  }

  return ranked[0].dept;
}

function normalizeImageUrls(body: any): string[] {
  if (Array.isArray(body.image_urls)) {
    return body.image_urls
      .map((v) => String(v || '').trim())
      .filter(Boolean);
  }

  if (body.image_url) {
    const single = String(body.image_url || '').trim();
    return single ? [single] : [];
  }

  return [];
}

function normalizeImageCaptions(
  body: any,
  imageCount: number
): (string | null)[] {
  if (Array.isArray(body.image_captions)) {
    const captions = body.image_captions.map((v: any) => {
      const s = String(v || '').trim();
      return s || null;
    });

    while (captions.length < imageCount) {
      captions.push(null);
    }

    return captions.slice(0, imageCount);
  }

  if (body.image_caption) {
    const single = String(body.image_caption || '').trim() || null;
    return Array.from({ length: imageCount }, (_, idx) =>
      idx === 0 ? single : null
    );
  }

  return Array.from({ length: imageCount }, () => null);
}

function extensionForMedia(type: string) {
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('quicktime')) return 'mov';
  if (type.includes('webm')) return 'webm';
  if (type.includes('mp4')) return 'mp4';
  return type.startsWith('video/') ? 'mp4' : 'jpg';
}

async function uploadTaskMediaFiles(files: File[]) {
  if (!files.length) return [];

  if (files.length > MAX_MEDIA) {
    throw new Error(`Maximum ${MAX_MEDIA} photos or videos per task`);
  }

  const uploaded: Array<{ url: string; caption: string | null }> = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const type = file.type || 'application/octet-stream';
    const isVideo = type.startsWith('video/');
    const isImage = type.startsWith('image/');

    if (!isVideo && !isImage) {
      throw new Error('Only image and video files are allowed');
    }

    if (isVideo && file.size > MAX_VIDEO_BYTES) {
      throw new Error('Each video must be 80MB or smaller');
    }

    if (isImage && file.size > MAX_IMAGE_BYTES) {
      throw new Error('Each image must be 8MB or smaller after compression');
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = extensionForMedia(type);
    const fileName = `task-media/${Date.now()}-${index}-${Math.random()
      .toString(36)
      .slice(2)}.${ext}`;

    const { error } = await supabaseAdmin.storage
      .from('task-images')
      .upload(fileName, buffer, {
        contentType: type,
        upsert: false,
      });

    if (error) throw error;

    const { data } = supabaseAdmin.storage
      .from('task-images')
      .getPublicUrl(fileName);

    uploaded.push({
      url: data.publicUrl,
      caption: null,
    });
  }

  return uploaded;
}

async function parseCreateTaskRequest(req: NextRequest) {
  const contentType = req.headers.get('content-type') || '';

  if (!contentType.includes('multipart/form-data')) {
    return {
      body: await req.json(),
      files: [] as File[],
    };
  }

  const form = await req.formData();
  const departmentsRaw = String(form.get('departments_json') || '').trim();
  let departments: any[] = [];

  try {
    departments = departmentsRaw ? JSON.parse(departmentsRaw) : [];
  } catch {
    departments = [];
  }

  const files = form
    .getAll('media')
    .filter((item): item is File => {
      const candidate = item as any;
      return (
        candidate &&
        typeof candidate.arrayBuffer === 'function' &&
        typeof candidate.size === 'number'
      );
    });

  return {
    body: {
      room: form.get('room'),
      department: form.get('department'),
      departments,
      task_text: form.get('task_text'),
      source_message: form.get('source_message'),
      customer_waiting: String(form.get('customer_waiting') || '') === 'true',
      urgent: String(form.get('urgent') || '') === 'true',
    },
    files,
  };
}

function jsonNoCache(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveTelegramChatId(department: Dept): number | null {
  if (department === 'MT') return MT_CHAT_ID;
  if (department === 'HK') return HK_CHAT_ID;

  // Optional fallback for FO or any future department
  const fallbackRaw = process.env.ALLOWED_CHAT_ID;
  const fallbackChatId = Number(fallbackRaw);

  if (!fallbackRaw || Number.isNaN(fallbackChatId)) {
    return null;
  }

  return fallbackChatId;
}

function isManagerRoomCheckTelegramExcluded(sourcePage: string | null, taskText: string) {
  if (sourcePage === 'MANAGER_ROOM_CHECK') return true;

  // Protect older Manager Room Check tasks that pre-date source_page tagging.
  return /^urgent manager room check\b/i.test(String(taskText || '').trim());
}

async function sendTelegramText(chatId: number, text: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_SEND_TIMEOUT_MS);

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
      signal: controller.signal,
    });

    const json = await res.json();
    if (!res.ok || !json?.ok) {
      throw new Error(json?.description || 'Telegram reminder failed');
    }

    return json?.result?.message_id ?? null;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('Telegram reminder timed out');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function sendCustomerWaitingRemindersWithBudget() {
  await Promise.race([
    sendCustomerWaitingReminders(),
    delay(CUSTOMER_WAITING_REMINDER_BUDGET_MS),
  ]);
}

async function sendCustomerWaitingReminders() {
  try {
    const nowIso = new Date().toISOString();

    const { data: dueTasks, error } = await supabaseAdmin
      .from('tasks')
      .select(
        `
        id,
        task_code,
        room,
        department,
        task_text,
        chat_id,
        created_at,
        customer_waiting_due_at
      `
      )
      .eq('customer_waiting', true)
      .eq('status', 'OPEN')
      .is('customer_waiting_reminder_sent_at', null)
      .lte('customer_waiting_due_at', nowIso)
      .limit(10);

    if (error || !dueTasks?.length) return;

    for (const task of dueTasks) {
      const chatId = Number(task.chat_id || resolveTelegramChatId(task.department as Dept));
      if (!chatId || Number.isNaN(chatId)) continue;

      const now = new Date().toISOString();
      const { data: claimed, error: claimError } = await supabaseAdmin
        .from('tasks')
        .update({ customer_waiting_reminder_sent_at: now })
        .eq('id', task.id)
        .eq('customer_waiting', true)
        .eq('status', 'OPEN')
        .is('customer_waiting_reminder_sent_at', null)
        .select('id')
        .maybeSingle();

      if (claimError || !claimed) continue;

      try {
        const messageId = await sendTelegramText(
          chatId,
          [
            `Customer / location: ${task.room}`,
            `Task ID: ${task.task_code || task.id}`,
            `Task: ${task.task_text}`,
            'Kindly proceed to attend soon.',
            'This is an automatically generated reminder.',
          ].join('\n')
        );

        await supabaseAdmin.from('task_events').insert({
          task_id: task.id,
          event_type: 'CUSTOMER_WAITING_REMINDER',
          event_text: `Automatic customer waiting reminder sent${messageId ? ` (${messageId})` : ''}`,
          actor_name: 'System',
        });
      } catch (telegramError: any) {
        await supabaseAdmin.from('task_events').insert({
          task_id: task.id,
          event_type: 'CUSTOMER_WAITING_REMINDER_FAILED',
          event_text: telegramError?.message || 'Automatic customer waiting reminder failed',
          actor_name: 'System',
        });
      }
    }
  } catch {
    // Reminder checks should never block the task list.
  }
}

export async function GET() {
  try {
    // This maintenance check is independent of the task list read. Starting it
    // here lets its short time budget overlap the database work below instead
    // of adding up to 1.2 seconds to every dashboard refresh.
    const reminderPromise = sendCustomerWaitingRemindersWithBudget();

    const { data: tasks, error: tasksError } = await supabaseAdmin
      .from('tasks')
      .select(
        `
        id,
        task_code,
        room,
        department,
        task_text,
        status,
        created_at,
        created_by_name,
        created_by_email,
        source_page,
        done_at,
        done_by_name,
        last_updated_by_name,
        edited_at,
        edited_by_name,
        edited_by_email,
        image_url,
        customer_waiting,
        customer_waiting_due_at,
        customer_waiting_follow_up_count,
        customer_waiting_reminder_sent_at,
        urgent,
        urgent_due_at,
        alert_cycle
      `
      )
      .order('created_at', { ascending: false })
      .limit(GET_TASK_LIMIT);

    if (tasksError) {
      return jsonNoCache({ ok: false, error: tasksError.message }, 500);
    }

    const reconciledTasks = await reconcileManagerRoomCheckTasks(tasks || []);
    const taskIds = reconciledTasks.map((t) => t.id);

    const taskImagesPromise = taskIds.length > 0
      ? supabaseAdmin
        .from('task_images')
        .select(
          `
          id,
          task_id,
          image_url,
          caption
        `
        )
        .in('task_id', taskIds)
        .order('created_at', { ascending: true })
      : Promise.resolve({ data: [], error: null });

    // Media and acknowledgement history are independent reads. Loading them
    // together avoids another full network round trip on the free database
    // tier while preserving the exact response shape used by the dashboard.
    const [taskImagesResult, tasksWithAcknowledgements] = await Promise.all([
      taskImagesPromise,
      attachTaskAlertAcknowledgements(reconciledTasks),
    ]);

    if (taskImagesResult.error) {
      return jsonNoCache({ ok: false, error: taskImagesResult.error.message }, 500);
    }

    const imageMap = new Map<string, any[]>();

    for (const img of taskImagesResult.data || []) {
      const key = String(img.task_id);
      const existing = imageMap.get(key) || [];
      existing.push({
        id: img.id,
        image_url: img.image_url,
        caption: img.caption,
      });
      imageMap.set(key, existing);
    }

    const finalTasks = tasksWithAcknowledgements.map((task) => ({
      ...task,
      task_images: imageMap.get(String(task.id)) || [],
    }));

    await reminderPromise;

    return jsonNoCache({ ok: true, tasks: finalTasks });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Unknown error' },
      500
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, error: authError } = await getDashboardUserFromRequest(req);

    // 1) Auth check
    if (!user) {
      return jsonNoCache(
        { ok: false, error: authError || 'Unauthorized' },
        401
      );
    }

    // 2) Permission check
    if (!user.can_create_task) {
      return jsonNoCache({ ok: false, error: 'Not allowed to create tasks' }, 403);
    }

    const { body, files } = await parseCreateTaskRequest(req);

    const sourceMessage = String(body.source_message || body.sourceMessage || '').trim();
    const rawTaskText = String(body.task_text || body.taskText || '').trim();
    const requestedSourcePage = String(body.source_page || body.sourcePage || '')
      .trim()
      .toUpperCase();
    const sourcePage =
      requestedSourcePage === 'FO_QUICK_ACTIONS' || requestedSourcePage === 'MANAGER_ROOM_CHECK'
        ? requestedSourcePage
        : null;
    const room = String(body.room || '').trim() || extractRoomFromText(sourceMessage) || extractRoomFromText(rawTaskText);
    const taskText = rawTaskText || sourceMessage || room;
    const telegramExcluded = isManagerRoomCheckTelegramExcluded(sourcePage, taskText);
    const inferredDept = inferDepartmentFromText(sourceMessage || taskText);
    const requestedDepartments = normalizeDeptList(body.departments);
    const departments =
      requestedDepartments.length > 0
        ? requestedDepartments
        : normalizeDept(body.department)
          ? [normalizeDept(body.department) as Dept]
          : inferredDept
            ? [inferredDept]
            : [];
    let imageUrls = normalizeImageUrls(body);
    let imageCaptions = normalizeImageCaptions(body, imageUrls.length);
    const customerWaiting = body.customer_waiting === true || body.customerWaiting === true;
    const urgent = body.urgent === true;
    if (customerWaiting && urgent) {
      return jsonNoCache({ ok: false, error: 'Choose either Customer waiting or Urgent' }, 400);
    }
    const customerWaitingDueAt = customerWaiting
      ? new Date(Date.now() + 10 * 60 * 1000).toISOString()
      : null;
    const urgentDueAt = urgent
      ? new Date(Date.now() + 5 * 60 * 1000).toISOString()
      : null;

    if (!room) {
      return jsonNoCache({ ok: false, error: 'Room/area and description is required' }, 400);
    }

    if (room.length > 80) {
      return jsonNoCache({ ok: false, error: 'Room/area and description must be 80 characters or less' }, 400);
    }

    if (!departments.length) {
      return jsonNoCache(
        { ok: false, error: 'Department must be HK, MT, or FO' },
        400
      );
    }

    if (!taskText) {
      return jsonNoCache({ ok: false, error: 'Room/area and description is required' }, 400);
    }

    const unresolvedDepartment = telegramExcluded
      ? undefined
      : departments.find((department) => !resolveTelegramChatId(department));

    if (unresolvedDepartment) {
      return jsonNoCache(
        {
          ok: false,
          error:
            unresolvedDepartment === 'FO'
              ? 'No Telegram chat configured for FO. Set ALLOWED_CHAT_ID for FO fallback or add a dedicated FO chat ID.'
              : `No Telegram chat configured for department ${unresolvedDepartment}`,
        },
        500
      );
    }

    if (files.length > 0) {
      const uploadedMedia = await uploadTaskMediaFiles(files);
      imageUrls = uploadedMedia.map((item) => item.url);
      imageCaptions = uploadedMedia.map((item) => item.caption);
    }

    const firstImageUrl = imageUrls.length > 0 ? imageUrls[0] : null;
    const userEmail = String(user.email || '').trim().toLowerCase() || null;
    const createdTasks: any[] = [];
    const warnings: string[] = [];

    for (const department of departments) {
      const telegramChatId = telegramExcluded ? null : resolveTelegramChatId(department);

      const { data: task, error: insertError } = await supabaseAdmin
        .from('tasks')
        .insert({
          room,
          department,
          task_text: taskText,
          status: 'OPEN',
          created_by_name: user.name,
          created_by_email: userEmail,
          source_page: sourcePage,
          chat_id: telegramChatId,
          image_url: firstImageUrl,
          customer_waiting: customerWaiting,
          customer_waiting_due_at: customerWaitingDueAt,
          customer_waiting_follow_up_count: 0,
          customer_waiting_reminder_sent_at: null,
          urgent,
          urgent_due_at: urgentDueAt,
          alert_cycle: 1,
          reopened_at: null,
        })
        .select(
          `
          id,
          task_code,
          room,
          department,
          task_text,
          status,
          created_by_name,
          created_by_email,
          source_page,
          chat_id,
          image_url,
          done_by_name,
          done_at,
          reopened_at,
          last_updated_by_name,
          edited_at,
          edited_by_name,
          edited_by_email,
          customer_waiting,
          customer_waiting_due_at,
          customer_waiting_follow_up_count,
          customer_waiting_reminder_sent_at,
          urgent,
          urgent_due_at,
          alert_cycle,
          created_at
        `
        )
        .single();

      if (insertError || !task) {
        return jsonNoCache(
          { ok: false, error: insertError?.message || 'Failed to create task' },
          500
        );
      }

      await supabaseAdmin.from('task_events').insert({
        task_id: task.id,
        event_type: 'CREATED',
        event_text: `${taskText} (created from dashboard)`,
        actor_name: user.name,
      });

      if (imageUrls.length > 0) {
        const imageRows = imageUrls.map((url, index) => ({
          task_id: task.id,
          image_url: url,
          caption: imageCaptions[index] || null,
          created_by_name: user.name,
        }));

        const { error: imageInsertError } = await supabaseAdmin
          .from('task_images')
          .insert(imageRows);

        if (imageInsertError) {
          return jsonNoCache(
            { ok: false, error: imageInsertError.message },
            500
          );
        }
      }

      let telegramWarning = '';

      try {
        if (!telegramExcluded) {
          const telegramMessageId = await sendTelegramTaskCard({
            chatId: telegramChatId as number,
            task: {
              id: task.id,
              task_code: task.task_code,
              room: task.room,
              department: task.department,
              task_text: task.task_text,
              created_by_name: task.created_by_name,
              image_url: task.image_url,
              status: task.status,
              done_by_name: task.done_by_name,
              done_at: task.done_at,
              reopened_at: null,
              last_updated_by_name: task.last_updated_by_name,
            },
          });

          if (telegramMessageId) {
            await supabaseAdmin
              .from('tasks')
              .update({ telegram_task_message_id: telegramMessageId })
              .eq('id', task.id);

            await supabaseAdmin.from('telegram_messages').insert({
              telegram_message_id: telegramMessageId,
              chat_id: telegramChatId,
              task_id: task.id,
              message_type: 'TASK_CARD',
            });
          }
        }
      } catch (error: any) {
        telegramWarning = error?.message || `Telegram notification failed for ${department}`;
      }

      const { data: taskImages, error: finalImagesError } = await supabaseAdmin
        .from('task_images')
        .select(
          `
          id,
          image_url,
          caption,
          created_at
        `
        )
        .eq('task_id', task.id)
        .order('created_at', { ascending: true });

      createdTasks.push({
        ...task,
        task_images: finalImagesError ? [] : taskImages || [],
      });

      if (task.department === 'HK' || task.department === 'MT') {
        const pushResult = await sendTaskPushNotifications(task);
        if (pushResult.warning) warnings.push(pushResult.warning);
      }

      // Timed recipient rows are guaranteed by the push helper before the
      // broadcast, so every selected user can load the red popup immediately.
      await broadcastTaskChange(task.id, 'INSERT');

      if (telegramWarning) {
        warnings.push(telegramWarning);
      }
    }

    return jsonNoCache({
      ok: true,
      warning: warnings.length ? warnings.join(' | ') : undefined,
      task: createdTasks[0],
      tasks: createdTasks,
    });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Unknown error' },
      500
    );
  }
}


