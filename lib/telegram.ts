export type TaskStatus = 'OPEN' | 'DONE';
export type Dept = 'HK' | 'MT' | 'FO';
import { formatDateTimeDDMMYYYY } from './dateDisplay';
import { isManagerRoomCheckTask } from './managerRoomCheckTaskSync';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

async function telegram(method: string, body: any) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return res.json();
}

function normalizeStatus(status: TaskStatus | string): TaskStatus {
  return String(status || '').toUpperCase() === 'DONE' ? 'DONE' : 'OPEN';
}

function labelForStatus(status: TaskStatus | string) {
  return normalizeStatus(status);
}

function formatDateTime(value?: string | null) {
  return formatDateTimeDDMMYYYY(value);
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
  const managerRoomCheck = isManagerRoomCheckTask(task);
  const lines = [
    'TASK',
    `Task ID: ${task.task_code}`,
    `Room: ${task.room}`,
    `Department: ${task.department}`,
    `Task: ${managerRoomCheck ? 'Manager Room Check.' : task.task_text}`,
    `Status: ${labelForStatus(task.status)}`,
    `Created by: ${task.created_by_name || '-'}`,
  ];

  if (task.image_url && !managerRoomCheck) {
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

export function buildTaskInlineKeyboard(
  taskId: string,
  status: TaskStatus,
  options?: { managerRoomCheck?: boolean }
) {
  const normalizedStatus = normalizeStatus(status);

  if (options?.managerRoomCheck) {
    return {
      inline_keyboard: [
        [
          {
            text: normalizedStatus === 'DONE' ? 'DONE OK' : 'DONE',
            callback_data: `done:${taskId}`,
          },
        ],
      ],
    };
  }

  return {
    inline_keyboard: [
      [
        {
          text: normalizedStatus === 'DONE' ? 'DONE OK' : 'DONE',
          callback_data: `done:${taskId}`,
        },
      ],
      [
        {
          text: normalizedStatus === 'OPEN' ? 'REOPENED' : 'REOPEN',
          callback_data: `reopen:${taskId}`,
        },
      ],
      [{ text: 'ADD PHOTO', callback_data: `photo:${taskId}` }],
    ],
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
  const managerRoomCheck = isManagerRoomCheckTask(params.task);
  const sent = await telegram('sendMessage', {
    chat_id: params.chatId,
    text: buildTaskMessageText(params.task),
    reply_markup: buildTaskInlineKeyboard(params.task.id, params.task.status, { managerRoomCheck }),
  });

  return sent?.result?.message_id ?? null;
}

export type TelegramTaskAttachment = {
  url: string;
  caption?: string | null;
};

function telegramMediaMethod(url: string) {
  let pathname = String(url || '').toLowerCase();
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    // The Bot API will validate the URL. This only chooses its media method.
  }
  if (/\.(mp4|m4v)$/.test(pathname)) return { method: 'sendVideo', field: 'video' } as const;
  if (/\.(mov|webm)$/.test(pathname)) return { method: 'sendDocument', field: 'document' } as const;
  return { method: 'sendPhoto', field: 'photo' } as const;
}

/**
 * Sends normal MT task evidence as visible Telegram media messages. Manager
 * Room Checks stay text-only because their dedicated page may contain many files.
 */
export async function sendTelegramTaskAttachments(params: {
  chatId: number;
  task: {
    task_code: string;
    room: string;
    department: Dept;
    task_text: string;
  };
  attachments: TelegramTaskAttachment[];
}) {
  const attachments = params.attachments.filter((item) => String(item.url || '').trim());
  if (
    params.task.department !== 'MT' ||
    isManagerRoomCheckTask(params.task) ||
    !attachments.length
  ) {
    return { sent: 0, skipped: true };
  }

  let sentCount = 0;
  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index];
    const media = telegramMediaMethod(attachment.url);
    const attachmentLabel =
      attachments.length === 1 ? 'Attachment' : `Attachment ${index + 1}/${attachments.length}`;
    const caption = [
      `MT TASK ${params.task.task_code}`,
      `Room: ${params.task.room}`,
      attachmentLabel,
      String(attachment.caption || '').trim(),
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 1024);
    const result = await telegram(media.method, {
      chat_id: params.chatId,
      [media.field]: attachment.url,
      caption,
    });
    if (!result?.ok) {
      throw new Error(result?.description || `Telegram could not send ${attachmentLabel.toLowerCase()}`);
    }
    sentCount += 1;
  }

  return { sent: sentCount, skipped: false };
}
