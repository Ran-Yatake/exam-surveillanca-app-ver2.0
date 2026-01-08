import React, { useEffect, useState } from 'react';

import {
  createScheduledMeeting,
  deleteScheduledMeeting,
  fetchProfile,
  listScheduledMeetings,
} from '../api/client.js';

export default function ProctorSchedulePage({
  selectedJoinCode,
  onSelectJoinCode,
  onGoMeeting,
  onDone,
  currentUsername,
}) {
  const [scheduledMeetings, setScheduledMeetings] = useState([]);
  const [profile, setProfile] = useState(null);
  const [scheduleTitle, setScheduleTitle] = useState('');
  const [scheduleTeacher, setScheduleTeacher] = useState('');
  const [teacherEdited, setTeacherEdited] = useState(false);
  const [scheduleStartAt, setScheduleStartAt] = useState('');
  const [scheduleListLoading, setScheduleListLoading] = useState(false);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleError, setScheduleError] = useState('');

  const formatScheduleTime = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString();
    } catch (_) {
      return String(iso);
    }
  };

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

  useEffect(() => {
    let cancelled = false;
    fetchProfile()
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => {
        // ignore; fallback to currentUsername
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Default teacher name to profile display name (preferred), then username.
    // Keep updating to display_name until user edits the field.
    if (teacherEdited) return;
    const fallback = String(currentUsername || '').trim();
    const preferred = String(profile?.display_name || '').trim();
    if (preferred) {
      if (scheduleTeacher !== preferred) setScheduleTeacher(preferred);
      return;
    }
    if (!scheduleTeacher && fallback) setScheduleTeacher(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUsername, profile, teacherEdited, scheduleTeacher]);

  const createSchedule = async () => {
    setScheduleBusy(true);
    setScheduleError('');
    try {
      const body = {
        title: String(scheduleTitle || '').trim() || null,
        teacher_name: String(scheduleTeacher || '').trim() || null,
        scheduled_start_at: scheduleStartAt ? new Date(scheduleStartAt).toISOString() : null,
      };
      const created = await createScheduledMeeting(body);
      if (created?.join_code) {
        onSelectJoinCode(created.join_code);
      }
      await refreshSchedules();
    } catch (err) {
      setScheduleError(err?.message || 'スケジュール作成に失敗しました');
    } finally {
      setScheduleBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold">会議スケジュール</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={onDone}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
          >
            ← ダッシュボードに戻る
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="text-sm font-semibold text-slate-800">新規作成</div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-auto sm:min-w-[240px]">
            <label htmlFor="schedule-title" className="block text-xs font-medium text-slate-600">
              試験名
            </label>
            <input
              id="schedule-title"
              value={scheduleTitle}
              onChange={(e) => setScheduleTitle(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="w-full sm:w-auto sm:min-w-[240px]">
            <label htmlFor="schedule-teacher" className="block text-xs font-medium text-slate-600">
              担当教員
            </label>
            <input
              id="schedule-teacher"
              value={scheduleTeacher}
              onChange={(e) => {
                setTeacherEdited(true);
                setScheduleTeacher(e.target.value);
              }}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="w-full sm:w-auto">
            <label htmlFor="schedule-start-at" className="block text-xs font-medium text-slate-600">
              試験日時
            </label>
            <input
              id="schedule-start-at"
              type="datetime-local"
              value={scheduleStartAt}
              onChange={(e) => setScheduleStartAt(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <button
            onClick={createSchedule}
            disabled={scheduleBusy}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {scheduleBusy ? '作成中...' : '作成'}
          </button>
          <button
            onClick={refreshSchedules}
            disabled={scheduleListLoading}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {scheduleListLoading ? '更新中...' : '一覧更新'}
          </button>
        </div>

        {scheduleError && <p className="mt-3 text-sm text-red-600">{scheduleError}</p>}

        {scheduledMeetings.length > 0 && (
          <div className="mt-6">
            <div className="text-xs font-medium text-slate-600">あなたの予定一覧</div>
            <div className="mt-2 space-y-2">
              <div className="hidden sm:grid sm:grid-cols-[minmax(0,1fr)_180px_200px_110px_1fr_96px_96px] sm:items-center sm:gap-2 px-3 text-center text-xs font-semibold text-slate-600">
                <div>タイトル</div>
                <div>担当教員</div>
                <div>予定日時</div>
                <div>状態</div>
                <div>ID</div>
                <div />
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

                    <div className="hidden w-full sm:grid sm:grid-cols-[minmax(0,1fr)_180px_200px_110px_1fr_96px_96px] sm:items-center sm:gap-2 text-center">
                      <div className="text-sm text-slate-900 truncate">{title}</div>
                      <div className="text-sm text-slate-800 truncate">{teacher}</div>
                      <div className="text-sm text-slate-800">{scheduledAt}</div>
                      <div className="text-sm text-slate-800">{status}</div>
                      <div className="text-sm text-slate-800">{joinCode}</div>
                      <div className="flex justify-end translate-x-10">
                        <button
                          onClick={() => {
                            onSelectJoinCode(m.join_code);
                            onGoMeeting();
                          }}
                          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
                        >
                          開始
                        </button>
                      </div>
                      <div className="flex justify-start translate-x-10">
                        <button
                          onClick={async () => {
                            try {
                              const ok = window.confirm(`このミーティングを削除しますか？\n${m.join_code}`);
                              if (!ok) return;
                              await deleteScheduledMeeting(m.join_code);
                              if (selectedJoinCode === m.join_code) {
                                onSelectJoinCode('');
                              }
                              await refreshSchedules();
                            } catch (err) {
                              setScheduleError(err?.message || '削除に失敗しました');
                            }
                          }}
                          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100"
                        >
                          削除
                        </button>
                      </div>
                    </div>

                    <div className="sm:hidden ml-auto flex items-center gap-2">
                      <button
                        onClick={() => {
                          onSelectJoinCode(m.join_code);
                          onGoMeeting();
                        }}
                        className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
                      >
                        開始
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            const ok = window.confirm(`このミーティングを削除しますか？\n${m.join_code}`);
                            if (!ok) return;
                            await deleteScheduledMeeting(m.join_code);
                            if (selectedJoinCode === m.join_code) {
                              onSelectJoinCode('');
                            }
                            await refreshSchedules();
                          } catch (err) {
                            setScheduleError(err?.message || '削除に失敗しました');
                          }
                        }}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
