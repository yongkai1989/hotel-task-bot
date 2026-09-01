import { jsPDF } from 'jspdf';

export type HkSchedulePdfStaff = {
  id: string;
  staff_name: string;
  staff_role: 'SUPERVISOR' | 'MAID' | 'LINEN_CONTROLLER' | 'PA';
  is_active: boolean;
  sort_order: number;
};

export type HkSchedulePdfEntry = {
  staff_id: string;
  schedule_date: string;
  status: 'WORK' | 'AL' | 'UPL' | 'NO_SHOW' | 'MC' | 'OFF';
  shift_code_snapshot: string | null;
  is_late: boolean;
};

type PdfInput = {
  month: string;
  staff: HkSchedulePdfStaff[];
  entries: HkSchedulePdfEntry[];
};

const ROLE_ORDER: HkSchedulePdfStaff['staff_role'][] = ['SUPERVISOR', 'MAID', 'LINEN_CONTROLLER', 'PA'];
const ROLE_LABELS: Record<HkSchedulePdfStaff['staff_role'], string> = {
  SUPERVISOR: 'SUPERVISOR',
  MAID: 'CHAMBERMAID',
  LINEN_CONTROLLER: 'LINEN CONTROLLER',
  PA: 'P.A.',
};

const STATUS_LABELS: Record<HkSchedulePdfEntry['status'], string> = {
  WORK: 'WORK',
  AL: 'AL',
  UPL: 'UPL',
  NO_SHOW: 'NS',
  MC: 'MC',
  OFF: 'OFF',
};

const STATUS_COLOURS: Record<HkSchedulePdfEntry['status'], [number, number, number]> = {
  WORK: [225, 237, 255],
  AL: [220, 252, 231],
  UPL: [254, 243, 199],
  NO_SHOW: [220, 38, 38],
  MC: [243, 232, 255],
  OFF: [226, 232, 240],
};

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function ascii(value: string) {
  return value.normalize('NFKD').replace(/[^\x20-\x7E]/g, '').trim();
}

function monthDetails(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  const label = new Intl.DateTimeFormat('en-MY', { month: 'long', year: 'numeric' })
    .format(new Date(year, monthNumber - 1, 1));
  return {
    year,
    monthNumber,
    lastDay,
    label,
    start: `01/${pad(monthNumber)}/${year}`,
    end: `${pad(lastDay)}/${pad(monthNumber)}/${year}`,
  };
}

function textSizeForWidth(doc: jsPDF, text: string, maxWidth: number, preferred: number, minimum = 2.5) {
  let size = preferred;
  doc.setFontSize(size);
  while (size > minimum && doc.getTextWidth(text) > maxWidth) {
    size -= 0.2;
    doc.setFontSize(size);
  }
  return size;
}

function drawCenteredText(doc: jsPDF, text: string, x: number, y: number, width: number, preferred: number, minimum = 2.5) {
  const clean = ascii(text);
  textSizeForWidth(doc, clean, width - 0.8, preferred, minimum);
  doc.text(clean, x + width / 2, y, { align: 'center' });
}

function entryText(entry: HkSchedulePdfEntry | undefined) {
  if (!entry) return '';
  if (entry.status !== 'WORK') return STATUS_LABELS[entry.status];
  return ascii(entry.shift_code_snapshot || 'WORK').replace(/\s+/g, '');
}

function drawLegendItem(doc: jsPDF, x: number, y: number, colour: [number, number, number], label: string) {
  doc.setFillColor(...colour);
  doc.roundedRect(x, y - 2.2, 3.2, 3.2, 0.6, 0.6, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.4);
  doc.setTextColor(68, 83, 109);
  doc.text(label, x + 4.2, y + 0.2);
  return x + 4.2 + doc.getTextWidth(label) + 5;
}

export function createHkSchedulePdf({ month, staff, entries }: PdfInput) {
  const details = monthDetails(month);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 6;
  const activeStaff = staff
    .filter((person) => person.is_active)
    .sort((a, b) => ROLE_ORDER.indexOf(a.staff_role) - ROLE_ORDER.indexOf(b.staff_role) || a.sort_order - b.sort_order || a.staff_name.localeCompare(b.staff_name));
  const monthEntries = entries.filter((entry) => entry.schedule_date >= `${month}-01` && entry.schedule_date <= `${month}-${pad(details.lastDay)}`);
  const entryMap = new Map(monthEntries.map((entry) => [`${entry.staff_id}:${entry.schedule_date}`, entry]));
  const presentRoles = ROLE_ORDER.filter((role) => activeStaff.some((person) => person.staff_role === role));

  doc.setFillColor(20, 41, 74);
  doc.roundedRect(margin, margin, pageWidth - margin * 2, 11, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`HOUSEKEEPING SCHEDULE - ${ascii(details.label).toUpperCase()}`, margin + 4, margin + 7);
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`${details.start} - ${details.end}`, pageWidth - margin - 4, margin + 7, { align: 'right' });

  let legendX = margin;
  const legendY = 21;
  legendX = drawLegendItem(doc, legendX, legendY, STATUS_COLOURS.WORK, 'Work shift');
  legendX = drawLegendItem(doc, legendX, legendY, STATUS_COLOURS.AL, 'AL');
  legendX = drawLegendItem(doc, legendX, legendY, STATUS_COLOURS.UPL, 'UPL');
  legendX = drawLegendItem(doc, legendX, legendY, STATUS_COLOURS.MC, 'MC');
  legendX = drawLegendItem(doc, legendX, legendY, STATUS_COLOURS.OFF, 'Off');
  drawLegendItem(doc, legendX, legendY, STATUS_COLOURS.NO_SHOW, 'No Show');
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(68, 83, 109);
  doc.text(`${activeStaff.length} staff`, pageWidth - margin, legendY + 0.2, { align: 'right' });

  const tableY = 25;
  const footerSpace = 7;
  const headerHeight = 9;
  const roleHeight = 4.1;
  const availableStaffHeight = pageHeight - tableY - footerSpace - headerHeight - presentRoles.length * roleHeight;
  const staffRowHeight = Math.max(3.1, Math.min(7.3, availableStaffHeight / Math.max(activeStaff.length, 1)));
  const staffWidth = 38;
  const dayWidth = (pageWidth - margin * 2 - staffWidth) / details.lastDay;
  const tableWidth = staffWidth + dayWidth * details.lastDay;
  const headerFill: [number, number, number] = [245, 248, 252];
  const border: [number, number, number] = [204, 216, 232];

  doc.setLineWidth(0.18);
  doc.setDrawColor(...border);
  doc.setFillColor(...headerFill);
  doc.rect(margin, tableY, staffWidth, headerHeight, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(31, 49, 78);
  doc.setFontSize(6.5);
  doc.text('STAFF MEMBER', margin + 2, tableY + 5.6);

  for (let day = 1; day <= details.lastDay; day += 1) {
    const date = new Date(details.year, details.monthNumber - 1, day);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const x = margin + staffWidth + (day - 1) * dayWidth;
    doc.setFillColor(...(weekend ? [236, 241, 248] as [number, number, number] : headerFill));
    doc.rect(x, tableY, dayWidth, headerHeight, 'FD');
    doc.setTextColor(80, 98, 126);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(4.5);
    const weekday = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][date.getDay()];
    doc.text(weekday, x + dayWidth / 2, tableY + 3.3, { align: 'center' });
    doc.setFontSize(6.2);
    doc.setTextColor(25, 49, 86);
    doc.text(String(day), x + dayWidth / 2, tableY + 7.2, { align: 'center' });
  }

  let y = tableY + headerHeight;
  for (const role of presentRoles) {
    doc.setFillColor(226, 234, 245);
    doc.setDrawColor(...border);
    doc.rect(margin, y, tableWidth, roleHeight, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(55, 82, 122);
    doc.setFontSize(4.7);
    doc.text(ROLE_LABELS[role], margin + 2, y + 2.8);
    y += roleHeight;

    for (const person of activeStaff.filter((candidate) => candidate.staff_role === role)) {
      doc.setFillColor(255, 255, 255);
      doc.rect(margin, y, staffWidth, staffRowHeight, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(32, 50, 78);
      const name = ascii(person.staff_name);
      textSizeForWidth(doc, name, staffWidth - 3, Math.min(6, staffRowHeight * 1.2), 3);
      doc.text(name, margin + 1.5, y + staffRowHeight / 2 + 1.1);

      for (let day = 1; day <= details.lastDay; day += 1) {
        const dateValue = `${month}-${pad(day)}`;
        const entry = entryMap.get(`${person.id}:${dateValue}`);
        const weekend = new Date(details.year, details.monthNumber - 1, day).getDay() % 6 === 0;
        const x = margin + staffWidth + (day - 1) * dayWidth;
        const fill: [number, number, number] = entry
          ? STATUS_COLOURS[entry.status]
          : (weekend ? [248, 250, 253] : [255, 255, 255]);
        doc.setFillColor(...fill);
        doc.setDrawColor(...border);
        doc.rect(x, y, dayWidth, staffRowHeight, 'FD');
        if (!entry) continue;
        doc.setFont('helvetica', 'bold');
        const textColour: [number, number, number] = entry.status === 'NO_SHOW'
          ? [255, 255, 255]
          : [29, 78, 159];
        doc.setTextColor(...textColour);
        const label = entryText(entry);
        const labelY = y + staffRowHeight / 2 + (entry.is_late ? 0.1 : 0.9);
        drawCenteredText(doc, label, x, labelY, dayWidth, Math.min(4.4, staffRowHeight), 2.3);
        if (entry.status === 'WORK' && entry.is_late && staffRowHeight >= 4.5) {
          doc.setTextColor(185, 72, 0);
          doc.setFont('helvetica', 'bold');
          drawCenteredText(doc, 'LATE', x, y + staffRowHeight - 0.9, dayWidth, 2.8, 2.1);
        }
      }
      y += staffRowHeight;
    }
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  doc.setTextColor(102, 118, 142);
  doc.text('Generated from the selected monthly schedule. Blank cells are unscheduled.', margin, pageHeight - 2.8);
  doc.text('Page 1 of 2', pageWidth - margin, pageHeight - 2.8, { align: 'right' });

  doc.addPage('a4', 'landscape');
  doc.setFillColor(20, 41, 74);
  doc.roundedRect(margin, margin, pageWidth - margin * 2, 14, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('MONTHLY MISCONDUCT SUMMARY', margin + 4, margin + 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text(`${ascii(details.label)} | ${details.start} - ${details.end}`, margin + 4, margin + 11.2);

  const misconductRows = staff.map((person) => {
    const personEntries = monthEntries.filter((entry) => entry.staff_id === person.id);
    const noShow = personEntries.filter((entry) => entry.status === 'NO_SHOW').length;
    const late = personEntries.filter((entry) => entry.status === 'WORK' && entry.is_late).length;
    return { person, noShow, late, total: noShow + late };
  }).sort((a, b) => b.total - a.total || b.noShow - a.noShow || a.person.staff_name.localeCompare(b.person.staff_name));
  const totalNoShow = misconductRows.reduce((sum, row) => sum + row.noShow, 0);
  const totalLate = misconductRows.reduce((sum, row) => sum + row.late, 0);
  const totalMisconduct = totalNoShow + totalLate;

  const cardY = 24;
  const cardWidth = 52;
  const cardGap = 4;
  const cards = [
    { label: 'NO SHOW', value: totalNoShow, fill: [255, 241, 242] as [number, number, number], colour: [180, 35, 24] as [number, number, number] },
    { label: 'LATE ARRIVALS', value: totalLate, fill: [255, 251, 235] as [number, number, number], colour: [151, 98, 0] as [number, number, number] },
    { label: 'TOTAL MISCONDUCT', value: totalMisconduct, fill: [239, 246, 255] as [number, number, number], colour: [29, 78, 216] as [number, number, number] },
  ];
  cards.forEach((card, index) => {
    const x = margin + index * (cardWidth + cardGap);
    doc.setFillColor(...card.fill);
    doc.setDrawColor(...border);
    doc.roundedRect(x, cardY, cardWidth, 14, 1.5, 1.5, 'FD');
    doc.setTextColor(...card.colour);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.5);
    doc.text(card.label, x + 3, cardY + 5);
    doc.setFontSize(13);
    doc.text(String(card.value), x + 3, cardY + 11.2);
  });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(94, 111, 137);
  doc.setFontSize(6.2);
  doc.text('Misconduct count = No Show + Late arrivals. Every staff name is included, including zero counts.', pageWidth - margin, cardY + 8.2, { align: 'right' });

  const reportY = 43;
  const reportWidth = pageWidth - margin * 2;
  const columns = [14, 92, 55, 38, 38, 44];
  const scale = reportWidth / columns.reduce((sum, value) => sum + value, 0);
  const widths = columns.map((value) => value * scale);
  const reportHeaderHeight = 8;
  const reportBottom = pageHeight - 8;
  const reportRowHeight = Math.max(3.1, Math.min(7.2, (reportBottom - reportY - reportHeaderHeight) / Math.max(misconductRows.length, 1)));
  const headers = ['#', 'STAFF NAME', 'ROLE', 'NO SHOW', 'LATE', 'TOTAL MISCONDUCT'];
  let x = margin;
  doc.setDrawColor(...border);
  headers.forEach((header, index) => {
    doc.setFillColor(56, 78, 110);
    doc.rect(x, reportY, widths[index], reportHeaderHeight, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(6.2);
    if (index === 1 || index === 2) doc.text(header, x + 2, reportY + 5.1);
    else doc.text(header, x + widths[index] / 2, reportY + 5.1, { align: 'center' });
    x += widths[index];
  });

  y = reportY + reportHeaderHeight;
  misconductRows.forEach((row, rowIndex) => {
    x = margin;
    const values = [String(rowIndex + 1), ascii(row.person.staff_name), ROLE_LABELS[row.person.staff_role], String(row.noShow), String(row.late), String(row.total)];
    values.forEach((value, columnIndex) => {
      const flagged = columnIndex >= 3 && Number(value) > 0;
      const rowFill: [number, number, number] = flagged
        ? (columnIndex === 5 ? [239, 246, 255] : [255, 248, 235])
        : (rowIndex % 2 ? [249, 251, 253] : [255, 255, 255]);
      doc.setFillColor(...rowFill);
      doc.setDrawColor(...border);
      doc.rect(x, y, widths[columnIndex], reportRowHeight, 'FD');
      doc.setFont('helvetica', columnIndex === 1 || columnIndex === 5 ? 'bold' : 'normal');
      const valueColour: [number, number, number] = flagged ? [166, 73, 18] : [35, 52, 78];
      doc.setTextColor(...valueColour);
      const fontSize = Math.min(7, reportRowHeight * 1.2);
      if (columnIndex === 1 || columnIndex === 2) {
        textSizeForWidth(doc, value, widths[columnIndex] - 4, fontSize, 3);
        doc.text(value, x + 2, y + reportRowHeight / 2 + 1.1);
      } else {
        drawCenteredText(doc, value, x, y + reportRowHeight / 2 + 1.1, widths[columnIndex], fontSize, 3);
      }
      x += widths[columnIndex];
    });
    y += reportRowHeight;
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  doc.setTextColor(102, 118, 142);
  doc.text('All figures cover the selected month only.', margin, pageHeight - 2.8);
  doc.text('Page 2 of 2', pageWidth - margin, pageHeight - 2.8, { align: 'right' });
  return doc;
}

export function downloadHkSchedulePdf(input: PdfInput) {
  const doc = createHkSchedulePdf(input);
  doc.save(`housekeeping-schedule-${input.month}.pdf`);
}
