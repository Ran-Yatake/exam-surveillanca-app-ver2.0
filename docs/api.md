# Exam Surveillance API 仕様書（バックエンド）

このドキュメントは、本リポジトリの FastAPI バックエンドが提供する HTTP API を Markdown 形式でまとめたものです。

- API 名: Exam Surveillance API
- 生成日: 2026-02-03
- 参照実装: backend/main.py, backend/app/routers/*.py

---

## 1. ベースURL / プロキシ

- ローカル（直接）: `http://localhost:8000`
- フロントエンド（Vite）経由: `http://localhost:5173/api`（`/api` はバックエンドへリライトされます）

FastAPI の標準機能として以下も利用できます。

- OpenAPI JSON: `GET /openapi.json`
- Swagger UI: `GET /docs`

---

## 2. 認証

### 2.1 Authorization ヘッダ

基本は Cognito の ID トークン（JWT）を Bearer として渡します。

- ヘッダ: `Authorization: Bearer <JWT>`

バックエンド側は、Cognito の JWKS を取得して署名検証します。

### 2.2 開発用の認証バイパス（重要）

環境変数 `COGNITO_USER_POOL_ID` が未設定の場合、認証がバイパスされます（開発・オフライン向け挙動）。

- 未設定時のユーザーは `{"sub":"dev-user","username":"dev-user"}` として扱われます
- 本番運用では必ず Cognito 設定を投入してください

### 2.3 ロール

ユーザーは DB レコード上で `role` を持ちます。

- `proctor`: 監督者
- `examinee`: 受験者

`DEFAULT_PROCTOR_USERS`（カンマ区切りのメール/ユーザー名）に含まれるユーザーは、初回作成時のデフォルトロールが `proctor` になります。

---

## 3. データモデル（主要）

### 3.1 User

- `id`: number
- `email`: string（API上は `username` として返す箇所あり）
- `role`: `"proctor" | "examinee"`
- `user_name`: string | null（API上は `display_name` として返す）
- `class_name`: string | null（受験者のみ使用）
- `created_at`: string(ISO8601) | null
- `updated_at`: string(ISO8601) | null

### 3.2 ScheduledMeeting

- `join_code`: string（受験者が入力する参加コード / ExternalMeetingId としても利用）
- `title`: string | null
- `teacher_name`: string | null
- `scheduled_start_at`: string(ISO8601) | null
- `scheduled_end_at`: string(ISO8601) | null
- `region`: string（例: `us-east-1`）
- `status`: `"scheduled" | "started" | "ended"`
- `chime_meeting_id`: string | null（DB内部。APIレスポンスの MeetingId と関連）

---

## 4. エラーレスポンス

FastAPI の `HTTPException` を利用しています。基本的に以下の形式です。

- JSON: `{"detail": "..."}`

よく出るステータス:

- `400`: 入力不正（必須項目不足、禁止操作など）
- `401`: 未認証/トークン不正
- `403`: 権限不足（proctor 必須等）
- `404`: リソース無し
- `409`: 競合（ユーザー既存、削除不可等）
- `422`: バリデーションエラー（FastAPI/Pydantic）
- `500`: サーバー内部エラー（外部API失敗、設定不足等）

---

## 5. エンドポイント一覧

### 5.1 root

#### GET /

- 認証: 不要
- 概要: ヘルスチェック
- レスポンス例:

```json
{"message":"Exam Surveillance API is running"}
```

---

### 5.2 profile

#### GET /me

- 認証: 必要
- 概要: 自分の `username`（email）と `role` を返す
- レスポンス例:

```json
{"username":"user@example.com","role":"examinee"}
```

#### GET /profile

- 認証: 必要
- 概要: 自分のプロフィール詳細を返す
- レスポンス:
  - `username`: email
  - `role`
  - `display_name`: DBの `user_name`
  - `class_name`

レスポンス例:

```json
{
  "username": "user@example.com",
  "role": "examinee",
  "display_name": "Taro",
  "class_name": "A-1"
}
```

#### POST /profile

- 認証: 必要
- 概要: 自分のプロフィールを登録/更新

リクエストボディ:

```json
{
  "display_name": "Taro",
  "class_name": "A-1"
}
```

バリデーション:

- `display_name` は必須（空文字不可）
- `role == examinee` の場合 `class_name` 必須（空文字不可）
- `role == proctor` の場合 `class_name` は無視され `null` になります

---

### 5.3 users（proctor 専用）

> すべて認証必須かつ `proctor` ロールが必要です。

#### GET /users

- 概要: ユーザー一覧（DB）
- レスポンス: 配列

レスポンス例:

```json
[
  {
    "id": 1,
    "username": "proctor@example.com",
    "role": "proctor",
    "display_name": "Proctor",
    "class_name": null,
    "created_at": "2026-02-03T10:00:00",
    "updated_at": "2026-02-03T10:00:00"
  }
]
```

#### POST /users

- 概要: Cognito にユーザー招待（admin_create_user）し、DBにも upsert

リクエスト:

```json
{ "email": "new-user@example.com", "role": "examinee" }
```

ステータス:

- `409`: 既に Cognito ユーザーが存在
- `500`: `COGNITO_USER_POOL_ID` 未設定など

#### DELETE /users/{email}

- 概要: Cognito と DB からユーザー削除
- 制約:
  - 自分自身は削除不可（`400`）
  - 対象ユーザーが scheduled meeting を作成済みの場合は削除不可（`409`）

レスポンス:

```json
{ "ok": true }
```

#### PATCH /users/{email}

- 概要: ユーザー更新（ロール/クラス）

リクエスト例:

```json
{ "role": "proctor" }
```

```json
{ "class_name": "B-2" }
```

制約:

- 自分自身の `role` 変更は不可（`400`）
- `role == proctor` の場合 `class_name` は強制的に `null`

---

### 5.4 scheduled-meetings

#### POST /scheduled-meetings

- 認証: 必要
- ロール: proctor 必須
- 概要: 予定試験（参加コード）を作成

リクエスト:

```json
{
  "title": "Math Exam",
  "teacher_name": "Yamada",
  "scheduled_start_at": "2026-02-03T12:00:00",
  "scheduled_end_at": "2026-02-03T13:00:00",
  "region": "us-east-1"
}
```

レスポンス（例）:

```json
{
  "join_code": "AB12CD",
  "title": "Math Exam",
  "teacher_name": "Yamada",
  "scheduled_start_at": "2026-02-03T12:00:00",
  "scheduled_end_at": "2026-02-03T13:00:00",
  "region": "us-east-1",
  "status": "scheduled"
}
```

#### GET /scheduled-meetings

- 認証: 必要
- 概要: 予定試験一覧
  - proctor: 自分が作成したもののみ返す
  - examinee: 常に空配列 `[]`

#### POST /scheduled-meetings/{join_code}/start

- 認証: 必要
- ロール: proctor 必須
- 概要: 予定試験を開始（Chime Meeting を作成 or 再利用し、DB を `started` に更新）

レスポンス（例）:

```json
{
  "join_code": "AB12CD",
  "meeting": {
    "Meeting": {
      "MeetingId": "...",
      "MediaRegion": "us-east-1"
    }
  }
}
```

> `meeting` は AWS Chime SDK のレスポンス（パススルー）です。

#### PATCH /scheduled-meetings/{join_code}

- 認証: 必要
- ロール: proctor 必須
- 概要: 予定試験のメタデータ更新（指定されたフィールドのみ）

リクエスト例:

```json
{ "title": "Math Exam (Updated)" }
```

制約:

- `status == ended` の場合は更新不可（`400`）
- 空文字は `null` 扱い

#### DELETE /scheduled-meetings/{join_code}

- 認証: 必要
- ロール: proctor 必須
- 概要: 予定試験を削除

レスポンス:

```json
{ "ok": true }
```

#### POST /scheduled-meetings/{join_code}/recordings/presign

- 認証: 必要
- ロール: proctor 必須
- 概要: 監督者録画（webm想定）の S3 直接アップロード用 Presigned URL を発行

環境変数:

- `RECORDINGS_S3_BUCKET` が必須（未設定は `500`）

リクエスト:

```json
{ "file_name": "session-1.webm", "content_type": "video/webm" }
```

レスポンス:

```json
{
  "bucket": "your-bucket",
  "key": "proctor-recordings/AB12CD/<uuid>-session-1.webm",
  "url": "https://...presigned...",
  "expires_in": 900
}
```

---

### 5.5 meetings（AWS Chime Meeting/Attendee）

> すべて認証必須です。

#### POST /meetings

- 認証: 必要
- 概要: Chime Meeting の作成または取得

リクエスト:

```json
{ "external_meeting_id": "AB12CD", "region": "us-east-1" }
```

挙動（重要）:

- `external_meeting_id` が `scheduled_meetings.join_code` と一致する場合:
  - proctor かつ作成者本人: 未終了なら開始（DBを `started`）し Meeting を返す
  - その他（受験者等）: `status == started` のときのみ参加可能（未開始は `403`）
- 一致しない場合（未スケジュールのレガシー挙動）:
  - インメモリの `active_meetings` キャッシュを見て再利用を試みる
  - 必要に応じて `create_meeting` を実行

レスポンス:

- AWS Chime SDK の `create_meeting` / `get_meeting` 相当レスポンス（パススルー）

エラー:

- `400`: `external_meeting_id` 空
- `403`: 予定試験が未開始
- `400`: 予定試験が終了済み

#### POST /meetings/{meeting_id}/attendees

- 認証: 必要
- 概要: Chime Attendee 作成

リクエスト:

```json
{ "external_user_id": "user@example.com" }
```

レスポンス:

- AWS Chime SDK の `create_attendee` レスポンス（パススルー）

---

## 6. 代表的な呼び出し例（curl）

### 6.1 ヘルスチェック

```bash
curl -s http://localhost:8000/
```

### 6.2 認証付きで自分の情報

```bash
curl -s \
  -H "Authorization: Bearer $JWT" \
  http://localhost:8000/me
```

### 6.3 予定試験作成（proctor）

```bash
curl -s \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"title":"Math","region":"us-east-1"}' \
  http://localhost:8000/scheduled-meetings
```

### 6.4 予定試験開始（proctor）

```bash
curl -s \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{}' \
  http://localhost:8000/scheduled-meetings/AB12CD/start
```

---

## 7. 設定（環境変数）メモ

認証/外部サービス連携のため、少なくとも以下を使用します。

- Cognito
  - `COGNITO_USER_POOL_ID`
  - `COGNITO_APP_CLIENT_ID`
  - `COGNITO_REGION`（任意。未設定なら UserPoolId から推定）
- AWS
  - `AWS_DEFAULT_REGION`（Chime/S3 クライアントで利用）
  - AWS 資格情報（`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` 等、実行環境により）
- 録画
  - `RECORDINGS_S3_BUCKET`
- DB
  - `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`
  - または `DATABASE_URL`

