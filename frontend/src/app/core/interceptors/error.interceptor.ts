import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const authService = inject(AuthService);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        // Don't redirect on login or logout endpoints
        const url = req.url;
        if (!url.includes('/auth/login') && !url.includes('/auth/logout')) {
          authService.clearSession();
          void router.navigate(['/auth/login'], {
            queryParams: { reason: 'session_expired' },
          });
        }
      }
      return throwError(() => error);
    }),
  );
};
