import React, { useEffect, useState } from 'react';

import PreJoinExamineeModal from '../components/examinee/PreJoinExamineeModal.jsx';

export default function ExamineeDashboardHome({
  onGoMeeting,
  onGoProfile,
  showProfileButton = true,
  autoOpenPrejoin = false,
  onAutoOpenPrejoinConsumed,
  initialMeetingId = '',
  initialDisplayName = '',
}) {
  const [prejoinOpen, setPrejoinOpen] = useState(false);
  const [prejoinBusy, setPrejoinBusy] = useState(false);
  const [prejoinError, setPrejoinError] = useState('');
  const [guestDisplayName, setGuestDisplayName] = useState('');
  const [prefillMeetingId, setPrefillMeetingId] = useState('');

  const isGuest = !showProfileButton;

  useEffect(() => {
    if (!autoOpenPrejoin) return;
    setPrejoinError('');
    setPrefillMeetingId(String(initialMeetingId || '').trim());
    setGuestDisplayName(String(initialDisplayName || '').trim());
    setPrejoinOpen(true);
    onAutoOpenPrejoinConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenPrejoin]);

  return (
    <>
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              setPrejoinError('');
              setPrejoinOpen(true);
            }}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            試験参加
          </button>
          {showProfileButton && (
            <button
              onClick={onGoProfile}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
            >
              プロフィール編集
            </button>
          )}
        </div>
      </div>

      <PreJoinExamineeModal
        open={prejoinOpen}
        busy={prejoinBusy}
        error={prejoinError}
        requireDisplayName={isGuest}
        initialDisplayName={isGuest ? guestDisplayName : ''}
        initialMeetingId={prefillMeetingId}
        onClose={() => {
          if (prejoinBusy) return;
          setPrejoinOpen(false);
        }}
        onStart={async ({ meetingId, displayName, joinWithCamera, joinWithMic, prejoinStream }) => {
          const id = String(meetingId || '').trim();
          if (!id) {
            setPrejoinError('ミーティングIDを入力してください');
            return;
          }

          const dn = String(displayName || '').trim();
          if (isGuest && !dn) {
            setPrejoinError('ゲスト参加では表示名を入力してください');
            return;
          }

          setPrejoinBusy(true);
          setPrejoinError('');
          try {
            if (isGuest) setGuestDisplayName(dn);
            onGoMeeting?.({
              joinCode: id,
              displayName: dn,
              joinWithCamera: Boolean(joinWithCamera),
              joinWithMic: Boolean(joinWithMic),
              prejoinStream: prejoinStream || null,
              autoJoin: true,
            });
            setPrejoinOpen(false);
          } catch (err) {
            setPrejoinError(err?.message || '開始に失敗しました');
          } finally {
            setPrejoinBusy(false);
          }
        }}
      />
    </>
  );
}
