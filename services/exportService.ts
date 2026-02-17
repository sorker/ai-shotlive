import { ProjectState } from '../types';

/**
 * 下载单个文件并转换为 Blob
 * 支持URL和base64两种格式
 */
async function downloadFile(urlOrBase64: string): Promise<Blob> {
  // 检查是否为base64格式
  if (urlOrBase64.startsWith('data:video/')) {
    // 从base64 data URL中提取数据
    const base64Data = urlOrBase64.split(',')[1];
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type: 'video/mp4' });
  }
  
  // 原有的URL下载逻辑
  const response = await fetch(urlOrBase64);
  if (!response.ok) {
    throw new Error(`下载失败: ${response.statusText}`);
  }
  return await response.blob();
}

/**
 * 下载所有视频片段并打包为 ZIP 文件
 */
export async function downloadMasterVideo(
  project: ProjectState,
  onProgress?: (phase: string, progress: number) => void
): Promise<void> {
  try {
    // 1. 筛选已完成的视频片段
    const completedShots = project.shots.filter(shot => shot.interval?.videoUrl);
    
    if (completedShots.length === 0) {
      throw new Error('没有可导出的视频片段');
    }

    onProgress?.('正在加载 ZIP 库...', 0);
    
    // 2. 动态导入 JSZip
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    onProgress?.('下载视频片段...', 10);

    // 3. 下载所有视频文件并添加到 ZIP
    for (let i = 0; i < completedShots.length; i++) {
      const shot = completedShots[i];
      const videoUrl = shot.interval!.videoUrl!;
      const shotNum = String(i + 1).padStart(3, '0');
      const fileName = `shot_${shotNum}.mp4`;
      
      try {
        const videoBlob = await downloadFile(videoUrl);
        zip.file(fileName, videoBlob);
        
        const progress = 10 + Math.round((i + 1) / completedShots.length * 75);
        onProgress?.(`下载中 (${i + 1}/${completedShots.length})...`, progress);
      } catch (err) {
        console.error(`下载视频片段 ${i + 1} 失败:`, err);
        // 继续下载其他文件，不中断整个流程
      }
    }

    onProgress?.('正在生成 ZIP 文件...', 85);

    // 4. 生成 ZIP 文件
    const zipBlob = await zip.generateAsync(
      { type: 'blob' },
      (metadata) => {
        const progress = 85 + Math.round(metadata.percent / 10);
        onProgress?.('正在压缩...', progress);
      }
    );

    onProgress?.('准备下载...', 95);

    // 5. 触发浏览器下载
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.scriptData?.title || project.title || 'master'}_videos.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    onProgress?.('完成！', 100);
  } catch (error) {
    console.error('视频导出失败:', error);
    throw error;
  }
}

/**
 * 估算合并后的视频总时长（秒）
 * 每个镜头默认10秒
 */
export function estimateTotalDuration(project: ProjectState): number {
  return project.shots.reduce((acc, shot) => {
    return acc + (shot.interval?.duration || 10);
  }, 0);
}

/**
 * 创建 ZIP 文件并下载所有源资源
 */
export async function downloadSourceAssets(
  project: ProjectState,
  onProgress?: (phase: string, progress: number) => void
): Promise<void> {
  try {
    // 动态导入 JSZip
    onProgress?.('正在加载 ZIP 库...', 0);
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    // 收集所有需要下载的资源
    const assets: { url: string; path: string }[] = [];

    // 1. 角色参考图
    if (project.scriptData?.characters) {
      for (const char of project.scriptData.characters) {
        if (char.referenceImage) {
          assets.push({
            url: char.referenceImage,
            path: `characters/${char.name.replace(/[\/\\?%*:|"<>]/g, '_')}_base.jpg`
          });
        }
        // 角色变体图
        if (char.variations) {
          for (const variation of char.variations) {
            if (variation.referenceImage) {
              assets.push({
                url: variation.referenceImage,
                path: `characters/${char.name.replace(/[\/\\?%*:|"<>]/g, '_')}_${variation.name.replace(/[\/\\?%*:|"<>]/g, '_')}.jpg`
              });
            }
          }
        }
      }
    }

    // 2. 场景参考图
    if (project.scriptData?.scenes) {
      for (const scene of project.scriptData.scenes) {
        if (scene.referenceImage) {
          assets.push({
            url: scene.referenceImage,
            path: `scenes/${scene.location.replace(/[\/\\?%*:|"<>]/g, '_')}.jpg`
          });
        }
      }
    }

    // 3. 镜头关键帧图片
    if (project.shots) {
      for (let i = 0; i < project.shots.length; i++) {
        const shot = project.shots[i];
        const shotNum = String(i + 1).padStart(3, '0');
        
        if (shot.keyframes) {
          for (const keyframe of shot.keyframes) {
            if (keyframe.imageUrl) {
              assets.push({
                url: keyframe.imageUrl,
                path: `shots/shot_${shotNum}_${keyframe.type}_frame.jpg`
              });
            }
          }
        }

        // 4. 视频片段
        if (shot.interval?.videoUrl) {
          assets.push({
            url: shot.interval.videoUrl,
            path: `videos/shot_${shotNum}.mp4`
          });
        }
      }
    }

    if (assets.length === 0) {
      throw new Error('没有可下载的资源');
    }

    onProgress?.('正在下载资源...', 5);

    // 下载所有资源并添加到 ZIP
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      try {
        const blob = await downloadFile(asset.url);
        zip.file(asset.path, blob);
        
        const progress = 5 + Math.round((i + 1) / assets.length * 80);
        onProgress?.(`下载中 (${i + 1}/${assets.length})...`, progress);
      } catch (error) {
        console.error(`下载资源失败: ${asset.path}`, error);
        // 继续下载其他文件，不中断整个流程
      }
    }

    onProgress?.('正在生成 ZIP 文件...', 90);

    // 生成 ZIP 文件
    const zipBlob = await zip.generateAsync(
      { type: 'blob' },
      (metadata) => {
        const progress = 90 + Math.round(metadata.percent / 10);
        onProgress?.('正在压缩...', progress);
      }
    );

    // 触发下载
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.scriptData?.title || project.title || 'project'}_source_assets.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    onProgress?.('完成！', 100);
  } catch (error) {
    console.error('下载源资源失败:', error);
    throw error;
  }
}
