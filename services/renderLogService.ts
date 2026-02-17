import { RenderLog } from '../types';

/**
 * Render Log Service
 * Manages API call logging for tracking generation history, costs, and debugging
 */

// Type for log creation callback - used to save logs to project state
type LogCallback = (log: RenderLog) => void;

let logCallback: LogCallback | null = null;

/**
 * Set the callback function that will be called when a new log is created
 * This callback should save the log to the project state
 */
export const setLogCallback = (callback: LogCallback) => {
  logCallback = callback;
};

/**
 * Clear the log callback
 */
export const clearLogCallback = () => {
  logCallback = null;
};

/**
 * Add a render log entry
 * Records an API call with all relevant metadata
 */
export const addRenderLog = (log: Omit<RenderLog, 'id' | 'timestamp'>): void => {
  const fullLog: RenderLog = {
    ...log,
    id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now()
  };

  if (logCallback) {
    logCallback(fullLog);
  } else {
    console.warn('[RenderLog] No callback set - log not saved:', fullLog);
  }
};

/**
 * Helper to wrap an API operation with automatic logging
 * Captures timing, success/failure, and token usage
 */
export const withLogging = async <T>(
  operation: () => Promise<T>,
  logInfo: {
    type: RenderLog['type'];
    resourceId: string;
    resourceName: string;
    model: string;
    prompt?: string;
  }
): Promise<T> => {
  const startTime = Date.now();
  
  try {
    const result = await operation();
    const duration = Date.now() - startTime;
    
    addRenderLog({
      ...logInfo,
      status: 'success',
      duration
    });
    
    return result;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    addRenderLog({
      ...logInfo,
      status: 'failed',
      error: error.message || String(error),
      duration
    });
    
    throw error;
  }
};

/**
 * Helper to log with token information
 * Use this when you have token usage data from API response
 */
export const addRenderLogWithTokens = (
  logInfo: Omit<RenderLog, 'id' | 'timestamp'> & {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }
): void => {
  addRenderLog(logInfo);
};
