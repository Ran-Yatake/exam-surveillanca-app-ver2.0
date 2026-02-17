import React, { useState, useEffect } from 'react';
import { signIn, signOut, completeNewPassword, getCurrentUserSession } from './auth';

import ProctorDashboardHome from './pages/ProctorDashboardHome.jsx';
import ExamineeDashboardHome from './pages/ExamineeDashboardHome.jsx';
import ProfileEditPage from './pages/ProfileEditPage.jsx';
import ProctorUsersPage from './pages/ProctorUsersPage.jsx';
import ProctorDashboard from './pages/ProctorDashboard.jsx';
import ExamineeView from './pages/ExamineeView.jsx';

import {
  clearAuthToken,
  fetchMe,
  fetchProfile,
  setAuthToken,
} from './api/client.js';

// ---- API / Profile helpers are in src/api/client.js ----

function sanitizeTokenPart(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 32);
}

function stableUserKeyFromUsername(username) {
  const s = String(username || '').trim().toLowerCase();
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function toBase64Url(utf8String) {
  const bytes = new TextEncoder().encode(String(utf8String || ''));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(base64Url) {
  const b64 = String(base64Url || '').replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (b64.length % 4)) % 4;
  const padded = b64 + '='.repeat(padLen);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function encodeExternalUserToken(value, maxUtf8Bytes = 24) {
  // Chime ExternalUserId has a strict allowed-character pattern and length constraints.
  // Japanese (and other multi-byte chars) can blow up token length if we truncate by chars.
  // We truncate by UTF-8 bytes, then base64url-encode.
  const s = sanitizeTokenPart(value);
  const bytes = new TextEncoder().encode(s);
  const sliced = bytes.slice(0, Math.max(0, maxUtf8Bytes));
  let binary = '';
  for (const b of sliced) binary += String.fromCharCode(b);
  const base64 = btoa(binary);
  const encoded = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return encoded || toBase64Url('User');
}

function makeExternalUserId(role, profile) {
  const displayName = encodeExternalUserToken(profile?.display_name, 24);
  const clazz = encodeExternalUserToken(profile?.class_name, 18);
  const rand = Math.floor(Math.random() * 1000000);

  if (role === 'proctor') {
    // NOTE: include a stable key segment for proctor identity across sessions.
    const userKey = stableUserKeyFromUsername(profile?.username || profile?.email || '') || toBase64Url(String(rand));
    return `proctor:${displayName}:${userKey}:${rand}`;
  }
  return `student:${displayName}:${clazz}:${rand}`;
}

function makeExternalUserIdWithFallback(role, profile, username) {
  const fallbackDisplayName = encodeExternalUserToken(username || 'User', 24);
  const fallbackClass = encodeExternalUserToken('class', 18);
  const displayName = encodeExternalUserToken(profile?.display_name, 24) || fallbackDisplayName;
  const clazz = encodeExternalUserToken(profile?.class_name, 18) || fallbackClass;
  const rand = Math.floor(Math.random() * 1000000);

  if (role === 'proctor') {
    const userKey = stableUserKeyFromUsername(username || profile?.username || profile?.email || 'User');
    return `proctor:${displayName}:${userKey}:${rand}`;
  }
  return `student:${displayName}:${clazz}:${rand}`;
}

function extractDisplayName(externalUserId) {
  const base = String(externalUserId || '').split('#')[0];
  const parts = base.split(':');
  if (parts.length >= 2 && (parts[0] === 'student' || parts[0] === 'proctor')) {
    const token = parts[1] || '';
    if (!token) return base;
    try {
      const decoded = fromBase64Url(token);
      return decoded || token;
    } catch (_) {
      return token;
    }
  }
  // Backward compatibility (older ids like student-123 / proctor-123)
  if (base.startsWith('student-')) return base;
  if (base.startsWith('proctor-')) return base;
  return base;
}

function App() {
  const AuthHeader = () => (
    <header className="w-full border-b border-slate-200 bg-white/80 backdrop-blur">
      <div className="mx-auto w-full max-w-6xl px-4 py-4">
        <h1 className="text-lg font-semibold text-slate-900">Exam Guard</h1>
      </div>
    </header>
  );

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [role, setRole] = useState(null);
  const [userRole, setUserRole] = useState(null); // 'proctor' | 'examinee'
  const [page, setPage] = useState('dashboard'); // 'dashboard' | 'meeting' | 'profile' | 'users'
  const [proctorJoinCode, setProctorJoinCode] = useState('');
  const [proctorAutoJoin, setProctorAutoJoin] = useState({
    enabled: false,
    joinWithCamera: true,
    joinWithMic: true,
    videoInputDeviceId: '',
    audioInputDeviceId: '',
    audioOutputDeviceId: '',
    prejoinStream: null,
  });

  const [examineeAutoJoin, setExamineeAutoJoin] = useState({
    enabled: false,
    meetingJoinId: '',
    joinWithCamera: true,
    joinWithMic: true,
    videoInputDeviceId: '',
    audioInputDeviceId: '',
    audioOutputDeviceId: '',
    prejoinStream: null,
  });

  const [guestExamineeDisplayName, setGuestExamineeDisplayName] = useState('');
  const [examineeJoinLink, setExamineeJoinLink] = useState(null); // { joinCode, displayName }
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [errorInstance, setError] = useState('');

  // Restore session on load
  useEffect(() => {
    getCurrentUserSession().then(session => {
        const token = session.getIdToken().getJwtToken();
        if (token) {
        setAuthToken(token);
            setIsLoggedIn(true);
            // Optionally decode token to get username if needed
            setUsername(session.getIdToken().payload['cognito:username'] || 'User');
        }
    }).catch(err => {
        // No session
        console.log("No active session found");
    });
  }, []);

  // Deep link: /?join=JOINCODE&name=DISPLAYNAME
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const joinCode = String(params.get('join') || '').trim();
      const dn = String(params.get('name') || '').trim();
      if (!joinCode) return;
      setExamineeJoinLink({ joinCode, displayName: dn });
    } catch (_) {
      // ignore
    }
  }, []);

  // Consume deep link: guest examinee -> open prejoin with meeting id prefilled.
  useEffect(() => {
    if (!examineeJoinLink?.joinCode) return;

    // If already logged in as proctor, do nothing.
    if (isLoggedIn && role === 'proctor') return;

    if (!isLoggedIn) {
      enterGuestExaminee();
      setGuestExamineeDisplayName(String(examineeJoinLink.displayName || '').trim());
      setPage('dashboard');
    } else {
      // Logged in user: only auto-open if they are (or will be) examinee.
      if (role === 'examinee') setPage('dashboard');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examineeJoinLink, isLoggedIn, role]);

  // Load role from backend (MySQL) after login and auto-route.
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    fetchMe()
      .then((profile) => {
        if (cancelled) return;
        const nextRole = profile?.role || null;
        setUserRole(nextRole);
        setRole(nextRole);
        setPage('dashboard');
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setError(err?.message || 'Failed to load profile');
      });
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  // Load display_name for header (preferred over username).
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    fetchProfile()
      .then((p) => {
        if (cancelled) return;
        const dn = String(p?.display_name || '').trim();
        setDisplayName(dn);
      })
      .catch(() => {
        if (!cancelled) setDisplayName('');
      });
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, page]);

  // New Password Challenge State
  const [isNewPasswordRequired, setIsNewPasswordRequired] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [challengeUser, setChallengeUser] = useState(null);
  const [challengeAttributes, setChallengeAttributes] = useState(null);

  const handleLogin = async (e) => {
      e.preventDefault();
      setError('');
      try {
          try {
             const result = await signIn(username, password);
             
             if (result.type === 'new_password_required') {
                 setIsNewPasswordRequired(true);
                 setChallengeUser(result.user);
                 setChallengeAttributes(result.userAttributes);
                 return;
             }

             // Success
             setAuthToken(result.token);
             setIsLoggedIn(true);
          } catch (cognitoErr) {
             throw cognitoErr;
          }
      } catch (err) {
          setError(err.message || "Login failed");
      }
  };
  
  const handleNewPasswordSubmit = async (e) => {
      e.preventDefault();
      setError('');
      try {
          const result = await completeNewPassword(challengeUser, newPassword, challengeAttributes);
          if (result.type === 'success') {
              setAuthToken(result.token);
              setIsNewPasswordRequired(false);
              setIsLoggedIn(true);
          }
      } catch (err) {
          setError(err.message || "Failed to set new password");
      }
  };

  const enterGuestExaminee = () => {
    clearAuthToken();
    try {
      signOut();
    } catch (_) {
      // ignore
    }
    setIsLoggedIn(false);
    setRole('examinee');
    setUserRole('examinee');
    setPage('dashboard');
    const guestName = `guest-${Math.random().toString(16).slice(2, 8)}`;
    setUsername(guestName);
    setDisplayName('');
    setGuestExamineeDisplayName('');
    setError('');
  };

  const goToLogin = () => {
    setRole(null);
    setUserRole(null);
    setPage('dashboard');
    setError('');
  };

  if (isNewPasswordRequired) {
      return (
          <div className="min-h-screen bg-slate-50 text-slate-900">
            <AuthHeader />
            <main className="min-h-[calc(100vh-65px)] flex items-center justify-center px-4">
              <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6">
                <h1 className="text-xl font-semibold">パスワード変更</h1>
                <p className="mt-1 text-sm text-slate-600">続行するには新しいパスワードを設定してください。</p>

                <form onSubmit={handleNewPasswordSubmit} className="mt-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-800">New Password</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={e=>setNewPassword(e.target.value)}
                      required
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  {errorInstance && <p className="text-sm text-red-400">{errorInstance}</p>}

                  <button
                    type="submit"
                    className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                  >
                    Update Password
                  </button>
                </form>
              </div>
            </main>
          </div>
      );
  }

  if (!isLoggedIn && !role) {
      return (
          <div className="min-h-screen bg-slate-50 text-slate-900">
            <AuthHeader />
            <main className="min-h-[calc(100vh-65px)] flex items-center justify-center px-4">
              <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6">
                <h1 className="text-xl font-semibold">ログイン</h1>
                <form onSubmit={handleLogin} className="mt-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-800">Username</label>
                    <input
                      type="text"
                      value={username}
                      onChange={e=>setUsername(e.target.value)}
                      required
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-800">Password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={e=>setPassword(e.target.value)}
                      required
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  {errorInstance && <p className="text-sm text-red-400">{errorInstance}</p>}

                  <button
                    type="submit"
                    className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                  >
                    Sign In
                  </button>
                </form>

                <div className="mt-6">
                  <button
                    type="button"
                    onClick={enterGuestExaminee}
                    className="w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
                  >
                    ゲストとして受験生で続行
                  </button>
                </div>
              </div>
            </main>
          </div>
      );
  }

  if (isLoggedIn && !role) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <div className="mx-auto w-full max-w-4xl px-4 py-8">
          <header className="flex items-center justify-between">
            <h1 className="text-xl font-semibold">Exam Guard</h1>
            <button
              onClick={() => { setIsLoggedIn(false); setRole(null); signOut(); clearAuthToken(); }}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              Sign Out
            </button>
          </header>

          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
            <div className="text-sm text-slate-600">Logged in as</div>
            <div className="mt-1 text-lg font-semibold">{username}</div>

            <div className="mt-6 text-sm font-medium text-slate-800">ロール情報を取得中...</div>
            {userRole && (
              <p className="mt-3 text-xs text-slate-600">
                Your role: <span className="font-semibold text-slate-800">{userRole}</span>
              </p>
            )}
            {errorInstance && <p className="mt-3 text-sm text-red-400">{errorInstance}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        <header className="mb-6 flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-lg font-semibold">Exam Guard</h1>
            <div className="text-xs text-slate-600">
              {role === 'proctor' ? '監督者ダッシュボード' : '受験生ダッシュボード'}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="text-right leading-tight">
              {displayName && <div className="text-xs font-semibold text-slate-900">{displayName}</div>}
              <div className="text-sm text-slate-700">{username}</div>
            </div>

            {role === 'proctor' && (
              <>
                <button
                  onClick={() => setPage('users')}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                >
                  ユーザー一覧
                </button>
                <button
                  onClick={() => setPage('profile')}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                >
                  プロフィール編集
                </button>
              </>
            )}

            {role === 'examinee' && !isLoggedIn && (
              <button
                onClick={goToLogin}
                className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
              >
                ログイン
              </button>
            )}

            {isLoggedIn && (
              <button
                onClick={() => {
                  setIsLoggedIn(false);
                  setRole(null);
                  signOut();
                  clearAuthToken();
                }}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Sign Out
              </button>
            )}
          </div>
        </header>

      {page === 'dashboard' && role === 'proctor' && (
        <ProctorDashboardHome
          onGoMeeting={(opts) => {
            const joinCode = String(opts?.joinCode || '').trim();
            if (joinCode) setProctorJoinCode(joinCode);

            if (opts?.autoJoin) {
              setProctorAutoJoin({
                enabled: true,
                joinWithCamera: Boolean(opts?.joinWithCamera),
                joinWithMic: Boolean(opts?.joinWithMic),
                videoInputDeviceId: String(opts?.videoInputDeviceId || ''),
                audioInputDeviceId: String(opts?.audioInputDeviceId || ''),
                audioOutputDeviceId: String(opts?.audioOutputDeviceId || ''),
                prejoinStream: opts?.prejoinStream || null,
              });
            } else {
              setProctorAutoJoin({
                enabled: false,
                joinWithCamera: true,
                joinWithMic: true,
                videoInputDeviceId: '',
                audioInputDeviceId: '',
                audioOutputDeviceId: '',
                prejoinStream: null,
              });
            }

            setPage('meeting');
          }}
          onGoProfile={() => setPage('profile')}
          onGoUsers={() => setPage('users')}
          selectedJoinCode={proctorJoinCode}
          onSelectJoinCode={(code) => setProctorJoinCode(code)}
          currentUsername={username}
        />
      )}

      {page === 'dashboard' && role === 'examinee' && (
        <ExamineeDashboardHome
          onGoMeeting={(opts) => {
            const joinCode = String(opts?.joinCode || '').trim();
            const guestDn = String(opts?.displayName || '').trim();

            if (!isLoggedIn) {
              setGuestExamineeDisplayName(guestDn);
            }

            if (opts?.autoJoin) {
              setExamineeAutoJoin({
                enabled: true,
                meetingJoinId: joinCode,
                joinWithCamera: Boolean(opts?.joinWithCamera),
                joinWithMic: Boolean(opts?.joinWithMic),
                videoInputDeviceId: String(opts?.videoInputDeviceId || ''),
                audioInputDeviceId: String(opts?.audioInputDeviceId || ''),
                audioOutputDeviceId: String(opts?.audioOutputDeviceId || ''),
                prejoinStream: opts?.prejoinStream || null,
              });
            } else {
              setExamineeAutoJoin({
                enabled: false,
                meetingJoinId: '',
                joinWithCamera: true,
                joinWithMic: true,
                videoInputDeviceId: '',
                audioInputDeviceId: '',
                audioOutputDeviceId: '',
                prejoinStream: null,
              });
            }

            setPage('meeting');
          }}
          onGoProfile={() => setPage('profile')}
          showProfileButton={isLoggedIn}
          autoOpenPrejoin={Boolean(examineeJoinLink?.joinCode)}
          initialMeetingId={String(examineeJoinLink?.joinCode || '')}
          initialDisplayName={String(examineeJoinLink?.displayName || '')}
          onAutoOpenPrejoinConsumed={() => {
            setExamineeJoinLink(null);
            try {
              window.history.replaceState(null, '', window.location.pathname);
            } catch (_) {
              // ignore
            }
          }}
        />
      )}

      {page === 'profile' && (
        <ProfileEditPage
          role={role}
          onDone={() => setPage('dashboard')}
        />
      )}

      {page === 'users' && role === 'proctor' && (
        <ProctorUsersPage onDone={() => setPage('dashboard')} />
      )}

      {page === 'meeting' && role === 'proctor' && (
        <ProctorDashboard
          currentUsername={username}
          meetingId={proctorJoinCode}
          onSetMeetingId={(code) => setProctorJoinCode(code)}
          onBack={() => {
            setProctorAutoJoin({
              enabled: false,
              joinWithCamera: true,
              joinWithMic: true,
              videoInputDeviceId: '',
              audioInputDeviceId: '',
              audioOutputDeviceId: '',
              prejoinStream: null,
            });
            setPage('dashboard');
          }}
          autoJoin={Boolean(proctorAutoJoin?.enabled)}
          initialJoinWithCamera={Boolean(proctorAutoJoin?.joinWithCamera)}
          initialJoinWithMic={Boolean(proctorAutoJoin?.joinWithMic)}
          initialVideoInputDeviceId={String(proctorAutoJoin?.videoInputDeviceId || '')}
          initialAudioInputDeviceId={String(proctorAutoJoin?.audioInputDeviceId || '')}
          initialAudioOutputDeviceId={String(proctorAutoJoin?.audioOutputDeviceId || '')}
          initialPrejoinStream={proctorAutoJoin?.prejoinStream || null}
          onAutoJoinConsumed={() =>
            setProctorAutoJoin((prev) => ({ ...(prev || {}), enabled: false, prejoinStream: null }))
          }
          makeExternalUserIdWithFallback={makeExternalUserIdWithFallback}
          extractDisplayName={extractDisplayName}
        />
      )}

      {page === 'meeting' && role === 'examinee' && (
        <ExamineeView
          currentUsername={username}
          isGuest={!isLoggedIn}
          guestDisplayName={guestExamineeDisplayName}
          onBack={() => {
            setExamineeAutoJoin({
              enabled: false,
              meetingJoinId: '',
              joinWithCamera: true,
              joinWithMic: true,
              videoInputDeviceId: '',
              audioInputDeviceId: '',
              audioOutputDeviceId: '',
              prejoinStream: null,
            });
            setGuestExamineeDisplayName('');
            setPage('dashboard');
          }}
          autoJoin={Boolean(examineeAutoJoin?.enabled)}
          initialMeetingJoinId={String(examineeAutoJoin?.meetingJoinId || '')}
          initialJoinWithCamera={Boolean(examineeAutoJoin?.joinWithCamera)}
          initialJoinWithMic={Boolean(examineeAutoJoin?.joinWithMic)}
          initialVideoInputDeviceId={String(examineeAutoJoin?.videoInputDeviceId || '')}
          initialAudioInputDeviceId={String(examineeAutoJoin?.audioInputDeviceId || '')}
          initialAudioOutputDeviceId={String(examineeAutoJoin?.audioOutputDeviceId || '')}
          initialPrejoinStream={examineeAutoJoin?.prejoinStream || null}
          onAutoJoinConsumed={() =>
            setExamineeAutoJoin((prev) => ({ ...(prev || {}), enabled: false, prejoinStream: null }))
          }
          makeExternalUserIdWithFallback={makeExternalUserIdWithFallback}
          extractDisplayName={extractDisplayName}
        />
      )}
      </div>
    </div>
  );
}
export default App;
