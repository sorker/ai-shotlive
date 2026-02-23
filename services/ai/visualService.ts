/**
 * 视觉资产生成服务
 * 包含美术指导文档生成、角色/场景视觉提示词生成、图像生成
 */

import { Character, Scene, AspectRatio, ArtDirection, CharacterTurnaroundPanel } from "../../types";
import { ImageApiFormat, ImageModelDefinition } from "../../types/model";
import { addRenderLogWithTokens } from '../renderLogService';
import {
  retryOperation,
  cleanJsonString,
  chatCompletion,
  checkApiKey,
  getApiBase,
  getActiveModel,
  resolveModel,
  logScriptProgress,
} from './apiCore';
import {
  getStylePrompt,
  getNegativePrompt,
  getSceneNegativePrompt,
} from './promptConstants';

// ============================================
// 美术指导文档生成
// ============================================

/**
 * 生成全局美术指导文档（Art Direction Brief）
 * 在生成任何角色/场景提示词之前调用，为整个项目建立统一的视觉风格基准。
 */
export const generateArtDirection = async (
  title: string,
  genre: string,
  logline: string,
  characters: { name: string; gender: string; age: string; personality: string }[],
  scenes: { location: string; time: string; atmosphere: string }[],
  visualStyle: string,
  language: string = '中文',
  model?: string
): Promise<ArtDirection> => {
  console.log('🎨 generateArtDirection 调用 - 生成全局美术指导文档');
  logScriptProgress('正在生成全局美术指导文档（Art Direction）...');

  const stylePrompt = getStylePrompt(visualStyle);

  const prompt = `You are a world-class Art Director for ${visualStyle} productions. 
Your job is to create a unified Art Direction Brief that will guide ALL visual prompt generation for characters, scenes, and shots in a single project. This document ensures perfect visual consistency across every generated image.

## Project Info
- Title: ${title}
- Genre: ${genre}
- Logline: ${logline}
- Visual Style: ${visualStyle} (${stylePrompt})
- Language: ${language}

## Characters
${characters.map((c, i) => `${i + 1}. ${c.name} (${c.gender}, ${c.age}, ${c.personality})`).join('\n')}

## Scenes
${scenes.map((s, i) => `${i + 1}. ${s.location} - ${s.time} - ${s.atmosphere}`).join('\n')}

## Your Task
Create a comprehensive Art Direction Brief in JSON format. This brief will be injected into EVERY subsequent visual prompt to ensure all characters and scenes share a unified look and feel.

CRITICAL RULES:
- All descriptions must be specific, concrete, and actionable for image generation AI
- The brief must define a COHESIVE visual world - characters and scenes must look like they belong to the SAME production
- Color palette must be harmonious and genre-appropriate
- Character design rules must ensure all characters share the same art style while being visually distinct from each other
- Output all descriptive text in ${language}

Output ONLY valid JSON with this exact structure:
{
  "colorPalette": {
    "primary": "primary color tone description (e.g., 'deep navy blue with slight purple undertones')",
    "secondary": "secondary color description",
    "accent": "accent/highlight color",
    "skinTones": "skin tone range for characters in this style (e.g., 'warm ivory to golden tan, with soft peach undertones')",
    "saturation": "overall saturation tendency (e.g., 'medium-high, slightly desaturated for cinematic feel')",
    "temperature": "overall color temperature (e.g., 'cool-leaning with warm accent lighting')"
  },
  "characterDesignRules": {
    "proportions": "body proportion style (e.g., '7.5 head-to-body ratio, athletic builds, realistic proportions' or '6 head ratio, stylized anime proportions')",
    "eyeStyle": "unified eye rendering approach (e.g., 'large expressive anime eyes with detailed iris reflections' or 'realistic eye proportions with cinematic catchlights')",
    "lineWeight": "line/edge style (e.g., 'clean sharp outlines with 2px weight' or 'soft edges with no visible outlines, photorealistic blending')",
    "detailLevel": "detail density (e.g., 'high detail on faces and hands, medium on clothing textures, stylized backgrounds')"
  },
  "lightingStyle": "unified lighting approach (e.g., 'three-point cinematic lighting with strong rim light, warm key light from 45-degree angle, cool fill')",
  "textureStyle": "material/texture rendering style (e.g., 'smooth cel-shaded with subtle gradient shading' or 'photorealistic with visible skin pores and fabric weave')",
  "moodKeywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "consistencyAnchors": "A single comprehensive paragraph (80-120 words) that serves as the MASTER STYLE REFERENCE. This paragraph will be prepended to every character and scene prompt to anchor the visual style. It should describe: the overall rendering quality, the specific art style fingerprint, color grading approach, lighting philosophy, and the emotional tone of the visuals. Write it as direct instructions to an image generation AI."
}`;

  try {
    const responseText = await retryOperation(() => chatCompletion(prompt, model, 0.4, 4096, 'json_object'));
    const text = cleanJsonString(responseText);
    const parsed = JSON.parse(text);

    const artDirection: ArtDirection = {
      colorPalette: {
        primary: parsed.colorPalette?.primary || '',
        secondary: parsed.colorPalette?.secondary || '',
        accent: parsed.colorPalette?.accent || '',
        skinTones: parsed.colorPalette?.skinTones || '',
        saturation: parsed.colorPalette?.saturation || '',
        temperature: parsed.colorPalette?.temperature || '',
      },
      characterDesignRules: {
        proportions: parsed.characterDesignRules?.proportions || '',
        eyeStyle: parsed.characterDesignRules?.eyeStyle || '',
        lineWeight: parsed.characterDesignRules?.lineWeight || '',
        detailLevel: parsed.characterDesignRules?.detailLevel || '',
      },
      lightingStyle: parsed.lightingStyle || '',
      textureStyle: parsed.textureStyle || '',
      moodKeywords: Array.isArray(parsed.moodKeywords) ? parsed.moodKeywords : [],
      consistencyAnchors: parsed.consistencyAnchors || '',
    };

    console.log('✅ 全局美术指导文档生成完成:', artDirection.moodKeywords.join(', '));
    logScriptProgress('全局美术指导文档生成完成');
    return artDirection;
  } catch (error: any) {
    console.error('❌ 全局美术指导文档生成失败:', error);
    logScriptProgress('美术指导文档生成失败，将使用默认风格');
    return {
      colorPalette: { primary: '', secondary: '', accent: '', skinTones: '', saturation: '', temperature: '' },
      characterDesignRules: { proportions: '', eyeStyle: '', lineWeight: '', detailLevel: '' },
      lightingStyle: '',
      textureStyle: '',
      moodKeywords: [],
      consistencyAnchors: stylePrompt,
    };
  }
};

// ============================================
// 角色视觉提示词批量生成
// ============================================

/**
 * 批量生成所有角色的视觉提示词（Batch-Aware Generation）
 */
export const generateAllCharacterPrompts = async (
  characters: Character[],
  artDirection: ArtDirection,
  genre: string,
  visualStyle: string,
  language: string = '中文',
  model?: string
): Promise<{ visualPrompt: string; negativePrompt: string }[]> => {
  console.log(`🎭 generateAllCharacterPrompts 调用 - 批量生成 ${characters.length} 个角色的视觉提示词`);
  logScriptProgress(`正在批量生成 ${characters.length} 个角色的视觉提示词（风格统一模式）...`);

  const stylePrompt = getStylePrompt(visualStyle);
  const negativePrompt = getNegativePrompt(visualStyle);

  if (characters.length === 0) return [];

  const characterList = characters.map((c, i) =>
    `Character ${i + 1} (ID: ${c.id}):
  - Name: ${c.name}
  - Gender: ${c.gender}
  - Age: ${c.age}
  - Personality: ${c.personality}`
  ).join('\n\n');

  const prompt = `You are an expert Art Director and AI prompt engineer for ${visualStyle} style image generation.
You must generate visual prompts for ALL ${characters.length} characters in a SINGLE response, ensuring they share a UNIFIED visual style while being visually distinct from each other.

## GLOBAL ART DIRECTION (MANDATORY - ALL characters MUST follow this)
${artDirection.consistencyAnchors}

### Color Palette
- Primary: ${artDirection.colorPalette.primary}
- Secondary: ${artDirection.colorPalette.secondary}
- Accent: ${artDirection.colorPalette.accent}
- Skin Tones: ${artDirection.colorPalette.skinTones}
- Saturation: ${artDirection.colorPalette.saturation}
- Temperature: ${artDirection.colorPalette.temperature}

### Character Design Rules (APPLY TO ALL)
- Proportions: ${artDirection.characterDesignRules.proportions}
- Eye Style: ${artDirection.characterDesignRules.eyeStyle}
- Line Weight: ${artDirection.characterDesignRules.lineWeight}
- Detail Level: ${artDirection.characterDesignRules.detailLevel}

### Rendering
- Lighting: ${artDirection.lightingStyle}
- Texture: ${artDirection.textureStyle}
- Mood Keywords: ${artDirection.moodKeywords.join(', ')}

## Genre: ${genre}
## Technical Quality: ${stylePrompt}

## Characters to Generate
${characterList}

## REQUIRED PROMPT STRUCTURE (for EACH character, output in ${language}):
1. Core Identity: [ethnicity, age, gender, body type - MUST follow proportions rule above]
2. Facial Features: [specific distinguishing features - eyes MUST follow eye style rule, nose, face shape, skin tone MUST use palette skin tones]
3. Hairstyle: [detailed hair description - color, length, style]
4. Clothing: [detailed outfit appropriate for ${genre} genre, colors MUST harmonize with palette]
5. Pose & Expression: [body language and facial expression matching personality]
6. Technical Quality: ${stylePrompt}

## CRITICAL CONSISTENCY RULES:
1. ALL characters MUST share the SAME art style as defined by the Art Direction above.
2. ALL characters' color schemes MUST harmonize within the defined color palette.
3. ALL characters MUST use the SAME proportions: ${artDirection.characterDesignRules.proportions}
4. ALL characters MUST use the SAME line/edge style: ${artDirection.characterDesignRules.lineWeight}
5. ALL characters MUST have the SAME detail density: ${artDirection.characterDesignRules.detailLevel}
6. Each character should be VISUALLY DISTINCT from others through clothing, hair color, accessories, and body language
   - but STYLISTICALLY UNIFIED in rendering quality, detail density, color harmony, and art style.
7. Skin tone descriptions must be from the same tonal family: ${artDirection.colorPalette.skinTones}
8. Sections 1-3 (Core Identity, Facial Features, Hairstyle) are FIXED features for each character for consistency across all variations.

## OUTPUT FORMAT
Output ONLY valid JSON with this structure:
{
  "characters": [
    {
      "id": "character_id",
      "visualPrompt": "single paragraph, comma-separated, 60-90 words, MUST include ${visualStyle} style keywords"
    }
  ]
}

The "characters" array MUST have exactly ${characters.length} items, in the SAME ORDER as the input.
Output ONLY the JSON, no explanations.`;

  try {
    const responseText = await retryOperation(() => chatCompletion(prompt, model, 0.4, 4096, 'json_object'));
    const text = cleanJsonString(responseText);
    const parsed = JSON.parse(text);

    const results: { visualPrompt: string; negativePrompt: string }[] = [];
    const charResults = Array.isArray(parsed.characters) ? parsed.characters : [];

    for (let i = 0; i < characters.length; i++) {
      const charResult = charResults[i];
      if (charResult && charResult.visualPrompt) {
        results.push({
          visualPrompt: charResult.visualPrompt.trim(),
          negativePrompt: negativePrompt,
        });
        console.log(`  ✅ 角色 ${characters[i].name} 提示词生成成功`);
      } else {
        console.warn(`  ⚠️ 角色 ${characters[i].name} 在批量结果中缺失，将使用后备方案`);
        results.push({
          visualPrompt: '',
          negativePrompt: negativePrompt,
        });
      }
    }

    console.log(`✅ 批量角色视觉提示词生成完成: ${results.filter(r => r.visualPrompt).length}/${characters.length} 成功`);
    logScriptProgress(`角色视觉提示词批量生成完成 (${results.filter(r => r.visualPrompt).length}/${characters.length})`);
    return results;
  } catch (error: any) {
    console.error('❌ 批量角色视觉提示词生成失败:', error);
    logScriptProgress('批量角色提示词生成失败，将回退到逐个生成模式');
    return characters.map(() => ({ visualPrompt: '', negativePrompt: negativePrompt }));
  }
};

// ============================================
// 单个角色/场景视觉提示词生成
// ============================================

/**
 * 生成角色或场景的视觉提示词
 */
export const generateVisualPrompts = async (
  type: 'character' | 'scene',
  data: Character | Scene,
  genre: string,
  model?: string,
  visualStyle: string = 'live-action',
  language: string = '中文',
  artDirection?: ArtDirection
): Promise<{ visualPrompt: string; negativePrompt: string }> => {
  const stylePrompt = getStylePrompt(visualStyle);
  const negativePrompt = type === 'scene'
    ? getSceneNegativePrompt(visualStyle)
    : getNegativePrompt(visualStyle);

  // 构建 Art Direction 注入段落
  const artDirectionBlock = artDirection ? `
## GLOBAL ART DIRECTION (MANDATORY - MUST follow this for visual consistency)
${artDirection.consistencyAnchors}

Color Palette: Primary=${artDirection.colorPalette.primary}, Secondary=${artDirection.colorPalette.secondary}, Accent=${artDirection.colorPalette.accent}
Color Temperature: ${artDirection.colorPalette.temperature}, Saturation: ${artDirection.colorPalette.saturation}
Lighting: ${artDirection.lightingStyle}
Texture: ${artDirection.textureStyle}
Mood Keywords: ${artDirection.moodKeywords.join(', ')}
` : '';

  let prompt: string;

  if (type === 'character') {
    const char = data as Character;
    prompt = `You are an expert AI prompt engineer for ${visualStyle} style image generation.
${artDirectionBlock}
Create a detailed visual prompt for a character with the following structure:

Character Data:
- Name: ${char.name}
- Gender: ${char.gender}
- Age: ${char.age}
- Personality: ${char.personality}

REQUIRED STRUCTURE (output in ${language}):
1. Core Identity: [ethnicity, age, gender, body type${artDirection ? ` - MUST follow proportions: ${artDirection.characterDesignRules.proportions}` : ''}]
2. Facial Features: [specific distinguishing features - eyes${artDirection ? ` (MUST follow eye style: ${artDirection.characterDesignRules.eyeStyle})` : ''}, nose, face shape, skin tone${artDirection ? ` (MUST use skin tones from: ${artDirection.colorPalette.skinTones})` : ''}]
3. Hairstyle: [detailed hair description - color, length, style]
4. Clothing: [detailed outfit appropriate for ${genre} genre${artDirection ? `, colors MUST harmonize with palette: ${artDirection.colorPalette.primary}, ${artDirection.colorPalette.secondary}` : ''}]
5. Pose & Expression: [body language and facial expression matching personality]
6. Technical Quality: ${stylePrompt}

CRITICAL RULES:
- Sections 1-3 are FIXED features for consistency across all variations${artDirection ? `
- MUST follow the Global Art Direction above for style consistency
- Line/edge style: ${artDirection.characterDesignRules.lineWeight}
- Detail density: ${artDirection.characterDesignRules.detailLevel}` : ''}
- Use specific, concrete visual details
- Output as single paragraph, comma-separated
- MUST include style keywords: ${visualStyle}
- Length: 60-90 words
- Focus on visual details that can be rendered in images

Output ONLY the visual prompt text, no explanations.`;
  } else {
    const scene = data as Scene;
    prompt = `You are an expert cinematographer and AI prompt engineer for ${visualStyle} productions.
${artDirectionBlock}
Create a cinematic scene/environment prompt with this structure:

Scene Data:
- Location: ${scene.location}
- Time: ${scene.time}
- Atmosphere: ${scene.atmosphere}
- Genre: ${genre}

REQUIRED STRUCTURE (output in ${language}):
1. Environment: [detailed location description with architectural/natural elements, props, furniture, vehicles, or objects that tell the story of the space]
2. Lighting: [specific lighting setup${artDirection ? ` - MUST follow project lighting style: ${artDirection.lightingStyle}` : ' - direction, color temperature, quality (soft/hard), key light source'}]
3. Composition: [camera angle (eye-level/low/high), framing rules (rule of thirds/symmetry), depth layers]
4. Atmosphere: [mood, weather, particles in air (fog/dust/rain), environmental effects]
5. Color Palette: [${artDirection ? `MUST use project palette - Primary: ${artDirection.colorPalette.primary}, Secondary: ${artDirection.colorPalette.secondary}, Accent: ${artDirection.colorPalette.accent}, Temperature: ${artDirection.colorPalette.temperature}` : 'dominant colors, color temperature (warm/cool), saturation level'}]
6. Technical Quality: ${stylePrompt}

CRITICAL RULES:
- ⚠️ ABSOLUTELY NO PEOPLE, CHARACTERS, HUMAN FIGURES, OR SILHOUETTES in the scene - this is a PURE ENVIRONMENT/BACKGROUND shot
- The scene must be an EMPTY environment - no humans, no crowds, no pedestrians, no figures in the distance${artDirection ? `
- ⚠️ MUST follow the Global Art Direction above - this scene must visually match the same project as all characters
- Texture/material rendering: ${artDirection.textureStyle}
- Mood: ${artDirection.moodKeywords.join(', ')}` : ''}
- Use professional cinematography terminology
- Specify light sources and direction (e.g., "golden hour backlight from right")
- Include composition guidelines (rule of thirds, leading lines, depth of field)
- You may include environmental storytelling elements (e.g., an abandoned coffee cup, footprints in snow, a parked car) to make the scene feel lived-in without showing people
- Output as single paragraph, comma-separated
- MUST emphasize ${visualStyle} style throughout
- Length: 70-110 words
- Focus on elements that establish mood and cinematic quality

Output ONLY the visual prompt text, no explanations.`;
  }

  const visualPrompt = await retryOperation(() => chatCompletion(prompt, model, 0.5, 1024));

  return {
    visualPrompt: visualPrompt.trim(),
    negativePrompt: negativePrompt
  };
};

// ============================================
// 图像生成
// ============================================

/**
 * 生成图像
 * 使用图像生成API，支持参考图像确保角色和场景一致性
 */
/**
 * 判断字符串是否为 http(s) URL
 */
const isHttpUrl = (s: string): boolean => /^https?:\/\//i.test(s);

/**
 * 图片 URL 缓存：base64 指纹 → TOS URL
 * 用于在同一会话中将 base64 参考图映射回可被 API 访问的 URL
 * 豆包 Seedream API 的 image 参数仅接受 URL，不支持 base64 输入
 */
const imageUrlCache = new Map<string, string>();
const getImageFingerprint = (dataUrl: string): string => dataUrl.substring(0, 300);

/**
 * 根据 base64 data URL 查找已缓存的 TOS URL
 */
const getCachedUrl = (dataUrl: string): string | undefined => {
  return imageUrlCache.get(getImageFingerprint(dataUrl));
};

/**
 * 缓存 base64 data URL 对应的 TOS URL
 */
const cacheImageUrl = (dataUrl: string, tosUrl: string): void => {
  imageUrlCache.set(getImageFingerprint(dataUrl), tosUrl);
};

/**
 * 将已知会触发 CORS 的外部 URL 改写为本地代理路径
 */
const rewriteToProxy = (url: string): string => {
  const volcTosHost = 'ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com';
  try {
    const u = new URL(url);
    if (u.host === volcTosHost) {
      return `/api/proxy/volcengine-tos${u.pathname}${u.search}`;
    }
  } catch { /* 非法 URL，原样返回 */ }
  return url;
};

/**
 * 尝试将 URL 图片下载并转换为 data URL
 * 对已知 CORS 受限域名自动走本地代理
 */
const downloadUrlToDataUrl = async (url: string): Promise<string> => {
  const proxyUrl = rewriteToProxy(url);

  // 方法1：fetch 下载（优先走代理地址）
  try {
    const res = await fetch(proxyUrl);
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.startsWith('image/')) {
        const blob = await res.blob();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('FileReader 读取失败'));
          reader.readAsDataURL(blob);
        });
      }
    }
    // 非 200 或非图片响应（签名 URL 过期时 TOS 返回 403 XML）
  } catch (e) {
    // fetch 被 CORS 拦截或网络错误，尝试 img+canvas
  }

  // 方法2：img+canvas（部分 CDN 支持 crossOrigin 但不支持 fetch CORS）
  try {
    return await new Promise<string>((resolve, reject) => {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('canvas 创建失败')); return; }
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('img 跨域加载失败'));
      img.src = proxyUrl;
    });
  } catch (e) {
    // 两种方法都失败
  }

  // 检查是否为已过期的签名 URL
  const isSignedUrl = url.includes('X-Tos-Expires') || url.includes('Expires=');
  const hint = isSignedUrl ? '（签名 URL 可能已过期，请重新生成参考图）' : '';
  throw new Error(`无法下载图片${hint}: ${url.substring(0, 80)}...`);
};

/**
 * 规范化参考图片数组
 * - URL 图片：尝试下载转 base64，失败则保留原始 URL
 * - 纯 base64：加上 data URL 前缀
 * - data URL：保持不变
 * 返回 { dataUrls: 成功转为 data URL 的图片, rawUrls: 无法转换的 URL }
 */
const normalizeReferenceImages = async (referenceImages: string[]): Promise<{
  dataUrls: string[];
  rawUrls: string[];
}> => {
  const dataUrls: string[] = [];
  const rawUrls: string[] = [];

  for (const img of referenceImages) {
    if (!img || img.length === 0) continue;

    if (isHttpUrl(img)) {
      try {
        const dataUrl = await downloadUrlToDataUrl(img);
        dataUrls.push(dataUrl);
      } catch (e) {
        const isSignedUrl = img.includes('X-Tos-Expires') || img.includes('Signature=');
        if (isSignedUrl) {
          // 签名 URL 下载失败（很可能已过期），不传给 API 以避免 400 错误
          console.warn('⚠️ 参考图签名 URL 已过期或无法下载，已跳过。请重新生成该参考图:', img.substring(0, 80));
        } else {
          // 非签名 URL，仍尝试传给 API 让服务端下载
          console.warn('⚠️ 参考图下载失败，将以 URL 形式传递给 API:', (e as Error).message);
          rawUrls.push(img);
        }
      }
    } else if (img.startsWith('data:image/')) {
      dataUrls.push(img);
    } else {
      // 纯 base64 字符串，推断 MIME 类型
      if (img.startsWith('/9j/')) dataUrls.push(`data:image/jpeg;base64,${img}`);
      else if (img.startsWith('iVBORw')) dataUrls.push(`data:image/png;base64,${img}`);
      else if (img.startsWith('R0lGOD')) dataUrls.push(`data:image/gif;base64,${img}`);
      else if (img.startsWith('UklGR')) dataUrls.push(`data:image/webp;base64,${img}`);
      else dataUrls.push(`data:image/png;base64,${img}`);
    }
  }

  return { dataUrls, rawUrls };
};

/**
 * 清理 API Key，避免 "Bearer Bearer xxx" 的双重前缀问题
 */
const sanitizeBearerToken = (apiKey: string): string => {
  return 'Bearer ' + apiKey.replace(/Bearer\s+/gi, '').trim();
};

/**
 * 使用 OpenAI / 火山引擎兼容的 /images/generations 格式生成图片
 */
const generateImageOpenAI = async (
  prompt: string,
  referenceImages: string[],
  aspectRatio: AspectRatio,
  apiKey: string,
  apiBase: string,
  endpoint: string,
  modelId: string,
  startTime: number
): Promise<string> => {
  const requestBody: Record<string, any> = {
    model: modelId,
    prompt: prompt,
    size: '2K',
    response_format: 'url',
    sequential_image_generation: 'disabled',
    stream: false,
    watermark: false,
  };

  // 豆包 Seedream API 的 image 参数只接受 URL（不支持 base64 输入）
  // 对 base64 参考图尝试从缓存中查找对应的 TOS URL
  if (referenceImages.length > 0) {
    const validUrls: string[] = [];
    let skippedCount = 0;
    for (const img of referenceImages) {
      if (!img || img.length === 0) continue;
      if (isHttpUrl(img)) {
        validUrls.push(img);
      } else {
        // base64 / data URL：尝试从缓存查找对应的 TOS URL
        const cachedUrl = getCachedUrl(img);
        if (cachedUrl) {
          validUrls.push(cachedUrl);
        } else {
          skippedCount++;
        }
      }
    }
    if (skippedCount > 0) {
      console.warn(`⚠️ 跳过 ${skippedCount} 张参考图（豆包 Seedream API 仅支持 URL，且无缓存 URL 可用）`);
    }
    if (validUrls.length > 0) {
      requestBody.image = validUrls;
    }
  }

  let response: any;
  try {
    response = await retryOperation(async () => {
      const res = await fetch(`${apiBase}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': sanitizeBearerToken(apiKey),
        },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) {
        let errorMessage = `HTTP错误: ${res.status}`;
        try {
          const errorData = await res.json();
          errorMessage = errorData.error?.message || errorData.message || errorMessage;
        } catch (e) {
          try {
            const errorText = await res.text();
            if (errorText) errorMessage = errorText;
          } catch { /* ignore */ }
        }
        const err: any = new Error(errorMessage);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    });
  } catch (fetchError: any) {
    if (fetchError.message?.includes('Failed to fetch') || (fetchError.name === 'TypeError' && !fetchError.status)) {
      throw new Error(
        `无法连接到 ${apiBase}（浏览器跨域限制）。` +
        `该提供商的 API 不支持浏览器直接调用。` +
        `请在模型配置中将该模型的提供商切换为支持浏览器调用的代理服务（如 AiShotlive API）。`
      );
    }
    throw fetchError;
  }

  const items = response?.data;
  if (Array.isArray(items) && items.length > 0) {
    const item = items[0];

    // 处理 b64_json 响应（兼容其他 OpenAI 兼容 API）
    if (item.b64_json) {
      const result = `data:image/png;base64,${item.b64_json}`;
      addRenderLogWithTokens({
        type: 'keyframe',
        resourceId: 'image-' + Date.now(),
        resourceName: prompt.substring(0, 50) + '...',
        status: 'success',
        model: modelId,
        prompt: prompt,
        duration: Date.now() - startTime,
      });
      return result;
    }

    // 处理 URL 响应：通过本地代理下载转 base64（持久化存储），
    // 同时缓存 TOS URL → base64 映射，以便后续作为参考图传给 API
    if (item.url) {
      const originalUrl = item.url;
      let imageResult = originalUrl;
      const proxiedUrl = rewriteToProxy(originalUrl);
      try {
        const imgRes = await fetch(proxiedUrl);
        if (imgRes.ok) {
          const blob = await imgRes.blob();
          imageResult = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error('图片转码失败'));
            reader.readAsDataURL(blob);
          });
          // 缓存 base64 → URL 映射，供后续 API 调用使用
          cacheImageUrl(imageResult, originalUrl);
        }
      } catch (e) {
        console.warn('fetch 下载图片失败，尝试 img+canvas 方式:', e);
        try {
          imageResult = await new Promise<string>((resolve, reject) => {
            const img = new window.Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
              const ctx = canvas.getContext('2d');
              if (!ctx) { reject(new Error('canvas 创建失败')); return; }
              ctx.drawImage(img, 0, 0);
              resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => reject(new Error('img 加载失败'));
            img.src = proxiedUrl;
          });
          cacheImageUrl(imageResult, originalUrl);
        } catch (e2) {
          console.warn('img+canvas 转换也失败，保留原始 URL:', e2);
        }
      }
      addRenderLogWithTokens({
        type: 'keyframe',
        resourceId: 'image-' + Date.now(),
        resourceName: prompt.substring(0, 50) + '...',
        status: 'success',
        model: modelId,
        prompt: prompt,
        duration: Date.now() - startTime,
      });
      return imageResult;
    }
  }

  throw new Error('图片生成失败：未能从响应中提取图片数据');
};

export const generateImage = async (
  prompt: string,
  referenceImages: string[] = [],
  aspectRatio: AspectRatio = '16:9',
  isVariation: boolean = false,
  hasTurnaround: boolean = false
): Promise<string> => {
  const startTime = Date.now();

  const activeImageModel = getActiveModel('image') as ImageModelDefinition | undefined;
  const imageModelId = activeImageModel?.apiModel || activeImageModel?.id || 'gemini-3-pro-image-preview';
  const imageModelEndpoint = activeImageModel?.endpoint || `/v1beta/models/${imageModelId}:generateContent`;
  const apiKey = checkApiKey('image', activeImageModel?.id);
  const apiBase = getApiBase('image', activeImageModel?.id);

  const apiFormat: ImageApiFormat = (activeImageModel?.params as any)?.apiFormat || 'gemini';

  // ── OpenAI / 火山引擎兼容格式 ──
  if (apiFormat === 'openai-image') {
    try {
      return await generateImageOpenAI(
        prompt, referenceImages, aspectRatio,
        apiKey, apiBase, imageModelEndpoint, imageModelId, startTime
      );
    } catch (error: any) {
      addRenderLogWithTokens({
        type: 'keyframe',
        resourceId: 'image-' + Date.now(),
        resourceName: prompt.substring(0, 50) + '...',
        status: 'failed',
        model: imageModelId,
        prompt: prompt,
        error: error.message,
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  // ── Gemini generateContent 格式（默认） ──
  try {
    let finalPrompt = prompt;
    if (referenceImages.length > 0) {
      if (isVariation) {
        finalPrompt = `
      ⚠️⚠️⚠️ CRITICAL REQUIREMENTS - CHARACTER OUTFIT VARIATION ⚠️⚠️⚠️
      
      Reference Images Information:
      - The provided image shows the CHARACTER's BASE APPEARANCE that you MUST use as reference for FACE ONLY.
      
      Task:
      Generate a character image with a NEW OUTFIT/COSTUME based on this description: "${prompt}".
      
      ⚠️ ABSOLUTE REQUIREMENTS (NON-NEGOTIABLE):
      
      1. FACE & IDENTITY - MUST BE 100% IDENTICAL TO REFERENCE:
         • Facial Features: Eyes (color, shape, size), nose structure, mouth shape, facial contours must be EXACTLY the same
         • Hairstyle & Hair Color: Length, color, texture, and style must be PERFECTLY matched (unless prompt specifies hair change)
         • Skin tone and facial structure: MUST remain identical
         • Expression can vary based on prompt
         
      2. OUTFIT/CLOTHING - MUST BE COMPLETELY DIFFERENT FROM REFERENCE:
         • Generate NEW clothing/outfit as described in the prompt
         • DO NOT copy the clothing from the reference image
         • The outfit should match the description provided: "${prompt}"
         • Include all accessories, props, or costume details mentioned in the prompt
         
      3. Body proportions should remain consistent with the reference.
      
      ⚠️ This is an OUTFIT VARIATION task - The face MUST match the reference, but the CLOTHES MUST be NEW as described!
      ⚠️ If the new outfit is not clearly visible and different from the reference, the task has FAILED!
    `;
      } else {
        const turnaroundGuide = hasTurnaround ? `
      4. CHARACTER TURNAROUND SHEET - MULTI-ANGLE REFERENCE:
         Some character reference images are provided as a 3x3 TURNAROUND SHEET (9-panel grid showing the SAME character from different angles: front, side, back, 3/4 view, close-up, etc.).
         ⚠️ This turnaround sheet is your MOST IMPORTANT reference for character consistency!
         • Use the panel that best matches the CAMERA ANGLE of this shot (e.g., if the shot is from behind, refer to the back-view panel)
         • The character's face, hair, clothing, and body proportions must match ALL panels in the turnaround sheet
         • The turnaround sheet takes priority over single character reference images for angle-specific details
         ` : '';

        finalPrompt = `
      ⚠️⚠️⚠️ CRITICAL REQUIREMENTS - CHARACTER CONSISTENCY ⚠️⚠️⚠️
      
      Reference Images Information:
      - The FIRST image is the Scene/Environment reference.
      - Subsequent images are Character references (Base Look or Variation).${hasTurnaround ? '\n      - Some character images are 3x3 TURNAROUND SHEETS showing the character from 9 different angles (front, side, back, close-up, etc.).' : ''}
      - Any remaining images after characters are Prop/Item references (objects that must appear consistently).
      
      Task:
      Generate a cinematic shot matching this prompt: "${prompt}".
      
      ⚠️ ABSOLUTE REQUIREMENTS (NON-NEGOTIABLE):
      1. Scene Consistency:
         - STRICTLY maintain the visual style, lighting, and environment from the scene reference.
      
      2. Character Consistency - HIGHEST PRIORITY:
         If characters are present in the prompt, they MUST be IDENTICAL to the character reference images:
         • Facial Features: Eyes (color, shape, size), nose structure, mouth shape, facial contours must be EXACTLY the same
         • Hairstyle & Hair Color: Length, color, texture, and style must be PERFECTLY matched
         • Clothing & Outfit: Style, color, material, and accessories must be IDENTICAL
         • Body Type: Height, build, proportions must remain consistent
      
      3. Prop/Item Consistency:
         If prop reference images are provided, the objects/items in the shot MUST match the reference:
         • Shape & Form: The prop's shape, size, and proportions must be identical to the reference
         • Color & Material: Colors, textures, and materials must be consistent
         • Details: Patterns, text, decorations, and distinguishing features must match exactly
      ${turnaroundGuide}
      ⚠️ DO NOT create variations or interpretations of the character - STRICT REPLICATION ONLY!
      ⚠️ Character appearance consistency is THE MOST IMPORTANT requirement!
      ⚠️ Props/items must also maintain visual consistency with their reference images!
    `;
      }
    }

    const parts: any[] = [{ text: finalPrompt }];

    // 规范化参考图（URL 会被下载转 base64）
    const { dataUrls: geminiDataUrls } = await normalizeReferenceImages(referenceImages);
    geminiDataUrls.forEach((imgUrl) => {
      const match = imgUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (match) {
        parts.push({
          inlineData: {
            mimeType: match[1],
            data: match[2]
          }
        });
      }
    });

    const requestBody: any = {
      contents: [{
        role: "user",
        parts: parts
      }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"]
      }
    };

    if (aspectRatio !== '16:9') {
      requestBody.generationConfig.imageConfig = {
        aspectRatio: aspectRatio
      };
    }

    const response = await retryOperation(async () => {
      const res = await fetch(`${apiBase}${imageModelEndpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Accept': '*/*'
        },
        body: JSON.stringify(requestBody)
      });

      if (!res.ok) {
        if (res.status === 400) {
          throw new Error('提示词可能包含不安全或违规内容，未能处理。请修改后重试。');
        }
        else if (res.status === 500) {
          throw new Error('当前请求较多，暂时未能处理成功，请稍后重试。');
        }

        let errorMessage = `HTTP错误: ${res.status}`;
        try {
          const errorData = await res.json();
          errorMessage = errorData.error?.message || errorMessage;
        } catch (e) {
          const errorText = await res.text();
          if (errorText) errorMessage = errorText;
        }
        throw new Error(errorMessage);
      }

      return await res.json();
    });

    const candidates = response.candidates || [];
    if (candidates.length > 0 && candidates[0].content && candidates[0].content.parts) {
      for (const part of candidates[0].content.parts) {
        if (part.inlineData) {
          const result = `data:image/png;base64,${part.inlineData.data}`;

          addRenderLogWithTokens({
            type: 'keyframe',
            resourceId: 'image-' + Date.now(),
            resourceName: prompt.substring(0, 50) + '...',
            status: 'success',
            model: imageModelId,
            prompt: prompt,
            duration: Date.now() - startTime
          });

          return result;
        }
      }
    }

    throw new Error("图片生成失败 (No image data returned)");
  } catch (error: any) {
    addRenderLogWithTokens({
      type: 'keyframe',
      resourceId: 'image-' + Date.now(),
      resourceName: prompt.substring(0, 50) + '...',
      status: 'failed',
      model: imageModelId,
      prompt: prompt,
      error: error.message,
      duration: Date.now() - startTime
    });

    throw error;
  }
};

// ============================================
// 角色九宫格造型设计（Turnaround Sheet）
// ============================================

/**
 * 角色九宫格造型设计 - 默认视角布局
 * 覆盖常用的拍摄角度，确保角色从各方向都有参考
 */
export const CHARACTER_TURNAROUND_LAYOUT = {
  panelCount: 9,
  defaultPanels: [
    { index: 0, viewAngle: '正面', shotSize: '全身', description: '' },
    { index: 1, viewAngle: '正面', shotSize: '半身特写', description: '' },
    { index: 2, viewAngle: '正面', shotSize: '面部特写', description: '' },
    { index: 3, viewAngle: '左侧面', shotSize: '全身', description: '' },
    { index: 4, viewAngle: '右侧面', shotSize: '全身', description: '' },
    { index: 5, viewAngle: '3/4侧面', shotSize: '半身', description: '' },
    { index: 6, viewAngle: '背面', shotSize: '全身', description: '' },
    { index: 7, viewAngle: '仰视', shotSize: '半身', description: '' },
    { index: 8, viewAngle: '俯视', shotSize: '半身', description: '' },
  ],
  viewAngles: ['正面', '左侧面', '右侧面', '3/4左侧', '3/4右侧', '背面', '仰视', '俯视', '斜后方'],
  shotSizes: ['全身', '半身', '半身特写', '面部特写', '大特写'],
  positionLabels: [
    '左上 (Top-Left)', '中上 (Top-Center)', '右上 (Top-Right)',
    '左中 (Middle-Left)', '正中 (Center)', '右中 (Middle-Right)',
    '左下 (Bottom-Left)', '中下 (Bottom-Center)', '右下 (Bottom-Right)'
  ],
};

/**
 * 生成角色九宫格造型描述（AI拆分9个视角）
 * 根据角色信息和视觉提示词，生成9个不同视角的详细描述
 */
export const generateCharacterTurnaroundPanels = async (
  character: Character,
  visualStyle: string,
  artDirection?: ArtDirection,
  language: string = '中文',
  model?: string
): Promise<CharacterTurnaroundPanel[]> => {
  console.log(`🎭 generateCharacterTurnaroundPanels - 为角色 ${character.name} 生成九宫格造型视角`);
  logScriptProgress(`正在为角色「${character.name}」生成九宫格造型视角描述...`);

  const stylePrompt = getStylePrompt(visualStyle);

  // 构建 Art Direction 注入
  const artDirectionBlock = artDirection ? `
## GLOBAL ART DIRECTION (MANDATORY)
${artDirection.consistencyAnchors}
Color Palette: Primary=${artDirection.colorPalette.primary}, Secondary=${artDirection.colorPalette.secondary}, Accent=${artDirection.colorPalette.accent}
Character Design: Proportions=${artDirection.characterDesignRules.proportions}, Eye Style=${artDirection.characterDesignRules.eyeStyle}
Lighting: ${artDirection.lightingStyle}, Texture: ${artDirection.textureStyle}
` : '';

  const prompt = `You are an expert character designer and Art Director for ${visualStyle} productions.
Your task is to create a CHARACTER TURNAROUND SHEET - a 3x3 grid (9 panels) showing the SAME character from 9 different angles and distances.

This is for maintaining character consistency across multiple shots in video production.

${artDirectionBlock}
## Character Information
- Name: ${character.name}
- Gender: ${character.gender}
- Age: ${character.age}
- Personality: ${character.personality}
- Visual Description: ${character.visualPrompt || 'Not specified'}

## Visual Style: ${visualStyle} (${stylePrompt})

## REQUIRED 9 PANELS LAYOUT:
Panel 0 (Top-Left): 正面/全身 - Front view, full body
Panel 1 (Top-Center): 正面/半身特写 - Front view, upper body close-up
Panel 2 (Top-Right): 正面/面部特写 - Front view, face close-up
Panel 3 (Middle-Left): 左侧面/全身 - Left profile, full body
Panel 4 (Middle-Center): 右侧面/全身 - Right profile, full body
Panel 5 (Middle-Right): 3/4侧面/半身 - Three-quarter view, upper body
Panel 6 (Bottom-Left): 背面/全身 - Back view, full body
Panel 7 (Bottom-Center): 仰视/半身 - Low angle looking up, upper body
Panel 8 (Bottom-Right): 俯视/半身 - High angle looking down, upper body

## YOUR TASK:
For each of the 9 panels, write a detailed visual description of the character from that specific angle.

CRITICAL RULES:
- The character's appearance (face, hair, clothing, accessories, body proportions) MUST be EXACTLY the same across ALL 9 panels
- Each description MUST specify the exact viewing angle and distance
- Include specific details about what is visible from that angle (e.g., back of hairstyle, side profile of face, clothing details visible from that angle)
- Descriptions should be written in a way that helps image generation AI render the character consistently
- Each description should be 30-50 words, written in English, as direct image generation prompts
- Include character pose and expression appropriate for a neutral/characteristic reference sheet pose
- Include the ${visualStyle} style keywords in each description

Output ONLY valid JSON:
{
  "panels": [
    {
      "index": 0,
      "viewAngle": "正面",
      "shotSize": "全身",
      "description": "Front full-body view of [character], standing in a neutral pose..."
    }
  ]
}

The "panels" array MUST have exactly 9 items (index 0-8).`;

  try {
    const responseText = await retryOperation(() => chatCompletion(prompt, model, 0.4, 4096, 'json_object'));
    const text = cleanJsonString(responseText);
    const parsed = JSON.parse(text);

    const panels: CharacterTurnaroundPanel[] = [];
    const rawPanels = Array.isArray(parsed.panels) ? parsed.panels : [];

    for (let i = 0; i < 9; i++) {
      const raw = rawPanels[i];
      if (raw) {
        panels.push({
          index: i,
          viewAngle: raw.viewAngle || CHARACTER_TURNAROUND_LAYOUT.defaultPanels[i].viewAngle,
          shotSize: raw.shotSize || CHARACTER_TURNAROUND_LAYOUT.defaultPanels[i].shotSize,
          description: raw.description || '',
        });
      } else {
        panels.push({
          ...CHARACTER_TURNAROUND_LAYOUT.defaultPanels[i],
          description: `${character.visualPrompt || character.name}, ${CHARACTER_TURNAROUND_LAYOUT.defaultPanels[i].viewAngle} view, ${CHARACTER_TURNAROUND_LAYOUT.defaultPanels[i].shotSize}`,
        });
      }
    }

    console.log(`✅ 角色 ${character.name} 九宫格造型视角描述生成完成`);
    logScriptProgress(`角色「${character.name}」九宫格视角描述生成完成`);
    return panels;
  } catch (error: any) {
    console.error(`❌ 角色 ${character.name} 九宫格视角描述生成失败:`, error);
    logScriptProgress(`角色「${character.name}」九宫格视角描述生成失败`);
    throw error;
  }
};

/**
 * 生成角色九宫格造型图片
 * 将9个视角描述合成为一张3x3九宫格图片
 */
export const generateCharacterTurnaroundImage = async (
  character: Character,
  panels: CharacterTurnaroundPanel[],
  visualStyle: string,
  referenceImage?: string,
  artDirection?: ArtDirection
): Promise<string> => {
  console.log(`🖼️ generateCharacterTurnaroundImage - 为角色 ${character.name} 生成九宫格造型图片`);
  logScriptProgress(`正在为角色「${character.name}」生成九宫格造型图片...`);

  const stylePrompt = getStylePrompt(visualStyle);

  // 构建九宫格图片生成提示词
  const panelDescriptions = panels.map((p, idx) => {
    const position = CHARACTER_TURNAROUND_LAYOUT.positionLabels[idx];
    return `Panel ${idx + 1} (${position}): [${p.viewAngle} / ${p.shotSize}] - ${p.description}`;
  }).join('\n');

  const artDirectionSuffix = artDirection
    ? `\nArt Direction Style Anchors: ${artDirection.consistencyAnchors}\nLighting: ${artDirection.lightingStyle}\nTexture: ${artDirection.textureStyle}`
    : '';

  const prompt = `Generate a SINGLE image composed as a CHARACTER TURNAROUND/REFERENCE SHEET with a 3x3 grid layout (9 equal panels).
The image shows the SAME CHARACTER from 9 DIFFERENT viewing angles and distances.
Each panel is separated by thin white borders.
This is a professional character design reference sheet for animation/film production.

Visual Style: ${visualStyle} (${stylePrompt})

Character: ${character.name} - ${character.visualPrompt || `${character.gender}, ${character.age}, ${character.personality}`}

Grid Layout (left to right, top to bottom):
${panelDescriptions}

CRITICAL REQUIREMENTS:
- The output MUST be a SINGLE image divided into exactly 9 equal rectangular panels in a 3x3 grid layout
- Each panel MUST have a thin white border/separator (2-3px) between panels
- ALL 9 panels show the EXACT SAME CHARACTER with IDENTICAL appearance:
  * Same face features (eyes, nose, mouth, face shape) - ABSOLUTELY IDENTICAL across all panels
  * Same hairstyle and hair color - NO variation allowed
  * Same clothing and accessories - EXACTLY the same outfit in every panel
  * Same body proportions and build
  * Same skin tone and complexion
- The ONLY difference between panels is the VIEWING ANGLE and DISTANCE
- Use a clean, neutral background (solid color or subtle gradient) to emphasize the character
- Each panel should be a well-composed, professional-quality character reference
- Maintain consistent lighting across all panels for accurate color reference
- Character should have a neutral/characteristic pose appropriate for a reference sheet${artDirectionSuffix}

⚠️ CHARACTER CONSISTENCY IS THE #1 PRIORITY - The character must look like the EXACT SAME PERSON in all 9 panels!`;

  // 收集参考图片
  const referenceImages: string[] = [];
  if (referenceImage) {
    referenceImages.push(referenceImage);
  } else if (character.referenceImage) {
    referenceImages.push(character.referenceImage);
  }

  try {
    // 使用 1:1 比例生成九宫格（正方形最适合3x3网格）
    const imageUrl = await generateImage(prompt, referenceImages, '1:1');
    console.log(`✅ 角色 ${character.name} 九宫格造型图片生成完成`);
    logScriptProgress(`角色「${character.name}」九宫格造型图片生成完成`);
    return imageUrl;
  } catch (error: any) {
    console.error(`❌ 角色 ${character.name} 九宫格造型图片生成失败:`, error);
    logScriptProgress(`角色「${character.name}」九宫格造型图片生成失败`);
    throw error;
  }
};
