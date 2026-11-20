[Live frontend/backend integration map, verification and blockers](frontend/INTEGRATION.md)

multimodal-biometric-attendance/
├── README.md
├── .gitignore
│
├── frontend/                         # React + TypeScript
│   ├── package.json
│   ├── package-lock.json
│   ├── .env.example
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── public/
│   └── src/
│       ├── main.tsx
│       ├── app/
│       │   ├── router.tsx
│       │   └── auth/
│       ├── layouts/
│       ├── components/       # Shared forms, tables, and status messages
│       ├── features/
│       │   ├── auth/                 # Staff sign-in
│       │   ├── admin/        # Students, staff, courses, classes, terminals
│       │   ├── enrollment/       # Face and fingerprint enrollment screens
│       │   ├── lecturer/             # Session controls and live attendance
│       │   ├── terminal/             # Student check-in prompts and results
│       │   └── reports/            # Attendance history and export controls
│       ├── api/                      # Express API client
│       └── styles/
│
├── backend/                          # Node.js + Express + TypeScript
│   ├── package.json
│   ├── package-lock.json
│   ├── .env.example
│   ├── tsconfig.json
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.ts                   # Fictional development records
│   ├── src/
│   │   ├── app.ts                    # Express application setup
│   │   ├── server.ts                 # Starts the API
│   │   ├── config/
│   │   ├── db/                       # Prisma client
│   │   ├── middleware/        # Authentication, permissions, error handling
│   │   └── modules/
│   │       ├── auth/
│   │       ├── users/
│   │       ├── students/
│   │       ├── courses/
│   │       ├── classes/     # Class sections, lecturer assignments, rosters
│   │       ├── terminals/
│   │       ├── enrollments/      # Consent and biometric enrollment status
│   │       ├── sessions/             # Open and close attendance sessions
│   │       ├── verification/   # Apply the face + fingerprint decision rule
│   │       ├── attendance/           # Save and retrieve attendance records
│   │       ├── reports/
│   │       └── audit/
│   └── tests/
│       ├── unit/
│       └── integration/
│
├── biometric-terminal/               # Local service that works with the devices
│   ├── README.md
│   ├── .env.example
│   ├── requirements.txt
│   ├── biometric_terminal/
│   │   ├── __init__.py
│   │   ├── __main__.py               # Starts the Python terminal service
│   │   ├── config.py
│   │   ├── api_client.py             # Communicates with Express
│   │   ├── workflows/
│   │   │   ├── enrollment.py
│   │   │   └── check_in.py
│   │   ├── face/                     # Webcam capture, embeddings, candidate matching
│   │   ├── fingerprint/              # Scanner interface and vendor SDK adapter
│   │   └── simulation/               # Fictional face and fingerprint outcomes
│   └── tests/
│
├── docs/
│   ├── requirements.md              # System Requirements Specification
│   ├── architecture.md
│   ├── api-contract.md               # Requests and responses between components
│   ├── database-design.md
│   └── testing-and-evaluation.md
│
└── local-data/                       # Local-only files, excluded from Git
    ├── models/
    ├── logs/
    └── exports/
