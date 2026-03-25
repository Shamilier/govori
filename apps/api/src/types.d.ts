import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    adminId?: string;
  }

  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: import("fastify").FastifyReply,
    ) => Promise<void>;
    verifyCsrf: (
      request: FastifyRequest,
      reply: import("fastify").FastifyReply,
    ) => Promise<void>;
  }
}
