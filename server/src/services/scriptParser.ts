/**
 * 服务端剧本解析器
 *
 * 将前端的 parseScriptToData + generateShotList 流程迁移到后端，
 * 使得刷新页面不会中断生成过程。
 *
 * 使用 serverChatCompletion 进行所有 AI 调用。
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { serverChatCompletion } from './aiProxy.js';

// ============================================
// 类型
// ============================================

interface ModelConfig {
  apiBase: string;
  apiKey: string;
  endpoint: string;
  model: string;
}

interface Character {
  id: string;
  name: string;
  gender: string;
  age: string;
  personality: string;
  visualPrompt?: string;
  negativePrompt?: string;
  variations?: any[];
}

interface Scene {
  id: string;
  location: string;
  time: string;
  atmosphere: string;
  visualPrompt?: string;
  negativePrompt?: string;
}

interface ArtDirection {
  colorPalette: { primary: string; secondary: string; accent: string; skinTones: string; saturation: string; temperature: string };
  characterDesignRules: { proportions: string; eyeStyle: string; lineWeight: string; detailLevel: string };
  lightingStyle: string;
  textureStyle: string;
  moodKeywords: string[];
  consistencyAnchors: string;
}

interface ScriptData {
  title: string;
  genre: string;
  logline: string;
  language: string;
  visualStyle?: string;
  targetDuration?: string;
  shotGenerationModel?: string;
  artDirection?: ArtDirection;
  characters: Character[];
  scenes: Scene[];
  props: any[];
  storyParagraphs: { id: number; text: string; sceneRefId: string }[];
}

interface Shot {
  id: string;
  sceneId: string;
  actionSummary: string;
  dialogue?: string;
  cameraMovement: string;
  shotSize?: string;
  characters: string[];
  keyframes: { id: string; type: string; visualPrompt: string; status: string }[];
}

export interface ScriptParseParams {
  rawText: string;
  language: string;
  visualStyle: string;
  targetDuration: string;
  title?: string;
}

export interface ScriptParseResult {
  scriptData: ScriptData;
  shots: Shot[];
}

type ProgressCallback = (progress: number, message: string) => void;

// ============================================
// 视觉风格查询
// ============================================

interface StyleInfo {
  prompt: string;
  negativePrompt: string;
  sceneNegativePrompt: string;
}

const getVisualStyleInfo = async (pool: Pool, userId: number, visualStyle: string): Promise<StyleInfo> => {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT prompt, negative_prompt, scene_negative_prompt FROM visual_styles WHERE user_id = ? AND value = ?',
    [userId, visualStyle]
  );
  if (rows.length > 0 && rows[0].prompt) {
    return {
      prompt: rows[0].prompt || visualStyle,
      negativePrompt: rows[0].negative_prompt || '',
      sceneNegativePrompt: rows[0].scene_negative_prompt || '',
    };
  }
  return { prompt: visualStyle, negativePrompt: '', sceneNegativePrompt: '' };
};

// ============================================
// AI 调用辅助
// ============================================

const chatCall = async (
  config: ModelConfig,
  prompt: string,
  temperature: number = 0.7,
  maxTokens?: number,
  responseFormat?: 'json_object'
): Promise<string> => {
  return serverChatCompletion({
    ...config,
    prompt,
    temperature,
    maxTokens,
    responseFormat,
  });
};

const cleanJson = (text: string): string => {
  let s = text.trim();
  if (s.startsWith('```json')) s = s.slice(7);
  else if (s.startsWith('```')) s = s.slice(3);
  if (s.endsWith('```')) s = s.slice(0, -3);
  return s.trim();
};

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// ============================================
// Phase 1: 剧本结构解析
// ============================================

const parseScriptStructure = async (
  config: ModelConfig,
  rawText: string,
  language: string
): Promise<{ title: string; genre: string; logline: string; characters: Character[]; scenes: Scene[]; storyParagraphs: any[] }> => {
  const prompt = `
    Analyze the text and output a JSON object in the language: ${language}.
    
    Tasks:
    1. Extract title, genre, logline (in ${language}).
    2. Extract characters (id, name, gender, age, personality).
       - personality MUST include appearance prototype if the character is anthropomorphic/animal-based (e.g. 以猫为原型、拟人化狐狸形象、猫耳少女).
       - If human, personality = traits only. If animal/anthropomorphic, personality = traits + "形象: 猫/狐/狗等" or similar.
    3. Extract scenes (id, location, time, atmosphere).
    4. Break down the story into paragraphs linked to scenes.
    
    Input:
    "${rawText.slice(0, 30000)}"
    
    Output ONLY valid JSON with this structure:
    {
      "title": "string",
      "genre": "string",
      "logline": "string",
      "characters": [{"id": "string", "name": "string", "gender": "string", "age": "string", "personality": "string"}],
      "scenes": [{"id": "string", "location": "string", "time": "string", "atmosphere": "string"}],
      "storyParagraphs": [{"id": number, "text": "string", "sceneRefId": "string"}]
    }
  `;

  const responseText = await chatCall(config, prompt, 0.7, 8192, 'json_object');
  const parsed = JSON.parse(cleanJson(responseText));

  const characters: Character[] = (parsed.characters || []).map((c: any) => ({
    ...c, id: String(c.id), variations: [],
  }));
  const scenes: Scene[] = (parsed.scenes || []).map((s: any) => ({ ...s, id: String(s.id) }));
  const storyParagraphs = (parsed.storyParagraphs || []).map((p: any) => ({ ...p, sceneRefId: String(p.sceneRefId) }));

  return {
    title: parsed.title || '未命名剧本',
    genre: parsed.genre || '通用',
    logline: parsed.logline || '',
    characters,
    scenes,
    storyParagraphs,
  };
};

// ============================================
// Phase 2: 美术指导文档生成
// ============================================

const generateArtDirection = async (
  config: ModelConfig,
  title: string,
  genre: string,
  logline: string,
  characters: Character[],
  scenes: Scene[],
  visualStyle: string,
  stylePrompt: string,
  language: string
): Promise<ArtDirection> => {
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
Create a comprehensive Art Direction Brief in JSON format.

CRITICAL RULES:
- All descriptions must be specific, concrete, and actionable for image generation AI
- The brief must define a COHESIVE visual world
- If characters are anthropomorphic/animal-based (猫/狐/狗/拟人等 in personality), skinTones = fur/feather color range; proportions/eyeStyle should suit animal characters
- Output all descriptive text in ${language}

Output ONLY valid JSON with this exact structure:
{
  "colorPalette": {
    "primary": "primary color tone description",
    "secondary": "secondary color description",
    "accent": "accent/highlight color",
    "skinTones": "skin/fur tone range for characters",
    "saturation": "overall saturation tendency",
    "temperature": "overall color temperature"
  },
  "characterDesignRules": {
    "proportions": "body proportion style",
    "eyeStyle": "unified eye rendering approach",
    "lineWeight": "line/edge style",
    "detailLevel": "detail density"
  },
  "lightingStyle": "unified lighting approach",
  "textureStyle": "material/texture rendering style",
  "moodKeywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "consistencyAnchors": "A single comprehensive paragraph (80-120 words) that serves as the MASTER STYLE REFERENCE."
}`;

  const responseText = await chatCall(config, prompt, 0.4, 4096, 'json_object');
  const parsed = JSON.parse(cleanJson(responseText));

  return {
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
};

// ============================================
// Phase 3: 批量角色视觉提示词
// ============================================

const generateCharacterPromptsBatch = async (
  config: ModelConfig,
  characters: Character[],
  artDirection: ArtDirection,
  genre: string,
  visualStyle: string,
  stylePrompt: string,
  negativePrompt: string,
  language: string
): Promise<void> => {
  if (characters.length === 0) return;

  const characterList = characters.map((c, i) =>
    `Character ${i + 1} (ID: ${c.id}):\n  - Name: ${c.name}\n  - Gender: ${c.gender}\n  - Age: ${c.age}\n  - Personality: ${c.personality}`
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
2. Facial Features: [specific distinguishing features - eyes MUST follow eye style rule]
3. Hairstyle: [detailed hair description - color, length, style]
4. Clothing: [detailed outfit appropriate for ${genre} genre]
5. Pose & Expression: [body language and facial expression matching personality]
6. Technical Quality: ${stylePrompt}

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

The "characters" array MUST have exactly ${characters.length} items, in the SAME ORDER as the input.`;

  try {
    const responseText = await chatCall(config, prompt, 0.4, 4096, 'json_object');
    const parsed = JSON.parse(cleanJson(responseText));
    const charResults = Array.isArray(parsed.characters) ? parsed.characters : [];

    for (let i = 0; i < characters.length; i++) {
      if (charResults[i]?.visualPrompt) {
        characters[i].visualPrompt = charResults[i].visualPrompt.trim();
        characters[i].negativePrompt = negativePrompt;
      }
    }
  } catch (e: any) {
    console.error('❌ [ScriptParser] 批量角色提示词生成失败:', e.message);
  }

  // Fallback for characters that didn't get prompts
  for (let i = 0; i < characters.length; i++) {
    if (characters[i].visualPrompt) continue;
    try {
      if (i > 0) await delay(1500);
      const singlePrompt = buildCharacterPrompt(characters[i], artDirection, genre, visualStyle, stylePrompt, language);
      const result = await chatCall(config, singlePrompt, 0.5, 1024);
      characters[i].visualPrompt = result.trim();
      characters[i].negativePrompt = negativePrompt;
    } catch (e: any) {
      console.error(`❌ [ScriptParser] 角色 ${characters[i].name} 提示词生成失败:`, e.message);
    }
  }
};

const buildCharacterPrompt = (
  char: Character,
  artDirection: ArtDirection,
  genre: string,
  visualStyle: string,
  stylePrompt: string,
  language: string
): string => {
  const artBlock = `
## GLOBAL ART DIRECTION (MANDATORY)
${artDirection.consistencyAnchors}
Color Palette: Primary=${artDirection.colorPalette.primary}, Secondary=${artDirection.colorPalette.secondary}, Accent=${artDirection.colorPalette.accent}
Lighting: ${artDirection.lightingStyle}
Texture: ${artDirection.textureStyle}`;

  const anthropomorphicHint = `⚠️ If personality mentions 猫/狗/狐/拟人/动物原型/anthropomorphic - character MUST be that species. Use animal ears, fur, tail, NOT human ethnicity/skin tone.`;

  return `You are an expert AI prompt engineer for ${visualStyle} style image generation.
${artBlock}
Create a detailed visual prompt for a character:

Character Data:
- Name: ${char.name}
- Gender: ${char.gender}
- Age: ${char.age}
- Personality: ${char.personality}

${anthropomorphicHint}

IF anthropomorphic (猫/狐/狗/拟人等): Structure = Species & Form [animal type, anthropomorphic body, ears, tail, fur] → Face [animal eyes, muzzle] → Fur/Hair → Clothing → Pose → Technical.
IF human: Structure = Core Identity [ethnicity, age, gender, body - proportions: ${artDirection.characterDesignRules.proportions}] → Facial Features [eyes: ${artDirection.characterDesignRules.eyeStyle}] → Hairstyle → Clothing [${genre} palette] → Pose → Technical.

Output in ${language}, single paragraph, comma-separated, 60-90 words. Line style: ${artDirection.characterDesignRules.lineWeight}. Detail: ${artDirection.characterDesignRules.detailLevel}. MUST include ${visualStyle} keywords. Output ONLY the prompt text.`;
};

// ============================================
// Phase 4: 场景视觉提示词
// ============================================

const generateScenePrompts = async (
  config: ModelConfig,
  scenes: Scene[],
  artDirection: ArtDirection | undefined,
  genre: string,
  visualStyle: string,
  stylePrompt: string,
  sceneNegativePrompt: string,
  language: string,
  onProgress?: ProgressCallback
): Promise<void> => {
  for (let i = 0; i < scenes.length; i++) {
    if (i > 0) await delay(1500);
    onProgress?.(60 + Math.round((i / scenes.length) * 10), `生成场景视觉提示词：${scenes[i].location}`);

    const artBlock = artDirection ? `
## GLOBAL ART DIRECTION (MANDATORY)
${artDirection.consistencyAnchors}
Color Palette: Primary=${artDirection.colorPalette.primary}, Secondary=${artDirection.colorPalette.secondary}, Accent=${artDirection.colorPalette.accent}
Lighting: ${artDirection.lightingStyle}
Texture: ${artDirection.textureStyle}
Mood: ${artDirection.moodKeywords.join(', ')}` : '';

    const scene = scenes[i];
    const prompt = `You are an expert cinematographer and AI prompt engineer for ${visualStyle} productions.
${artBlock}
Create a cinematic scene/environment prompt:

Scene Data:
- Location: ${scene.location}
- Time: ${scene.time}
- Atmosphere: ${scene.atmosphere}
- Genre: ${genre}

REQUIRED STRUCTURE (output in ${language}):
1. Environment: [detailed location with props, furniture, objects]
2. Lighting: [${artDirection ? `MUST follow: ${artDirection.lightingStyle}` : 'direction, color temperature, quality'}]
3. Composition: [camera angle, framing, depth layers]
4. Atmosphere: [mood, weather, particles]
5. Color Palette: [${artDirection ? `MUST use: Primary=${artDirection.colorPalette.primary}, Accent=${artDirection.colorPalette.accent}` : 'dominant colors'}]
6. Technical Quality: ${stylePrompt}

CRITICAL: NO PEOPLE, NO CHARACTERS - empty scene only. Output as single paragraph, comma-separated, 70-110 words. Output ONLY the prompt text.`;

    try {
      const result = await chatCall(config, prompt, 0.5, 1024);
      scenes[i].visualPrompt = result.trim();
      scenes[i].negativePrompt = sceneNegativePrompt;
    } catch (e: any) {
      console.error(`❌ [ScriptParser] 场景 ${scene.location} 提示词生成失败:`, e.message);
    }
  }
};

// ============================================
// Phase 5: 分镜列表生成
// ============================================

const generateShotList = async (
  config: ModelConfig,
  scriptData: ScriptData,
  stylePrompt: string,
  onProgress?: ProgressCallback
): Promise<Shot[]> => {
  if (!scriptData.scenes || scriptData.scenes.length === 0) return [];

  const lang = scriptData.language || '中文';
  const visualStyle = scriptData.visualStyle || 'live-action';
  const artDir = scriptData.artDirection;

  const artDirectionBlock = artDir ? `
      ⚠️ GLOBAL ART DIRECTION (MANDATORY for ALL visualPrompt fields):
      ${artDir.consistencyAnchors}
      Color Palette: Primary=${artDir.colorPalette.primary}, Secondary=${artDir.colorPalette.secondary}, Accent=${artDir.colorPalette.accent}
      Color Temperature: ${artDir.colorPalette.temperature}, Saturation: ${artDir.colorPalette.saturation}
      Lighting Style: ${artDir.lightingStyle}
      Texture: ${artDir.textureStyle}
      Mood Keywords: ${artDir.moodKeywords.join(', ')}
      Character Proportions: ${artDir.characterDesignRules.proportions}
      Line/Edge Style: ${artDir.characterDesignRules.lineWeight}
      Detail Level: ${artDir.characterDesignRules.detailLevel}
` : '';

  const allShots: any[] = [];

  for (let index = 0; index < scriptData.scenes.length; index++) {
    const scene = scriptData.scenes[index];
    if (index > 0) await delay(1500);
    onProgress?.(
      75 + Math.round((index / scriptData.scenes.length) * 25),
      `生成场景 ${index + 1}/${scriptData.scenes.length} 的分镜列表...`
    );

    const paragraphs = scriptData.storyParagraphs
      .filter(p => String(p.sceneRefId) === String(scene.id))
      .map(p => p.text)
      .join('\n');
    if (!paragraphs.trim()) continue;

    const targetDurationStr = scriptData.targetDuration || '60s';
    const targetSeconds = parseInt(targetDurationStr.replace(/[^\d]/g, '')) || 60;
    const totalShotsNeeded = Math.round(targetSeconds / 10);
    const scenesCount = scriptData.scenes.length;
    const shotsPerScene = Math.max(1, Math.round(totalShotsNeeded / scenesCount));

    const prompt = `
      Act as a professional cinematographer. Generate a detailed shot list for Scene ${index + 1}.
      Language for Text Output: ${lang}.
      
      IMPORTANT VISUAL STYLE: ${stylePrompt}
      All 'visualPrompt' fields MUST describe shots in this "${visualStyle}" style.
${artDirectionBlock}
      Scene Details:
      Location: ${scene.location}
      Time: ${scene.time}
      Atmosphere: ${scene.atmosphere}
      
      Scene Action:
      "${paragraphs.slice(0, 5000)}"
      
      Context:
      Genre: ${scriptData.genre}
      Visual Style: ${visualStyle} (${stylePrompt})
      Target Duration (Whole Script): ${scriptData.targetDuration || 'Standard'}
      Total Shots Budget: ${totalShotsNeeded} shots (Each shot = 10 seconds of video)
      Shots for This Scene: Approximately ${shotsPerScene} shots
      
      Characters:
      ${JSON.stringify(scriptData.characters.map(c => ({ id: c.id, name: c.name, desc: c.visualPrompt || c.personality })))}

      Professional Camera Movement Reference:
      - Static Shot, Pan Left/Right, Tilt Up/Down, Dolly Shot, Zoom In/Out
      - Tracking Shot, Circular Shot, Over the Shoulder Shot, POV Shot
      - Low/High Angle Shot, Bird's Eye View, Handheld Shot
      - Slow Motion, Time-Lapse, Canted Shot, Cinematic Dolly Zoom

      Instructions:
      1. Create EXACTLY ${shotsPerScene} shots (or ${shotsPerScene - 1} to ${shotsPerScene + 1} shots).
      2. Each shot = 10 seconds. Total shots must match: ${targetSeconds}s ÷ 10 = ${totalShotsNeeded} total shots.
      3. DO NOT exceed ${shotsPerScene + 1} shots for this scene.
      4. 'visualPrompt': Detailed description for image generation in ${visualStyle} style (OUTPUT IN ${lang}).${artDir ? ' MUST follow Art Direction.' : ''} Keep under 50 words.
      
      Output ONLY a valid JSON OBJECT:
      {
        "shots": [
          {
            "id": "string",
            "sceneId": "${scene.id}",
            "actionSummary": "string",
            "dialogue": "string (empty if none)",
            "cameraMovement": "string",
            "shotSize": "string",
            "characters": ["string"],
            "keyframes": [
              {"id": "string", "type": "start|end", "visualPrompt": "string"}
            ]
          }
        ]
      }
    `;

    try {
      const responseText = await chatCall(config, prompt, 0.5, 8192, 'json_object');
      const parsed = JSON.parse(cleanJson(responseText));
      const shots = Array.isArray(parsed) ? parsed : (parsed?.shots || []);
      const validShots = (Array.isArray(shots) ? shots : []).map((s: any) => ({
        ...s,
        sceneId: String(scene.id),
      }));
      allShots.push(...validShots);
    } catch (e: any) {
      console.error(`❌ [ScriptParser] 场景 ${scene.id} 分镜生成失败:`, e.message);
    }
  }

  if (allShots.length === 0) {
    throw new Error('分镜生成失败：AI返回为空');
  }

  return allShots.map((s: any, idx: number) => ({
    ...s,
    id: `shot-${idx + 1}`,
    keyframes: Array.isArray(s.keyframes) ? s.keyframes.map((k: any) => ({
      ...k,
      id: `kf-${idx + 1}-${k.type}`,
      status: 'pending',
    })) : [],
  }));
};

// ============================================
// 主入口：完整剧本解析流程
// ============================================

export const parseScriptFull = async (
  pool: Pool,
  userId: number,
  config: ModelConfig,
  params: ScriptParseParams,
  onProgress?: ProgressCallback
): Promise<ScriptParseResult> => {
  const { rawText, language, visualStyle, targetDuration, title } = params;

  // 获取视觉风格信息
  const styleInfo = await getVisualStyleInfo(pool, userId, visualStyle);
  const stylePrompt = styleInfo.prompt;
  const negativePrompt = styleInfo.negativePrompt;
  const sceneNegativePrompt = styleInfo.sceneNegativePrompt;

  // Phase 1: 解析剧本结构
  onProgress?.(5, '正在解析剧本结构...');
  console.log('📝 [ScriptParser] Phase 1: 解析剧本结构');
  const structureResult = await parseScriptStructure(config, rawText, language);
  const { characters, scenes, storyParagraphs } = structureResult;
  const genre = structureResult.genre;

  // Phase 2: 生成美术指导文档
  onProgress?.(20, '正在生成美术指导文档...');
  console.log('🎨 [ScriptParser] Phase 2: 生成美术指导文档');
  let artDirection: ArtDirection | undefined;
  try {
    await delay(1500);
    artDirection = await generateArtDirection(
      config, title || structureResult.title, genre, structureResult.logline,
      characters, scenes, visualStyle, stylePrompt, language
    );
    console.log('✅ [ScriptParser] 美术指导文档生成完成');
  } catch (e: any) {
    console.error('⚠️ [ScriptParser] 美术指导文档生成失败:', e.message);
  }

  // Phase 3: 生成角色视觉提示词
  onProgress?.(35, '正在生成角色视觉提示词...');
  console.log('🎭 [ScriptParser] Phase 3: 生成角色视觉提示词');
  if (artDirection) {
    await delay(1500);
    await generateCharacterPromptsBatch(config, characters, artDirection, genre, visualStyle, stylePrompt, negativePrompt, language);
  } else {
    for (let i = 0; i < characters.length; i++) {
      if (i > 0) await delay(1500);
      onProgress?.(35 + Math.round((i / characters.length) * 20), `生成角色视觉提示词：${characters[i].name}`);
      // Without art direction, generate simple prompts
      try {
        const p = `You are an expert AI prompt engineer for ${visualStyle} style image generation.
Create a visual prompt for: Name=${characters[i].name}, Gender=${characters[i].gender}, Age=${characters[i].age}, Personality=${characters[i].personality}.
⚠️ If personality mentions 猫/狗/狐/拟人/动物原型 - character MUST be that species (anthropomorphic: animal ears, fur, tail). NOT human.
Style: ${stylePrompt}. Output in ${language}. Single paragraph, 60-90 words. Include ${visualStyle} style keywords. Output ONLY the prompt.`;
        const result = await chatCall(config, p, 0.5, 1024);
        characters[i].visualPrompt = result.trim();
        characters[i].negativePrompt = negativePrompt;
      } catch (e: any) {
        console.error(`❌ [ScriptParser] 角色 ${characters[i].name} 提示词生成失败:`, e.message);
      }
    }
  }

  // Phase 4: 生成场景视觉提示词
  onProgress?.(60, '正在生成场景视觉提示词...');
  console.log('🌄 [ScriptParser] Phase 4: 生成场景视觉提示词');
  await generateScenePrompts(config, scenes, artDirection, genre, visualStyle, stylePrompt, sceneNegativePrompt, language, onProgress);

  // 组装 scriptData
  const scriptData: ScriptData = {
    title: title || structureResult.title,
    genre,
    logline: structureResult.logline,
    language,
    visualStyle,
    targetDuration,
    artDirection,
    characters,
    scenes,
    props: [],
    storyParagraphs,
  };

  // Phase 5: 生成分镜列表
  onProgress?.(75, '正在生成分镜列表...');
  console.log('🎬 [ScriptParser] Phase 5: 生成分镜列表');
  const shots = await generateShotList(config, scriptData, stylePrompt, onProgress);

  onProgress?.(100, '剧本解析完成');
  console.log(`✅ [ScriptParser] 解析完成: ${characters.length} 角色, ${scenes.length} 场景, ${shots.length} 分镜`);

  return { scriptData, shots };
};
