/**
 * 前端任务服务
 *
 * 将生成任务提交到服务端后台执行，通过轮询获取结果。
 * 即使关闭浏览器，任务仍在服务端继续运行。
 *
 * 使用方式：
 *   const task = await submitTask({ type: 'video', ... });
 *   const result = await waitForTask(task.id, { onProgress });
 *
 * 或使用一步式接口：
 *   const result = await generateVideoServerSide({ ... });
 */

import { apiPost, apiGet, apiDelete } from './apiClient';
import { AspectRatio, VideoDuration } from '../types';

// ============================================
// 类型定义
// ============================================

export interface TaskCreateParams {
  type: 'video' | 'image' | 'chat' | 'script_parse';
  projectId: string;
  modelId: string;
  prompt: string;

  // 视频参数
  startImage?: string;
  endImage?: string;
  aspectRatio?: AspectRatio;
  duration?: VideoDuration;

  // 图片参数
  referenceImages?: string[];
  isVariation?: boolean;
  hasTurnaround?: boolean;

  // 文本参数
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json_object';

  // 剧本解析参数
  scriptParseParams?: {
    language: string;
    visualStyle: string;
    targetDuration: string;
    title?: string;
  };

  // 结果写入目标
  target?: {
    type: string;
    shotId?: string;
    entityId?: string;
  };
}

export interface TaskStatus {
  id: string;
  projectId: string;
  type: string;
  status: 'pending' | 'running' | 'polling' | 'completed' | 'failed' | 'cancelled';
  modelId: string;
  progress: number;
  statusMessage: string;
  error: string | null;
  providerTaskId: string | null;
  provider: string | null;
  targetType: string | null;
  targetShotId: string | null;
  targetEntityId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  result?: string;
}

export interface TaskWaitOptions {
  /** 进度回调 (progress: 0-100, status: 任务状态, statusMessage: 详细进度描述) */
  onProgress?: (progress: number, status: string, statusMessage: string) => void;
  /** 超时时间（毫秒），默认 25 分钟 */
  timeout?: number;
  /** 轮询间隔（毫秒），默认 3000 */
  pollInterval?: number;
  /** 用于取消的 AbortSignal */
  signal?: AbortSignal;
}

// ============================================
// 内部状态
// ============================================

/** 当前活跃的轮询 */
const activePollers = new Map<string, { cancel: () => void }>();

// ============================================
// 核心 API
// ============================================

/**
 * 提交生成任务到服务端
 *
 * 服务端会立即开始执行任务，返回任务 ID 供后续查询。
 */
export const submitTask = async (params: TaskCreateParams): Promise<TaskStatus> => {
  const { task } = await apiPost<{ task: TaskStatus }>('/api/tasks', params);
  console.log(`📋 [TaskService] 任务已提交: ${task.id} (${params.type}/${params.modelId})`);
  return task;
};

/**
 * 查询任务状态
 */
export const getTaskStatus = async (taskId: string): Promise<TaskStatus> => {
  const { task } = await apiGet<{ task: TaskStatus }>(`/api/tasks/${taskId}`);
  return task;
};

/**
 * 获取任务结果（完成后调用，获取 base64 大数据）
 */
export const getTaskResult = async (taskId: string): Promise<string> => {
  const { result } = await apiGet<{ result: string }>(`/api/tasks/${taskId}/result`);
  return result;
};

/**
 * 取消任务
 */
export const cancelTaskRequest = async (taskId: string): Promise<void> => {
  await apiDelete(`/api/tasks/${taskId}`);
  activePollers.get(taskId)?.cancel();
  activePollers.delete(taskId);
};

/**
 * 获取项目的活跃任务列表
 */
export const getActiveTasksForProject = async (projectId: string): Promise<TaskStatus[]> => {
  const { tasks } = await apiGet<{ tasks: TaskStatus[] }>(`/api/tasks?project_id=${projectId}`);
  return tasks;
};

/**
 * 获取项目的所有任务（含已完成）
 */
export const getAllTasksForProject = async (projectId: string): Promise<TaskStatus[]> => {
  const { tasks } = await apiGet<{ tasks: TaskStatus[] }>(
    `/api/tasks?project_id=${projectId}&all=true`
  );
  return tasks;
};

// ============================================
// 等待任务完成
// ============================================

/**
 * 轮询等待任务完成，返回结果
 *
 * 采用自适应轮询间隔（开始 2s，逐渐增加到 8s）。
 */
export const waitForTask = async (
  taskId: string,
  options: TaskWaitOptions = {}
): Promise<string> => {
  const {
    onProgress,
    timeout = 25 * 60 * 1000, // 25 分钟
    pollInterval = 3000,
    signal,
  } = options;

  return new Promise<string>((resolve, reject) => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    let pollTimeoutId: ReturnType<typeof setTimeout>;
    let currentInterval = pollInterval;
    const maxInterval = 8000;

    const cancel = () => {
      cancelled = true;
      clearTimeout(timeoutId);
      clearTimeout(pollTimeoutId);
      activePollers.delete(taskId);
    };

    activePollers.set(taskId, { cancel });

    // 超时处理
    timeoutId = setTimeout(() => {
      cancel();
      reject(new Error('任务等待超时'));
    }, timeout);

    // 监听外部取消
    signal?.addEventListener('abort', () => {
      cancel();
      reject(new Error('任务已取消'));
    });

    const poll = async () => {
      if (cancelled) return;

      try {
        const task = await getTaskStatus(taskId);

        if (cancelled) return;

        onProgress?.(task.progress, task.status, task.statusMessage || '');

        switch (task.status) {
          case 'completed': {
            cancel();
            try {
              const result = await getTaskResult(taskId);
              resolve(result);
            } catch (err: any) {
              reject(new Error(`获取任务结果失败: ${err.message}`));
            }
            return;
          }

          case 'failed':
            cancel();
            reject(new Error(task.error || '任务执行失败'));
            return;

          case 'cancelled':
            cancel();
            reject(new Error('任务已被取消'));
            return;

          case 'pending':
          case 'running':
          case 'polling':
            // 自适应间隔：running 时快轮询，polling 时慢轮询
            if (task.status === 'polling') {
              currentInterval = Math.min(currentInterval + 500, maxInterval);
            } else {
              currentInterval = pollInterval;
            }
            pollTimeoutId = setTimeout(poll, currentInterval);
            return;

          default:
            pollTimeoutId = setTimeout(poll, currentInterval);
        }
      } catch (err: any) {
        if (cancelled) return;
        // 网络错误时继续轮询（可能是临时断网）
        console.warn(`[TaskService] 轮询失败: ${err.message}，${currentInterval}ms 后重试...`);
        currentInterval = Math.min(currentInterval * 1.5, maxInterval);
        pollTimeoutId = setTimeout(poll, currentInterval);
      }
    };

    // 首次等待后开始轮询
    pollTimeoutId = setTimeout(poll, 1000);
  });
};

// ============================================
// 一步式接口（提交 + 等待）
// ============================================

/**
 * 在服务端生成视频（提交任务 + 等待结果）
 *
 * 替代 videoService.generateVideo()，不受浏览器关闭影响。
 */
export const generateVideoServerSide = async (
  projectId: string,
  prompt: string,
  modelId: string,
  options: {
    startImage?: string;
    endImage?: string;
    aspectRatio?: AspectRatio;
    duration?: VideoDuration;
    target?: TaskCreateParams['target'];
    onProgress?: (progress: number, status: string, statusMessage: string) => void;
    signal?: AbortSignal;
  } = {}
): Promise<string> => {
  const task = await submitTask({
    type: 'video',
    projectId,
    modelId,
    prompt,
    startImage: options.startImage,
    endImage: options.endImage,
    aspectRatio: options.aspectRatio,
    duration: options.duration,
    target: options.target,
  });

  return await waitForTask(task.id, {
    onProgress: options.onProgress,
    signal: options.signal,
  });
};

/**
 * 在服务端生成图片（提交任务 + 等待结果）
 *
 * 替代 visualService.generateImage()，不受浏览器关闭影响。
 */
export const generateImageServerSide = async (
  projectId: string,
  prompt: string,
  modelId: string,
  options: {
    referenceImages?: string[];
    aspectRatio?: AspectRatio;
    isVariation?: boolean;
    hasTurnaround?: boolean;
    target?: TaskCreateParams['target'];
    onProgress?: (progress: number, status: string, statusMessage: string) => void;
    signal?: AbortSignal;
  } = {}
): Promise<string> => {
  const task = await submitTask({
    type: 'image',
    projectId,
    modelId,
    prompt,
    referenceImages: options.referenceImages,
    aspectRatio: options.aspectRatio,
    isVariation: options.isVariation,
    hasTurnaround: options.hasTurnaround,
    target: options.target,
  });

  return await waitForTask(task.id, {
    onProgress: options.onProgress,
    signal: options.signal,
    timeout: 5 * 60 * 1000, // 图片 5 分钟超时
  });
};

/**
 * 在服务端执行文本生成（提交任务 + 等待结果）
 *
 * 替代 apiCore.chatCompletion()，不受浏览器关闭影响。
 */
export const chatCompletionServerSide = async (
  projectId: string,
  prompt: string,
  modelId: string,
  options: {
    temperature?: number;
    maxTokens?: number;
    responseFormat?: 'json_object';
    signal?: AbortSignal;
  } = {}
): Promise<string> => {
  const task = await submitTask({
    type: 'chat',
    projectId,
    modelId,
    prompt,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    responseFormat: options.responseFormat,
  });

  return await waitForTask(task.id, {
    signal: options.signal,
    timeout: 10 * 60 * 1000, // 文本 10 分钟超时
    pollInterval: 2000,
  });
};

/**
 * 在服务端执行剧本解析（提交任务 + 等待结果）
 *
 * 替代 scriptService.parseScriptToData + generateShotList，不受页面刷新影响。
 * 服务端会完成全部解析流程并将结果写入数据库。
 */
export const parseScriptServerSide = async (
  projectId: string,
  rawText: string,
  modelId: string,
  options: {
    language: string;
    visualStyle: string;
    targetDuration: string;
    title?: string;
    onProgress?: (progress: number, status: string, statusMessage: string) => void;
    signal?: AbortSignal;
  }
): Promise<{ scriptData: any; shots: any[] }> => {
  const task = await submitTask({
    type: 'script_parse',
    projectId,
    modelId,
    prompt: rawText,
    scriptParseParams: {
      language: options.language,
      visualStyle: options.visualStyle,
      targetDuration: options.targetDuration,
      title: options.title,
    },
  });

  const resultStr = await waitForTask(task.id, {
    onProgress: options.onProgress,
    signal: options.signal,
    timeout: 15 * 60 * 1000,
    pollInterval: 3000,
  });

  return JSON.parse(resultStr);
};

// ============================================
// 任务恢复（页面重新加载后）
// ============================================

/**
 * 检查并恢复项目的活跃任务
 *
 * 在页面加载或项目切换时调用，恢复对运行中任务的监听。
 * 返回正在运行的任务列表，供 UI 显示进度。
 */
export const recoverProjectTasks = async (
  projectId: string,
  onTaskComplete?: (task: TaskStatus, result: string) => void,
  onTaskFailed?: (task: TaskStatus, error: string) => void,
  onTaskProgress?: (task: TaskStatus, progress: number) => void
): Promise<TaskStatus[]> => {
  try {
    const activeTasks = await getActiveTasksForProject(projectId);

    if (activeTasks.length === 0) return [];

    console.log(`🔄 [TaskService] 发现 ${activeTasks.length} 个活跃任务，恢复监听...`);

    for (const task of activeTasks) {
      // 跳过已在监听的任务
      if (activePollers.has(task.id)) continue;

      // 为每个活跃任务启动轮询
      waitForTask(task.id, {
        onProgress: (progress, status, statusMessage) => {
          onTaskProgress?.({ ...task, progress, status: status as any, statusMessage }, progress);
        },
      }).then(result => {
        onTaskComplete?.({ ...task, status: 'completed' }, result);
      }).catch(err => {
        onTaskFailed?.({ ...task, status: 'failed' }, err.message);
      });
    }

    return activeTasks;
  } catch (err: any) {
    console.warn('[TaskService] 恢复任务失败:', err.message);
    return [];
  }
};

/**
 * 停止所有活跃的轮询
 * 在页面卸载或项目切换时调用
 */
export const stopAllPollers = (): void => {
  for (const [taskId, poller] of activePollers) {
    poller.cancel();
  }
  activePollers.clear();
};
