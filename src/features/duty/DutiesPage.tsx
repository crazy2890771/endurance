import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileUp, Plane, Plus, Settings2 } from 'lucide-react';
import { useUI } from '@/app/ui';
import { EmptyState, PageHeader, Segmented } from '@/components/ui';
import { DutyBadge } from '@/components/cards';
import { useAllDuties, useDutyTypes } from '@/db/hooks';
import { fromISODate, todayISO } from '@/lib/dates';
import { useI18n } from '@/i18n';

export function DutiesPage() {
  const { t, fmt } = useI18n();
  const { open } = useUI();
  const duties = useAllDuties();
  const types = useDutyTypes();
  const [tab, setTab] = useState<'up' | 'past'>('up');
  const typeById = new Map((types ?? []).map((x) => [x.id, x]));
  const today = todayISO();
  const list = (duties ?? []).filter((d) => (tab === 'up' ? (d.endDate ?? d.date) >= today : (d.endDate ?? d.date) < today));
  if (tab === 'past') list.reverse();

  return (
    <div className="pb-28">
      <PageHeader
        title={t('duty.list')}
        back="/settings"
        right={
          <Link to="/settings/duty-types" className="icon-btn" aria-label={t('duty.types')}>
            <Settings2 size={22} />
          </Link>
        }
      />
      <div className="px-4">
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button className="btn-primary" onClick={() => open({ kind: 'dutyEditor', date: today })}>
            <Plus size={20} /> {t('duty.add')}
          </button>
          <Link to="/settings/import" className="btn-ghost">
            <FileUp size={20} /> {t('duty.import')}
          </Link>
        </div>
        <Segmented value={tab} onChange={setTab} options={[{ value: 'up', label: t('duty.upcoming') }, { value: 'past', label: t('duty.past') }]} />
        <div className="mt-4 flex flex-col gap-2">
          {duties === undefined ? null : list.length === 0 ? (
            <EmptyState icon={<Plane size={26} />} title={t('duty.empty')} hint={t('duty.emptyHint')} />
          ) : (
            list.slice(0, 200).map((d) => {
              const ty = typeById.get(d.dutyTypeId);
              return (
                <button key={d.id} className="card px-3 py-3 flex items-center gap-3 text-left" onClick={() => open({ kind: 'dutyEditor', id: d.id })}>
                  <div className="w-12 text-center shrink-0">
                    <p className="text-[11px] text-muted">{fmt(fromISODate(d.date), 'EEE')}</p>
                    <p className="text-lg font-bold leading-tight">{fmt(fromISODate(d.date), 'd')}</p>
                    <p className="text-[10px] text-muted">{fmt(fromISODate(d.date), 'MMM')}</p>
                  </div>
                  <DutyBadge duty={d} type={ty} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{d.title ?? ty?.label}</p>
                    <p className="text-xs text-muted truncate">
                      {d.startTime && d.endTime ? `${d.startTime}–${d.endTime}` : ''}
                      {d.endDate ? ` → ${fmt(fromISODate(d.endDate), 'd MMM')}` : ''}
                      {d.source !== 'manual' ? ` · ${d.source.toUpperCase()}` : ''}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
