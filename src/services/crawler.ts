import { Browser, Page, chromium, ElementHandle } from 'playwright';
import { Logger } from 'winston';
import { getLogger } from '../utils/logger';

interface TestableElement {
  type: string;         
  identifier: {
    type: 'id' | 'class';
    value: string;
  };
  attributes: Record<string, string>;
  innerText?: string;    
  location: {            
    x: number;
    y: number;
    width: number;
    height: number;
  };
  parentElement?: string; 
  childElements?: string[]; 
}

interface CrawlResult {
  url: string;
  title: string;
  elements: TestableElement[];
  timestamp: number;
}

interface MemoryUsage {
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
}

interface CrawlerStats {
  memoryUsage: MemoryUsage;
  crawlDuration: number;
  elementsFound: number;
  errorCount: number;
}

const MEMORY_THRESHOLD = 1024 * 1024 * 1024; // 1GB
const MAX_RETRY_ATTEMPTS = 3;
const RECOVERY_DELAY = 1000; // 1 second

export class WebCrawler {
  private logger: Logger;
  private browser: Browser | null = null;
  private stats: CrawlerStats = {
    memoryUsage: process.memoryUsage(),
    crawlDuration: 0,
    elementsFound: 0,
    errorCount: 0
  };

  constructor() {
    this.logger = getLogger('WebCrawler');
  }

  async initialize(): Promise<void> {
    try {
      this.browser = await chromium.launch({ 
        headless: true,
      });
      this.logger.info('Browser initialized');
    } catch (error) {
      this.logger.error('Failed to initialize browser', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.logger.info('Browser closed');
    }
  }

  private validateUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch (error) {
      this.logger.error(`Invalid URL: ${url}`);
      return false;
    }
  }

  private validateBrowserState(): void {
    if (!this.browser) {
      throw new Error('Browser not initialized. Call initialize() first.');
    }
  }

  async crawlPage(url: string): Promise<CrawlResult> {
    const startTime = Date.now();
    
    try {
      if (!url || !this.validateUrl(url)) {
        throw new Error('Invalid URL provided');
      }

      this.validateBrowserState();
      await this.monitorMemoryUsage();

      return await this.retryOperation(async () => {
        const context = await this.browser!.newContext({
          viewport: { width: 1280, height: 800 },
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        });

        const page = await context.newPage();
        
        try {
          await page.goto(url, { 
            waitUntil: 'networkidle',
            timeout: 30000 
          });

          const title = await page.title();
          const elements = await this.findTestableElements(page);
          
          this.stats.elementsFound = elements.length;
          this.stats.crawlDuration = Date.now() - startTime;

          return {
            url,
            title,
            elements,
            timestamp: Date.now(),
          };
        } finally {
          await context.close();
          await this.monitorMemoryUsage();
        }
      });
    } catch (error) {
      this.logger.error('Crawl failed', {
        url,
        error,
        stats: this.stats
      });
      throw error;
    }
  }

  private async findTestableElements(page: Page): Promise<TestableElement[]> {
    this.logger.info('Finding testable elements on page');
    const elements: TestableElement[] = [];

    const forms = await this.findForms(page);
    elements.push(...forms);

    const buttons = await this.findButtons(page);
    elements.push(...buttons);
    
    const navLinks = await this.findNavigationLinks(page);
    elements.push(...navLinks);
    
    const inputs = await this.findInputFields(page);
    elements.push(...inputs);

    this.logger.info(`Found ${elements.length} testable elements`);
    return elements;
  }

  private async findForms(page: Page): Promise<TestableElement[]> {
    const formElements: TestableElement[] = [];
    const forms = await page.$$('form');
    
    for (let i = 0; i < forms.length; i++) {
      const form = forms[i];
      const selector = await this.generateUniqueSelector(form);
      
      const formFields = await form.$$('input, select, textarea');
      const submitButton = await form.$('input[type="submit"], button[type="submit"], button:has-text("Submit")');
      
      const boundingBox = await form.boundingBox();
      
      if (boundingBox) {
        const screenshot = await form.screenshot();
        
        formElements.push({
          type: 'form',
          identifier: {
            type: selector.startsWith('#') ? 'id' : 'class',
            value: selector.replace(/^[#\.]/, ''),
          },
          attributes: await this.extractAttributes(form),
          location: boundingBox,
          childElements: await Promise.all(formFields.map(field => this.generateUniqueSelector(field))),
        });
      }
    }
    
    return formElements;
  }

  private async findButtons(page: Page): Promise<TestableElement[]> {
    const buttonElements: TestableElement[] = [];
    const buttons = await page.$$('button, input[type="button"], input[type="submit"], a.btn, .button, [role="button"]');
    
    for (const button of buttons) {
      if (await this.validateElement(button)) {
        const boundingBox = await button.boundingBox();
        const innerText = await button.innerText();
        
        if (boundingBox) {
          buttonElements.push({
            type: 'button',
            identifier: await this.generateElementIdentifier(button),
            attributes: await this.extractAttributes(button),
            innerText,
            location: boundingBox,
          });
        }
      }
    }
    
    return buttonElements;
  }

  private async findNavigationLinks(page: Page): Promise<TestableElement[]> {
    const navElements: TestableElement[] = [];
    const navLinks = await page.$$('nav a, header a, .navigation a, .menu a, .nav-item a');
    
    for (const link of navLinks) {
      const selector = await this.generateUniqueSelector(link);
      const boundingBox = await link.boundingBox();
      const innerText = await link.innerText();
      
      if (boundingBox) {
        navElements.push({
          type: 'navigationLink',
          identifier: {
            type: selector.startsWith('#') ? 'id' : 'class',
            value: selector.replace(/^[#\.]/, ''),
          },
          attributes: await this.extractAttributes(link),
          innerText,
          location: boundingBox,
        });
      }
    }
    
    return navElements;
  }

  private async findInputFields(page: Page): Promise<TestableElement[]> {
    const inputElements: TestableElement[] = [];
    const inputs = await page.$$('input:not([type="submit"]):not([type="button"]), textarea, select');
    
    for (const input of inputs) {
      const selector = await this.generateUniqueSelector(input);
      const boundingBox = await input.boundingBox();
      
      if (boundingBox) {
        inputElements.push({
          type: 'input',
          identifier: {
            type: selector.startsWith('#') ? 'id' : 'class',
            value: selector.replace(/^[#\.]/, ''),
          },
          attributes: await this.extractAttributes(input),
          location: boundingBox,
        });
      }
    }
    
    return inputElements;
  }

  private async validateAttributes(attributes: Record<string, string>): Promise<Record<string, string>> {
    const validAttributes: Record<string, string> = {};
    for (const [key, value] of Object.entries(attributes)) {
      if (typeof value === 'string' && value.length < 1000) { // Prevent extremely long values
        validAttributes[key] = value;
      }
    }
    return validAttributes;
  }

  private async extractAttributes(element: ElementHandle): Promise<Record<string, string>> {
    const attributes = await element.evaluate((el: Element) => {
      const attributes: Record<string, string> = {};
      for (const attr of el.attributes) {
        attributes[attr.name] = attr.value;
      }
      return attributes;
    });
    return this.validateAttributes(attributes);
  }

  private async generateUniqueSelector(element: ElementHandle): Promise<string> {
    try {
      return await element.evaluate((el: HTMLElement) => {
        if (el.id) {
          return `#${el.id}`;
        }
        
        const tag = el.tagName.toLowerCase();
        
        if (el.getAttribute('name')) {
          return `${tag}[name="${el.getAttribute('name')}"]`;
        }
        
        if (el.className && typeof el.className === 'string') {
          const classes = el.className.trim().split(/\s+/);
          if (classes.length > 0) {
            return `${tag}.${classes.join('.')}`;
          }
        }
        
        let path = '';
        let current = el;
        while (current !== document.body && current.parentElement) {
          let index = 1;
          let sibling = current as Element;
          while ((sibling = sibling.previousElementSibling as HTMLElement)) {
            if (sibling.tagName === current.tagName) {
              index++;
            }
          }
          path = `${current.tagName.toLowerCase()}:nth-of-type(${index})${path ? ' > ' + path : ''}`;
          current = current.parentElement;
        }
        
        return path ? `body > ${path}` : tag;
      });
    } catch (error) {
      return element.evaluate((el: HTMLElement) => {
        return el.tagName.toLowerCase();
      });
    }
  }

  private async generateElementIdentifier(element: ElementHandle): Promise<{ type: 'id' | 'class'; value: string }> {
    return await element.evaluate((el: HTMLElement) => {
      if (el.id) {
        return {
          type: 'id',
          value: el.id
        };
      }
      
      if (el.className && typeof el.className === 'string') {
        const classes = el.className.trim().split(/\s+/);
        if (classes.length > 0) {
          return {
            type: 'class',
            value: classes.join(' ')
          };
        }
      }
      
      return {
        type: 'class',
        value: ''
      };
    });
  }

  private async validateElement(element: ElementHandle): Promise<boolean> {
    try {
      const isVisible = await element.isVisible();
      const boundingBox = await element.boundingBox();
      return isVisible && boundingBox !== null;
    } catch (error) {
      this.logger.warn('Element validation failed', error);
      return false;
    }
  }

  private async monitorMemoryUsage(): Promise<void> {
    const memoryUsage = process.memoryUsage();
    this.stats.memoryUsage = memoryUsage;

    if (memoryUsage.heapUsed > MEMORY_THRESHOLD) {
      this.logger.warn('Memory usage exceeded threshold, initiating garbage collection');
      if (global.gc) {
        global.gc();
      }
      await this.recoveryAction();
    }
  }

  private async recoveryAction(): Promise<void> {
    try {
      await this.close();
      await new Promise(resolve => setTimeout(resolve, RECOVERY_DELAY));
      await this.initialize();
    } catch (error) {
      this.logger.error('Recovery action failed', error);
      throw error;
    }
  }

  private async retryOperation<T>(
    operation: () => Promise<T>,
    retryCount = 0
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.stats.errorCount++;
      
      if (retryCount >= MAX_RETRY_ATTEMPTS) {
        this.logger.error(`Operation failed after ${MAX_RETRY_ATTEMPTS} attempts`, error);
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Retry attempt ${retryCount + 1} after error: ${errorMessage}`);
      await new Promise(resolve => setTimeout(resolve, RECOVERY_DELAY * (retryCount + 1)));
      return this.retryOperation(operation, retryCount + 1);
    }
  }

  public getStats(): CrawlerStats {
    return {
      ...this.stats,
      memoryUsage: process.memoryUsage()
    };
  }
}