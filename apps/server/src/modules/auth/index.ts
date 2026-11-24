/** Public surface of the auth module. */
export { AuthService } from "./auth.service.js";
export { DrizzleSessionsRepository } from "./sessions.repository.js";
export { authRoutes } from "./auth.routes.js";
export {
  SESSION_COOKIE,
  loadUser,
  requireAdmin,
  requireAuth,
  type RequireAuth,
} from "./auth.middleware.js";
export { hashPassword, verifyPassword } from "./password.js";
