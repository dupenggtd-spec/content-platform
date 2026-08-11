'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');
const express = require('express');
const cors = require('cors');
const store = require('./db');
const ai = require('./ai');
const collector = require('./collector');

const PORT = Number(process.env.PORT || 8000);
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const EXPORTS_DIR = path.join(ROOT_DIR, 'exports');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const COLLECT_CONFIG_PATH = path.join(DATA_DIR, 'collect_config.json');
const DOWNLOADS_DIR = path.join(os.homedir(), 'Downloads');
const IMAGE_GENERATION_TIMEOUT_MS = 180000;
const DEFAULT_COLLECT_CONFIG = Object.freeze({ enabled: true, intervalHours: 2 });
const MAX_COLLECT_INTERVAL_HOURS = Math.floor(2_147_483_647 / (60 * 60 * 1000));

fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.mkdirSync(EXPORTS_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

function normalizeCollectConfig(value) {
  const config = value && typeof value === 'object' ? value : {};
  const intervalHours = Number(config.intervalHours);
  return {
    enabled: typeof config.enabled === 'boolean' ? config.enabled : DEFAULT_COLLECT_CONFIG.enabled,
    intervalHours: Number.isFinite(intervalHours) && intervalHours > 0 && intervalHours <= MAX_COLLECT_INTERVAL_HOURS
      ? intervalHours
      : DEFAULT_COLLECT_CONFIG.intervalHours
  };
}

function readCollectConfig() {
  try {
    return normalizeCollectConfig(JSON.parse(fs.readFileSync(COLLECT_CONFIG_PATH, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('读取自动采集配置失败，将使用默认配置：', error.message || error);
    return { ...DEFAULT_COLLECT_CONFIG };
  }
}

let collectConfig = readCollectConfig();
let collectTimer = null;
let collectSchedulerStarted = false;

function runScheduledCollection() {
  collector.collect()
    .then(result => console.log(`热点自动采集完成：抓取 ${result.total} 条，新增 ${result.added} 条，跳过 ${result.skipped} 条`))
    .catch(error => console.error('热点自动采集失败：', error.message || error));
}

function restartCollectTimer() {
  if (collectTimer) {
    clearInterval(collectTimer);
    collectTimer = null;
  }
  if (!collectSchedulerStarted || !collectConfig.enabled) {
    if (collectSchedulerStarted) console.log('热点自动采集已关闭');
    return;
  }
  collectTimer = setInterval(runScheduledCollection, collectConfig.intervalHours * 60 * 60 * 1000);
  collectTimer.unref();
  console.log(`热点自动采集已启用，每 ${collectConfig.intervalHours} 小时运行一次`);
}

async function updateCollectConfig(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    const error = new Error('采集配置格式无效');
    error.status = 400;
    throw error;
  }
  const hasEnabled = Object.prototype.hasOwnProperty.call(patch, 'enabled');
  const hasInterval = Object.prototype.hasOwnProperty.call(patch, 'intervalHours');
  if (!hasEnabled && !hasInterval) {
    const error = new Error('请提供 enabled 或 intervalHours');
    error.status = 400;
    throw error;
  }
  if (hasEnabled && typeof patch.enabled !== 'boolean') {
    const error = new Error('enabled 必须是布尔值');
    error.status = 400;
    throw error;
  }
  const intervalHours = hasInterval ? Number(patch.intervalHours) : collectConfig.intervalHours;
  if (!Number.isFinite(intervalHours) || intervalHours <= 0 || intervalHours > MAX_COLLECT_INTERVAL_HOURS) {
    const error = new Error(`intervalHours 必须是大于 0 且不超过 ${MAX_COLLECT_INTERVAL_HOURS} 的有效数字`);
    error.status = 400;
    throw error;
  }
  const nextConfig = {
    enabled: hasEnabled ? patch.enabled : collectConfig.enabled,
    intervalHours
  };
  const temporaryPath = `${COLLECT_CONFIG_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(temporaryPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8');
  await fs.promises.rename(temporaryPath, COLLECT_CONFIG_PATH);
  collectConfig = nextConfig;
  restartCollectTimer();
  return { ...collectConfig };
}

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));
app.use('/assets', express.static(ASSETS_DIR));
app.get('/generated-images/:name', (req, res, next) => {
  const name = String(req.params.name || '');
  if (!/^Gemini_Generated_Image_.*\.png$/i.test(name) || path.basename(name) !== name) {
    return failure(res, '图片不存在', 404);
  }
  return res.sendFile(path.join(DOWNLOADS_DIR, name), error => {
    if (!error) return;
    if (error.code === 'ENOENT') return failure(res, '图片不存在', 404);
    return next(error);
  });
});
app.use(express.static(PUBLIC_DIR));

const success = (res, data, status = 200) => res.status(status).json({ success: true, data, error: null });
const failure = (res, error, status = 500) => res.status(status).json({ success: false, data: null, error });
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const notFound = (res, label) => failure(res, `${label}不存在`, 404);

app.get('/api/health', (req, res) => success(res, {
  name: '火花台',
  version: '2.0.0',
  database: store.DB_PATH,
  litellm: ai.LITELLM_URL
}));

app.get('/api/ideas', (req, res) => success(res, store.getIdeas()));
app.post('/api/ideas', (req, res) => success(res, store.createIdea(req.body), 201));
app.put('/api/ideas/:id', (req, res) => {
  const item = store.updateIdea(req.params.id, req.body);
  return item ? success(res, item) : notFound(res, '创意');
});
app.delete('/api/ideas/:id', (req, res) => {
  const deleted = store.deleteIdea(req.params.id);
  return deleted ? success(res, { id: req.params.id, deleted: true }) : notFound(res, '创意');
});

app.post('/api/collect', asyncRoute(async (req, res) => success(res, await collector.collect())));
app.get('/api/collect/status', asyncRoute(async (req, res) => success(res, await collector.readStatus())));
app.get('/api/collect/config', (req, res) => success(res, { ...collectConfig }));
app.post('/api/collect/config', asyncRoute(async (req, res) => success(res, await updateCollectConfig(req.body))));

app.get('/api/drafts', (req, res) => success(res, store.getDrafts()));
app.post('/api/drafts', (req, res) => success(res, store.createDraft(req.body), 201));
app.put('/api/drafts/:id', (req, res) => {
  const item = store.updateDraft(req.params.id, req.body);
  return item ? success(res, item) : notFound(res, '稿件');
});
app.delete('/api/drafts/:id', (req, res) => {
  const deleted = store.deleteDraft(req.params.id);
  return deleted ? success(res, { id: req.params.id, deleted: true }) : notFound(res, '稿件');
});

app.get('/api/published', (req, res) => success(res, store.getPublished()));
app.post('/api/published', (req, res) => success(res, store.createPublished(req.body), 201));
app.get('/api/published/:id', (req, res) => {
  const item = store.getPublishedById(req.params.id);
  return item ? success(res, item) : notFound(res, '已发稿件');
});
app.put('/api/published/:id', (req, res) => {
  const item = store.updatePublished(req.params.id, req.body);
  return item ? success(res, item) : notFound(res, '已发稿件');
});
// 前端允许清理误归档记录；这是在约定路由之外增加的兼容能力。
app.delete('/api/published/:id', (req, res) => {
  const deleted = store.deletePublished(req.params.id);
  return deleted ? success(res, { id: req.params.id, deleted: true }) : notFound(res, '已发稿件');
});

app.get('/api/principles', (req, res) => success(res, store.getPrinciples()));
app.put('/api/principles/:id', (req, res) => {
  const item = store.updatePrinciple(req.params.id, req.body);
  return item ? success(res, item) : notFound(res, '运营原则');
});

app.get('/api/sections', (req, res) => success(res, store.getSections()));
app.post('/api/sections', (req, res) => success(res, store.createSection(req.body), 201));
app.put('/api/sections/:id', (req, res) => {
  const item = store.updateSection(req.params.id, req.body);
  return item ? success(res, item) : notFound(res, '板块');
});
app.delete('/api/sections/:id', (req, res) => {
  const deleted = store.deleteSection(req.params.id);
  return deleted ? success(res, { id: req.params.id, deleted: true }) : notFound(res, '板块');
});

app.post('/api/ai/generate', asyncRoute(async (req, res) => success(res, await ai.generate(req.body || {}))));
app.post('/api/ai/refine', asyncRoute(async (req, res) => success(res, await ai.refine(req.body || {}))));
app.post('/api/ai/check', asyncRoute(async (req, res) => success(res, await ai.check(req.body || {}))));
app.post('/api/ai/score', asyncRoute(async (req, res) => success(res, await ai.score(req.body || {}))));
app.post('/api/ai/image-prompt', asyncRoute(async (req, res) => success(res, await ai.imagePrompt(req.body || {}))));

function runImageGeneration(promptFile) {
  const command = `python3.11 ~/.hermes/scripts/gemini_image_gen.py --prompt-file ${promptFile} --output-dir ~/Downloads`;
  return new Promise((resolve, reject) => {
    exec(command, { timeout: IMAGE_GENERATION_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolve({ stdout, stderr });
      if (error.killed || error.signal === 'SIGTERM') {
        const timeoutError = new Error('Gemini 图片生成超时（180秒）');
        timeoutError.status = 504;
        return reject(timeoutError);
      }
      const detail = String(stderr || stdout || error.message).trim();
      const generationError = new Error(`Gemini 图片生成失败${detail ? `：${detail}` : ''}`);
      generationError.status = 502;
      return reject(generationError);
    });
  });
}

async function latestGeneratedImage() {
  const entries = await fs.promises.readdir(DOWNLOADS_DIR, { withFileTypes: true });
  const images = await Promise.all(entries
    .filter(entry => entry.isFile() && /^Gemini_Generated_Image_.*\.png$/i.test(entry.name))
    .map(async entry => {
      const filePath = path.join(DOWNLOADS_DIR, entry.name);
      const stats = await fs.promises.stat(filePath);
      return { path: filePath, name: entry.name, size: stats.size, modified: stats.mtimeMs };
    }));
  images.sort((a, b) => b.modified - a.modified);
  return images[0] || null;
}

app.post('/api/ai/image', asyncRoute(async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  const draftId = String(req.body?.draftId || '').trim();
  if (!prompt) {
    const error = new Error('prompt 不能为空');
    error.status = 400;
    throw error;
  }
  if (draftId && !store.getDraft(draftId)) {
    const error = new Error('稿件不存在');
    error.status = 404;
    throw error;
  }

  await fs.promises.mkdir(DOWNLOADS_DIR, { recursive: true });
  const promptFile = path.join('/tmp', `gemini_prompt_${Date.now()}.txt`);
  await fs.promises.writeFile(promptFile, prompt, 'utf8');
  await runImageGeneration(promptFile);

  const image = await latestGeneratedImage();
  if (!image) {
    const error = new Error('Gemini 生成完成，但未找到输出图片');
    error.status = 502;
    throw error;
  }
  if (draftId) {
    const draft = store.getDraft(draftId);
    if (!draft) {
      const error = new Error('稿件不存在');
      error.status = 404;
      throw error;
    }
    const images = Array.isArray(draft.images) ? draft.images : [];
    store.updateDraft(draftId, { images: [...images, image.path] });
  }
  return success(res, { path: image.path, name: image.name, size: image.size });
}));

function safeFolderName(value) {
  const cleaned = String(value || '未命名稿件')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  return (cleaned || '未命名稿件').slice(0, 80);
}

function resolveCoverPath(coverImage) {
  if (!coverImage || coverImage.startsWith('data:')) return null;
  if (coverImage.startsWith('/assets/')) return path.join(ASSETS_DIR, path.basename(coverImage));
  const candidate = coverImage.startsWith('/')
    ? path.resolve(PUBLIC_DIR, `.${coverImage}`)
    : path.resolve(ROOT_DIR, coverImage);
  const allowedRoots = [PUBLIC_DIR, ASSETS_DIR, ROOT_DIR].map(directory => `${path.resolve(directory)}${path.sep}`);
  return allowedRoots.some(directory => candidate.startsWith(directory)) ? candidate : null;
}

function exportCover(coverImage, targetPath) {
  if (!coverImage) return false;
  const dataUrl = coverImage.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/s);
  if (dataUrl) {
    fs.writeFileSync(targetPath, Buffer.from(dataUrl[1], 'base64'));
    return true;
  }
  const sourcePath = resolveCoverPath(coverImage);
  if (sourcePath && fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile()) {
    fs.copyFileSync(sourcePath, targetPath);
    return true;
  }
  return false;
}

app.get('/api/exports/:id', (req, res) => {
  const draft = store.getDraft(req.params.id);
  if (!draft) return notFound(res, '稿件');

  const current = new Date();
  const date = [current.getFullYear(), String(current.getMonth() + 1).padStart(2, '0'), String(current.getDate()).padStart(2, '0')].join('-');
  const folderName = `${date}_${safeFolderName(draft.title)}`;
  const folderPath = path.join(EXPORTS_DIR, folderName);
  fs.mkdirSync(folderPath, { recursive: true });

  const tags = Array.isArray(draft.tags) ? draft.tags : [];
  const tagLine = tags.map(tag => `#${String(tag).replace(/^#/, '')}`).join(' ');
  const text = [draft.title, '', draft.body, tagLine ? `\n${tagLine}` : ''].join('\n').trimEnd() + '\n';
  const textPath = path.join(folderPath, '文案.txt');
  fs.writeFileSync(textPath, text, 'utf8');

  const coverPath = path.join(folderPath, '封面.png');
  const hasCover = exportCover(draft.cover_image, coverPath);
  return success(res, {
    id: draft.id,
    folder: folderName,
    folderPath,
    files: {
      copy: textPath,
      cover: hasCover ? coverPath : null
    }
  });
});

app.get('/api/scans/gemini', (req, res) => {
  const downloadsDir = path.join(os.homedir(), 'Downloads');
  if (!fs.existsSync(downloadsDir)) return success(res, []);
  const files = fs.readdirSync(downloadsDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^Gemini_Generated_Image.*\.png$/i.test(entry.name))
    .map(entry => {
      const filePath = path.join(downloadsDir, entry.name);
      const stats = fs.statSync(filePath);
      return {
        name: entry.name,
        path: filePath,
        size: stats.size,
        created_at: stats.birthtime.toISOString(),
        modified_at: stats.mtime.toISOString()
      };
    })
    .sort((a, b) => b.modified_at.localeCompare(a.modified_at));
  return success(res, files);
});

app.use('/api', (req, res) => failure(res, 'API 路由不存在', 404));
app.use((req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = Number(error.status || (error.code === 'SQLITE_CONSTRAINT' ? 409 : 500));
  const message = error.code === 'SQLITE_CONSTRAINT_UNIQUE'
    ? '记录ID或名称已存在'
    : error.message || '服务器内部错误';
  if (status >= 500) console.error(error);
  return failure(res, message, status);
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`火花台运行中 → http://localhost:${PORT}`);
  });
  collectSchedulerStarted = true;
  restartCollectTimer();
}

module.exports = app;
