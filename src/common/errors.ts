import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
@Catch()
export class Errors implements ExceptionFilter {
  catch(error: any, host: ArgumentsHost) {
    const code = error.code ?? error.previous?.code;
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : ["23505", "23514", "23503", "40001", "40P01"].includes(code)
          ? 409
          : 500;
    if (status === 500) new Logger("HTTP").error(error);
    const message =
      error instanceof HttpException
        ? error.getResponse()
        : status === 409
          ? "Data conflict; retry or review the request"
          : "Internal server error";
    host
      .switchToHttp()
      .getResponse()
      .status(status)
      .json({ statusCode: status, error: message });
  }
}
