/* App registry. Each app: { id, name, glyph, launch(opts) } and builds its UI inside a WM window. */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const download = (name, text, type = 'text/plain') => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
};
/* Save helper shared by editors: creates the file on first save, updates afterwards. */
async function saveFile(state, kind, content, defName) {
  if (!state.file) {
    const name = prompt('File name:', defName); if (!name) return;
    state.file = await api('/api/files', 'POST', { name, kind, content });
  } else await api('/api/files/' + state.file.id, 'PUT', { content });
  return state.file;
}
const APPS = {};

/* ---------------- Word processor (Quill) ---------------- */
APPS.word = { id: 'word', name: 'Documents', glyph: 'Dc', launch(file) {
  const st = { file }, w = WM.open({ title: file ? file.name : 'Untitled document', width: 780, height: 540 });
  w.body.innerHTML = `<div class="toolbar"><button data-a="save" class="primary">Save</button>
    <button data-a="txt">Export TXT</button><button data-a="pdf">Export PDF</button></div><div id="q-${w.id}" class="fill"></div>`;
  const q = new Quill(`#q-${w.id}`, { theme: 'snow', modules: { toolbar: [[{ header: [1, 2, 3, false] }],
    ['bold', 'italic', 'underline'], [{ list: 'ordered' }, { list: 'bullet' }], [{ align: [] }], ['link', 'clean']] } });
  if (file) api('/api/files/' + file.id).then(f => q.root.innerHTML = f.content);
  w.body.querySelector('.toolbar').onclick = async e => {
    const a = e.target.dataset.a; if (!a) return;
    if (a === 'save') { const f = await saveFile(st, 'doc', q.root.innerHTML, 'Untitled.doc'); f && w.setTitle(f.name); }
    if (a === 'txt') download((st.file?.name || 'document') + '.txt', q.getText());
    if (a === 'pdf') { // Browser print dialog -> "Save as PDF" (no server dependency)
      const p = open('', '_blank'); p.document.write(`<html><body style="font:14px sans-serif">${q.root.innerHTML}</body></html>`);
      p.document.close(); p.print(); }
  };
} };

/* ---------------- Spreadsheet (Handsontable + HyperFormula) ---------------- */
APPS.sheet = { id: 'sheet', name: 'Spreadsheet', glyph: 'Sp', launch(file) {
  const st = { file }, w = WM.open({ title: file ? file.name : 'Untitled sheet', width: 820, height: 520 });
  w.body.innerHTML = `<div class="toolbar"><button data-a="save" class="primary">Save</button>
    <button data-a="imp">Import CSV</button><button data-a="exp">Export CSV</button>
    <span class="muted">Formulas: =SUM(A1:A5), =A1*B1, =AVERAGE(...)</span>
    <input type="file" accept=".csv" hidden></div><div class="fill" id="h-${w.id}" style="overflow:hidden"></div>`;
  const host = w.body.querySelector('.fill');
  const blank = Array.from({ length: 50 }, () => Array(15).fill(''));
  const hot = new Handsontable(host, { data: blank, rowHeaders: true, colHeaders: true, contextMenu: true,
    formulas: { engine: HyperFormula }, licenseKey: 'non-commercial-and-evaluation', width: '100%', height: '100%' });
  new ResizeObserver(() => hot.updateSettings({ width: host.clientWidth, height: host.clientHeight })).observe(host);
  if (file) api('/api/files/' + file.id).then(f => hot.loadData(JSON.parse(f.content || '[]')));
  const parseCSV = t => t.trim().split(/\r?\n/).map(l => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || [])
    .filter((_, i, a) => i < a.length - 1 || _ !== '').map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')));
  const input = w.body.querySelector('input[type=file]');
  input.onchange = async () => { hot.loadData(parseCSV(await input.files[0].text())); input.value = ''; };
  w.body.querySelector('.toolbar').onclick = async e => {
    const a = e.target.dataset.a;
    if (a === 'save') { const f = await saveFile(st, 'sheet', JSON.stringify(hot.getSourceData()), 'Untitled.sheet'); f && w.setTitle(f.name); }
    if (a === 'imp') input.click();
    if (a === 'exp') hot.getPlugin('exportFile').downloadFile('csv', { filename: st.file?.name || 'sheet', columnHeaders: false });
  };
} };

/* ---------------- Developer suite (Monaco + backend runner) ---------------- */
const LANG_BY_EXT = { py: 'python', c: 'c', cpp: 'cpp', java: 'java', html: 'html', css: 'css', js: 'javascript' };
const STARTERS = {
  python: 'print("Hello, Lab!")\n', c: '#include <stdio.h>\nint main(){ printf("Hello, Lab!\\n"); return 0; }\n',
  cpp: '#include <iostream>\nint main(){ std::cout << "Hello, Lab!\\n"; }\n',
  java: 'public class Main {\n  public static void main(String[] a){ System.out.println("Hello, Lab!"); }\n}\n',
  html: '<!doctype html>\n<h1>Hello, Lab!</h1>\n<style>h1{font-family:sans-serif}</style>\n<script>console.log("hi")<\/script>\n' };
let monacoReady;
const loadMonaco = () => monacoReady ||= new Promise(res => {
  require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
  require(['vs/editor/editor.main'], () => res(window.monaco));
});
/* Plain-text files get a simple editor: no language picker, Run button, stdin or output panel. */
const PLAIN_LANG = { json: 'json', md: 'markdown', xml: 'xml', sql: 'sql', yml: 'yaml', yaml: 'yaml' };
const SERVER_LANGS = ['python', 'c', 'cpp', 'java'];   // these run on the backend and print to the output panel
APPS.ide = { id: 'ide', name: 'Code Editor', glyph: '</>', async launch(file) {
  const st = { file }, w = WM.open({ title: file ? file.name : 'Code Editor', width: 860, height: 580 });
  const ext = file ? file.name.split('.').pop().toLowerCase() : '';
  const plain = !!file && !LANG_BY_EXT[ext];
  w.body.innerHTML = `<div class="toolbar"><select>${['python', 'c', 'cpp', 'java', 'html', 'css', 'javascript']
    .map(l => `<option>${l}</option>`).join('')}</select>
    <button data-a="run" class="primary">Run</button><button data-a="save">Save</button>
    <span class="sp"></span><input class="stdin" placeholder="stdin (optional)" style="width:180px"></div>
    <div class="fill"></div><pre class="output">Output appears here.</pre>`;
  const sel = w.body.querySelector('select'), out = w.body.querySelector('.output'),
        runBtn = w.body.querySelector('[data-a=run]'), stdin = w.body.querySelector('.stdin');
  sel.value = LANG_BY_EXT[ext] || 'python';
  const sync = () => {                       // show only what makes sense for this file
    sel.hidden = runBtn.hidden = plain;
    stdin.hidden = out.hidden = plain || !SERVER_LANGS.includes(sel.value);
  };
  sync();
  const m = await loadMonaco();
  const ed = m.editor.create(w.body.querySelector('.fill'), { value: plain ? '' : (STARTERS[sel.value] || ''),
    language: plain ? (PLAIN_LANG[ext] || 'plaintext') : sel.value,
    automaticLayout: true, minimap: { enabled: false }, fontSize: 14, theme: document.documentElement.dataset.theme === 'dark' ? 'vs-dark' : 'vs' });
  if (file) api('/api/files/' + file.id).then(f => ed.setValue(f.content));
  sel.onchange = () => { m.editor.setModelLanguage(ed.getModel(), sel.value); if (!st.file) ed.setValue(STARTERS[sel.value] || ''); sync(); };
  w.onClose = () => ed.dispose();
  w.body.querySelector('.toolbar').onclick = async e => {
    const a = e.target.dataset.a;
    if (a === 'save') { const f = await saveFile(st, 'code', ed.getValue(), 'main.' + ({ python: 'py', javascript: 'js' }[sel.value] || sel.value)); f && w.setTitle(f.name); }
    if (a === 'run') {
      const lang = sel.value;
      if (lang === 'html' || lang === 'css' || lang === 'javascript') { // Web code runs client-side in a sandboxed iframe
        const code = ed.getValue(), src = lang === 'html' ? code : lang === 'css' ? `<style>${code}</style><p>CSS applied</p>` : `<script>${code}<\/script>`;
        const pw = WM.open({ title: 'Preview', width: 560, height: 380 });
        pw.body.innerHTML = `<iframe sandbox="allow-scripts" style="border:0;flex:1;background:#fff" srcdoc="${esc(src)}"></iframe>`;
        return; }
      out.textContent = 'Running…';
      try { const r = await api('/api/run', 'POST', { lang, code: ed.getValue(), stdin: stdin.value + '\n' });
        out.textContent = (r.output || '(no output)') + `\n[exit ${r.code}]`; } catch (err) { out.textContent = err.message; }
    }
  };
} };

/* ---------------- Terminal ---------------- */
APPS.term = { id: 'term', name: 'Terminal', glyph: '>_', launch() {
  const w = WM.open({ title: 'Terminal', width: 640, height: 400 });
  w.body.innerHTML = `<div class="term"><pre>Lab Web-OS shell. Type 'help'.</pre><div>$ <input autocomplete="off" spellcheck="false"></div></div>`;
  const box = w.body.querySelector('.term'), pre = box.querySelector('pre'), inp = box.querySelector('input');
  const hist = []; let hi = 0;
  box.onclick = () => inp.focus(); inp.focus();
  inp.onkeydown = async e => {
    if (e.key === 'ArrowUp') { hi = Math.max(0, hi - 1); inp.value = hist[hi] || ''; return; }
    if (e.key === 'ArrowDown') { hi = Math.min(hist.length, hi + 1); inp.value = hist[hi] || ''; return; }
    if (e.key !== 'Enter') return;
    const cmd = inp.value; inp.value = ''; hist.push(cmd); hi = hist.length;
    pre.textContent += `\n$ ${cmd}`;
    if (cmd.trim() === 'clear') { pre.textContent = ''; return; }
    try { const r = await api('/api/terminal', 'POST', { cmd }); if (r.out) pre.textContent += '\n' + r.out; }
    catch (err) { pre.textContent += '\n' + err.message; }
    box.scrollTop = box.scrollHeight;
  };
} };

/* ---------------- File explorer ---------------- */
/* ---------------- File viewer (PDF, Word .docx, images, other binaries) ----------------
   Not in APPS on purpose: it has no desktop icon and is only opened from the File Explorer. */
const BINARY_KINDS = ['pdf', 'docx', 'image', 'binary'];
const Viewer = { async launch(file) {
  const w = WM.open({ title: file.name, width: 820, height: 600 }), raw = `/api/files/${file.id}/raw`;
  const isDocx = file.kind === 'docx';
  w.body.innerHTML = `<div class="toolbar"><button data-a="dl" class="primary">Download</button>
    ${isDocx ? '<button data-a="edit">Edit copy in Documents</button>' : ''}</div><div class="fill viewer"></div>`;
  const host = w.body.querySelector('.viewer'); let html = '';
  const fail = msg => host.innerHTML = `<p class="pad muted">${esc(msg)}</p>`;
  w.body.querySelector('.toolbar').onclick = async e => {
    const a = e.target.dataset.a;
    if (a === 'dl') { const l = document.createElement('a'); l.href = raw + '?download=1'; l.download = file.name; l.click(); }
    if (a === 'edit' && html) {
      const nf = await api('/api/files', 'POST', { name: file.name.replace(/\.docx$/i, '') + '.doc', kind: 'doc', content: html });
      APPS.word.launch(nf);
    }
  };
  if (file.kind === 'pdf') {
    host.innerHTML = `<iframe src="${raw}" title="${esc(file.name)}" style="border:0;width:100%;height:100%"></iframe>`;
  } else if (file.kind === 'image') {
    host.innerHTML = `<div class="pad" style="overflow:auto;height:100%;text-align:center"><img src="${raw}" alt="${esc(file.name)}" style="max-width:100%"></div>`;
  } else if (isDocx) {
    host.innerHTML = '<p class="pad muted">Loading document…</p>';
    try {
      const r = await fetch(raw); if (!r.ok) throw new Error('Could not load the file.');
      html = (await mammoth.convertToHtml({ arrayBuffer: await r.arrayBuffer() })).value;
      // Sandboxed iframe (no scripts) so a shared document can never run code in the lab session.
      const page = `<!doctype html><meta charset="utf-8"><style>body{font:15px/1.6 Georgia,serif;color:#222;background:#fff;max-width:720px;margin:24px auto;padding:0 20px}
        img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:4px 8px}</style>${html || '<p><i>This document is empty.</i></p>'}`;
      host.innerHTML = `<iframe sandbox="" style="border:0;width:100%;height:100%;background:#fff" srcdoc="${esc(page)}"></iframe>`;
    } catch (err) { fail('Could not display this Word file: ' + err.message); }
  } else {
    fail('A preview is not available for this file type. Use Download to open it on your computer.');
  }
} };
const openFile = f => {
  if (f.kind === 'doc') return APPS.word.launch(f);
  if (f.kind === 'sheet') return APPS.sheet.launch(f);
  if (BINARY_KINDS.includes(f.kind)) return Viewer.launch(f);
  return APPS.ide.launch(f);
};
APPS.files = { id: 'files', name: 'Files', glyph: 'Fl', launch() {
  const w = WM.open({ title: 'File Explorer', width: 640, height: 420 });
  w.body.innerHTML = `<div class="toolbar"><button data-a="new">New file</button><button data-a="up">Upload</button>
    <button data-a="ref">Refresh</button><input type="file" hidden multiple></div><div class="fill" style="overflow:auto"></div>`;
  const list = w.body.querySelector('.fill'), up = w.body.querySelector('input[type=file]');
  let files = [];
  const render = async () => {
    files = await api('/api/files');
    list.innerHTML = files.length ? `<table class="flist"><tr><th>Name</th><th>Type</th><th>Modified</th><th></th></tr>` +
      files.map(f => `<tr class="row" data-id="${f.id}"><td>${esc(f.name)} ${f.shared ? '<span class="badge">shared</span>' : ''}</td>
      <td class="muted">${f.kind}</td><td class="muted">${new Date(f.updated_at + 'Z').toLocaleString()}</td>
      <td><button class="danger" data-del="${f.id}">Delete</button></td></tr>`).join('') + '</table>'
      : '<p class="pad muted">No files yet. Create one or upload from your computer.</p>';
  };
  list.ondblclick = e => { const r = e.target.closest('.row'); if (r) openFile(files.find(f => f.id == r.dataset.id)); };
  list.onclick = async e => { const id = e.target.dataset.del;
    if (id && confirm('Delete this file?')) { await api('/api/files/' + id, 'DELETE'); render(); } };
  // Read uploads as raw bytes. PDFs, Word files and images are stored as base64; real text stays text.
  const toB64 = buf => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(new Blob([buf])); });
  const sniff = (buf, name) => {
    const b = new Uint8Array(buf.slice(0, 12)), ext = name.split('.').pop().toLowerCase();
    const starts = s => [...s].every((c, i) => b[i] === c.charCodeAt(0));
    if (starts('%PDF')) return 'pdf';
    if (starts('PK') && ext === 'docx') return 'docx';
    if (starts('\x89PNG') || starts('GIF8') || (b[0] === 0xFF && b[1] === 0xD8) || (starts('RIFF') && ext === 'webp')) return 'image';
    return null;
  };
  up.onchange = async () => {
    for (const f of up.files) {
      if (f.size > 10 * 1024 * 1024) { alert(`${f.name} is larger than 10 MB.`); continue; }
      try {
        const buf = await f.arrayBuffer(), kind = sniff(buf, f.name);
        if (kind) { await api('/api/files', 'POST', { name: f.name, kind, content: await toB64(buf) }); continue; }
        let text = null;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { /* not text */ }
        await api('/api/files', 'POST', text !== null ? { name: f.name, content: text }
                                                      : { name: f.name, kind: 'binary', content: await toB64(buf) });
      } catch (err) { alert(`Could not upload ${f.name}: ${err.message}`); }
    }
    up.value = ''; render();
  };
  w.body.querySelector('.toolbar').onclick = async e => { const a = e.target.dataset.a;
    if (a === 'new') { const n = prompt('File name (e.g. notes.txt, main.py, report.doc, data.sheet):'); if (n) { await api('/api/files', 'POST', { name: n }); render(); } }
    if (a === 'up') up.click(); if (a === 'ref') render(); };
  render();
} };

/* ---------------- Settings ---------------- */
APPS.settings = { id: 'settings', name: 'Settings', glyph: 'St', launch() {
  const w = WM.open({ title: 'Settings', width: 420, height: 380 });
  w.body.innerHTML = `<div class="pad"><label>Theme</label><select id="th"><option value="light">Light</option><option value="dark">Dark</option></select>
    <label>Display name</label><input id="fn" style="width:100%"><label>New password</label><input id="pw" type="password" style="width:100%" placeholder="Leave blank to keep current">
    <p><button class="primary" id="sv">Save changes</button> <span id="msg" class="muted"></span></p></div>`;
  const th = w.body.querySelector('#th'); th.value = document.documentElement.dataset.theme;
  api('/api/me').then(d => w.body.querySelector('#fn').value = d.user.full_name || '');
  th.onchange = () => applyTheme(th.value);
  w.body.querySelector('#sv').onclick = async () => {
    const msg = w.body.querySelector('#msg');
    try { await api('/api/settings', 'POST', { theme: th.value, full_name: w.body.querySelector('#fn').value, password: w.body.querySelector('#pw').value });
      msg.textContent = 'Saved.'; } catch (e) { msg.textContent = e.message; }
  };
} };
