import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { sendTelegramTaskCard, Dept } from '../../../lib/telegram';
import { getDashboardUserFromRequest } from '../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const GET_TASK_LIMIT = 300;

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

function jsonNoCache(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
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

export async function GET() {
  try {
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
        done_at,
        done_by_name,
        last_updated_by_name,
        edited_at,
        edited_by_name,
        edited_by_email,
        image_url
      `
      )
      .order('created_at', { ascending: false })
      .limit(GET_TASK_LIMIT);

    if (tasksError) {
      return jsonNoCache({ ok: false, error: tasksError.message }, 500);
    }

    const taskIds = (tasks || []).map((t) => t.id);

    const imageMap = new Map<string, any[]>();

    if (taskIds.length > 0) {
      const { data: taskImages, error: imagesError } = await supabaseAdmin
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
        .order('created_at', { ascending: true });

      if (imagesError) {
        return jsonNoCache({ ok: false, error: imagesError.message }, 500);
      }

      for (const img of taskImages || []) {
        const key = String(img.task_id);
        const existing = imageMap.get(key) || [];
        existing.push({
          id: img.id,
          image_url: img.image_url,
          caption: img.caption,
        });
        imageMap.set(key, existing);
      }
    }

    const finalTasks = (tasks || []).map((task) => ({
      ...task,
      task_images: imageMap.get(String(task.id)) || [],
    }));

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

    const body = await req.json();

    const sourceMessage = String(body.source_message || body.sourceMessage || '').trim();
    const rawTaskText = String(body.task_text || body.taskText || '').trim();
    const room = String(body.room || '').trim() || extractRoomFromText(sourceMessage) || extractRoomFromText(rawTaskText);
    const taskText = rawTaskText || sourceMessage;
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
    const imageUrls = normalizeImageUrls(body);
    const imageCaptions = normalizeImageCaptions(body, imageUrls.length);

    if (!room) {
      return jsonNoCache({ ok: false, error: 'Room is required' }, 400);
    }

    if (!departments.length) {
      return jsonNoCache(
        { ok: false, error: 'Department must be HK, MT, or FO' },
        400
      );
    }

    if (!taskText) {
      return jsonNoCache({ ok: false, error: 'Task text is required' }, 400);
    }

    const unresolvedDepartment = departments.find((department) => !resolveTelegramChatId(department));

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

    const firstImageUrl = imageUrls.length > 0 ? imageUrls[0] : null;
    const userEmail = String(user.email || '').trim().toLowerCase() || null;
    const createdTasks: any[] = [];
    const warnings: string[] = [];

    for (const department of departments) {
      const telegramChatId = resolveTelegramChatId(department) as number;

      const { data: task, error: insertError } = await supabaseAdmin
        .from('tasks')
        .insert({
          room,
          department,
          task_text: taskText,
          status: 'OPEN',
          created_by_name: user.name,
          created_by_email: userEmail,
          chat_id: telegramChatId,
          image_url: firstImageUrl,
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
          chat_id,
          image_url,
          done_by_name,
          done_at,
          reopened_at,
          last_updated_by_name,
          edited_at,
          edited_by_name,
          edited_by_email,
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
        const telegramMessageId = await sendTelegramTaskCard({
          chatId: telegramChatId,
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
