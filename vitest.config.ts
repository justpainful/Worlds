import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Services under services/ have their own toolchains and test runners (for
// example the Workers pool for services/sync); the app's suite skips them.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: { exclude: [...configDefaults.exclude, "services/**"] },
  }),
);
