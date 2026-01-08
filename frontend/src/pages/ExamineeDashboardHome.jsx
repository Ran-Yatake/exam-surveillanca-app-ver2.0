import React from 'react';

export default function ExamineeDashboardHome({ onGoMeeting, onGoProfile }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold">生徒ダッシュボード</h2>
      <p className="mt-1 text-sm text-slate-600">ここから会議参加・プロフィール編集に移動できます。</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <button
          onClick={onGoMeeting}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          会議参加ページ
        </button>
        <button
          onClick={onGoProfile}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
        >
          プロフィール編集
        </button>
      </div>
    </div>
  );
}
