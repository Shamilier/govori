import type { FastifyInstance } from "fastify";
import { createTenantSchema } from "@/tenants/tenants.schemas.js";
import type { TenantsService } from "@/tenants/tenants.service.js";

type TenantsRoutesDeps = {
  tenantsService: TenantsService;
};

export async function registerTenantsRoutes(
  app: FastifyInstance,
  deps: TenantsRoutesDeps,
): Promise<void> {
  app.get(
    "/api/tenants",
    {
      preHandler: [app.authenticate],
    },
    async (_request, reply) => {
      const data = await deps.tenantsService.list();
      return reply.send(data);
    },
  );

  app.post(
    "/api/tenants",
    {
      preHandler: [app.authenticate, app.verifyCsrf],
    },
    async (request, reply) => {
      const parsed = createTenantSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_PAYLOAD", details: parsed.error.flatten() });
      }

      if (!request.adminId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      const data = await deps.tenantsService.create(request.adminId, parsed.data);
      return reply.code(201).send(data);
    },
  );
}
