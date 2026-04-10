import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse) {
        if (error.status === 401) {
          // Token expired or invalid — redirect to login
          localStorage.removeItem('pac_access_token');
          localStorage.removeItem('pac_user');
          void router.navigate(['/auth/login'], {
            queryParams: { reason: 'session_expired' },
          });
        } else if (
          error.status === 403 &&
          (error.error as { error?: string } | undefined)?.error === 'MUST_CHANGE_PASSWORD'
        ) {
          // First-login password change required
          void router.navigate(['/auth/set-initial-password']);
        }
      }
      return throwError(() => error);
    }),
  );
};
