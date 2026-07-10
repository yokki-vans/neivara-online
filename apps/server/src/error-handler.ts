import type { FastifyError, FastifyInstance } from "fastify";

function clientErrorMessage(statusCode: number): string {
  if (statusCode === 404) return "Ресурс не найден";
  if (statusCode === 413) return "Запрос слишком большой";
  if (statusCode === 429) return "Слишком много запросов";
  return "Некорректный запрос";
}

/**
 * Production responses must not serialize database errors, SQL fragments or
 * implementation details. Full errors remain available in structured logs.
 */
export function installProductionErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, "Unhandled request error");

    const suppliedStatus = error.statusCode;
    const statusCode =
      typeof suppliedStatus === "number" && suppliedStatus >= 400 && suppliedStatus < 500
        ? suppliedStatus
        : 500;

    if (statusCode < 500) {
      return reply.code(statusCode).send({
        error: "request_error",
        message: clientErrorMessage(statusCode),
      });
    }

    return reply.code(500).send({
      error: "internal_error",
      message: "Внутренняя ошибка сервера",
    });
  });
}
