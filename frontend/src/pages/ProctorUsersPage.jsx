import React, { useEffect, useState } from 'react';

import { deleteUser, inviteUser, listUsers, updateUser } from '../api/client.js';
import EditUserModal from '../components/proctor-users/EditUserModal.jsx';
import InviteUserModal from '../components/proctor-users/InviteUserModal.jsx';
import UsersList from '../components/proctor-users/UsersList.jsx';

export default function ProctorUsersPage({ onDone }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [editRole, setEditRole] = useState('examinee');
  const [editClassName, setEditClassName] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');

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

  const openEdit = (u) => {
    setEditError('');
    setEditUser(u || null);
    setEditRole(String(u?.role || 'examinee'));
    setEditClassName(String(u?.class_name || ''));
    setEditOpen(true);
  };

  const closeEdit = () => {
    if (editBusy) return;
    setEditOpen(false);
    setEditError('');
  };

  const submitEdit = async () => {
    const email = String(editUser?.username || '').trim();
    if (!email) return;

    setEditBusy(true);
    setEditError('');
    try {
      const role = String(editRole || '').trim();
      const className = String(editClassName || '').trim();
      if (role !== 'proctor' && role !== 'examinee') {
        setEditError('区分が正しくありません');
        return;
      }
      if (role === 'examinee' && !className) {
        setEditError('クラスを入力してください');
        return;
      }

      await updateUser(email, {
        role,
        class_name: role === 'proctor' ? null : className,
      });

      setEditOpen(false);
      await refresh();
    } catch (err) {
      setEditError(err?.message || '更新に失敗しました');
    } finally {
      setEditBusy(false);
    }
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

        <UsersList users={users} onEdit={openEdit} onDelete={onDelete} />
      </div>

      <InviteUserModal
        open={inviteOpen}
        busy={inviteBusy}
        email={inviteEmail}
        role={inviteRole}
        error={inviteError}
        onClose={closeInvite}
        onEmailChange={(v) => setInviteEmail(v)}
        onRoleChange={(v) => setInviteRole(v)}
        onSubmit={submitInvite}
      />

      <EditUserModal
        open={editOpen}
        busy={editBusy}
        user={editUser}
        role={editRole}
        className={editClassName}
        error={editError}
        onClose={closeEdit}
        onRoleChange={(v) => setEditRole(v)}
        onClassNameChange={(v) => setEditClassName(v)}
        onSubmit={submitEdit}
      />
    </div>
  );
}
