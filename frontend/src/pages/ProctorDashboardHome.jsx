import React, { useEffect, useState } from 'react';

import {
  createScheduledMeeting,
  deleteScheduledMeeting,
  fetchProfile,
  listScheduledMeetings,
  updateScheduledMeeting,
} from '../api/client.js';
import ScheduledMeetingDetailModal from '../components/ScheduledMeetingDetailModal.jsx';

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

export default function ProctorDashboardHome({
  onGoMeeting,
  onGoProfile,
  onGoUsers,
  selectedJoinCode,
  onSelectJoinCode,
  currentUsername,
}) {
  const [scheduledMeetings, setScheduledMeetings] = useState([]);
  const [scheduleListLoading, setScheduleListLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [profile, setProfile] = useState(null);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [scheduleTitle, setScheduleTitle] = useState('');
  const [scheduleTeacher, setScheduleTeacher] = useState('');
  const [teacherEdited, setTeacherEdited] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailMeeting, setDetailMeeting] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState('');

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

  useEffect(() => {
    if (!createModalOpen) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (createBusy) return;
        setCreateModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [createModalOpen, createBusy]);

  const formatScheduleTime = (iso) => {
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
  };

  const normalizeTime = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const m = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    if (hh < 0 || hh > 23) return null;
    if (mm < 0 || mm > 59) return null;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };

  const openDetail = (m) => {
    setDetailError('');
    setDetailMeeting(m || null);
    setDetailOpen(true);
  };

  const closeDetail = () => {
    if (detailBusy) return;
    setDetailOpen(false);
  };

  const openCreateModal = () => {
    setCreateError('');
    setCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    if (createBusy) return;
    setCreateModalOpen(false);
  };

  const createSchedule = async () => {
    setCreateBusy(true);
    setCreateError('');
    try {
      const hasDate = Boolean(String(scheduleDate || '').trim());
      const hasTime = Boolean(String(scheduleTime || '').trim());
      if ((hasDate && !hasTime) || (!hasDate && hasTime)) {
        setCreateError('日付と時間は両方入力してください。');
        return;
      }

      if (hasDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(scheduleDate).trim())) {
        setCreateError('日付の形式が正しくありません。');
        return;
      }
      const normalizedTime = hasTime ? normalizeTime(scheduleTime) : '';
      if (hasTime && !normalizedTime) {
        setCreateError('時間の形式が正しくありません（例: 09:30）。');
        return;
      }

      const localDateTime = hasDate && hasTime ? `${String(scheduleDate).trim()}T${normalizedTime}` : '';
      const body = {
        title: String(scheduleTitle || '').trim() || null,
        teacher_name: String(scheduleTeacher || '').trim() || null,
        scheduled_start_at: localDateTime ? new Date(localDateTime).toISOString() : null,
      };
      const created = await createScheduledMeeting(body);
      if (created?.join_code) {
        onSelectJoinCode(String(created.join_code));
      }
      await refreshSchedules();
      setScheduleTitle('');
      setScheduleDate('');
      setScheduleTime('');
      setTeacherEdited(false);
      setCreateModalOpen(false);
    } catch (err) {
      setCreateError(err?.message || 'スケジュール作成に失敗しました');
    } finally {
      setCreateBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold text-slate-800">予定一覧</div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              onClick={openCreateModal}
              className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              ＋ 作成
            </button>
            <button
              onClick={refreshSchedules}
              disabled={scheduleListLoading}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {scheduleListLoading ? '更新中...' : '更新'}
            </button>
          </div>
        </div>

        {scheduleError && <p className="mt-3 text-sm text-red-600">{scheduleError}</p>}

        {scheduledMeetings.length === 0 ? (
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

                  <div className="hidden w-full sm:grid sm:grid-cols-[minmax(0,1fr)_180px_200px_110px_1fr_192px] sm:items-center sm:gap-2 text-center">
                    <div className="text-sm text-slate-900 truncate">{title}</div>
                    <div className="text-sm text-slate-800 truncate">{teacher}</div>
                    <div className="text-sm text-slate-800">{scheduledAt}</div>
                    <div className="text-sm text-slate-800">{status}</div>
                    <div className="text-sm text-slate-800">{joinCode}</div>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          onSelectJoinCode(String(m.join_code || ''));
                          onGoMeeting();
                        }}
                        className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
                      >
                        開始
                      </button>
                      <button
                        onClick={() => openDetail(m)}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100"
                      >
                        詳細
                      </button>
                    </div>
                  </div>

                  <div className="sm:hidden ml-auto flex items-center gap-2">
                    <button
                      onClick={() => {
                        onSelectJoinCode(String(m.join_code || ''));
                        onGoMeeting();
                      }}
                      className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
                    >
                      開始
                    </button>
                    <button
                      onClick={() => openDetail(m)}
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

      <ScheduledMeetingDetailModal
        open={detailOpen}
        meeting={detailMeeting}
        busy={detailBusy}
        error={detailError}
        onClose={closeDetail}
        onUpdate={async (body) => {
          const joinCode = String(detailMeeting?.join_code || '');
          if (!joinCode) throw new Error('join_code が見つかりません');
          setDetailBusy(true);
          setDetailError('');
          try {
            const updated = await updateScheduledMeeting(joinCode, body);
            setDetailMeeting(updated || null);
            await refreshSchedules();
            return updated;
          } catch (err) {
            setDetailError(err?.message || '更新に失敗しました');
            throw err;
          } finally {
            setDetailBusy(false);
          }
        }}
        onDelete={async () => {
          const joinCode = String(detailMeeting?.join_code || '');
          if (!joinCode) return;
          const ok = window.confirm(`このミーティングを削除しますか？\n${joinCode}`);
          if (!ok) return;
          setDetailBusy(true);
          setDetailError('');
          try {
            await deleteScheduledMeeting(joinCode);
            if (String(selectedJoinCode || '') === joinCode) {
              onSelectJoinCode('');
            }
            await refreshSchedules();
            setDetailOpen(false);
          } catch (err) {
            setDetailError(err?.message || '削除に失敗しました');
          } finally {
            setDetailBusy(false);
          }
        }}
      />

      {createModalOpen && (
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
            onClick={closeCreateModal}
            disabled={createBusy}
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
                onClick={closeCreateModal}
                disabled={createBusy}
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
                  value={scheduleTitle}
                  onChange={(e) => setScheduleTitle(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
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

              <div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-full sm:w-auto sm:min-w-[200px]">
                    <label htmlFor="schedule-date" className="block text-xs font-medium text-slate-600">
                      日付
                    </label>
                    <input
                      id="schedule-date"
                      type="date"
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
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
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
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

              {createError && <p className="text-sm text-red-600">{createError}</p>}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={createSchedule}
                disabled={createBusy}
                className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {createBusy ? '作成中...' : '作成'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
