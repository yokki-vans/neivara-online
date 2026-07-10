import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { installProductionErrorHandler } from "./error-handler.js";

describe("production error responses", () => {
  it("logs but does not expose internal error messages", async () => {
    const app = Fastify({ logger: false });
    installProductionErrorHandler(app);
    app.get("/boom", async () => {
      throw new Error("password authentication failed for postgres://internal-db");
    });

    const response = await app.inject({ method: "GET", url: "/boom" });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: "internal_error",
      message: "Внутренняя ошибка сервера",
    });
    expect(response.body).not.toContain("postgres");
    expect(response.body).not.toContain("internal-db");
    await app.close();
  });
});
