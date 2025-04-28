import express from "express"
import { json } from "body-parser"
import dotenv from "dotenv"
import cors from "cors"
import helmet from "helmet"
import rateLimit from "express-rate-limit"
import cookieParser from "cookie-parser"
import swaggerUi from "swagger-ui-express"
import swaggerJsDoc from "swagger-jsdoc"
import { crawlerRouter } from "./routes/crawler"
import { setupLogger } from "./utils/logger"
import { Request, Response, NextFunction } from "express"

dotenv.config()

const logger = setupLogger()
const app = express()
const PORT = process.env.PORT || 3001

app.use(helmet())
app.use(cookieParser())

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests from this IP, please try again later.",
})
app.use("/api/", limiter)

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(",") || "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
)

app.use(json({ limit: "50mb" }))

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("X-Frame-Options", "DENY")
  res.setHeader("X-XSS-Protection", "1; mode=block")
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  )
  next()
})

const securitySchemes = {
  bearerAuth: {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  },
}

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Web Testing Engine API",
      version: "1.0.0",
      description: "API for an AI-powered web app testing tool",
      contact: {
        name: "Development Team",
      },
      servers: [
        {
          url: `http://localhost:${PORT}`,
        },
      ],
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
    components: {
      securitySchemes,
      schemas: {
        CrawlRequest: {
          type: "object",
          required: ["url"],
          properties: {
            url: {
              type: "string",
              description: "URL of the website to crawl",
            },
          },
        },
        TestableElement: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description: "Type of the element (form, button, link, etc.)",
            },
            selector: {
              type: "string",
              description: "CSS selector to find the element",
            },
            attributes: {
              type: "object",
              description: "Element attributes",
            },
            innerText: {
              type: "string",
              description: "Text content if applicable",
            },
            location: {
              type: "object",
              properties: {
                x: { type: "number" },
                y: { type: "number" },
                width: { type: "number" },
                height: { type: "number" },
              },
              description: "Position and dimensions on the page",
            },
            screenshot: {
              type: "string",
              description: "Base64 encoded screenshot",
            },
          },
        },
        CrawlResult: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "URL that was crawled",
            },
            title: {
              type: "string",
              description: "Page title",
            },
            elements: {
              type: "array",
              items: {
                $ref: "#/components/schemas/TestableElement",
              },
              description: "Testable elements found on the page",
            },
            screenshot: {
              type: "string",
              description: "Base64 encoded screenshot of the full page",
            },
            timestamp: {
              type: "number",
              description: "Timestamp of when the crawl was performed",
            },
          },
        },
      },
    },
  },
  apis: ["./src/routes/*.ts"],
}

const swaggerDocs = swaggerJsDoc(swaggerOptions)

interface SecureRedirectRequest extends Request {
  secure: boolean
  headers: {
    host?: string | undefined
    [header: string]: any
  }
}

app.use(
  "/api-docs",
  (req: SecureRedirectRequest, res: Response, next: NextFunction): void => {
    if (process.env.NODE_ENV === "production" && !req.secure) {
      return res.redirect(
        301,
        `https://${req.headers.host as string}${req.url}`
      )
    }
    next()
  },
  swaggerUi.serve,
  swaggerUi.setup(swaggerDocs)
)

app.use("/api/crawler", crawlerRouter)

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    version: process.env.npm_package_version || "1.0.0",
    timestamp: new Date().toISOString(),
  })
})

app.use((req, res) => {
  res.status(404).json({ error: "Not found" })
})

app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    logger.error("Unhandled error", { error: err.message, stack: err.stack })
    res.status(500).json({
      error: "Internal server error",
      message:
        process.env.NODE_ENV === "production"
          ? "An unexpected error occurred"
          : err.message,
    })
  }
)

if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    if (req.header("x-forwarded-proto") !== "https") {
      res.redirect(`https://${req.header("host")}${req.url}`)
    } else {
      next()
    }
  })
}

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`)
  logger.info(
    `Swagger documentation available at http://localhost:${PORT}/api-docs`
  )
})

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully")
  process.exit(0)
})

process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down gracefully")
  process.exit(0)
})

export default app
