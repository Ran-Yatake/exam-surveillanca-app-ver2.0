import React, { useState } from 'react';

import PreJoinExamineeModal from '../components/examinee/PreJoinExamineeModal.jsx';

export default function ExamineeDashboardHome({ onGoMeeting, onGoProfile }) {
  const [prejoinOpen, setPrejoinOpen] = useState(false);
  const [prejoinBusy, setPrejoinBusy] = useState(false);
  const [prejoinError, setPrejoinError] = useState('');

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
          <button
            onClick={onGoProfile}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
          >
            プロフィール編集
          </button>
        </div>
      </div>

      <PreJoinExamineeModal
        open={prejoinOpen}
        busy={prejoinBusy}
        error={prejoinError}
        onClose={() => {
          if (prejoinBusy) return;
          setPrejoinOpen(false);
        }}
        onStart={async ({ meetingId, joinWithCamera, joinWithMic, prejoinStream }) => {
          const id = String(meetingId || '').trim();
          if (!id) {
            setPrejoinError('ミーティングIDを入力してください');
            return;
          }

          setPrejoinBusy(true);
          setPrejoinError('');
          try {
            onGoMeeting?.({
              joinCode: id,
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
