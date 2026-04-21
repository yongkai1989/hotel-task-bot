import { NextResponse } from 'next/server';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const CHAT_ID = -1003946542037;

async function telegram(method: string, body: any) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return {
    httpOk: res.ok,
    data,
  };
}

export async function POST(req: Request) {
  try {
    if (!BOT_TOKEN) {
      return NextResponse.json(
        { ok: false, error: 'Missing TELEGRAM_BOT_TOKEN' },
        { status: 500 }
      );
    }

    const { checklistTitle, submittedBy, date } = await req.json();

    if (!checklistTitle || !submittedBy || !date) {
      return NextResponse.json(
        { ok: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const text = [
      '📋 DAILY FORM SUBMITTED',
      `Checklist: ${checklistTitle}`,
      `Submitted by: ${submittedBy}`,
      `Date: ${date}`,
    ].join('\n');

    const tg = await telegram('sendMessage', {
      chat_id: CHAT_ID,
      text,
    });

    if (!tg.httpOk || !tg.data?.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: tg.data?.description || 'Telegram send failed',
          telegram: tg.data,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message_id: tg.data.result?.message_id ?? null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
