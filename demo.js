// 体験サイト用（中間発表）。app.js のあとに読み込む。
// サーバーは無いので、① で使う「要素を残す」だけをブラウザの中で返す。
// 記録はどこにも送らない・残さない。

// 要素の番号。本物（E-0001）と混ざらないよう T- にする
function demoId() {
  let n;
  try {
    n = (Number(localStorage.getItem('demo-n')) || 0) + 1;
    localStorage.setItem('demo-n', String(n));
  } catch (_) {
    n = Math.floor(Math.random() * 9000) + 1;
  }
  return 'T-' + String(n).padStart(4, '0');
}

const realFetch = window.fetch.bind(window);
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

window.fetch = async (path, opt = {}) => {
  if (typeof path === 'string' && path.startsWith('/api/')) {
    if (path === '/api/element' && opt.method === 'POST') {
      const body = JSON.parse(opt.body || '{}');
      return json({ id: demoId(), name: body.name, strokes: body.strokes });
    }
    return json({ error: '体験サイトでは使えません' }, 404);
  }
  return realFetch(path, opt);
};

// ② ③ を選んだとき
function stepDemoOnly() {
  return new Promise((resolve) => {
    const node = openWindow('sorry');
    const back = boxBtn('back');
    paneOf(node).append(
      el('div', 'ask', '体験用サイトなので、ここは遊べないよー'),
      el('div', 'hint', '② と ③ は展示の会場で体験してね。ここでは ① オノマトペを作る を遊べます'),
      toolRow(back),
    );
    const leave = () => { closeWindow(node); resolve(BACK); };
    back.onclick = leave;
    backOf(node).onclick = leave;
  });
}

// 印刷の代わりに、できたレシートを画面に出す（app.js の PREVIEW が送ってくる）
let receiptPng = null;
window.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'receipt') return;
  receiptPng = e.data.png;
  const box = $('#ov-receipt');
  box.querySelector('img').src = receiptPng;
  box.hidden = false;
  box.scrollTop = 0;
});

// save … 画像として保存（iPhone では画像を長押しして保存もできる）
$('#ov-again').onclick = () => {
  if (!receiptPng) return;
  const a = document.createElement('a');
  a.href = receiptPng;
  a.download = 'onomatopia_receipt.png';
  document.body.append(a);
  a.click();
  a.remove();
};
