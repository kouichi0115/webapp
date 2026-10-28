// アンケート集計サーバー（依存ライブラリなし）
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data.json');

// 状態: 質問文・回答受付中か・端末ごとの回答
let state = { question: 'この内容に賛成ですか？', open: true, votes: {} };
try {
  state = { ...state, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
} catch (_) {}

function save() {
  fs.writeFile(DATA_FILE, JSON.stringify(state), () => {});
}

function summary() {
  const values = Object.values(state.votes);
  const yes = values.filter((v) => v === 'yes').length;
  const no = values.filter((v) => v === 'no').length;
  const total = yes + no;
  const pct = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  return {
    question: state.question,
    open: state.open,
    yes,
    no,
    total,
    yesRate: pct(yes),
    noRate: pct(no),
  };
}

// SSE でつながっている端末
const clients = new Set();
function broadcast() {
  const data = `data: ${JSON.stringify(summary())}\n\n`;
  for (const res of clients) res.write(data);
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1e5) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (_) {
        resolve({});
      }
    });
  });
}

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(summary())}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }

  if (p === '/api/state' && req.method === 'GET') {
    const deviceId = url.searchParams.get('deviceId');
    return json(res, 200, { ...summary(), myVote: state.votes[deviceId] || null });
  }

  if (p === '/api/vote' && req.method === 'POST') {
    const { deviceId, answer } = await readBody(req);
    if (typeof deviceId !== 'string' || !deviceId || deviceId.length > 100) {
      return json(res, 400, { error: '端末IDが不正です' });
    }
    if (answer !== 'yes' && answer !== 'no') {
      return json(res, 400, { error: '回答が不正です' });
    }
    if (!state.open) return json(res, 403, { error: '回答の受付は終了しています' });
    state.votes[deviceId] = answer; // 同じ端末は上書き（1端末1票）
    save();
    broadcast();
    return json(res, 200, { ok: true, myVote: answer });
  }

  if (p === '/api/admin' && req.method === 'POST') {
    const { action, question } = await readBody(req);
    if (action === 'reset') state.votes = {};
    else if (action === 'question' && typeof question === 'string' && question.trim()) {
      state.question = question.trim().slice(0, 200);
      state.votes = {};
    } else if (action === 'open') state.open = true;
    else if (action === 'close') state.open = false;
    else return json(res, 400, { error: '不正な操作です' });
    save();
    broadcast();
    return json(res, 200, summary());
  }

  // 静的ファイル
  const file = p === '/' ? 'index.html' : p === '/admin' ? 'admin.html' : p.slice(1);
  const full = path.join(PUBLIC_DIR, path.normalize(file));
  if (!full.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'forbidden' });
  fs.readFile(full, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  console.log(`起動しました: http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) {
        console.log(`  回答用:   http://${i.address}:${PORT}/`);
        console.log(`  集計用:   http://${i.address}:${PORT}/admin`);
      }
    }
  }
});
