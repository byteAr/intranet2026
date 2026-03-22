export interface User {
  id: string;
  username: string;
  email: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  roles: string[];
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
  recoveryEmail?: string;
  avatar?: string;
  upn?: string;
  title?: string;
  department?: string;
  company?: string;
  phone?: string;
  mobile?: string;
  office?: string;
  manager?: string;
  employeeId?: string;
}

export interface LoginResponse {
  access_token: string;
  user: User;
}
