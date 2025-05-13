import { Router } from 'express';
import { WebCrawler } from '../services/runTScrawler';
import { TestSuite } from '../interfaces/types';
import fs from 'fs/promises';
import path from 'path';

/**
 * @swagger
 * components:
 *   schemas:
 *     TestRun:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: "testcase-1"
 *         testCaseId:
 *           type: string
 *           example: "tc-001"
 *         status:
 *           type: string
 *           enum: [NOT_RUN, RUNNING, PASSED, FAILED, BLOCKED, SKIPPED]
 *         startedAt:
 *           type: string
 *           format: date-time
 *         completedAt:
 *           type: string
 *           format: date-time
 *         duration:
 *           type: number
 *         logs:
 *           type: object
 *         screenshot:
 *           type: string
 *         environment:
 *           type: string
 *         runBy:
 *           type: string
 *           nullable: true
 *     TestSuiteRun:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: "testsuite-001"
 *         testSuiteId:
 *           type: string
 *           example: "testsuite-001"
 *         status:
 *           type: string
 *           enum: [NOT_RUN, RUNNING, PASSED, FAILED, BLOCKED, SKIPPED]
 *           example: "FAILED"
 *         startedAt:
 *           type: string
 *           format: date-time
 *           example: "2025-04-28T10:00:00.000Z"
 *         completedAt:
 *           type: string
 *           format: date-time
 *           example: "2025-04-28T10:05:00.000Z"
 *         duration:
 *           type: number
 *           example: 300000
 *         totalTests:
 *           type: number
 *           example: 5
 *         passedTests:
 *           type: number
 *           example: 3
 *         failedTests:
 *           type: number
 *           example: 1
 *         skippedTests:
 *           type: number
 *           example: 0
 *         blockedTests:
 *           type: number
 *           example: 1
 *         testRuns:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/TestRun'
 *         environment:
 *           type: string
 *           example: "default"
 *         runBy:
 *           type: string
 *           nullable: true
 *           example: null
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2025-04-28T10:00:00.000Z"
 *     PerformanceMetrics:
 *       type: object
 *       properties:
 *         totalDuration:
 *           type: number
 *           description: Total execution time in milliseconds
 *           example: 5000
 *         averageTestDuration:
 *           type: number
 *           description: Average time per test in milliseconds
 *           example: 1000
 *     TestArtifact:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           example: "tc-001_2025-05-14.png"
 *         path:
 *           type: string
 *           example: "/testResults/screenshots/tc-001_2025-05-14.png"
 *         createdAt:
 *           type: string
 *           format: date-time
 */

const router = Router();
const crawler = new WebCrawler();

// performance monitoring middleware
const measureRoutePerformance = async (req: any, res: any, next: any) => {
  const startTime = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    crawler.logger.info(`Route ${req.path} completed`, { 
      method: req.method,
      path: req.path,
      duration,
      status: res.statusCode
    });
  });
  next();
};

router.use(measureRoutePerformance);

/**
 * @swagger
 * /api/test-runner/run-all:
 *   post:
 *     summary: Run all test suites
 *     tags: [Test Runner]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               testSuites:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/TestSuite'
 *               options:
 *                 type: object
 *                 properties:
 *                   concurrency:
 *                     type: number
 *                     description: Number of parallel test executions
 *                     example: 4
 *           example:
 *             testSuites: [{
 *               "id": "testsuite-001",
 *               "name": "Login Tests",
 *               "description": "Login functionality test suite",
 *               "priority": "Critical",
 *               "testCases": [
 *                 {
 *                   "id": "tc-001",
 *                   "name": "Valid Login",
 *                   "steps": [
 *                     {
 *                       "id": "step-1",
 *                       "action": "navigate",
 *                       "value": "https://www.saucedemo.com/"
 *                     }
 *                   ]
 *                 }
 *               ]
 *             }]
 *     responses:
 *       200:
 *         description: Test suites executed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 suiteRuns:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/TestSuiteRun'
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalSuites:
 *                       type: number
 *                     passedTests:
 *                       type: number
 *                     failedTests:
 *                       type: number
 *                     blockedTests:
 *                       type: number
 *                     skippedTests:
 *                       type: number
 *                     totalDuration:
 *                       type: number
 *                 performance:
 *                   $ref: '#/components/schemas/PerformanceMetrics'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 details:
 *                   type: string
 */

router.post('/run-all', async (req, res) => {
  try {
    const { testSuites, options } = req.body;
    
    if (!testSuites || !Array.isArray(testSuites)) {
      return res.status(400).json({
        error: 'Invalid request body. Expected testSuites array'
      });
    }

    await crawler.initialize();

    const suiteRuns = await crawler.measurePerformance(
      async () => crawler.runAllTestSuites(testSuites),
      'runAllTestSuites'
    );
    
    const summary = crawler.getAllSuitesSummary(suiteRuns);

    await crawler.cleanup();
    
    res.json({
      suiteRuns,
      summary,
      performance: {
        totalDuration: summary.totalDuration,
        averageTestDuration: summary.totalDuration / summary.totalTests
      }
    });
  } catch (error) {
    await crawler.cleanup();
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to run test suites',
      details: error instanceof Error ? error.stack : undefined
    });
  }
});

/**
 * @swagger
 * /api/test-runner/run-suite/{suiteId}:
 *   post:
 *     summary: Run a specific test suite by ID
 *     tags: [Test Runner]
 *     parameters:
 *       - in: path
 *         name: suiteId
 *         required: true
 *         schema:
 *           type: string
 *         example: "4849df46-f941-45ad-87c0-e9bcde5dd4bf"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               testSuites:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/TestSuite'
 *               options:
 *                 type: object
 *                 properties:
 *                   captureScreenshots:
 *                     type: boolean
 *                     description: Whether to capture screenshots
 *     responses:
 *       200:
 *         description: Test suite executed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 suiteRun:
 *                   $ref: '#/components/schemas/TestSuiteRun'
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalTests:
 *                       type: number
 *                     passedTests:
 *                       type: number
 *                 performance:
 *                   $ref: '#/components/schemas/PerformanceMetrics'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 details:
 *                   type: string
 */

router.post('/run-suite/:suiteId', async (req, res) => {
  try {
    const { suiteId } = req.params;
    const { testSuites, options = {} } = req.body;
    
    if (!testSuites || !Array.isArray(testSuites)) {
      return res.status(400).json({
        error: 'Invalid request body. Expected testSuites array'
      });
    }

    await crawler.initialize();

    const suiteRun = await crawler.measurePerformance(
      async () => crawler.runTestSuiteById(testSuites, suiteId),
      `runTestSuite-${suiteId}`
    );
    
    const summary = crawler.getSuiteSummary(suiteRun);
    for (const testRun of suiteRun.testRuns) {
      await crawler.saveTestLogs(testRun);
    }

    await crawler.processScreenshotQueue();

    await crawler.cleanup();
    
    res.json({
      suiteRun,
      summary,
      performance: {
        totalDuration: suiteRun.duration ?? 0,
        averageTestDuration: (suiteRun.duration ?? 0) / suiteRun.totalTests,
        responseDetails: await Promise.all(
          Array.from(crawler.responseCache.values())
            .map(async (response) => await crawler.getResponseDetails(response))
        )
      }
    });
  } catch (error) {
    await crawler.cleanup();
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to run test suite',
      details: error instanceof Error ? error.stack : undefined
    });
  }
});

/**
 * @swagger
 * /api/test-runner/artifacts/{testId}:
 *   get:
 *     summary: Get test artifacts (screenshots/logs)
 *     tags: [Test Runner]
 *     parameters:
 *       - in: path
 *         name: testId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [screenshot, logs]
 *         required: true
 *     responses:
 *       200:
 *         description: Test artifacts retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 testId:
 *                   type: string
 *                 artifactType:
 *                   type: file
 *                   enum: [screenshot, logs]
 *                 artifacts:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/TestArtifact'
 *       404:
 *         description: No artifacts found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */

router.get('/artifacts/:testId', async (req, res) => {
  try {
    const { testId } = req.params;
    const { type } = req.query;
    
    if (!type || (type !== 'screenshot' && type !== 'logs')) {
      return res.status(400).json({
        error: 'Invalid artifact type. Must be "screenshot" or "logs"'
      });
    }

    await crawler.ensureDirectoriesExist();
    
    const basePath = type === 'screenshot' 
      ? crawler.screenshotDir 
      : crawler.logsDir;
    
    const files = await fs.readdir(basePath);
    const artifacts = files.filter(f => f.startsWith(testId));
    
    if (artifacts.length === 0) {
      return res.status(404).json({
        error: `No ${type} artifacts found for test ${testId}`
      });
    }
    
    const artifactDetails = await Promise.all(
      artifacts.map(async f => {
        const filePath = path.join(basePath, f);
        const stats = await fs.stat(filePath);
        const content = type === 'logs' 
          ? JSON.parse(await fs.readFile(filePath, 'utf-8'))
          : undefined;
        
        return {
          name: f,
          path: filePath,
          createdAt: stats.ctime,
          size: stats.size,
          content 
        };
      })
    );
    
    res.json({
      testId,
      artifactType: type,
      artifacts: artifactDetails
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retrieve test artifacts',
      details: error instanceof Error ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /api/test-runner/performance/{suiteId}:
 *   get:
 *     summary: Get performance metrics for a test suite
 *     tags: [Test Runner]
 *     parameters:
 *       - in: path
 *         name: suiteId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Performance metrics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 performance:
 *                   type: object
 *                   properties:
 *                     totalDuration:
 *                       type: number
 *                     averageTestDuration:
 *                       type: number
 *                     responseCache:
 *                       type: number
 *                     screenshotQueueSize:
 *                       type: number
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 details:
 *                   type: string
 */

router.get('/performance/:suiteId', async (req, res) => {
  try {
    const { suiteId } = req.params;
    const testRun = await crawler.measurePerformance(
      async () => {
        const run = crawler.testRuns.get(suiteId);
        if (!run) {
          throw new Error(`No test run found for suite ${suiteId}`);
        }
        return run;
      },
      `getPerformance-${suiteId}`
    );

    // Convert TestRun to TestSuiteRun
    const suiteRun = {
      ...testRun,
      testSuiteId: suiteId,
      totalTests: 1,
      passedTests: testRun.status === 'PASSED' ? 1 : 0,
      failedTests: testRun.status === 'FAILED' ? 1 : 0,
      blockedTests: testRun.status === 'BLOCKED' ? 1 : 0,
      skippedTests: testRun.status === 'SKIPPED' ? 1 : 0,
      testRuns: [testRun], 
    };

    const summary = crawler.getSuiteSummary(suiteRun);
    const performance = {
      totalDuration: summary.duration,
      averageTestDuration: (summary.duration ?? 0) / summary.totalTests,
      responseCache: crawler.responseCache.size,
      screenshotQueueSize: crawler.screenshotQueue.length
    };

    res.json({ performance });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retrieve performance metrics',
      details: error instanceof Error ? error.message : undefined
    });
  }
});

export default router;