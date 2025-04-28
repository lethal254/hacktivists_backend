export type Priority = "Critical" | "High" | "Medium" | "Low"
export type TestStatus =
  | "NOT_RUN"
  | "RUNNING"
  | "PASSED"
  | "FAILED"
  | "BLOCKED"
  | "SKIPPED"
export type TestType =
  | "Input_Validation"
  | "Form_Submission"
  | "Navigation"
  | "UI_Interaction"
  | "Authentication"
  | "Error_Handling"
  | "Performance"
  | "Accessibility"
 
export interface TestCase {
  id: string
  name: string
  description: string
  testType: TestType
  priority: Priority
  steps: Step[]
  assertions: Assertion[]
  testData: TestData
  preconditions: string[]
  tags: string[]
  dependsOn: string[]
  status: TestStatus
  lastRunAt?: string
  lastRunDuration?: number
  lastRunError?: string
  testSuiteId: string
  createdAt: string
  updatedAt: string
  testRuns: TestRun[]
}
 
export interface Step {
  id: string
  stepNumber: number
  action: Action
  selector: Selector
  value?: string
  expectedResult: string
  timeout?: number
  testCaseId: string
  waitForNavigation?: boolean;
  testData?: {
    valid?: { [key: string]: string };
    invalid?: { [key: string]: string };
  };
  useValidData?: boolean;


}
 
export interface Selector {
  id: string
  type: SelectorType
  value: string
}
 
export interface Assertion {
  id: string
  description: string
  assertionType: AssertionType
  selector?: Selector
  expectedValue?: string
  testCaseId: string
}
 
export interface TestData {
  id: string
  valid: Record<string, unknown>
  invalid?: Record<string, unknown>
}
// project ->suite -> test case -> steps
 
export interface TestSuite {
  id: string
  name: string
  description: string
  priority: Priority
  projectId: string
  createdAt: string
  updatedAt: string
  status: TestStatus
  lastRunAt?: string
  lastRunDuration?: number
  lastRunError?: string
  testCases: TestCase[]
  suiteRuns: TestSuiteRun[]
}
 
export interface TestSuiteRun {
  id: string
  testSuiteId: string
  status: TestStatus
  startedAt: string
  completedAt?: string
  duration?: number
  totalTests: number
  passedTests: number
  failedTests: number
  skippedTests: number
  blockedTests: number
  testRuns: TestRun[]
  environment: string
  runBy?: string
  createdAt: string
}
 
export interface TestRun {
  id: string
  testCaseId: string
  status: TestStatus
  startedAt: string
  completedAt?: string
  duration?: number
  errorMessage?: string
  stackTrace?: string
  screenshot?: string
  logs: {
    steps: Array<{ stepId: string; success: boolean; error?: string; timestamp: string }>;
    assertions: Array<{ assertionId: string; success: boolean; error?: string; timestamp: string }>;
    message?: string;
  }
  metadata?: Record<string, unknown>
  environment: string
  runBy?: string
  testSuiteRunId?: string
  createdAt: string
}
 
export interface Project {
  id: string
  name: string
  websiteUrl: string
  createdAt: string
  updatedAt: string
  userId?: string
  testSuites: TestSuite[]
}
 
export type Action =
  | "navigate"
  | "click"
  | "type"
  | "select"
  | "check"
  | "uncheck"
  | "clear"
  | "submit"
  | "hover"
  | "wait"
  | "screenshot"
  | "assert"
 
export type SelectorType =
  | "id"
  | "name"
  | "css"
  | "xpath"
  | "tagName"
  | "className"
  | "linkText"
 
export type AssertionType =
  | "elementExists"
  | "elementVisible"
  | "elementEnabled"
  | "textEquals"
  | "textContains"
  | "attributeEquals"
  | "attributeContains"
  | "urlEquals"
  | "urlContains"
  | "pageTitle"
 
export interface TestStats {
  total: number
  passed: number
  failed: number
  running: number
  blocked: number
  skipped: number
  notRun: number
  progress: number
}
 
export interface PageElement {
  id: string
  tag: string
  text: string
  cssSelector: string
  elementType: string
  interactable: boolean
  attributes: ElementAttribute[]
  createdAt: string
  updatedAt: string
}
 
export interface ElementAttribute {
  id: string
  name: string
  value: string
  pageElementId: string
}

export interface TestRun {
    id: string;
    testCaseId: string;
    status: TestStatus;
    startedAt: string;
    completedAt?: string;
    duration?: number;
    errorMessage?: string;
    stackTrace?: string;
    screenshot?: string;
    logs: {
      steps: Array<{ stepId: string; success: boolean; error?: string; timestamp: string }>;
      assertions: Array<{ assertionId: string; success: boolean; error?: string; timestamp: string }>;
      message?: string;
    };
    metadata?: Record<string, unknown>;
    environment: string;
    runBy?: string;
    testSuiteRunId?: string;
    createdAt: string;
  }
 