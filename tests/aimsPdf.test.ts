import { describe, expect, it } from 'vitest';
import { isAimsRoster, parseAimsRoster } from '@/domain/aimsPdf';
import { BUILTIN_DUTY_TYPES } from '@/domain/catalog';
import type { PdfTextItem } from '@/domain/importers';

const types = BUILTIN_DUTY_TYPES.map((t) => ({ ...t, createdAt: '', updatedAt: '' }));
const BOLD = 'g_d0_f3';
const REG = 'g_d0_f4';

/**
 * Lay out a synthetic AIMS grid like the real report: one column per date, 26pt apart,
 * header at y=108, cells stepping down 7pt. `**hh:mm**` marks a bold (report/sign-off) time.
 */
function grid(period: string, cols: [string, string[]][]): PdfTextItem[] {
  const items: PdfTextItem[] = [
    { page: 1, x: 293, y: 34, str: 'Personal Crew Schedule Report', font: 'f2' },
    { page: 1, x: 275, y: 64, str: `${period} (All times in Local Station)`, font: 'f1' },
  ];
  cols.forEach(([head, cells], i) => {
    const x = 19 + 26 * i;
    items.push({ page: 1, x, y: 108, str: head, font: BOLD }, { page: 1, x: x + 4, y: 117, str: 'Mon', font: BOLD });
    cells.forEach((c, j) => {
      const bold = /^\*\*.*\*\*$/.test(c);
      items.push({ page: 1, x: x - 3 + (j % 2), y: 126 + 7 * j, str: c.replace(/\*\*/g, ''), font: bold ? BOLD : REG });
    });
  });
  items.push({ page: 1, x: 27, y: 367, str: 'M', font: REG }, { page: 1, x: 18, y: 411, str: 'Total Hours and Statistics', font: BOLD });
  return items;
}

const brief = (rows: ReturnType<typeof parseAimsRoster>) =>
  rows.map((r) => [r.date, types.find((t) => t.id === r.dutyTypeId)?.code ?? '?', r.startTime ?? '', r.endTime ?? '', r.title ?? ''].join(' ').trim());

describe('AIMS Personal Crew Schedule PDF', () => {
  it('detects the report', () => {
    expect(isAimsRoster(grid('01/10/2026 - 31/10/2026', []))).toBe(true);
    expect(isAimsRoster([{ page: 1, x: 0, y: 0, str: 'Some other roster', font: REG }])).toBe(false);
  });

  it('reads free days, ground duties and a two-sector flight with a delay line', () => {
    const rows = parseAimsRoster(
      grid('01/10/2026 - 31/10/2026', [
        ['01/10', ['**08:50**', 'FD175', 'A10:07', 'DMK', 'MLE', 'A12:22', '[FD20]', 'FD176', 'A13:04', 'MLE', 'DMK', 'A19:34', '[FD20]', 'Delay', '00:47', '**20:04**']],
        ['02/10', ['ROFF']],
        ['03/10', ['DM2', '08:00', '16:00']],
        ['04/10', ['DH1', '11:00', '19:00']],
        ['05/10', ['AL']],
      ]),
      types,
    );
    expect(brief(rows)).toEqual([
      '2026-10-01 Flight 08:50 20:04 FD175 DMK–MLE–DMK',
      '2026-10-02 ROFF',
      '2026-10-03 Standby 08:00 16:00 DM2',
      '2026-10-04 Standby 11:00 19:00 DH1',
      '2026-10-05 AL',
    ]);
    expect(rows[0].notes).toBe('FD175 DMK-MLE 10:07-12:22\nFD176 MLE-DMK 13:04-19:34');
  });

  it('follows a duty past midnight (→ then ↓) and keeps the next day’s own status', () => {
    const rows = parseAimsRoster(
      grid('01/10/2026 - 31/10/2026', [
        ['13/10', ['**20:15**', 'FD3419', 'A21:13', 'DMK', 'CNX', 'A22:20', '[FD2Q]', 'FD3420', 'A22:53', 'CNX', '→']],
        ['14/10', ['↓', 'DMK', 'A00:01', '[FD2Q]', '**00:31**', 'REST']],
      ]),
      types,
    );
    expect(brief(rows)).toEqual(['2026-10-13 Flight 20:15 00:31 FD3419 DMK–CNX–DMK', '2026-10-14 Rest']);
    expect(rows[0].endDate).toBeUndefined(); // end before start already means the next day
  });

  it('handles a sign-off and a new report in the same column', () => {
    const rows = parseAimsRoster(
      grid('01/11/2026 - 30/11/2026', [
        ['28/11', ['**14:45**', 'FD3016', '22:05', 'HKT', 'DMK', '23:35', '[FD20]', '→']],
        ['29/11', ['↓', '**00:05**', '**17:55**', 'FD532', '18:55', 'DMK', 'CAN', '23:00', '[FD20]', '→']],
        ['30/11', ['↓', 'FD533', '00:05', 'CAN', 'DMK', '01:55', '[FD20]', '**02:25**']],
      ]),
      types,
    );
    // 30/11 only finishes the night's duty, so it's an OFF day (29/11 has its own report, so it isn't).
    expect(brief(rows)).toEqual(['2026-11-28 Flight 14:45 00:05 FD3016 HKT–DMK', '2026-11-29 Flight 17:55 02:25 FD532 DMK–CAN–DMK', '2026-11-30 OFF   >OFF']);
  });

  it('marks deadhead sectors and ends a duty without sign-off at its last arrival', () => {
    const rows = parseAimsRoster(
      grid('01/11/2026 - 30/11/2026', [
        ['21/11', ['**09:30**', 'FD3435', '10:30', '*DMK', 'CNX', '11:55']],
        ['22/11', ['**06:55**', 'FD3072', '07:55', 'CNX', 'KBV', '09:55', '[FD20]', '**12:50**']],
      ]),
      types,
    );
    expect(brief(rows)).toEqual(['2026-11-21 Flight 09:30 11:55 DH FD3435 DMK–CNX', '2026-11-22 Flight 06:55 12:50 FD3072 CNX–KBV']);
    expect(rows[0].notes).toContain('(DH)');
  });

  it('rolls the year over for spill-over dates and ignores bottom markers', () => {
    const rows = parseAimsRoster(grid('01/12/2026 - 31/12/2026', [['31/12', ['OFF']], ['01/01', ['ROFF']]]), types);
    expect(rows.map((r) => r.date)).toEqual(['2026-12-31', '2027-01-01']);
  });
});
