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
  fetchProfile,
} from '../api/client.js';

const CHAT_TOPIC = 'exam-chat-v1';
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
  onGoSchedule,
  onBack,
  makeExternalUserIdWithFallback,
  extractDisplayName,
}) {
  const [meetingSession, setMeetingSession] = useState(null);
  const [status, setStatus] = useState('Idle');
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isMicReady, setIsMicReady] = useState(false);
  const [joinWithCamera, setJoinWithCamera] = useState(true);
  const [joinWithMic, setJoinWithMic] = useState(true);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [meetingIdCopied, setMeetingIdCopied] = useState(false);
  // Map of studentId -> { cameraTileId?, screenTileId?, externalUserId }
  const [studentsMap, setStudentsMap] = useState({});
  const [chatMessages, setChatMessages] = useState([]);
  const [chatDraft, setChatDraft] = useState('');
  const [chatTo, setChatTo] = useState('all'); // 'all' | attendeeId
  const chatSeenIdsRef = useRef(new Set());
  const chatEndRef = useRef(null);
  const videoRef = useRef(null); // Local Proctor Video
  const audioRef = useRef(null); // Proctor Audio Output (to hear students)
  const prejoinStreamRef = useRef(null);

  // Ref to hold video elements mapping. Key = tileId
  const videoElements = useRef({});
  const observerRef = useRef(null);
  const presenceCallbackRef = useRef(null);
  const volumeIndicatorCallbacksRef = useRef(new Map()); // attendeeId -> callback

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

  const studentsList = Object.values(studentsMap)
    .filter((s) => s && s.attendeeId)
    .map((s) => ({
      attendeeId: s.attendeeId,
      externalUserId: s.externalUserId,
      displayName: extractDisplayName(s.externalUserId),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'));

  const myAttendeeId = meetingSession?.configuration?.credentials?.attendeeId || '';

  const resolveStudentNameByAttendeeId = (attendeeId) => {
    if (!attendeeId) return '';
    for (const student of Object.values(studentsMap)) {
      if (student?.attendeeId === attendeeId) return extractDisplayName(student.externalUserId);
    }
    return String(attendeeId);
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [chatMessages.length]);

  useEffect(() => {
    if (!meetingSession?.audioVideo) return;

    const onDataMessage = (dataMessage) => {
      const rawText = dataMessage?.text?.();
      const payload = safeJsonParse(rawText);
      if (!payload || typeof payload.text !== 'string') return;

      const senderAttendeeId = dataMessage?.senderAttendeeId || payload.fromAttendeeId || '';
      const id = String(payload.id || '');
      if (!id) return;

      // Allowed:
      // - examinee -> proctor (direct)
      // - proctor -> (broadcast/direct) (shown for log)
      const ok =
        (payload.fromRole === 'examinee' && payload.toRole === 'proctor' && payload.type === 'direct') ||
        (payload.fromRole === 'proctor' && (payload.type === 'broadcast' || payload.type === 'direct'));
      if (!ok) return;

      // If it claims to be from examinee, ensure the sender is a known student (best-effort).
      if (payload.fromRole === 'examinee' && senderAttendeeId) {
        const known = Object.values(studentsMap).some((s) => s?.attendeeId === senderAttendeeId);
        if (!known) return;
      }

      if (chatSeenIdsRef.current.has(id)) return;
      chatSeenIdsRef.current.add(id);

      setChatMessages((prev) => [
        ...prev,
        {
          id,
          ts: payload.ts || nowIso(),
          type: payload.type,
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
            toAttendeeId: chatTo,
            text,
          };

    chatSeenIdsRef.current.add(id);
    setChatMessages((prev) => [
      ...prev,
      {
        id,
        ts,
        type: payload.type,
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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
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

  const endExam = async () => {
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
            await meetingSession.audioVideo.startAudioInput(audioInputDevices[0].deviceId);
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
      await session.audioVideo.startVideoInput(videoInputDevices[0].deviceId);
      session.audioVideo.startLocalVideoTile();
      setIsCameraOn(true);
    } catch (err) {
      console.error('Failed to start camera', err);
      alert('カメラの開始に失敗しました。ブラウザ権限をご確認ください。');
    }
  };

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

  const joinSession = async (meetingIdOverride) => {
    try {
      const joinCode = String(meetingIdOverride || meetingId || '').trim();
      if (!meetingId) {
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

      let videoInputStarted = false;
      let audioInputStarted = false;
      try {
        if (joinWithMic && audioInputDevices.length > 0) {
          await session.audioVideo.startAudioInput(audioInputDevices[0].deviceId);
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
            await session.audioVideo.startVideoInput(videoInputDevices[0].deviceId);
            videoInputStarted = true;
          }
        }
      } catch (err) {
        console.warn('Proctor camera unavailable', err);
      }
      if (audioOutputDevices.length > 0) {
        // Typically binding to an audio element is handled below, but if specific device selection is needed:
        // await session.audioVideo.chooseAudioOutput(audioOutputDevices[0].deviceId);
      }

      // Track remote video tiles
      const observer = {
        audioVideoDidStart: () => {
          // Bind audio output to hear students
          if (audioRef.current) {
            session.audioVideo.bindAudioElement(audioRef.current);
          }

          // Hide panels for attendees that have left.
          // (Some Chime SDK versions expose externalUserId in the callback.)
          if (typeof session.audioVideo.realtimeSubscribeToAttendeeIdPresence === 'function') {
            const cb = (attendeeId, present, externalUserId) => {
              if (!externalUserId) return;
              const baseExternalId = String(externalUserId).split('#')[0];
              if (!baseExternalId.startsWith('student:') && !baseExternalId.startsWith('student-')) return;
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
                      attendeeId,
                    },
                  };
                }
                return {
                  ...prev,
                  [stableKey]: {
                    externalUserId: baseExternalId,
                    attendeeId,
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
                  if (curr.isMuted === muted && curr.attendeeId === attendeeId) return prev;
                  return {
                    ...prev,
                    [stableKey]: {
                      ...curr,
                      attendeeId,
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
            return {
              ...prev,
              [stableKey]: {
                ...student,
                externalUserId: baseExternalId,
                attendeeId: tileState.boundAttendeeId || student.attendeeId || null,
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
      setStatus('Error: ' + error.message);
    }
  };

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
              onClick={endExam}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
            >
              試験終了
            </button>
          )}
        </div>
      </div>

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
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button
                onClick={() => setJoinWithCamera((v) => !v)}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
              >
                {joinWithCamera ? 'カメラ: ON' : 'カメラ: OFF'}
              </button>
              <button
                onClick={() => setJoinWithMic((v) => !v)}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
              >
                {joinWithMic ? 'マイク: ON' : 'マイク: OFF'}
              </button>
              <button
                onClick={() => joinSession()}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
              >
                参加して監視開始
              </button>
            </div>
          )}

          {meetingSession && (
            <div className="ml-auto flex items-center gap-2">
              <span className="rounded-md bg-emerald-600/20 px-3 py-2 text-sm font-semibold text-emerald-300">Live</span>
              <button
                onClick={toggleCamera}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
              >
                {isCameraOn ? 'カメラOFF' : 'カメラON'}
              </button>
              <button
                onClick={toggleMute}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
              >
                {isMuted ? 'マイク: OFF' : 'マイク: ON'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Hidden Audio Element for Proctor to hear students */}
      <audio ref={audioRef} className="hidden" />

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Proctor's Local View (Self) */}
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

        <div className="flex-1">
          {/* Grid of Students */}
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
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

      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-900">チャット</h3>
          <select
            value={chatTo}
            onChange={(e) => setChatTo(e.target.value)}
            disabled={!meetingSession}
            className="ml-auto rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 disabled:opacity-50"
          >
            <option value="all">全員へ（一斉送信）</option>
            {studentsList.map((s) => (
              <option key={s.attendeeId} value={s.attendeeId}>
                {s.displayName}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 max-h-[260px] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
          {chatMessages.length === 0 ? (
            <div className="text-xs text-slate-600">メッセージはまだありません。</div>
          ) : (
            <div className="space-y-2">
              {chatMessages.map((m) => {
                const fromLabel = m.fromRole === 'proctor' ? '監督者' : `受験生: ${resolveStudentNameByAttendeeId(m.fromAttendeeId)}`;
                const toLabel =
                  m.type === 'broadcast'
                    ? '全員'
                    : m.toRole === 'proctor'
                      ? '監督者'
                      : `受験生: ${resolveStudentNameByAttendeeId(m.toAttendeeId)}`;
                return (
                  <div key={m.id} className="rounded-md border border-slate-200 bg-white p-2">
                    <div className="flex items-center gap-2 text-[11px] text-slate-600">
                      <span className="font-semibold text-slate-800">{fromLabel}</span>
                      <span>→</span>
                      <span className="font-semibold text-slate-800">{toLabel}</span>
                      <span className="ml-auto">{new Date(m.ts).toLocaleTimeString()}</span>
                    </div>
                    <div className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-900">{m.text}</div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            value={chatDraft}
            onChange={(e) => setChatDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                sendChat();
              }
            }}
            disabled={!meetingSession}
            placeholder={meetingSession ? 'メッセージを入力…' : '会議参加後に利用できます'}
            className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 disabled:opacity-50"
          />
          <button
            onClick={sendChat}
            disabled={!meetingSession || !String(chatDraft || '').trim()}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            送信
          </button>
        </div>

        <p className="mt-2 text-[11px] text-slate-500">受験生同士のチャットは表示されません（監督者⇄受験生のみ）。</p>
      </div>
    </div>
  );
}
