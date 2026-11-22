import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import { openApiDocument } from "./openapi.js";

/** API docs: the OpenAPI document at /openapi.json, and Swagger UI at /docs to browse and try it. */
export function docsRoutes() {
  const router = Router();
  router.get("/openapi.json", (_req, res) => {
    res.json(openApiDocument);
  });
  router.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: "pusher-messaging API",
      swaggerOptions: { withCredentials: true, persistAuthorization: true },
    }),
  );
  return router;
}
