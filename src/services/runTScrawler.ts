import { Browser, chromium, Page } from 'playwright';
import winston from 'winston';
import path from 'path';
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
  AssertionType
} from '../interfaces/types';

export class WebCrawler {
  private browser: Browser | null = null;
  private logger: winston.Logger;
  private currentSuiteRun: TestSuiteRun | null = null;
  private testRuns: Map<string, TestRun> = new Map();

  constructor() {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
        new winston.transports.Console()
      ]
    });
  }

  async initialize(): Promise<void> {
    try {
      this.browser = await chromium.launch({
        headless: true
      });
      this.logger.info('Browser initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize browser', { error });
      throw error;
    }
  }

  async runTestSuite(testSuite: TestSuite): Promise<TestSuiteRun> {
    this.currentSuiteRun = {
      id: `testsuite-${Date.now()}`,
      testSuiteId: testSuite.id,
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      completedAt: undefined,
      duration: undefined,
      totalTests: testSuite.testCases.length,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      blockedTests: 0,
      testRuns: [],
      environment: process.env.NODE_ENV || 'default',
      runBy: undefined,
      createdAt: new Date().toISOString()
    };

    try {
      if (!this.browser) {
        await this.initialize();
      }

      for (const testCase of testSuite.testCases) {
        if (await this.canRunTest(testCase)) {
          await this.runTestCase(testCase);
        } else {
          this.recordBlockedTest(testCase);
        }
      }
    } finally {
      if (this.currentSuiteRun) {
        this.currentSuiteRun.completedAt = new Date().toISOString();
      }
      if (this.currentSuiteRun) {
        this.currentSuiteRun.duration = this.calculateDuration(
          this.currentSuiteRun.startedAt,
          this.currentSuiteRun.completedAt ?? new Date().toISOString()
        );
      }
      if (this.currentSuiteRun) {
        this.currentSuiteRun.status = this.determineTestSuiteStatus();
      }
    }

    if (!this.currentSuiteRun) {
      throw new Error('TestSuiteRun is null');
    }
    return this.currentSuiteRun;
  }

  private async canRunTest(testCase: TestCase): Promise<boolean> {
    if (!testCase.dependsOn?.length) return true;

    for (const dependencyId of testCase.dependsOn) {
      const dependencyRun = this.testRuns.get(dependencyId);
      if (!dependencyRun || dependencyRun.status !== 'PASSED') {
        return false;
      }
    }
    return true;
  }

  private async runTestCase(testCase: TestCase): Promise<void> {
    const testRun: TestRun = {
      id: `testcase-${Date.now()}`,
      testCaseId: testCase.id,
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      completedAt: undefined,
      duration: undefined,
      errorMessage: undefined,
      stackTrace: undefined,
      screenshot: undefined,
      logs: {
        steps: [] as Array<{ stepId: string; success: boolean; error?: string; timestamp: string }>,
        assertions: [] as Array<{ assertionId: string; success: boolean; error?: string; timestamp: string }>
      },
      metadata: {},
      environment: process.env.NODE_ENV || 'default',
      runBy: undefined,
      testSuiteRunId: this.currentSuiteRun?.id || undefined,
      createdAt: new Date().toISOString()
    };

    try {
      const page = await this.browser!.newPage();
      
      // Execute steps
      for (const step of testCase.steps) {
        try {
          await this.executeStep(page, step);
          testRun.logs.steps.push({
            stepId: step.id,
            success: true,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          testRun.screenshot = await this.captureScreenshot(page);
          (testRun.logs?.steps as any[]).push({
            stepId: step.id,
            success: false,
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          });
          throw error;
        }
      }

      // Execute assertions
      let assertionsFailed = false;
      for (const assertion of testCase.assertions) {
        try {
          await this.executeAssertion(page, assertion);
          (testRun.logs?.assertions as any[]).push({
            assertionId: assertion.id,
            success: true,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          assertionsFailed = true;
          (testRun.logs?.assertions as any[]).push({
            assertionId: assertion.id,
            success: false,
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          });
        }
      }

      await page.close();
      
      testRun.status = assertionsFailed ? 'FAILED' : 'PASSED';
      this.updateSuiteRunStats(testRun.status);

    } catch (error) {
      testRun.status = 'FAILED';
      testRun.errorMessage = error instanceof Error ? error.message : String(error);
      testRun.stackTrace = error instanceof Error ? error.stack : undefined;
      this.updateSuiteRunStats('FAILED');
    } finally {
      testRun.completedAt = new Date().toISOString();
      testRun.duration = this.calculateDuration(testRun.startedAt, testRun.completedAt);
    }

    this.testRuns.set(testCase.id, testRun);
    this.currentSuiteRun!.testRuns.push(testRun);
  }

  private async executeStep(page: Page, step: Step): Promise<void> {
    const selector = this.buildSelector(step.selector);
    
    switch (step.action) {
      case 'navigate':
        await page.goto(step.value!);
        break;
      case 'click':
        await page.click(selector);
        break;
      case 'type':
        await page.fill(selector, step.value!);
        break;
      case 'wait':
        await page.waitForTimeout(step.timeout || 5000);
        break;
      default:
        throw new Error(`Unsupported action: ${step.action}`);
    }
  }

  private async executeAssertion(page: Page, assertion: Assertion): Promise<void> {
    if (assertion.selector) {
      const selector = this.buildSelector(assertion.selector);
      
      switch (assertion.assertionType) {
        case 'elementExists':
          await page.waitForSelector(selector);
          break;
        case 'elementVisible':
          await page.waitForSelector(selector, { state: 'visible' });
          break;
        case 'textEquals':
          const content = await page.textContent(selector);
          if (content !== assertion.expectedValue) {
            throw new Error(`Text mismatch. Expected: ${assertion.expectedValue}, Found: ${content}`);
          }
          break;
      }
    }
  }

  private buildSelector(selector: { type: SelectorType; value: string }): string {
    switch (selector.type) {
      case 'id':
        return `#${selector.value}`;
      case 'css':
        return selector.value;
      case 'xpath':
        return `xpath=${selector.value}`;
      default:
        return selector.value;
    }
  }

  private calculateDuration(startTime: string, endTime: string): number {
    return new Date(endTime).getTime() - new Date(startTime).getTime();
  }

  private updateSuiteRunStats(status: TestStatus): void {
    if (!this.currentSuiteRun) return;

    switch (status) {
      case 'PASSED':
        this.currentSuiteRun.passedTests++;
        break;
      case 'FAILED':
        this.currentSuiteRun.failedTests++;
        break;
      case 'SKIPPED':
        this.currentSuiteRun.skippedTests++;
        break;
      case 'BLOCKED':
        this.currentSuiteRun.blockedTests++;
        break;
    }
  }

  private determineTestSuiteStatus(): TestStatus {
    if (!this.currentSuiteRun) return 'NOT_RUN';
    
    if (this.currentSuiteRun.failedTests > 0) return 'FAILED';
    if (this.currentSuiteRun.passedTests === this.currentSuiteRun.totalTests) return 'PASSED';
    if (this.currentSuiteRun.blockedTests > 0) return 'BLOCKED';
    return 'FAILED';
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  private async captureScreenshot(page: Page): Promise<string> {
    const screenshotBuffer = await page.screenshot();
    const screenshot = screenshotBuffer.toString('base64');
    return `data:image/png;base64,${screenshot}`;
  }

  private recordBlockedTest(testCase: TestCase): void {
    const testRun: TestRun = {
      id: `test-run-${Date.now()}`,
      testCaseId: testCase.id,
      status: 'BLOCKED',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      duration: 0,
      environment: process.env.NODE_ENV || 'development',
      logs: {
        steps: [],
        assertions: [],
        message: 'Test blocked due to failed dependencies'
      },
      createdAt: new Date().toISOString()
    };

    this.testRuns.set(testCase.id, testRun);
    this.currentSuiteRun!.testRuns.push(testRun);
    this.updateSuiteRunStats('BLOCKED');
  }


  async runAllTestSuites(testSuites: TestSuite[]): Promise<TestSuiteRun[]> {
    const suiteRuns: TestSuiteRun[] = [];
    
    try {
      if (!this.browser) {
        await this.initialize();
      }

      for (const suite of testSuites) {
        this.logger.info(`Starting test suite: ${suite.name}`);
        const suiteRun = await this.runTestSuite(suite);
        suiteRuns.push(suiteRun);
      }

      // Log summary 
      const summary = this.getAllSuitesSummary(suiteRuns);
      this.logger.info('All test suites completed', { summary });

      return suiteRuns;

    } catch (error) {
      this.logger.error('Error running all test suites', { error });
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  
  async runTestSuiteById(testSuites: TestSuite[], suiteId: string): Promise<TestSuiteRun> {
    try {
      const suite = testSuites.find(s => s.id === suiteId);
      if (!suite) {
        throw new Error(`Test suite with ID ${suiteId} not found`);
      }

      this.logger.info(`Running test suite: ${suite.name}`);
      const suiteRun = await this.runTestSuite(suite);
      
      // Log summary
      const summary = this.getSuiteSummary(suiteRun);
      this.logger.info('Test suite completed', { summary });

      return suiteRun;

    } catch (error) {
      this.logger.error(`Error running test suite ${suiteId}`, { error });
      throw error;
    }
  }

  private getSuiteSummary(suiteRun: TestSuiteRun) {
    return {
      suiteId: suiteRun.testSuiteId,
      status: suiteRun.status,
      totalTests: suiteRun.totalTests,
      passed: suiteRun.passedTests,
      failed: suiteRun.failedTests,
      blocked: suiteRun.blockedTests,
      skipped: suiteRun.skippedTests,
      duration: suiteRun.duration
    };
  }

  private getAllSuitesSummary(suiteRuns: TestSuiteRun[]) {
    return {
      totalSuites: suiteRuns.length,
      passedSuites: suiteRuns.filter(s => s.status === 'PASSED').length,
      failedSuites: suiteRuns.filter(s => s.status === 'FAILED').length,
      totalTests: suiteRuns.reduce((sum, suite) => sum + suite.totalTests, 0),
      passedTests: suiteRuns.reduce((sum, suite) => sum + suite.passedTests, 0),
      failedTests: suiteRuns.reduce((sum, suite) => sum + suite.failedTests, 0),
      blockedTests: suiteRuns.reduce((sum, suite) => sum + suite.blockedTests, 0),
      skippedTests: suiteRuns.reduce((sum, suite) => sum + suite.skippedTests, 0),
      totalDuration: suiteRuns.reduce((sum, suite) => sum + (suite.duration || 0), 0)
    };
  }
}