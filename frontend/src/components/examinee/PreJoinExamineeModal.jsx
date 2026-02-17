import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

function stopStream(stream) {
  if (!stream) return;
  try {
    for (const track of stream.getTracks()) track.stop();
  } catch (_) {
    // ignore
  }
}

export default function PreJoinExamineeModal({
  open,
  busy,
  error,
  onClose,
  onStart,
  requireDisplayName,
  initialDisplayName,
  initialMeetingId,
}) {
  const [meetingId, setMeetingId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [joinWithCamera, setJoinWithCamera] = useState(true);
  const [joinWithMic, setJoinWithMic] = useState(true);

  const [notificationPermission, setNotificationPermission] = useState('');
  const [notificationHint, setNotificationHint] = useState('');

  const [videoDevices, setVideoDevices] = useState([]);
  const [audioDevices, setAudioDevices] = useState([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState([]);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState('');
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState('');
  const [selectedAudioOutputDeviceId, setSelectedAudioOutputDeviceId] = useState('');

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const autoNotificationRequestedRef = useRef(false);
  const [cameraError, setCameraError] = useState('');

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
    if (!joinWithCamera && !joinWithMic) {
      stopPreview();
      return;
    }
    if (streamRef.current) return;

    setCameraError('');
    try {
      const videoConstraint = joinWithCamera
        ? selectedVideoDeviceId
          ? { deviceId: { exact: selectedVideoDeviceId } }
          : true
        : false;
      const audioConstraint = joinWithMic
        ? selectedAudioDeviceId
          ? { deviceId: { exact: selectedAudioDeviceId } }
          : true
        : false;

      // Request permissions during pre-join so device labels become available.
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: audioConstraint });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch (_) {
          // ignore
        }
      }

      // Refresh device list AFTER permission is granted so labels appear.
      try {
        if (navigator?.mediaDevices?.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videos = devices.filter((d) => d.kind === 'videoinput');
          const audios = devices.filter((d) => d.kind === 'audioinput');
          const audioOuts = devices.filter((d) => d.kind === 'audiooutput');
          setVideoDevices(videos);
          setAudioDevices(audios);
          setAudioOutputDevices(audioOuts);

          if (!selectedVideoDeviceId && videos.length > 0) setSelectedVideoDeviceId(videos[0].deviceId);
          if (!selectedAudioDeviceId && audios.length > 0) setSelectedAudioDeviceId(audios[0].deviceId);
          if (!selectedAudioOutputDeviceId && audioOuts.length > 0) setSelectedAudioOutputDeviceId(audioOuts[0].deviceId);
        }
      } catch (_) {
        // ignore
      }
    } catch (err) {
      console.warn('[PreJoinExamineeModal] Failed to start media preview', err);
      setCameraError('カメラ/マイクの開始に失敗しました。ブラウザの権限をご確認ください。');
      stopPreview();
    }
  };

  useEffect(() => {
    if (!open) return () => {};

    setMeetingId(String(initialMeetingId || '').trim());
    setDisplayName(String(initialDisplayName || '').trim());

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

  const requestNotificationPermission = async (opts) => {
    try {
      const silent = Boolean(opts?.silent);
      // eslint-disable-next-line no-undef
      if (typeof Notification === 'undefined') {
        if (!silent) alert('このブラウザは通知に対応していません。');
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
        setNotificationHint(
          '通知がブロックされています。Chrome のアドレスバー左の鍵アイコン →「サイトの設定」→「通知」を「許可」に変更してください。'
        );
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
      console.warn('[PreJoinExamineeModal] Failed to request notification permission', err);
      if (!opts?.silent) alert('通知の有効化に失敗しました。ブラウザの設定をご確認ください。');
    }
  };

  useEffect(() => {
    if (!open) {
      autoNotificationRequestedRef.current = false;
    }
  }, [open]);

  useLayoutEffect(() => {
    // Best-effort: request notification permission as soon as the modal opens.
    // Some browsers will only show the prompt on a user gesture; in that case, it will remain "default".
    if (!open) return;
    if (autoNotificationRequestedRef.current) return;
    autoNotificationRequestedRef.current = true;

    try {
      // eslint-disable-next-line no-undef
      if (typeof Notification === 'undefined') return;
      // eslint-disable-next-line no-undef
      const current = String(Notification.permission || 'default');
      if (current !== 'default') return;
    } catch (_) {
      return;
    }

    requestNotificationPermission({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
    // Restart preview to apply mic on/off.
    stopPreview();
    startPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinWithMic, open]);

  useEffect(() => {
    if (!open) return;
    if (!joinWithCamera) return;
    // Restart preview to apply selected device.
    stopPreview();
    startPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVideoDeviceId]);

  useEffect(() => {
    if (!open) return;
    if (!joinWithMic) return;
    // Restart preview to apply selected mic device.
    stopPreview();
    startPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAudioDeviceId]);

  if (!open) return null;

  const trimmedId = String(meetingId || '').trim();
  const trimmedDisplayName = String(displayName || '').trim();
  const canStart = Boolean(trimmedId) && (!requireDisplayName || Boolean(trimmedDisplayName));
  const notificationsOk = notificationPermission === 'granted' || notificationPermission === 'unsupported';
  const canStartWithNotifications = canStart && notificationsOk;

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
            <div className="text-base font-semibold text-slate-900">会議に参加</div>
            <div className="mt-1 text-xs text-slate-600">ミーティングIDを入力して「開始」を押してください</div>
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

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[1fr_320px]">
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
                Examinee Self View
              </div>
            </div>
            {cameraError && <div className="mt-2 text-sm font-semibold text-rose-600">{cameraError}</div>}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <label className="block text-xs font-semibold text-slate-700">ミーティングID</label>
            <input
              value={meetingId}
              onChange={(e) => setMeetingId(e.target.value)}
              placeholder="監督者から共有されたIDを入力"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />

            {requireDisplayName && (
              <div className="mt-4">
                <label className="block text-xs font-semibold text-slate-700">表示名</label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="例：山田 太郎"
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {!trimmedDisplayName && (
                  <div className="mt-1 text-xs text-slate-600">ゲスト参加では表示名の入力が必要です</div>
                )}
              </div>
            )}

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
                {notificationHint && (
                  <div className="mt-1 text-xs font-semibold text-rose-600">{notificationHint}</div>
                )}
                {!notificationsOk && (
                  <>
                    <div className="mt-1 text-xs font-semibold text-rose-600">開始前に通知の有効化が必要です</div>
                    <div className="mt-1 text-xs font-semibold text-rose-600">
                      ブラウザのアドレスバー左のアイコン（鍵/情報）から、このサイトの「通知」を「許可」にしてください。
                    </div>
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  if (busy) return;
                  if (!canStartWithNotifications) return;
                  // do NOT stop tracks; hand over to meeting page
                  detachVideo();
                  onStart?.({
                    meetingId: trimmedId,
                    displayName: trimmedDisplayName,
                    joinWithCamera: Boolean(joinWithCamera),
                    joinWithMic: Boolean(joinWithMic),
                    videoInputDeviceId: String(selectedVideoDeviceId || ''),
                    audioInputDeviceId: String(selectedAudioDeviceId || ''),
                    audioOutputDeviceId: String(selectedAudioOutputDeviceId || ''),
                    prejoinStream: streamRef.current || null,
                    autoJoin: true,
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
