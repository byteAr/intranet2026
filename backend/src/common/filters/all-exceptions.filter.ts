import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

/** Rescata el codigo HTTP de errores estilo http-errors (body-parser, multer). */
function statusDeError(exception: unknown): number | null {
  const candidato = (exception as { status?: unknown; statusCode?: unknown })
    ?.status ?? (exception as { statusCode?: unknown })?.statusCode;
  return typeof candidato === 'number' && candidato >= 400 && candidato <= 599
    ? candidato
    : null;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : // Errores de middleware (body-parser, multer) no son HttpException pero
        // traen su propio status. Sin esto un PayloadTooLargeError se reportaba
        // como 500, y quien llama no puede distinguir "mi request es invalido"
        // de "el servidor esta roto".
        statusDeError(exception) ?? HttpStatus.INTERNAL_SERVER_ERROR;

    const raw =
      exception instanceof HttpException ? exception.getResponse() : null;
    // Para los errores de middleware se devuelve su mensaje real ("request
    // entity too large") en vez de un generico: es lo que ve el mail-bridge
    // en su log y lo que permite diagnosticar sin entrar al servidor.
    const fallback =
      status < 500 && exception instanceof Error
        ? exception.message
        : 'Internal server error';
    const message =
      typeof raw === 'string'
        ? raw
        : (raw as Record<string, unknown>)?.message ?? fallback;

    if (status >= 500) {
      this.logger.error(exception);
    }

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}
