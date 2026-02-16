import React, { useEffect, useRef, useState } from 'react';
import {
  ConsoleLogger,
  DefaultDeviceController,
  DefaultMeetingSession,
  LogLevel,
  MeetingSessionConfiguration,
} from 'amazon-chime-sdk-js';

import {
  createAttendee,
  createMeeting,
  endScheduledMeeting,
  fetchProfile,
  presignProctorRecordingUpload,
} from '../api/client.js';
import ChatPanel from '../components/chat/ChatPanel.jsx';
import ProctorChatMessage from '../components/chat/messages/ProctorChatMessage.jsx';

const CHAT_TOPIC = 'exam-chat-v1';
const EXAM_CONTROL_TOPIC = 'exam-control-v1';
const MAX_CHAT_LEN = 500;

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function makeMessageId() {
  try {
    // eslint-disable-next-line no-undef
    return crypto.randomUUID();
  } catch (_) {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

export default function ProctorDashboard({
  currentUsername,
  meetingId,
  onSetMeetingId,
  onBack,
  autoJoin,
  initialJoinWithCamera,
  initialJoinWithMic,
  initialVideoInputDeviceId,
  initialAudioInputDeviceId,
  initialAudioOutputDeviceId,
  initialPrejoinStream,
  onAutoJoinConsumed,
  makeExternalUserIdWithFallback,
  extractDisplayName,
}) {
  const [meetingSession, setMeetingSession] = useState(null);
  const [status, setStatus] = useState('Idle');

  const [endExamConfirmOpen, setEndExamConfirmOpen] = useState(false);

  const baseTitleRef = useRef('');
  const [isDocumentHidden, setIsDocumentHidden] = useState(() => {
    try {
      // eslint-disable-next-line no-undef
      return typeof document !== 'undefined' ? Boolean(document.hidden) : false;
    } catch (_) {
      return false;
    }
  });
  const [hiddenChatUnreadCount, setHiddenChatUnreadCount] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isMicReady, setIsMicReady] = useState(false);
  const [recordingState, setRecordingState] = useState('idle'); // idle | recording | uploading
  const [recordingError, setRecordingError] = useState('');
  const [recordingLastKey, setRecordingLastKey] = useState('');
  const [joinWithCamera, setJoinWithCamera] = useState(true);
  const [joinWithMic, setJoinWithMic] = useState(true);
  const [videoDevices, setVideoDevices] = useState([]);
  const [audioDevices, setAudioDevices] = useState([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState([]);
  const [selectedVideoInputDeviceId, setSelectedVideoInputDeviceId] = useState('');
  const [selectedAudioInputDeviceId, setSelectedAudioInputDeviceId] = useState('');
  const [selectedAudioOutputDeviceId, setSelectedAudioOutputDeviceId] = useState('');
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [meetingIdCopied, setMeetingIdCopied] = useState(false);
  // Map of studentId -> { cameraTileId?, screenTileId?, externalUserId }
  const [studentsMap, setStudentsMap] = useState({});
  // Map of proctorAttendeeId -> { attendeeId, externalUserId, cameraTileId? }
  const [otherProctorsMap, setOtherProctorsMap] = useState({});
  const [chatMessages, setChatMessages] = useState([]);
  const [chatDraft, setChatDraft] = useState('');
  const [chatTo, setChatTo] = useState('all'); // 'all' | stableKey
  const [chatUnreadByKey, setChatUnreadByKey] = useState({}); // { [key: 'all' | stableKey]: number }
  const [chatNotice, setChatNotice] = useState('');
  const chatSeenIdsRef = useRef(new Set());
  const chatToRef = useRef('all');
  const chatNoticeTimerRef = useRef(null);
  const chatEndRef = useRef(null);
  const examEndHandledRef = useRef(false);
  const forcedLeaveHandledRef = useRef(false);
  const videoRef = useRef(null); // Local Proctor Video
  const audioRef = useRef(null); // Proctor Audio Output (to hear students)
  const prejoinStreamRef = useRef(null);
  const autoJoinStartedRef = useRef(false);
  const initialConfigAppliedRef = useRef(false);

  const recordingRecorderRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingDrawTimerRef = useRef(null);
  const recordingCanvasRef = useRef(null);

  // Ref to hold video elements mapping. Key = tileId
  const videoElements = useRef({});
  const observerRef = useRef(null);
  const presenceCallbackRef = useRef(null);
  const volumeIndicatorCallbacksRef = useRef(new Map()); // attendeeId -> callback

  useEffect(() => {
    // Pre-join device list for selectors (before meetingSession exists).
    if (meetingSession) return;
    if (!navigator?.mediaDevices?.enumerateDevices) return;

    let cancelled = false;
    const refresh = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const videos = devices.filter((d) => d.kind === 'videoinput');
        const audios = devices.filter((d) => d.kind === 'audioinput');
        const audioOuts = devices.filter((d) => d.kind === 'audiooutput');
        setVideoDevices(videos);
        setAudioDevices(audios);
        setAudioOutputDevices(audioOuts);
        if (!selectedVideoInputDeviceId && videos.length > 0) setSelectedVideoInputDeviceId(videos[0].deviceId);
        if (!selectedAudioInputDeviceId && audios.length > 0) setSelectedAudioInputDeviceId(audios[0].deviceId);
        if (!selectedAudioOutputDeviceId && audioOuts.length > 0) setSelectedAudioOutputDeviceId(audioOuts[0].deviceId);
      } catch (_) {
        // ignore
      }
    };

    refresh();
    try {
      navigator.mediaDevices.addEventListener?.('devicechange', refresh);
    } catch (_) {
      // ignore
    }

    return () => {
      cancelled = true;
      try {
        navigator.mediaDevices.removeEventListener?.('devicechange', refresh);
      } catch (_) {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingSession]);

  const chooseAudioOutput = async (session, deviceId) => {
    const outId = String(deviceId || '').trim();
    if (!session?.audioVideo || !outId) return;
    try {
      if (typeof session.audioVideo.chooseAudioOutputDevice === 'function') {
        await session.audioVideo.chooseAudioOutputDevice(outId);
      } else if (typeof session.audioVideo.chooseAudioOutput === 'function') {
        await session.audioVideo.chooseAudioOutput(outId);
      }
    } catch (err) {
      console.warn('[ProctorDashboard] Failed to choose audio output device via Chime', err);
    }

    // Best-effort: set sink on the bound audio element if supported.
    try {
      const el = audioRef.current;
      if (el && typeof el.setSinkId === 'function') {
        await el.setSinkId(outId);
      }
    } catch (err) {
      console.warn('[ProctorDashboard] Failed to set audio sinkId', err);
    }
  };

  useEffect(() => {
    if (!meetingSession) return;
    const outId = String(selectedAudioOutputDeviceId || '').trim();
    if (!outId) return;
    chooseAudioOutput(meetingSession, outId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingSession, selectedAudioOutputDeviceId]);

  const stableStudentKeyFromExternalUserId = (externalUserId) => {
    const base = String(externalUserId || '').split('#')[0];
    const parts = base.split(':');
    // externalUserId is like: student:<displayName>:<class>:<rand>
    if (parts.length >= 4 && parts[0] === 'student') {
      return `${parts[0]}:${parts[1]}:${parts[2]}`;
    }
    // Backward compatibility (older ids like student-123)
    return base;
  };

  const normalizeAttendeeId = (attendeeId) => {
    const id = String(attendeeId || '').trim();
    if (!id) return '';
    return id.split('#')[0].trim();
  };

  const studentsList = Object.values(studentsMap)
    .filter((s) => s && s.attendeeId)
    .map((s) => ({
      attendeeId: s.attendeeId,
      externalUserId: s.externalUserId,
      displayName: extractDisplayName(s.externalUserId),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'));

  const activeStudentByStableKey = (() => {
    const map = new Map(); // stableKey -> { attendeeId, externalUserId, displayName }
    for (const s of studentsList) {
      const key = stableStudentKeyFromExternalUserId(s.externalUserId);
      if (!key) continue;
      map.set(key, {
        attendeeId: s.attendeeId,
        externalUserId: s.externalUserId,
        displayName: s.displayName,
      });
    }
    return map;
  })();

  const stableKeyFromAttendeeId = (attendeeId) => {
    const id = normalizeAttendeeId(attendeeId);
    if (!id) return '';
    for (const student of Object.values(studentsMap)) {
      const studentAttendeeId = normalizeAttendeeId(student?.attendeeId);
      if (studentAttendeeId && studentAttendeeId === id && student?.externalUserId) {
        return stableStudentKeyFromExternalUserId(student.externalUserId);
      }
    }
    return id;
  };

  const resolveStudentNameByStableKey = (stableKey) => {
    const k = String(stableKey || '').trim();
    if (!k || k === 'all') return '';
    const active = activeStudentByStableKey.get(k);
    if (active?.displayName) return active.displayName;
    // If key is actually an attendeeId (fallback), try lookup.
    return resolveStudentNameByAttendeeId(k) || k;
  };

  const chatStudentTabs = (() => {
    const byKey = new Map(); // stableKey -> displayName

    for (const [k, v] of activeStudentByStableKey.entries()) {
      byKey.set(k, v?.displayName || k);
    }

    // Include students who have chat history but are no longer active.
    for (const m of chatMessages) {
      const convKey = String(m?.convKey || '').trim();
      if (!convKey || convKey === 'all') continue;
      if (!byKey.has(convKey)) {
        const dn = String(m?.peerDisplayName || '').trim() || resolveStudentNameByStableKey(convKey);
        byKey.set(convKey, dn || convKey);
      }
    }

    return Array.from(byKey.entries())
      .map(([stableKey, displayName]) => ({ stableKey, displayName }))
      .sort((a, b) => String(a.displayName).localeCompare(String(b.displayName), 'ja'));
  })();

  const myAttendeeId = meetingSession?.configuration?.credentials?.attendeeId || '';

  const otherProctorsList = Object.values(otherProctorsMap)
    .filter((p) => p && p.attendeeId && p.attendeeId !== myAttendeeId)
    .map((p) => ({
      attendeeId: p.attendeeId,
      externalUserId: p.externalUserId,
      displayName: extractDisplayName(p.externalUserId),
      cameraTileId: p.cameraTileId || null,
    }))
    .sort((a, b) => String(a.displayName).localeCompare(String(b.displayName), 'ja'));

  function resolveStudentNameByAttendeeId(attendeeId) {
    const id = normalizeAttendeeId(attendeeId);
    if (!id) return '';
    for (const student of Object.values(studentsMap)) {
      const studentAttendeeId = normalizeAttendeeId(student?.attendeeId);
      if (studentAttendeeId && studentAttendeeId === id) return extractDisplayName(student.externalUserId);
    }
    return String(id);
  }

  const isRecording = recordingState === 'recording' || recordingState === 'uploading';

  const filteredChatMessages =
    chatTo === 'all'
      ? chatMessages.filter((m) => m?.type === 'broadcast')
      : chatMessages.filter((m) => m?.type === 'direct' && String(m?.convKey || '') === String(chatTo));

  const totalUnread = Object.entries(chatUnreadByKey).reduce((sum, [key, count]) => {
    if (key === chatTo) return sum;
    return sum + (Number(count) || 0);
  }, 0);

  const maybeNotifySystem = ({ title, body, tag }) => {
    try {
      // eslint-disable-next-line no-undef
      const isActive =
        typeof document !== 'undefined' &&
        !document.hidden &&
        (typeof document.hasFocus !== 'function' || document.hasFocus());
      if (isActive) return;
      // eslint-disable-next-line no-undef
      if (typeof Notification === 'undefined') return;
      // eslint-disable-next-line no-undef
      if (Notification.permission !== 'granted') return;
      // eslint-disable-next-line no-undef
      new Notification(String(title || '新着メッセージ'), {
        body: String(body || ''),
        tag: String(tag || 'exam-chat'),
      });
    } catch (_) {
      // ignore
    }
  };

  useEffect(() => {
    try {
      // eslint-disable-next-line no-undef
      if (typeof document !== 'undefined' && !baseTitleRef.current) baseTitleRef.current = document.title || '';
    } catch (_) {
      // ignore
    }

    const onVis = () => {
      try {
        // eslint-disable-next-line no-undef
        const hiddenNow = typeof document !== 'undefined' ? Boolean(document.hidden) : false;
        const focusedNow = typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? Boolean(document.hasFocus()) : true;
        setIsDocumentHidden(hiddenNow);
        if (!hiddenNow && focusedNow) setHiddenChatUnreadCount(0);
      } catch (_) {
        // ignore
      }
    };

    try {
      // eslint-disable-next-line no-undef
      document.addEventListener('visibilitychange', onVis);
    } catch (_) {
      // ignore
    }

    try {
      // eslint-disable-next-line no-undef
      window.addEventListener('focus', onVis);
      // eslint-disable-next-line no-undef
      window.addEventListener('blur', onVis);
    } catch (_) {
      // ignore
    }
    return () => {
      try {
        // eslint-disable-next-line no-undef
        document.removeEventListener('visibilitychange', onVis);
      } catch (_) {
        // ignore
      }

      try {
        // eslint-disable-next-line no-undef
        window.removeEventListener('focus', onVis);
        // eslint-disable-next-line no-undef
        window.removeEventListener('blur', onVis);
      } catch (_) {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    const base = String(baseTitleRef.current || '').trim();
    const countForTitle = isDocumentHidden ? Math.max(Number(hiddenChatUnreadCount) || 0, Number(totalUnread) || 0) : Number(totalUnread) || 0;
    const nextTitle = countForTitle > 0 ? `(${countForTitle}) ${base || 'Exam'}` : base || 'Exam';

    try {
      // eslint-disable-next-line no-undef
      if (typeof document !== 'undefined') document.title = nextTitle;
    } catch (_) {
      // ignore
    }

    try {
      // eslint-disable-next-line no-undef
      if (typeof navigator !== 'undefined' && typeof navigator.setAppBadge === 'function') {
        if (countForTitle > 0) navigator.setAppBadge(countForTitle);
        else if (typeof navigator.clearAppBadge === 'function') navigator.clearAppBadge();
      }
    } catch (_) {
      // ignore
    }
  }, [totalUnread, hiddenChatUnreadCount, isDocumentHidden]);

  const clearChatNoticeTimer = () => {
    if (!chatNoticeTimerRef.current) return;
    clearTimeout(chatNoticeTimerRef.current);
    chatNoticeTimerRef.current = null;
  };

  const showChatNotice = (text) => {
    const msg = String(text || '').trim();
    if (!msg) return;

    setChatNotice(msg);
    clearChatNoticeTimer();
    chatNoticeTimerRef.current = setTimeout(() => {
      setChatNotice('');
      chatNoticeTimerRef.current = null;
    }, 3000);
  };

  const bumpUnread = (key) => {
    const k = String(key || '').trim();
    if (!k) return;
    setChatUnreadByKey((prev) => ({
      ...(prev || {}),
      [k]: (Number(prev?.[k]) || 0) + 1,
    }));
  };

  const clearUnread = (key) => {
    const k = String(key || '').trim();
    if (!k) return;
    setChatUnreadByKey((prev) => {
      const n = Number(prev?.[k]) || 0;
      if (n <= 0) return prev;
      const next = { ...(prev || {}) };
      delete next[k];
      return next;
    });
  };

  const pickRecordingMimeType = () => {
    const candidates = ['video/webm;codecs=vp8,opus', 'video/webm'];
    // eslint-disable-next-line no-undef
    if (typeof MediaRecorder === 'undefined') return '';
    // eslint-disable-next-line no-undef
    for (const t of candidates) if (MediaRecorder.isTypeSupported?.(t)) return t;
    return '';
  };

  const listRecordableTiles = () => {
    const entries = Object.entries(studentsMap || {})
      .map(([stableKey, value]) => ({ stableKey, ...(value || {}) }))
      .filter((s) => s && s.externalUserId)
      .map((s) => ({
        ...s,
        displayName: extractDisplayName(s.externalUserId),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'));

    const tiles = [];
    for (const s of entries) {
      if (s.cameraTileId) {
        const el = videoElements.current[s.cameraTileId];
        if (el) tiles.push({ kind: 'camera', label: `${s.displayName}`, tileId: s.cameraTileId, el });
      }
      if (s.screenTileId) {
        const el = videoElements.current[s.screenTileId];
        if (el) tiles.push({ kind: 'screen', label: `${s.displayName}（共有）`, tileId: s.screenTileId, el });
      }
    }
    return tiles;
  };

  const drawCover = (ctx, x, y, w, h, videoEl) => {
    // Center-crop to fill
    const vw = videoEl?.videoWidth || 0;
    const vh = videoEl?.videoHeight || 0;
    if (!vw || !vh) {
      ctx.fillStyle = '#111827';
      ctx.fillRect(x, y, w, h);
      return;
    }
    const scale = Math.max(w / vw, h / vh);
    const sw = w / scale;
    const sh = h / scale;
    const sx = (vw - sw) / 2;
    const sy = (vh - sh) / 2;
    try {
      ctx.drawImage(videoEl, sx, sy, sw, sh, x, y, w, h);
    } catch (_) {
      ctx.fillStyle = '#111827';
      ctx.fillRect(x, y, w, h);
    }
  };

  const stopCompositeRecording = async () => {
    try {
      if (recordingDrawTimerRef.current) {
        clearInterval(recordingDrawTimerRef.current);
        recordingDrawTimerRef.current = null;
      }
      const recorder = recordingRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    } catch (_) {
      // ignore
    }
  };

  const startCompositeRecording = async () => {
    setRecordingError('');
    setRecordingLastKey('');
    if (!meetingSession?.audioVideo) {
      setRecordingError('会議参加後に録画できます。');
      return;
    }
    if (isRecording) return;

    const tiles = listRecordableTiles();
    if (tiles.length === 0) {
      setRecordingError('録画対象の映像がありません（受験生が参加・カメラ/共有ONか確認してください）。');
      return;
    }

    // Canvas layout (fixed)
    const cols = 3;
    const tileW = 480;
    const tileH = 270;
    const pad = 10;
    const labelH = 22;

    const rows = Math.ceil(tiles.length / cols);
    const canvasW = pad + cols * (tileW + pad);
    const canvasH = pad + rows * (labelH + tileH + pad);

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    recordingCanvasRef.current = canvas;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setRecordingError('Canvas初期化に失敗しました。');
      return;
    }
    ctx.textBaseline = 'top';

    const fps = 10;
    const canvasStream = canvas.captureStream(fps);

    // Prefer directly reusing Chime-bound audio stream if available.
    const audioTracks = [];
    const srcObj = audioRef.current?.srcObject;
    if (srcObj && typeof srcObj.getAudioTracks === 'function') {
      try {
        audioTracks.push(...srcObj.getAudioTracks());
      } catch (_) {
        // ignore
      }
    }

    const composed = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
    const mimeType = pickRecordingMimeType();

    let recorder;
    try {
      // eslint-disable-next-line no-undef
      recorder = new MediaRecorder(composed, mimeType ? { mimeType } : undefined);
    } catch (e) {
      console.error(e);
      setRecordingError('MediaRecorderの初期化に失敗しました（ブラウザ対応をご確認ください）。');
      return;
    }

    recordingChunksRef.current = [];
    recorder.ondataavailable = (ev) => {
      if (ev?.data && ev.data.size > 0) recordingChunksRef.current.push(ev.data);
    };

    recorder.onerror = (ev) => {
      console.error('Recorder error', ev);
      setRecordingError('録画中にエラーが発生しました。');
    };

    recorder.onstop = async () => {
      const chunks = recordingChunksRef.current;
      recordingChunksRef.current = [];

      try {
        setRecordingState('uploading');
        // Use a stable content-type to avoid presign signature mismatch.
        const contentType = 'video/webm';
        const blob = new Blob(chunks, { type: contentType });

        const joinCode = String(meetingId || '').trim();
        const fileName = `recording-${joinCode}-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;

        const presign = await presignProctorRecordingUpload(joinCode, {
          file_name: fileName,
          content_type: contentType,
        });

        const putRes = await fetch(presign.url, {
          method: 'PUT',
          headers: {
            'Content-Type': contentType,
          },
          body: blob,
        });

        if (!putRes.ok) {
          throw new Error(`S3 upload failed (${putRes.status})`);
        }

        setRecordingLastKey(presign.key || '');
      } catch (e) {
        console.error(e);
        setRecordingError(`録画ファイルの保存に失敗しました: ${e?.message || e}`);
      } finally {
        setRecordingState('idle');
      }
    };

    // Draw loop
    const drawOnce = () => {
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(0, 0, canvasW, canvasH);

      tiles.forEach((t, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = pad + col * (tileW + pad);
        const y = pad + row * (labelH + tileH + pad);

        // Label bar
        ctx.fillStyle = t.kind === 'screen' ? '#1f2937' : '#111827';
        ctx.fillRect(x, y, tileW, labelH);
        ctx.fillStyle = '#e5e7eb';
        ctx.font = '14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
        ctx.fillText(t.label, x + 8, y + 3);

        // Video
        drawCover(ctx, x, y + labelH, tileW, tileH, t.el);
      });
    };

    drawOnce();
    recordingDrawTimerRef.current = setInterval(drawOnce, 1000 / fps);

    recordingRecorderRef.current = recorder;
    setRecordingState('recording');
    // timeslice to avoid huge memory use
    recorder.start(1000);
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [chatMessages.length, chatTo]);

  useEffect(() => {
    chatToRef.current = chatTo;
    clearUnread(chatTo);
  }, [chatTo]);

  useEffect(() => {
    return () => {
      clearChatNoticeTimer();
    };
  }, []);

  useEffect(() => {
    if (!meetingSession?.audioVideo) return;

    const onDataMessage = (dataMessage) => {
      const rawText = dataMessage?.text?.();
      const payload = safeJsonParse(rawText);
      if (!payload || typeof payload.text !== 'string') return;

      const senderAttendeeIdRaw = dataMessage?.senderAttendeeId || payload.fromAttendeeId || '';
      const senderAttendeeId = String(senderAttendeeIdRaw || '').split('#')[0];
      const id = String(payload.id || '');
      if (!id) return;

      // Allowed:
      // - examinee -> proctor (direct)
      // - proctor -> (broadcast/direct) (shown for log)
      const ok =
        (payload.fromRole === 'examinee' && payload.toRole === 'proctor' && payload.type === 'direct') ||
        (payload.fromRole === 'proctor' && (payload.type === 'broadcast' || payload.type === 'direct'));
      if (!ok) return;

      // For examinee -> proctor direct messages, we must be able to attribute it to a concrete attendeeId.
      // (Guests may not appear in studentsMap yet if they joined with camera off.)
      if (payload.fromRole === 'examinee' && payload.type === 'direct') {
        if (!senderAttendeeId) return;
      }

      // NOTE: We intentionally do NOT require senderAttendeeId to be in studentsMap.
      // Otherwise, guests (or camera-off examinees) cannot use direct chat.

      if (chatSeenIdsRef.current.has(id)) return;
      chatSeenIdsRef.current.add(id);

      let convKey = 'all';
      let peerDisplayName = '';
      if (payload.type === 'broadcast') {
        convKey = 'all';
      } else if (payload.fromRole === 'examinee') {
        convKey = stableKeyFromAttendeeId(senderAttendeeId);
        peerDisplayName = resolveStudentNameByAttendeeId(senderAttendeeId);
      } else if (payload.fromRole === 'proctor' && payload.toRole === 'examinee') {
        const toBase = String(payload.toAttendeeId || '').split('#')[0];
        convKey = stableKeyFromAttendeeId(toBase);
        peerDisplayName = resolveStudentNameByAttendeeId(toBase);
      }

      const currentTo = chatToRef.current;
      const isIncomingFromExaminee = payload.fromRole === 'examinee' && payload.toRole === 'proctor' && payload.type === 'direct';
      if (isIncomingFromExaminee && convKey) {
        try {
          // eslint-disable-next-line no-undef
          const isActive =
            typeof document !== 'undefined' &&
            !document.hidden &&
            (typeof document.hasFocus !== 'function' || document.hasFocus());
          if (!isActive) setHiddenChatUnreadCount((n) => (Number(n) || 0) + 1);
        } catch (_) {
          // ignore
        }

        const name = resolveStudentNameByStableKey(convKey);
        const body = String(payload.text || '').slice(0, 120);
        maybeNotifySystem({
          title: `${name} から新着メッセージ`,
          body,
          tag: `exam-chat-${String(convKey || 'all')}-${String(id || '')}`,
        });

        if (convKey !== currentTo) {
          bumpUnread(convKey);
          showChatNotice(`${name} から新着メッセージ`);
        }
      }

      setChatMessages((prev) => [
        ...prev,
        {
          id,
          ts: payload.ts || nowIso(),
          type: payload.type,
          convKey,
          peerDisplayName,
          fromRole: payload.fromRole,
          fromAttendeeId: senderAttendeeId,
          toRole: payload.toRole,
          toAttendeeId: payload.toAttendeeId || '',
          text: payload.text,
        },
      ]);
    };

    try {
      meetingSession.audioVideo.realtimeSubscribeToReceiveDataMessage(CHAT_TOPIC, onDataMessage);
    } catch (_) {
      // ignore
    }

    return () => {
      try {
        meetingSession.audioVideo.realtimeUnsubscribeFromReceiveDataMessage(CHAT_TOPIC, onDataMessage);
      } catch (_) {
        // ignore
      }
    };
  }, [meetingSession, studentsMap]);


  const sendChat = () => {
    const text = String(chatDraft || '').trim();
    if (!text) return;
    if (text.length > MAX_CHAT_LEN) {
      alert(`メッセージが長すぎます（最大${MAX_CHAT_LEN}文字）。`);
      return;
    }
    if (!meetingSession?.audioVideo) return;

    const id = makeMessageId();
    const ts = nowIso();

    const target = String(chatTo || '').trim();
    const targetInfo = target && target !== 'all' ? activeStudentByStableKey.get(target) : null;
    const targetAttendeeId = normalizeAttendeeId(targetInfo?.attendeeId);
    if (target !== 'all' && !targetAttendeeId) {
      alert('受験生がまだ会議に参加していません（宛先を確認してください）。');
      return;
    }

    const payload =
      chatTo === 'all'
        ? {
            id,
            ts,
            type: 'broadcast',
            fromRole: 'proctor',
            fromAttendeeId: myAttendeeId,
            toRole: 'all',
            text,
          }
        : {
            id,
            ts,
            type: 'direct',
            fromRole: 'proctor',
            fromAttendeeId: myAttendeeId,
            toRole: 'examinee',
            toAttendeeId: targetAttendeeId,
            text,
          };

    chatSeenIdsRef.current.add(id);
    setChatMessages((prev) => [
      ...prev,
      {
        id,
        ts,
        type: payload.type,
        convKey: payload.type === 'broadcast' ? 'all' : String(chatTo || ''),
        peerDisplayName: payload.type === 'broadcast' ? '' : (targetInfo?.displayName || ''),
        fromRole: payload.fromRole,
        fromAttendeeId: payload.fromAttendeeId,
        toRole: payload.toRole,
        toAttendeeId: payload.toAttendeeId || '',
        text: payload.text,
      },
    ]);

    try {
      meetingSession.audioVideo.realtimeSendDataMessage(CHAT_TOPIC, JSON.stringify(payload), 300000);
    } catch (err) {
      console.error('Failed to send chat message', err);
      alert('チャット送信に失敗しました。');
    }
    setChatDraft('');
  };

  const unsubscribeAllVolumeIndicators = (session) => {
    if (!session) return;
    const map = volumeIndicatorCallbacksRef.current;
    if (!map || map.size === 0) return;
    if (typeof session.audioVideo.realtimeUnsubscribeFromVolumeIndicator !== 'function') return;

    for (const [attendeeId, cb] of map.entries()) {
      try {
        session.audioVideo.realtimeUnsubscribeFromVolumeIndicator(attendeeId, cb);
      } catch (_) {
        // ignore
      }
    }
    map.clear();
  };

  const stopPrejoinPreview = () => {
    try {
      const stream = prejoinStreamRef.current;
      if (stream) {
        for (const track of stream.getTracks()) track.stop();
      }
    } catch (_) {
      // ignore
    }
    prejoinStreamRef.current = null;

    try {
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject = null;
      }
    } catch (_) {
      // ignore
    }
  };

  const startPrejoinPreview = async () => {
    if (meetingSession) return;
    if (!joinWithCamera) {
      stopPrejoinPreview();
      return;
    }
    if (prejoinStreamRef.current) {
      // Already running
      return;
    }
    try {
      const videoConstraint = String(selectedVideoInputDeviceId || '').trim()
        ? { deviceId: { exact: String(selectedVideoInputDeviceId || '').trim() } }
        : true;
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: false });
      prejoinStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch (_) {
          // ignore autoplay errors (should be ok in most cases)
        }
      }
    } catch (err) {
      console.warn('Failed to start pre-join camera preview', err);
      stopPrejoinPreview();
      // If permissions are denied, keep UI as Camera Off overlay.
    }
  };

  useEffect(() => {
    if (meetingSession) return;
    if (!joinWithCamera) return;
    if (!selectedVideoInputDeviceId) return;
    stopPrejoinPreview();
    startPrejoinPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVideoInputDeviceId]);

  const broadcastEndExam = (session) => {
    if (!session?.audioVideo) return;
    const payload = {
      id: makeMessageId(),
      ts: nowIso(),
      type: 'end_exam',
      fromRole: 'proctor',
      fromAttendeeId: myAttendeeId,
    };
    try {
      session.audioVideo.realtimeSendDataMessage(EXAM_CONTROL_TOPIC, JSON.stringify(payload), 60000);
    } catch (_) {
      // ignore
    }
  };

  const kickParticipant = (session, attendeeId, roleHint) => {
    if (!session?.audioVideo) return;
    const toBase = normalizeAttendeeId(attendeeId);
    if (!toBase) return;
    const myBase = normalizeAttendeeId(myAttendeeId);
    if (myBase && toBase === myBase) return;

    const payload = {
      id: makeMessageId(),
      ts: nowIso(),
      type: 'kick',
      fromRole: 'proctor',
      fromAttendeeId: myAttendeeId,
      toAttendeeId: toBase,
      toRole: roleHint ? String(roleHint) : undefined,
    };
    try {
      session.audioVideo.realtimeSendDataMessage(EXAM_CONTROL_TOPIC, JSON.stringify(payload), 60000);
    } catch (_) {
      // ignore
    }
  };

  const endExamLocal = async () => {
    const session = meetingSession;
    if (!session) {
      onBack();
      return;
    }

    try {
      try {
        session.audioVideo.stopLocalVideoTile();
      } catch (_) {
        // ignore
      }
      try {
        session.audioVideo.stopVideoInput();
      } catch (_) {
        // ignore
      }
      try {
        if (observerRef.current) session.audioVideo.removeObserver(observerRef.current);
      } catch (_) {
        // ignore
      }
      try {
        if (presenceCallbackRef.current && typeof session.audioVideo.realtimeUnsubscribeToAttendeeIdPresence === 'function') {
          session.audioVideo.realtimeUnsubscribeToAttendeeIdPresence(presenceCallbackRef.current);
        }
      } catch (_) {
        // ignore
      }
      try {
        unsubscribeAllVolumeIndicators(session);
      } catch (_) {
        // ignore
      }
      try {
        session.audioVideo.stop();
      } catch (_) {
        // ignore
      }
    } finally {
      setMeetingSession(null);
      setStudentsMap({});
      setIsMuted(false);
      setIsCameraOn(false);
      setStatus('Idle');
      onBack();
    }
  };

  const endExam = async () => {
    if (examEndHandledRef.current) return;
    examEndHandledRef.current = true;
    const session = meetingSession;
    if (session) broadcastEndExam(session);

    // Persist end state on backend to block re-join.
    const joinCode = String(meetingId || '').trim();
    if (joinCode) {
      try {
        await endScheduledMeeting(joinCode);
      } catch (err) {
        console.error('[ProctorDashboard] Failed to end scheduled meeting on backend', err);
        try {
          alert('バックエンドへの終了通知に失敗しました。再参加ブロックが効かない可能性があります。');
        } catch (_) {
          // ignore
        }
      }
    }
    await endExamLocal();
  };

  useEffect(() => {
    if (!endExamConfirmOpen) return () => {};
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setEndExamConfirmOpen(false);
      }
    };
    try {
      window.addEventListener('keydown', onKeyDown);
    } catch (_) {
      // ignore
    }
    return () => {
      try {
        window.removeEventListener('keydown', onKeyDown);
      } catch (_) {
        // ignore
      }
    };
  }, [endExamConfirmOpen]);

  useEffect(() => {
    if (!meetingSession?.audioVideo) return;

    const onControlMessage = (dataMessage) => {
      const rawText = dataMessage?.text?.();
      const payload = safeJsonParse(rawText);
      if (!payload) return;

      if (payload.type === 'end_exam') {
        if (examEndHandledRef.current) return;
        if (payload.fromRole && payload.fromRole !== 'proctor') return;

        examEndHandledRef.current = true;
        try {
          alert('試験が終了しました。');
        } catch (_) {
          // ignore
        }
        endExamLocal();
        return;
      }

      if (payload.type === 'kick') {
        if (forcedLeaveHandledRef.current) return;
        if (payload.fromRole && payload.fromRole !== 'proctor') return;

        const toBase = normalizeAttendeeId(payload.toAttendeeId);
        const myBase = normalizeAttendeeId(myAttendeeId);
        if (!toBase || !myBase || toBase !== myBase) return;

        forcedLeaveHandledRef.current = true;
        try {
          alert('監督者により退出させられました。');
        } catch (_) {
          // ignore
        }
        endExamLocal();
      }
    };

    try {
      meetingSession.audioVideo.realtimeSubscribeToReceiveDataMessage(EXAM_CONTROL_TOPIC, onControlMessage);
    } catch (_) {
      // ignore
    }
    return () => {
      try {
        meetingSession.audioVideo.realtimeUnsubscribeFromReceiveDataMessage(EXAM_CONTROL_TOPIC, onControlMessage);
      } catch (_) {
        // ignore
      }
    };
  }, [meetingSession]);

  const copyMeetingId = async () => {
    try {
      if (!meetingId) return;
      await navigator.clipboard.writeText(meetingId);
      setMeetingIdCopied(true);
      setTimeout(() => setMeetingIdCopied(false), 1500);
    } catch (_) {
      // ignore (clipboard may be blocked)
    }
  };

  const toggleMute = () => {
    if (!meetingSession) return;
    if (isMuted) {
      (async () => {
        try {
          if (!isMicReady) {
            const audioInputDevices = await meetingSession.audioVideo.listAudioInputDevices();
            if (!audioInputDevices || audioInputDevices.length === 0) {
              alert('利用可能なマイクが見つかりませんでした。');
              return;
            }
            const preferredAudio = String(selectedAudioInputDeviceId || '').trim();
            const audioDeviceId =
              (preferredAudio && audioInputDevices.find((d) => d.deviceId === preferredAudio)?.deviceId) ||
              audioInputDevices[0].deviceId;
            await meetingSession.audioVideo.startAudioInput(audioDeviceId);
            setIsMicReady(true);
          }
          meetingSession.audioVideo.realtimeUnmuteLocalAudio();
          setIsMuted(false);
        } catch (err) {
          console.error('Failed to start/unmute mic', err);
          alert('マイクの開始に失敗しました。ブラウザ権限をご確認ください。');
        }
      })();
    } else {
      meetingSession.audioVideo.realtimeMuteLocalAudio();
      setIsMuted(true);
      try {
        meetingSession.audioVideo.stopAudioInput();
        setIsMicReady(false);
      } catch (_) {
        // ignore
      }
    }
  };

  const toggleCamera = async () => {
    const session = meetingSession;
    if (!session) return;

    if (isCameraOn) {
      try {
        session.audioVideo.stopLocalVideoTile();
      } catch (_) {
        // ignore
      }
      try {
        session.audioVideo.stopVideoInput();
      } catch (_) {
        // ignore
      }
      setIsCameraOn(false);
      return;
    }

    try {
      const videoInputDevices = await session.audioVideo.listVideoInputDevices();
      if (!videoInputDevices || videoInputDevices.length === 0) {
        alert('利用可能なカメラが見つかりませんでした。');
        return;
      }
      const preferredVideo = String(selectedVideoInputDeviceId || '').trim();
      const videoDeviceId =
        (preferredVideo && videoInputDevices.find((d) => d.deviceId === preferredVideo)?.deviceId) ||
        videoInputDevices[0].deviceId;
      await session.audioVideo.startVideoInput(videoDeviceId);
      session.audioVideo.startLocalVideoTile();
      setIsCameraOn(true);
    } catch (err) {
      console.error('Failed to start camera', err);
      alert('カメラの開始に失敗しました。ブラウザ権限をご確認ください。');
    }
  };

  useEffect(() => {
    const session = meetingSession;
    if (!session?.audioVideo) return;
    const deviceId = String(selectedAudioInputDeviceId || '').trim();
    if (!deviceId) return;
    if (isMuted) return;

    (async () => {
      try {
        await session.audioVideo.startAudioInput(deviceId);
        setIsMicReady(true);
      } catch (_) {
        // ignore
      }
    })();
  }, [meetingSession, selectedAudioInputDeviceId, isMuted]);

  useEffect(() => {
    const session = meetingSession;
    if (!session?.audioVideo) return;
    const deviceId = String(selectedVideoInputDeviceId || '').trim();
    if (!deviceId) return;
    if (!isCameraOn) return;

    (async () => {
      try {
        await session.audioVideo.startVideoInput(deviceId);
        session.audioVideo.startLocalVideoTile();
      } catch (_) {
        // ignore
      }
    })();
  }, [meetingSession, selectedVideoInputDeviceId, isCameraOn]);

  useEffect(() => {
    let cancelled = false;
    fetchProfile()
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch((err) => {
        console.error(err);
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Show self-view as soon as proctor enters this page (before joining).
  useEffect(() => {
    if (meetingSession) {
      // Once joined, Chime will control the video element.
      return () => {};
    }

    startPrejoinPreview();
    return () => {
      stopPrejoinPreview();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingSession, joinWithCamera]);

  // Apply initial pre-join configuration (from the waiting modal) once.
  useEffect(() => {
    if (initialConfigAppliedRef.current) return;

    const hasAny =
      typeof initialJoinWithCamera === 'boolean' ||
      typeof initialJoinWithMic === 'boolean' ||
      Boolean(String(initialVideoInputDeviceId || '').trim()) ||
      Boolean(String(initialAudioInputDeviceId || '').trim()) ||
      Boolean(String(initialAudioOutputDeviceId || '').trim()) ||
      Boolean(initialPrejoinStream);
    if (!hasAny) return;

    initialConfigAppliedRef.current = true;
    if (typeof initialJoinWithCamera === 'boolean') setJoinWithCamera(Boolean(initialJoinWithCamera));
    if (typeof initialJoinWithMic === 'boolean') setJoinWithMic(Boolean(initialJoinWithMic));

    const initialVideo = String(initialVideoInputDeviceId || '').trim();
    const initialAudio = String(initialAudioInputDeviceId || '').trim();
    const initialAudioOut = String(initialAudioOutputDeviceId || '').trim();
    if (initialVideo) setSelectedVideoInputDeviceId(initialVideo);
    if (initialAudio) setSelectedAudioInputDeviceId(initialAudio);
    if (initialAudioOut) setSelectedAudioOutputDeviceId(initialAudioOut);

    if (initialPrejoinStream && !meetingSession) {
      // Use the stream obtained in the modal to avoid re-requesting permissions.
      prejoinStreamRef.current = initialPrejoinStream;
      try {
        if (videoRef.current) {
          videoRef.current.srcObject = initialPrejoinStream;
          videoRef.current.play?.().catch?.(() => {});
        }
      } catch (_) {
        // ignore
      }
    }
  }, [
    initialJoinWithCamera,
    initialJoinWithMic,
    initialVideoInputDeviceId,
    initialAudioInputDeviceId,
    initialAudioOutputDeviceId,
    initialPrejoinStream,
    meetingSession,
  ]);

  const joinSession = async (meetingIdOverride) => {
    try {
      const joinCode = String(meetingIdOverride || meetingId || '').trim();
      if (!joinCode) {
        setStatus('Error: Please create/select a scheduled meeting first.');
        return;
      }
      setStatus('Connecting...');
      const userId = makeExternalUserIdWithFallback('proctor', profile, currentUsername);

      const meetingResponse = await createMeeting(joinCode);
      const attendeeResponse = await createAttendee(meetingResponse.Meeting.MeetingId, userId);

      const logger = new ConsoleLogger('ChimeProctorLogger', LogLevel.INFO);
      const deviceController = new DefaultDeviceController(logger);
      const configuration = new MeetingSessionConfiguration(meetingResponse.Meeting, attendeeResponse.Attendee);

      const session = new DefaultMeetingSession(configuration, logger, deviceController);

      // Select Audio/Video Devices for Proctor
      const audioInputDevices = await session.audioVideo.listAudioInputDevices();
      const videoInputDevices = await session.audioVideo.listVideoInputDevices();
      const audioOutputDevices = await session.audioVideo.listAudioOutputDevices();

      setAudioOutputDevices(Array.isArray(audioOutputDevices) ? audioOutputDevices : []);

      const preferredAudioOut = String(selectedAudioOutputDeviceId || '').trim();
      const outputDeviceId =
        (preferredAudioOut && audioOutputDevices.find((d) => d.deviceId === preferredAudioOut)?.deviceId) ||
        (audioOutputDevices[0]?.deviceId || '');
      if (!selectedAudioOutputDeviceId && outputDeviceId) setSelectedAudioOutputDeviceId(outputDeviceId);

      let videoInputStarted = false;
      let audioInputStarted = false;
      try {
        if (joinWithMic && audioInputDevices.length > 0) {
          const preferredAudio = String(selectedAudioInputDeviceId || '').trim();
          const audioDeviceId =
            (preferredAudio && audioInputDevices.find((d) => d.deviceId === preferredAudio)?.deviceId) ||
            audioInputDevices[0].deviceId;
          await session.audioVideo.startAudioInput(audioDeviceId);
          audioInputStarted = true;
        }
      } catch (err) {
        console.warn('Proctor mic unavailable', err);
      }
      try {
        if (joinWithCamera) {
          const prejoinStream = prejoinStreamRef.current;
          if (prejoinStream) {
            await session.audioVideo.startVideoInput(prejoinStream);
            videoInputStarted = true;

            // Hand over the stream to Chime. Do NOT stop tracks here,
            // otherwise the published camera will go black.
            prejoinStreamRef.current = null;
            try {
              if (videoRef.current && videoRef.current.srcObject) {
                videoRef.current.srcObject = null;
              }
            } catch (_) {
              // ignore
            }
          } else if (videoInputDevices.length > 0) {
            const preferredVideo = String(selectedVideoInputDeviceId || '').trim();
            const videoDeviceId =
              (preferredVideo && videoInputDevices.find((d) => d.deviceId === preferredVideo)?.deviceId) ||
              videoInputDevices[0].deviceId;
            await session.audioVideo.startVideoInput(videoDeviceId);
            videoInputStarted = true;
          }
        }
      } catch (err) {
        console.warn('Proctor camera unavailable', err);
      }
      if (audioOutputDevices.length > 0) {
        // Output device selection is applied after bindAudioElement (see audioVideoDidStart).
      }

      // Track remote video tiles
      const observer = {
        audioVideoDidStart: () => {
          // Bind audio output to hear students
          if (audioRef.current) {
            session.audioVideo.bindAudioElement(audioRef.current);
          }

          if (outputDeviceId) {
            chooseAudioOutput(session, outputDeviceId);
          }

          // Hide panels for attendees that have left.
          // (Some Chime SDK versions expose externalUserId in the callback.)
          if (typeof session.audioVideo.realtimeSubscribeToAttendeeIdPresence === 'function') {
            const selfAttendeeId = session?.configuration?.credentials?.attendeeId || '';
            const cb = (attendeeId, present, externalUserId) => {
              if (!externalUserId) return;
              const baseExternalId = String(externalUserId).split('#')[0];

              const isStudent = baseExternalId.startsWith('student:') || baseExternalId.startsWith('student-');
              const isProctor = baseExternalId.startsWith('proctor:') || baseExternalId.startsWith('proctor-');

              if (isProctor) {
                if (attendeeId && attendeeId === selfAttendeeId) return;
                if (!present) {
                  setOtherProctorsMap((prev) => {
                    if (!prev?.[attendeeId]) return prev;
                    const next = { ...(prev || {}) };
                    delete next[attendeeId];
                    return next;
                  });
                  return;
                }
                setOtherProctorsMap((prev) => {
                  const curr = prev?.[attendeeId];
                  if (curr && curr.externalUserId === baseExternalId && curr.attendeeId === attendeeId) return prev;
                  return {
                    ...(prev || {}),
                    [attendeeId]: {
                      ...(curr || {}),
                      attendeeId,
                      externalUserId: baseExternalId,
                    },
                  };
                });
                return;
              }

              if (!isStudent) return;

              const stableKey = stableStudentKeyFromExternalUserId(baseExternalId);

              if (!present) {
                // Unsubscribe volume indicator for this attendee.
                try {
                  const map = volumeIndicatorCallbacksRef.current;
                  const oldCb = map.get(attendeeId);
                  if (oldCb && typeof session.audioVideo.realtimeUnsubscribeFromVolumeIndicator === 'function') {
                    session.audioVideo.realtimeUnsubscribeFromVolumeIndicator(attendeeId, oldCb);
                  }
                  map.delete(attendeeId);
                } catch (_) {
                  // ignore
                }

                setStudentsMap((prev) => {
                  if (!prev[stableKey]) return prev;
                  const next = { ...prev };
                  delete next[stableKey];
                  return next;
                });
                return;
              }

              // Ensure the attendee is tracked even before video arrives.
              setStudentsMap((prev) => {
                if (prev[stableKey]) {
                  return {
                    ...prev,
                    [stableKey]: {
                      ...prev[stableKey],
                      externalUserId: baseExternalId,
                      attendeeId: normalizeAttendeeId(attendeeId),
                    },
                  };
                }
                return {
                  ...prev,
                  [stableKey]: {
                    externalUserId: baseExternalId,
                    attendeeId: normalizeAttendeeId(attendeeId),
                    cameraTileId: null,
                    screenTileId: null,
                    isMuted: false,
                  },
                };
              });
            };
            presenceCallbackRef.current = cb;
            try {
              session.audioVideo.realtimeSubscribeToAttendeeIdPresence(cb);
            } catch (_) {
              // ignore
            }
          }
        },
        videoTileDidUpdate: (tileState) => {
          // Local Proctor Tile
          if (tileState.localTile && !tileState.isContent) {
            session.audioVideo.bindVideoElement(tileState.tileId, videoRef.current);
            return;
          }

          if (!tileState.boundAttendeeId || tileState.localTile) {
            return;
          }

          const externalId = tileState.boundExternalUserId;
          // Identify base ID. Content share usually has suffix like "#content"
          const isContent = tileState.isContent;
          const baseExternalId = String(externalId || '').split('#')[0];

          const isStudent = baseExternalId.startsWith('student:') || baseExternalId.startsWith('student-');
          const isProctor = baseExternalId.startsWith('proctor:') || baseExternalId.startsWith('proctor-');

          // Other proctors: track camera tiles only and render next to self-view.
          if (isProctor) {
            const attendeeId = String(tileState.boundAttendeeId || '').trim();
            if (!attendeeId) return;
            if (attendeeId === (session?.configuration?.credentials?.attendeeId || '')) return;
            if (isContent) return;

            setOtherProctorsMap((prev) => {
              const curr = prev?.[attendeeId];
              const next = {
                ...(prev || {}),
                [attendeeId]: {
                  ...(curr || {}),
                  attendeeId,
                  externalUserId: baseExternalId,
                  cameraTileId: tileState.tileId,
                },
              };
              if (
                curr &&
                curr.externalUserId === baseExternalId &&
                curr.cameraTileId === tileState.tileId &&
                curr.attendeeId === attendeeId
              ) {
                return prev;
              }
              return next;
            });

            setTimeout(() => {
              const videoEl = videoElements.current[tileState.tileId];
              if (videoEl) {
                session.audioVideo.bindVideoElement(tileState.tileId, videoEl);
              }
            }, 100);
            return;
          }

          if (!isStudent) return;

          const stableKey = stableStudentKeyFromExternalUserId(baseExternalId);

          // Subscribe to audio mute state (volume indicator) for this attendee.
          // This lets the proctor see whether the student is muted.
          try {
            const attendeeId = tileState.boundAttendeeId;
            const map = volumeIndicatorCallbacksRef.current;
            if (
              attendeeId &&
              !map.has(attendeeId) &&
              typeof session.audioVideo.realtimeSubscribeToVolumeIndicator === 'function'
            ) {
              const cb = (_attendeeId, _volume, muted) => {
                setStudentsMap((prev) => {
                  const curr = prev[stableKey];
                  if (!curr) return prev;
                  const baseAttendeeId = normalizeAttendeeId(attendeeId);
                  if (curr.isMuted === muted && normalizeAttendeeId(curr.attendeeId) === baseAttendeeId) return prev;
                  return {
                    ...prev,
                    [stableKey]: {
                      ...curr,
                      attendeeId: baseAttendeeId,
                      isMuted: Boolean(muted),
                    },
                  };
                });
              };
              map.set(attendeeId, cb);
              session.audioVideo.realtimeSubscribeToVolumeIndicator(attendeeId, cb);
            }
          } catch (_) {
            // ignore
          }

          setStudentsMap((prev) => {
            const student = prev[stableKey] || { externalUserId: baseExternalId };
            const baseAttendeeId = normalizeAttendeeId(tileState.boundAttendeeId || student.attendeeId || null);
            return {
              ...prev,
              [stableKey]: {
                ...student,
                externalUserId: baseExternalId,
                attendeeId: baseAttendeeId,
                cameraTileId: isContent ? student.cameraTileId : tileState.tileId,
                screenTileId: isContent ? tileState.tileId : student.screenTileId,
              },
            };
          });

          // Bind video element
          setTimeout(() => {
            const videoEl = videoElements.current[tileState.tileId];
            if (videoEl) {
              session.audioVideo.bindVideoElement(tileState.tileId, videoEl);
            }
          }, 100);
        },
        videoTileWasRemoved: (tileId) => {
          // We need to find which student had this tile and remove it
          setStudentsMap((prev) => {
            const newState = { ...prev };
            // Iterate to find and clear the tileId
            for (const id in newState) {
              if (newState[id].cameraTileId === tileId) newState[id].cameraTileId = null;
              if (newState[id].screenTileId === tileId) newState[id].screenTileId = null;
              // If student has no feeds, maybe remove them? Keeping for now to show status.
            }
            return newState;
          });

          setOtherProctorsMap((prev) => {
            if (!prev) return prev;
            let changed = false;
            const next = { ...prev };
            for (const attendeeId of Object.keys(next)) {
              if (next[attendeeId]?.cameraTileId === tileId) {
                next[attendeeId] = { ...next[attendeeId], cameraTileId: null };
                changed = true;
              }
            }
            return changed ? next : prev;
          });
        },
      };

      session.audioVideo.addObserver(observer);
      observerRef.current = observer;
      session.audioVideo.start();

      if (videoInputStarted) {
        session.audioVideo.startLocalVideoTile(); // Publish Proctor Video
        setIsCameraOn(true);
      } else {
        setIsCameraOn(false);
      }

      setIsMicReady(audioInputStarted);
      if (!audioInputStarted) {
        // Reflect initial mic preference in UI.
        setIsMuted(true);
      }

      if (audioInputStarted && !joinWithMic) {
        // Defensive: in case preferences change before join.
        try {
          session.audioVideo.realtimeMuteLocalAudio();
          setIsMuted(true);
          session.audioVideo.stopAudioInput();
          setIsMicReady(false);
        } catch (_) {
          // ignore
        }
      }

      if (audioInputStarted && joinWithMic) {
        setIsMuted(false);
      }

      setMeetingSession(session);
      setStatus('Monitoring Active');
    } catch (error) {
      console.error(error);
      const msg = String(error?.message || error);
      if (msg.includes('Meeting ended') || msg.includes('already ended')) {
        setStatus('Error: 試験は終了しました。再参加できません。');
      } else {
        setStatus('Error: ' + msg);
      }
    }
  };

  // Auto-join flow: if the user clicked "開始" in the waiting modal, join immediately.
  useEffect(() => {
    if (!autoJoin) return;
    if (autoJoinStartedRef.current) return;
    if (meetingSession) return;
    if (profileLoading) return;
    const joinCode = String(meetingId || '').trim();
    if (!joinCode) return;

    autoJoinStartedRef.current = true;
    onAutoJoinConsumed?.();
    joinSession(joinCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoJoin, meetingId, meetingSession, profileLoading]);

  const prejoinCameraEnabled = meetingSession ? isCameraOn : joinWithCamera;
  const showMicOffBadge = meetingSession ? isMuted : !joinWithMic;
  const studentCount = Object.keys(studentsMap).length;
  const participantCount = meetingSession ? 1 + studentCount : 0;

  if (profileLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold">Monitoring Dashboard</h2>
        <p className="mt-2 text-sm text-slate-600">Loading profile...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold">Monitoring Dashboard</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {!meetingSession && (
            <button
              onClick={onBack}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
            >
              ← ダッシュボードへ戻る
            </button>
          )}

          {meetingSession && (
            <button
              onClick={() => setEndExamConfirmOpen(true)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
            >
              試験終了
            </button>
          )}
        </div>
      </div>

      {endExamConfirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="end-exam-confirm-title"
        >
          <button
            type="button"
            aria-label="閉じる"
            className="absolute inset-0 bg-black/40"
            onClick={() => setEndExamConfirmOpen(false)}
          />
          <div className="relative w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div id="end-exam-confirm-title" className="text-base font-semibold text-slate-900">
                  試験を終了しますか？
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  参加者は全員退出し、この会議に再参加できなくなります。
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEndExamConfirmOpen(false)}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-100"
              >
                閉じる
              </button>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEndExamConfirmOpen(false);
                  endExam();
                }}
                className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
              >
                試験終了
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-6 max-w-3xl">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-800">ミーティングID</span>
          <input
            value={meetingId}
            readOnly
            placeholder="（会議スケジュールページで選択してください）"
            className="w-full sm:w-auto sm:min-w-[260px] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400"
          />
          <button
            onClick={copyMeetingId}
            disabled={!meetingId}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            コピー
          </button>
          {meetingIdCopied && <span className="text-sm font-semibold text-emerald-400">コピーしました</span>}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm text-slate-700">
            Status: <span className="font-semibold text-slate-900">{status}</span>
          </div>

          {meetingSession && (
            <div className="text-sm text-slate-700">
              参加者: <span className="font-semibold text-slate-900">{participantCount}</span>人
            </div>
          )}

          {!meetingSession && (
            <div className="ml-auto w-full max-w-xl">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setJoinWithMic((v) => !v)}
                  className="flex-1 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
                >
                  {joinWithMic ? 'マイク:ON' : 'マイク:OFF'}
                </button>
                <button
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
                    value={selectedVideoInputDeviceId}
                    onChange={(e) => setSelectedVideoInputDeviceId(String(e.target.value || ''))}
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
                    value={selectedAudioInputDeviceId}
                    onChange={(e) => setSelectedAudioInputDeviceId(String(e.target.value || ''))}
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

              <button
                onClick={() => joinSession()}
                className="mt-3 w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
              >
                参加して監視開始
              </button>
            </div>
          )}

          {meetingSession && (
            <div className="ml-auto flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="rounded-md bg-emerald-600/20 px-3 py-2 text-sm font-semibold text-emerald-300">Live</span>
                {recordingState === 'recording' && (
                  <span className="rounded-md bg-rose-600/20 px-3 py-2 text-sm font-semibold text-rose-300">録画中</span>
                )}
                {recordingState === 'uploading' && (
                  <span className="rounded-md bg-slate-950/10 px-3 py-2 text-sm font-semibold text-slate-700">
                    アップロード中…
                  </span>
                )}

                <button
                  onClick={isRecording ? stopCompositeRecording : startCompositeRecording}
                  disabled={recordingState === 'uploading'}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRecording ? '録画停止' : '録画開始'}
                </button>
                <button
                  onClick={toggleCamera}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
                >
                  {isCameraOn ? 'カメラ:ON' : 'カメラ:OFF'}
                </button>
                <button
                  onClick={toggleMute}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
                >
                  {isMuted ? 'マイク:OFF' : 'マイク:ON'}
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="min-w-[220px]">
                  <label className="block text-[11px] font-semibold text-slate-600">カメラ</label>
                  <select
                    value={selectedVideoInputDeviceId}
                    onChange={(e) => setSelectedVideoInputDeviceId(String(e.target.value || ''))}
                    disabled={videoDevices.length === 0}
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
                <div className="min-w-[220px]">
                  <label className="block text-[11px] font-semibold text-slate-600">マイク</label>
                  <select
                    value={selectedAudioInputDeviceId}
                    onChange={(e) => setSelectedAudioInputDeviceId(String(e.target.value || ''))}
                    disabled={audioDevices.length === 0}
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
                <div className="min-w-[220px]">
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
            </div>
          )}
        </div>

        {(recordingError || recordingLastKey) && (
          <div className="mt-3 space-y-1 text-sm">
            {recordingError && <div className="font-semibold text-rose-600">{recordingError}</div>}
            {recordingLastKey && (
              <div className="text-slate-600">
                保存先キー: <span className="font-mono text-slate-900">{recordingLastKey}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hidden Audio Element for Proctor to hear students */}
      <audio ref={audioRef} className="hidden" />

      <div className="flex flex-col gap-4">
        {/* Proctor's Local View (Self) - shown above student panels */}
        <div className="flex flex-wrap items-start gap-4">
          <div className="w-full lg:w-[220px]">
            <div className="relative overflow-hidden rounded-lg border border-indigo-500/50 bg-slate-50">
              <div className="aspect-[4/3]">
                <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
                {showMicOffBadge && (
                  <div className="absolute right-2 top-2 flex items-center gap-1 rounded bg-slate-950/70 px-2 py-1 text-[10px] font-semibold text-white">
                    <span className="relative inline-block h-3 w-3 rounded-full border border-white/80">
                      <span className="absolute left-[-2px] top-1/2 h-[2px] w-[calc(100%+4px)] -translate-y-1/2 rotate-45 bg-white/80" />
                    </span>
                    <span>マイクOFF</span>
                  </div>
                )}
                {!prejoinCameraEnabled && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 text-sm font-semibold text-white">
                    Camera Off
                  </div>
                )}
              </div>
              <div className="absolute bottom-0 left-0 right-0 bg-slate-950/70 px-2 py-1 text-center text-xs font-medium text-slate-100">
                Proctor Self View
              </div>
            </div>
          </div>

          {otherProctorsList.map((p) => (
            <div key={p.attendeeId} className="w-full lg:w-[220px]">
              <div className="relative overflow-hidden rounded-lg border border-rose-500/50 bg-slate-50">
                <div className="aspect-[4/3]">
                  {p.cameraTileId ? (
                    <video
                      ref={(el) => {
                        if (el) videoElements.current[p.cameraTileId] = el;
                        if (el && meetingSession) meetingSession.audioVideo.bindVideoElement(p.cameraTileId, el);
                      }}
                      autoPlay
                      playsInline
                      muted
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-slate-950/60 text-sm font-semibold text-white">
                      Proctor Camera Off
                    </div>
                  )}

                  <div className="absolute left-2 top-2 rounded bg-rose-600 px-2 py-1 text-[10px] font-bold text-white">
                    PROCTOR
                  </div>
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-slate-950/70 px-2 py-1 text-center text-xs font-medium text-slate-100">
                  {p.displayName || 'Proctor'}
                </div>
              </div>

              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => kickParticipant(meetingSession, p.attendeeId, 'proctor')}
                  className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                >
                  退出させる
                </button>
              </div>
            </div>
          ))}
        </div>

        <div>
          {/* Grid of Students (3 columns) */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Object.values(studentsMap).map((student) => {
              const displayName = extractDisplayName(student.externalUserId);
              const showMutedBadge = student.isMuted === true;
              return (
                <div key={student.externalUserId} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">{displayName}</h3>
                    {showMutedBadge && (
                      <span className="inline-flex items-center gap-1 rounded bg-slate-950/70 px-2 py-0.5 text-[10px] font-semibold text-white">
                        <span className="relative inline-block h-3 w-3 rounded-full border border-white/80">
                          <span className="absolute left-[-2px] top-1/2 h-[2px] w-[calc(100%+4px)] -translate-y-1/2 rotate-45 bg-white/80" />
                        </span>
                        <span>ミュート</span>
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => kickParticipant(meetingSession, student.attendeeId, 'examinee')}
                      disabled={!student?.attendeeId}
                      className="ml-auto rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      退出させる
                    </button>
                  </div>
                  <div className="mt-3 flex gap-2">
                    {/* Camera Feed */}
                    <div className="relative flex-1 overflow-hidden rounded-lg bg-black">
                      <div className="h-[120px]">
                        {student.cameraTileId ? (
                          <video
                            ref={(el) => {
                              if (el) videoElements.current[student.cameraTileId] = el;
                              if (el && meetingSession) meetingSession.audioVideo.bindVideoElement(student.cameraTileId, el);
                            }}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-slate-700">No Camera</div>
                        )}
                      </div>
                      <div className="absolute bottom-0 left-0 bg-slate-950/70 px-2 py-1 text-[10px] font-medium text-white">
                        Camera
                      </div>
                    </div>

                    {/* Screen Share Feed */}
                    <div className="relative flex-1 overflow-hidden rounded-lg bg-slate-900">
                      <div className="h-[120px]">
                        {student.screenTileId ? (
                          <video
                            ref={(el) => {
                              if (el) videoElements.current[student.screenTileId] = el;
                              if (el && meetingSession) meetingSession.audioVideo.bindVideoElement(student.screenTileId, el);
                            }}
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-slate-700">No Screen</div>
                        )}
                      </div>
                      <div className="absolute bottom-0 left-0 bg-slate-950/70 px-2 py-1 text-[10px] font-medium text-white">
                        Screen
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {Object.keys(studentsMap).length === 0 && meetingSession && (
            <p className="mt-4 text-sm text-slate-600">Waiting for students to join...</p>
          )}
        </div>
      </div>

      <ChatPanel
        title="チャット"
        headerRight={
          <>
            {totalUnread > 0 ? (
              <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white">新着 {totalUnread}</span>
            ) : null}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setChatTo('all')}
                disabled={!meetingSession}
                className={
                  'rounded-md border px-3 py-1 text-xs font-semibold disabled:opacity-50 ' +
                  (chatTo === 'all'
                    ? 'border-indigo-600 bg-indigo-600 text-white'
                    : 'border-slate-300 bg-white text-slate-900 hover:bg-slate-100')
                }
              >
                全員
              </button>
              {chatStudentTabs.map((s) => (
                <button
                  key={s.stableKey}
                  type="button"
                  onClick={() => setChatTo(s.stableKey)}
                  disabled={!meetingSession}
                  className={
                    'relative rounded-md border px-3 py-1 text-xs font-semibold disabled:opacity-50 ' +
                    (chatTo === s.stableKey
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-slate-300 bg-white text-slate-900 hover:bg-slate-100')
                  }
                >
                  {s.displayName}
                  {Number(chatUnreadByKey?.[s.stableKey]) > 0 ? (
                    <span className="ml-2 inline-flex min-w-[18px] items-center justify-center rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {chatUnreadByKey[s.stableKey]}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </>
        }
        subHeader={
          <>
            宛先: {chatTo === 'all' ? '全員（一斉送信）' : `受験生: ${resolveStudentNameByStableKey(chatTo)}`}
          </>
        }
        notice={chatNotice}
        messages={filteredChatMessages}
        renderMessage={(m) => (
          <ProctorChatMessage key={m.id} message={m} resolveStudentNameByAttendeeId={resolveStudentNameByAttendeeId} />
        )}
        endRef={chatEndRef}
        draft={chatDraft}
        onDraftChange={(v) => setChatDraft(v)}
        onSend={sendChat}
        disabled={!meetingSession}
        placeholder={meetingSession ? 'メッセージを入力…' : '会議参加後に利用できます'}
        sendDisabled={!meetingSession || !String(chatDraft || '').trim()}
        footerNote="受験生同士のチャットは表示されません（監督者⇄受験生のみ）。"
      />
    </div>
  );
}
