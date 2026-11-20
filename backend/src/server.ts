import "dotenv/config";
import { app } from "./app.js";
import { createDevelopmentInbox } from "./integrations/invitation-mail.js";

const port = Number(process.env.PORT ?? 5000);
if (process.env.MAIL_TRANSPORT === "development-inbox") {
  const inboxPort = Number(process.env.DEV_MAIL_INBOX_PORT ?? 8025);
  createDevelopmentInbox().listen(inboxPort, "127.0.0.1", () => console.log(`Development mail inbox: http://localhost:${inboxPort}`));
}

app.listen(port, () => {
  console.log(`DuoMark API running at http://localhost:${port}`);
});
