# 開発ガイド

このプロジェクトは、PythonバックエンドとReactフロントエンドを同一リポジトリで管理するモノレポ構成です。

## 前提条件

- Python 3.8+
- Node.js 16+
- AWS Chime SDK を利用するためのAWS認証情報（AWS CLI または環境変数で設定）

## ディレクトリ構成

- `backend/`: FastAPI アプリケーション（Python）
- `frontend/`: React アプリケーション（Vite）

## セットアップ & 起動

## セットアップ & 起動（Docker Compose）

リポジトリのルートで実行します。

```bash
docker compose up --build
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`
- MySQL（ホストからの接続）: `127.0.0.1:3306`（コンテナ内は 3306）

停止する場合：

```bash
docker compose down
```

### バックエンド（ローカル実行）

1. バックエンドディレクトリへ移動：
   ```bash
   cd backend
   ```
2. 仮想環境を作成（任意ですが推奨）：
   ```bash
   python -m venv venv
   source venv/bin/activate  # Windowsの場合: venv\Scripts\activate
   ```
3. 依存関係をインストール：
   ```bash
   pip install -r requirements.txt
   ```
4. サーバを起動：
   ```bash
   python main.py
   ```
   API は `http://localhost:8000` で利用できます。

### フロントエンド（ローカル実行）

1. フロントエンドディレクトリへ移動：
   ```bash
   cd frontend
   ```
2. 依存関係をインストール：
   ```bash
   npm install
   ```
3. 開発サーバを起動：
   ```bash
   npm run dev
   ```
   アプリは `http://localhost:5173` で利用できます。

## メモ

- **環境変数（重要）**: Docker Compose で起動する場合、バックエンドは `backend/.env` を参照します（Cognito/Chime/AWS設定などが必要です）。
- **AWS Chime SDK**: バックエンドには AWS Chime SDK 呼び出しのための実装が含まれます。実際のAWSサービスに接続するには、正しいAWS認証情報の設定が必要です。
- **WebRTC**: フロントエンドは `amazon-chime-sdk-js` を利用しますが、Meeting/Attendee の発行はバックエンド経由で行います。
