import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // This project currently deploys Neon Realtime on the production branch.
  // Keep local development and the stable Vercel app origin allowed. Avoid
  // wildcard Vercel preview origins because previews use isolated branches.
  preview: {
    realtime: {
      allowedOrigins: ["http://localhost:3000", "https://monid-enrich.vercel.app"],
    },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
