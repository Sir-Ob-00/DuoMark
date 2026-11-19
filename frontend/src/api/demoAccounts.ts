import type { StaffRole } from './types'

export interface DemoAccount {
  id: string
  name: string
  email: string
  password: string
  role: StaffRole
}

export const demoAccounts: DemoAccount[] = [
  {
    id: 'staff-1',
    name: 'Alex Morgan',
    email: 'admin@duomark.test',
    password: 'AdminDemo123!',
    role: 'admin',
  },
  {
    id: 'staff-2',
    name: 'Jordan Lee',
    email: 'lecturer@duomark.test',
    password: 'LecturerDemo123!',
    role: 'lecturer',
  },
]
