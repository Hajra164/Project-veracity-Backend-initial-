# ⚡ Project Veracity

> **AI-Powered Code Risk Analysis Platform**  


---

## 📁 Project Structure

```
backend-ml/
├── backend/                  # Node.js REST API
│   ├── src/
│   │   ├── db/               # PostgreSQL connection (Neon)
│   │   ├── middleware/        # Auth, upload middleware
│   │   ├── routes/            # API route handlers
│   │   │   ├── auth.js        # Register, login
│   │   │   ├── projects.js    # Project upload & analysis
│   │   │   ├── chat.js        # Mitigation chatbot
│   │   │   ├── report.js      # PDF / JSON / XML reports
│   │   │   └── admin.js       # Admin & manager routes
│   │   ├── workers/           # ML analysis queue
│   │   └── index.js           # Express app entry point
│   ├── uploads/               # Temp file storage
│   ├── .env                   # Environment variables
│   └── package.json
│
├── ml_service/               # Python FastAPI ML Worker
│   ├── services/
│   │   ├── radon_service.py   # Code metrics extraction
│   │   ├── shap_service.py    # SHAP explainability
│   │   └── chatbot_service.py # Mitigation advice engine
│   ├── models/
│   │   ├── model.pkl          # Trained XGBoost model
│   │   ├── feature_names.json # Feature list
│   │   └── threshold.json     # Classification threshold
│   ├── data/                  # Training datasets (PROMISE)
│   ├── main.py                # FastAPI entry point
│   └── requirements.txt
│

```

---

## 🗄️ Database — Neon PostgreSQL

**7 Tables:**

| Table | Purpose |
|-------|---------|
| `users` | Authentication, roles, tiers |
| `projects` | Uploaded Python files |
| `predictions` | XGBoost risk results |
| `code_metrics` | Radon static metrics |
| `shap_explanations` | SHAP feature importance |
| `mitigation_rules` | Chatbot knowledge base |
| `audit_logs` | Security event tracking |

**Connection:** Neon PostgreSQL (serverless, SSL required)

---

## 🚀 Backend — Node.js + Express

### Prerequisites

- Node.js v20+
- npm

### Installation

```bash
cd backend
npm install
```

### Environment Variables

Create a `.env` file in the `backend/` folder:

```env
PORT=5000
DATABASE_URL=postgresql://user:password@host/db?sslmode=require
JWT_SECRET=your_super_secret_jwt_key
JWT_EXPIRES_IN=7d
ML_WORKER_URL=http://127.0.0.1:8000
NODE_ENV=development
```

### Run

```bash
# Development (auto-restart)
npx nodemon src/index.js

# Production
node src/index.js
```

Server runs at: `http://localhost:5000`

---

## 📡 API Endpoints

### Auth
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/api/auth/register` | Public | Register new user |
| POST | `/api/auth/login` | Public | Login + get JWT token |

### Projects
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/projects` | User+ | List own projects |
| POST | `/api/projects` | User+ | Upload `.py` file + auto-analyze |
| GET | `/api/projects/:id` | User+ | Get single project |
| GET | `/api/projects/:id/results` | User+ | Get prediction + metrics + SHAP |

### Reports
| Method | Endpoint | Tier | Description |
|--------|----------|------|-------------|
| GET | `/api/report/:id/json` | Free + Pro | Download JSON report |
| GET | `/api/report/:id/xml` | Free + Pro | Download XML report |
| GET | `/api/report/:id/pdf` | Pro only | Download PDF report |

### Chat
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/api/chat` | User+ | Get mitigation advice |

### Admin
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/admin/users` | Admin | List all users |
| PATCH | `/api/admin/users/:id/role` | Admin | Change user role |
| PATCH | `/api/admin/users/:id/tier` | Admin | Change user tier |
| PATCH | `/api/admin/users/:id/toggle` | Admin | Activate/deactivate user |
| GET | `/api/admin/projects` | Admin + Manager | List all projects |
| GET | `/api/admin/analytics` | Admin | Platform statistics |
| GET | `/api/admin/audit-logs` | Admin | Security audit trail |

---

## 🔐 Authentication

All protected routes require a JWT token in the header:

```
Authorization: Bearer <token>
```

### Roles & Permissions

| Role | Own Projects | All Projects | PDF Report | Admin Panel |
|------|-------------|-------------|------------|-------------|
| `user` (free) | ✅ | ❌ | ❌ | ❌ |
| `user` (pro) | ✅ | ❌ | ✅ | ❌ |
| `project_manager` | ✅ | ✅ | ✅ | Partial |
| `admin` | ✅ | ✅ | ✅ | ✅ |

---

## 🤖 ML Service — Python FastAPI

### Prerequisites

- Python 3.9+
- pip

### Installation

```bash
cd ml_service
python -m venv venv

# Windows
venv\Scripts\activate

# Mac/Linux
source venv/bin/activate

pip install -r requirements.txt
```

### Run

```bash
uvicorn main:app --host 0.0.0.0 --port 8080 --reload
```

ML Worker runs at: `http://localhost:8080`

---

## 🔬 ML Service Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check + model status |
| GET | `/features` | List of 26 features used |
| POST | `/analyze` | Analyze code string |
| POST | `/analyze-file` | Analyze uploaded `.py` file |
| POST | `/explain` | Explain a single feature |
| POST | `/chat/start` | Start chatbot session |
| POST | `/chat/message` | Send chatbot message |
| POST | `/chat/reset` | Reset chatbot session |
| POST | `/report/json` | Generate JSON report |
| POST | `/report/xml` | Generate XML report |

### Example: Analyze a File

```bash
curl -X POST http://localhost:8000/analyze-file \
  -F "file=@your_code.py"
```

### Example Response

```json
{
  "filename": "your_code.py",
  "risk_level": "Low",
  "bug_probability": 0.053,
  "threshold_used": 0.35,
  "features": { "loc": 4, "v(g)": 1.0, ... },
  "shap_explanation": {
    "top_features": [...],
    "base_value": 1.19
  },
  "mitigation_advice": { ... }
}
```

---

## 🧠 ML Model Details

| Property | Value |
|----------|-------|
| Algorithm | XGBoost Ensemble |
| Features | 26 static code metrics |
| Training Data | PROMISE Repository (NASA datasets) |
| Threshold | 0.35 (optimized) |
| Explainability | SHAP TreeExplainer |
| Metric Extraction | Radon (Python) |

### Features Used

`loc`, `v(g)`, `ev(g)`, `iv(g)`, `n`, `v`, `l`, `d`, `i`, `e`, `b`, `t`,
`locode`, `locomment`, `loblank`, `locodeandcomment`, `uniq_op`, `uniq_opnd`,
`total_op`, `total_opnd`, `branchcount`, `cbo`, `rfc`, `v_density`,
`cyclomatic_loc`, `halstead_difficulty`

---

## 🔄 How It Works

```
User uploads .py file
        ↓
Backend saves to DB (projects table)
        ↓
Backend sends file to ML Worker (FastAPI)
        ↓
ML Worker extracts 26 metrics using Radon
        ↓
XGBoost model predicts bug probability
        ↓
SHAP explains top 5 risk drivers
        ↓
Results saved to DB (predictions, code_metrics, shap_explanations)
        ↓
User downloads report (JSON/XML free, PDF pro)
        ↓
Chatbot gives mitigation advice from DB rules
```

---

## 🧪 Testing with Postman

### 1. Register
```
POST http://localhost:5000/api/auth/register
Body: { "email": "test@test.com", "password": "Test1234" }
```

### 2. Login
```
POST http://localhost:5000/api/auth/login
Body: { "email": "test@test.com", "password": "Test1234" }
```

### 3. Upload Project
```
POST http://localhost:5000/api/projects
Headers: Authorization: Bearer <token>
Body: form-data → project_name (text), file (file, .py)
```

### 4. Get Results
```
GET http://localhost:5000/api/projects/1/results
Headers: Authorization: Bearer <token>
```

### 5. Download Report
```
GET http://localhost:5000/api/report/1/json
Headers: Authorization: Bearer <token>
```

---

## ⚠️ Common Issues

| Error | Fix |
|-------|-----|
| `ECONNREFUSED 5000` | Start backend: `npx nodemon src/index.js` |
| `ECONNREFUSED 8000` | Start ML worker: `uvicorn main:app --port 8080` |
| `Invalid token` | Login again to get a fresh JWT token |
| `Project not found` | Check project belongs to logged-in user |
| `PDF requires Pro` | Update user tier: `UPDATE users SET tier='pro' WHERE user_id=?` |
| SSL warning (Neon) | Add `?sslmode=require` to DATABASE_URL |

---

## 👨‍💻 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js (React) |
| Backend | Node.js + Express |
| ML Worker | Python + FastAPI |
| Database | PostgreSQL (Neon serverless) |
| ML Model | XGBoost + SHAP |
| Metrics | Radon |
| Auth | JWT (jsonwebtoken) |
| PDF | PDFKit |
| File Upload | Multer |

---

## 📄 License

This project is developed as a Final Year Project for academic purposes.  
**University of Punjab, Gujranwala Campus — 2026**

---

*Built with ⚡ by the Veracity Team*
