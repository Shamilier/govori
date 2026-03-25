import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from "@/common/constants.js";
import { loginSchema } from "@/auth/auth.schemas.js";
import type { AuthService } from "@/auth/auth.service.js";
import type { AuditService } from "@/audit/audit.service.js";

type AuthRoutesDeps = {
  authService: AuthService;
  auditService: AuditService;
};

export async function registerAuthRoutes(
  app: FastifyInstance,
  deps: AuthRoutesDeps,
): Promise<void> {
  app.post("/api/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_PAYLOAD", details: parsed.error.flatten() });
    }

    const admin = await deps.authService.validateCredentials(
      parsed.data.email,
      parsed.data.password,
    );
    if (!admin) {
      return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
    }

    const token = await reply.jwtSign(
      { adminId: admin.id, email: admin.email },
      { expiresIn: "7d" },
    );
    const csrfToken = crypto.randomBytes(24).toString("hex");

    reply.setCookie(SESSION_COOKIE_NAME, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7,
    });

    reply.setCookie(CSRF_COOKIE_NAME, csrfToken, {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7,
    });

    await deps.auditService.log({
      adminId: admin.id,
      action: "LOGIN",
      entityType: "admin",
      entityId: admin.id,
    });

    return reply.send({
      id: admin.id,
      email: admin.email,
      csrfToken,
    });
  });

  app.post(
    "/api/auth/logout",
    {
      preHandler: [app.authenticate, app.verifyCsrf],
    },
    async (request, reply) => {
      const adminId = request.adminId;

      reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      reply.clearCookie(CSRF_COOKIE_NAME, { path: "/" });

      if (adminId) {
        await deps.auditService.log({
          adminId,
          action: "LOGOUT",
          entityType: "admin",
          entityId: adminId,
        });
      }

      return reply.send({ ok: true });
    },
  );

  app.get(
    "/api/auth/me",
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      if (!request.adminId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      const admin = await deps.authService.getAdminById(request.adminId);
      if (!admin) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      return reply.send({
        id: admin.id,
        email: admin.email,
      });
    },
  );
}
