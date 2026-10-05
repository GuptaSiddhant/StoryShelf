import { libConfig } from "../../config/tsdown.ts";

export default libConfig({
  index: "./src/index.ts",
  smtp: "./src/smtp.ts",
  mailpit: "./src/mailpit.ts",
  log: "./src/log.ts",
  http: "./src/http.ts",
  email: "./src/email.ts",
});
