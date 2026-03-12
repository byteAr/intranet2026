import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        // Token expired or invalid — redirect to login
        localStorage.removeItem('pac_access_token');
        localStorage.removeItem('pac_user');
        void router.navigate(['/auth/login'], {
          queryParams: { reason: 'session_expired' },
        });
      }
      return throwError(() => error);
    }),
  );
};
