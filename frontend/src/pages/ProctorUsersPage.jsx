import React, { useEffect, useState } from 'react';

import { deleteUser, inviteUser, listUsers } from '../api/client.js';

export default function ProctorUsersPage({ onDone }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('examinee');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const list = await listUsers();
      setUsers(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err?.message || 'ユーザー一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openInvite = () => {
    setInviteEmail('');
    setInviteRole('examinee');
    setInviteError('');
    setInviteOpen(true);
  };

  const closeInvite = () => {
    if (inviteBusy) return;
    setInviteOpen(false);
    setInviteError('');
  };

  const submitInvite = async () => {
    setInviteBusy(true);
    setInviteError('');
    try {
      const email = String(inviteEmail || '').trim();
      if (!email) {
        setInviteError('メールアドレスを入力してください');
        return;
      }
      await inviteUser({ email, role: inviteRole });
      setInviteOpen(false);
      await refresh();
    } catch (err) {
      setInviteError(err?.message || '新規登録に失敗しました');
    } finally {
      setInviteBusy(false);
    }
  };

  const onDelete = async (email) => {
    const target = String(email || '').trim();
    if (!target) return;

    const ok = window.confirm(`このユーザーを削除しますか？\n${target}`);
    if (!ok) return;

    setError('');
    try {
      await deleteUser(target);
      await refresh();
    } catch (err) {
      setError(err?.message || 'ユーザー削除に失敗しました');
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold">ユーザー一覧</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={onDone}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
          >
            ← ダッシュボードに戻る
          </button>
          <button
            onClick={openInvite}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            新規登録
          </button>
          <button
            onClick={refresh}
            disabled={loading}
            className="ml-auto rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '更新中...' : '更新'}
          </button>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {users.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">ユーザーがありません。</p>
        ) : (
          <div className="mt-4">
            <div className="text-xs font-medium text-slate-600">登録ユーザー</div>

            <div className="mt-2 space-y-2">
              <div className="hidden sm:grid sm:grid-cols-[220px_220px_140px_1fr_96px] sm:items-center sm:gap-2 px-3 text-center text-xs font-semibold text-slate-600">
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
                          onClick={() => onDelete(username)}
                          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100"
                        >
                          削除
                        </button>
                      </div>
                    </div>

                    <div className="hidden w-full sm:grid sm:grid-cols-[220px_220px_140px_1fr_96px] sm:items-center sm:gap-2 text-center">
                      <div className="text-sm text-slate-800 truncate">{username}</div>
                      <div className="text-sm text-slate-800 truncate">{displayName}</div>
                      <div className="text-sm text-slate-800">{role}</div>
                      <div className="text-sm text-slate-800 truncate">{className}</div>
                      <div className="flex justify-end">
                        <button
                          onClick={() => onDelete(username)}
                          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100"
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-start gap-2">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-slate-900">新規ユーザー登録</h3>
                <p className="mt-1 text-sm text-slate-600">
                  メールアドレス宛に仮パスワード付きの招待メールを送信します。
                </p>
              </div>
              <button
                onClick={closeInvite}
                className="ml-auto rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
                disabled={inviteBusy}
              >
                閉じる
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-800">メールアドレス</label>
                <input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="example@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-800">区分</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="examinee">examinee</option>
                  <option value="proctor">proctor</option>
                </select>
              </div>

              {inviteError && <p className="text-sm text-red-600">{inviteError}</p>}

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={closeInvite}
                  disabled={inviteBusy}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  キャンセル
                </button>
                <button
                  onClick={submitInvite}
                  disabled={inviteBusy}
                  className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {inviteBusy ? '送信中...' : '送信'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
