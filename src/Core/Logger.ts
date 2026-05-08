const isDebug = () => process.env.ISERV_DEBUG === "1";

export const createLogger = (prefix: string) => ({
  debug: (msg: string) => {
    if (isDebug()) console.debug(`[IServ:${prefix}] ${msg}`);
  },
  info: (msg: string) => {
    if (isDebug()) console.info(`[IServ:${prefix}] ${msg}`);
  },
  warn: (msg: string) => {
    console.warn(`[IServ:${prefix}] ${msg}`);
  },
  error: (msg: string) => {
    console.error(`[IServ:${prefix}] ${msg}`);
  },
});
