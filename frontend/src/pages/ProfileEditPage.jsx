import React, { useEffect, useState } from 'react';

import { fetchProfile } from '../api/client.js';

import ProfileRegistrationCard from '../components/profile/ProfileRegistrationCard.jsx';

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
      <ProfileRegistrationCard
        role={role}
        profile={profile}
        onRegistered={(saved) => setProfile(saved)}
        onBack={onDone}
      />
    </div>
  );
}
