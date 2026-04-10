export async function sendPMTaskMessage(params: {
  chatId: number;
  title: string;
  startDate: string;
  dueDate: string;
  hasChecklist: boolean;
}) {
  const lines = [
    '🔧 PREVENTIVE MAINTENANCE',
    `Task: ${params.title}`,
    `Start Date: ${params.startDate}`,
    `Due Date: ${params.dueDate}`,
    `Checklist: ${params.hasChecklist ? 'Room checklist attached' : 'No checklist'}`
  ];

  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      chat_id: params.chatId,
      text: lines.join('\\n')
    })
  });

  const data = await res.json();
  return data?.result?.message_id ?? null;
}
