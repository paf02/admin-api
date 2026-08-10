# PuraTech Store - API 🔌

Cloudflare Workers-based REST API for PuraTech Store inventory and sales management.

## 🚀 Live API

**Production:** https://puratech-store-api.puratechtest01.workers.dev

## 🛠️ Tech Stack

- **Runtime:** Cloudflare Workers (V8)
- **Framework:** Hono
- **Database:** Cloudflare D1 (SQLite)
- **Storage:** Cloudflare R2 (for images - optional)
- **Deployment:** Wrangler CLI
- **CI/CD:** GitHub Actions

## 📦 Features

- ✅ **Authentication API** - Login, verify, logout endpoints
- 👤 **User Management** - Encrypted passwords (SHA-256)
- 📦 **Products API** - Full CRUD operations
- 🏷️ **Categories API** - Product categorization
- 🔖 **Brands API** - Brand management
- 💰 **Sales API** - POS transactions, stock updates
- 📊 **Dashboard API** - Analytics and statistics
- 🔒 **JWT-like Tokens** - Session management (24h expiry)
- 🌐 **CORS Enabled** - Cross-origin requests allowed

## 🏃 Quick Start

### Prerequisites

- Node.js 22+
- Wrangler CLI
- Cloudflare account

### Local Development

```bash
# Install dependencies
npm install

# Login to Cloudflare
wrangler login

# Start local dev server
npm run dev
```

API runs at: http://localhost:8787

### Deploy to Cloudflare

```bash
npm run deploy
```

## 🗄️ Database Setup

### Create D1 Database

```bash
wrangler d1 create puratech-store-db
```

Update `wrangler.toml` with the database ID.

### Run Migrations

```bash
# Create tables
wrangler d1 execute puratech-store-db --remote --file=../database/schema.sql

# Seed initial data
wrangler d1 execute puratech-store-db --remote --file=../database/seed.sql

# Add users table
wrangler d1 execute puratech-store-db --remote --file=../database/migration-add-users.sql

# Seed admin user
wrangler d1 execute puratech-store-db --remote --file=../database/seed-users.sql
```

## 📡 API Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/login` | User login |
| `GET` | `/api/auth/verify` | Verify token |
| `POST` | `/api/auth/logout` | User logout |

### Products

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/productos` | Get all products |
| `GET` | `/api/productos/:id` | Get product by ID |
| `POST` | `/api/productos` | Create product |
| `PUT` | `/api/productos/:id` | Update product |
| `DELETE` | `/api/productos/:id` | Delete product |
| `GET` | `/api/productos/stock/bajo` | Get low stock products |

### Categories

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/categorias` | Get all categories |
| `POST` | `/api/categorias` | Create category |
| `PUT` | `/api/categorias/:id` | Update category |
| `DELETE` | `/api/categorias/:id` | Delete category |

### Brands

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/marcas` | Get all brands |
| `POST` | `/api/marcas` | Create brand |
| `PUT` | `/api/marcas/:id` | Update brand |
| `DELETE` | `/api/marcas/:id` | Delete brand |

### Sales

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/ventas` | Get all sales |
| `GET` | `/api/ventas/hoy` | Get today's sales |
| `GET` | `/api/ventas/:id` | Get sale details |
| `POST` | `/api/ventas` | Create sale |
| `PUT` | `/api/ventas/:id/estado` | Update sale status |

### Dashboard

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/dashboard/stats` | Get dashboard stats |
| `GET` | `/api/dashboard/ventas-mensuales` | Monthly sales data |
| `GET` | `/api/dashboard/ventas-recientes` | Recent sales |
| `GET` | `/api/dashboard/productos-populares` | Best-selling products |

## 📁 Project Structure

```
src/
├── index.ts              # Main worker entry point
├── routes/               # API route handlers
│   ├── auth.ts          # Authentication routes
│   ├── productos.ts     # Products CRUD
│   ├── categorias.ts    # Categories CRUD
│   ├── marcas.ts        # Brands CRUD
│   ├── ventas.ts        # Sales/POS routes
│   └── dashboard.ts     # Analytics routes
└── utils/               # Utility functions
    └── crypto.ts        # Password hashing & tokens
```

## 🔐 Authentication Flow

### Login

```bash
POST /api/auth/login
Content-Type: application/json

{
  "username": "josedavid",
  "password": "sUU222s&"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "eyJ1c2VySWQiOjEsInVzZXJuYW1lIjoi...",
    "user": {
      "userId": 1,
      "username": "josedavid",
      "fullName": "José David",
      "role": "admin"
    }
  }
}
```

### Verify Token

```bash
GET /api/auth/verify
Authorization: Bearer YOUR_TOKEN_HERE
```

### Making Authenticated Requests

```bash
GET /api/productos
Authorization: Bearer YOUR_TOKEN_HERE
```

## 🗃️ Database Schema

### Tables

- **Users** - User accounts with encrypted passwords
- **Productos** - Product inventory
- **Categorias** - Product categories
- **Marcas** - Product brands
- **Ventas** - Sales transactions
- **DetalleVenta** - Sale line items

See `../database/schema.sql` for full schema.

## 🔧 Configuration

### wrangler.toml

```toml
name = "puratech-store-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "puratech-store-db"
database_id = "83353a6a-1b91-47b2-a463-274d5ef9f270"

[vars]
ALLOWED_ORIGINS = "*"
```

## 🚀 Deployment

### Manual Deployment

```bash
npx wrangler deploy
```

### Automatic Deployment (CI/CD)

Push to `main` branch triggers automatic deployment via GitHub Actions.

**Required GitHub Secrets:**
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

See [CICD_SETUP.md](../CICD_SETUP.md) for detailed setup.

## 🧪 Testing API

### Health Check

```bash
curl https://puratech-store-api.puratechtest01.workers.dev/
```

### Get Products

```bash
curl https://puratech-store-api.puratechtest01.workers.dev/api/productos
```

### Login

```bash
curl -X POST https://puratech-store-api.puratechtest01.workers.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"josedavid","password":"sUU222s&"}'
```

## 📊 Database Queries

### Query D1 Database

```bash
# List products
wrangler d1 execute puratech-store-db --remote \
  --command="SELECT * FROM Productos LIMIT 5"

# Get sales stats
wrangler d1 execute puratech-store-db --remote \
  --command="SELECT COUNT(*) as total FROM Ventas"
```

## 🔒 Security

- **Password Hashing:** SHA-256
- **Token Expiration:** 24 hours
- **CORS:** Configurable in `wrangler.toml`
- **SQL Injection:** Protected via prepared statements
- **Input Validation:** Required fields validated

## 🐛 Troubleshooting

### Build Errors
- Ensure Node.js 22+ is installed
- Run `npm install --legacy-peer-deps` if peer dependency issues

### Database Connection
- Verify `database_id` in `wrangler.toml`
- Check D1 database exists in Cloudflare dashboard

### Deployment Fails
- Check Wrangler authentication: `wrangler whoami`
- Verify API token permissions

## 📝 Development

### Available Scripts

```bash
npm run dev      # Start local dev server
npm run deploy   # Deploy to Cloudflare
npm run tail     # View live logs
```

### Add New Route

1. Create route file in `src/routes/`
2. Import and register in `src/index.ts`
3. Deploy changes

## 🤝 Contributing

1. Create feature branch
2. Make changes
3. Push to GitHub
4. Create Pull Request

## 📚 Resources

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Hono Framework](https://hono.dev/)
- [D1 Database](https://developers.cloudflare.com/d1/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

## 📄 License

Private - PuraTech Store

---

**For CI/CD setup and deployment guide, see:** [CICD_SETUP.md](../CICD_SETUP.md)
