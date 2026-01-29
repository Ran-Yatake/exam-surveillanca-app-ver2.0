const API_BASE = '/api';

let authToken = null;

export function setAuthToken(token) {
  authToken = token || null;
}

export function clearAuthToken() {
  authToken = null;
}

function buildAuthHeaders() {
  const headers = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  return headers;
}

async function parseErrorDetail(res) {
  let detail = '';
  try {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      detail = data?.detail ? ` - ${data.detail}` : '';
    } else {
      const text = await res.text();
      detail = text ? ` - ${text}` : '';
    }
  } catch (_) {
    // ignore parse errors
  }
  return detail;
}

export async function callApi(endpoint, body) {
  const headers = {
    'Content-Type': 'application/json',
    ...buildAuthHeaders(),
  };

  if (!headers.Authorization) {
    console.warn(`[callApi] Warning: No authToken available for request to ${endpoint}`);
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await parseErrorDetail(res);
    if (res.status === 401) throw new Error(`Unauthorized: Please sign in again.${detail}`);
    throw new Error(`API Error: ${res.status}${detail}`);
  }

  return res.json();
}

export async function callApiPatch(endpoint, body) {
  const headers = {
    'Content-Type': 'application/json',
    ...buildAuthHeaders(),
  };

  if (!headers.Authorization) {
    console.warn(`[callApiPatch] Warning: No authToken available for request to ${endpoint}`);
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await parseErrorDetail(res);
    if (res.status === 401) throw new Error(`Unauthorized: Please sign in again.${detail}`);
    throw new Error(`API Error: ${res.status}${detail}`);
  }

  return res.json();
}

export async function callApiGet(endpoint) {
  const headers = {
    ...buildAuthHeaders(),
  };

  if (!headers.Authorization) {
    console.warn(`[callApiGet] Warning: No authToken available for request to ${endpoint}`);
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    const detail = await parseErrorDetail(res);
    if (res.status === 401) throw new Error(`Unauthorized: Please sign in again.${detail}`);
    throw new Error(`API Error: ${res.status}${detail}`);
  }

  return res.json();
}

export async function callApiDelete(endpoint) {
  const headers = {
    ...buildAuthHeaders(),
  };

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'DELETE',
    headers,
  });

  if (!res.ok) {
    const detail = await parseErrorDetail(res);
    if (res.status === 401) throw new Error(`Unauthorized: Please sign in again.${detail}`);
    throw new Error(`API Error: ${res.status}${detail}`);
  }

  return res.json().catch(() => ({}));
}

// ---- Endpoints ----
export async function fetchMe() {
  return callApiGet('/me');
}

export async function createMeeting(meetingId) {
  return callApi('/meetings', { external_meeting_id: meetingId });
}

export async function createAttendee(meetingId, userId) {
  return callApi(`/meetings/${meetingId}/attendees`, { external_user_id: userId });
}

export async function createScheduledMeeting(body) {
  return callApi('/scheduled-meetings', body);
}

export async function listScheduledMeetings() {
  return callApiGet('/scheduled-meetings');
}

export async function startScheduledMeeting(joinCode) {
  return callApi(`/scheduled-meetings/${joinCode}/start`, {});
}

export async function deleteScheduledMeeting(joinCode) {
  return callApiDelete(`/scheduled-meetings/${joinCode}`);
}

export async function updateScheduledMeeting(joinCode, body) {
  return callApiPatch(`/scheduled-meetings/${joinCode}`, body);
}

export async function presignProctorRecordingUpload(joinCode, body) {
  return callApi(`/scheduled-meetings/${joinCode}/recordings/presign`, body);
}

export async function fetchProfile() {
  return callApiGet('/profile');
}

export async function upsertProfile(body) {
  return callApi('/profile', body);
}

export async function listUsers() {
  return callApiGet('/users');
}

export async function inviteUser(body) {
  return callApi('/users', body);
}

export async function deleteUser(email) {
  const encoded = encodeURIComponent(String(email || '').trim());
  return callApiDelete(`/users/${encoded}`);
}

export async function updateUser(email, body) {
  const encoded = encodeURIComponent(String(email || '').trim());
  return callApiPatch(`/users/${encoded}`, body);
}
