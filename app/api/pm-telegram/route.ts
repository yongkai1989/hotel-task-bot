import { NextResponse } from 'next/server';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const CHAT_ID = -1003784764929; // replace

async function telegram(method: string, body: any) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  return res.json();
}

export async function POST(req: Request) {
  try {
    const { title, startDate, dueDate, hasChecklist } = await req.json();

    const text = [
      '🔧 PREVENTIVE MAINTENANCE',
      `Task: ${title}`,
      `Start: ${startDate}`,
      `Due: ${dueDate}`,
      `Checklist: ${hasChecklist ? 'Room checklist attached' : 'No checklist'}`
    ].join('\\n');

    await telegram('sendMessage', {
      chat_id: CHAT_ID,
      text
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('PM Telegram error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
