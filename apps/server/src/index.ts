import express, { type ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import { authRouter } from "./routes/auth.js";
import { invitesRouter } from "./routes/invites.js";
import { roomsRouter } from "./routes/rooms.js";
import { usersRouter } from "./routes/users.js";
import { realtimeRouter } from "./routes/realtime.js";
import { loadUser } from "./middleware/auth.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(loadUser);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});
app.use("/api/auth", authRouter);
app.use("/api/rooms", roomsRouter);
app.use("/api/invites", invitesRouter);
app.use("/api/users", usersRouter);
app.use("/api/realtime", realtimeRouter);

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};
app.use(onError);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
