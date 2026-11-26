/* 記録フェーズの画面
 *  待機 → 要素をつくる / アイデアをつくる → レシート印刷
 *
 * 絵は「線の座標」で持つ（0〜1に正規化）。画像を拡大するより印刷がきれいで、
 * 後からAIに同じ形式で線を描かせる（＝人とAIで画材を揃える）ときにも使える。
 */

const PRINTER_WIDTH = 384;      // 58mm = 384 dots
const BAND_ROWS = 16;           // ファーム/サーバーと合わせる

const $ = (sel) => document.querySelector(sel);
const api = async (path, body) => {
  const opt = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' },
                       body: JSON.stringify(body) } : {};
  const r = await fetch(path, opt);
  const j = await r.json().catch(() => ({ error: 'サーバーの応答が読めません' }));
  if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
};

// ---------------------------------------------------------------- 手描き
class Pad {
  constructor(canvas) {
    this.c = canvas;
    this.strokes = [];            // [[{x,y}, ...], ...] 0〜1
    this.cur = null;
    this.resize();
    addEventListener('resize', () => this.resize());
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave'])
      canvas.addEventListener(ev, () => this.up());
  }
  resize() {
    const r = this.c.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.c.width = Math.round(r.width * dpr);
    this.c.height = Math.round(r.height * dpr);
    this.redraw();
  }
  pos(e) {
    const r = this.c.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }
  down(e) { this.c.setPointerCapture(e.pointerId); this.cur = [this.pos(e)]; this.strokes.push(this.cur); this.redraw(); }
  move(e) { if (!this.cur) return; this.cur.push(this.pos(e)); this.redraw(); }
  up() { this.cur = null; }
  undo() { this.strokes.pop(); this.redraw(); }
  clear() { this.strokes = []; this.redraw(); }
  isEmpty() { return this.strokes.length === 0; }
  redraw() {
    const ctx = this.c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, this.c.width, this.c.height);
    drawStrokes(ctx, this.strokes, 0, 0, this.c.width, this.c.height, this.c.width * 0.018);
  }
}

// 正規化された線を、指定の矩形に描く
function drawStrokes(ctx, strokes, x, y, w, h, lineWidth) {
  ctx.save();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    if (!s.length) continue;
    ctx.beginPath();
    ctx.moveTo(x + s[0].x * w, y + s[0].y * h);
    if (s.length === 1) ctx.lineTo(x + s[0].x * w + 0.1, y + s[0].y * h);
    else for (const p of s.slice(1)) ctx.lineTo(x + p.x * w, y + p.y * h);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- レシート作成
// レイアウト案（リファレンス/UI_レイアウト/レシートレイアウト改善案.pdf）に合わせた組み方:
//   ONOMATOPIA / 制作者名 → 破線 → 日付と時刻 → 破線 → [●]element [ ]idea
//   → 破線 → 内容 → 破線 → No.とQR → 破線
// 文字は DotGothic16（ドット活字）。fonts.css で同梱している。
const DOT = 'DotGothic16, ui-monospace, Menlo, monospace';
const INK = 176;        // これより暗い点を黒とみなす（大きいほど文字が太る）
const AUTHOR = 'テスト用です';

class Receipt {
  constructor(width = PRINTER_WIDTH) {
    this.w = width;
    this.c = document.createElement('canvas');
    this.c.width = width;
    this.c.height = 2200;                       // 余裕を持って確保し、最後に切る
    this.ctx = this.c.getContext('2d', { willReadFrequently: true });
    this.ctx.fillStyle = '#fff';
    this.ctx.fillRect(0, 0, this.c.width, this.c.height);
    this.ctx.textBaseline = 'top';
    this.y = 18;
    this.pad = 20;
  }

  // bold を付けると太字になる（ドット活字は1種類しか無いので、ブラウザが太らせる）
  font(size, bold = false) { this.ctx.font = `${bold ? 'bold ' : ''}${size}px ${DOT}`; }

  // 小さい字は、太らせているぶん隣とくっついて詰まって見える。字間を少し空ける
  gapFor(size) { return size <= 20 ? 2 : 0; }

  // 1文字ずつ置いて字間を空ける（canvas の letterSpacing は使わない。
  // スマホのSafariなどで効かず、刷り直したときに見た目が変わるため）
  put(str, x, y, spacing) {
    const ctx = this.ctx;
    ctx.textAlign = 'left';
    for (const ch of [...str]) {
      ctx.fillText(ch, x, y);
      x += ctx.measureText(ch).width + spacing;
    }
  }
  spanWidth(str, spacing) {
    return this.ctx.measureText(str).width + spacing * Math.max(0, [...str].length - 1);
  }

  // 1行の文字。幅に収まらなければ自動で小さくする
  text(str, { size = 18, align = 'left', gap = 4, spacing = null, bold = true } = {}) {
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    if (spacing == null) spacing = this.gapFor(size);
    this.font(size, bold);
    const limit = this.w - this.pad * 2;
    const width = (t) => ctx.measureText(t).width + spacing * Math.max(0, [...t].length - 1);
    while (size > 10 && width(str) > limit) { size -= 1; this.font(size, bold); }

    let x = align === 'center' ? (this.w - width(str)) / 2
          : align === 'right' ? this.w - this.pad - width(str) : this.pad;
    ctx.textAlign = 'left';
    for (const ch of [...str]) {                 // 字間を少し空けられるように1文字ずつ
      ctx.fillText(ch, x, this.y);
      x += ctx.measureText(ch).width + spacing;
    }
    this.y += size * 1.35 + gap;
  }

  // 左に項目、右に値（日付と時刻など）
  row(left, right, { size = 18, gap = 4, bold = true } = {}) {
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    this.font(size, bold);
    const sp = this.gapFor(size);
    this.put(left, this.pad, this.y, sp);
    this.put(right, this.w - this.pad - this.spanWidth(right, sp), this.y, sp);
    this.y += size * 1.35 + gap;
  }

  // 日本語の文章を、紙幅で折り返して描く
  paragraph(str, { size = 24, lineHeight = 1.6, gap = 10, bold = true } = {}) {
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    this.font(size, bold);
    ctx.textAlign = 'left';
    const limit = this.w - this.pad * 2;
    const KEEP = '、。」）)';                   // 行頭に来ると読みにくい文字
    let line = '';
    const flush = () => { ctx.fillText(line, this.pad, this.y); this.y += size * lineHeight; line = ''; };
    for (const ch of str) {
      const next = line + ch;
      if (ctx.measureText(next).width > limit && line && !KEEP.includes(ch)) { flush(); line = ch; }
      else line = next;
    }
    if (line) flush();
    this.y += gap;
  }

  rule({ gap = 10 } = {}) {
    const ctx = this.ctx;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(this.pad, this.y + 4);
    ctx.lineTo(this.w - this.pad, this.y + 4);
    ctx.stroke();
    ctx.setLineDash([]);
    this.y += gap + 6;
  }

  space(px) { this.y += px; }

  // 破線の枠の中に手描きの絵
  drawingBox(strokes, size = 250) {
    const x = (this.w - size) / 2;
    const ctx = this.ctx;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x, this.y, size, size);
    ctx.setLineDash([]);
    drawStrokes(ctx, strokes, x + 8, this.y + 8, size - 16, size - 16, 5);
    this.y += size + 12;
  }

  // QRを右に、左にNo.を置く
  // cell = 1マスのドット数。203dpi なので 8ドット = 1mm
  numberAndQR(id, { size = 132, cell: fixedCell = 0, before = 6, after = 6 } = {}) {
    this.y += before;
    const qr = qrcode(0, 'M');
    qr.addData(id);
    qr.make();
    const n = qr.getModuleCount();
    const cell = fixedCell || Math.max(3, Math.floor(size / (n + 8)));
    const total = (n + 8) * cell;
    const x = this.w - this.pad - total;
    this.ctx.fillStyle = '#fff';
    this.ctx.fillRect(x, this.y, total, total);
    this.ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (qr.isDark(r, c)) this.ctx.fillRect(x + (c + 4) * cell, this.y + (r + 4) * cell, cell, cell);

    this.font(18, true);                         // No. は枠の縦中央に置く
    this.put(`No. ${id}`, this.pad, this.y + total / 2 - 10, this.gapFor(18));
    this.y += total + after;
  }

  // 白黒1bitに変換して返す（bit1=黒 / MSB=左端）
  // 境目(INK)を明るめに取ると、文字の縁のうすい点も黒に入って線が太くなる。
  // 感熱紙は細い線がかすれるので、128 より上げたほうがはっきり出る
  finish() {
    const h = Math.ceil((this.y + 18) / BAND_ROWS) * BAND_ROWS;
    const img = this.ctx.getImageData(0, 0, this.w, h).data;
    const wBytes = this.w / 8;
    const out = new Uint8Array(wBytes * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 4;
        const lum = (img[i] * 0.299 + img[i + 1] * 0.587 + img[i + 2] * 0.114);
        if (lum < INK) out[y * wBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    return { width: this.w, height: h, raster: out };
  }
}

const pad2 = (n) => String(n).padStart(2, '0');
const dateStr = (d = new Date()) =>
  `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
const timeStr = (d = new Date()) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

// 上の共通部分（店名にあたる所 → 日付 → レシートの種類）
function header(r, kind) {
  r.text('ONOMATOPIA', { size: 34, gap: 2, spacing: 1 });
  r.text(AUTHOR, { size: 18 });
  r.rule();
  r.row(dateStr(), timeStr(), { size: 18 });
  r.rule();
  // ● は全角なので、空の方も全角の空白にして枠の大きさを揃える
  const box = (on) => `[${on ? '●' : '\u3000'}]`;
  r.text(`${box(kind === 'element')} element`, { size: 18, gap: 0 });
  r.text(`${box(kind === 'idea')} idea`, { size: 18, gap: 0 });
  r.text(`${box(kind === 'evaluate')} evaluate`, { size: 18 });
  r.rule();
}

function elementReceipt(rec) {
  const r = new Receipt();
  header(r, 'element');
  r.space(6);
  r.text(rec.name, { size: 36, align: 'center', spacing: 2, gap: 16 });
  r.drawingBox(rec.strokes, 250);
  r.space(4);
  r.rule();
  r.numberAndQR(rec.id);
  r.rule();
  return r.finish();
}

// elems … 元になった要素の記録（名前だけ使う。絵は載せない＝見やすさ優先）
function ideaReceipt(rec, elems) {
  const names = elems.map((e) => e.name);
  const r = new Receipt();
  header(r, 'idea');
  r.text('element', { size: 16, gap: 4, bold: false });
  r.text(`${names[0]} × ${names[1]}`, { size: 30, align: 'center', spacing: 1, gap: 8 });
  r.rule();

  // どちらが人でどちらがAIかは伏せる。並び順はサーバーが毎回入れ替える
  const sides = (rec.order || ['human', 'ai']).map((k) => rec[k]);
  sides.forEach((side, i) => {
    r.text(`[${i === 0 ? 'A' : 'B'}]`, { size: 16, gap: 6 });
    if (side && side.name_ja) {
      if (side.name_en) r.text(side.name_en, { size: 14, align: 'center', gap: 2 });
      r.text(side.name_ja, { size: 32, align: 'center', spacing: 1, gap: 14 });
      r.paragraph(side.explain_ja || '', { size: 24, gap: 10 });
    } else {
      r.text('-- no data --', { size: 16, align: 'center', gap: 8 });
    }
    r.rule();
  });

  r.numberAndQR(rec.id);
  r.rule();
  return r.finish();
}

// レシートを組む前に、ドット文字の読み込みを待つ
// （読み込み前に描くと別のフォントで描かれてしまう）
// 評価の答え（③の最後に「回答を印刷する」を選んだとき）。持ち帰り用なのでQRは付けない
// （アイデアのQRを載せると、くじのレシートと取り違えるため）
function evaluateReceipt(pair, answers, aiSide, same, voteId) {
  const r = new Receipt();
  header(r, 'evaluate');
  r.text('element', { size: 16, gap: 4, bold: false });
  r.text((pair.elements || []).join(' × '), { size: 30, align: 'center', spacing: 1, gap: 8 });
  r.rule();
  for (const [mark, one] of [['A', pair.a], ['B', pair.b]]) {
    r.text(`[${mark}]`, { size: 16, gap: 6 });
    r.text(one.name, { size: 28, align: 'center', spacing: 1, gap: 10 });
  }
  r.rule();
  r.text('あなたの回答', { size: 16, gap: 8, bold: false });
  for (const q of EVAL_ASK) r.row(q.short, `[${answers[q.key] || '-'}]`, { size: 22, gap: 8 });
  r.rule();
  r.row('AIは…', `[${aiSide}]`, { size: 30, gap: 10 });
  r.text(aiSide === answers.ai ? '当たり' : 'はずれ', { size: 20, align: 'right', gap: 8 });
  r.rule();
  r.text('知ったあとでも、創造的だと', { size: 18, gap: 0 });
  r.text('思うのは同じ？', { size: 18, gap: 4 });
  r.text(same ? 'はい' : 'いいえ', { size: 26, align: 'center', gap: 8 });
  r.rule();
  r.row(`No. ${voteId || '-'}`, `idea ${pair.id}`, { size: 18 });
  r.rule();
  return r.finish();
}

let fontReady = null;
function ensureFont() {
  if (!fontReady) {
    fontReady = Promise.all([
      document.fonts.load('36px DotGothic16', 'ZAWAZAWAアあ漢'),
      document.fonts.load('16px DotGothic16', 'ZAWAZAWAアあ漢'),
    ]).then(() => document.fonts.ready);
  }
  return fontReady;
}
ensureFont();

// ---------------------------------------------------------------- 印刷
const b64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 4096)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
  return btoa(s);
};

// 画面だけで試すモード（studio.html の中で開いたとき）。
// 実際には印刷せず、同じ画像を右の「印刷結果」へ送る
const PREVIEW = true;

// 1bit画像をPNGのデータURLにする（印刷されるものと同じ見た目）
function rasterToDataURL(image) {
  const wB = image.width / 8;
  const c = document.createElement('canvas');
  c.width = image.width; c.height = image.height;
  const x = c.getContext('2d');
  const d = x.createImageData(image.width, image.height);
  for (let y = 0; y < image.height; y++) {
    for (let px = 0; px < image.width; px++) {
      const bit = (image.raster[y * wB + (px >> 3)] >> (7 - (px & 7))) & 1;
      const i = (y * image.width + px) * 4;
      const v = bit ? 0 : 255;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255;
    }
  }
  x.putImageData(d, 0, 0);
  return c.toDataURL('image/png');
}

let printing = false;
let lastImage = null;        // 直前に刷ったもの（「もう一度印刷」で使う）

// 印刷できたら true、だめだったら false を返す（要素の記録に印を付けるため）
async function printReceipt(image) {
  if (printing) return false;                 // 二重に押されても1回しか出さない
  printing = true;
  lastImage = image;
  showOverlay('printing', 'レシートが出るまで少し待ってください');
  barWait(false);
  const el = $('#overlay .bar i');            // 前回の続きから伸びないよう、いったん0に戻す
  el.style.transition = 'none';
  el.style.width = '0';
  void el.offsetWidth;
  // 送る量が律速なので、画像の高さからだいたいの時間が読める
  // （115200bps: 768行で実測5.5秒 ≒ 1行4.2ms + 準備と紙送り2.5秒。9600bps時代は1行50ms）
  const seconds = PREVIEW ? 1.2 : image.height * 0.0042 + 2.5;
  bar(90, seconds);
  try {
    if (PREVIEW) {                              // 紙には出さず、右側に見せるだけ
      parent.postMessage({ type: 'receipt', png: rasterToDataURL(image),
                           width: image.width, height: image.height }, '*');
      await new Promise((r) => setTimeout(r, seconds * 1000));
      bar(100, 0.3);
      showOverlay('done', '展示では、このレシートがプリンターから出てきます。左の紙は上下に動かして全体を見られます', true);
      return true;
    }
    // 印刷は数秒〜（9600bps時代は1分近く）かかる。送信はすぐ終わらせ、状況は聞きに行く
    // （通信のやり直しで同じレシートが何枚も出るのを防ぐ）
    const job = 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    await api('/api/print', {
      job, width: image.width, height: image.height, raster: b64(image.raster),
    });
    for (;;) {
      await new Promise((r) => setTimeout(r, 300));   // 印刷が速くなったので細かく聞く
      const s = await (await fetch('/api/print?job=' + job)).json();
      if (s.status === 'done') break;
      if (s.status === 'error') throw new Error(s.error);
      if (s.status === 'unknown') throw new Error('印刷の受付が見つかりません');
    }
    bar(100, 0.4);
    showOverlay('done', 'レシートを受け取ってください', true);
    return true;
  } catch (e) {
    bar(100, 0.2);
    showOverlay('error', e.message, true);
    return false;
  } finally {
    printing = false;
  }
}

// 進み具合のバーを percent まで seconds かけて伸ばす
function bar(percent, seconds) {
  barWait(false);
  const el = $('#overlay .bar i');
  el.style.transition = `width ${seconds}s linear`;
  el.style.width = percent + '%';
}

// 終わりが読めない待ち（AIが考えている間）は、バーを行き来させる
function barWait(on) {
  const b = $('#overlay .bar');
  if (b) b.classList.toggle('wait', on);
}

function showOverlay(title, sub, closable = false) {
  $('#ov-title').textContent = title;
  $('#ov-sub').textContent = sub;
  const tools = $('#ov-tools');
  if (tools) tools.hidden = !closable;
  // 印刷中から刷り終わるまで、紙の切り取り方の動画を流す。
  // 出し始めに頭から流し、印刷中→刷り終わりではそのまま続ける
  const v = $('#ov-video');
  if (v) {
    const was = !v.hidden;
    v.hidden = title !== 'printing' && title !== 'done';
    if (v.hidden) v.pause();
    else if (!was) { v.currentTime = 0; v.play().catch(() => {}); }
  }
  $('#overlay').classList.add('show');
}

// このファイルはテスト用のページからも読み込むので、要素が有るときだけ結び付ける
if ($('#ov-back')) {
  $('#ov-back').onclick = () => location.reload();       // 1人ぶんが終わったのでタイトルへ
  // 紙がうまく出なかったとき、持ち帰り用にもう1枚ほしいときに、同じものを刷り直す
  $('#ov-again').onclick = async () => {
    if (!lastImage) return;
    await printReceipt(lastImage);
  };
}

// ---------------------------------------------------------------- 画面の進行
// 昔のPCのウィンドウのように、項目ごとに1枚のウィンドウを開く
// （リファレンス/UI_レイアウト/11_13_UI修正案.pdf と、重なったウィンドウの参考画像）。
// 進むと前のウィンドウは左上へ少しずつずれて後ろに重なる。左上の ← で1つ前に戻る。
// 後ろのウィンドウは枠だけ見せる（中身は隠す）。

const desk = $('#desk');
const BACK = Symbol('back');     // 「戻る」が押された合図
const STACK_MAX = 6;             // 後ろに枠を見せる枚数（それより奥は隠す）

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const paneOf = (node) => node.querySelector(':scope > .win-body > .pane');
const labelOf = (node) => node.querySelector(':scope > .win-bar > .win-title');
const backOf = (node) => node.querySelector(':scope > .win-bar > .win-back');

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const btn = (text, cls) => el('button', cls, text);
// 終わった項目の説明文は消す（まだ触る所だけが説明を持つ）
const dropHint = (node) => { const h = paneOf(node).querySelector('.hint'); if (h) h.remove(); };
const toolRow = (...buttons) => { const r = el('div', 'tools'); r.append(...buttons); return r; };
const boxBtn = (text) => btn(text, 'box');

// ウィンドウを1枚開く。上の帯に ←（戻る）と題名、下に中身（.pane）
function openWindow(title, { back = true } = {}) {
  const w = el('div', 'win');
  const bar = el('div', 'win-bar');
  if (back) bar.append(btn('←', 'win-back'));
  bar.append(el('div', 'win-title', title));
  const body = el('div', 'win-body');
  body.append(el('div', 'pane'));
  w.append(bar, body);
  if (reopen && reopen.parentNode === desk) {
    // 戻ったとき: 後ろにあった前のウィンドウと同じ重なりの位置に置き、そこから手前へすべらせる
    // （新しく開く動きはしない。消えて現れるとちらつくため）
    w.classList.add('reopen', 'behind');
    w.style.setProperty('--d', reopen.style.getPropertyValue('--d') || 1);
    desk.replaceChild(w, reopen);
    void w.offsetWidth;            // 後ろの位置を一度確定させてから、手前へ動かす
  } else {
    // 進むときの順番（戻るときと同じ流れ）: 手前の文字が消える → 重なりが後ろへずれる
    // → 新しいウィンドウが現れる → 文字が出る
    const front = [...desk.children].filter((x) => !x.classList.contains('closing')).pop();
    if (front) front.classList.add('leaving');
    w.classList.add('pending', 'fresh');        // ずれ終わるころまで見せない
    stackHold = performance.now() + FADE_MS;
    desk.append(w);
    setTimeout(() => {
      if (front) front.classList.remove('leaving');
      restack();
      setTimeout(() => w.classList.remove('pending'), SHIFT_MS);
    }, FADE_MS);
  }
  reopen = null;
  return w;
}
const FADE_MS = 100;     // 文字が消える時間（win.css の .leaving と同じ）
const SHIFT_MS = 220;    // ずれ始めてから新しいウィンドウを出すまで（ずれ終わる少し前に出し始める）

let reopen = null;
let stackHold = 0;                 // この時刻までは重なりを動かさない                 // 次に開くウィンドウで置き換える、前のウィンドウ

// ウィンドウを閉じる。少し縮みながら消してから外す（いきなり消えるとちらつくため）
function closeWindow(w) {
  if (!w || w.classList.contains('closing')) return;
  w.classList.add('closing');
  // 戻るときの順番: ウィンドウが閉じる → 後ろが手前へずれる → 文字が出る。
  // 閉じ終わって外したときに restack が呼ばれ、そこで初めてずれ始める
  stackHold = performance.now() + 220;
  setTimeout(() => w.remove(), 230);
}
// 以前の作り（枝分かれ図）と同じ呼び方で使えるように残す。parent は使わない
const addNode = (_parent, label) => openWindow(label);

// 重なり順を付け直す。手前から 0, 1, 2 … の深さで、奥ほど左上へずれる。
// 後ろのウィンドウも自分の大きさのまま（中身だけ隠して枠を見せる）
function restack() {
  if (performance.now() < stackHold) return;   // ウィンドウを閉じている間は動かさない（閉じ終わってから）
  const wins = [...desk.children].filter((w) => !w.classList.contains('closing'));
  wins.forEach((w, i) => {
    const d = wins.length - 1 - i;
    w.style.setProperty('--d', d);
    w.classList.toggle('behind', d > 0);
    w.classList.toggle('far', d > STACK_MAX);
  });
}
if (desk) new MutationObserver(restack).observe(desk, { childList: true });

// 以前は位置合わせをしていた。ウィンドウは常に画面の中央なので何もしない
const settle = () => {};

// ---------------------------------------------------------------- 画面のキーボード
// 展示ではタッチパネルだけなので、文字は画面のキーボードで入れる。
// 日本語は「かな」だけ（漢字変換は使わない）。AI側も同じくかな書きにして、
// どちらが人か見分けがつかないようにしている。

const KANA_ROWS = [                      // 50音。日本語の表と同じく右から左（「あ」が右端）
  'わらやまはなたさかあ',
  'をりゆみひにちしきい',
  'んるよむふぬつすくう',
  ' れ めへねてせけえ',
  ' ろ もほのとそこお',
];
const ABC_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];   // ふつうのキーボードと同じ並び
const NUM_ROWS = ['1234567890'];          // レシートのIDは番号だけ打てばよい（E- / I- は付け足す）

// 打った番号をレシートのIDに直す。「12」「0012」「E12」「e-0012」→ E-0012
// prefix … E（要素）か I（アイデア）。番号以外の形はそのまま返す（あとで形を確かめる）
function toId(prefix, v) {
  v = (v || '').trim().toUpperCase();
  const m = v.match(/^([EI])?-?(\d{1,4})$/);
  if (!m) return v;
  return `${m[1] || prefix}-${m[2].padStart(4, '0')}`;
}

// 「゛゜小」を押したときに、直前の文字が変わっていく順
const CYCLE = {};
for (const [a, b] of [['か','が'],['き','ぎ'],['く','ぐ'],['け','げ'],['こ','ご'],
                      ['さ','ざ'],['し','じ'],['す','ず'],['せ','ぜ'],['そ','ぞ'],
                      ['た','だ'],['ち','ぢ'],['て','で'],['と','ど'],
                      ['う','ゔ']]) { CYCLE[a] = b; CYCLE[b] = a; }
for (const [a, b] of [['あ','ぁ'],['い','ぃ'],['え','ぇ'],['お','ぉ'],
                      ['や','ゃ'],['ゆ','ゅ'],['よ','ょ']]) { CYCLE[a] = b; CYCLE[b] = a; }
for (const h of 'はひふへほ') {          // は → ば → ぱ → は
  const d = String.fromCharCode(h.charCodeAt(0) + 1);
  const p = String.fromCharCode(h.charCodeAt(0) + 2);
  CYCLE[h] = d; CYCLE[d] = p; CYCLE[p] = h;
}
CYCLE['つ'] = 'づ'; CYCLE['づ'] = 'っ'; CYCLE['っ'] = 'つ';

const kbEl = () => $('#keyboard');
let kbHeight = 0;
let kbKatakana = false;
let kbTarget = null;                     // いまキーボードで書いている入力欄

function hideKeyboard() {
  const k = kbEl();
  if (!k) return;
  k.classList.remove('show');
  kbTarget = null;
  kbHeight = 0;
  liftForKeyboard();
  setTimeout(() => { if (!k.classList.contains('show')) k.innerHTML = ''; }, 400);
}

// キーボードに入力欄が隠れるときは、ウィンドウごと上へずらす
function liftForKeyboard() {
  if (!desk) return;
  const live = new DOMMatrixReadOnly(getComputedStyle(desk).transform).f;
  let lift = 0;
  if (kbTarget && kbHeight) {
    const bottom = kbTarget.getBoundingClientRect().bottom - live;   // ずらす前の位置
    const limit = innerHeight - kbHeight - 16;
    if (bottom > limit) lift = limit - bottom;
  }
  desk.style.transform = lift ? `translateY(${lift}px)` : '';
}

// 入力欄を触ったらキーボードを出す（キーボードの外を触ると引っ込む。下の document の処理）
function attachKeyboard(input, kind, onOk) {
  input.inputMode = 'none';              // 端末のキーボードは出さない（画面のキーボードを使う）
  input.addEventListener('pointerdown', () => {
    if (input.disabled || kbTarget === input) return;
    showKeyboard(input, kind, onOk);
  });
}

if (kbEl()) {
  // キーを押しても入力欄から注目を奪わない（カーソルの位置が見えたままになる）
  for (const ev of ['pointerdown', 'mousedown']) kbEl().addEventListener(ev, (e) => e.preventDefault());
  document.addEventListener('pointerdown', (e) => {
    if (!kbTarget || kbEl().contains(e.target) || e.target === kbTarget) return;
    hideKeyboard();
  }, true);
}

// input か textarea に、画面のキーボードから文字を入れる。
// 文字はカーソルの所に入り、「けす」はカーソルの前の1文字（選んでいればその範囲）を消す
function showKeyboard(input, kind, onOk) {
  const k = kbEl();
  if (!k) return;
  kbKatakana = false;
  kbTarget = input;
  const rows = kind === 'abc' ? ABC_ROWS : kind === 'num' ? NUM_ROWS : KANA_ROWS;

  const range = () => {
    const n = input.value.length;
    return [input.selectionStart ?? n, input.selectionEnd ?? n];
  };
  const changed = () => { input.focus(); input.dispatchEvent(new Event('input')); };
  const put = (ch) => {
    const [a, b] = range();
    const max = +input.getAttribute('maxlength') || 999;
    if (input.value.length - (b - a) + ch.length > max) return;
    input.setRangeText(ch, a, b, 'end');
    changed();
  };
  const back = () => {
    let [a, b] = range();
    if (a === b) { if (!a) return; a -= 1; }
    input.setRangeText('', a, b, 'end');
    changed();
  };
  const mark = () => {                   // カーソルの前の文字を ゛゜小 に変える
    const [a, b] = range();
    if (a !== b || !a) return;
    const next = CYCLE[toHira(input.value[a - 1])];
    if (!next) return;
    input.setRangeText(kbKatakana ? toKata(next) : next, a - 1, a, 'end');
    changed();
  };
  const move = (d) => {                  // ◀ ▶ でカーソルを1文字動かす（選んでいれば端へ寄せる）
    const [a, b] = range();
    const p = a !== b ? (d < 0 ? a : b) : Math.max(0, Math.min(input.value.length, a + d));
    input.focus();
    input.setSelectionRange(p, p);
  };

  k.innerHTML = '';
  const keys = [];                       // かな/カナの切替で文字を書き換えるため覚えておく
  for (const row of rows) {
    const r = el('div', 'kb-row');
    for (const ch of row) {
      const b = btn(ch);
      if (ch === ' ') b.className = 'blank';
      else {
        b.onclick = () => put(kbKatakana ? toKata(ch) : ch);
        keys.push(b);
      }
      r.append(b);
    }
    k.append(r);
  }
  const relabel = () => {
    for (const b of keys) {
      const base = b.textContent;
      b.textContent = kbKatakana ? toKata(base) : toHira(base);
    }
  };

  const tools = el('div', 'kb-row');
  if (kind === 'kana') {
    const dak = btn('゛゜小', 'wide'); dak.onclick = mark;
    const kata = btn('カナ', 'wide');
    kata.onclick = () => {
      kbKatakana = !kbKatakana;
      kata.textContent = kbKatakana ? 'かな' : 'カナ';
      relabel();                         // 表そのものをカタカナ／ひらがなに切り替える
    };
    tools.append(dak, kata);
    for (const ch of 'ー、。') { const b = btn(ch); b.onclick = () => put(ch); tools.append(b); }
  }
  const left = btn('◀'); left.onclick = () => move(-1);
  const right = btn('▶'); right.onclick = () => move(1);
  const del = btn('けす', 'wide'); del.onclick = back;
  const ok = btn('ok', 'wide'); ok.onclick = () => onOk();
  tools.append(left, right, del, ok);
  k.append(tools);

  k.classList.add('show');
  kbHeight = k.offsetHeight;
  liftForKeyboard();
}

const toKata = (s) => s.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const toHira = (s) => s.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

// ---------------------------------------------------------------- 項目のつくり方
// どの項目も「← で1つ前に戻れる」。戻ると前の入力は書き戻す。

// 選択肢のウィンドウ。1行ずつ線で区切り、選ばれた行が [●] になる
function askChoice(parent, items, title = 'select') {
  return new Promise((resolve) => {
    const node = openWindow(title);
    node.classList.add('list');
    const pane = paneOf(node);
    for (const it of items) {
      const b = btn('', 'win-row');
      b.innerHTML = `[<span class="bx"></span>] ${it.label}`;
      b.onclick = async () => {
        if (node.dataset.done) return;   // 選んだあとは押しても何もしない
        node.dataset.done = '1';
        b.querySelector('.bx').textContent = '●';
        await wait(380);
        resolve({ node, value: it.value });
      };
      pane.append(b);
    }
    backOf(node).onclick = () => { if (!node.dataset.done) { closeWindow(node); resolve(BACK); } };
  });
}

// 文字を入れるウィンドウ。「name: ____」の形で、入力欄を触るとキーボードが出る。ok で次へ
//   field … 入力欄の前の名前   note … 入力欄の上に出す前の項目の答え（見ながら考えてもらう）
function askText(parent, title,
                 { field = '', note = '', placeholder = '', hint = '', area = false, keys = '', max = 0,
                   validate = () => '' }, initial) {
  return new Promise((resolve) => {
    const node = openWindow(title);
    const pane = paneOf(node);
    if (note) pane.append(el('div', 'note', note));
    const line = el('label', 'field' + (area ? ' area' : ''));
    if (field) line.append(el('span', 'f-name', field));
    const input = el(area ? 'textarea' : 'input');
    if (!area) input.type = 'text';
    input.placeholder = placeholder;
    if (max) input.maxLength = max;
    if (initial) input.value = initial;
    line.append(input);
    const err = el('div', 'err');
    const ok = boxBtn('ok');
    pane.append(line);
    if (hint) pane.append(el('div', 'hint', hint));
    pane.append(toolRow(ok), err);

    const submit = () => {
      const v = input.value.trim();
      const msg = validate(v);
      if (msg) { err.textContent = msg; return; }
      hideKeyboard();
      input.disabled = true;
      resolve({ node, value: v });
    };
    ok.onclick = submit;
    backOf(node).onclick = () => { hideKeyboard(); closeWindow(node); resolve(BACK); };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !area) { e.preventDefault(); submit(); }
    });
    if (keys) attachKeyboard(input, keys, submit);
    setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 400);
  });
}

// 絵を描くウィンドウ。左に描く所、右に説明とボタン
function askDrawing(parent, label, initial) {
  return new Promise((resolve) => {
    const node = openWindow(label);
    const pane = paneOf(node);
    pane.classList.add('side');
    const canvas = el('canvas', 'draw');
    const err = el('div', 'err');
    const undo = boxBtn('undo'), clear = boxBtn('clear'), ok = boxBtn('ok');
    const tools = el('div', 'tools col');
    tools.append(undo, clear, ok);
    pane.append(canvas, el('div', 'hint', '音の感じを線で描く'), tools, err);

    const pad = new Pad(canvas);
    if (initial) pad.strokes = initial.map((s) => s.slice());
    setTimeout(() => pad.resize(), 450);
    undo.onclick = () => pad.undo();
    clear.onclick = () => pad.clear();
    backOf(node).onclick = () => { closeWindow(node); resolve(BACK); };
    ok.onclick = () => {
      if (pad.isEmpty()) { err.textContent = '絵を描いてください'; return; }
      node.dataset.done = '1';
      resolve({ node, value: pad.strokes });
    };
  });
}

// カメラ基板を縦向きに、こちら側へ向けて取り付けたぶんを画面側で戻す。
//   CAM_ROTATE … 画面に出すときに右へ回す角度（0 / 90 / 180 / 270）
//   CAM_MIRROR … 鏡のように左右を返す（自分に向けたカメラは、返したほうが合わせやすい）
// 上下が逆に出るときは CAM_ROTATE を 270 にする。
// ※ 読み取りには**回す前のコマ**を使う（画面の見せ方に左右されないように）。
//   jsQRは回したものも鏡にしたものも読めたが、元のコマで読むほうが確実。
const CAM_ROTATE = 270;   // カメラ基板を上下逆に取り付けたので 90→270
const CAM_MIRROR = true;

// カメラを映して、写ったQRを読む。止めるための関数を返す。
// 映像はサーバーから1コマずつ受け取る（/api/camera.jpg）。
// ブラウザのカメラ機能(getUserMedia)はラズパイのChromiumで固まるため使わない。
// square … 画面には真ん中の正方形だけ出す（読み取りはこれまでどおりコマ全体で行う）
function startCamera(view, onCode, { square = false } = {}) {
  let stopped = false, last = '', lastAt = 0, misses = 0;
  const ctx = view.getContext('2d');
  const raw = document.createElement('canvas');          // 読み取り用（回さない・返さない）
  const rctx = raw.getContext('2d', { willReadFrequently: true });
  const turned = CAM_ROTATE % 180 !== 0;                 // 縦横が入れ替わるか

  const found = (text) => {
    const now = Date.now();
    if (text === last && now - lastAt < 2500) return;   // 同じQRを連打しない
    last = text; lastAt = now;
    onCode(text);
  };

  const tick = () => {
    if (stopped) return;
    const im = new Image();
    im.onload = () => {
      if (stopped) return;
      misses = 0;
      const iw = im.naturalWidth, ih = im.naturalHeight;
      if (raw.width !== iw) { raw.width = iw; raw.height = ih; }
      rctx.drawImage(im, 0, 0);

      // 読み取るのは真ん中の枠の中だけ。原寸で見るので細かいQRも読める。
      // 全体を読むと重いので、代わりに「ここにかざす」場所を決める作りにした
      const cw = Math.min(640, iw), ch = Math.min(480, ih);
      const cx = (iw - cw) / 2, cy = (ih - ch) / 2;
      try {
        const d = rctx.getImageData(cx, cy, cw, ch);
        const r = jsQR(d.data, d.width, d.height, { inversionAttempts: 'dontInvert' });
        if (r && r.data) found(r.data);
      } catch (_) { /* 1コマ失敗しても続ける */ }

      // 画面に出すぶんだけ回して、左右を返す（取り付けの向きに合わせる）
      let vw = turned ? ih : iw, vh = turned ? iw : ih;
      if (square) vw = vh = Math.min(vw, vh);            // はみ出した上下（左右）は切る
      if (view.width !== vw || view.height !== vh) { view.width = vw; view.height = vh; }
      ctx.save();
      ctx.translate(vw / 2, vh / 2);
      if (CAM_MIRROR) ctx.scale(-1, 1);                  // 画面の左右を返す
      ctx.rotate(CAM_ROTATE * Math.PI / 180);
      ctx.drawImage(im, -iw / 2, -ih / 2);
      ctx.restore();
      if (cw < iw) {                                     // かざす場所の目印
        const bw = turned ? ch : cw, bh = turned ? cw : ch;
        ctx.strokeStyle = '#1B3FCC'; ctx.lineWidth = 4;
        ctx.strokeRect((vw - bw) / 2, (vh - bh) / 2, bw, bh);
      }
      setTimeout(tick, 80);
    };
    im.onerror = () => {
      if (stopped) return;
      if (++misses === 3) view.replaceWith(el('div', 'hint', 'カメラを使えません（IDを打ってください）'));
      if (misses < 3) setTimeout(tick, 1000);
    };
    im.src = '/api/camera.jpg?t=' + Date.now();
  };
  tick();

  return () => { stopped = true; };
}

// 要素レシートを2枚読み取る項目（カメラで読む / IDを打つ）
// 入力欄は別に置かず、いま埋めるスロットの中へ直接打ち込む
function askElements(parent, initial) {
  return new Promise((resolve) => {
    const node = openWindow('scan');
    const pane = paneOf(node);
    pane.classList.add('side');
    const slots = el('div', 'slots');
    const box = [el('span', 'slot'), el('span', 'slot')];
    slots.append(box[0], el('span', null, '×'), box[1]);
    const input = el('input');
    input.type = 'text';
    const err = el('div', 'err');
    const clear = boxBtn('clear');
    const ok = boxBtn('ok');
    const random = boxBtn('ランダムに選ぶ');
    const back = backOf(node);
    const video = el('canvas', 'cam');
    node.classList.add('scan2');
    pane.append(video, slots,
                el('div', 'hint', '要素レシートのQRをカメラに向ける（上の欄を触って番号を打ってもよい）'),
                toolRow(random), toolRow(clear, ok), err);

    const picked = initial ? initial.slice() : [null, null];
    const render = () => {
      const now = picked[0] ? (picked[1] ? -1 : 1) : 0;   // いま打ち込むスロット
      box.forEach((s, i) => {
        s.textContent = picked[i] ? picked[i].name : (i === now ? '' : `[ E-000${i + 1} ]`);
        s.classList.toggle('empty', !picked[i]);
      });
      if (now < 0) { input.remove(); return; }
      input.placeholder = `[ E-000${now + 1} ]`;  // 番号だけ打てばよい（例 12 → E-0012）
      box[now].append(input);
      input.focus();
    };
    render();
    const done = () => {
      hideKeyboard();
      clearInterval(timer); stopCam(); input.remove();
      node.dataset.done = '1';
    };
    back.onclick = () => { hideKeyboard(); clearInterval(timer); stopCam(); closeWindow(node); resolve(BACK); };
    clear.onclick = () => { picked[0] = picked[1] = null; err.textContent = ''; render(); };
    ok.onclick = () => {
      if (!picked[0] || !picked[1]) { err.textContent = '要素を2つ読み取ってください'; return; }
      done();
      resolve({ node, value: picked });
    };

    // 紙を引かずに、作られた要素（紙に出たもの）から選ぶ。
    // 空いている所だけ埋める（2つとも埋まっていたら2つとも選び直す）。
    // 選び直せるよう、そろっても次へは進まない（ok で進む）
    random.onclick = async () => {
      random.disabled = true;
      try {
        const all = (await api('/api/elements')).filter((e) => e.printed !== false);
        if (picked[0] && picked[1]) picked[0] = picked[1] = null;
        for (let i = 0; i < 2; i++) {
          if (picked[i]) continue;
          const pool = all.filter((e) => !picked.some((p) => p && p.id === e.id));
          if (!pool.length) { err.textContent = '選べる要素がありません'; break; }
          picked[i] = pool[Math.floor(Math.random() * pool.length)];
        }
        if (picked[0] && picked[1]) err.textContent = '';
        render();
      } catch (e) { err.textContent = '要素を読み込めませんでした: ' + e.message; }
      random.disabled = false;
    };

    const add = async (code) => {
      code = toId('E', code);
      if (!/^E-\d{4}$/.test(code)) { err.textContent = `要素のIDではありません: ${code}`; return; }
      if (picked.some((p) => p && p.id === code)) { err.textContent = '同じ要素です'; return; }
      const i = picked[0] ? 1 : 0;
      try {
        picked[i] = await api('/api/element/' + code);
      } catch (_) { err.textContent = `${code} が見つかりません`; return; }
      err.textContent = '';
      render();
      if (picked[0] && picked[1]) {                     // 2枚そろったらそのまま次へ
        done();
        resolve({ node, value: picked });
      }
    };
    const typed = () => { const v = input.value; input.value = ''; add(v); };
    input.addEventListener('keydown', (e) => {         // スキャナはEnterを送ってくる
      if (e.key === 'Enter') { e.preventDefault(); typed(); }
    });
    attachKeyboard(input, 'num', typed);               // 入力欄を触ると番号のキーボードが出る
    const stopCam = startCamera(video, add, { square: true });   // 画面のカメラで読む
    settle(node);
    setTimeout(() => input.focus(), 600);

    let lastAt = 0;                                     // 別の端末(scan.html)から来たQRも受ける
    const timer = setInterval(async () => {
      try {
        const s = await (await fetch('/api/scan')).json();
        if (s.code && s.at > lastAt) { lastAt = s.at; add(s.code); }
      } catch (_) { /* サーバーが落ちていても画面は保つ */ }
    }, 800);
  });
}

// 印刷の確認のウィンドウ。yes で刷る（← で戻る）
function askPrint(parent, make) {
  return new Promise((resolve) => {
    const node = openWindow('print');
    const pane = paneOf(node);
    const yes = boxBtn('yes');
    pane.append(el('div', 'ask', 'レシートを印刷しますか？'), toolRow(yes));
    const back = backOf(node);
    back.onclick = () => { closeWindow(node); resolve(BACK); };
    yes.onclick = async () => {
      yes.disabled = back.disabled = true;
      try {
        await ensureFont();
        await make();                    // 印刷したらこの画面で終わり（resolveしない）
      } catch (e) { showOverlay('error', e.message, true); }
    };
  });
}

// 評価フェーズ。フロー図の③と「評価フェーズイメージ.pdf」に合わせた作り。
//   くじで引いたアイデアレシートのQRを読む → A/Bを伏せて並べる → 4つ聞く
//   → 答え合わせ（AIは… [A]）→ 知ったあとでも創造的だと思うのは同じか → ありがとう画面
// 要素を選ぶときと同じで、紙を引いてQRを読む（画面の中で抽選はしない）。
// どちらがAIかは、4つ答えて票を残すまでサーバーしか知らない。
// AIを当てる問いを最後にするのは、先に聞くと「AIっぽさ」で読んでしまい、ほかの答えが偏るため。
// 聞いている間は文で、答えたら短い名前にする（short はレシートにも使う）
const EVAL_ASK = [
  { key: 'novel', ask: '1. 思いつかなかったのは？', short: '1. 思いつかない' },
  { key: 'fit', ask: '2. 音にピッタリなのは？', short: '2. ピッタリ' },
  { key: 'creative', ask: '3. より創造的なのは？', short: '3. 創造的' },
  { key: 'ai', ask: '4. AIが考えたのは？', short: '4. AI' },
];

// レシートのQRを読む（IDを打ってもよい）ひとまとまり。
// 評価フェーズと「もう一度印刷する」で同じものを使う。
//   accept … 受け付けるIDの形   onCode(code, close) … 読めたときの処理
function readCode(node, { placeholder, hint, accept, prefix = '', onCode, onBack }) {
  const pane = paneOf(node);
  const slots = el('div', 'slots');
  const slot = el('span', 'slot empty');
  const input = el('input');
  input.type = 'text';
  input.placeholder = placeholder;
  slot.append(input);
  slots.append(slot);
  const video = el('canvas', 'cam');
  const hintEl = el('div', 'hint', hint);
  const err = el('div', 'err');
  const back = backOf(node);
  pane.classList.add('side');
  pane.append(video, slots, hintEl, err);

  const stopCam = startCamera(video, (code) => handle(code), { square: true });
  const close = () => {
    stopCam();
    hideKeyboard();
    for (const e of [slots, video, hintEl, err]) e.remove();
    pane.classList.remove('side');
  };
  const handle = async (code) => {
    code = toId(prefix, code);
    if (!accept.test(code)) { err.textContent = `レシートのIDではありません: ${code}`; return; }
    const msg = await onCode(code, close);         // 進めるときは close を呼んでもらう
    if (msg) err.textContent = msg;
  };
  const typed = () => { const v = input.value; input.value = ''; handle(v); };
  input.addEventListener('keydown', (e) => {       // スキャナはEnterを送ってくる
    if (e.key === 'Enter') { e.preventDefault(); typed(); }
  });
  attachKeyboard(input, 'num', typed);             // 入力欄を触ると番号のキーボードが出る
  back.onclick = () => { hideKeyboard(); stopCam(); onBack(); };
  setTimeout(() => input.focus(), 600);
}

function askEvaluate(parent) {
  return new Promise((resolve) => {
    const node = openWindow('evaluate');
    readCode(node, {
      placeholder: '[ I-0001 ]',
      hint: '引いたアイデアレシートのQRを向ける（上の欄を触って番号を打ってもよい）',
      accept: /^I-\d{4}$/, prefix: 'I',
      onBack: () => { closeWindow(node); resolve(BACK); },
      onCode: async (code, close) => {
        let pair;
        try {
          pair = await api('/api/idea/' + code + '/pair');
        } catch (e) { return `${code} … ${e.message}`; }
        close();
        evaluatePair(node, pair);
      },
    });
    settle(node);
  });
}

// 評価の表の中で、いま増えた所がウィンドウからはみ出したら、中を送って見せる
function bringUp(target) {
  setTimeout(() => target.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);
}

// 読み取った1組について、A/Bを伏せたまま4つ聞き、答え合わせをする。
// 左に問い、右にAとBの列（間を破線で区切る）。答えた側が [●] になる
function evaluatePair(node, pair) {
  // ← で途中から select へ戻れる。戻ったあとに遅れて動く処理（次の問い・ありがとう画面）は止める。
  // 4つ答える前に戻れば票は残らない。答え合わせのあとに戻ると、5問目の答えだけが残らない
  const left = () => !node.isConnected || node.classList.contains('closing');
  paneOf(node).append(el('span', 'ev-id', pair.id));    // 読み取ったレシートの番号
  const board = el('div', 'ev');
  const grid = el('div', 'ev-grid');
  board.append(grid);
  paneOf(node).append(board);

  // 表は4列: 問い / A / B / 答え合わせで [B] を置く余白
  const cell = (cls, text) => { const c = el('div', cls, text); grid.append(c); return c; };
  cell('ev-q');
  cell('ev-src', (pair.elements || []).join('  ×  '));
  cell('ev-gap');
  cell('ev-q');
  const column = {};                                    // 答え合わせの枠を測るために列ごとに覚える
  for (const [mark, one] of [['A', pair.a], ['B', pair.b]]) {
    const head = cell('ev-head ev-' + mark);
    // 長い名前は1文字だけ次の行に落ちやすいので、少し小さくする
    head.append(el('span', [...one.name].length > 6 ? 'nm long' : 'nm', one.name));
    head.prepend(el('span', 'ab', mark));
    column[mark] = [head];
  }
  cell('ev-gap');

  const answers = {};
  const askOne = (i) => {
    if (i >= EVAL_ASK.length) return reveal();
    const q = EVAL_ASK[i];
    const qt = cell('ev-q now', q.ask);
    const picks = [];
    for (const mark of ['A', 'B']) {
      const c = cell('ev-cell ev-' + mark);
      const b = btn('');
      b.className = 'ev-pick';
      b.innerHTML = '[<span class="bx"></span>]';
      b.onclick = () => {
        if (answers[q.key]) return;
        answers[q.key] = mark;
        b.querySelector('.bx').textContent = '●';
        for (const p of picks) p.disabled = true;
        qt.textContent = q.short;
        qt.classList.remove('now');
        setTimeout(() => { if (!left()) askOne(i + 1); }, 380);
      };
      picks.push(b);
      c.append(b);
      column[mark].push(c);
    }
    bringUp(cell('ev-gap'), board);
  };

  // 答え合わせ。票を残すと、サーバーが初めてAIの側を教えてくれる
  let vote = null, aiSide = null;
  const reveal = async () => {
    try {
      const st = await api('/api/vote', Object.assign({ idea: pair.id }, answers));
      vote = st.vote; aiSide = st.ai_side;
    } catch (e) {
      cell('ev-wide err', '回答を残せませんでした: ' + e.message);
      return;
    }
    // AIの列を枠で囲む
    const g = grid.getBoundingClientRect();
    const cs = column[aiSide];
    const t = cs[0].getBoundingClientRect(), bt = cs[cs.length - 1].getBoundingClientRect();
    const box = el('div', 'ev-box');
    // 列の端ちょうどだと破線と重なるので、少し内側に
    box.style.left = (t.left - g.left + 8) + 'px';
    box.style.width = (t.width - 16) + 'px';
    box.style.top = (t.top - g.top - 6) + 'px';
    box.style.height = (bt.bottom - t.top + 12) + 'px';
    grid.append(box);

    // 「AIは…」と、枠の下から伸びる線の先に [A]
    cell('ev-q ev-ai', 'AIは…');
    if (aiSide === 'B') cell('ev-gap');
    cell('ev-link');
    const badge = cell('ev-badge');
    badge.append(el('span', 'ab', aiSide));
    if (aiSide === 'A') cell('ev-gap');
    bringUp(badge, board);
    await wait(2400);
    if (left()) return;
    askAfter();
  };

  // 知ったあとでも、創造的だと思うのは同じか（はい = 同じ）
  const askAfter = () => {
    const qt = cell('ev-wide ev-q now', '5. 知ったあとでも、創造的だと思うのは同じ？');
    cell('ev-q');
    const opts = [];
    for (const [label, value] of [['はい', true], ['いいえ', false]]) {
      const c = cell('ev-cell ev-yn');
      const b = btn(`[ ${label} ]`);
      b.onclick = async () => {
        if (b.dataset.done) return;
        for (const o of opts) { o.dataset.done = '1'; o.disabled = true; }
        b.classList.add('on');
        qt.classList.remove('now');
        api('/api/vote/after', { vote, same: value }).catch(() => {});
        await wait(700);
        if (left()) return;
        showThanks(() => evaluateReceipt(pair, answers, aiSide, value, vote));
      };
      opts.push(b);
      c.append(b);
    }
    bringUp(cell('ev-gap'), board);
  };

  settle(node);
  askOne(0);
}

// 最後の画面。集計は展示用の画面（ディスプレイ）に出すので、ここでは見せない
function showThanks(makeReceipt) {
  const box = el('div', 'thanks');
  const win = el('div', 'win solo');
  const bar = el('div', 'win-bar');
  bar.append(el('div', 'win-title', 'thank you'));
  const body = el('div', 'win-body th-inner');
  body.append(el('div', 'th-big', 'ありがとうございました。'),
              el('div', 'th-sub', '回答は集計し、ディスプレイに表示されます。'));
  const row = el('div', 'th-tools');
  const back = boxBtn('back');
  const print = boxBtn('print');
  const item = (cap, b) => { const d = el('div', 'th-item'); d.append(b, el('small', '', cap)); return d; };
  row.append(item('タイトルへ戻る', back), item('回答を印刷する', print));
  body.append(row);
  win.append(bar, body);
  box.append(win);
  document.body.append(box);
  setTimeout(() => box.classList.add('show'), 20);

  back.onclick = () => location.reload();
  print.onclick = async () => {
    print.disabled = true;
    try {
      await ensureFont();
      await printReceipt(makeReceipt());      // 刷り終わりの画面から back でタイトルへ
    } catch (e) { showOverlay('error', e.message, true); }
    print.disabled = false;
  };
}

// ---------------------------------------------------------------- 流れ
// ONOMATOPIA（タイトルのウィンドウ）
//   → select … ① オノマトペを作る / ② オノマトペを組み合わせる / ③ 評価する
//   ① enter(name) → draw → print
//   ② scan(要素2枚) → enter(imagine) → enter(why) → print
//   ③ evaluate（引いたアイデアのQRを読んで4つ聞き、答え合わせ）
// 刷り直しは来場者の流れに入れない。印刷が終わった画面の reprint で出す。

const stepMode = (parent) => askChoice(parent, [
  { label: '① オノマトペを作る', value: 'element' },
  { label: '② オノマトペを組み合わせる（展示のみ）', value: 'idea' },
  { label: '③ 評価する（展示のみ）', value: 'evaluate' },
]);

const stepName = (parent, initial) => askText(parent, 'enter', {
  field: 'name:', placeholder: 'オノマトペをローマ字で', keys: 'abc', max: 16,
  validate: (v) => (/^[A-Za-z]{2,16}$/.test(v) ? '' : 'ローマ字（英字）2〜16文字で'),
}, initial);

const stepDraw = (parent, initial) => askDrawing(parent, 'draw', initial);

const stepPrintElement = (parent, _, vals) => askPrint(parent, async () => {
  const rec = await api('/api/element', { name: vals[1].toUpperCase(), strokes: vals[2] });
  const ok = await printReceipt(elementReceipt(rec));
  // 紙に出たものだけ印を付ける。出なかったものは一覧で「未印刷」として整理できる
  // api() は中身を渡さないと GET になる。印を付けるのは POST なので {} を渡す
  if (ok && !PREVIEW) api('/api/element/' + rec.id + '/printed', {}).catch(() => {});
});

const stepScan = (parent, initial) => askElements(parent, initial);

const stepEvaluate = (parent) => askEvaluate(parent);

const pairName = (vals) => (vals[1] || []).map((e) => e.name).join(' × ');

const stepIdea = (parent, initial, vals) => askText(parent, 'enter', {
  field: 'imagine:', note: pairName(vals),     // 選んだ2つの要素を見ながら考えてもらう
  placeholder: 'すすきのはら',
  hint: '2つのオノマトペから連想した「実在するもの」を、かなで',
  keys: 'kana', max: 12,
  validate: (v) => (v.length >= 1 && v.length <= 12 ? '' : '12文字までで'),
}, initial);

const stepWhy = (parent, initial, vals) => askText(parent, 'enter', {
  field: 'why:', note: `${pairName(vals)}  →  ${vals[2] || ''}`,
  placeholder: 'かぜでくさがざわざわゆれて、ほがふわふわしているから。',
  hint: 'そうおもったわけを、かなで（90文字まで）', area: true,
  keys: 'kana', max: 90,
  validate: (v) => (v.length >= 10 && v.length <= 90 ? '' : '10〜90文字で'),
}, initial);

const stepPrintIdea = (parent, _, vals) => askPrint(parent, async () => {
  showOverlay('thinking', 'AIも同じ2つから連想しています');
  barWait(true);                     // どれくらいかかるか読めないので、行き来させておく
  const rec = await api('/api/idea', {
    elements: vals[1].map((e) => e.id),
    name_ja: vals[2], explain_ja: vals[3],
  });
  await printReceipt(ideaReceipt(rec, vals[1]));
});

function planStep(i, vals) {
  if (i === 0) return stepMode;
  const chain = { element: [stepName, stepDraw, stepPrintElement],
                  idea: [stepDemoOnly],
                  evaluate: [stepDemoOnly] }[vals[0]] || [];
  return chain[i - 1] || null;
}

// 項目を順に出す。← が押されたら1つ前をやり直す（前のウィンドウを開き直す）
async function session() {
  const vals = [], nodes = [];
  let i = 0;
  for (;;) {
    const step = planStep(i, vals);
    if (!step) return;
    const res = await step(null, vals[i], vals);
    if (res === BACK) {
      if (i === 0) { backToTitle(); return; }
      i -= 1;
      reopen = nodes[i];             // 後ろにある前のウィンドウを、その場で開き直す（作り直して入れ替える）
      nodes.length = i;
      continue;
    }
    if (i === 0 && vals[0] !== undefined && vals[0] !== res.value) vals.length = 0;  // 道が変われば入力は捨てる
    vals[i] = res.value;
    nodes[i] = res.node;
    i += 1;
    await wait(60);                  // 押した手ごたえが見えるだけ待つ
  }
}

function backToTitle() {
  for (const w of [...desk.children]) if (w.id !== 'title') closeWindow(w);   // タイトルが手前へすべり出る
  restack();
  $('#start').classList.remove('gone');
  quitCorner(true);
}

// タイトルの日付と時刻（2026/12/31 / 12:00）
function tickClock() {
  const d = new Date();
  const t = $('#t-date'), h = $('#t-time');
  if (t) t.textContent = dateStr(d);              // 2026/12/31（レシートの日付と同じ書き方）
  if (h) h.textContent = timeStr(d);
}

async function start() {
  if ($('#start').classList.contains('gone')) return;
  quitCorner(false);
  $('#start').classList.add('gone');
  await wait(250);
  session();
}

// タイトル画面の右上を長押しすると展示を終了する。
// 関係者だけが使うので印は付けない。来場者が触れても誤作動しないよう1.5秒押す必要がある。
// （ブラウザから Alt+F4 は送れないので、サーバーに頼んで終わらせる）
function setupQuitCorner() {
  holdCorner('#quit', async (q) => {         // 右上 … 展示を終える
    q.classList.add('pressed');              // 押せたことだけ分かるよう薄く反応する
    try { await fetch('/api/quit', { method: 'POST' }); } catch (_) { /* 落ちても画面は保つ */ }
  });
  holdCorner('#sound', (q) => {              // 左上 … 音のテスト画面へ
    q.classList.add('pressed');
    location.href = '/soundtest.html';
  });
}

// 隅を1.5秒押したら実行する。来場者が触れても誤作動しない長さにしてある
function holdCorner(sel, run) {
  const q = $(sel);
  if (!q) return;
  let timer = null;
  q.addEventListener('pointerdown', () => { timer = setTimeout(() => run(q), 1500); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
    q.addEventListener(ev, () => { clearTimeout(timer); q.classList.remove('pressed'); });
  }
}

// 関係者用の隅は、タイトル画面のときだけ反応させる（操作中に邪魔をしない）
const quitCorner = (on) => {
  for (const sel of ['#quit', '#sound']) {
    const q = $(sel);
    if (q) q.classList.toggle('on', on);
  }
};

if ($('#start')) {
  $('#start').onclick = start;
  tickClock();
  setInterval(tickClock, 10 * 1000);
  restack();
  quitCorner(true);
  setupQuitCorner();
}
