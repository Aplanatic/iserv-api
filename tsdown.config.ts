import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/catalog.ts", "src/redaction.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
});
