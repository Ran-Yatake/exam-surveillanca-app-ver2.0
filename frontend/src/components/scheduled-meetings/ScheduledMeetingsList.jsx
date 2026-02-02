import React from 'react';

export default function ScheduledMeetingsList({
  scheduledMeetings,
  loading,
  error,
  onOpenCreate,
  onRefresh,
  onStartMeeting,
  onOpenDetail,
  formatScheduleTime,
}) {
  const list = Array.isArray(scheduledMeetings) ? scheduledMeetings : [];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold text-slate-800">予定一覧</div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={onOpenCreate}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            ＋ 作成
          </button>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '更新中...' : '更新'}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {list.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">予定がありません（「＋ 作成」から作成できます）。</p>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="hidden sm:grid sm:grid-cols-[minmax(0,1fr)_180px_200px_110px_1fr_192px] sm:items-center sm:gap-2 px-3 text-center text-xs font-semibold text-slate-600">
            <div>タイトル</div>
            <div>担当教員</div>
            <div>予定日時</div>
            <div>状態</div>
            <div>ID</div>
            <div />
          </div>
          {list.map((m) => {
            const title = m.title || '（無題）';
            const teacher = m.teacher_name || '—';
            const scheduledAt = formatScheduleTime?.(m.scheduled_start_at) ?? '—';
            const status = m.status || '—';
            const joinCode = m.join_code || '';
            return (
              <div
                key={m.join_code}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
              >
                <div className="w-full sm:hidden">
                  <div className="text-sm font-semibold text-slate-900">{title}</div>
                  <div className="mt-1 text-xs text-slate-600">
                    担当教員: <span className="text-slate-800">{teacher}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    予定: <span className="text-slate-800">{scheduledAt}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    状態: <span className="text-slate-800">{status}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    ID: <span className="text-slate-800">{joinCode}</span>
                  </div>
                </div>

                <div className="hidden w-full sm:grid sm:grid-cols-[minmax(0,1fr)_180px_200px_110px_1fr_192px] sm:items-center sm:gap-2 text-center">
                  <div className="text-sm text-slate-900 truncate">{title}</div>
                  <div className="text-sm text-slate-800 truncate">{teacher}</div>
                  <div className="text-sm text-slate-800">{scheduledAt}</div>
                  <div className="text-sm text-slate-800">{status}</div>
                  <div className="text-sm text-slate-800">{joinCode}</div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => onStartMeeting?.(m)}
                      className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
                    >
                      開始
                    </button>
                    <button
                      onClick={() => onOpenDetail?.(m)}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100"
                    >
                      詳細
                    </button>
                  </div>
                </div>

                <div className="sm:hidden ml-auto flex items-center gap-2">
                  <button
                    onClick={() => onStartMeeting?.(m)}
                    className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
                  >
                    開始
                  </button>
                  <button
                    onClick={() => onOpenDetail?.(m)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100"
                  >
                    詳細
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
