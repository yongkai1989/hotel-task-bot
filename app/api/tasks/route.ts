import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { sendTelegramTaskCard, Dept } from '../../../lib/telegram';
import { getDashboardUserFromRequest } from '../../../lib/dashboardAuth';
import { reconcileManagerRoomCheckTasks } from '../../../lib/managerRoomCheckTaskSync';
import { broadcastTaskChange } from '../../../lib/taskBroadcastServer';
import { attachTaskAlertAcknowledgements } from '../../../lib/taskAlertAcknowledgements';
import { sendTaskPushNotifications } from '../../../lib/taskPush';
import { logRouteTiming } from '../../../lib/routeTiming';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 30;

const GET_TASK_LIMIT = 300;
const CUSTOMER_WAITING_REMINDER_BUDGET_MS = 1200;
const CUSTOMER_WAITING_REMINDER_CHECK_INTERVAL_MS = 30_000;
const TELEGRAM_SEND_TIMEOUT_MS = 5000;
const MAX_MEDIA = 30;
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
let customerWaitingReminderCheck: Promise<void> | null = null;
let lastCustomerWaitingReminderCheckAt = 0;

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
  if (Date.now() - lastCustomerWaitingReminderCheckAt < CUSTOMER_WAITING_REMINDER_CHECK_INTERVAL_MS) {
    return;
  }

  if (!customerWaitingReminderCheck) {
    lastCustomerWaitingReminderCheckAt = Date.now();
    customerWaitingReminderCheck = (async () => {
      const { data: shouldRun, error } = await supabaseAdmin.rpc(
        'claim_customer_waiting_reminder_check',
        { p_interval_seconds: CUSTOMER_WAITING_REMINDER_CHECK_INTERVAL_MS / 1000 }
      );

      if (error || !shouldRun) return;
      await sendCustomerWaitingReminders();
    })().finally(() => {
      customerWaitingReminderCheck = null;
    });
  }

  await Promise.race([
    customerWaitingReminderCheck,
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

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const stages: Record<string, number> = {};
  const requestId = req.headers.get('x-vercel-id');
  try {
    // This maintenance check is independent of the task list read. Starting it
    // here lets its short time budget overlap the database work below instead
    // of adding up to 1.2 seconds to every dashboard refresh.
    const reminderPromise = sendCustomerWaitingRemindersWithBudget();

    const taskReadStartedAt = Date.now();
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
        alert_cycle,
        task_images (
          id,
          image_url,
          caption,
          created_at
        )
      `
      )
      .order('created_at', { ascending: false })
      .limit(GET_TASK_LIMIT);
    stages.task_read_ms = Date.now() - taskReadStartedAt;

    if (tasksError) {
      logRouteTiming({ route: '/api/tasks', method: 'GET', startedAt, status: 500, requestId, stages, error: tasksError.message });
      return jsonNoCache({ ok: false, error: tasksError.message }, 500);
    }

    const reconcileStartedAt = Date.now();
    const reconciledTasks = await reconcileManagerRoomCheckTasks(tasks || []);
    stages.reconcile_ms = Date.now() - reconcileStartedAt;

    const acknowledgementsStartedAt = Date.now();
    const tasksWithAcknowledgements = await attachTaskAlertAcknowledgements(reconciledTasks);
    stages.acknowledgements_ms = Date.now() - acknowledgementsStartedAt;

    const finalTasks = tasksWithAcknowledgements.map((task: any) => ({
      ...task,
      task_images: (Array.isArray(task.task_images) ? task.task_images : [])
        .slice()
        .sort((a: any, b: any) => Date.parse(String(a.created_at || '')) - Date.parse(String(b.created_at || '')))
        .map(({ created_at: _createdAt, ...image }: any) => image),
    }));

    const reminderStartedAt = Date.now();
    await reminderPromise;
    stages.reminder_wait_ms = Date.now() - reminderStartedAt;

    logRouteTiming({ route: '/api/tasks', method: 'GET', startedAt, status: 200, requestId, stages });
    return jsonNoCache({ ok: true, tasks: finalTasks });
  } catch (error: any) {
    logRouteTiming({ route: '/api/tasks', method: 'GET', startedAt, status: 500, requestId, stages, error: error?.message || 'Unknown error' });
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

    const unresolvedDepartment = departments.find(
      (department) => !resolveTelegramChatId(department)
    );

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
      const telegramChatId = resolveTelegramChatId(department);

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

      if (task.department === 'HK' || task.department === 'MT') {
        const pushResult = await sendTaskPushNotifications(task);
        if (pushResult.warning) warnings.push(pushResult.warning);
      }

      // Deliver the in-app event immediately after Web Push recipients have
      // been prepared. Telegram is an independent external service and must
      // never delay a tablet alert.
      await broadcastTaskChange(task.id, 'INSERT');

      try {
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


