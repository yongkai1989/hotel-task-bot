const SINGAPORE_TIME_ZONE = 'Asia/Singapore';
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: SINGAPORE_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: SINGAPORE_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

type DateValue = string | number | Date | null | undefined;

function parseDateValue(value: DateValue) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const raw = String(value).trim();
  const dateOnly = raw.match(DATE_ONLY_PATTERN);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(`${year}-${month}-${day}T00:00:00+08:00`);
  }

  const parsed = new Date(typeof value === 'number' ? value : raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDateDDMMYYYY(value: DateValue, fallback = '-') {
  const date = parseDateValue(value);
  if (!date) return fallback;
  return DATE_FORMATTER.format(date);
}

export function formatDateTimeDDMMYYYY(value: DateValue, fallback = '-') {
  const date = parseDateValue(value);
  if (!date) return fallback;
  return DATE_TIME_FORMATTER.format(date);
}

export function formatMonthRangeDDMMYYYY(value: string, fallback = '-') {
  const match = String(value || '').match(MONTH_PATTERN);
  if (!match) return fallback;
  const [, year, month] = match;
  const lastDay = String(new Date(Number(year), Number(month), 0).getDate()).padStart(2, '0');
  return `01/${month}/${year} – ${lastDay}/${month}/${year}`;
}
