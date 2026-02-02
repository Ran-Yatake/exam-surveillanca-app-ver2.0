import React from 'react';

export default function ChatPanel({
  title,
  headerRight,
  subHeader,
  notice,
  messages,
  renderMessage,
  endRef,
  draft,
  onDraftChange,
  onSend,
  disabled,
  placeholder,
  sendDisabled,
  footerNote,
  className,
}) {
  const list = Array.isArray(messages) ? messages : [];

  return (
    <div className={'rounded-xl border border-slate-200 bg-white p-6 ' + (className || '')}>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {headerRight}
      </div>

      {subHeader ? <div className="mt-2 text-xs text-slate-600">{subHeader}</div> : null}
      {notice ? <div className="mt-1 text-xs font-semibold text-rose-600">{notice}</div> : null}

      <div className="mt-3 max-h-[260px] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
        {list.length === 0 ? (
          <div className="text-xs text-slate-600">メッセージはまだありません。</div>
        ) : (
          <div className="space-y-2">
            {list.map((m) => (renderMessage ? renderMessage(m) : null))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={draft}
          onChange={(e) => onDraftChange?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSend?.();
            }
          }}
          disabled={disabled}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 disabled:opacity-50"
        />
        <button
          onClick={onSend}
          disabled={sendDisabled}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          送信
        </button>
      </div>

      {footerNote ? <p className="mt-2 text-[11px] text-slate-500">{footerNote}</p> : null}
    </div>
  );
}
