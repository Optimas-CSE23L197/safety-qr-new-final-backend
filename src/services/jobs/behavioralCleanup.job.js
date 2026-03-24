// src/services/jobs/behavioralCleanup.job.js
import cron from "node-cron";
import { behavioralCleanup } from "../../middleware/behavioralSecurity.middleware.js";
import { logger } from "../../config/logger.js";

// Run every hour
cron.schedule("0 * * * *", async () => {
  try {
    const result = await behavioralCleanup();
    logger.info(result, "Behavioral cleanup completed");
  } catch (err) {
    logger.error({ err: err.message }, "Behavioral cleanup failed");
  }
});
