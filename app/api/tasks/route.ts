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
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
        }
      }
    );
  }

  return NextResponse.json(
    { ok: true, tasks: data || [] },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
      }
    }
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const room = String(body.room || '').trim();
    const department = normalizeDept(body.department);
    const taskText = String(body.task_text || body.taskText || '').trim();
    const createdByName = String(body.created_by_name || body.createdByName || 'Dashboard').trim();
    const imageUrl = body.image_url ? String(body.image_url).trim() : null;
    const imageCaption = body.image_caption ? String(body.image_caption).trim() : null;

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

    const { data: task, error: insertError } = await supabaseAdmin
      .from('tasks')
      .insert({
        room,
        department,
        task_text: taskText,
        status: 'OPEN',
        created_by_name: createdByName,
        chat_id: telegramChatId,
        image_url: imageUrl,
        reopened_at: null
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
      actor_name: createdByName
    });

    if (imageUrl) {
      await supabaseAdmin.from('task_images').insert({
        task_id: task.id,
        image_url: imageUrl,
        caption: imageCaption || null,
        created_by_name: createdByName
      });
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
        last_updated_by_name: task.last_updated_by_name
      }
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
        message_type: 'TASK_CARD'
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
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
          }
        }
      );
    }

    return NextResponse.json(
      { ok: true, task: finalTask },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
        }
      }
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
