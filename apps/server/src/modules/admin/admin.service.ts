import type { z } from "zod";
import {
  canManageRole,
  manageableRoles,
  type AdminUser,
  type AdminUsersPage,
  type adminUsersQuerySchema,
  type createAdminUserSchema,
  type SessionUser,
  type UpdateAdminUserInput,
} from "@pm/shared";
import { conflict, forbidden, notFound } from "../../shared/errors.js";
import { hashPassword, type AuthService } from "../auth/index.js";
import type { UsersService } from "../users/index.js";

/**
 * The administration page's rules: an admin sees, creates and edits only accounts whose role
 * is below their own (a superadmin: admins and users; an admin: users), and can only give
 * roles below their own. Nobody manages their own account here.
 */
export class AdminService {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  async list(me: SessionUser, { q, page, pageSize, sort, order }: z.infer<typeof adminUsersQuerySchema>): Promise<AdminUsersPage> {
    const { users, total } = await this.users.listAccounts({
      roles: manageableRoles(me.role),
      query: q,
      sort,
      order,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return { users, total, page, pageSize };
  }

  async create(me: SessionUser, input: z.infer<typeof createAdminUserSchema>): Promise<AdminUser> {
    this.assertCanAssign(me, input.role);
    const user = await this.users.createAccount({
      username: input.username.toLowerCase(),
      passwordHash: await hashPassword(input.password),
      name: input.name ?? null,
      role: input.role,
      createdBy: me.id,
    });
    if (!user) throw conflict("Username is already taken");
    return user;
  }

  async update(me: SessionUser, id: number, input: UpdateAdminUserInput): Promise<AdminUser> {
    const target = await this.users.getAccount(id);
    // Accounts the caller can't manage are reported as missing, so their existence doesn't leak.
    if (!target || target.id === me.id || !canManageRole(me.role, target.role)) throw notFound("User not found");
    if (input.role !== undefined) this.assertCanAssign(me, input.role);

    const user = await this.users.updateAccount(id, {
      ...(input.name !== undefined && { name: input.name === "" ? null : input.name }),
      ...(input.role !== undefined && { role: input.role }),
      ...(input.password !== undefined && { passwordHash: await hashPassword(input.password) }),
    });
    if (input.password !== undefined) await this.auth.revokeSessions(id);
    return user;
  }

  private assertCanAssign(me: SessionUser, role: SessionUser["role"]) {
    if (!canManageRole(me.role, role)) throw forbidden(`You can't give the ${role} role`);
  }
}
