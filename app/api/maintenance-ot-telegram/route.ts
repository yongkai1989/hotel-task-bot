import { NextResponse } from 'next/server';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const CHAT_ID = -1003860980789;

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

    const { name, hours, reason } = await req.json();

    // Only trigger if > 3 hours
    if (!hours || Number(hours) <= 3) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    if (!reason || !reason.trim()) {
      return NextResponse.json(
        { ok: false, error: 'Reason required for OT > 3 hours' },
        { status: 400 }
      );
    }

    const text = [
      'MAINTENANCE OT REVIEW',
      `Staff: ${name}`,
      `Hours: ${hours}`,
      `Reason: ${reason}`,
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
