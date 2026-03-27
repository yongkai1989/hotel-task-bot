import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { sendTelegramTaskCard, Dept } from '../../../lib/telegram';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function normalizeDept(value: string): Dept | null {
  const v = String(value || '').trim().toUpperCase();

  if (v === 'HK') return 'HK';
  if (v === 'MT') return 'MT';
  if (v === 'FO') return 'FO';

  return null;
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

function normalizeImageCaptions(body: any, imageCount: number): (string | null)[] {
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
    return Array.from({ length: imageCount }, (_, idx) => (idx === 0 ? single : null));
  }

  return Array.from({ length: imageCount }, () => null);
}

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('tasks')
    .select(`
      *,
      task_images (
        id,
        image_url,
        caption,
        created_at
      )
    `)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        },
      }
    );
  }

  return NextResponse.json(
    { ok: true, tasks: data || [] },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    }
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const room = String(body.room || '').trim();
    const department = normalizeDept(body.department);
    const taskText = String(body.task_text || body.taskText || '').trim();
    const createdByName = String(
      body.created_by_name || body.createdByName || 'Dashboard'
    ).trim();

    const imageUrls = normalizeImageUrls(body);
    const imageCaptions = normalizeImageCaptions(body, imageUrls.length);

    if (!room) {
      return NextResponse.json(
        { ok: false, error: 'Room is required' },
        { status: 400 }
      );
    }

    if (!department) {
      return NextResponse.json(
        { ok: false, error: 'Department must be HK, MT, or FO' },
        { status: 400 }
      );
    }

    if (!taskText) {
      return NextResponse.json(
        { ok: false, error: 'Task text is required' },
        { status: 400 }
      );
    }

    const chatIdRaw = process.env.ALLOWED_CHAT_ID;
    const telegramChatId = Number(chatIdRaw);

    if (!chatIdRaw || Number.isNaN(telegramChatId)) {
      return NextResponse.json(
        { ok: false, error: 'ALLOWED_CHAT_ID is missing or invalid' },
        { status: 500 }
      );
    }

    const firstImageUrl = imageUrls.length > 0 ? imageUrls[0] : null;

    const { data: task, error: insertError } = await supabaseAdmin
      .from('tasks')
      .insert({
        room,
        department,
        task_text: taskText,
        status: 'OPEN',
        created_by_name: createdByName,
        chat_id: telegramChatId,
        image_url: firstImageUrl,
        reopened_at: null,
      })
      .select()
      .single();

    if (insertError || !task) {
      return NextResponse.json(
        { ok: false, error: insertError?.message || 'Failed to create task' },
        { status: 500 }
      );
    }

    await supabaseAdmin.from('task_events').insert({
      task_id: task.id,
      event_type: 'CREATED',
      event_text: `${taskText} (created from dashboard)`,
      actor_name: createdByName,
    });

    if (imageUrls.length > 0) {
      const imageRows = imageUrls.map((url, index) => ({
        task_id: task.id,
        image_url: url,
        caption: imageCaptions[index] || null,
        created_by_name: createdByName,
      }));

      const { error: imageInsertError } = await supabaseAdmin
        .from('task_images')
        .insert(imageRows);

      if (imageInsertError) {
        return NextResponse.json(
          { ok: false, error: imageInsertError.message },
          { status: 500 }
        );
      }
    }

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
        reopened_at: task.reopened_at,
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

    const { data: finalTask, error: finalTaskError } = await supabaseAdmin
      .from('tasks')
      .select(`
        *,
        task_images (
          id,
          image_url,
          caption,
          created_at
        )
      `)
      .eq('id', task.id)
      .single();

    if (finalTaskError) {
      return NextResponse.json(
        { ok: true, task },
        {
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          },
        }
      );
    }

    return NextResponse.json(
      { ok: true, task: finalTask },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        },
      }
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
