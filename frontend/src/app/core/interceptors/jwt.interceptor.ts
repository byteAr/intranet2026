import { HttpInterceptorFn } from '@angular/common/http';

export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  // Token is stored in httpOnly cookie — browser sends it automatically.
  // We only need to ensure credentials (cookies) are included in every request.
  req = req.clone({ withCredentials: true });
  return next(req);
};
