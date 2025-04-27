import express from "express"

import MessageResponse from "../interfaces/MessageResponse"
import emojis from "./emojis"
import crawler from "./crawler"

const router = express.Router()

router.get<{}, MessageResponse>("/", (req, res) => {
  res.json({
    message: "API - 👋🌎🌍🌏",
  })
})

router.use("/emojis", emojis)
router.use("/crawler", crawler)

export default router
