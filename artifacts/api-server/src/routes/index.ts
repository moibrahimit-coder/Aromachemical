import { Router, type IRouter } from "express";
import bookRouter from "./book";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(bookRouter);

export default router;
