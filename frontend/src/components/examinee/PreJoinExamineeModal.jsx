import React, { useEffect, useRef, useState } from 'react';

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

  const videoRef = useRef(null);
  const streamRef = useRef(null);
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
    if (!joinWithCamera) {
      stopPreview();
      return;
    }
    if (streamRef.current) return;

    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
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
      console.warn('[PreJoinExamineeModal] Failed to start camera preview', err);
      setCameraError('カメラの開始に失敗しました。ブラウザの権限をご確認ください。');
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

  if (!open) return null;

  const trimmedId = String(meetingId || '').trim();
  const trimmedDisplayName = String(displayName || '').trim();
  const canStart = Boolean(trimmedId) && (!requireDisplayName || Boolean(trimmedDisplayName));

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

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setJoinWithCamera((v) => !v)}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
              >
                {joinWithCamera ? 'カメラ:ON' : 'カメラ:OFF'}
              </button>
              <button
                type="button"
                onClick={() => setJoinWithMic((v) => !v)}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
              >
                {joinWithMic ? 'マイク:ON' : 'マイク:OFF'}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (busy) return;
                  if (!canStart) return;
                  // do NOT stop tracks; hand over to meeting page
                  detachVideo();
                  onStart?.({
                    meetingId: trimmedId,
                    displayName: trimmedDisplayName,
                    joinWithCamera: Boolean(joinWithCamera),
                    joinWithMic: Boolean(joinWithMic),
                    prejoinStream: streamRef.current || null,
                    autoJoin: true,
                  });
                }}
                disabled={busy || !canStart}
                className="ml-0 sm:ml-auto w-full sm:w-auto rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
