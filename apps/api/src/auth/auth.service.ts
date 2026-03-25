import bcrypt from "bcryptjs";
import type { Admin, PrismaClient } from "@prisma/client";

export class AuthService {
  constructor(private readonly prisma: PrismaClient) {}

  async validateCredentials(
    email: string,
    password: string,
  ): Promise<Admin | null> {
    const admin = await this.prisma.admin.findUnique({ where: { email } });
    if (!admin) {
      return null;
    }

    const isValid = await bcrypt.compare(password, admin.passwordHash);
    if (!isValid) {
      return null;
    }

    return admin;
  }

  async getAdminById(adminId: string): Promise<Admin | null> {
    return this.prisma.admin.findUnique({ where: { id: adminId } });
  }
}
