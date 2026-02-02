import React from 'react';

export default function InviteUserModal({
  open,
  busy,
  email,
  role,
  error,
  onClose,
  onEmailChange,
  onRoleChange,
  onSubmit,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-start gap-2">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-slate-900">新規ユーザー登録</h3>
            <p className="mt-1 text-sm text-slate-600">メールアドレス宛に仮パスワード付きの招待メールを送信します。</p>
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
            <label className="block text-sm font-medium text-slate-800">メールアドレス</label>
            <input
              value={email}
              onChange={(e) => onEmailChange?.(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="example@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-800">区分</label>
            <select
              value={role}
              onChange={(e) => onRoleChange?.(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="examinee">examinee</option>
              <option value="proctor">proctor</option>
            </select>
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
              {busy ? '送信中...' : '送信'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
