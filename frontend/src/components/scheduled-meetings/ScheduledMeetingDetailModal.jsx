import React, { useEffect, useMemo, useState } from 'react';

import { listAttendanceSessions, listChatLogs } from '../../api/client.js';

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

function safeText(v) {
  return String(v == null ? '' : v);
}

function escapeCsv(value) {
  const s = safeText(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function decodeBase64UrlUtf8(token) {
  const raw = String(token || '');
  if (!raw) return '';

  // Browser API availability varies (older Safari / embedded webviews).
  if (typeof atob !== 'function') return raw;

  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (b64.length % 4)) % 4;
    const padded = b64 + '='.repeat(padLen);
    const binary = atob(padded);

    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    if (typeof TextDecoder === 'function') {
      return new TextDecoder().decode(bytes);
    }

    // Fallback: percent-encode and decode as UTF-8.
    let percent = '';
    for (let i = 0; i < bytes.length; i++) percent += `%${bytes[i].toString(16).padStart(2, '0')}`;
    return decodeURIComponent(percent);
  } catch (_) {
    return raw;
  }
}

function toDisplayNameFromExternalUserId(externalUserId) {
  const base = String(externalUserId || '').split('#')[0];
  const parts = base.split(':');
  if (parts.length >= 2 && (parts[0] === 'student' || parts[0] === 'proctor')) {
    const token = parts[1] || '';
    if (!token) return base;
    const decoded = decodeBase64UrlUtf8(token);
    return decoded || token;
  }
  if (base.startsWith('student-')) return base;
  if (base.startsWith('proctor-')) return base;
  return base;
}

function formatIsoLocal(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
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
  const [copyState, setCopyState] = useState(''); // '' | 'copied' | 'failed'
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState('');

  const [chatLogRows, setChatLogRows] = useState([]);
  const [chatLogLoading, setChatLogLoading] = useState(false);
  const [chatLogError, setChatLogError] = useState('');

  const timeListId = useMemo(() => `schedule-time-15min-${Math.random().toString(16).slice(2)}`, []);

  const title = meeting?.title || '（無題）';
  const teacher = meeting?.teacher_name || '—';
  const scheduledAt = formatScheduleTime(meeting?.scheduled_start_at);
  const status = meeting?.status || '—';
  const joinCode = meeting?.join_code || '';

  const joinUrl = (() => {
    const code = String(joinCode || '').trim();
    if (!code) return '';
    try {
      return `${window.location.origin}/?join=${encodeURIComponent(code)}`;
    } catch (_) {
      return `/?join=${encodeURIComponent(code)}`;
    }
  })();

  useEffect(() => {
    if (!open) return;
    setIsEditing(false);
    setLocalError('');
    setCopyState('');
    setAttendanceError('');
    setChatLogError('');
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

  const refreshAttendance = async () => {
    const code = String(joinCode || '').trim();
    if (!code) return;

    setAttendanceLoading(true);
    setAttendanceError('');
    try {
      const res = await listAttendanceSessions(code);
      setAttendanceRows(Array.isArray(res) ? res : []);
    } catch (e) {
      setAttendanceRows([]);
      setAttendanceError(e?.message || '参加ログの取得に失敗しました');
    } finally {
      setAttendanceLoading(false);
    }
  };

  const refreshChatLogs = async () => {
    const code = String(joinCode || '').trim();
    if (!code) return;

    setChatLogLoading(true);
    setChatLogError('');
    try {
      const res = await listChatLogs(code);
      setChatLogRows(Array.isArray(res) ? res : []);
    } catch (e) {
      setChatLogRows([]);
      setChatLogError(e?.message || 'チャットログの取得に失敗しました');
    } finally {
      setChatLogLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (!joinCode) return;
    refreshAttendance();
    refreshChatLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, joinCode]);

  if (!open) return null;

  const downloadAttendanceCsv = () => {
    const code = String(joinCode || '').trim();
    if (!code) return;

    const rows = Array.isArray(attendanceRows) ? attendanceRows : [];
    const header = [
      'join_code',
      'role',
      'display_name',
      'external_user_id',
      'attendee_id',
      'joined_at',
      'left_at',
      'duration_seconds',
    ];

    const lines = [header.map(escapeCsv).join(',')];
    for (const r of rows) {
      const externalUserId = r?.external_user_id || '';
      const displayName = toDisplayNameFromExternalUserId(externalUserId);
      const line = [
        r?.join_code || code,
        r?.role || '',
        displayName,
        externalUserId,
        r?.attendee_id || '',
        r?.joined_at || '',
        r?.left_at || '',
        r?.duration_seconds ?? '',
      ];
      lines.push(line.map(escapeCsv).join(','));
    }

    // Add UTF-8 BOM for Excel compatibility (JP env).
    const csvText = `\uFEFF${lines.join('\n')}\n`;
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date();
    const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(ts.getDate()).padStart(2, '0')}-${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}`;
    a.download = `attendance-${code}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadChatLogCsv = () => {
    const code = String(joinCode || '').trim();
    if (!code) return;

    const rows = Array.isArray(chatLogRows) ? chatLogRows : [];
    const header = [
      'join_code',
      'message_id',
      'type',
      'from_role',
      'from_attendee_id',
      'to_role',
      'to_attendee_id',
      'text',
      'ts',
      'created_at',
    ];

    const lines = [header.map(escapeCsv).join(',')];
    for (const r of rows) {
      const line = [
        r?.join_code || code,
        r?.message_id || '',
        r?.type || '',
        r?.from_role || '',
        r?.from_attendee_id || '',
        r?.to_role || '',
        r?.to_attendee_id || '',
        r?.text || '',
        r?.ts || '',
        r?.created_at || '',
      ];
      lines.push(line.map(escapeCsv).join(','));
    }

    const csvText = `\uFEFF${lines.join('\n')}\n`;
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date();
    const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(ts.getDate()).padStart(2, '0')}-${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}`;
    a.download = `chat-${code}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyJoinUrl = async () => {
    const text = String(joinUrl || '').trim();
    if (!text) return;
    setCopyState('');
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (!ok) throw new Error('copy failed');
      }
      setCopyState('copied');
      setTimeout(() => setCopyState(''), 2000);
    } catch (_) {
      setCopyState('failed');
      setTimeout(() => setCopyState(''), 2000);
    }
  };

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

                <div className="text-slate-500">参加URL</div>
                <div className="text-slate-800 break-words">
                  {joinUrl ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="min-w-0 flex-1 text-xs text-slate-800 break-all">{joinUrl}</div>
                      <button
                        type="button"
                        onClick={copyJoinUrl}
                        disabled={busy}
                        className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        コピー
                      </button>
                      {copyState === 'copied' && <span className="text-xs font-semibold text-emerald-700">コピーしました</span>}
                      {copyState === 'failed' && <span className="text-xs font-semibold text-rose-700">コピー失敗</span>}
                    </div>
                  ) : (
                    '—'
                  )}
                </div>
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

        {!isEditing && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold text-slate-900">参加ログ</div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={refreshAttendance}
                  disabled={attendanceLoading || busy || !joinCode}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {attendanceLoading ? '取得中...' : '更新'}
                </button>
                <button
                  type="button"
                  onClick={downloadAttendanceCsv}
                  disabled={attendanceLoading || busy || !joinCode}
                  className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  CSV出力
                </button>
              </div>
            </div>

            {attendanceError && <div className="mt-2 text-sm font-semibold text-rose-600">{attendanceError}</div>}

            <div className="mt-3 overflow-x-auto">
              {Array.isArray(attendanceRows) && attendanceRows.length > 0 ? (
                <table className="min-w-full border-collapse">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-slate-600">
                      <th className="border-b border-slate-200 pb-2 pr-3">表示名</th>
                      <th className="border-b border-slate-200 pb-2 pr-3">ロール</th>
                      <th className="border-b border-slate-200 pb-2 pr-3">入室</th>
                      <th className="border-b border-slate-200 pb-2 pr-3">退室</th>
                      <th className="border-b border-slate-200 pb-2 pr-3">参加(秒)</th>
                      <th className="border-b border-slate-200 pb-2">AttendeeId</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceRows.map((r) => {
                      const externalUserId = r?.external_user_id || '';
                      const displayName = toDisplayNameFromExternalUserId(externalUserId);
                      return (
                        <tr key={`${r?.id || ''}-${r?.attendee_id || ''}`} className="text-sm text-slate-800">
                          <td className="border-b border-slate-100 py-2 pr-3 whitespace-nowrap">{displayName || '—'}</td>
                          <td className="border-b border-slate-100 py-2 pr-3 whitespace-nowrap">{r?.role || '—'}</td>
                          <td className="border-b border-slate-100 py-2 pr-3 whitespace-nowrap">{formatIsoLocal(r?.joined_at)}</td>
                          <td className="border-b border-slate-100 py-2 pr-3 whitespace-nowrap">{formatIsoLocal(r?.left_at)}</td>
                          <td className="border-b border-slate-100 py-2 pr-3 whitespace-nowrap">{r?.duration_seconds ?? '—'}</td>
                          <td className="border-b border-slate-100 py-2 text-xs text-slate-700 break-all">{r?.attendee_id || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="text-sm text-slate-600">参加ログがありません。</div>
              )}
            </div>
          </div>
        )}

        {!isEditing && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold text-slate-900">チャットログ</div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={refreshChatLogs}
                  disabled={chatLogLoading || busy || !joinCode}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {chatLogLoading ? '取得中...' : '更新'}
                </button>
                <button
                  type="button"
                  onClick={downloadChatLogCsv}
                  disabled={chatLogLoading || busy || !joinCode}
                  className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  CSV出力
                </button>
              </div>
            </div>

            {chatLogError && <div className="mt-2 text-sm font-semibold text-rose-600">{chatLogError}</div>}

            <div className="mt-3 overflow-x-auto">
              {Array.isArray(chatLogRows) && chatLogRows.length > 0 ? (
                <table className="min-w-full border-collapse">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-slate-600">
                      <th className="border-b border-slate-200 pb-2 pr-3">時刻</th>
                      <th className="border-b border-slate-200 pb-2 pr-3">From</th>
                      <th className="border-b border-slate-200 pb-2 pr-3">To</th>
                      <th className="border-b border-slate-200 pb-2 pr-3">種別</th>
                      <th className="border-b border-slate-200 pb-2">内容</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chatLogRows.map((r) => (
                      <tr key={`${r?.id || ''}-${r?.message_id || ''}`} className="text-sm text-slate-800">
                        <td className="border-b border-slate-100 py-2 pr-3 whitespace-nowrap">{formatIsoLocal(r?.ts)}</td>
                        <td className="border-b border-slate-100 py-2 pr-3 whitespace-nowrap">
                          {`${r?.from_role || '—'}`}
                        </td>
                        <td className="border-b border-slate-100 py-2 pr-3 whitespace-nowrap">
                          {`${r?.to_role || '—'}`}
                        </td>
                        <td className="border-b border-slate-100 py-2 pr-3 whitespace-nowrap">{r?.type || '—'}</td>
                        <td className="border-b border-slate-100 py-2 break-words">{safeText(r?.text || '')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-sm text-slate-600">チャットログがありません。</div>
              )}
            </div>
          </div>
        )}

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
