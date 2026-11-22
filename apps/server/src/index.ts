import { createApp } from "./app.js";
import { createContainer } from "./container.js";

const app = createApp(createContainer());

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
