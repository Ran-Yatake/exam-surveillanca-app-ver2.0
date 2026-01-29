import React, { useEffect, useState } from 'react';

import { fetchProfile, upsertProfile } from '../api/client.js';

function ProfileRegistrationPage({ role, profile, onRegistered, onBack }) {
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [className, setClassName] = useState(profile?.class_name || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    setDisplayName(profile?.display_name || '');
    setClassName(profile?.class_name || '');
  }, [role, profile?.display_name, profile?.class_name]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    const dn = String(displayName || '').trim();
    const cn = String(className || '').trim();
    if (!dn) {
      setError('ユーザー名を入力してください');
      return;
    }
    if (role === 'examinee' && !cn) {
      setError('クラスを入力してください');
      return;
    }

    try {
      setSaving(true);
      const saved = await upsertProfile({
        display_name: dn,
        class_name: role === 'examinee' ? cn : null,
      });
      setSuccess('登録完了しました');
      onRegistered(saved);
    } catch (err) {
      setError(err.message || '登録に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold">
        {role === 'proctor' ? '監督者プロフィール登録' : '生徒プロフィール登録'}
      </h2>
      <p className="mt-1 text-sm text-slate-600">ここで登録したユーザー名が通話タイルに表示されます。</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
        >
          ← ダッシュボードに戻る
        </button>
      </div>

      <form onSubmit={submit} className="mt-6 space-y-4 max-w-xl">
        <div>
          <label className="block text-sm font-medium text-slate-800">ユーザー名</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {role === 'examinee' && (
          <div>
            <label className="block text-sm font-medium text-slate-800">クラス</label>
            <input
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}
        {success && <p className="text-sm text-emerald-400">{success}</p>}

        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? '保存中...' : '登録'}
        </button>
      </form>
    </div>
  );
}

export default function ProfileEditPage({ role, onDone }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchProfile()
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setError(err.message || 'プロフィールの読み込みに失敗しました');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [role]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <p className="text-sm text-slate-600">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-400">{error}</p>}
      <ProfileRegistrationPage
        role={role}
        profile={profile}
        onRegistered={(saved) => setProfile(saved)}
        onBack={onDone}
      />
    </div>
  );
}
