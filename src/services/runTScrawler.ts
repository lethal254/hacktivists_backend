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
   logger: winston.Logger
  private currentSuiteRun: TestSuiteRun | null = null
  public testRuns: Map<string, TestRun> = new Map()
   readonly screenshotDir: string = path.join(process.cwd(), 'testResults', 'screenshots');
   readonly logsDir: string = path.join(process.cwd(), 'testResults', 'logs');
   responseCache = new Map<string, any>();
  public screenshotQueue: Array<{page: Page, testCaseId: string}> = [];

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

   public async ensureDirectoriesExist(): Promise<void> {
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

    try {
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
          const pageUrl = page.url()
          if (pageUrl !== assertion.expectedValue) {
            throw new Error(
              `URL mismatch. Expected: ${assertion.expectedValue}, Found: ${pageUrl}`
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

        case "httpStatus":
          const response = await page.waitForResponse(
            response => response.url().includes(assertion.expectedValue!)
          );
          const status = response.status();
          const statusText = response.statusText();
          
          this.logger.info('HTTP Response', {
            status,
            statusText,
            url: response.url(),
            headers: response.headers()
          });
        
          await this.captureScreenshot(page, `http-status-${status}`);
          
          const expectedStatuses = assertion.expectedStatuses || [200];
          if (!expectedStatuses.includes(status)) {
            const responseBody = await response.text();
            throw new Error(
              `Unexpected HTTP status: ${status} ${statusText}\n` +
              `URL: ${response.url()}\n` +
              `Response: ${responseBody.substring(0, 500)}...`
            );
          }
          break;

        case "formValidation":
          await page.waitForSelector(selector, { state: 'visible' });
          const errorMessages = await page.$$eval(
            selector,
            elements => elements.map(el => el.textContent)
          );
          
          if (assertion.expectedValue) {
            const hasExpectedError = errorMessages.some(
              msg => msg?.includes(assertion.expectedValue!)
            );
            if (!hasExpectedError) {
              await this.captureScreenshot(page, `form-validation-error`);
              throw new Error(`Expected validation message not found: ${assertion.expectedValue}`);
            }
          }
          break;

        case "apiResponse":
          const apiResponse = await page.waitForResponse(
            response => response.url().includes(assertion.apiEndpoint!)
          );
          const responseData = await apiResponse.json();
          
          if (assertion.expectedValue && 
              JSON.stringify(responseData) !== assertion.expectedValue) {
            await this.captureScreenshot(page, `api-response-mismatch`);
            throw new Error('API response does not match expected value');
          }
          break;

        case "elementCount":
          const elements = await page.$$(selector);
          const count = elements.length;
          
          if (count !== Number(assertion.expectedValue)) {
            await this.captureScreenshot(page, `element-count-mismatch`);
            throw new Error(
              `Expected ${assertion.expectedValue} elements, found ${count}`
            );
          }
          break;

        case "networkRequest":
          const networkRequest = await page.waitForRequest(
            request => request.url().includes(assertion.expectedValue!)
          );
          
          if (assertion.method && networkRequest.method() !== assertion.method) {
            await this.captureScreenshot(page, `network-request-method-mismatch`);
            throw new Error(
              `Expected ${assertion.method} request, got ${networkRequest.method()}`
            );
          }
          break;

        case "performanceMetric":
          const metric = await page.evaluate(() => ({
            loadTime: performance.timing.loadEventEnd - performance.timing.navigationStart,
            domContentLoaded: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart
          }));
          
          if (metric.loadTime > Number(assertion.expectedValue)) {
            await this.captureScreenshot(page, `performance-metric-exceeded`);
            throw new Error(`Page load time exceeded threshold: ${metric.loadTime}ms`);
          }
          break;

        case "accessibility":
          const accessibilityReport = await page.accessibility.snapshot();
          if (!accessibilityReport) {
            await this.captureScreenshot(page, `accessibility-violation`);
            throw new Error('Accessibility check failed');
          }
          break;

        default:
          throw new Error(
            `Unsupported assertion type: ${assertion.assertionType}`
          );
      }

      if (assertion.captureScreenshot) {
        await this.captureScreenshot(
          page, 
          `success-${assertion.assertionType}-${Date.now()}`
        );
      }

    } catch (error) {
      await this.captureScreenshot(
        page,
        `failed-${assertion.assertionType}-${Date.now()}`
      );
      throw error;
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

  private clearCache(): void {
    this.responseCache.clear();
    this.testRuns.clear();
    this.screenshotQueue = [];
  }

  async cleanup(): Promise<void> {
    try {
      await this.processScreenshotQueue();
      this.clearCache();
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
    } catch (error) {
      this.logger.error("Error during cleanup", { error });
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

  public async saveTestLogs(testRun: TestRun): Promise<void> {
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
      try {
        if (!this.browser) {
          await this.initialize();
        }
  
        const concurrencyLimit = 4; 
        const suiteRuns = await Promise.all(
          testSuites.map(async (suite) => {
            const context = await this.browser!.newContext();
            const suiteRun = await this.runTestSuite(suite);
            await context.close();
            return suiteRun;
          })
        );
  
        return suiteRuns;
    } catch (error) {
      this.logger.error("Error running test suites", { error });
      throw error;
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

  public async getResponseDetails(response: any) {
    const url = response.url();
    if (this.responseCache.has(url)) {
      return this.responseCache.get(url);
    }

    const details = {
      status: response.status(),
      statusText: response.statusText(),
      url,
      headers: response.headers(),
      body: await response.text().catch(() => 'Unable to get response body'),
      timing: response.timing()
    };

    this.responseCache.set(url, details);
    return details;
  }

  private async cleanupTestRun(page: Page): Promise<void> {
    try {
      await page.close();
    } catch (error) {
      this.logger.error("Error closing page", { error });
    }
  }

  public async processScreenshotQueue(): Promise<void> {
    while (this.screenshotQueue.length > 0) {
      const batch = this.screenshotQueue.splice(0, 5);
      await Promise.all(
        batch.map(({page, testCaseId}) => 
          this.captureScreenshot(page, testCaseId)
        )
      );
    }
  }

  public async measurePerformance<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    const startTime = Date.now();
    try {
      const result = await operation();
      const duration = Date.now() - startTime;
      this.logger.info(`Operation ${operationName} completed`, { duration });
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Operation ${operationName} failed`, { duration, error });
      throw error;
    }
  }
}
