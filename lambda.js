import ServerlessHttp from "serverless-http";
import app from "./app.js";
import { ConnectDB } from "./config/db.js";

await ConnectDB();

export const handler = ServerlessHttp(app);
