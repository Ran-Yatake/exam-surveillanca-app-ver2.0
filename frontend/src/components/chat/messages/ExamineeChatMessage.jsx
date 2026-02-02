import React from 'react';

export default function ExamineeChatMessage({ message }) {
  const m = message || {};

  return (
    <div className="rounded-md border border-slate-200 bg-white p-2">
      <div className="flex items-center gap-2 text-[11px] text-slate-600">
        <span className="font-semibold text-slate-800">{m.fromRole === 'proctor' ? '監督者' : '自分'}</span>
        {m.fromRole === 'proctor' && m.type === 'broadcast' && (
          <span className="rounded bg-indigo-600/20 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">一斉送信</span>
        )}
        <span className="ml-auto">{m.ts ? new Date(m.ts).toLocaleTimeString() : ''}</span>
      </div>
      <div className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-900">{m.text}</div>
    </div>
  );
}
