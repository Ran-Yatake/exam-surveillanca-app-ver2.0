import React from 'react';

const TIME_15MIN_OPTIONS = (() => {
  const out = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      out.push(`${hh}:${mm}`);
    }
  }
  return out;
})();

export default function CreateScheduledMeetingModal({
  open,
  busy,
  error,
  title,
  teacher,
  date,
  time,
  onClose,
  onTitleChange,
  onTeacherChange,
  onDateChange,
  onTimeChange,
  onSubmit,
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="schedule-create-title"
    >
      <button
        type="button"
        aria-label="閉じる"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        disabled={busy}
      />
      <div className="relative w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div id="schedule-create-title" className="text-base font-semibold text-slate-900">
              会議スケジュールを作成
            </div>
            <div className="mt-1 text-xs text-slate-600">試験名・担当教員・試験日時を入力してください</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            閉じる
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="schedule-title" className="block text-xs font-medium text-slate-600">
              試験名
            </label>
            <input
              id="schedule-title"
              value={title}
              onChange={(e) => onTitleChange?.(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label htmlFor="schedule-teacher" className="block text-xs font-medium text-slate-600">
              担当教員
            </label>
            <input
              id="schedule-teacher"
              value={teacher}
              onChange={(e) => onTeacherChange?.(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full sm:w-auto sm:min-w-[200px]">
                <label htmlFor="schedule-date" className="block text-xs font-medium text-slate-600">
                  日付
                </label>
                <input
                  id="schedule-date"
                  type="date"
                  value={date}
                  onChange={(e) => onDateChange?.(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="w-full sm:w-auto sm:min-w-[160px]">
                <label htmlFor="schedule-time" className="block text-xs font-medium text-slate-600">
                  時間
                </label>
                <input
                  id="schedule-time"
                  type="text"
                  inputMode="numeric"
                  placeholder="HH:MM"
                  list="schedule-time-15min"
                  value={time}
                  onChange={(e) => onTimeChange?.(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <datalist id="schedule-time-15min">
                  {TIME_15MIN_OPTIONS.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? '作成中...' : '作成'}
          </button>
        </div>
      </div>
    </div>
  );
}
