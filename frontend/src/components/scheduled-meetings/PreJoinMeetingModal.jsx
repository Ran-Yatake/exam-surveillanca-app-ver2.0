import React, { useEffect, useRef, useState } from 'react';

function stopStream(stream) {
  if (!stream) return;
  try {
    for (const track of stream.getTracks()) track.stop();
  } catch (_) {
    // ignore
  }
}

export default function PreJoinMeetingModal({
  open,
  meeting,
  busy,
  error,
  onClose,
  onStart,
}) {
  const [joinWithCamera, setJoinWithCamera] = useState(true);
  const [joinWithMic, setJoinWithMic] = useState(true);

  const [notificationPermission, setNotificationPermission] = useState('');
  const [notificationHint, setNotificationHint] = useState('');

  const getBrowserForNotificationHelp = () => {
    try {
      const ua = String(navigator?.userAgent || '');
      if (/Edg\//.test(ua)) return 'edge';
      if ((/Chrome\//.test(ua) || /CriOS\//.test(ua)) && !/Edg\//.test(ua)) return 'chrome';
      return 'other';
    } catch (_) {
      return 'other';
    }
  };

  const [videoDevices, setVideoDevices] = useState([]);
  const [audioDevices, setAudioDevices] = useState([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState([]);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState('');
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState('');
  const [selectedAudioOutputDeviceId, setSelectedAudioOutputDeviceId] = useState('');

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraError, setCameraError] = useState('');

  const title = meeting?.title || '（無題）';
  const teacher = meeting?.teacher_name || '—';
  const joinCode = String(meeting?.join_code || '').trim();

  const detachVideo = () => {
    try {
      if (videoRef.current) videoRef.current.srcObject = null;
    } catch (_) {
      // ignore
    }
  };

  const stopPreview = () => {
    stopStream(streamRef.current);
    streamRef.current = null;
    detachVideo();
  };

  const startPreview = async () => {
    if (!open) return;
    if (!joinWithCamera) {
      stopPreview();
      return;
    }
    if (streamRef.current) {
      // already running
      return;
    }

    setCameraError('');
    try {
      const videoConstraint = selectedVideoDeviceId
        ? { deviceId: { exact: selectedVideoDeviceId } }
        : true;
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch (_) {
          // ignore
        }
      }
    } catch (err) {
      console.warn('[PreJoinMeetingModal] Failed to start camera preview', err);
      setCameraError('カメラの開始に失敗しました。ブラウザの権限をご確認ください。');
      stopPreview();
    }
  };

  useEffect(() => {
    if (!open) return () => {};

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (busy) return;
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, busy, onClose]);

  useEffect(() => {
    if (!open) return;

    const refreshPermission = () => {
      try {
        // eslint-disable-next-line no-undef
        if (typeof Notification === 'undefined') {
          setNotificationPermission('unsupported');
          return;
        }
        // eslint-disable-next-line no-undef
        setNotificationPermission(String(Notification.permission || 'default'));
      } catch (_) {
        setNotificationPermission('unsupported');
      }
    };

    refreshPermission();
    setNotificationHint('');

    let timer = null;
    try {
      timer = setInterval(refreshPermission, 1000);
    } catch (_) {
      // ignore
    }

    try {
      window.addEventListener('focus', refreshPermission);
    } catch (_) {
      // ignore
    }

    return () => {
      try {
        if (timer) clearInterval(timer);
      } catch (_) {
        // ignore
      }
      try {
        window.removeEventListener('focus', refreshPermission);
      } catch (_) {
        // ignore
      }
    };
  }, [open]);

  const requestNotificationPermission = async () => {
    try {
      // eslint-disable-next-line no-undef
      if (typeof Notification === 'undefined') {
        alert('このブラウザは通知に対応していません。');
        setNotificationPermission('unsupported');
        return;
      }
      // eslint-disable-next-line no-undef
      const current = String(Notification.permission || 'default');
      if (current === 'granted') {
        setNotificationPermission('granted');
        setNotificationHint('');
        return;
      }

      if (current === 'denied') {
        setNotificationPermission('denied');
        const b = getBrowserForNotificationHelp();
        const help =
          b === 'edge'
            ? '通知がブロックされています。Edge のアドレスバー左の鍵アイコン →「このサイトのアクセス許可」→「通知」を「許可」に変更してください。'
            : b === 'chrome'
              ? '通知がブロックされています。Chrome のアドレスバー左の鍵アイコン →「サイトの設定」→「通知」を「許可」に変更してください。'
              : '通知がブロックされています。ブラウザのサイト設定で、このサイトの「通知」を「許可」に変更してください。';
        setNotificationHint(help);
        return;
      }

      let perm = 'default';
      try {
        // eslint-disable-next-line no-undef
        const result = Notification.requestPermission();
        perm = typeof result === 'string' ? result : await result;
      } catch (_) {
        // Safari fallback
        perm = await new Promise((resolve) => {
          try {
            // eslint-disable-next-line no-undef
            Notification.requestPermission((p) => resolve(p));
          } catch (_) {
            resolve('default');
          }
        });
      }
      setNotificationPermission(String(perm || 'default'));
      setNotificationHint('');
    } catch (err) {
      console.warn('[PreJoinMeetingModal] Failed to request notification permission', err);
      alert('通知の有効化に失敗しました。ブラウザの設定をご確認ください。');
    }
  };

  useEffect(() => {
    if (!open) return () => {};
    let cancelled = false;

    const refreshDevices = async () => {
      try {
        if (!navigator?.mediaDevices?.enumerateDevices) return;
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const videos = devices.filter((d) => d.kind === 'videoinput');
        const audios = devices.filter((d) => d.kind === 'audioinput');
        const audioOuts = devices.filter((d) => d.kind === 'audiooutput');
        setVideoDevices(videos);
        setAudioDevices(audios);
        setAudioOutputDevices(audioOuts);
        if (!selectedVideoDeviceId && videos.length > 0) setSelectedVideoDeviceId(videos[0].deviceId);
        if (!selectedAudioDeviceId && audios.length > 0) setSelectedAudioDeviceId(audios[0].deviceId);
        if (!selectedAudioOutputDeviceId && audioOuts.length > 0) setSelectedAudioOutputDeviceId(audioOuts[0].deviceId);
      } catch (_) {
        // ignore
      }
    };

    refreshDevices();
    try {
      navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
    } catch (_) {
      // ignore
    }

    return () => {
      cancelled = true;
      try {
        navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
      } catch (_) {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return () => {};
    startPreview();
    return () => {
      // stop if modal is closed without starting
      stopPreview();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    startPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinWithCamera, open]);

  useEffect(() => {
    if (!open) return;
    if (!joinWithCamera) return;
    stopPreview();
    startPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVideoDeviceId]);

  if (!open) return null;

  const notificationsOk = notificationPermission === 'granted' || notificationPermission === 'unsupported';
  const canStartWithNotifications = Boolean(joinCode) && notificationsOk;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="閉じる"
        className="absolute inset-0 bg-black/40"
        onClick={() => {
          if (busy) return;
          onClose?.();
        }}
        disabled={busy}
      />

      <div className="relative w-full max-w-3xl rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold text-slate-900">開始前の確認</div>
            <div className="mt-1 text-xs text-slate-600">カメラ/マイクを確認して「開始」を押してください</div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (busy) return;
              onClose?.();
            }}
            disabled={busy}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            閉じる
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[1fr_280px]">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-semibold text-slate-700">セルフビュー</div>
            <div className="mt-2 relative overflow-hidden rounded-lg border border-indigo-500/40 bg-slate-950">
              <div className="aspect-[4/3]">
                <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
                {!joinWithCamera && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 text-sm font-semibold text-white">
                    Camera Off
                  </div>
                )}
              </div>
              <div className="absolute bottom-0 left-0 right-0 bg-slate-950/70 px-2 py-1 text-center text-xs font-medium text-slate-100">
                Proctor Self View
              </div>
            </div>

            {cameraError && <div className="mt-2 text-sm font-semibold text-rose-600">{cameraError}</div>}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold text-slate-700">対象ミーティング</div>
            <div className="mt-2 space-y-1 text-sm">
              <div className="text-slate-900 font-semibold">{title}</div>
              <div className="text-slate-600">担当: <span className="text-slate-800">{teacher}</span></div>
              <div className="text-slate-600">ID: <span className="text-slate-900 font-semibold">{joinCode || '—'}</span></div>
            </div>

            <div className="mt-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setJoinWithMic((v) => !v)}
                  className="flex-1 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
                >
                  {joinWithMic ? 'マイク:ON' : 'マイク:OFF'}
                </button>
                <button
                  type="button"
                  onClick={() => setJoinWithCamera((v) => !v)}
                  className="flex-1 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
                >
                  {joinWithCamera ? 'カメラ:ON' : 'カメラ:OFF'}
                </button>
              </div>

              <div className="mt-3 space-y-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600">カメラ</label>
                  <select
                    value={selectedVideoDeviceId}
                    onChange={(e) => setSelectedVideoDeviceId(String(e.target.value || ''))}
                    disabled={!joinWithCamera || videoDevices.length === 0}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-50"
                  >
                    {videoDevices.length === 0 ? (
                      <option value="">利用可能なカメラがありません</option>
                    ) : (
                      videoDevices.map((d, idx) => (
                        <option key={d.deviceId || String(idx)} value={d.deviceId}>
                          {d.label || `カメラ ${idx + 1}`}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600">マイク</label>
                  <select
                    value={selectedAudioDeviceId}
                    onChange={(e) => setSelectedAudioDeviceId(String(e.target.value || ''))}
                    disabled={!joinWithMic || audioDevices.length === 0}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-50"
                  >
                    {audioDevices.length === 0 ? (
                      <option value="">利用可能なマイクがありません</option>
                    ) : (
                      audioDevices.map((d, idx) => (
                        <option key={d.deviceId || String(idx)} value={d.deviceId}>
                          {d.label || `マイク ${idx + 1}`}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600">スピーカー</label>
                  <select
                    value={selectedAudioOutputDeviceId}
                    onChange={(e) => setSelectedAudioOutputDeviceId(String(e.target.value || ''))}
                    disabled={audioOutputDevices.length === 0}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-50"
                  >
                    {audioOutputDevices.length === 0 ? (
                      <option value="">利用可能なスピーカーがありません</option>
                    ) : (
                      audioOutputDevices.map((d, idx) => (
                        <option key={d.deviceId || String(idx)} value={d.deviceId}>
                          {d.label || `スピーカー ${idx + 1}`}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              <div className="mt-3">
                <button
                  type="button"
                  onClick={requestNotificationPermission}
                  disabled={notificationPermission === 'granted' || notificationPermission === 'unsupported'}
                  className="w-full rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {notificationPermission === 'granted' ? '通知: 有効' : 'OS通知を有効化'}
                </button>
                <div className="mt-1 text-xs text-slate-600">
                  {notificationPermission === 'unsupported'
                    ? 'このブラウザは通知に対応していません'
                    : notificationPermission === 'denied'
                      ? '通知がブロックされています（ブラウザ設定で許可してください）'
                      : '別タブでも新着メッセージに気づけます'}
                </div>
                {notificationHint && (
                  <div className="mt-1 text-xs font-semibold text-rose-600">{notificationHint}</div>
                )}
                {!notificationsOk && (
                  <div className="mt-1 text-xs font-semibold text-rose-600">開始前に通知の有効化が必要です</div>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  if (busy) return;
                  if (!canStartWithNotifications) return;
                  // NOTE: do NOT stop stream here; hand it off to meeting page.
                  detachVideo();
                  onStart?.({
                    joinWithCamera,
                    joinWithMic,
                    videoInputDeviceId: String(selectedVideoDeviceId || ''),
                    audioInputDeviceId: String(selectedAudioDeviceId || ''),
                    audioOutputDeviceId: String(selectedAudioOutputDeviceId || ''),
                    prejoinStream: streamRef.current || null,
                  });
                }}
                disabled={busy || !canStartWithNotifications}
                className="mt-3 w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? '開始中...' : '開始'}
              </button>
            </div>

            {(error || cameraError) && (
              <div className="mt-3 text-sm text-rose-600 font-semibold">{error || cameraError}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
