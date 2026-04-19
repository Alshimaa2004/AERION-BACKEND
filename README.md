# Air Quality Monitoring Backend

Backend API for air quality monitoring system with dual database support (MongoDB + PostgreSQL).

## Project Structure

```
backend/
├── src/
│   ├── config/
│   │   ├── database.js          # MongoDB connection
│   │   └── postgres.js          # PostgreSQL connection (for air quality data)
│   │
│   ├── models/
│   │   ├── User.js              # User model (MongoDB)
│   │   ├── Alert.js             # Alert model (MongoDB)
│   │   └── Report.js            # Report model (MongoDB)
│   │
│   ├── controllers/
│   │   ├── authController.js    # Authentication logic
│   │   ├── userController.js    # User profile management
│   │   ├── alertController.js   # Alerts CRUD operations
│   │   ├── reportController.js  # Reports CRUD operations
│   │   └── dataController.js    # Air quality data (from PostgreSQL)
│   │
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── userRoutes.js
│   │   ├── alertRoutes.js
│   │   ├── reportRoutes.js
│   │   ├── dataRoutes.js        # Air quality data routes
│   │   └── adminRoutes.js
│   │
│   ├── services/
│   │   ├── excelParser.js       # Excel file parsing
│   │   ├── aqiCalculator.js     # AQI calculations
│   │   ├── locationService.js   # Location determination
│   │   └── notificationService.js
│   │
│   ├── middleware/
│   │   ├── auth.js              # JWT authentication
│   │   └── admin.js             # Admin authorization
│   │
│   └── server.js                # Main Express application
│
├── data/                        # Excel files storage
├── .env
├── package.json
└── README.md
```

## Features

- **Authentication & Authorization**: JWT-based authentication with admin roles
- **User Management**: Profile management and user roles
- **Alert System**: Real-time air quality alerts
- **Reports**: Generate and manage air quality reports
- **Air Quality Data**: Store and retrieve from PostgreSQL
- **Excel Integration**: Parse and import air quality data
- **AQI Calculation**: Calculate Air Quality Index
- **Location Services**: Geographic location handling
- **Notifications**: Send alerts and notifications

## Database Architecture

- **MongoDB**: User data, alerts, reports, and application metadata
- **PostgreSQL**: Air quality measurements and sensor data

## Getting Started

### Prerequisites
- Node.js (v14 or higher)
- MongoDB Atlas account or local MongoDB installation
- PostgreSQL database
- npm or yarn

### Installation

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables in `.env`:
```
PORT=5001
JWT_SECRET=your_jwt_secret_key
MONGODB_URI=your_mongodb_connection_string
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=air_quality_data
POSTGRES_USER=your_postgres_user
POSTGRES_PASSWORD=your_postgres_password
FLASK_API_URL=http://localhost:5000
```

3. Run the server:
```bash
# Production
npm start

# Development
npm run dev
```

## API Endpoints

### Authentication
- POST /api/auth/register - Register new user
- POST /api/auth/login - Login user
- POST /api/auth/logout - Logout user

### Users
- GET /api/users/profile - Get user profile
- PUT /api/users/profile - Update user profile

### Alerts
- GET /api/alerts - Get all alerts
- POST /api/alerts - Create new alert
- GET /api/alerts/:id - Get alert by ID
- PUT /api/alerts/:id - Update alert
- DELETE /api/alerts/:id - Delete alert

### Reports
- GET /api/reports - Get all reports
- POST /api/reports - Create new report
- GET /api/reports/:id - Get report by ID
- PUT /api/reports/:id - Update report
- DELETE /api/reports/:id - Delete report

### Air Quality Data
- GET /api/data - Get air quality data
- GET /api/data/:stationId - Get data by station
- POST /api/data/import - Import data from Excel

### Admin (Protected)
- GET /api/admin/users - Get all users
- GET /api/admin/stations - Manage stations
- POST /api/admin/data/upload - Upload data files

## Technologies Used

- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **MongoDB** - NoSQL database
- **PostgreSQL** - Relational database for time-series data
- **Mongoose** - MongoDB ODM
- **pg** - PostgreSQL client
- **JWT** - Authentication
- **bcrypt** - Password hashing
- **xlsx** - Excel file parsing

## License

ISC
