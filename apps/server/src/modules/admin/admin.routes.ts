import { Router, type RequestHandler } from "express";
import { adminUsersQuerySchema, createAdminUserSchema, updateAdminUserSchema } from "@pm/shared";
import { idParam, parse } from "../../shared/http.js";
import type { AdminService } from "./admin.service.js";

/** /api/admin: managing accounts below one's own role (admins and superadmins only). */
export function adminRoutes(admin: AdminService, requireAdmin: RequestHandler) {
  const router = Router();
  router.use(requireAdmin);

  /** GET /api/admin/users?q=…&page=…&pageSize=…&sort=…&order=… — a page of the accounts the caller manages. */
  router.get("/users", async (req, res) => {
    res.json(await admin.list(req.user!, parse(adminUsersQuerySchema, req.query)));
  });

  router.post("/users", async (req, res) => {
    res.status(201).json(await admin.create(req.user!, parse(createAdminUserSchema, req.body)));
  });

  router.patch("/users/:id", async (req, res) => {
    const id = idParam(req.params.id, "Invalid user id");
    res.json(await admin.update(req.user!, id, parse(updateAdminUserSchema, req.body)));
  });

  return router;
}
