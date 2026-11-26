// スマホでは、装置の画面（1024×600 向け）をそのまま横幅に当てると窮屈になる。
// 横向きのときは「幅 1000・高さ 560 以上の画面」として組み、全体を縮めて見せる。
// （viewport の width を広げると、スマホのブラウザがその幅に合わせて縮小してくれる）
(() => {
  const meta = document.querySelector('meta[name=viewport]');
  const BASE = 'width=device-width,initial-scale=1,user-scalable=no';
  const MIN_W = 1000, MIN_H = 560;
  function fit() {
    meta.setAttribute('content', BASE);             // いったん元に戻して、実際の大きさを測る
    setTimeout(() => {
      const w = innerWidth, h = innerHeight;
      if (h > w) return;                            // 縦向きは「横にしてね」を出すだけ
      const k = Math.max(1, MIN_W / w, MIN_H / h);
      if (k > 1) meta.setAttribute('content', `width=${Math.round(w * k)},user-scalable=no`);
    }, 80);
  }
  fit();
  addEventListener('orientationchange', () => setTimeout(fit, 300));
})();
