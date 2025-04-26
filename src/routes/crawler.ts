import { Router, Request, Response } from 'express';
import { WebCrawler } from '../services/crawler';
import { getLogger } from '../utils/logger';

const router = Router();
const logger = getLogger('CrawlerRoutes');
const crawler = new WebCrawler();

// Initialize the crawler on startup
(async () => {
  try {
    await crawler.initialize();
    logger.info('Crawler initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize crawler', error);
  }
})();

/**
 * @swagger
 * /api/crawler/scan:
 *   post:
 *     summary: Crawl a website and detect testable elements
 *     description: Scans a web page to identify and analyze testable UI components
 *     tags: [Crawler]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CrawlRequest'
 *     responses:
 *       200:
 *         description: Successful crawl operation
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CrawlResult'
 *       400:
 *         description: Invalid request parameters
 *       500:
 *         description: Server error during crawl operation
 */
router.post('/scan', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    
    logger.info(`Received crawl request for URL: ${url}`);
    const result = await crawler.crawlPage(url);
    
    return res.status(200).json(result);
  } catch (error) {
    logger.error('Error during crawl operation', error);
    return res.status(500).json({ 
      error: 'Failed to crawl the page',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * @swagger
 * /api/crawler/element:
 *   post:
 *     summary: Get detailed information about a specific element
 *     description: Retrieves detailed information and analysis for a specific element on a web page
 *     tags: [Crawler]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - url
 *               - selector
 *             properties:
 *               url:
 *                 type: string
 *                 description: URL of the website
 *               selector:
 *                 type: string
 *                 description: CSS selector to identify the element
 *     responses:
 *       200:
 *         description: Element details retrieved successfully
 *       400:
 *         description: Invalid request parameters
 *       500:
 *         description: Server error while retrieving element details
 *       501:
 *         description: Functionality not implemented yet
 */
router.post('/element', async (req: Request, res: Response) => {
  try {
    const { url, selector } = req.body;
    
    if (!url || !selector) {
      return res.status(400).json({ error: 'URL and selector are required' });
    }

    
    return res.status(501).json({ message: 'Not implemented yet' });
  }  catch (error) {
    logger.error('Error getting element details', error);
    return res.status(500).json({ error: 'Failed to get element details' });
  }
});

/**
 * @swagger
 * /api/crawler/status:
 *   get:
 *     summary: Get crawler status
 *     description: Returns the current status of the crawler service
 *     tags: [Crawler]
 *     responses:
 *       200:
 *         description: Status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   description: Current status of the crawler
 *                 initialized:
 *                   type: boolean
 *                   description: Whether the crawler is initialized
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    return res.status(200).json({
      status: 'operational',
      initialized: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error getting crawler status', error);
    return res.status(500).json({ error: 'Failed to get crawler status' });
  }
});

process.on('SIGINT', async () => {
  logger.info('Process terminating, closing crawler');
  await crawler.close();
  process.exit(0);
});

export { router as crawlerRouter };