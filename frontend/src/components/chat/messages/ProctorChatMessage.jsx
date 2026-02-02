import React from 'react';

export default function ProctorChatMessage({ message, resolveStudentNameByAttendeeId }) {
  const m = message || {};

  const fromLabel =
    m.fromRole === 'proctor' ? '監督者' : `受験生: ${resolveStudentNameByAttendeeId?.(m.fromAttendeeId) || String(m.fromAttendeeId || '')}`;

  const toLabel =
    m.type === 'broadcast'
      ? '全員'
      : m.toRole === 'proctor'
        ? '監督者'
        : `受験生: ${resolveStudentNameByAttendeeId?.(m.toAttendeeId) || String(m.toAttendeeId || '')}`;

  return (
    <div className="rounded-md border border-slate-200 bg-white p-2">
      <div className="flex items-center gap-2 text-[11px] text-slate-600">
        <span className="font-semibold text-slate-800">{fromLabel}</span>
        <span>→</span>
        <span className="font-semibold text-slate-800">{toLabel}</span>
        <span className="ml-auto">{m.ts ? new Date(m.ts).toLocaleTimeString() : ''}</span>
      </div>
      <div className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-900">{m.text}</div>
    </div>
  );
}
