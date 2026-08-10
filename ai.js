'use strict';

const LITELLM_URL = process.env.LITELLM_URL || 'http://localhost:4000/v1/chat/completions';
const DEFAULT_MODEL = process.env.LITELLM_MODEL || 'glm-5.2';
const FAST_MODEL = process.env.LITELLM_FAST_MODEL || 'glm-4.7-flash';
const IMAGE_PROMPT_MODEL = 'glm-4.7-flash';
const REQUEST_TIMEOUT_MS = Number(process.env.LITELLM_TIMEOUT_MS || 120000);

const WRITING_SYSTEM_PROMPT = `你是小红书文案写作助手。用户是20年汽车行业老兵"杜鹏"，个人品牌"车圈Dio+AI"。
写作铁律：
- 正文≤200字，emoji≤2个
- 零AI味：不排比/不说教/不堆砌/不互联网黑话
- 散装自嘲风格，像真人发朋友圈
- 标题用方向性钩子
- 不出现任何平台名（懂车帝/汽车之家等）
根据用户给的关键词和要点，生成一篇小红书文案初稿。`;

async function chat({ messages, model = DEFAULT_MODEL, temperature = 0.7, responseFormat }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = { 'Content-Type': 'application/json' };
  const apiKey = process.env.LITELLM_API_KEY || 'litellm';
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  try {
    const response = await fetch(LITELLM_URL, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        temperature,
        ...(responseFormat ? { response_format: responseFormat } : {})
      })
    });
    const raw = await response.text();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (_) {
      payload = null;
    }
    if (!response.ok) {
      const detail = payload?.error?.message || payload?.message || raw || `HTTP ${response.status}`;
      const error = new Error(`LiteLLM 请求失败：${detail}`);
      error.status = 502;
      throw error;
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      const error = new Error('LiteLLM 未返回有效文本');
      error.status = 502;
      throw error;
    }
    return { content: content.trim(), model: payload.model || model, usage: payload.usage || null };
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error(`LiteLLM 请求超时（${REQUEST_TIMEOUT_MS}ms）`);
      timeoutError.status = 504;
      throw timeoutError;
    }
    if (error.cause?.code === 'ECONNREFUSED' || error.code === 'ECONNREFUSED') {
      const connectionError = new Error('无法连接 LiteLLM，请确认 localhost:4000 已启动');
      connectionError.status = 502;
      throw connectionError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function generate({ keywords = '', section = '', points = '', model }) {
  const userPrompt = [
    `板块：${section || '未指定'}`,
    `关键词：${Array.isArray(keywords) ? keywords.join('、') : keywords || '未指定'}`,
    `要点：${points || '请根据关键词自行提炼角度'}`,
    '请输出“标题”和“正文”，正文末尾可附3—5个标签。'
  ].join('\n');
  return chat({
    model: model || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: WRITING_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ]
  });
}

async function refine({ text = '', operation = 'polish', title = '', model }) {
  const operations = {
    polish: '保持原意，优化表达，让文字更自然、更像真人说话。',
    deai: '去除排比、说教、套话、总结腔和互联网黑话，保留真实口语感。',
    shorten: '压缩到200字以内，保留最关键的信息和个人判断。',
    hook: '优化标题和开头，加入方向性钩子，但不要标题党和数字堆砌。'
  };
  if (!String(text).trim()) {
    const error = new Error('text 不能为空');
    error.status = 400;
    throw error;
  }
  if (!operations[operation]) {
    const error = new Error('operation 必须是 polish/deai/shorten/hook 之一');
    error.status = 400;
    throw error;
  }
  return chat({
    model: model || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: `${WRITING_SYSTEM_PROMPT}\n你现在负责改稿，只输出修改后的文案，不解释过程。` },
      { role: 'user', content: `操作：${operations[operation]}\n原标题：${title || '无'}\n待修改文本：\n${text}` }
    ]
  });
}

async function check({ body = '', model }) {
  if (!String(body).trim()) {
    const error = new Error('body 不能为空');
    error.status = 400;
    throw error;
  }
  return chat({
    model: model || FAST_MODEL,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: '你是中文文案编辑。检查AI味、排比、说教、套话、互联网黑话、emoji数量、正文长度和平台名。简洁列出问题，并给出可直接执行的修改建议。不要重写全文。'
      },
      { role: 'user', content: body }
    ]
  });
}

function parseScoreContent(content) {
  const cleaned = String(content).replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!objectMatch) return null;
  try {
    const parsed = JSON.parse(objectMatch[0]);
    const score = value => Math.min(5, Math.max(0, Number.parseInt(value, 10) || 0));
    return {
      intensity: score(parsed.intensity ?? parsed.score_intensity),
      gap: score(parsed.gap ?? parsed.whitespace ?? parsed.score_gap),
      persona: score(parsed.persona ?? parsed.score_persona),
      timing: score(parsed.timing ?? parsed.timeliness ?? parsed.score_timing),
      reason: String(parsed.reason || parsed.note || '')
    };
  } catch (_) {
    return null;
  }
}

async function score({ title = '', section = '', model }) {
  if (!String(title).trim()) {
    const error = new Error('title 不能为空');
    error.status = 400;
    throw error;
  }
  const result = await chat({
    model: model || FAST_MODEL,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: '你是自媒体选题编辑。按烈度、内容空白度、人设匹配度、时效性四个维度各打0—5分。只输出JSON：{"intensity":0,"gap":0,"persona":0,"timing":0,"reason":"一句话理由"}。'
      },
      { role: 'user', content: `板块：${section || '未指定'}\n选题：${title}` }
    ]
  });
  return { ...result, scores: parseScoreContent(result.content) };
}

async function imagePrompt({ desc = '' }) {
  const description = String(desc).trim();
  if (!description) {
    const error = new Error('desc 不能为空');
    error.status = 400;
    throw error;
  }
  const result = await chat({
    model: IMAGE_PROMPT_MODEL,
    temperature: 0.4,
    messages: [
      {
        role: 'system',
        content: '你是 Gemini 图片提示词专家。把用户的中文描述转换为具体、自然、适合 Gemini 生图的英文提示词。补充必要的主体、场景、构图、光线、色彩和风格细节，但不要改变核心意图。只输出英文提示词，不解释，不加引号，不超过100个英文单词，并且必须以“no text no words”结尾。'
      },
      { role: 'user', content: description }
    ]
  });

  const suffix = 'no text no words';
  const withoutSuffix = result.content
    .replace(/^```(?:text)?\s*|```$/gi, '')
    .replace(/["“”]/g, '')
    .replace(/(?:,?\s*)no text no words[.!]?$/i, '')
    .trim();
  const words = withoutSuffix.split(/\s+/).filter(Boolean).slice(0, 96);
  return { ...result, content: `${words.join(' ')}${words.length ? ', ' : ''}${suffix}` };
}

module.exports = {
  LITELLM_URL,
  DEFAULT_MODEL,
  FAST_MODEL,
  WRITING_SYSTEM_PROMPT,
  chat,
  generate,
  refine,
  check,
  score,
  imagePrompt
};
