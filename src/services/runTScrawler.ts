import { Browser, chromium, Page } from "playwright"
import winston from "winston"
import path from "path"
import fs from 'fs/promises';
import { mkdir } from 'fs/promises';
import {
  TestCase,
  TestSuite,
  TestRun,
  TestSuiteRun,
  Step,
  Assertion,
  TestStatus,
  Action,
  SelectorType,
  AssertionType,
  TestData,
} from "../interfaces/types"

export class WebCrawler {
  private browser: Browser | null = null
  private logger: winston.Logger
  private currentSuiteRun: TestSuiteRun | null = null
  private testRuns: Map<string, TestRun> = new Map()
  private readonly screenshotDir: string = path.join(process.cwd(), 'testResults', 'screenshots');
  private readonly logsDir: string = path.join(process.cwd(), 'testResults', 'logs');

  constructor() {
    this.logger = winston.createLogger({
      level: "info",
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({ filename: "error.log", level: "error" }),
        new winston.transports.File({ filename: "combined.log" }),
        new winston.transports.Console(),
      ],
    })
  }

   private async ensureDirectoriesExist(): Promise<void> {
    await mkdir(this.screenshotDir, { recursive: true });
    await mkdir(this.logsDir, { recursive: true });
  }

  async initialize(): Promise<void> {
    try {
      this.browser = await chromium.launch({
        headless: true,
      })
      this.logger.info("Browser initialized successfully")
    } catch (error) {
      this.logger.error("Failed to initialize browser", { error })
      throw error
    }
  }

  async runTestSuite(testSuite: TestSuite): Promise<TestSuiteRun> {
    this.currentSuiteRun = {
      id: `testsuite-${Date.now()}`,
      testSuiteId: testSuite.id,
      status: "RUNNING",
      startedAt: new Date().toISOString(),
      completedAt: undefined,
      duration: undefined,
      totalTests: testSuite.testCases.length,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      blockedTests: 0,
      testRuns: [],
      environment: process.env.NODE_ENV || "default",
      runBy: undefined,
      createdAt: new Date().toISOString(),
    }

    try {
      if (!this.browser) {
        await this.initialize()
      }

      for (const testCase of testSuite.testCases) {
        if (await this.canRunTest(testCase)) {
          await this.runTestCase(testCase)
        } else {
          this.recordBlockedTest(testCase)
        }
      }
    } finally {
      if (this.currentSuiteRun) {
        this.currentSuiteRun.completedAt = new Date().toISOString()
      }
      if (this.currentSuiteRun) {
        this.currentSuiteRun.duration = this.calculateDuration(
          this.currentSuiteRun.startedAt,
          this.currentSuiteRun.completedAt ?? new Date().toISOString()
        )
      }
      if (this.currentSuiteRun) {
        this.currentSuiteRun.status = this.determineTestSuiteStatus()
      }
    }

    if (!this.currentSuiteRun) {
      throw new Error("TestSuiteRun is null")
    }
    return this.currentSuiteRun
  }

  private async canRunTest(testCase: TestCase): Promise<boolean> {
    if (!testCase.dependsOn?.length) return true

    for (const dependencyId of testCase.dependsOn) {
      const dependencyRun = this.testRuns.get(dependencyId)
      if (!dependencyRun || dependencyRun.status !== "PASSED") {
        return false
      }
    }
    return true
  }

  private async runTestCase(testCase: TestCase): Promise<void> {
    const testRun: TestRun = {
      id: `testcase-${Date.now()}`,
      testCaseId: testCase.id,
      status: "RUNNING",
      startedAt: new Date().toISOString(),
      completedAt: undefined,
      duration: undefined,
      errorMessage: undefined,
      stackTrace: undefined,
      screenshot: undefined,
      logs: {
        steps: [] as Array<{
          stepId: string
          success: boolean
          error?: string
          timestamp: string
        }>,
        assertions: [] as Array<{
          assertionId: string
          success: boolean
          error?: string
          timestamp: string
        }>,
      },
      metadata: {},
      environment: process.env.NODE_ENV || "default",
      runBy: undefined,
      testSuiteRunId: this.currentSuiteRun?.id || undefined,
      createdAt: new Date().toISOString(),
    }

    let page: Page = await this.browser!.newPage();
    try {

      // Execute steps
      for (const step of testCase.steps) {
        try {
          const testData = testCase.testData || {}
          await this.executeStep(page, step, testData)
          testRun.logs.steps.push({
            stepId: step.id,
            success: true,
            timestamp: new Date().toISOString(),
          })
        } catch (error) {
          testRun.screenshot = await this.captureScreenshot(page, testCase.id)
          ;(testRun.logs?.steps as any[]).push({
            stepId: step.id,
            success: false,
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString(),
          })
          throw error
        }
      }

      // Execute assertions
      let assertionsFailed = false
      for (const assertion of testCase.assertions) {
        try {
          await this.executeAssertion(page, assertion)
          ;(testRun.logs?.assertions as any[]).push({
            assertionId: assertion.id,
            success: true,
            timestamp: new Date().toISOString(),
          })
        } catch (error) {
          assertionsFailed = true
          ;(testRun.logs?.assertions as any[]).push({
            assertionId: assertion.id,
            success: false,
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString(),
          })
        }
      }

      await page.close()

      testRun.status = assertionsFailed ? "FAILED" : "PASSED"
      this.updateSuiteRunStats(testRun.status)
    } catch (error) {
      testRun.status = "FAILED";
      testRun.errorMessage = error instanceof Error ? error.message : String(error);
      testRun.stackTrace = error instanceof Error ? error.stack : undefined;
      testRun.screenshot = await this.captureScreenshot(page, testCase.id);
      await this.saveTestLogs(testRun);
      this.updateSuiteRunStats("FAILED");
    } finally {
      testRun.completedAt = new Date().toISOString()
      testRun.duration = this.calculateDuration(
        testRun.startedAt,
        testRun.completedAt
      )
      await this.saveTestLogs(testRun)
    }

    this.testRuns.set(testCase.id, testRun)
    this.currentSuiteRun!.testRuns.push(testRun)
  }

  private async executeStep(
    page: Page,
    step: Step,
    testData: TestData
  ): Promise<void> {
    const selector = step.selector ? this.buildSelector(step.selector) : ""

    // Get test data value if it exists
    const value = step.value || this.getValueFromTestData(step)

    console.log(step, "********")

    switch (step.action) {
      case "navigate":
        const url = value || page.url()
        await page.goto(url)
        break

      case "click":
        await page.click(selector)
        break

      case "type":
        if (!value) {
          throw new Error(
            `No value provided for type action in step ${step.id}`
          )
        }
        await page.fill(selector, value)
        break

      case "select":
        if (!value) {
          throw new Error(
            `No value provided for select action in step ${step.id}`
          )
        }
        await page.selectOption(selector, value)
        break

      case "wait":
        const timeout = step.timeout || 5000
        await page.waitForTimeout(timeout)
        break

      default:
        throw new Error(`Unsupported action: ${step.action}`)
    }

    // Wait for navigation if specified
    if (step.waitForNavigation) {
      await page.waitForLoadState("networkidle")
    }
  }

  private async executeAssertion(
    page: Page,
    assertion: Assertion
  ): Promise<void> {
    const selector = assertion.selector
      ? this.buildSelector(assertion.selector)
      : ""

    switch (assertion.assertionType) {
      case "elementExists":
        await page.waitForSelector(selector, { state: "attached" })
        break

      case "elementVisible":
        await page.waitForSelector(selector, { state: "visible" })
        const element = await page.$(selector)
        if (!element) {
          throw new Error(`Element not found: ${selector}`)
        }

        if (assertion.expectedValue) {
          const text = await element.textContent()
          if (text?.trim() !== assertion.expectedValue.trim()) {
            throw new Error(
              `Text mismatch. Expected: "${assertion.expectedValue}", Found: "${text}"`
            )
          }
        }
        break

      case "urlEquals":
        const currentUrl = page.url()
        if (currentUrl !== assertion.expectedValue) {
          throw new Error(
            `URL mismatch. Expected: ${assertion.expectedValue}, Found: ${currentUrl}`
          )
        }
        break

      case "textContains":
        if (!assertion.expectedValue) {
          throw new Error(
            "Expected value not provided for textContains assertion"
          )
        }
        const content = await page.textContent(selector)
        if (!content?.includes(assertion.expectedValue)) {
          throw new Error(
            `Text does not contain "${assertion.expectedValue}". Found: "${content}"`
          )
        }
        break

      default:
        throw new Error(
          `Unsupported assertion type: ${assertion.assertionType}`
        )
    }
  }

  private getValueFromTestData(step: Step): string | null {
    if (!step.testData) return null

    const testData = step.testData
    if (step.useValidData && testData.valid && testData.valid[step.value!]) {
      return testData.valid[step.value!]
    }

    if (
      !step.useValidData &&
      testData.invalid &&
      testData.invalid[step.value!]
    ) {
      return testData.invalid[step.value!]
    }

    return null
  }

  private buildSelector(selector: {
    type: SelectorType
    value: string
  }): string {
    if (!selector) return ""

    switch (selector.type) {
      case "id":
        return `#${selector.value}`
      case "name":
        return `[name="${selector.value}"]`
      case "css":
        return selector.value
      case "xpath":
        return `xpath=${selector.value}`
      case "linkText":
        return `text=${selector.value}`
      case "className":
        return `.${selector.value}`
      case "tagName":
        return selector.value
      default:
        return selector.value
    }
  }

  private calculateDuration(startTime: string, endTime: string): number {
    return new Date(endTime).getTime() - new Date(startTime).getTime()
  }

  private updateSuiteRunStats(status: TestStatus): void {
    if (!this.currentSuiteRun) return

    switch (status) {
      case "PASSED":
        this.currentSuiteRun.passedTests++
        break
      case "FAILED":
        this.currentSuiteRun.failedTests++
        break
      case "SKIPPED":
        this.currentSuiteRun.skippedTests++
        break
      case "BLOCKED":
        this.currentSuiteRun.blockedTests++
        break
    }
  }

  private determineTestSuiteStatus(): TestStatus {
    if (!this.currentSuiteRun) return "NOT_RUN"

    if (this.currentSuiteRun.failedTests > 0) return "FAILED"
    if (this.currentSuiteRun.passedTests === this.currentSuiteRun.totalTests)
      return "PASSED"
    if (this.currentSuiteRun.blockedTests > 0) return "BLOCKED"
    return "FAILED"
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
    }
  }

  private async captureScreenshot(page: Page, testCaseId: string): Promise<string> {
    try {
      await this.ensureDirectoriesExist();
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `${testCaseId}_${timestamp}.png`;
      const filePath = path.join(this.screenshotDir, fileName);
      
      await page.screenshot({
        path: filePath,
        fullPage: true
      });
      
      const screenshotBuffer = await fs.readFile(filePath);
      const base64Screenshot = screenshotBuffer.toString('base64');
      
      this.logger.info(`Screenshot saved to ${filePath}`);
      return `data:image/png;base64,${base64Screenshot}`;
    } catch (error) {
      this.logger.error('Failed to capture screenshot', { error });
      throw error;
    }
  }

  private async saveTestLogs(testRun: TestRun): Promise<void> {
    try {
      await this.ensureDirectoriesExist();
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `${testRun.testCaseId}_${timestamp}.json`;
      const filePath = path.join(this.logsDir, fileName);
      
      const logData = {
        testCaseId: testRun.testCaseId,
        status: testRun.status,
        startedAt: testRun.startedAt,
        completedAt: testRun.completedAt,
        duration: testRun.duration,
        errorMessage: testRun.errorMessage,
        stackTrace: testRun.stackTrace,
        logs: testRun.logs
      };
      
      await fs.writeFile(filePath, JSON.stringify(logData, null, 2));
      this.logger.info(`Test logs saved to ${filePath}`);
    } catch (error) {
      this.logger.error('Failed to save test logs', { error });
      throw error;
    }
  }

  private recordBlockedTest(testCase: TestCase): void {
    const testRun: TestRun = {
      id: `test-run-${Date.now()}`,
      testCaseId: testCase.id,
      status: "BLOCKED",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      duration: 0,
      environment: process.env.NODE_ENV || "development",
      logs: {
        steps: [],
        assertions: [],
        message: "Test blocked due to failed dependencies",
      },
      createdAt: new Date().toISOString(),
    }

    this.testRuns.set(testCase.id, testRun)
    this.currentSuiteRun!.testRuns.push(testRun)
    this.updateSuiteRunStats("BLOCKED")
  }

  async runAllTestSuites(testSuites: TestSuite[]): Promise<TestSuiteRun[]> {
    const suiteRuns: TestSuiteRun[] = []

    try {
      if (!this.browser) {
        await this.initialize()
      }

      for (const suite of testSuites) {
        this.logger.info(`Starting test suite: ${suite.name}`)
        const suiteRun = await this.runTestSuite(suite)
        suiteRuns.push(suiteRun)
      }

      // Log summary
      const summary = this.getAllSuitesSummary(suiteRuns)
      this.logger.info("All test suites completed", { summary })

      return suiteRuns
    } catch (error) {
      this.logger.error("Error running all test suites", { error })
      throw error
    } finally {
      await this.cleanup()
    }
  }

  async runTestSuiteById(
    testSuites: TestSuite[],
    suiteId: string
  ): Promise<TestSuiteRun> {
    try {
      const suite = testSuites.find((s) => s.id === suiteId)
      if (!suite) {
        throw new Error(`Test suite with ID ${suiteId} not found`)
      }

      this.logger.info(`Running test suite: ${suite.name}`)
      const suiteRun = await this.runTestSuite(suite)

      // Log summary
      const summary = this.getSuiteSummary(suiteRun)
      this.logger.info("Test suite completed", { summary })

      return suiteRun
    } catch (error) {
      this.logger.error(`Error running test suite ${suiteId}`, { error })
      throw error
    }
  }

  public getSuiteSummary(suiteRun: TestSuiteRun) {
    return {
      suiteId: suiteRun.testSuiteId,
      status: suiteRun.status,
      totalTests: suiteRun.totalTests,
      passed: suiteRun.passedTests,
      failed: suiteRun.failedTests,
      blocked: suiteRun.blockedTests,
      skipped: suiteRun.skippedTests,
      duration: suiteRun.duration,
    }
  }

  public getAllSuitesSummary(suiteRuns: TestSuiteRun[]) {
    return {
      totalSuites: suiteRuns.length,
      passedSuites: suiteRuns.filter((s) => s.status === "PASSED").length,
      failedSuites: suiteRuns.filter((s) => s.status === "FAILED").length,
      totalTests: suiteRuns.reduce((sum, suite) => sum + suite.totalTests, 0),
      passedTests: suiteRuns.reduce((sum, suite) => sum + suite.passedTests, 0),
      failedTests: suiteRuns.reduce((sum, suite) => sum + suite.failedTests, 0),
      blockedTests: suiteRuns.reduce(
        (sum, suite) => sum + suite.blockedTests,
        0
      ),
      skippedTests: suiteRuns.reduce(
        (sum, suite) => sum + suite.skippedTests,
        0
      ),
      totalDuration: suiteRuns.reduce(
        (sum, suite) => sum + (suite.duration || 0),
        0
      ),
    }
  }

 
}
