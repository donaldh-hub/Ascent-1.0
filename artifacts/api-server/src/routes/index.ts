import { Router, type IRouter } from "express";
import healthRouter from "./health";
import workflowsRouter from "./workflows";
import assetsRouter from "./assets";
import alertsRouter from "./alerts";
import dashboardRouter from "./dashboard";
import analyticsRouter from "./analytics";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(workflowsRouter);
router.use(assetsRouter);
router.use(alertsRouter);
router.use(analyticsRouter);

export default router;
