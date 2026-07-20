import { redactText } from "./Redaction.js";

const isDebug = () => process.env.ISERV_DEBUG === "1";

const safe = (message: string) => redactText(message);

export const createLogger = (prefix: string) => ({
  debug: (msg: string) => {
    if (isDebug()) console.debug(`[IServ:${prefix}] ${safe(msg)}`);
  },
  info: (msg: string) => {
    if (isDebug()) console.info(`[IServ:${prefix}] ${safe(msg)}`);
  },
  warn: (msg: string) => {
    console.warn(`[IServ:${prefix}] ${safe(msg)}`);
  },
  error: (msg: string) => {
    console.error(`[IServ:${prefix}] ${safe(msg)}`);
  },
});
