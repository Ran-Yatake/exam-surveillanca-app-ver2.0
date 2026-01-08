import React, { useEffect, useState } from 'react';

import { listScheduledMeetings } from '../api/client.js';

export default function ProctorDashboardHome({
  onGoMeeting,
  onGoProfile,
  onGoUsers,
  selectedJoinCode,
  onSelectJoinCode,
}) {
  const [scheduledMeetings, setScheduledMeetings] = useState([]);
  const [scheduleListLoading, setScheduleListLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState('');

  const refreshSchedules = async () => {
    setScheduleListLoading(true);
    setScheduleError('');
    try {
      const list = await listScheduledMeetings();
      setScheduledMeetings(Array.isArray(list) ? list : []);
    } catch (err) {
      setScheduleError(err?.message || 'スケジュール一覧の取得に失敗しました');
    } finally {
      setScheduleListLoading(false);
    }
  };

  useEffect(() => {
    refreshSchedules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatScheduleTime = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString();
    } catch (_) {
      return String(iso);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold">監督者ダッシュボード</h2>
        <p className="mt-1 text-sm text-slate-600">ここから会議参加・プロフィール編集に移動できます。</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            onClick={() => onGoMeeting('schedule')}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
          >
            会議スケジュール
          </button>
          <button
            onClick={onGoUsers}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
          >
            ユーザー一覧
          </button>
          <button
            onClick={onGoProfile}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
          >
            プロフィール編集
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold text-slate-800">予定一覧</div>
          <button
            onClick={refreshSchedules}
            disabled={scheduleListLoading}
            className="ml-auto rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {scheduleListLoading ? '更新中...' : '更新'}
          </button>
        </div>

        {scheduleError && <p className="mt-3 text-sm text-red-600">{scheduleError}</p>}

        {scheduledMeetings.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">予定がありません（会議スケジュールで作成できます）。</p>
        ) : (
          <div className="mt-3 space-y-2">
            <div className="hidden sm:grid sm:grid-cols-[minmax(0,1fr)_180px_200px_110px_1fr_96px] sm:items-center sm:gap-2 px-3 text-center text-xs font-semibold text-slate-600">
              <div>タイトル</div>
              <div>担当教員</div>
              <div>予定日時</div>
              <div>状態</div>
              <div>ID</div>
              <div />
            </div>
            {scheduledMeetings.map((m) => {
              const title = m.title || '（無題）';
              const teacher = m.teacher_name || '—';
              const scheduledAt = formatScheduleTime(m.scheduled_start_at);
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

                  <div className="hidden w-full sm:grid sm:grid-cols-[minmax(0,1fr)_180px_200px_110px_1fr_96px] sm:items-center sm:gap-2 text-center">
                    <div className="text-sm text-slate-900 truncate">{title}</div>
                    <div className="text-sm text-slate-800 truncate">{teacher}</div>
                    <div className="text-sm text-slate-800">{scheduledAt}</div>
                    <div className="text-sm text-slate-800">{status}</div>
                    <div className="text-sm text-slate-800">{joinCode}</div>
                    <div className="flex items-center justify-end">
                      <button
                        onClick={() => {
                          onSelectJoinCode(String(m.join_code || ''));
                          onGoMeeting('meeting');
                        }}
                        className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
                      >
                        開始
                      </button>
                    </div>
                  </div>

                  <div className="sm:hidden ml-auto flex items-center gap-2">
                    <button
                      onClick={() => {
                        onSelectJoinCode(String(m.join_code || ''));
                        onGoMeeting('meeting');
                      }}
                      className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
                    >
                      開始
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
