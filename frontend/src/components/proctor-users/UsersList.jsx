import React from 'react';

export default function UsersList({ users, onEdit, onDelete }) {
  if (!Array.isArray(users) || users.length === 0) {
    return <p className="mt-4 text-sm text-slate-600">ユーザーがありません。</p>;
  }

  return (
    <div className="mt-4">
      <div className="text-xs font-medium text-slate-600">登録ユーザー</div>

      <div className="mt-2 space-y-2">
        <div className="hidden sm:grid sm:grid-cols-[220px_220px_140px_1fr_160px] sm:items-center sm:gap-2 px-3 text-center text-xs font-semibold text-slate-600">
          <div>ユーザーID</div>
          <div>ユーザー名</div>
          <div>区分</div>
          <div>クラス</div>
          <div />
        </div>

        {users.map((u) => {
          const username = u.username || '—';
          const displayName = u.display_name || '—';
          const role = u.role || '—';
          const className = u.class_name || '—';
          return (
            <div
              key={u.id || username}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
            >
              <div className="w-full sm:hidden">
                <div className="text-sm font-semibold text-slate-900">{username}</div>
                <div className="mt-1 text-xs text-slate-600">
                  ユーザー名: <span className="text-slate-800">{displayName}</span>
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  区分: <span className="text-slate-800">{role}</span>
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  クラス: <span className="text-slate-800">{className}</span>
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => onEdit?.(u)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100 whitespace-nowrap"
                  >
                    編集
                  </button>
                  <button
                    onClick={() => onDelete?.(username)}
                    className="ml-2 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 whitespace-nowrap"
                  >
                    削除
                  </button>
                </div>
              </div>

              <div className="hidden w-full sm:grid sm:grid-cols-[220px_220px_140px_1fr_160px] sm:items-center sm:gap-2 text-center">
                <div className="text-sm text-slate-800 truncate">{username}</div>
                <div className="text-sm text-slate-800 truncate">{displayName}</div>
                <div className="text-sm text-slate-800">{role}</div>
                <div className="text-sm text-slate-800 truncate">{className}</div>
                <div className="flex justify-end">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onEdit?.(u)}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100 whitespace-nowrap"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => onDelete?.(username)}
                      className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 whitespace-nowrap"
                    >
                      削除
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
