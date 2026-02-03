import React, { useEffect, useRef, useState } from 'react';
import {
  ConsoleLogger,
  DefaultDeviceController,
  DefaultMeetingSession,
  LogLevel,
  MeetingSessionConfiguration,
} from 'amazon-chime-sdk-js';

import { createAttendee, createMeeting, fetchProfile } from '../api/client.js';
import ChatPanel from '../components/chat/ChatPanel.jsx';
import ExamineeChatMessage from '../components/chat/messages/ExamineeChatMessage.jsx';

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

export default function ExamineeView({
  currentUsername,
  onBack,
  makeExternalUserIdWithFallback,
  extractDisplayName,
}) {
  const [meetingSession, setMeetingSession] = useState(null);
  const [status, setStatus] = useState('Idle');
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isMicReady, setIsMicReady] = useState(false);
  const [joinWithCamera, setJoinWithCamera] = useState(true);
  const [joinWithMic, setJoinWithMic] = useState(true);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [proctorExternalUserId, setProctorExternalUserId] = useState('');
  const [proctorAttendeeId, setProctorAttendeeId] = useState('');
  const [meetingJoinId, setMeetingJoinId] = useState(''); // external meeting id input by student
  const [chatMessages, setChatMessages] = useState([]);
  const [chatDraft, setChatDraft] = useState('');
  const chatSeenIdsRef = useRef(new Set());
  const chatEndRef = useRef(null);
  const videoRef = useRef(null);
  const prejoinStreamRef = useRef(null);
  const screenRef = useRef(null); // Local preview of screen share
  const screenShareStreamRef = useRef(null);
  const proctorVideoRef = useRef(null); // Remote Proctor View
  const audioRef = useRef(null); // Meeting Audio Output
  const observerRef = useRef(null);

  const myAttendeeId = meetingSession?.configuration?.credentials?.attendeeId || '';
  const showMicOffBadge = meetingSession ? isMuted : !joinWithMic;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [chatMessages.length]);

  useEffect(() => {
    if (!meetingSession?.audioVideo) return;

    const onDataMessage = (dataMessage) => {
      const rawText = dataMessage?.text?.();
      const payload = safeJsonParse(rawText);
      if (!payload || typeof payload.text !== 'string') return;

      const id = String(payload.id || '');
      if (!id) return;

      // Allowed for examinee to display:
      // - proctor broadcast
      // - proctor direct to me
      const isFromProctor = payload.fromRole === 'proctor';
      if (!isFromProctor) return;

      // Best-effort: prevent spoofed "proctor" messages if we already know the proctor attendeeId.
      const senderAttendeeId = dataMessage?.senderAttendeeId || payload.fromAttendeeId || '';
      if (proctorAttendeeId && senderAttendeeId && senderAttendeeId !== proctorAttendeeId) return;

      const ok =
        payload.type === 'broadcast' ||
        (payload.type === 'direct' && payload.toRole === 'examinee' && payload.toAttendeeId === myAttendeeId);
      if (!ok) return;

      if (chatSeenIdsRef.current.has(id)) return;
      chatSeenIdsRef.current.add(id);

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
  }, [meetingSession, myAttendeeId, proctorAttendeeId]);

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
          // ignore autoplay errors
        }
      }
    } catch (err) {
      console.warn('Failed to start pre-join camera preview', err);
      stopPrejoinPreview();
    }
  };

  const leaveSession = async () => {
    const session = meetingSession;
    if (!session) return;

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
      setMeetingSession(null);
      setStatus('Idle');
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

  const startExam = async () => {
    try {
      const joinId = String(meetingJoinId || '').trim();
      if (!joinId) {
        setStatus('Error: Please enter the Meeting ID.');
        return;
      }
      setStatus('Initializing...');
      const meetingId = joinId;
      const userId = makeExternalUserIdWithFallback('examinee', profile, currentUsername);

      // 1. Create/Get Meeting
      const meetingResponse = await createMeeting(meetingId);

      // 2. Create Attendee
      const attendeeResponse = await createAttendee(meetingResponse.Meeting.MeetingId, userId);

      // 3. Initialize Chime Session
      const logger = new ConsoleLogger('ChimeLogger', LogLevel.INFO);
      const deviceController = new DefaultDeviceController(logger);
      const configuration = new MeetingSessionConfiguration(meetingResponse.Meeting, attendeeResponse.Attendee);

      const session = new DefaultMeetingSession(configuration, logger, deviceController);

      // 4. Select Audio/Video Devices
      const audioInputDevices = await session.audioVideo.listAudioInputDevices();
      const videoInputDevices = await session.audioVideo.listVideoInputDevices();

      let audioInputStarted = false;
      let videoInputStarted = false;

      if (joinWithMic && audioInputDevices.length > 0) {
        await session.audioVideo.startAudioInput(audioInputDevices[0].deviceId);
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
          await session.audioVideo.startVideoInput(videoInputDevices[0].deviceId);
          videoInputStarted = true;
        }
      }

      // 5. Bind Video Tile
      const observer = {
        audioVideoDidStart: () => {
          if (audioRef.current) {
            session.audioVideo.bindAudioElement(audioRef.current);
          }
        },
        videoTileDidUpdate: (tileState) => {
          // Local Camera
          if (tileState.localTile && !tileState.isContent) {
            session.audioVideo.bindVideoElement(tileState.tileId, videoRef.current);
            return;
          }

          // Remote Tiles: Only bind Proctor's video
          if (!tileState.localTile && tileState.boundExternalUserId) {
            const externalId = tileState.boundExternalUserId;
            // Check if it is a proctor
            if (String(externalId).startsWith('proctor:') || String(externalId).startsWith('proctor-')) {
              setProctorExternalUserId(String(externalId));
              if (tileState.boundAttendeeId) setProctorAttendeeId(tileState.boundAttendeeId);
              // Bind to Proctor Video Element
              if (proctorVideoRef.current) {
                session.audioVideo.bindVideoElement(tileState.tileId, proctorVideoRef.current);
              }
            }
            // Ideally we ignore other students' tiles here
          }
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
      setStatus('Error: ' + error.message);
    }
  };

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
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <label className="text-sm font-semibold text-slate-800">ミーティングID</label>
              <input
                value={meetingJoinId}
                onChange={(e) => setMeetingJoinId(e.target.value)}
                placeholder="監督者から共有されたIDを入力"
                className="w-full sm:w-auto sm:min-w-[280px] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
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
                <video ref={proctorVideoRef} className="h-full w-full object-contain" />
                {!meetingSession && <div className="absolute text-sm text-slate-600">Proctor video will appear here</div>}
              </div>
              <div className="absolute left-3 top-3 rounded bg-red-600/70 px-3 py-2 text-xs font-bold text-white">
                PROCTOR (Supervisor)
                {proctorExternalUserId ? `: ${extractDisplayName(proctorExternalUserId)}` : ''}
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            {!meetingSession && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setJoinWithCamera((v) => !v)}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
                >
                  {joinWithCamera ? 'カメラ:ON' : 'カメラ:OFF'}
                </button>
                <button
                  onClick={() => setJoinWithMic((v) => !v)}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
                >
                  {joinWithMic ? 'マイク:ON' : 'マイク:OFF'}
                </button>
                <button
                  onClick={startExam}
                  disabled={status === 'Initializing...'}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  1. 会議に参加
                </button>
              </div>
            )}

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
              <div className="ml-auto flex items-center gap-2">
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
