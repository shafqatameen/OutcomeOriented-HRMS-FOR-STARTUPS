# OutcomeOriented

A gamified point system with leaderboard, tasks, and goals tracking.

## Overview

OutcomeOriented is a web application designed to gamify productivity through a point-based system. Users can set goals, complete tasks, and climb leaderboards while earning points based on their achievements.

## Tech Stack

### Frontend

- **Framework**: Next.js 16 with React 19
- **Styling**: Tailwind CSS v4 with shadcn/ui components
- **Components**: Built with @base-ui/react for accessible components
- **Charts**: Recharts for data visualization
- **Icons**: Lucide React for icons
- **TypeScript**: Full type safety throughout

### Backend

- **Framework**: FastAPI
- **Database**: SQLite (gamified.db, pointsystem.db)
- **ORM**: SQLAlchemy 2.0
- **Validation**: Pydantic 2.x
- **Security**: bcrypt + PyJWT for authentication
- **Testing**: Python standard library

## Architecture

```
frontend/
├── src/
│   ├── lib/              # Shared utilities and API calls
│   ├── components/       # UI components organized by purpose
│   │   ├── ui/          # Atomic design system
│   │   ├── forms/       # Form components
│   │   ├── modals/      # Modal dialogs
│   │   ├── feedback/    # Feedback components
│   │   ├── dashboard/   # Dashboard components
│   │   └── tables/      # Table components
│   ├── app/             # Route pages
│   └── globals.css      # Global styles
└── package.json

backend/
├── app/
│   ├── core/          # Infrastructure layer
│   │   ├── base.py
│   │   ├── database.py
│   │   └── migrations.py
│   └── modules/        # Feature modules
│       ├── auth/       # Authentication
│       ├── goals/      # Goals management
│       ├── leaderboard/ # Leaderboard
│       ├── tasks/      # Task management
│       └── users/      # User management
└── requirements.txt
└── main.py
```

## Features

### Points System
- **Core Points**: Earned through goal progress and milestone completion
- **Adjacent Points**: Earned through daily recurring tasks
- **Categories**: Different point types with customizable values

### Gamification Elements
- **Leaderboards**: Real-time point rankings
- **Progress Tracking**: Goal and milestone progress
- **Badges**: Achievement recognition
- **Performance Analytics**: Historical data and trends

### Administration
- **Task Assignment**: Bulk task assignment to users
- **Goal Management**: Create and manage goals with milestones
- **Category Management**: Define point categories
- **User Management**: User administration

## Running the Application

### Prerequisites

- Node.js 18+
- Python 3.8+
- SQLite (built-in)

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
# Visit http://localhost:3000
```

### Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

## Project Structure

### Core Modules

#### Auth Module
- User authentication and session management
- Login/logout functionality
- JWT-based token authentication

#### Goals Module
- Goal creation and management
- Milestone tracking
- Progress calculation

#### Tasks Module
- Task assignment and management
- Recurring task support
- Milestone-based task dependencies

#### Users Module
- User management
- Role-based access control
- User profile management

#### Leaderboard Module
- Point ranking system
- Historical performance tracking
- Leaderboard visualization

### Infrastructure

#### Core Layer
- Database connection and configuration
- Base models and schemas
- Migration management

## Components Architecture

### Atomic Components (ui/)
- **Badge**: Status indicators and labels
- **Button**: Interactive buttons with variants
- **Card**: Content containers with headers
- **Dialog**: Modal dialogs
- **Input**: Form input fields
- **Table**: Data display tables

### Form Components (forms/)
- **DataForm**: Generic form component
- Reusable form structures for CRUD operations

### Modal Components (modals/)
- **ConfirmModal**: Confirmation dialogs
- Reusable modal patterns for destructive actions

### Feedback Components (feedback/)
- **LoadingSpinner**: Loading indicators
- Async operation feedback

### Dashboard Components (dashboard/)
- **StatsDashboard**: Key metrics display
- Widget-based dashboard layout

### Table Components (tables/)
- **DataTable**: Advanced data tables
- Search, sort, and pagination

## API Endpoints

### Public Endpoints
- `/auth/login` - User authentication
- `/auth/logout` - User logout
- `/auth/me` - Get current user
- `/auth/login-options` - Get login options

### Data Endpoints
- `GET /leaderboard` - Get leaderboard data
- `GET /tasks` - Get user tasks
- `GET /categories` - Get point categories
- `GET /users` - Get users
- `GET /goals` - Get goals
- `GET /milestones` - Get milestones
- `GET /chart-data` - Get chart data

### Modification Endpoints
- `POST /tasks` - Create task
- `POST /categories` - Create category
- `POST /goals` - Create goal
- `POST /milestones` - Create milestone
- `PATCH /tasks/{id}/complete` - Complete task
- `PATCH /milestones/{id}` - Complete milestone
- `PATCH /categories/{id}` - Update category

## Development

### Component Development

New components should follow this pattern:

1. Create a new directory in `components/` with a clear purpose
2. Implement atomic components in `components/ui/` first
3. Build composite components using atomic components
4. Write TypeScript interfaces for all props
5. Include comprehensive JSDoc comments

### API Development

Backend development follows:

1. Use FastAPI for API creation
2. Create separate modules for each feature
3. Implement SQLAlchemy models for data entities
4. Use Pydantic schemas for validation
5. Write comprehensive error handling

### Testing

While full test coverage isn't implemented, manual testing should cover:

1. Component rendering and props
2. Form submission flows
3. API integration scenarios
4. User interactions

## Performance

### Frontend Optimization
- Server-side rendering for critical pages
- Code splitting for components
- Optimized asset loading

### Backend Optimization
- Indexed SQLite database
- Connection pooling
- Efficient query patterns

## Accessibility

The application follows accessibility best practices:

- ARIA labels and roles
- Keyboard navigation support
- Screen reader compatibility
- High contrast support

## Themes

### Light Theme
- Clean, modern interface
- Blue/primary color scheme
- White background

### Dark Theme
- Eye-friendly dark interface
- Darker grays and blues
- High contrast

## Legal

- **MIT License**
- **Open Source**

## Contributing

1. Fork the repository
2. Create a feature branch
3. Implement changes
4. Test thoroughly
5. Submit a pull request

## Support

For issues and support, please open an issue in the repository.
