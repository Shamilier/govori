import type { FastifyInstance } from "fastify";
import { tenantCrmUpdateSchema } from "@/crm/crm.schemas.js";
import type { CrmService } from "@/crm/crm.service.js";

type CrmRoutesDeps = {
  crmService: CrmService;
};

export async function registerCrmRoutes(
  app: FastifyInstance,
  deps: CrmRoutesDeps,
): Promise<void> {
  app.get(
    "/api/crm/templates",
    {
      preHandler: [app.authenticate],
    },
    async (_request, reply) => {
      return reply.send(deps.crmService.listTemplates());
    },
  );

  app.get(
    "/api/tenants/:tenantId/crm",
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      const params = request.params as { tenantId: string };

      try {
        const data = await deps.crmService.getForTenant(params.tenantId);
        return reply.send(data);
      } catch (error) {
        if (error instanceof Error && error.message === "TENANT_NOT_FOUND") {
          return reply.code(404).send({ error: "TENANT_NOT_FOUND" });
        }
        throw error;
      }
    },
  );

  app.put(
    "/api/tenants/:tenantId/crm",
    {
      preHandler: [app.authenticate, app.verifyCsrf],
    },
    async (request, reply) => {
      const parsed = tenantCrmUpdateSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_PAYLOAD", details: parsed.error.flatten() });
      }

      if (!request.adminId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      const params = request.params as { tenantId: string };
      try {
        const data = await deps.crmService.upsertForTenant(
          request.adminId,
          params.tenantId,
          parsed.data,
        );
        return reply.send(data);
      } catch (error) {
        if (error instanceof Error && error.message === "TENANT_NOT_FOUND") {
          return reply.code(404).send({ error: "TENANT_NOT_FOUND" });
        }
        if (
          error instanceof Error &&
          error.message === "CRM_TEMPLATE_NOT_FOUND"
        ) {
          return reply.code(400).send({ error: "CRM_TEMPLATE_NOT_FOUND" });
        }
        throw error;
      }
    },
  );
}
