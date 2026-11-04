import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { listLibrary, planImport, importNote, createCategory, updateNode, deleteNode, restoreNode } from './library.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(directory, '..', '..');
const run = promisify(execFile);

async function pickFolder({ signal }) {
  if (process.platform !== 'win32') throw new Error('此系统请直接粘贴笔记文件夹的绝对路径');
  const script = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择要导入的笔记文件夹（原文件保持不变）'
$dialog.ShowNewFolderButton = $false
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.Text = '选择笔记文件夹'
$owner.ShowInTaskbar = $true
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$owner.Size = New-Object System.Drawing.Size(420, 140)
$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$owner.MaximizeBox = $false
$owner.MinimizeBox = $false
$message = New-Object System.Windows.Forms.Label
$message.Text = '请选择笔记文件夹。如窗口无响应，可在管理页面取消后重试。'
$message.Dock = [System.Windows.Forms.DockStyle]::Fill
$message.Padding = New-Object System.Windows.Forms.Padding(18)
$owner.Controls.Add($message)
try {
  $owner.Show()
  $owner.Activate()
  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::Write($dialog.SelectedPath)
  }
} finally {
  $dialog.Dispose()
  $owner.Dispose()
}
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const operation = run('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', encoded], { windowsHide: true, signal, maxBuffer: 8192 });
  const cleanup = () => operation.child?.kill();
  process.once('exit', cleanup);
  try {
    const result = await operation;
    return result.stdout.trim().replace(/^\uFEFF/, '');
  } finally { process.removeListener('exit', cleanup); }
}

async function refreshSite(root) {
  const { stdout } = await run(process.execPath, [path.join(project, 'scripts', 'prepare-notes.mjs')], { cwd: root, windowsHide: true, maxBuffer: 1024 * 1024 });
  // Astro must re-evaluate its integrations to load a changed sidebar; a Vite restart retains it.
  const now = new Date();
  fs.utimesSync(path.join(root, 'astro.config.mjs'), now, now);
  return stdout.trim();
}

export function createManager({ root = project, port = 4322, refresh = () => refreshSite(root), folderPicker = pickFolder, pickerTimeoutMs = 180000 } = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  let busy = false;
  let picker = null;
  const assets = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ]);
  function send(response, status, value) {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
  }
  async function body(request) {
    let raw = '';
    for await (const chunk of request) { raw += chunk; if (raw.length > 64 * 1024) throw new Error('请求过大'); }
    return JSON.parse(raw || '{}');
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const address = server.address();
    const actualPort = typeof address === 'object' ? address.port : port;
    const allowedHosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
    if (!allowedHosts.includes(request.headers.host)) return send(response, 403, { error: '仅支持本机访问' });
    const url = new URL(request.url, `http://127.0.0.1:${actualPort}`);
    const asset = assets.get(url.pathname);
    if (request.method === 'GET' && asset) {
      let data = fs.readFileSync(path.join(directory, asset[0]), 'utf8');
      if (url.pathname === '/') data = data.replace('__MANAGER_TOKEN__', token);
      response.writeHead(200, { 'Content-Type': asset[1] }); response.end(data); return;
    }
    if (request.headers['x-notes-token'] !== token || (request.headers.origin && !allowedHosts.some((host) => request.headers.origin === `http://${host}`))) return send(response, 403, { error: '请在本机管理页面操作，或刷新后重试' });
    try {
      if (request.method === 'GET' && url.pathname === '/api/library') return send(response, 200, listLibrary(root));
      if (request.method !== 'POST') return send(response, 404, { error: '接口不存在' });
      const options = await body(request);
      if (url.pathname === '/api/pick-folder') {
        // A new attempt replaces an abandoned request, including ones from a closed tab.
        picker?.abort(new Error('已重新打开文件夹选择，旧的选择已取消。'));
        const controller = new AbortController();
        picker = controller;
        const { signal } = controller;
        const disconnected = () => {
          if (!response.writableEnded) controller.abort(new Error('页面已关闭，文件夹选择已取消。'));
        };
        response.once('close', disconnected);
        const timer = setTimeout(() => controller.abort(new Error('文件夹选择超时，已关闭窗口；请重试或直接填写完整路径。')), pickerTimeoutMs);
        let aborted;
        const cancelled = new Promise((_, reject) => {
          aborted = () => reject(signal.reason);
          signal.addEventListener('abort', aborted, { once: true });
        });
        try {
          const selected = Promise.resolve().then(() => { signal.throwIfAborted(); return folderPicker({ signal }); });
          const source = await Promise.race([selected, cancelled]);
          return send(response, 200, { source });
        } finally {
          clearTimeout(timer);
          response.removeListener('close', disconnected);
          signal.removeEventListener('abort', aborted);
          if (picker === controller) picker = null;
        }
      }
      if (url.pathname === '/api/analyze') return send(response, 200, planImport(root, options).summary);
      const actions = { '/api/import': importNote, '/api/category': createCategory, '/api/update': updateNode, '/api/delete': deleteNode, '/api/restore': restoreNode };
      if (url.pathname === '/api/validate') {
        if (busy) throw new Error('正在保存，请稍后重试');
        busy = true;
        try {
          const { stdout } = await run(process.execPath, [path.join(project, 'scripts', 'validate-notes.mjs'), root], { cwd: root, windowsHide: true, maxBuffer: 1024 * 1024 });
          return send(response, 200, { message: stdout.trim() });
        } finally { busy = false; }
      }
      const action = actions[url.pathname];
      if (!action) return send(response, 404, { error: '接口不存在' });
      if (busy) return send(response, 409, { error: '正在保存另一项操作，请稍后重试' });
      busy = true;
      try {
        const result = action(root, options);
        let warning;
        try { await refresh(); } catch { warning = '资料和配置已保存，但页面生成失败。请在项目目录运行 npm run build 查看原因。'; }
        send(response, 200, { ...result, warning });
      } finally { busy = false; }
    } catch (error) {
      send(response, 400, { error: error.stdout || error.message || '操作失败' });
    }
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.NOTES_MANAGER_PORT || 4322);
  const server = createManager({ port });
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。已启动的管理工具可直接打开；或设置 NOTES_MANAGER_PORT 使用其他端口。` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`\n笔记管理工具已启动：http://127.0.0.1:${port}/\n导入、分类移动及回收站均仅在本机操作。按 Ctrl+C 关闭。\n`));
}
