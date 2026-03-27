export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE';
export type Dept = 'HK' | 'MT' | 'FO';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

async function telegram(method: string, body: any) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  return res.json();
}

function labelForStatus(status: TaskStatus) {
  if (status === 'IN_PROGRESS') return 'DOING';
  return status;
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function buildTaskMessageText(task: {
  task_code: string;
  room: string;
  department: Dept;
  task_text: string;
  created_by_name?: string | null;
  image_url?: string | null;
  status: TaskStatus;
  done_by_name?: string | null;
  done_at?: string | null;
  reopened_at?: string | null;
  last_updated_by_name?: string | null;
}) {
  const lines = [
    '📌 TASK',
    `Task ID: ${task.task_code}`,
    `Room: ${task.room}`,
    `Department: ${task.department}`,
    `Task: ${task.task_text}`,
    `Status: ${labelForStatus(task.status)}`,
    `Created by: ${task.created_by_name || '-'}`
  ];

  if (task.image_url) {
    lines.push('Photo attached: Yes');
  }

  if (task.status === 'DONE') {
    lines.push(`Done by: ${task.done_by_name || '-'}`);
    if (task.done_at) {
      lines.push(`Done at: ${formatDateTime(task.done_at)}`);
    }
  } else {
    if (task.last_updated_by_name) {
      lines.push(`Last updated by: ${task.last_updated_by_name}`);
    }

    if (task.reopened_at) {
      lines.push(`Reopened at: ${formatDateTime(task.reopened_at)}`);
    }
  }

  return lines.join('\n');
}

export function buildTaskInlineKeyboard(taskId: string, status: TaskStatus) {
  return {
    inline_keyboard: [
      [
        {
          text: status === 'IN_PROGRESS' ? '🔵 DOING ✓' : '🔵 DOING',
          callback_data: `doing:${taskId}`
        },
        {
          text: status === 'DONE' ? '✅ DONE ✓' : '✅ DONE',
          callback_data: `done:${taskId}`
        }
      ],
      [
        {
          text: status === 'OPEN' ? '♻️ REOPEN ✓' : '♻️ REOPEN',
          callback_data: `reopen:${taskId}`
        }
      ],
      [
        { text: '📷 ADD PHOTO', callback_data: `photo:${taskId}` }
      ]
    ]
  };
}

export async function sendTelegramTaskCard(params: {
  chatId: number;
  task: {
    id: string;
    task_code: string;
    room: string;
    department: Dept;
    task_text: string;
    created_by_name?: string | null;
    image_url?: string | null;
    status: TaskStatus;
    done_by_name?: string | null;
    done_at?: string | null;
    reopened_at?: string | null;
    last_updated_by_name?: string | null;
  };
}) {
  const sent = await telegram('sendMessage', {
    chat_id: params.chatId,
    text: buildTaskMessageText(params.task),
    reply_markup: buildTaskInlineKeyboard(params.task.id, params.task.status)
  });

  return sent?.result?.message_id ?? null;
}
