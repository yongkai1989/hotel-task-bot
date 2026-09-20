import { createHash, timingSafeEqual } from 'node:crypto';

const TASK_SCHEDULER_TOKEN_SHA256 =
  'cb70481797ed96935694b28ba43e631eb0ecaaec86662db7a62d3395532627f3';

export function isTaskSchedulerAuthorization(authorization: string | null) {
  const value = String(authorization || '');
  const token = value.startsWith('Bearer ') ? value.slice(7).trim() : '';
  if (!token) return false;
  const received = createHash('sha256').update(token).digest();
  const expected = Buffer.from(TASK_SCHEDULER_TOKEN_SHA256, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
