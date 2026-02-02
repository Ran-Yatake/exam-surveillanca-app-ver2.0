import React from 'react';

export default function EditUserModal({
  open,
  busy,
  user,
  role,
  className,
  error,
  onClose,
  onRoleChange,
  onClassNameChange,
  onSubmit,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-start gap-2">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-slate-900">ユーザー編集</h3>
            <p className="mt-1 text-sm text-slate-600">区分（role）とクラス（kurasu）を変更できます。</p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
            disabled={busy}
          >
            閉じる
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-800">ユーザーID（メール）</label>
            <input
              value={String(user?.username || '')}
              readOnly
              className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-800">区分（role）</label>
            <select
              value={role}
              onChange={(e) => onRoleChange?.(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="examinee">examinee</option>
              <option value="proctor">proctor</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-800">クラス（kurasu）</label>
            <input
              value={className}
              onChange={(e) => onClassNameChange?.(e.target.value)}
              disabled={String(role) === 'proctor'}
              placeholder={String(role) === 'proctor' ? '監督者はクラス不要' : '例: 1-A'}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50 disabled:cursor-not-allowed"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              キャンセル
            </button>
            <button
              onClick={onSubmit}
              disabled={busy}
              className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? '更新中...' : '更新'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
