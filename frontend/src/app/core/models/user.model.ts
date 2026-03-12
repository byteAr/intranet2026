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
}

export interface LoginResponse {
  access_token: string;
  user: User;
}
