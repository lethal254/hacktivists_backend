import express from "express"
import { Builder } from "selenium-webdriver"
import chrome from "selenium-webdriver/chrome"

const router = express.Router()

type CrawlerResponse = {
  success: boolean
  elementCount: number
  elements: Array<{
    tag: string
    attributes: Array<{ name: string; value: string }>
    text: string
  }>
  error?: string
}

router.post<{}, CrawlerResponse>("/analyzewebsite", async (req, res) => {
  const options = new chrome.Options()
  options.addArguments("--headless")
  options.addArguments("--disable-gpu")
  options.addArguments("--no-sandbox")
  options.addArguments("--disable-dev-shm-usage")

  const driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(options)
    .build()

  try {
    await driver.get(req.body.websiteUrl)
    const allElements = (await driver.executeScript(() => {
      const elements = Array.from(document.querySelectorAll("*"))
      return elements.map((el) => ({
        tag: el.tagName,
        attributes: Array.from(el.attributes).map((attr) => ({
          name: attr.name,
          value: attr.value,
        })),
        text: el.textContent?.trim().slice(0, 100) || "",
      }))
    })) as Array<{
      tag: string
      attributes: Array<{ name: string; value: string }>
      text: string
    }>

    console.log("Total elements found:", allElements.length)
    res.json({
      success: true,
      elementCount: allElements.length,
      elements: allElements,
    })
  } catch (error) {
    console.error("Analysis error:", error)
    res.status(500).json({
      success: false,
      elementCount: 0,
      elements: [],
      error: "There was an error running our analysis",
    })
  } finally {
    await driver.quit()
  }
})

export default router
