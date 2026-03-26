import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const BOT_TOKEN = process.env.BOT_TOKEN!;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const message = body.message;

    if (!message) {
      return NextResponse.json({ ok: true });
    }

    const chatId = message.chat.id;
    const from = message.from;
    const name = from?.first_name + (from?.last_name ? ' ' + from.last_name : '');

    // ✅ HANDLE TEXT OR IMAGE CAPTION
    let text = message.text || message.caption;

    if (!text) {
      return sendMessage(chatId, 'Invalid format. Example:\n1234 hk extra towel');
    }

    text = text.trim().toLowerCase();

    // =========================
    // HANDLE REPLY COMMANDS
    // =========================
    if (text === '/done' || text === '/doing') {
      const reply = message.reply_to_message;

      if (!reply) {
        return sendMessage(chatId, 'Please reply to a task message.');
      }

      const taskCodeMatch = reply.text?.match(/Task ID:\s*(T\d+)/);
      if (!taskCodeMatch) {
        return sendMessage(chatId, 'Task ID not found.');
      }

      const taskCode = taskCodeMatch[1];

      const status = text === '/done' ? 'DONE' : 'IN_PROGRESS';

      const updateData: any = {
        status,
        last_updated_by_name: name,
        last_updated_by_telegram_user_id: from.id
      };

      if (status === 'DONE') {
        updateData.done_at = new Date().toISOString();
        updateData.done_by_name = name;
        updateData.done_by_telegram_user_id = from.id;
      }

      await supabaseAdmin
        .from('tasks')
        .update(updateData)
        .eq('task_code', taskCode);

      return sendMessage(chatId, `✅ Task ${taskCode} updated to ${status}`);
    }

    // =========================
    // PARSE TASK INPUT
    // =========================
    const parts = text.split(' ');

    if (parts.length < 2) {
      return sendMessage(chatId, 'Invalid format. Example:\n1234 hk extra towel');
    }

    const room = parts[0];
    let dept = parts[1];
    const taskText = parts.slice(2).join(' ') || '';

    if (!['hk', 'mt', 'fo'].includes(dept)) {
      return sendMessage(chatId, `Which department for room ${room}?\nReply only: hk, mt, fo`);
    }

    dept = dept.toUpperCase();

    // =========================
    // HANDLE IMAGE (OPTIONAL)
    // =========================
    let imageUrl: string | null = null;

    if (message.photo) {
      const largestPhoto = message.photo[message.photo.length - 1];
      const fileId = largestPhoto.file_id;

      const fileRes = await fetch(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
      const fileData = await fileRes.json();

      if (fileData.ok) {
        const filePath = fileData.result.file_path;
        imageUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
      }
    }

    // =========================
    // CREATE TASK
    // =========================
    const { data, error } = await supabaseAdmin
      .from('tasks')
      .insert({
        room,
        department: dept,
        task_text: taskText,
        status: 'OPEN',
        created_by_name: name,
        created_by_telegram_user_id: from.id,
        image_url: imageUrl // ✅ optional column
      })
      .select()
      .single();

    if (error) {
      console.error(error);
      return sendMessage(chatId, 'Error creating task.');
    }

    const taskMsg = `📌 NEW TASK
Task ID: ${data.task_code}
Room: ${room}
Department: ${dept}
Task: ${taskText}
Created by: ${name}

Reply to this message with:
/doing
/done`;

    return sendMessage(chatId, taskMsg);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: true });
  }
}

async function sendMessage(chatId: number, text: string) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text
    })
  });

  return NextResponse.json({ ok: true });
}
