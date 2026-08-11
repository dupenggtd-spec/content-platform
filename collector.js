'use strict';

const fs = require('fs');
const path = require('path');
const store = require('./db');
const ai = require('./ai');

const DATA_DIR = path.join(__dirname, 'data');
const STATUS_PATH = path.join(DATA_DIR, 'collect_status.json');
const FETCH_TIMEOUT_MS = 10_000;
const ITEMS_PER_SOURCE = 20;
const SCORE_CONCURRENCY = Math.max(1, Number.parseInt(process.env.COLLECT_SCORE_CONCURRENCY || '3', 10) || 3);
const TITLE_SIMILARITY_THRESHOLD = 0.82;
const COLLECT_MODEL = 'glm-4.7-flash';

const SOURCES = [
  {
    id: 'autohome',
    name: '汽车之家',
    category: 'auto',
    url: 'https://www.autohome.com.cn/rss/',
    section: 'car-choice',
    sectionName: '带你选好车',
    type: 'rss'
  },
  {
    id: 'autohome_html',
    name: '汽车之家新闻(网页)',
    category: 'auto',
    url: 'https://www.autohome.com.cn/news/',
    section: 'car-choice',
    sectionName: '带你选好车',
    type: 'html',
    linkPattern: /\/news\/\d{6}\//
  },
  {
    id: 'sspai',
    name: '少数派',
    category: 'ai',
    url: 'https://sspai.com/feed',
    section: 'ai-rookie',
    sectionName: '零基础AI',
    type: 'rss'
  },
  {
    id: 'kr36',
    name: '36氪',
    category: 'ai',
    url: 'https://36kr.com/feed',
    section: 'ai-rookie',
    sectionName: '零基础AI',
    type: 'rss'
  },
  {
    id: 'weibo_hot',
    name: '微博热搜',
    category: 'general',
    url: 'https://rsshub.rssforever.com/weibo/search/hot/AI汽车',
    section: 'ai-rookie',
    sectionName: 'AI × 汽车',
    type: 'rss'
  }
];

let runningCollection = null;

function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/&#(x[\da-f]+|\d+);/gi, (match, code) => {
      const number = code[0].toLowerCase() === 'x'
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10);
      try {
        return Number.isFinite(number) ? String.fromCodePoint(number) : match;
      } catch (_) {
        return match;
      }
    })
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
}

function cleanText(value) {
  const withoutMarkup = String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<[^>]*>/g, ' ');
  return decodeEntities(withoutMarkup)
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanLink(value, baseUrl) {
  const raw = decodeEntities(value).trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, baseUrl);
    url.hash = '';
    return url.toString();
  } catch (_) {
    return '';
  }
}

function tagContent(block, tagName) {
  const match = String(block).match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? match[1] : '';
}

function parseFeed(content, sourceUrl) {
  const blocks = [
    ...(String(content).match(/<item\b[\s\S]*?<\/item>/gi) || []),
    ...(String(content).match(/<entry\b[\s\S]*?<\/entry>/gi) || [])
  ];

  return blocks.map((block, index) => {
    const title = cleanText(tagContent(block, 'title'));
    let link = cleanLink(tagContent(block, 'link'), sourceUrl);
    if (!link) {
      const atomLink = block.match(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\/?\s*>/i);
      link = cleanLink(atomLink?.[1], sourceUrl);
    }
    const pubDate = cleanText(
      tagContent(block, 'pubDate') ||
      tagContent(block, 'published') ||
      tagContent(block, 'updated') ||
      tagContent(block, 'dc:date')
    );
    return { title, link, pubDate, index };
  }).filter(item => item.title && item.link);
}

function attributeValue(attributes, name) {
  const match = String(attributes).match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'));
  return match?.[2] || '';
}

function parseHtml(content, source) {
  const items = [];
  const anchors = String(content).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi);
  for (const match of anchors) {
    const attributes = match[1];
    const link = cleanLink(attributeValue(attributes, 'href'), source.url);
    if (!link || (source.linkPattern && !source.linkPattern.test(link))) continue;
    const title = cleanText(attributeValue(attributes, 'title') || match[2]);
    if (title.length < 4) continue;
    items.push({ title, link, pubDate: '', index: items.length });
  }
  return items;
}

function latestItems(items) {
  const uniqueLinks = new Set();
  return items
    .filter(item => {
      if (uniqueLinks.has(item.link)) return false;
      uniqueLinks.add(item.link);
      return true;
    })
    .sort((left, right) => {
      const leftTime = Date.parse(left.pubDate);
      const rightTime = Date.parse(right.pubDate);
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return rightTime - leftTime;
      return left.index - right.index;
    })
    .slice(0, ITEMS_PER_SOURCE)
    .map(({ index, ...item }) => item);
}

async function fetchSource(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8',
        'User-Agent': 'SparkCollector/1.0 (+https://localhost)'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const content = await response.text();
    const parsed = source.type === 'html'
      ? parseHtml(content, source)
      : parseFeed(content, source.url);
    return latestItems(parsed);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`请求超时（${FETCH_TIMEOUT_MS / 1000}秒）`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeTitle(title) {
  return String(title || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function bigrams(value) {
  const chars = [...value];
  if (chars.length < 2) return chars;
  return chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`);
}

function titleSimilarity(leftTitle, rightTitle) {
  const left = normalizeTitle(leftTitle);
  const right = normalizeTitle(rightTitle);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return Math.min(left.length, right.length) / Math.max(left.length, right.length);

  const leftBigrams = bigrams(left);
  const remaining = new Map();
  for (const pair of bigrams(right)) remaining.set(pair, (remaining.get(pair) || 0) + 1);
  let overlap = 0;
  for (const pair of leftBigrams) {
    const count = remaining.get(pair) || 0;
    if (!count) continue;
    overlap += 1;
    remaining.set(pair, count - 1);
  }
  return (2 * overlap) / (leftBigrams.length + bigrams(right).length);
}

function findSimilarTitle(title, existingTitles) {
  let best = null;
  for (const existingTitle of existingTitles) {
    const similarity = titleSimilarity(title, existingTitle);
    if (!best || similarity > best.similarity) best = { title: existingTitle, similarity };
    if (similarity === 1) break;
  }
  return best && best.similarity >= TITLE_SIMILARITY_THRESHOLD ? best : null;
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function scoreTotal(scores) {
  return ['intensity', 'gap', 'persona', 'timing']
    .reduce((total, key) => total + Number(scores?.[key] || 0), 0);
}

function ideaNote(item, scores) {
  const lines = [];
  if (scores.reason) lines.push(scores.reason);
  lines.push(`原文：${item.link}`);
  if (item.pubDate) lines.push(`发布时间：${item.pubDate}`);
  return lines.join('\n');
}

async function writeStatus(status) {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  const temporaryPath = `${STATUS_PATH}.${process.pid}.tmp`;
  await fs.promises.writeFile(temporaryPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  await fs.promises.rename(temporaryPath, STATUS_PATH);
}

async function readStatus() {
  try {
    const status = JSON.parse(await fs.promises.readFile(STATUS_PATH, 'utf8'));
    const isRunningHere = status.running && status.pid === process.pid && Boolean(runningCollection);
    return { ...status, running: Boolean(isRunningHere) };
  } catch (error) {
    if (error.code === 'ENOENT') return { running: false, lastCollectedAt: null, result: null };
    throw error;
  }
}

async function runCollection(selectedSourceIds) {
  const startedAt = new Date().toISOString();
  const previousStatus = await readStatus();
  await writeStatus({ ...previousStatus, running: true, pid: process.pid, lastStartedAt: startedAt });

  const selectedIds = Array.isArray(selectedSourceIds) ? new Set(selectedSourceIds) : null;
  const activeSources = selectedIds ? SOURCES.filter(source => selectedIds.has(source.id)) : SOURCES;
  const sourceResults = await Promise.all(activeSources.map(async source => {
    try {
      return { source, items: await fetchSource(source), error: null };
    } catch (error) {
      return { source, items: [], error: error.message || '采集失败' };
    }
  }));

  const details = sourceResults.map(({ source, items, error }) => ({
    source: source.name,
    url: source.url,
    total: items.length,
    added: 0,
    skipped: 0,
    error,
    items: []
  }));
  const existingTitles = store.getIdeas().map(idea => idea.title);
  const candidates = [];

  sourceResults.forEach(({ source, items }, sourceIndex) => {
    for (const item of items) {
      const duplicate = findSimilarTitle(item.title, existingTitles);
      if (duplicate) {
        details[sourceIndex].skipped += 1;
        details[sourceIndex].items.push({
          title: item.title,
          link: item.link,
          outcome: 'duplicate',
          similarTo: duplicate.title,
          similarity: Number(duplicate.similarity.toFixed(3))
        });
        continue;
      }
      existingTitles.push(item.title);
      candidates.push({ ...item, source, sourceIndex });
    }
  });

  await mapWithConcurrency(candidates, SCORE_CONCURRENCY, async item => {
    const detail = details[item.sourceIndex];
    try {
      const result = await ai.score({
        title: item.title,
        section: item.source.sectionName,
        model: COLLECT_MODEL
      });
      if (!result.scores) throw new Error('AI 未返回结构化评分');
      const totalScore = scoreTotal(result.scores);
      if (totalScore < 12) {
        detail.skipped += 1;
        detail.items.push({ title: item.title, link: item.link, outcome: 'low_score', score: totalScore, reason: result.scores.reason });
        return;
      }

      const currentDuplicate = findSimilarTitle(item.title, store.getIdeas().map(idea => idea.title));
      if (currentDuplicate) {
        detail.skipped += 1;
        detail.items.push({
          title: item.title,
          link: item.link,
          outcome: 'duplicate',
          similarTo: currentDuplicate.title,
          similarity: Number(currentDuplicate.similarity.toFixed(3))
        });
        return;
      }

      const idea = store.createIdea({
        title: item.title,
        section: item.source.section,
        source: item.source.name,
        scores: result.scores,
        status: 'pending',
        note: ideaNote(item, result.scores),
        created_at: item.pubDate && Number.isFinite(Date.parse(item.pubDate))
          ? new Date(item.pubDate).toISOString()
          : undefined
      });
      detail.added += 1;
      detail.items.push({ title: item.title, link: item.link, outcome: 'added', score: totalScore, ideaId: idea.id, reason: result.scores.reason });
    } catch (error) {
      detail.skipped += 1;
      detail.items.push({ title: item.title, link: item.link, outcome: 'score_error', error: error.message || 'AI 打分失败' });
    }
  });

  const result = {
    total: details.reduce((total, detail) => total + detail.total, 0),
    added: details.reduce((total, detail) => total + detail.added, 0),
    skipped: details.reduce((total, detail) => total + detail.skipped, 0),
    details
  };
  const lastCollectedAt = new Date().toISOString();
  await writeStatus({ running: false, lastStartedAt: startedAt, lastCollectedAt, result });
  return result;
}

async function collect(selectedSourceIds) {
  if (runningCollection) return runningCollection;
  const sourceIds = Array.isArray(selectedSourceIds) ? [...selectedSourceIds] : undefined;
  runningCollection = runCollection(sourceIds).catch(async error => {
    const status = {
      running: false,
      lastStartedAt: new Date().toISOString(),
      lastCollectedAt: new Date().toISOString(),
      result: { total: 0, added: 0, skipped: 0, details: [], error: error.message || '采集失败' }
    };
    try { await writeStatus(status); } catch (_) { /* 保留原始错误。 */ }
    throw error;
  }).finally(() => {
    runningCollection = null;
  });
  return runningCollection;
}

function listSources(selectedSourceIds) {
  const selectedIds = Array.isArray(selectedSourceIds) ? new Set(selectedSourceIds) : null;
  return SOURCES.map(source => ({
    id: source.id,
    name: source.name,
    category: source.category,
    url: source.url,
    enabled: selectedIds ? selectedIds.has(source.id) : true
  }));
}

module.exports = {
  collect,
  readStatus,
  listSources
};
