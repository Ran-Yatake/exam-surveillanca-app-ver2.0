import React, { useEffect, useRef, useState } from 'react';
import {
  ConsoleLogger,
  DefaultDeviceController,
  DefaultMeetingSession,
  LogLevel,
  MeetingSessionConfiguration,
} from 'amazon-chime-sdk-js';

import {
  attendanceJoin,
  attendanceLeave,
  createAttendee,
  createMeeting,
  fetchProfile,
  guestJoinMeeting,
} from '../api/client.js';
import ChatPanel from '../components/chat/ChatPanel.jsx';
import ExamineeChatMessage from '../components/chat/messages/ExamineeChatMessage.jsx';

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

function normalizeAttendeeId(attendeeId) {
  const id = String(attendeeId || '').trim();
  if (!id) return '';
  return id.split('#')[0].trim();
}

export default function ExamineeView({
  currentUsername,
  isGuest,
  guestDisplayName,
  onBack,
  autoJoin,
  initialMeetingJoinId,
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
  function maybeNotifySystem({ title, body, tag }) {
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
  }
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isMicReady, setIsMicReady] = useState(false);
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
  const [proctorExternalUserId, setProctorExternalUserId] = useState('');
  // Multiple proctors support
  const [proctorsByAttendeeId, setProctorsByAttendeeId] = useState({});
  const [proctorAttendeeIdByTileId, setProctorAttendeeIdByTileId] = useState({});
  const [selectedProctorAttendeeId, setSelectedProctorAttendeeId] = useState('');
  const [meetingJoinId, setMeetingJoinId] = useState(''); // external meeting id input by student
  const [chatMessages, setChatMessages] = useState([]);
  const [chatDraft, setChatDraft] = useState('');
  const chatSeenIdsRef = useRef(new Set());
  const chatEndRef = useRef(null);
  const examEndHandledRef = useRef(false);
  const forcedLeaveHandledRef = useRef(false);
  const videoRef = useRef(null);
  const prejoinStreamRef = useRef(null);
  const autoJoinStartedRef = useRef(false);
  const initialConfigAppliedRef = useRef(false);
  const screenRef = useRef(null); // Local preview of screen share
  const screenShareStreamRef = useRef(null);
  const proctorVideoRef = useRef(null); // Remote Proctor View
  const audioRef = useRef(null); // Meeting Audio Output
  const observerRef = useRef(null);
  const selectedProctorAttendeeIdRef = useRef('');
  const proctorsByAttendeeIdRef = useRef({});
  const proctorAttendeeIdByTileIdRef = useRef({});
  const attendanceJoinCodeRef = useRef('');
  const attendanceAttendeeIdRef = useRef('');
  const attendanceLeaveSentRef = useRef(false);

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
      console.warn('[ExamineeView] Failed to choose audio output device via Chime', err);
    }
    try {
      const el = audioRef.current;
      if (el && typeof el.setSinkId === 'function') {
        await el.setSinkId(outId);
      }
    } catch (err) {
      console.warn('[ExamineeView] Failed to set audio sinkId', err);
    }
  };

  useEffect(() => {
    if (!meetingSession) return;
    const outId = String(selectedAudioOutputDeviceId || '').trim();
    if (!outId) return;
    chooseAudioOutput(meetingSession, outId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingSession, selectedAudioOutputDeviceId]);

  const myAttendeeId = meetingSession?.configuration?.credentials?.attendeeId || '';
  const showMicOffBadge = meetingSession ? isMuted : !joinWithMic;
  const knownProctorAttendeeIdsKey = Object.keys(proctorsByAttendeeId)
    .sort()
    .join('|');

  useEffect(() => {
    selectedProctorAttendeeIdRef.current = selectedProctorAttendeeId;
  }, [selectedProctorAttendeeId]);

  useEffect(() => {
    proctorsByAttendeeIdRef.current = proctorsByAttendeeId;
  }, [proctorsByAttendeeId]);

  useEffect(() => {
    proctorAttendeeIdByTileIdRef.current = proctorAttendeeIdByTileId;
  }, [proctorAttendeeIdByTileId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [chatMessages.length]);
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
    const countForTitle = Number(hiddenChatUnreadCount) || 0;
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
  }, [hiddenChatUnreadCount, isDocumentHidden]);

  useEffect(() => {
    if (!meetingSession?.audioVideo) return;

    const onDataMessage = (dataMessage) => {
      const rawText = dataMessage?.text?.();
      const payload = safeJsonParse(rawText);
      if (!payload) return;

      const id = String(payload.id || '');
      if (!id) return;

      // Allowed for examinee to display:
      // - proctor broadcast
      // - proctor direct to me
      const isFromProctor = payload.fromRole === 'proctor';
      if (!isFromProctor) return;

      // Best-effort: prevent spoofed "proctor" messages if we already know one or more proctor attendeeIds.
      const senderAttendeeId = dataMessage?.senderAttendeeId || payload.fromAttendeeId || '';
      if (knownProctorAttendeeIdsKey && senderAttendeeId) {
        const knownIds = knownProctorAttendeeIdsKey.split('|').filter(Boolean);
        if (knownIds.length > 0 && !knownIds.includes(senderAttendeeId)) return;
      }

      if (typeof payload.text !== 'string') return;

      const ok =
        payload.type === 'broadcast' ||
        (payload.type === 'direct' && payload.toRole === 'examinee' && payload.toAttendeeId === myAttendeeId);
      if (!ok) return;

      if (chatSeenIdsRef.current.has(id)) return;
      chatSeenIdsRef.current.add(id);
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

      maybeNotifySystem({
        title: '監督者から新着メッセージ',
        body: String(payload.text || '').slice(0, 120),
        tag: `exam-chat-proctor-${String(id || '')}`,
      });

      setChatMessages((prev) => [
        ...prev,
        {
          id,
          ts: payload.ts || nowIso(),
          fromRole: payload.fromRole,
          type: payload.type,
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
  }, [meetingSession, myAttendeeId, knownProctorAttendeeIdsKey]);

  // Keep the displayed/selected proctor info in sync.
  useEffect(() => {
    if (!selectedProctorAttendeeId) {
      setProctorExternalUserId('');
      try {
        if (proctorVideoRef.current) {
          proctorVideoRef.current.srcObject = null;
        }
      } catch (_) {
        // ignore
      }
      return;
    }
    const p = proctorsByAttendeeId[selectedProctorAttendeeId];
    if (!p) return;
    setProctorExternalUserId(p.externalUserId || '');
  }, [selectedProctorAttendeeId, proctorsByAttendeeId]);

  // When selection changes, re-bind the remote proctor video element.
  useEffect(() => {
    if (!meetingSession?.audioVideo) return;
    if (!selectedProctorAttendeeId) return;
    const tileId = proctorsByAttendeeId[selectedProctorAttendeeId]?.tileId;
    if (!tileId) return;
    if (!proctorVideoRef.current) return;
    try {
      meetingSession.audioVideo.bindVideoElement(tileId, proctorVideoRef.current);
    } catch (_) {
      // ignore
    }
  }, [meetingSession, selectedProctorAttendeeId, proctorsByAttendeeId]);

  const sendChatToProctor = () => {
    const text = String(chatDraft || '').trim();
    if (!text) return;
    if (text.length > MAX_CHAT_LEN) {
      alert(`メッセージが長すぎます（最大${MAX_CHAT_LEN}文字）。`);
      return;
    }
    if (!meetingSession?.audioVideo) return;

    const id = makeMessageId();
    const ts = nowIso();
    const payload = {
      id,
      ts,
      type: 'direct',
      fromRole: 'examinee',
      fromAttendeeId: myAttendeeId,
      toRole: 'proctor',
      // proctor attendeeId may be unknown on student side; proctor filters by role.
      text,
    };

    // Show my own sent message in the log.
    chatSeenIdsRef.current.add(id);
    setChatMessages((prev) => [
      ...prev,
      {
        id,
        ts,
        fromRole: 'examinee',
        type: 'direct',
        text,
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
    if (prejoinStreamRef.current) return;

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
          // ignore autoplay errors
        }
      }
    } catch (err) {
      console.warn('Failed to start pre-join camera preview', err);
      stopPrejoinPreview();
    }
  };

  useEffect(() => {
    if (meetingSession) return;
    if (!joinWithCamera) return;
    if (!selectedVideoInputDeviceId) return;
    // Restart preview to apply selected camera.
    stopPrejoinPreview();
    startPrejoinPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVideoInputDeviceId]);

  const leaveSession = async () => {
    const session = meetingSession;
    if (!session) return;

    const joinCode = String(attendanceJoinCodeRef.current || '').trim();
    const attendeeId =
      String(attendanceAttendeeIdRef.current || '').trim() ||
      String(session?.configuration?.credentials?.attendeeId || '').trim();
    if (joinCode && attendeeId && !attendanceLeaveSentRef.current) {
      attendanceLeaveSentRef.current = true;
      // Best-effort: don't block UI on network.
      attendanceLeave({ joinCode, attendeeId }).catch(() => {});
    }

    try {
      try {
        session.audioVideo.stopContentShare();
      } catch (_) {
        // ignore
      }
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
        session.audioVideo.stop();
      } catch (_) {
        // ignore
      }
    } finally {
      // Stop local screen-share stream if still active
      try {
        const stream = screenShareStreamRef.current;
        if (stream) {
          for (const track of stream.getTracks()) track.stop();
        }
      } catch (_) {
        // ignore
      }

      screenShareStreamRef.current = null;
      if (screenRef.current) screenRef.current.srcObject = null;
      setIsScreenSharing(false);
      setIsMuted(false);
      setIsCameraOn(false);
      setProctorExternalUserId('');
      setProctorsByAttendeeId({});
      setProctorAttendeeIdByTileId({});
      setSelectedProctorAttendeeId('');
      try {
        if (proctorVideoRef.current) {
          proctorVideoRef.current.srcObject = null;
        }
      } catch (_) {
        // ignore
      }
      setMeetingSession(null);
      setStatus('Idle');
    }
  };

  useEffect(() => {
    if (!meetingSession?.audioVideo) return;

    const onControlMessage = (dataMessage) => {
      const rawText = dataMessage?.text?.();
      const payload = safeJsonParse(rawText);
      if (!payload) return;

      if (payload.type === 'end_exam') {
        if (payload.fromRole && payload.fromRole !== 'proctor') return;
        if (examEndHandledRef.current) return;

        examEndHandledRef.current = true;
        (async () => {
          try {
            alert('試験が終了しました。');
          } catch (_) {
            // ignore
          }
          try {
            await leaveSession();
          } catch (_) {
            // ignore
          }
          try {
            onBack?.();
          } catch (_) {
            // ignore
          }
        })();
        return;
      }

      if (payload.type === 'kick') {
        if (payload.fromRole && payload.fromRole !== 'proctor') return;
        if (forcedLeaveHandledRef.current) return;

        const toBase = normalizeAttendeeId(payload.toAttendeeId);
        const myBase = normalizeAttendeeId(meetingSession?.configuration?.credentials?.attendeeId);
        if (!toBase || !myBase || toBase !== myBase) return;

        forcedLeaveHandledRef.current = true;
        (async () => {
          try {
            alert('監督者により退出させられました。');
          } catch (_) {
            // ignore
          }
          try {
            await leaveSession();
          } catch (_) {
            // ignore
          }
          try {
            onBack?.();
          } catch (_) {
            // ignore
          }
        })();
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
  }, [meetingSession, onBack]);

  const bestEffortSendLeave = () => {
    if (attendanceLeaveSentRef.current) return;
    const joinCode = String(attendanceJoinCodeRef.current || '').trim();
    const attendeeId = String(attendanceAttendeeIdRef.current || '').trim();
    if (!joinCode || !attendeeId) return;
    attendanceLeaveSentRef.current = true;

    const url = '/api/attendance/leave';
    const payload = JSON.stringify({ join_code: joinCode, attendee_id: attendeeId });

    try {
      if (navigator?.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
        return;
      }
    } catch (_) {
      // ignore
    }

    try {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    } catch (_) {
      // ignore
    }
  };

  // Record leave on tab close / navigation (best-effort).
  useEffect(() => {
    const onPageHide = () => bestEffortSendLeave();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') bestEffortSendLeave();
    };

    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    if (isGuest) {
      setProfile(null);
      setProfileLoading(false);
      return () => {
        cancelled = true;
      };
    }

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
  }, [isGuest]);

  // Show self-view as soon as examinee enters this page (before joining).
  useEffect(() => {
    if (meetingSession) {
      return () => {};
    }

    startPrejoinPreview();
    return () => {
      stopPrejoinPreview();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingSession, joinWithCamera]);

  const startExam = async (meetingIdOverride) => {
    try {
      const joinId = String(meetingIdOverride || meetingJoinId || '').trim();
      if (!joinId) {
        setStatus('Error: Please enter the Meeting ID.');
        return;
      }
      setStatus('Initializing...');
      const meetingId = joinId;
      const guestDn = String(guestDisplayName || '').trim();
      const effectiveProfile = isGuest
        ? { display_name: guestDn || 'User', class_name: 'guest' }
        : profile;
      const effectiveUsername = isGuest ? guestDn || currentUsername : currentUsername;

      const userId = makeExternalUserIdWithFallback('examinee', effectiveProfile, effectiveUsername);

      let meetingResponse;
      let attendeeResponse;

      if (isGuest) {
        // Guest users cannot call authenticated endpoints.
        const joinResponse = await guestJoinMeeting(meetingId, userId);
        meetingResponse = { Meeting: joinResponse.Meeting };
        attendeeResponse = { Attendee: joinResponse.Attendee };
      } else {
        // 1. Create/Get Meeting
        meetingResponse = await createMeeting(meetingId);

        // 2. Create Attendee
        attendeeResponse = await createAttendee(meetingResponse.Meeting.MeetingId, userId);
      }

      // Attendance: record join immediately after attendee issuance.
      const chimeMeetingId = meetingResponse?.Meeting?.MeetingId || '';
      const attendeeId = attendeeResponse?.Attendee?.AttendeeId || '';
      attendanceJoinCodeRef.current = meetingId;
      attendanceAttendeeIdRef.current = String(attendeeId || '').trim();
      attendanceLeaveSentRef.current = false;
      if (meetingId && attendeeId) {
        attendanceJoin({
          joinCode: meetingId,
          chimeMeetingId,
          attendeeId,
          externalUserId: userId,
          role: 'examinee',
        }).catch(() => {});
      }

      // 3. Initialize Chime Session
      const logger = new ConsoleLogger('ChimeLogger', LogLevel.INFO);
      const deviceController = new DefaultDeviceController(logger);
      const configuration = new MeetingSessionConfiguration(meetingResponse.Meeting, attendeeResponse.Attendee);

      const session = new DefaultMeetingSession(configuration, logger, deviceController);

      // 4. Select Audio/Video Devices
      const audioInputDevices = await session.audioVideo.listAudioInputDevices();
      const videoInputDevices = await session.audioVideo.listVideoInputDevices();
      const audioOutputDevices = await session.audioVideo.listAudioOutputDevices();

      setAudioOutputDevices(Array.isArray(audioOutputDevices) ? audioOutputDevices : []);

      const preferredAudioOut = String(selectedAudioOutputDeviceId || '').trim();
      const outputDeviceId =
        (preferredAudioOut && audioOutputDevices.find((d) => d.deviceId === preferredAudioOut)?.deviceId) ||
        (audioOutputDevices[0]?.deviceId || '');
      if (!selectedAudioOutputDeviceId && outputDeviceId) setSelectedAudioOutputDeviceId(outputDeviceId);

      let audioInputStarted = false;
      let videoInputStarted = false;

      if (joinWithMic && audioInputDevices.length > 0) {
        const preferredAudio = String(selectedAudioInputDeviceId || '').trim();
        const audioDeviceId =
          (preferredAudio && audioInputDevices.find((d) => d.deviceId === preferredAudio)?.deviceId) ||
          audioInputDevices[0].deviceId;
        await session.audioVideo.startAudioInput(audioDeviceId);
        audioInputStarted = true;
      }
      if (joinWithCamera && videoInputDevices.length > 0) {
        const prejoinStream = prejoinStreamRef.current;
        if (prejoinStream) {
          await session.audioVideo.startVideoInput(prejoinStream);
          videoInputStarted = true;

          // Hand over to Chime; do NOT stop tracks.
          prejoinStreamRef.current = null;
          try {
            if (videoRef.current && videoRef.current.srcObject) {
              videoRef.current.srcObject = null;
            }
          } catch (_) {
            // ignore
          }
        } else {
          const preferredVideo = String(selectedVideoInputDeviceId || '').trim();
          const videoDeviceId =
            (preferredVideo && videoInputDevices.find((d) => d.deviceId === preferredVideo)?.deviceId) ||
            videoInputDevices[0].deviceId;
          await session.audioVideo.startVideoInput(videoDeviceId);
          videoInputStarted = true;
        }
      }

      // 5. Bind Video Tile
      const observer = {
        audioVideoDidStart: () => {
          if (audioRef.current) {
            session.audioVideo.bindAudioElement(audioRef.current);
          }

          if (outputDeviceId) {
            chooseAudioOutput(session, outputDeviceId);
          }
        },
        videoTileDidUpdate: (tileState) => {
          // Local Camera
          if (tileState.localTile && !tileState.isContent) {
            session.audioVideo.bindVideoElement(tileState.tileId, videoRef.current);
            return;
          }

          // Remote Tiles: Only bind Proctor's video
          if (!tileState.localTile && !tileState.isContent && tileState.boundExternalUserId) {
            const externalId = tileState.boundExternalUserId;
            // Check if it is a proctor
            if (String(externalId).startsWith('proctor:') || String(externalId).startsWith('proctor-')) {
              const attendeeId = String(tileState.boundAttendeeId || '').trim();
              if (!attendeeId) return;

              setProctorsByAttendeeId((prev) => {
                const existing = prev[attendeeId];
                const next = {
                  ...prev,
                  [attendeeId]: {
                    attendeeId,
                    externalUserId: String(externalId),
                    tileId: tileState.tileId,
                  },
                };
                if (
                  existing &&
                  existing.externalUserId === String(externalId) &&
                  existing.tileId === tileState.tileId
                ) {
                  return prev;
                }
                return next;
              });

              setProctorAttendeeIdByTileId((prev) => {
                const cur = prev[tileState.tileId];
                if (cur === attendeeId) return prev;
                return { ...prev, [tileState.tileId]: attendeeId };
              });

              setSelectedProctorAttendeeId((cur) => {
                return cur || attendeeId;
              });

              // Bind to Proctor Video Element only if it matches the selected proctor.
              const selectedId = selectedProctorAttendeeIdRef.current;
              const shouldBind = !selectedId || selectedId === attendeeId;
              if (shouldBind && proctorVideoRef.current) {
                session.audioVideo.bindVideoElement(tileState.tileId, proctorVideoRef.current);
              }
            }
            // Ideally we ignore other students' tiles here
          }
        },
        videoTileWasRemoved: (tileId) => {
          const removedAttendeeId = proctorAttendeeIdByTileIdRef.current?.[tileId];
          if (!removedAttendeeId) return;

          setProctorAttendeeIdByTileId((prev) => {
            if (!prev[tileId]) return prev;
            const next = { ...prev };
            delete next[tileId];
            return next;
          });

          setProctorsByAttendeeId((prev) => {
            if (!prev[removedAttendeeId]) return prev;
            const next = { ...prev };
            delete next[removedAttendeeId];
            return next;
          });

          setSelectedProctorAttendeeId((cur) => {
            if (cur !== removedAttendeeId) return cur;
            const remaining = Object.values(proctorsByAttendeeIdRef.current || {}).filter(
              (p) => p && p.attendeeId && p.attendeeId !== removedAttendeeId,
            );
            return remaining[0]?.attendeeId || '';
          });
        },
        contentShareDidStart: () => {
          setIsScreenSharing(true);
          console.log('Screen share started');
        },
        contentShareDidStop: () => {
          setIsScreenSharing(false);
          console.log('Screen share stopped');
          if (screenRef.current) {
            screenRef.current.srcObject = null;
          }
          screenShareStreamRef.current = null;
        },
      };
      session.audioVideo.addObserver(observer);
      observerRef.current = observer;

      // 6. Start Session
      session.audioVideo.start();
      if (videoInputStarted) {
        session.audioVideo.startLocalVideoTile();
        setIsCameraOn(true);
      } else {
        setIsCameraOn(false);
      }

      setIsMicReady(audioInputStarted);
      if (!audioInputStarted) {
        setIsMuted(true);
      }

      setMeetingSession(session);
      setStatus('Connected');
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

  // Apply initial pre-join configuration (from the waiting modal) once.
  useEffect(() => {
    if (initialConfigAppliedRef.current) return;

    const hasAny =
      Boolean(String(initialMeetingJoinId || '').trim()) ||
      typeof initialJoinWithCamera === 'boolean' ||
      typeof initialJoinWithMic === 'boolean' ||
      Boolean(String(initialVideoInputDeviceId || '').trim()) ||
      Boolean(String(initialAudioInputDeviceId || '').trim()) ||
      Boolean(String(initialAudioOutputDeviceId || '').trim()) ||
      Boolean(initialPrejoinStream);
    if (!hasAny) return;

    initialConfigAppliedRef.current = true;

    const id = String(initialMeetingJoinId || '').trim();
    if (id) setMeetingJoinId(id);
    if (typeof initialJoinWithCamera === 'boolean') setJoinWithCamera(Boolean(initialJoinWithCamera));
    if (typeof initialJoinWithMic === 'boolean') setJoinWithMic(Boolean(initialJoinWithMic));

    const initialVideo = String(initialVideoInputDeviceId || '').trim();
    const initialAudio = String(initialAudioInputDeviceId || '').trim();
    const initialAudioOut = String(initialAudioOutputDeviceId || '').trim();
    if (initialVideo) setSelectedVideoInputDeviceId(initialVideo);
    if (initialAudio) setSelectedAudioInputDeviceId(initialAudio);
    if (initialAudioOut) setSelectedAudioOutputDeviceId(initialAudioOut);

    if (initialPrejoinStream && !meetingSession) {
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
    initialMeetingJoinId,
    initialJoinWithCamera,
    initialJoinWithMic,
    initialVideoInputDeviceId,
    initialAudioInputDeviceId,
    initialAudioOutputDeviceId,
    initialPrejoinStream,
    meetingSession,
  ]);

  // Auto-join flow: if the user clicked "開始" in the waiting modal, join immediately.
  useEffect(() => {
    if (!autoJoin) return;
    if (autoJoinStartedRef.current) return;
    if (meetingSession) return;
    if (profileLoading) return;

    const id = String(initialMeetingJoinId || meetingJoinId || '').trim();
    if (!id) return;

    autoJoinStartedRef.current = true;
    onAutoJoinConsumed?.();
    startExam(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoJoin, meetingSession, profileLoading, initialMeetingJoinId, meetingJoinId]);

  const prejoinCameraEnabled = meetingSession ? isCameraOn : joinWithCamera;

  const shareScreen = async () => {
    if (!meetingSession) return;
    try {
      // Use getDisplayMedia directly so we can also show a guaranteed local preview.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      screenShareStreamRef.current = stream;
      setIsScreenSharing(true);

      if (screenRef.current) {
        screenRef.current.srcObject = stream;
        // Some browsers require an explicit play() call.
        try {
          await screenRef.current.play();
        } catch (_) {
          // ignore autoplay errors; user gesture already happened (button click)
        }
      }

      // Publish to Chime
      await meetingSession.audioVideo.startContentShare(stream);

      // Handle user stopping share from browser UI
      const [track] = stream.getVideoTracks();
      if (track) {
        track.addEventListener('ended', () => {
          try {
            meetingSession.audioVideo.stopContentShare();
          } catch (_) {
            // ignore
          }
          setIsScreenSharing(false);
          if (screenRef.current) {
            screenRef.current.srcObject = null;
          }
          screenShareStreamRef.current = null;
        });
      }
    } catch (err) {
      console.error('Failed to start screen share', err);
      alert('Failed to start screen share. Please try again.');
    }
  };

  if (profileLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold">Exam Session</h2>
        <p className="mt-2 text-sm text-slate-600">Loading profile...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold">Exam Session</h2>
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
              onClick={async () => {
                await leaveSession();
                onBack();
              }}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
            >
              退出
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="rounded-xl border border-slate-200 bg-white p-6 w-full lg:flex-1">
          <p className="text-sm text-slate-700">
            Status: <span className="font-semibold text-slate-900">{status}</span>
          </p>
          <p className="mt-1 text-sm text-slate-600">Please ensure your camera is on and you are sharing your screen.</p>

          {!meetingSession && (
            <div className="mt-4 max-w-xl">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-sm font-semibold text-slate-800">ミーティングID</label>
                <input
                  value={meetingJoinId}
                  onChange={(e) => setMeetingJoinId(e.target.value)}
                  placeholder="監督者から共有されたIDを入力"
                  className="w-full sm:w-auto sm:min-w-[280px] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="mt-3">
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
                  onClick={startExam}
                  disabled={status === 'Initializing...'}
                  className="mt-3 w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  1. 会議に参加
                </button>
              </div>
            </div>
          )}

          {/* Hidden Audio for hearing Proctor */}
          <audio ref={audioRef} className="hidden" />

          <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-start">
            {/* Left Column: Student Self Views */}
            <div className="flex flex-row gap-4 lg:flex-col">
              <div className="relative w-[200px] overflow-hidden rounded-lg bg-black">
                <div className="h-[150px]">
                  <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
                </div>
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
                <div className="absolute bottom-2 left-2 rounded bg-slate-950/70 px-2 py-1 text-xs font-medium text-white">
                  My Camera
                </div>
              </div>

              <div className="relative w-[200px] overflow-hidden rounded-lg bg-slate-900">
                <div className="h-[150px] flex items-center justify-center">
                  <video ref={screenRef} autoPlay playsInline muted className="h-full w-full object-contain" />
                  {!isScreenSharing && <div className="absolute text-xs text-slate-700">Not Sharing</div>}
                </div>
                {showMicOffBadge && (
                  <div className="absolute right-2 top-2 flex items-center gap-1 rounded bg-slate-950/70 px-2 py-1 text-[10px] font-semibold text-white">
                    <span className="relative inline-block h-3 w-3 rounded-full border border-white/80">
                      <span className="absolute left-[-2px] top-1/2 h-[2px] w-[calc(100%+4px)] -translate-y-1/2 rotate-45 bg-white/80" />
                    </span>
                    <span>マイクOFF</span>
                  </div>
                )}
                <div className="absolute bottom-2 left-2 rounded bg-slate-950/70 px-2 py-1 text-xs font-medium text-white">
                  My Screen
                </div>
              </div>
            </div>

            {/* Right Column: Proctor View */}
            <div className="relative flex-1 overflow-hidden rounded-xl border border-red-500/40 bg-white">
              <div className="h-[310px] flex items-center justify-center">
                <video ref={proctorVideoRef} autoPlay playsInline className="h-full w-full object-contain" />
                {!meetingSession && <div className="absolute text-sm text-slate-600">Proctor video will appear here</div>}
              </div>
              <div className="absolute left-3 top-3 rounded bg-red-600/70 px-3 py-2 text-xs font-bold text-white">
                PROCTOR (Supervisor)
                {proctorExternalUserId ? `: ${extractDisplayName(proctorExternalUserId)}` : ''}
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">

            {meetingSession && !isScreenSharing && (
              <button
                onClick={shareScreen}
                className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-400"
              >
                2. Share Screen
              </button>
            )}

            {isScreenSharing && (
              <span className="rounded-md bg-emerald-600/20 px-4 py-2 text-sm font-semibold text-emerald-300">
                Screen Sharing Active
              </span>
            )}

            {meetingSession && (
              <div className="ml-auto flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-end gap-2">
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
        </div>

        <ChatPanel
          className="w-full lg:w-[360px] lg:shrink-0"
          title="チャット"
          headerRight={<div className="ml-auto text-xs text-slate-600">宛先: 監督者</div>}
          messages={chatMessages}
          renderMessage={(m) => <ExamineeChatMessage key={m.id} message={m} />}
          endRef={chatEndRef}
          draft={chatDraft}
          onDraftChange={(v) => setChatDraft(v)}
          onSend={sendChatToProctor}
          disabled={!meetingSession}
          placeholder={meetingSession ? 'メッセージを入力…' : '会議参加後に利用できます'}
          sendDisabled={!meetingSession || !String(chatDraft || '').trim()}
          footerNote="受験生同士のチャットはできません（監督者⇄受験生のみ）。"
        />
      </div>
    </div>
  );
}
