import React, { useEffect, useMemo, useState } from 'react';

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

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toLocalDateInput(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  } catch (_) {
    return '';
  }
}

function toLocalTimeInput(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  } catch (_) {
    return '';
  }
}

function formatScheduleTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (_) {
    return String(iso);
  }
}

export default function ScheduledMeetingDetailModal({
  open,
  meeting,
  onClose,
  onDelete,
  onUpdate,
  busy,
  error,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editTeacher, setEditTeacher] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [localError, setLocalError] = useState('');

  const timeListId = useMemo(() => `schedule-time-15min-${Math.random().toString(16).slice(2)}`, []);

  useEffect(() => {
    if (!open) return;
    setIsEditing(false);
    setLocalError('');
    setEditTitle(String(meeting?.title || ''));
    setEditTeacher(String(meeting?.teacher_name || ''));
    setEditDate(toLocalDateInput(meeting?.scheduled_start_at));
    setEditTime(toLocalTimeInput(meeting?.scheduled_start_at));
  }, [open, meeting]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (busy) return;
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, busy, onClose]);

  if (!open) return null;

  const title = meeting?.title || '（無題）';
  const teacher = meeting?.teacher_name || '—';
  const scheduledAt = formatScheduleTime(meeting?.scheduled_start_at);
  const status = meeting?.status || '—';
  const joinCode = meeting?.join_code || '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="schedule-detail-title"
    >
      <button
        type="button"
        aria-label="閉じる"
        className="absolute inset-0 bg-black/40"
        onClick={() => {
          if (busy) return;
          onClose?.();
        }}
        disabled={busy}
      />
      <div className="relative w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div id="schedule-detail-title" className="text-base font-semibold text-slate-900">
              会議詳細
            </div>
            <div className="mt-1 text-xs text-slate-600">会議の内容を確認して開始/削除できます</div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (busy) return;
              onClose?.();
            }}
            disabled={busy}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            閉じる
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {!isEditing ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-sm font-semibold text-slate-900 break-words">{title}</div>
              <div className="mt-2 grid grid-cols-[88px_1fr] gap-y-1 text-sm">
                <div className="text-slate-500">担当教員</div>
                <div className="text-slate-800 break-words">{teacher}</div>
                <div className="text-slate-500">予定日時</div>
                <div className="text-slate-800 break-words">{scheduledAt}</div>
                <div className="text-slate-500">状態</div>
                <div className="text-slate-800 break-words">{status}</div>
                <div className="text-slate-500">ID</div>
                <div className="text-slate-800 break-words">{joinCode || '—'}</div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold text-slate-700">編集</div>
              <div className="mt-3 space-y-3">
                <div>
                  <label htmlFor="edit-title" className="block text-xs font-medium text-slate-600">
                    試験名
                  </label>
                  <input
                    id="edit-title"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label htmlFor="edit-teacher" className="block text-xs font-medium text-slate-600">
                    担当教員
                  </label>
                  <input
                    id="edit-teacher"
                    value={editTeacher}
                    onChange={(e) => setEditTeacher(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-full sm:w-auto sm:min-w-[200px]">
                    <label htmlFor="edit-date" className="block text-xs font-medium text-slate-600">
                      日付
                    </label>
                    <input
                      id="edit-date"
                      type="date"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="w-full sm:w-auto sm:min-w-[160px]">
                    <label htmlFor="edit-time" className="block text-xs font-medium text-slate-600">
                      時間
                    </label>
                    <input
                      id="edit-time"
                      type="text"
                      inputMode="numeric"
                      placeholder="HH:MM"
                      list={timeListId}
                      value={editTime}
                      onChange={(e) => setEditTime(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <datalist id={timeListId}>
                      {TIME_15MIN_OPTIONS.map((t) => (
                        <option key={t} value={t} />
                      ))}
                    </datalist>
                  </div>
                </div>
              </div>
            </div>
          )}

          {(localError || error) && <p className="text-sm text-red-600">{localError || error}</p>}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={async () => {
              if (busy) return;
              setLocalError('');
              if (!isEditing) {
                setIsEditing(true);
                return;
              }

              const hasDate = Boolean(String(editDate || '').trim());
              const hasTime = Boolean(String(editTime || '').trim());
              if ((hasDate && !hasTime) || (!hasDate && hasTime)) {
                setLocalError('日付と時間は両方入力してください。');
                return;
              }
              if (hasDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(editDate).trim())) {
                setLocalError('日付の形式が正しくありません。');
                return;
              }
              if (hasTime && !/^\d{1,2}:\d{2}$/.test(String(editTime).trim())) {
                setLocalError('時間の形式が正しくありません（例: 09:30）。');
                return;
              }

              const localDateTime =
                hasDate && hasTime ? `${String(editDate).trim()}T${String(editTime).trim()}` : '';
              const body = {
                title: String(editTitle || '').trim() || null,
                teacher_name: String(editTeacher || '').trim() || null,
                scheduled_start_at: localDateTime ? new Date(localDateTime).toISOString() : null,
              };

              try {
                const updated = await onUpdate?.(body);
                if (updated) {
                  setIsEditing(false);
                  setLocalError('');
                }
              } catch (e) {
                setLocalError(e?.message || '更新に失敗しました');
              }
            }}
            disabled={busy || !onUpdate}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isEditing ? '保存' : '編集'}
          </button>

          {!isEditing && (
            <button
              type="button"
              onClick={() => onDelete?.()}
              disabled={busy}
              className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              削除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
