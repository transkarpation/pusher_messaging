import { createApp } from "./app.js";
import { createContainer } from "./container.js";
import { authenticateUpgrade } from "./modules/auth/index.js";

const container = createContainer();
const app = createApp(container);

const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port} (realtime: ${container.realtimeConfig.driver}, attachments: ${container.attachmentStorage})`);
});

container.gateway?.attach(server, {
  authenticate: (req) => authenticateUpgrade(container.auth, req),
  authorize: (user, channel) => container.realtime.authorize(user, channel),
});
