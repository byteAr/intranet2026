import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap } from 'rxjs/operators';
import { Observable } from 'rxjs';
import { User, LoginResponse } from '../models/user.model';

const TOKEN_KEY = 'pac_access_token';
const USER_KEY = 'pac_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly _token = signal<string | null>(
    localStorage.getItem(TOKEN_KEY),
  );
  private readonly _user = signal<User | null>(
    this.loadUser(),
  );

  readonly isAuthenticated = computed(() => !!this._token());
  readonly currentUser = computed(() => this._user());

  login(username: string, password: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>('/api/auth/login', { username, password })
      .pipe(
        tap((res) => {
          localStorage.setItem(TOKEN_KEY, res.access_token);
          localStorage.setItem(USER_KEY, JSON.stringify(res.user));
          this._token.set(res.access_token);
          this._user.set(res.user);
        }),
      );
  }

  private readonly _logoutCallbacks = new Set<() => void>();

  /** Register a callback to be called synchronously before logout clears state. */
  onBeforeLogout(cb: () => void): void {
    this._logoutCallbacks.add(cb);
  }

  logout(): void {
    this._logoutCallbacks.forEach((cb) => cb());
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this._token.set(null);
    this._user.set(null);
    void this.router.navigate(['/auth/login']);
  }

  getToken(): string | null {
    return this._token();
  }

  hasRole(role: string): boolean {
    return this._user()?.roles.includes(role) ?? false;
  }

  forgotPassword(username: string): Observable<{ message: string; email: string }> {
    return this.http.post<{ message: string; email: string }>('/api/auth/forgot-password', { username });
  }

  verifyOtp(username: string, otp: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>('/api/auth/verify-otp', { username, otp });
  }

  resetPassword(username: string, otp: string, newPassword: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>('/api/auth/reset-password', { username, otp, newPassword });
  }

  changePassword(currentPassword: string, newPassword: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>('/api/auth/change-password', { currentPassword, newPassword });
  }

  updateProfile(data: { recoveryEmail?: string; avatar?: string }): Observable<User> {
    return this.http.patch<User>('/api/users/me', data).pipe(
      tap((user) => {
        const updated = { ...this._user(), ...user } as User;
        localStorage.setItem(USER_KEY, JSON.stringify(updated));
        this._user.set(updated);
      }),
    );
  }

  private loadUser(): User | null {
    try {
      const stored = localStorage.getItem(USER_KEY);
      return stored ? (JSON.parse(stored) as User) : null;
    } catch {
      return null;
    }
  }
}
