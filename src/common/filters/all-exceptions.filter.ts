import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppLogger } from '../services/app-logger.service';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLogger) {
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<any>();
    const request = ctx.getRequest<any>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | object = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'object') {
        // If response is an object, preserve nested fields (e.g. zod validation messages/errors)
        const resObj = res as any;
        message = resObj.message || resObj;
        error = resObj.error || exception.name;
      } else {
        message = res;
        error = exception.name;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Handle Prisma Client errors
      switch (exception.code) {
        case 'P2002': // Unique constraint violation
          status = HttpStatus.CONFLICT;
          const target = (exception.meta?.target as string[]) || [];
          message = `Unique constraint failed on field(s): ${target.join(', ') || 'unknown'}`;
          error = 'Conflict';
          break;
        case 'P2025': // Record not found
          status = HttpStatus.NOT_FOUND;
          message = 'Record not found';
          error = 'Not Found';
          break;
        case 'P2003': // Foreign key constraint violation
          status = HttpStatus.BAD_REQUEST;
          const field = (exception.meta?.field_name as string) || 'unknown';
          message = `Foreign key constraint failed on field(s): ${field}`;
          error = 'Bad Request';
          break;
        default:
          status = HttpStatus.INTERNAL_SERVER_ERROR;
          message = 'Database operation failed';
          error = 'Database Error';
          break;
      }
    } else if (exception instanceof Error) {
      // Handle standard error
      message = exception.message;
      error = exception.name;
    }

    // Build standardized error payload
    const errorResponse = {
      statusCode: status,
      error,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    // Log the error using the dynamic Context-Aware Logger
    const logMessage = `${request.method} ${request.url} - Status: ${status} - Error: ${typeof message === 'object' ? JSON.stringify(message) : message}`;
    if (status >= 500) {
      this.logger.error(logMessage, exception instanceof Error ? exception.stack : undefined);
    } else {
      this.logger.warn(logMessage);
    }

    // Send using Fastify reply
    response.status(status).send(errorResponse);
  }
}
