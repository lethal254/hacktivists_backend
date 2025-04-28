import express from "express"

import MessageResponse from "../interfaces/MessageResponse"
import emojis from "./emojis"
import crawler from "./crawler"
import testRunnerRoutes from "../routes/runTsRoutes"

const router = express.Router()

router.get<{}, MessageResponse>("/", (req, res) => {
  res.json({
    message: "API - 👋🌎🌍🌏",
  })
})

router.use("/emojis", emojis)
router.use("/crawler", crawler)
router.use("/api/test-runner", testRunnerRoutes)

export default router
