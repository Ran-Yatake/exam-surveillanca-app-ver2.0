# Development Guide

This project is structured as a monorepo with a Python backend and a React frontend.

## Prerequisites

*   Python 3.8+
*   Node.js 16+
*   AWS Credentials (configured via AWS CLI or environment variables) for AWS Chime SDK access.

## Project Structure

*   `backend/`: FastAPI application (Python)
*   `frontend/`: React application (Vite)

## Setup & Run

## Setup & Run (Docker Compose)

From the repository root:

```bash
docker compose up --build
```

* Frontend: `http://localhost:5173`
* Backend: `http://localhost:8000`
* MySQL (host access): `127.0.0.1:3307` (container port is 3306)

To stop:

```bash
docker compose down
```

### Backend

1.  Navigate to the backend directory:
    ```bash
    cd backend
    ```
2.  Create a virtual environment (optional but recommended):
    ```bash
    python -m venv venv
    source venv/bin/activate  # On Windows: venv\Scripts\activate
    ```
3.  Install dependencies:
    ```bash
    pip install -r requirements.txt
    ```
4.  Run the server:
    ```bash
    python main.py
    ```
    The API will be available at `http://localhost:8000`.

### Frontend

1.  Navigate to the frontend directory:
    ```bash
    cd frontend
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Run the development server:
    ```bash
    npm run dev
    ```
    The application will be available at `http://localhost:5173`.

## Notes

*   **AWS Chime SDK**: The backend currently contains placeholders for AWS Chime SDK calls. You will need to configure valid AWS credentials and uncomment the boto3 client initialization in `backend/main.py` to connect to real AWS services.
*   **WebRTC**: The frontend includes `amazon-chime-sdk-js` but requires the backend to provision meeting tokens to fully function.
