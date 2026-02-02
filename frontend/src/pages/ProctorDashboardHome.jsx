import React, { useEffect, useState } from 'react';

import {
  createScheduledMeeting,
  deleteScheduledMeeting,
  fetchProfile,
  listScheduledMeetings,
  updateScheduledMeeting,
} from '../api/client.js';
import ScheduledMeetingDetailModal from '../components/scheduled-meetings/ScheduledMeetingDetailModal.jsx';
import CreateScheduledMeetingModal from '../components/scheduled-meetings/CreateScheduledMeetingModal.jsx';
import ScheduledMeetingsList from '../components/scheduled-meetings/ScheduledMeetingsList.jsx';

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
      <ScheduledMeetingsList
        scheduledMeetings={scheduledMeetings}
        loading={scheduleListLoading}
        error={scheduleError}
        onOpenCreate={openCreateModal}
        onRefresh={refreshSchedules}
        onStartMeeting={(m) => {
          onSelectJoinCode(String(m?.join_code || ''));
          onGoMeeting();
        }}
        onOpenDetail={(m) => openDetail(m)}
        formatScheduleTime={formatScheduleTime}
      />

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

      <CreateScheduledMeetingModal
        open={createModalOpen}
        busy={createBusy}
        error={createError}
        title={scheduleTitle}
        teacher={scheduleTeacher}
        date={scheduleDate}
        time={scheduleTime}
        onClose={closeCreateModal}
        onTitleChange={(v) => setScheduleTitle(v)}
        onTeacherChange={(v) => {
          setTeacherEdited(true);
          setScheduleTeacher(v);
        }}
        onDateChange={(v) => setScheduleDate(v)}
        onTimeChange={(v) => setScheduleTime(v)}
        onSubmit={createSchedule}
      />
    </div>
  );
}
