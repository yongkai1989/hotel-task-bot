import { NextResponse } from 'next/server';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const CHAT_ID = -1003946542037;

async function telegram(method: string, body: any) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return res.json();
}

export async function POST(req: Request) {
  try {
    const { checklistTitle, submittedBy, date, answers } = await req.json();

    // Filter ONLY "No" answers
    const negativeAnswers = (answers || []).filter(
      (a: any) =>
        a.answer_mode === 'YES_NO' &&
        a.answer_yes_no === false
    );

    // If no issues, don't send anything
    if (negativeAnswers.length === 0) {
      return NextResponse.json({ ok: true });
    }

    const messageLines = [
      'DAILY FORM ALERT',
      '',
      `Form: ${checklistTitle}`,
      `By: ${submittedBy}`,
      `Date: ${date}`,
      '',
      'Issues Found:',
      ...negativeAnswers.map((a: any) => `❌ ${a.question_text}`)
    ];

    const text = messageLines.join('\n');

    await telegram('sendMessage', {
      chat_id: CHAT_ID,
      text,
    });

    return NextResponse.json({ ok: true });

  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      error: err?.message || 'Telegram send failed',
    });
  }
}
