import { Router } from 'express';
import { WebCrawler } from '../services/runTScrawler';
import { TestSuite } from '../interfaces/types';

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
 */

const router = Router();
const crawler = new WebCrawler();

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
 *                       example: 1
 *                     passedTests:
 *                       type: number
 *                       example: 3
 *                     failedTests:
 *                       type: number
 *                       example: 1
 *                     blockedTests:
 *                       type: number
 *                       example: 1
 */

router.post('/run-all', async (req, res) => {
  try {
    const { testSuites } = req.body;
    
    if (!testSuites || !Array.isArray(testSuites)) {
      return res.status(400).json({
        error: 'Invalid request body. Expected testSuites array'
      });
    }

    const suiteRuns = await crawler.runAllTestSuites(testSuites);
    
    res.json({
      suiteRuns,
      summary: crawler.getAllSuitesSummary(suiteRuns)
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to run test suites'
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
 */
router.post('/run-suite/:suiteId', async (req, res) => {
  try {
    const { suiteId } = req.params;
    const { testSuites } = req.body as { testSuites: TestSuite[] };
    
    const suiteRun = await crawler.runTestSuiteById(testSuites, suiteId);
    
    res.json({
      suiteRun,
      summary: crawler.getSuiteSummary(suiteRun)
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to run test suite'
    });
  }
});

export default router;