/**
 * 模型适配器统一导出
 */

export * from './chatAdapter';
// 只导出必要的函数，videoAdapter 和 imageAdapter 有重复的函数名
export {
  isAspectRatioSupported as isImageAspectRatioSupported,
  callImageApi,
} from './imageAdapter';

export {
  callVideoApi,
  isAspectRatioSupported as isVideoAspectRatioSupported,
  isDurationSupported,
} from './videoAdapter';
